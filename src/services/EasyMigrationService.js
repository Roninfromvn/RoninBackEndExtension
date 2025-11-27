/**
 * EasyMigrationService - Migrate easy Firestore collections to PostgreSQL
 * 
 * Collections to migrate:
 * - folders (empty, sync from Google Drive)
 * - page_configs (pageCfg collection)
 * - post_logs (historical data)
 * - agents (user profiles)
 * - assignments (access control)
 */

const { Firestore } = require('@google-cloud/firestore');
const { pool } = require('../db');
const path = require('path');
const { config } = require('../../config');

class EasyMigrationService {
  constructor() {
    // Initialize Firestore using same pattern as other services
    try {
      if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        console.log('[EasyMigrationService] Using credentials from environment variables');
        this.firestore = new Firestore({
          credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          },
          projectId: process.env.GOOGLE_CLOUD_PROJECT,
        });
      } else if (config.googleDrive.serviceAccountPath) {
        console.log('[EasyMigrationService] Using service account file');
        this.firestore = new Firestore({
          keyFilename: path.join(__dirname, '../..', config.googleDrive.serviceAccountPath),
        });
      } else {
        throw new Error('No Firestore credentials found');
      }
    } catch (error) {
      console.error('[EasyMigrationService] Failed to initialize Firestore:', error);
      throw error;
    }
    
    // Firestore collections
    this.pageCfgCol = this.firestore.collection(config.firestore.collections.pageCfg);
    this.postLogsCol = this.firestore.collection(config.firestore.collections.postLogs);
    this.agentsCol = this.firestore.collection(config.firestore.collections.agents);
    this.assignmentsCol = this.firestore.collection(config.firestore.collections.assignments);
    
    console.log('[EasyMigrationService] Initialized');
  }
  
  /**
   * Run complete migration for all easy collections
   */
  async migrateAll() {
    console.log('\n🚀 [EasyMigration] Starting complete migration...');
    
    const results = {
      folders: { status: 'skipped', reason: 'Will sync from Google Drive directly' },
      page_configs: { status: 'pending' },
      post_logs: { status: 'pending' },
      agents: { status: 'pending' },
      assignments: { status: 'pending' }
    };
    
    try {
      // 1. Migrate page_configs (most important)
      console.log('\n📋 [EasyMigration] Migrating page_configs...');
      results.page_configs = await this.migratePageConfigs();
      
      // 2. Migrate post_logs
      console.log('\n📊 [EasyMigration] Migrating post_logs...');
      results.post_logs = await this.migratePostLogs();
      
      // 3. Migrate agents
      console.log('\n👥 [EasyMigration] Migrating agents...');
      results.agents = await this.migrateAgents();
      
      // 4. Migrate assignments
      console.log('\n🔐 [EasyMigration] Migrating assignments...');
      results.assignments = await this.migrateAssignments();
      
      console.log('\n✅ [EasyMigration] Complete migration finished!');
      console.log('Results:', JSON.stringify(results, null, 2));
      
      return results;
      
    } catch (error) {
      console.error('\n❌ [EasyMigration] Migration failed:', error);
      throw error;
    }
  }
  
  /**
   * Migrate page_configs (pageCfg collection)
   */
  async migratePageConfigs() {
    const startTime = Date.now();
    let migrated = 0;
    let errors = 0;
    
    try {
      const snapshot = await this.pageCfgCol.get();
      console.log(`[PageConfigs] Found ${snapshot.size} documents in Firestore`);
      
      if (snapshot.empty) {
        return { status: 'success', migrated: 0, errors: 0, duration: 0 };
      }
      
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const doc of snapshot.docs) {
          try {
            const pageId = doc.id;
            const data = doc.data();
            
            const query = `
              INSERT INTO page_configs (
                page_id, enabled, folder_ids, schedule, posts_per_slot,
                default_caption, caption_by_folder, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT (page_id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                folder_ids = EXCLUDED.folder_ids,
                schedule = EXCLUDED.schedule,
                posts_per_slot = EXCLUDED.posts_per_slot,
                default_caption = EXCLUDED.default_caption,
                caption_by_folder = EXCLUDED.caption_by_folder,
                updated_at = EXCLUDED.updated_at
            `;
            
            const values = [
              pageId,
              data.enabled || false,
              JSON.stringify(data.folderIds || []),
              JSON.stringify(data.schedule || []),
              data.postsPerSlot || 1,
              data.defaultCaption || '',
              JSON.stringify(data.captionByFolder || {}),
              data.createdAt ? new Date(data.createdAt) : new Date(),
              data.updatedAt ? new Date(data.updatedAt) : new Date()
            ];
            
            await client.query(query, values);
            migrated++;
            
          } catch (docError) {
            console.error(`[PageConfigs] Error migrating ${doc.id}:`, docError);
            errors++;
          }
        }
        
        await client.query('COMMIT');
        console.log(`[PageConfigs] ✅ Migrated ${migrated} records, ${errors} errors`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      const duration = Date.now() - startTime;
      return { status: 'success', migrated, errors, duration };
      
    } catch (error) {
      console.error('[PageConfigs] Migration failed:', error);
      return { status: 'failed', error: error.message, migrated, errors };
    }
  }
  
  /**
   * Migrate post_logs
   */
  async migratePostLogs() {
    const startTime = Date.now();
    let migrated = 0;
    let errors = 0;
    
    try {
      // Get recent logs only (last 30 days to avoid huge migration)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const snapshot = await this.postLogsCol
        .where('createdAt', '>=', thirtyDaysAgo)
        .orderBy('createdAt', 'desc')
        .limit(10000)
        .get();
        
      console.log(`[PostLogs] Found ${snapshot.size} recent documents in Firestore`);
      
      if (snapshot.empty) {
        return { status: 'success', migrated: 0, errors: 0, duration: 0 };
      }
      
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const doc of snapshot.docs) {
          try {
            const logId = doc.id;
            const data = doc.data();
            
            const query = `
              INSERT INTO post_logs (
                id, page_id, status, file_id, file_name, folder_id,
                caption, facebook_post_id, error_message, started_at,
                completed_at, duration_ms, file_size_bytes, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                completed_at = EXCLUDED.completed_at,
                error_message = EXCLUDED.error_message
            `;
            
            const values = [
              logId,
              data.pageId || '',
              data.status || 'unknown',
              data.fileId || null,
              data.fileName || null,
              data.folderId || null,
              data.caption || null,
              data.facebookPostId || null,
              data.errorMessage || null,
              data.startedAt ? new Date(data.startedAt) : null,
              data.completedAt ? new Date(data.completedAt) : null,
              data.durationMs || null,
              data.fileSizeBytes || null,
              data.createdAt ? new Date(data.createdAt) : new Date()
            ];
            
            await client.query(query, values);
            migrated++;
            
          } catch (docError) {
            console.error(`[PostLogs] Error migrating ${doc.id}:`, docError);
            errors++;
          }
        }
        
        await client.query('COMMIT');
        console.log(`[PostLogs] ✅ Migrated ${migrated} records, ${errors} errors`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      const duration = Date.now() - startTime;
      return { status: 'success', migrated, errors, duration };
      
    } catch (error) {
      console.error('[PostLogs] Migration failed:', error);
      return { status: 'failed', error: error.message, migrated, errors };
    }
  }
  
  /**
   * Migrate agents
   */
  async migrateAgents() {
    const startTime = Date.now();
    let migrated = 0;
    let errors = 0;
    
    try {
      const snapshot = await this.agentsCol.get();
      console.log(`[Agents] Found ${snapshot.size} documents in Firestore`);
      
      if (snapshot.empty) {
        return { status: 'success', migrated: 0, errors: 0, duration: 0 };
      }
      
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const doc of snapshot.docs) {
          try {
            const agentId = doc.id;
            const data = doc.data();
            
            const query = `
              INSERT INTO agents (
                agent_id, agent_label, ext_version, pages, last_seen, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT (agent_id) DO UPDATE SET
                agent_label = EXCLUDED.agent_label,
                ext_version = EXCLUDED.ext_version,
                pages = EXCLUDED.pages,
                last_seen = EXCLUDED.last_seen,
                updated_at = EXCLUDED.updated_at
            `;
            
            const values = [
              agentId,
              data.agentLabel || null,
              data.extVersion || null,
              JSON.stringify(data.pages || []),
              data.lastSeen ? new Date(data.lastSeen) : new Date(),
              data.createdAt ? new Date(data.createdAt) : new Date(),
              data.updatedAt ? new Date(data.updatedAt) : new Date()
            ];
            
            await client.query(query, values);
            migrated++;
            
          } catch (docError) {
            console.error(`[Agents] Error migrating ${doc.id}:`, docError);
            errors++;
          }
        }
        
        await client.query('COMMIT');
        console.log(`[Agents] ✅ Migrated ${migrated} records, ${errors} errors`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      const duration = Date.now() - startTime;
      return { status: 'success', migrated, errors, duration };
      
    } catch (error) {
      console.error('[Agents] Migration failed:', error);
      return { status: 'failed', error: error.message, migrated, errors };
    }
  }
  
  /**
   * Migrate assignments
   */
  async migrateAssignments() {
    const startTime = Date.now();
    let migrated = 0;
    let errors = 0;
    
    try {
      const snapshot = await this.assignmentsCol.get();
      console.log(`[Assignments] Found ${snapshot.size} documents in Firestore`);
      
      if (snapshot.empty) {
        return { status: 'success', migrated: 0, errors: 0, duration: 0 };
      }
      
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const doc of snapshot.docs) {
          try {
            const agentId = doc.id;
            const data = doc.data();
            
            const query = `
              INSERT INTO assignments (
                agent_id, allowed_pages, created_at, updated_at
              ) VALUES ($1, $2, $3, $4)
              ON CONFLICT (agent_id) DO UPDATE SET
                allowed_pages = EXCLUDED.allowed_pages,
                updated_at = EXCLUDED.updated_at
            `;
            
            const values = [
              agentId,
              JSON.stringify(data.allowedPages || []),
              data.createdAt ? new Date(data.createdAt) : new Date(),
              data.updatedAt ? new Date(data.updatedAt) : new Date()
            ];
            
            await client.query(query, values);
            migrated++;
            
          } catch (docError) {
            console.error(`[Assignments] Error migrating ${doc.id}:`, docError);
            errors++;
          }
        }
        
        await client.query('COMMIT');
        console.log(`[Assignments] ✅ Migrated ${migrated} records, ${errors} errors`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      const duration = Date.now() - startTime;
      return { status: 'success', migrated, errors, duration };
      
    } catch (error) {
      console.error('[Assignments] Migration failed:', error);
      return { status: 'failed', error: error.message, migrated, errors };
    }
  }
  
  /**
   * Sync folders from Google Drive to PostgreSQL
   */
  async syncFoldersFromDrive() {
    console.log('\n📁 [EasyMigration] Syncing folders from Google Drive...');
    
    try {
      // Use existing GoogleDriveService
      const GoogleDriveService = require('./GoogleDriveService');
      const googleDriveService = new GoogleDriveService();
      
      // Get all folders recursively
      const folders = [];
      const queue = [config.googleDrive.rootFolderId];
      
      while (queue.length > 0) {
        const folderId = queue.shift();
        
        const query = `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`;
        const subfolders = await googleDriveService.listByQuery(query, 'files(id,name,createdTime,parents)');
        
        folders.push(...subfolders);
        subfolders.forEach(folder => queue.push(folder.id));
      }
      
      console.log(`[FoldersSync] Found ${folders.length} folders in Google Drive`);
      
      // Save to PostgreSQL
      const client = await pool.connect();
      let migrated = 0;
      
      try {
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE folders CASCADE'); // Clear existing data
        
        // First, insert root folder if not exists
        const rootFolderId = config.googleDrive.rootFolderId;
        if (rootFolderId) {
          const rootQuery = `
            INSERT INTO folders (id, name, parent_id, created_time, synced_at, level)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO NOTHING
          `;
          
          const rootValues = [
            rootFolderId,
            'Root Folder',
            null, // Root has no parent
            new Date(),
            new Date(),
            0
          ];
          
          await client.query(rootQuery, rootValues);
          console.log('[FoldersSync] Inserted root folder:', rootFolderId);
        }
        
        // Then insert all other folders
        for (const folder of folders) {
          const query = `
            INSERT INTO folders (id, name, parent_id, created_time, synced_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              synced_at = EXCLUDED.synced_at
          `;
          
          const values = [
            folder.id,
            folder.name,
            folder.parents?.[0] || null,
            folder.createdTime ? new Date(folder.createdTime) : null,
            new Date()
          ];
          
          await client.query(query, values);
          migrated++;
        }
        
        await client.query('COMMIT');
        console.log(`[FoldersSync] ✅ Synced ${migrated} folders to PostgreSQL`);
        
        return { status: 'success', migrated, errors: 0 };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FoldersSync] Failed:', error);
      return { status: 'failed', error: error.message };
    }
  }
}

module.exports = EasyMigrationService;
