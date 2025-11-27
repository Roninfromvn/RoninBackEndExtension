#!/usr/bin/env node

/**
 * Migration Script: Easy Firestore Collections to PostgreSQL
 * 
 * Usage:
 *   node scripts/migrate-easy-collections.js [options]
 * 
 * Options:
 *   --dry-run: Preview migration without executing
 *   --collection=<name>: Migrate specific collection only
 *   --force: Skip confirmations
 */

const EasyMigrationService = require('../src/services/EasyMigrationService');
const { pool } = require('../src/db');
const fs = require('fs').promises;
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  collection: args.find(arg => arg.startsWith('--collection='))?.split('=')[1]
};

async function runMigration() {
  console.log('🚀 Easy Collections Migration Script');
  console.log('=====================================\n');
  
  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  try {
    // 1. Check database connection
    console.log('🔌 Checking database connection...');
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ Database connection OK\n');
    
    // 2. Run database schema migration
    if (!options.dryRun) {
      console.log('📊 Creating database schema...');
      await runSchemaMigration();
      console.log('✅ Database schema created\n');
    } else {
      console.log('📊 [DRY RUN] Would create database schema\n');
    }
    
    // 3. Initialize migration service
    console.log('🔧 Initializing migration service...');
    const migrationService = new EasyMigrationService();
    console.log('✅ Migration service ready\n');
    
    // 4. Run migrations
    if (options.collection) {
      console.log(`🎯 Migrating specific collection: ${options.collection}\n`);
      await runSpecificMigration(migrationService, options.collection);
    } else {
      console.log('📋 Running complete migration...\n');
      
      if (!options.force && !options.dryRun) {
        console.log('⚠️  This will migrate all easy collections from Firestore to PostgreSQL');
        console.log('⚠️  Existing PostgreSQL data will be updated/replaced');
        console.log('⚠️  Press Ctrl+C to cancel, or wait 10 seconds to continue...\n');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      if (options.dryRun) {
        await runDryRunAnalysis(migrationService);
      } else {
        const results = await migrationService.migrateAll();
        
        // Also sync folders from Google Drive
        const folderResult = await migrationService.syncFoldersFromDrive();
        results.folders = folderResult;
        
        console.log('\n📊 MIGRATION SUMMARY:');
        console.log('=====================');
        
        for (const [collection, result] of Object.entries(results)) {
          const status = result.status === 'success' ? '✅' : '❌';
          console.log(`${status} ${collection}: ${result.status}`);
          if (result.migrated !== undefined) {
            console.log(`   - Migrated: ${result.migrated} records`);
          }
          if (result.errors > 0) {
            console.log(`   - Errors: ${result.errors}`);
          }
          if (result.duration) {
            console.log(`   - Duration: ${result.duration}ms`);
          }
        }
        
        console.log('\n🎉 Migration completed!');
      }
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function runSchemaMigration() {
  const migrationFile = path.join(__dirname, '../migrations/003_migrate_easy_collections.sql');
  const sql = await fs.readFile(migrationFile, 'utf8');
  
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('✅ Schema migration executed successfully');
  } finally {
    client.release();
  }
}

async function runSpecificMigration(migrationService, collectionName) {
  const methods = {
    'folders': () => migrationService.syncFoldersFromDrive(),
    'page_configs': () => migrationService.migratePageConfigs(),
    'post_logs': () => migrationService.migratePostLogs(),
    'agents': () => migrationService.migrateAgents(),
    'assignments': () => migrationService.migrateAssignments()
  };
  
  if (!methods[collectionName]) {
    throw new Error(`Unknown collection: ${collectionName}. Available: ${Object.keys(methods).join(', ')}`);
  }
  
  if (options.dryRun) {
    console.log(`[DRY RUN] Would migrate collection: ${collectionName}`);
    return;
  }
  
  const result = await methods[collectionName]();
  console.log(`\n✅ ${collectionName} migration result:`, result);
}

async function runDryRunAnalysis(migrationService) {
  console.log('🔍 DRY RUN ANALYSIS');
  console.log('==================\n');
  
  try {
    // Check Firestore collections
    const collections = ['pageCfg', 'postLogs', 'agents', 'assignments'];
    
    for (const collectionName of collections) {
      try {
        const col = migrationService.firestore.collection(collectionName);
        const snapshot = await col.limit(1).get();
        const count = snapshot.size > 0 ? 'has data' : 'empty';
        console.log(`📁 ${collectionName}: ${count}`);
      } catch (error) {
        console.log(`📁 ${collectionName}: error - ${error.message}`);
      }
    }
    
    // Check Google Drive connection
    try {
      const GoogleDriveService = require('../src/services/GoogleDriveService');
      const googleDriveService = new GoogleDriveService();
      const testQuery = await googleDriveService.listByQuery(
        `'${require('../config').config.googleDrive.rootFolderId}' in parents and trashed=false`,
        'files(id)',
        1
      );
      console.log(`📁 Google Drive: accessible (${testQuery.length} items found)`);
    } catch (error) {
      console.log(`📁 Google Drive: error - ${error.message}`);
    }
    
    console.log('\n✅ Dry run analysis completed');
    
  } catch (error) {
    console.error('❌ Dry run analysis failed:', error);
  }
}

// Help text
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🚀 Easy Collections Migration Script

Usage: node scripts/migrate-easy-collections.js [options]

Options:
  --dry-run              Preview migration without executing
  --collection=<name>    Migrate specific collection only
                         Available: folders, page_configs, post_logs, agents, assignments
  --force               Skip confirmations
  --help, -h            Show this help

Examples:
  node scripts/migrate-easy-collections.js --dry-run
  node scripts/migrate-easy-collections.js --collection=folders
  node scripts/migrate-easy-collections.js --force
`);
  process.exit(0);
}

// Run migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
