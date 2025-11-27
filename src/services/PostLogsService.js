/**
 * PostLogsService - PostgreSQL service for post logs
 * 
 * Matches the actual PostgreSQL schema:
 * - id (VARCHAR, PRIMARY KEY)
 * - page_id (VARCHAR, NOT NULL)
 * - status (VARCHAR, NOT NULL)
 * - file_id (VARCHAR)
 * - file_name (VARCHAR)
 * - folder_id (VARCHAR)
 * - caption (TEXT)
 * - facebook_post_id (VARCHAR)
 * - error_message (TEXT)
 * - started_at (TIMESTAMP)
 * - completed_at (TIMESTAMP)
 * - duration_ms (INTEGER)
 * - file_size_bytes (BIGINT)
 * - created_at (TIMESTAMP)
 */

const { pool } = require('../db');

class PostLogsService {
  constructor() {
    console.log('[PostLogsService] Initialized');
  }
  
  /**
   * Create a new post log
   * @param {Object} logData - Post log data
   * @returns {Promise<Object>} Created log
   */
  async createLog(logData) {
    try {
      const client = await pool.connect();
      
      try {
        const logId = logData.id || `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result = await client.query(`
          INSERT INTO post_logs (
            id,
            page_id, 
            status, 
            file_id,
            file_name,
            folder_id,
            caption,
            facebook_post_id,
            error_message,
            started_at,
            completed_at,
            duration_ms,
            file_size_bytes,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
          RETURNING *
        `, [
          logId,
          logData.pageId,
          logData.status || 'pending',
          logData.fileId || null,
          logData.fileName || null,
          logData.folderId || null,
          logData.caption || null,
          logData.facebookPostId || logData.postId || null,
          logData.error || logData.errorMessage || null,
          logData.startedAt || null,
          logData.completedAt || logData.finishedAt || null,
          logData.durationMs || null,
          logData.fileSizeBytes || null
        ]);
        
        const row = result.rows[0];
        return {
          id: row.id,
          pageId: row.page_id,
          status: row.status,
          fileId: row.file_id,
          fileName: row.file_name,
          folderId: row.folder_id,
          caption: row.caption,
          facebookPostId: row.facebook_post_id,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          durationMs: row.duration_ms,
          fileSizeBytes: row.file_size_bytes,
          createdAt: row.created_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PostLogsService] Error creating log:', error);
      throw error;
    }
  }
  
  /**
   * Get post logs with filtering
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of post logs
   */
  async getLogs(options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let query = `
          SELECT 
            id, 
            page_id, 
            status, 
            file_id,
            file_name,
            folder_id,
            caption,
            facebook_post_id,
            error_message,
            started_at,
            completed_at,
            duration_ms,
            file_size_bytes,
            created_at
          FROM post_logs
          WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        // Add filters
        if (options.pageId) {
          paramCount++;
          query += ` AND page_id = $${paramCount}`;
          params.push(options.pageId);
        }
        
        if (options.status) {
          paramCount++;
          query += ` AND status = $${paramCount}`;
          params.push(options.status);
        }
        
        if (options.startDate) {
          paramCount++;
          query += ` AND created_at >= $${paramCount}`;
          params.push(options.startDate);
        }
        
        if (options.endDate) {
          paramCount++;
          query += ` AND created_at <= $${paramCount}`;
          params.push(options.endDate);
        }
        
        // Add ordering and limit
        query += ` ORDER BY created_at DESC`;
        
        if (options.limit) {
          paramCount++;
          query += ` LIMIT $${paramCount}`;
          params.push(options.limit);
        }
        
        const result = await client.query(query, params);
        
        return result.rows.map(row => ({
          id: row.id,
          pageId: row.page_id,
          status: row.status,
          fileId: row.file_id,
          fileName: row.file_name,
          folderId: row.folder_id,
          caption: row.caption,
          facebookPostId: row.facebook_post_id,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          durationMs: row.duration_ms,
          fileSizeBytes: row.file_size_bytes,
          createdAt: row.created_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PostLogsService] Error getting logs:', error);
      throw error;
    }
  }
  
  /**
   * Get a specific post log by ID
   * @param {string} logId - Log ID
   * @returns {Promise<Object|null>} Post log or null
   */
  async getLog(logId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            id, 
            page_id, 
            status, 
            file_id,
            file_name,
            folder_id,
            caption,
            facebook_post_id,
            error_message,
            started_at,
            completed_at,
            duration_ms,
            file_size_bytes,
            created_at
          FROM post_logs
          WHERE id = $1
        `, [logId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          id: row.id,
          pageId: row.page_id,
          status: row.status,
          fileId: row.file_id,
          fileName: row.file_name,
          folderId: row.folder_id,
          caption: row.caption,
          facebookPostId: row.facebook_post_id,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          durationMs: row.duration_ms,
          fileSizeBytes: row.file_size_bytes,
          createdAt: row.created_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[PostLogsService] Error getting log ${logId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update post log status
   * @param {string} logId - Log ID
   * @param {string} status - New status
   * @param {Object} additionalData - Additional data to update
   * @returns {Promise<Object>} Updated log
   */
  async updateLogStatus(logId, status, additionalData = {}) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          UPDATE post_logs 
          SET 
            status = $1,
            error_message = COALESCE($2, error_message),
            completed_at = COALESCE($3, completed_at),
            duration_ms = COALESCE($4, duration_ms),
            facebook_post_id = COALESCE($5, facebook_post_id)
          WHERE id = $6
          RETURNING *
        `, [
          status,
          additionalData.errorMessage || additionalData.error || null,
          additionalData.completedAt || additionalData.finishedAt || null,
          additionalData.durationMs || null,
          additionalData.facebookPostId || additionalData.postId || null,
          logId
        ]);
        
        if (result.rows.length === 0) {
          throw new Error(`Log ${logId} not found`);
        }
        
        const row = result.rows[0];
        return {
          id: row.id,
          pageId: row.page_id,
          status: row.status,
          fileId: row.file_id,
          fileName: row.file_name,
          folderId: row.folder_id,
          caption: row.caption,
          facebookPostId: row.facebook_post_id,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          durationMs: row.duration_ms,
          fileSizeBytes: row.file_size_bytes,
          createdAt: row.created_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[PostLogsService] Error updating log ${logId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get post logs statistics
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Statistics
   */
  async getStats(options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let query = `
          SELECT 
            COUNT(*) as total_logs,
            COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_posts,
            COUNT(CASE WHEN status = 'failed' OR status = 'error' THEN 1 END) as failed_posts,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_posts,
            MAX(created_at) as last_post,
            MIN(created_at) as first_post,
            AVG(duration_ms) as avg_duration_ms
          FROM post_logs
          WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        if (options.pageId) {
          paramCount++;
          query += ` AND page_id = $${paramCount}`;
          params.push(options.pageId);
        }
        
        if (options.startDate) {
          paramCount++;
          query += ` AND created_at >= $${paramCount}`;
          params.push(options.startDate);
        }
        
        if (options.endDate) {
          paramCount++;
          query += ` AND created_at <= $${paramCount}`;
          params.push(options.endDate);
        }
        
        const result = await client.query(query, params);
        const stats = result.rows[0];
        
        return {
          totalLogs: parseInt(stats.total_logs),
          successfulPosts: parseInt(stats.successful_posts),
          failedPosts: parseInt(stats.failed_posts),
          pendingPosts: parseInt(stats.pending_posts),
          successRate: stats.total_logs > 0 ? (stats.successful_posts / stats.total_logs * 100).toFixed(2) : 0,
          avgDurationMs: stats.avg_duration_ms ? parseFloat(stats.avg_duration_ms).toFixed(2) : null,
          lastPost: stats.last_post,
          firstPost: stats.first_post,
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PostLogsService] Error getting stats:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Get recent files used by a page
   * @param {string} pageId - Page ID
   * @param {Date} cutoff - Cutoff date
   * @returns {Promise<Array>} Recent files
   */
  async getRecentFiles(pageId, cutoff) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT DISTINCT file_id
          FROM post_logs
          WHERE page_id = $1 
            AND (status = 'success' OR status = 'file_used')
            AND completed_at >= $2
            AND file_id IS NOT NULL
        `, [pageId, cutoff]);
        
        return result.rows.map(row => ({ fileId: row.file_id }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PostLogsService] Error getting recent files:', error);
      return [];
    }
  }

  /**
   * Mark a file as used
   * @param {string} pageId - Page ID
   * @param {string} fileId - File ID
   * @returns {Promise<void>}
   */
  async markFileUsed(pageId, fileId) {
    try {
      const client = await pool.connect();
      
      try {
        // Insert a usage record (we can use post_logs table for this)
        await client.query(`
          INSERT INTO post_logs (
            id, page_id, status, file_id, completed_at, created_at
          ) VALUES (
            $1, $2, 'file_used', $3, NOW(), NOW()
          )
          ON CONFLICT (id) DO NOTHING
        `, [`used_${pageId}_${fileId}_${Date.now()}`, pageId, fileId]);
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[PostLogsService] Error marking file as used:', error);
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
      async add(data) {
        return await self.createLog(data);
      },
      
      async where(field, operator, value) {
        const options = {};
        
        if (field === 'pageId' && operator === '==') {
          options.pageId = value;
        } else if (field === 'status' && operator === '==') {
          options.status = value;
        } else {
          throw new Error(`Unsupported query: ${field} ${operator} ${value}`);
        }
        
        return {
          async get() {
            const logs = await self.getLogs(options);
            return {
              empty: logs.length === 0,
              size: logs.length,
              docs: logs.map(log => ({
                id: log.id,
                data: () => {
                  const { id, ...data } = log;
                  return data;
                }
              }))
            };
          }
        };
      },
      
      doc(logId) {
        return {
          async get() {
            const log = await self.getLog(logId);
            return {
              exists: log !== null,
              data: () => {
                if (!log) return null;
                const { id, ...data } = log;
                return data;
              },
              id: logId
            };
          },
          
          async set(data) {
            if (logId) {
              throw new Error('Cannot set existing log, use update instead');
            }
            return await self.createLog(data);
          },
          
          async update(updates) {
            return await self.updateLogStatus(logId, updates.status, updates);
          }
        };
      }
    };
  }
}

// Export singleton instance
const postLogsService = new PostLogsService();
module.exports = postLogsService;