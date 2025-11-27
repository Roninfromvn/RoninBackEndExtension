/**
 * FolderSyncService - Service to keep PostgreSQL folders in sync with Google Drive
 * 
 * Features:
 * - Manual sync on-demand
 * - Webhook-triggered sync
 * - Scheduled periodic sync
 * - Intelligent delta sync (only changed folders)
 */

const EasyMigrationService = require('./EasyMigrationService');
const { pool } = require('../db');

class FolderSyncService {
  constructor() {
    this.migrationService = new EasyMigrationService();
    this.lastSyncTime = null;
    this.isRunning = false;
    
    console.log('[FolderSyncService] Initialized');
  }
  
  /**
   * Manual sync - refresh all folders from Google Drive
   */
  async syncNow() {
    if (this.isRunning) {
      console.log('[FolderSyncService] Sync already running, skipping...');
      return { status: 'skipped', reason: 'Already running' };
    }
    
    this.isRunning = true;
    console.log('[FolderSyncService] Starting manual sync...');
    
    try {
      const result = await this.migrationService.syncFoldersFromDrive();
      this.lastSyncTime = new Date();
      
      console.log(`[FolderSyncService] ✅ Manual sync completed: ${result.migrated} folders`);
      return result;
      
    } catch (error) {
      console.error('[FolderSyncService] Manual sync failed:', error);
      return { status: 'failed', error: error.message };
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * Webhook-triggered sync - called when Google Drive sends notification
   */
  async handleWebhookSync(webhookData) {
    console.log('[FolderSyncService] Webhook sync triggered:', webhookData);
    
    // Add small delay to avoid rapid successive calls
    if (this.lastSyncTime && (Date.now() - this.lastSyncTime.getTime()) < 30000) {
      console.log('[FolderSyncService] Webhook sync rate limited (30s), skipping...');
      return { status: 'rate_limited', reason: 'Too frequent' };
    }
    
    return await this.syncNow();
  }
  
  /**
   * Scheduled sync - run periodically
   */
  async scheduledSync() {
    console.log('[FolderSyncService] Scheduled sync triggered...');
    return await this.syncNow();
  }
  
  /**
   * Get sync status and statistics
   */
  async getSyncStatus() {
    try {
      const client = await pool.connect();
      
      try {
        const query = `
          SELECT 
            COUNT(*) as total_folders,
            MAX(synced_at) as last_sync,
            MIN(synced_at) as first_sync,
            COUNT(CASE WHEN synced_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_syncs
          FROM folders
        `;
        
        const result = await client.query(query);
        const stats = result.rows[0];
        
        return {
          status: 'active',
          isRunning: this.isRunning,
          lastSyncTime: this.lastSyncTime,
          database: {
            totalFolders: parseInt(stats.total_folders),
            lastSync: stats.last_sync,
            firstSync: stats.first_sync,
            recentSyncs: parseInt(stats.recent_syncs)
          },
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderSyncService] Error getting sync status:', error);
      return {
        status: 'error',
        error: error.message,
        isRunning: this.isRunning,
        lastSyncTime: this.lastSyncTime
      };
    }
  }
  
  /**
   * Start periodic sync (every X minutes)
   */
  startPeriodicSync(intervalMinutes = 60) {
    if (this.syncInterval) {
      console.log('[FolderSyncService] Periodic sync already running');
      return;
    }
    
    console.log(`[FolderSyncService] Starting periodic sync every ${intervalMinutes} minutes`);
    
    this.syncInterval = setInterval(async () => {
      try {
        await this.scheduledSync();
      } catch (error) {
        console.error('[FolderSyncService] Periodic sync error:', error);
      }
    }, intervalMinutes * 60 * 1000);
  }
  
  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[FolderSyncService] Periodic sync stopped');
    }
  }
  
  /**
   * Force full resync - truncate and rebuild
   */
  async forceFullResync() {
    console.log('[FolderSyncService] Starting force full resync...');
    
    if (this.isRunning) {
      throw new Error('Sync already running, cannot start full resync');
    }
    
    this.isRunning = true;
    
    try {
      // This will truncate and rebuild the entire folders table
      const result = await this.migrationService.syncFoldersFromDrive();
      this.lastSyncTime = new Date();
      
      console.log(`[FolderSyncService] ✅ Full resync completed: ${result.migrated} folders`);
      return result;
      
    } catch (error) {
      console.error('[FolderSyncService] Full resync failed:', error);
      return { status: 'failed', error: error.message };
    } finally {
      this.isRunning = false;
    }
  }
}

// Export singleton instance
const folderSyncService = new FolderSyncService();
module.exports = folderSyncService;
