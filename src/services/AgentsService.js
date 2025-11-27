/**
 * AgentsService - PostgreSQL service for agents management
 * 
 * Matches the actual PostgreSQL schema:
 * - agent_id (VARCHAR, PRIMARY KEY)
 * - agent_label (VARCHAR)
 * - ext_version (VARCHAR)
 * - pages (JSONB)
 * - last_seen (TIMESTAMP)
 * - created_at (TIMESTAMP)
 * - updated_at (TIMESTAMP)
 */

const { pool } = require('../db');

class AgentsService {
  constructor() {
    console.log('[AgentsService] Initialized');
  }
  
  /**
   * Create a new agent
   * @param {Object} agentData - Agent data
   * @returns {Promise<Object>} Created agent
   */
  async createAgent(agentData) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          INSERT INTO agents (
            agent_id, 
            agent_label, 
            ext_version, 
            pages,
            last_seen,
            created_at
          )
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *
        `, [
          agentData.agentId || `agent_${Date.now()}`,
          agentData.name || agentData.agentLabel || 'Unnamed Agent',
          agentData.version || agentData.extVersion || '1.0.0',
          JSON.stringify(agentData.pages || [])
        ]);
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          agentLabel: row.agent_label,
          extVersion: row.ext_version,
          pages: row.pages,
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AgentsService] Error creating agent:', error);
      throw error;
    }
  }
  
  /**
   * Get all agents
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of agents
   */
  async getAllAgents(options = {}) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            agent_id,
            agent_label,
            ext_version,
            pages,
            last_seen,
            created_at,
            updated_at
          FROM agents
          ORDER BY last_seen DESC
        `);
        
        return result.rows.map(row => ({
          agentId: row.agent_id,
          agentLabel: row.agent_label,
          extVersion: row.ext_version,
          pages: row.pages,
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AgentsService] Error getting all agents:', error);
      throw error;
    }
  }
  
  /**
   * Get agent by ID
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object|null>} Agent or null
   */
  async getAgent(agentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            agent_id,
            agent_label,
            ext_version,
            pages,
            last_seen,
            created_at,
            updated_at
          FROM agents
          WHERE agent_id = $1
        `, [agentId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          agentLabel: row.agent_label,
          extVersion: row.ext_version,
          pages: row.pages,
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AgentsService] Error getting agent ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Update agent
   * @param {string} agentId - Agent ID
   * @param {Object} updates - Update data
   * @returns {Promise<Object>} Updated agent
   */
  async updateAgent(agentId, updates) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          UPDATE agents 
          SET 
            agent_label = COALESCE($1, agent_label),
            ext_version = COALESCE($2, ext_version),
            pages = COALESCE($3, pages),
            last_seen = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE agent_id = $4
          RETURNING *
        `, [
          updates.name || updates.agentLabel,
          updates.version || updates.extVersion,
          updates.pages ? JSON.stringify(updates.pages) : null,
          agentId
        ]);
        
        if (result.rows.length === 0) {
          throw new Error(`Agent ${agentId} not found`);
        }
        
        const row = result.rows[0];
        return {
          agentId: row.agent_id,
          agentLabel: row.agent_label,
          extVersion: row.ext_version,
          pages: row.pages,
          lastSeen: row.last_seen,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AgentsService] Error updating agent ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteAgent(agentId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          DELETE FROM agents WHERE agent_id = $1
        `, [agentId]);
        
        return result.rowCount > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error(`[AgentsService] Error deleting agent ${agentId}:`, error);
      return false;
    }
  }
  
  /**
   * Update agent status (last seen)
   * @param {string} agentId - Agent ID
   * @param {string} status - New status (ignored, just updates last_seen)
   * @param {Object} statusData - Additional status data
   * @returns {Promise<Object>} Updated agent
   */
  async updateAgentStatus(agentId, status, statusData = {}) {
    try {
      return await this.updateAgent(agentId, statusData);
    } catch (error) {
      console.error(`[AgentsService] Error updating agent status ${agentId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get agents statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_agents,
            COUNT(CASE WHEN last_seen > NOW() - INTERVAL '1 hour' THEN 1 END) as active_agents,
            COUNT(CASE WHEN last_seen <= NOW() - INTERVAL '1 hour' THEN 1 END) as inactive_agents,
            MAX(last_seen) as last_activity,
            MIN(created_at) as first_created
          FROM agents
        `);
        
        const stats = result.rows[0];
        
        return {
          totalAgents: parseInt(stats.total_agents),
          activeAgents: parseInt(stats.active_agents),
          inactiveAgents: parseInt(stats.inactive_agents),
          lastActivity: stats.last_activity,
          firstCreated: stats.first_created,
          timestamp: new Date().toISOString()
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[AgentsService] Error getting stats:', error);
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
        return await self.createAgent(data);
      },
      
      async where(field, operator, value) {
        // Simplified - just return all agents for now
        return {
          async get() {
            const agents = await self.getAllAgents();
            return {
              empty: agents.length === 0,
              size: agents.length,
              docs: agents.map(agent => ({
                id: agent.agentId,
                data: () => {
                  const { agentId, ...data } = agent;
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
            const agent = await self.getAgent(agentId);
            return {
              exists: agent !== null,
              data: () => {
                if (!agent) return null;
                const { agentId: _, ...data } = agent;
                return data;
              },
              id: agentId
            };
          },
          
          async set(data) {
            const existing = await self.getAgent(agentId);
            if (existing) {
              return await self.updateAgent(agentId, data);
            } else {
              return await self.createAgent({ ...data, agentId });
            }
          },
          
          async update(updates) {
            return await self.updateAgent(agentId, updates);
          },
          
          async delete() {
            return await self.deleteAgent(agentId);
          }
        };
      }
    };
  }
}

// Export singleton instance
const agentsService = new AgentsService();
module.exports = agentsService;