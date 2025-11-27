/**
 * PageConfigsService - PostgreSQL service for page configurations
 * 
 * Matches the actual PostgreSQL schema:
 * - page_id (VARCHAR, PRIMARY KEY)
 * - enabled (BOOLEAN)
 * - folder_ids (JSONB)
 * - schedule (JSONB)
 * - posts_per_slot (INTEGER)
 * - default_caption (TEXT)
 * - caption_by_folder (JSONB)
 * - created_at (TIMESTAMP)
 * - updated_at (TIMESTAMP)
 */

const { pool } = require('../db');

class PageConfigsService {
  constructor() {
    console.log('[PageConfigsService] Initialized');
  }
  
  /**
   * Get all page configurations
   * @returns {Promise<Array>} Array of page configs
   */
  async getAllConfigs() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            page_id,
            enabled,
            folder_ids,
            schedule,
            posts_per_slot,
            default_caption,
            caption_by_folder,
            created_at,
            updated_at
          FROM page_configs 
          ORDER BY updated_at DESC
        `);
        
        return result.rows.map(row => ({
          pageId: row.page_id,
          enabled: row.enabled,
          folderIds: row.folder_ids,
          schedule: row.schedule,
          postsPerSlot: row.posts_per_slot,
          defaultCaption: row.default_caption,
          captionByFolder: row.caption_by_folder,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PageConfigsService] Error getting all configs:', error);
      throw error;
    }
  }
  
  /**
   * Get page configuration by page ID
   * @param {string} pageId - Page ID
   * @returns {Promise<Object|null>} Page config or null
   */
  async getConfig(pageId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            page_id,
            enabled,
            folder_ids,
            schedule,
            posts_per_slot,
            default_caption,
            caption_by_folder,
            created_at,
            updated_at
          FROM page_configs 
          WHERE page_id = $1
        `, [pageId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          pageId: row.page_id,
          enabled: row.enabled,
          folderIds: row.folder_ids,
          schedule: row.schedule,
          postsPerSlot: row.posts_per_slot,
          defaultCaption: row.default_caption,
          captionByFolder: row.caption_by_folder,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[PageConfigsService] Error getting config for page ${pageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Set/Update page configuration
   * @param {string} pageId - Page ID
   * @param {Object} config - Configuration data
   * @param {Object} options - Options (merge, etc.)
   * @returns {Promise<Object>} Updated config
   */
  async setConfig(pageId, config, options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let finalConfig = config;
        
        // Handle merge option
        if (options.merge) {
          const existingConfig = await this.getConfig(pageId);
          if (existingConfig) {
            finalConfig = { 
              enabled: existingConfig.enabled,
              folderIds: existingConfig.folderIds,
              schedule: existingConfig.schedule,
              postsPerSlot: existingConfig.postsPerSlot,
              defaultCaption: existingConfig.defaultCaption,
              captionByFolder: existingConfig.captionByFolder,
              ...config 
            };
          }
        }
        
        const result = await client.query(`
          INSERT INTO page_configs (
            page_id, 
            enabled, 
            folder_ids, 
            schedule, 
            posts_per_slot, 
            default_caption, 
            caption_by_folder,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT (page_id) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            folder_ids = EXCLUDED.folder_ids,
            schedule = EXCLUDED.schedule,
            posts_per_slot = EXCLUDED.posts_per_slot,
            default_caption = EXCLUDED.default_caption,
            caption_by_folder = EXCLUDED.caption_by_folder,
            updated_at = CURRENT_TIMESTAMP
          RETURNING 
            page_id,
            enabled,
            folder_ids,
            schedule,
            posts_per_slot,
            default_caption,
            caption_by_folder,
            created_at,
            updated_at
        `, [
          pageId,
          finalConfig.enabled !== undefined ? finalConfig.enabled : true,
          JSON.stringify(finalConfig.folder_ids || finalConfig.folderIds || []),
          JSON.stringify(finalConfig.schedule || []),
          finalConfig.posts_per_slot || finalConfig.postsPerSlot || 1,
          finalConfig.default_caption || finalConfig.defaultCaption || '',
          JSON.stringify(finalConfig.caption_by_folder || finalConfig.captionByFolder || {})
        ]);
        
        const row = result.rows[0];
        return {
          pageId: row.page_id,
          enabled: row.enabled,
          folderIds: row.folder_ids,
          schedule: row.schedule,
          postsPerSlot: row.posts_per_slot,
          defaultCaption: row.default_caption,
          captionByFolder: row.caption_by_folder,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[PageConfigsService] Error setting config for page ${pageId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update specific fields in page configuration
   * @param {string} pageId - Page ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated config
   */
  async updateConfig(pageId, updates) {
    return await this.setConfig(pageId, updates, { merge: true });
  }
  
  /**
   * Delete page configuration
   * @param {string} pageId - Page ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteConfig(pageId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          DELETE FROM page_configs WHERE page_id = $1
        `, [pageId]);
        
        return result.rowCount > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[PageConfigsService] Error deleting config for page ${pageId}:`, error);
      return false;
    }
  }
  
  /**
   * Get enabled page configurations (for scheduler)
   * @returns {Promise<Array>} Array of enabled page configs
   */
  async getEnabledConfigs() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            page_id,
            enabled,
            folder_ids,
            schedule,
            posts_per_slot,
            default_caption,
            caption_by_folder,
            created_at,
            updated_at
          FROM page_configs 
          WHERE enabled = true
          ORDER BY updated_at DESC
        `);
        
        return result.rows.map(row => ({
          pageId: row.page_id,
          enabled: row.enabled,
          folderIds: row.folder_ids,
          schedule: row.schedule,
          postsPerSlot: row.posts_per_slot,
          defaultCaption: row.default_caption,
          captionByFolder: row.caption_by_folder,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PageConfigsService] Error getting enabled configs:', error);
      throw error;
    }
  }
  
  /**
   * Firestore-compatible collection API
   * @returns {Object} Collection-like object
   */
  collection() {
    const self = this;
    
    return {
      async where(field, operator, value) {
        if (field === 'enabled' && operator === '==' && value === true) {
          return {
            async get() {
              const configs = await self.getEnabledConfigs();
              return {
                empty: configs.length === 0,
                size: configs.length,
                docs: configs.map(config => ({
                  id: config.pageId,
                  data: () => {
                    const { pageId, createdAt, updatedAt, ...data } = config;
                    return data;
                  }
                }))
              };
            }
          };
        }
        throw new Error(`Unsupported query: ${field} ${operator} ${value}`);
      },
      
      doc(pageId) {
        return {
          async get() {
            const config = await self.getConfig(pageId);
            return {
              exists: config !== null,
              data: () => {
                if (!config) return null;
                const { pageId: _, createdAt, updatedAt, ...data } = config;
                return data;
              },
              id: pageId
            };
          },
          
          async set(data, options = {}) {
            return await self.setConfig(pageId, data, options);
          },
          
          async update(updates) {
            return await self.updateConfig(pageId, updates);
          },
          
          async delete() {
            return await self.deleteConfig(pageId);
          }
        };
      }
    };
  }
  
  /**
   * Get statistics about page configurations
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_configs,
            COUNT(CASE WHEN enabled = true THEN 1 END) as enabled_configs,
            MAX(updated_at) as last_updated,
            MIN(created_at) as first_created
          FROM page_configs
        `);
        
        const stats = result.rows[0];
        
        return {
          totalConfigs: parseInt(stats.total_configs),
          enabledConfigs: parseInt(stats.enabled_configs),
          lastUpdated: stats.last_updated,
          firstCreated: stats.first_created,
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PageConfigsService] Error getting stats:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
const pageConfigsService = new PageConfigsService();
module.exports = pageConfigsService;