/**
 * AssignmentsService - PostgreSQL service for assignments management
 * 
 * Matches the actual PostgreSQL schema:
 * - agent_id (VARCHAR, PRIMARY KEY)
 * - allowed_pages (JSONB)
 * - created_at (TIMESTAMP)
 * - updated_at (TIMESTAMP)
 */

const { pool } = require('../db');

class AssignmentsService {
  constructor() {
    console.log('[AssignmentsService] Initialized');
  }
  
  /**
   * Create a new assignment (agent-page mapping)
   * @param {Object} assignmentData - Assignment data
   * @returns {Promise<Object>} Created assignment
   */
  async createAssignment(assignmentData) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          INSERT INTO assignments (
            agent_id, 
            allowed_pages,
            created_at
          )
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (agent_id) DO UPDATE SET
            allowed_pages = EXCLUDED.allowed_pages,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `, [
          assignmentData.agentId,
          JSON.stringify(assignmentData.allowedPages || [assignmentData.pageId] || [])
        ]);
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          allowedPages: row.allowed_pages,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AssignmentsService] Error creating assignment:', error);
      throw error;
    }
  }
  
  /**
   * Get assignments with filtering
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of assignments
   */
  async getAssignments(options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let query = `
          SELECT 
            agent_id,
            allowed_pages,
            created_at,
            updated_at
          FROM assignments
          WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        if (options.agentId) {
          paramCount++;
          query += ` AND agent_id = $${paramCount}`;
          params.push(options.agentId);
        }
        
        query += ` ORDER BY updated_at DESC`;
        
        if (options.limit) {
          paramCount++;
          query += ` LIMIT $${paramCount}`;
          params.push(options.limit);
        }
        
        const result = await client.query(query, params);
        
        return result.rows.map(row => ({
          agentId: row.agent_id,
          allowedPages: row.allowed_pages,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AssignmentsService] Error getting assignments:', error);
      throw error;
    }
  }
  
  /**
   * Get assignment by agent ID
   * @param {string} agentId - Agent ID (used as assignment ID)
   * @returns {Promise<Object|null>} Assignment or null
   */
  async getAssignment(agentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            agent_id,
            allowed_pages,
            created_at,
            updated_at
          FROM assignments
          WHERE agent_id = $1
        `, [agentId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          allowedPages: row.allowed_pages,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AssignmentsService] Error getting assignment ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update assignment
   * @param {string} agentId - Agent ID (assignment ID)
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated assignment
   */
  async updateAssignment(agentId, updates) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          UPDATE assignments 
          SET 
            allowed_pages = COALESCE($1, allowed_pages),
            updated_at = CURRENT_TIMESTAMP
          WHERE agent_id = $2
          RETURNING *
        `, [
          updates.allowedPages ? JSON.stringify(updates.allowedPages) : null,
          agentId
        ]);
        
        if (result.rows.length === 0) {
          throw new Error(`Assignment ${agentId} not found`);
        }
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          allowedPages: row.allowed_pages,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AssignmentsService] Error updating assignment ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete assignment
   * @param {string} agentId - Agent ID (assignment ID)
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteAssignment(agentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          DELETE FROM assignments WHERE agent_id = $1
        `, [agentId]);
        
        return result.rowCount > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AssignmentsService] Error deleting assignment ${agentId}:`, error);
      return false;
    }
  }
  
  /**
   * Get pending assignments for an agent (simplified - just return allowed pages)
   * @param {string} agentId - Agent ID
   * @returns {Promise<Array>} Array of assignments (simplified)
   */
  async getPendingAssignments(agentId) {
    const assignment = await this.getAssignment(agentId);
    if (!assignment) return [];
    
    return [{
      agentId: assignment.agentId,
      status: 'pending',
      allowedPages: assignment.allowedPages,
      data: { type: 'page_access' }
    }];
  }
  
  /**
   * Get assignments statistics
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Statistics
   */
  async getStats(options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        let query = `
          SELECT 
            COUNT(*) as total_assignments,
            COUNT(CASE WHEN jsonb_array_length(allowed_pages) > 0 THEN 1 END) as active_assignments,
            MAX(updated_at) as last_updated,
            MIN(created_at) as first_created
          FROM assignments
          WHERE 1=1
        `;
        const params = [];
        let paramCount = 0;
        
        if (options.agentId) {
          paramCount++;
          query += ` AND agent_id = $${paramCount}`;
          params.push(options.agentId);
        }
        
        const result = await client.query(query, params);
        const stats = result.rows[0];
        
        return {
          totalAssignments: parseInt(stats.total_assignments),
          activeAssignments: parseInt(stats.active_assignments),
          completionRate: stats.total_assignments > 0 ? (stats.active_assignments / stats.total_assignments * 100).toFixed(2) : 0,
          lastUpdated: stats.last_updated,
          firstCreated: stats.first_created,
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AssignmentsService] Error getting stats:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
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
        return await self.createAssignment(data);
      },
      
      async where(field, operator, value) {
        const options = {};
        
        if (field === 'agentId' && operator === '==') {
          options.agentId = value;
        }
        
        return {
          async get() {
            const assignments = await self.getAssignments(options);
            return {
              empty: assignments.length === 0,
              size: assignments.length,
              docs: assignments.map(assignment => ({
                id: assignment.agentId,
                data: () => {
                  const { agentId, ...data } = assignment;
                  return data;
                }
              }))
            };
          }
        };
      },
      
      doc(agentId) {
        return {
          async get() {
            const assignment = await self.getAssignment(agentId);
            return {
              exists: assignment !== null,
              data: () => {
                if (!assignment) return null;
                const { agentId: _, ...data } = assignment;
                return data;
              },
              id: agentId
            };
          },
          
          async set(data) {
            const existing = await self.getAssignment(agentId);
            if (existing) {
              return await self.updateAssignment(agentId, data);
            } else {
              return await self.createAssignment({ ...data, agentId });
            }
          },
          
          async update(updates) {
            return await self.updateAssignment(agentId, updates);
          },
          
          async delete() {
            return await self.deleteAssignment(agentId);
          }
        };
      }
    };
  }
}

// Export singleton instance
const assignmentsService = new AssignmentsService();
module.exports = assignmentsService;