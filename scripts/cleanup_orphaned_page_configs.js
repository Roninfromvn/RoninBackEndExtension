#!/usr/bin/env node
/**
 * Cleanup page configs that reference deleted folders
 */

require('dotenv').config();

async function cleanupOrphanedPageConfigs() {
  console.log('🧹 Cleaning up page configs with orphaned folder references...\n');
  
  try {
    const { pool } = require('../src/db');
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Step 1: Get all existing folder IDs
      console.log('🔄 Step 1: Getting existing folder IDs...');
      const foldersResult = await client.query('SELECT id FROM folders');
      const existingFolderIds = new Set(foldersResult.rows.map(row => row.id));
      console.log(`✅ Found ${existingFolderIds.size} existing folders`);
      
      // Step 2: Get all page configs with folder references
      console.log('\n🔄 Step 2: Getting page configs with folder references...');
      const pageConfigsResult = await client.query(`
        SELECT page_id, folder_ids, enabled
        FROM page_configs 
        WHERE folder_ids IS NOT NULL AND folder_ids != '[]'::jsonb
      `);
      
      console.log(`✅ Found ${pageConfigsResult.rows.length} page configs with folder references`);
      
      if (pageConfigsResult.rows.length === 0) {
        console.log('✅ No page configs with folder references found');
        await client.query('COMMIT');
        return;
      }
      
      // Step 3: Analyze each page config
      console.log('\n🔍 Step 3: Analyzing page configs...');
      const orphanedConfigs = [];
      const validConfigs = [];
      
      for (const config of pageConfigsResult.rows) {
        let folderIds = [];
        try {
          if (typeof config.folder_ids === 'string') {
            // Try JSON first
            folderIds = JSON.parse(config.folder_ids);
          } else if (Array.isArray(config.folder_ids)) {
            folderIds = config.folder_ids;
          } else {
            folderIds = [];
          }
        } catch (e) {
          // If not JSON, treat as comma-separated string
          if (typeof config.folder_ids === 'string') {
            folderIds = config.folder_ids.split(',').map(id => id.trim()).filter(id => id.length > 0);
          } else {
            folderIds = [];
          }
        }
        
        const validFolderIds = folderIds.filter(id => existingFolderIds.has(id));
        const orphanedFolderIds = folderIds.filter(id => !existingFolderIds.has(id));
        
        if (orphanedFolderIds.length > 0) {
          if (validFolderIds.length === 0) {
            // All folders are orphaned - mark for deletion
            orphanedConfigs.push({
              page_id: config.page_id,
              folder_ids: config.folder_ids,
              orphaned_folders: orphanedFolderIds,
              valid_folders: validFolderIds,
              action: 'delete'
            });
          } else {
            // Some folders are orphaned - update to keep only valid ones
            validConfigs.push({
              page_id: config.page_id,
              old_folder_ids: config.folder_ids,
              new_folder_ids: JSON.stringify(validFolderIds),
              orphaned_folders: orphanedFolderIds,
              valid_folders: validFolderIds,
              action: 'update'
            });
          }
        } else {
          // All folders are valid - no action needed
          validConfigs.push({
            page_id: config.page_id,
            folder_ids: config.folder_ids,
            orphaned_folders: [],
            valid_folders: validFolderIds,
            action: 'keep'
          });
        }
      }
      
      console.log(`\n📊 Analysis results:`);
      console.log(`   🗑️ Configs to delete: ${orphanedConfigs.length}`);
      console.log(`   🔄 Configs to update: ${validConfigs.filter(c => c.action === 'update').length}`);
      console.log(`   ✅ Configs to keep: ${validConfigs.filter(c => c.action === 'keep').length}`);
      
      // Step 4: Show details of orphaned configs
      if (orphanedConfigs.length > 0) {
        console.log('\n📋 Page configs to be deleted (all folders orphaned):');
        orphanedConfigs.forEach((config, index) => {
          console.log(`   ${index + 1}. Page ${config.page_id}:`);
          console.log(`      Orphaned folders: ${config.orphaned_folders.join(', ')}`);
          console.log(`      Valid folders: ${config.valid_folders.length > 0 ? config.valid_folders.join(', ') : 'None'}`);
        });
      }
      
      // Step 5: Show details of configs to update
      const configsToUpdate = validConfigs.filter(c => c.action === 'update');
      if (configsToUpdate.length > 0) {
        console.log('\n📋 Page configs to be updated (remove orphaned folders):');
        configsToUpdate.forEach((config, index) => {
          console.log(`   ${index + 1}. Page ${config.page_id}:`);
          console.log(`      Old folders: ${JSON.parse(config.old_folder_ids).join(', ')}`);
          console.log(`      New folders: ${JSON.parse(config.new_folder_ids).join(', ')}`);
          console.log(`      Removed: ${config.orphaned_folders.join(', ')}`);
        });
      }
      
      // Step 6: Perform cleanup
      console.log('\n🗑️ Step 4: Performing cleanup...');
      
      let deletedCount = 0;
      let updatedCount = 0;
      
      // Delete orphaned configs
      if (orphanedConfigs.length > 0) {
        const pageIdsToDelete = orphanedConfigs.map(c => c.page_id);
        const deleteResult = await client.query(`
          DELETE FROM page_configs 
          WHERE page_id = ANY($1::text[])
        `, [pageIdsToDelete]);
        
        deletedCount = deleteResult.rowCount;
        console.log(`   🗑️ Deleted ${deletedCount} page configs`);
      }
      
      // Update configs with mixed valid/orphaned folders
      for (const config of configsToUpdate) {
        await client.query(`
          UPDATE page_configs 
          SET folder_ids = $1::jsonb, updated_at = NOW()
          WHERE page_id = $2
        `, [config.new_folder_ids, config.page_id]);
        updatedCount++;
      }
      
      if (updatedCount > 0) {
        console.log(`   🔄 Updated ${updatedCount} page configs`);
      }
      
      await client.query('COMMIT');
      
      console.log('\n✅ Cleanup completed successfully!');
      console.log(`   🗑️ Deleted page configs: ${deletedCount}`);
      console.log(`   🔄 Updated page configs: ${updatedCount}`);
      console.log(`   ✅ Kept page configs: ${validConfigs.filter(c => c.action === 'keep').length}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error cleaning up orphaned page configs:', error);
    throw error;
  }
}

// Run cleanup
if (require.main === module) {
  cleanupOrphanedPageConfigs()
    .then(() => {
      console.log('\n🎉 Orphaned page config cleanup completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupOrphanedPageConfigs };
