/**
 * SystemStateService - PostgreSQL replacement for Firestore sys_state collection
 * 
 * Features:
 * - Document-based API (similar to Firestore)
 * - Optimistic locking for race condition prevention
 * - Atomic updates
 * - Backward compatible with existing code
 */

const { pool } = require('../db');

class SystemStateService {
  constructor() {
    console.log('[SystemStateService] Initialized');
  }
  
  /**
   * Get a system state document
   * @param {string} documentId - Document ID (e.g., 'manifest_state', 'queue_status')
   * @returns {Promise<Object>} Document data
   */
  async getDocument(documentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(
          'SELECT get_system_state($1) as data',
          [documentId]
        );
        
        return result.rows[0].data || {};
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[SystemStateService] Error getting document ${documentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Set/Update a system state document
   * @param {string} documentId - Document ID
   * @param {Object} data - Document data
   * @param {Object} options - Options (merge, version)
   * @returns {Promise<Object>} Updated document
   */
  async setDocument(documentId, data, options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let finalData = data;
        
        // Handle merge option (similar to Firestore)
        if (options.merge) {
          const existingData = await this.getDocument(documentId);
          finalData = { ...existingData, ...data };
        }
        
        // Add timestamp
        finalData.lastUpdated = new Date().toISOString();
        
        let result;
        
        if (options.version !== undefined) {
          // Atomic update with optimistic locking
          result = await client.query(
            'SELECT atomic_update_system_state($1, $2, $3) as doc',
            [documentId, JSON.stringify(finalData), options.version]
          );
        } else {
          // Regular upsert
          result = await client.query(
            'SELECT upsert_system_state($1, $2) as doc',
            [documentId, JSON.stringify(finalData)]
          );
        }
        
        const doc = result.rows[0].doc;
        return {
          id: doc.document_id,
          data: doc.data,
          version: doc.version,
          updatedAt: doc.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[SystemStateService] Error setting document ${documentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update specific fields in a document (merge by default)
   * @param {string} documentId - Document ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated document
   */
  async updateDocument(documentId, updates) {
    return await this.setDocument(documentId, updates, { merge: true });
  }
  
  /**
   * Check if document exists
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} True if exists
   */
  async documentExists(documentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(
          'SELECT COUNT(*) as count FROM system_state WHERE document_id = $1',
          [documentId]
        );
        
        return parseInt(result.rows[0].count) > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[SystemStateService] Error checking document ${documentId}:`, error);
      return false;
    }
  }
  
  /**
   * Delete a document
   * @param {string} documentId - Document ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteDocument(documentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(
          'DELETE FROM system_state WHERE document_id = $1',
          [documentId]
        );
        
        return result.rowCount > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[SystemStateService] Error deleting document ${documentId}:`, error);
      return false;
    }
  }
  
  /**
   * List all documents
   * @returns {Promise<Array>} Array of documents
   */
  async listDocuments() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(
          'SELECT document_id, data, created_at, updated_at, version FROM system_state ORDER BY document_id'
        );
        
        return result.rows.map(row => ({
          id: row.document_id,
          data: row.data,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          version: row.version
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SystemStateService] Error listing documents:', error);
      return [];
    }
  }
  
  /**
   * Firestore-compatible API: doc().get()
   * @param {string} documentId - Document ID
   * @returns {Promise<Object>} Firestore-like document object
   */
  async doc(documentId) {
    const self = this;
    
    return {
      async get() {
        const data = await self.getDocument(documentId);
        const exists = Object.keys(data).length > 0;
        
        return {
          exists,
          data: () => data,
          id: documentId
        };
      },
      
      async set(data, options = {}) {
        return await self.setDocument(documentId, data, options);
      },
      
      async update(updates) {
        return await self.updateDocument(documentId, updates);
      },
      
      async delete() {
        return await self.deleteDocument(documentId);
      }
    };
  }
  
  /**
   * Get statistics about system state
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_documents,
            MAX(updated_at) as last_updated,
            MIN(created_at) as first_created,
            COUNT(CASE WHEN updated_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_updates
          FROM system_state
        `);
        
        const stats = result.rows[0];
        
        return {
          totalDocuments: parseInt(stats.total_documents),
          lastUpdated: stats.last_updated,
          firstCreated: stats.first_created,
          recentUpdates: parseInt(stats.recent_updates),
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SystemStateService] Error getting stats:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
const systemStateService = new SystemStateService();
module.exports = systemStateService;
