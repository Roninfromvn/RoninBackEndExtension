// SwipeLinksService.js - Manage swipe links for stories
const { pool } = require('../db');

class SwipeLinksService {
  
  /**
   * Get random swipe link based on page's assigned categories
   * @param {string} date - Date for reference only (not used for filtering)
   * @param {string} pageId - Page ID (optional, for tracking usage and category filtering)
   * @param {string} category - Specific category filter (optional, overrides page categories)
   * @returns {Promise<Object|null>} Random swipe link
   */
  async getRandomSwipeLink(date, pageId = null, category = null) {
    try {
      const client = await pool.connect();
      
      try {
        // Determine categories to use
        let categoriesToUse = [];
        
        if (category) {
          // If specific category is provided, use only that
          categoriesToUse = [category];
        } else if (pageId) {
          // Get page's assigned categories
          const pageCategories = await this.getPageCategories(pageId);
          if (pageCategories.length > 0) {
            categoriesToUse = pageCategories;
          }
          // If no categories assigned to page, use all categories (random all)
        }
        
        // Build query based on categories
        let query = `
          SELECT 
            id, date, link, title, description, category, is_active, created_at, updated_at
          FROM swipe_links 
          WHERE is_active = true
        `;
        
        const params = [];
        
        if (categoriesToUse.length > 0) {
          // Filter by specific categories
          const placeholders = categoriesToUse.map((_, index) => `$${index + 1}`).join(',');
          query += ` AND category IN (${placeholders})`;
          params.push(...categoriesToUse);
        }
        
        query += ` ORDER BY RANDOM() LIMIT 1`;
        
        const result = await client.query(query, params);
        
        if (result.rows.length === 0) {
          const categoryInfo = category ? ` for category: ${category}` : 
                              (pageId && categoriesToUse.length > 0) ? ` for page categories: ${categoriesToUse.join(', ')}` : 
                              ' (no categories assigned to page)';
          console.log(`[SwipeLinksService] No active links found${categoryInfo}`);
          return null;
        }
        
        const swipeLink = result.rows[0];
        
        // Track usage if pageId provided
        if (pageId) {
          await this.trackUsage(swipeLink.id, pageId);
        }
        
        console.log(`[SwipeLinksService] Selected swipe link: ${swipeLink.title} (${swipeLink.link})`);
        return swipeLink;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting random swipe link:', error);
      throw error;
    }
  }
  
  /**
   * Get swipe link by ID
   * @param {number} id - Swipe link ID
   * @returns {Promise<Object|null>} Swipe link data
   */
  async getSwipeLinkById(id) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            id, date, link, title, description, category, is_active, created_at, updated_at
          FROM swipe_links 
          WHERE id = $1
        `, [id]);
        
        return result.rows.length > 0 ? result.rows[0] : null;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting swipe link by ID:', error);
      throw error;
    }
  }
  
  /**
   * Get all swipe links for a date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of swipe links
   */
  async getSwipeLinksByDateRange(startDate, endDate) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            id, date, link, title, description, category, is_active, created_at, updated_at
          FROM swipe_links 
          WHERE date >= $1 AND date <= $2
          ORDER BY date DESC, created_at DESC
        `, [startDate, endDate]);
        
        return result.rows;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting swipe links by date range:', error);
      throw error;
    }
  }
  
  /**
   * Create new swipe link
   * @param {Object} linkData - Link data
   * @returns {Promise<Object>} Created swipe link
   */
  async createSwipeLink(linkData) {
    try {
      const { date, link, title, description, category = 'general', is_active = true } = linkData;
      
      // Generate unique ID
      const id = `swipe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          INSERT INTO swipe_links (id, date, link, title, description, category, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, date, link, title, description, category, is_active, created_at, updated_at
        `, [id, date, link, title, description, category, is_active]);
        
        console.log(`[SwipeLinksService] Created swipe link: ${title} (${link}) with ID: ${id}`);
        return result.rows[0];
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error creating swipe link:', error);
      throw error;
    }
  }
  
  /**
   * Update swipe link
   * @param {number} id - Swipe link ID
   * @param {Object} updateData - Update data
   * @returns {Promise<Object>} Updated swipe link
   */
  async updateSwipeLink(id, updateData) {
    try {
      const { date, link, title, description, category, is_active } = updateData;
      
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          UPDATE swipe_links 
          SET 
            date = COALESCE($2, date),
            link = COALESCE($3, link),
            title = COALESCE($4, title),
            description = COALESCE($5, description),
            category = COALESCE($6, category),
            is_active = COALESCE($7, is_active),
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, date, link, title, description, category, is_active, created_at, updated_at
        `, [id, date, link, title, description, category, is_active]);
        
        if (result.rows.length === 0) {
          throw new Error(`Swipe link with ID ${id} not found`);
        }
        
        console.log(`[SwipeLinksService] Updated swipe link: ${result.rows[0].title}`);
        return result.rows[0];
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error updating swipe link:', error);
      throw error;
    }
  }
  
  /**
   * Delete swipe link
   * @param {number} id - Swipe link ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteSwipeLink(id) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          DELETE FROM swipe_links 
          WHERE id = $1
        `, [id]);
        
        const success = result.rowCount > 0;
        if (success) {
          console.log(`[SwipeLinksService] Deleted swipe link with ID: ${id}`);
        }
        
        return success;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error deleting swipe link:', error);
      throw error;
    }
  }
  
  /**
   * Track usage of a swipe link (for analytics and duplicate prevention)
   * @param {number} swipeLinkId - Swipe link ID
   * @param {string} pageId - Page ID that used the link
   * @param {string} storyId - Story ID (optional)
   * @param {boolean} success - Whether the story was posted successfully
   */
  async trackUsage(swipeLinkId, pageId, storyId = null, success = true) {
    try {
      const client = await pool.connect();
      
      try {
        // Insert usage record into swipe_link_usages table
        const result = await client.query(`
          INSERT INTO swipe_link_usages (swipe_link_id, page_id, story_id, success, used_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          RETURNING id
        `, [swipeLinkId, pageId, storyId, success]);
        
        console.log(`[SwipeLinksService] Tracked usage: Link ${swipeLinkId} used by page ${pageId}, story ${storyId}, success: ${success}, usage_id: ${result.rows[0].id}`);
        
        return result.rows[0].id;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error tracking usage:', error);
      // Don't throw error for tracking failures - just log and continue
      console.log(`[SwipeLinksService] Fallback logging: Link ${swipeLinkId} used by page ${pageId}, story ${storyId}, success: ${success}`);
    }
  }
  
  /**
   * Get all swipe links with filtering
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Array of swipe links
   */
  async getAllSwipeLinks(options = {}) {
    try {
      const { is_active, limit, offset, sort_by = 'date', sort_dir = 'desc' } = options;
      
      const client = await pool.connect();
      
      try {
        let query = `
          SELECT 
            id, date, link, title, description, category, is_active, created_at, updated_at
          FROM swipe_links 
        `;
        
        const params = [];
        const conditions = [];
        
        if (is_active !== undefined) {
          conditions.push(`is_active = $${params.length + 1}`);
          params.push(is_active);
        }
        
        if (conditions.length > 0) {
          query += `WHERE ${conditions.join(' AND ')} `;
        }
        
        // Validate sort_by and sort_dir
        const validSortFields = ['date', 'title', 'category', 'created_at'];
        const validSortDirs = ['asc', 'desc'];
        
        const sortField = validSortFields.includes(sort_by) ? sort_by : 'date';
        const sortDirection = validSortDirs.includes(sort_dir.toLowerCase()) ? sort_dir.toUpperCase() : 'DESC';
        
        query += `ORDER BY ${sortField} ${sortDirection}, created_at DESC `;
        
        if (limit) {
          query += `LIMIT $${params.length + 1} `;
          params.push(limit);
        }
        
        if (offset) {
          query += `OFFSET $${params.length + 1} `;
          params.push(offset);
        }
        
        const result = await client.query(query, params);
        return result.rows;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting all swipe links:', error);
      throw error;
    }
  }

  /**
   * Get categories assigned to a specific page
   * @param {string} pageId - Page ID
   * @returns {Promise<Array>} Array of category names
   */
  async getPageCategories(pageId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT category
          FROM page_swipe_categories 
          WHERE page_id = $1 AND is_active = true
          ORDER BY category
        `, [pageId]);
        
        return result.rows.map(row => row.category);
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting page categories:', error);
      // Return empty array if table doesn't exist yet
      return [];
    }
  }

  /**
   * Assign categories to a page
   * @param {string} pageId - Page ID
   * @param {Array} categories - Array of category names
   * @returns {Promise<Object>} Result
   */
  async assignCategoriesToPage(pageId, categories) {
    try {
      const client = await pool.connect();
      
      try {
        // Start transaction
        await client.query('BEGIN');
        
        // Remove existing assignments
        await client.query(`
          DELETE FROM page_swipe_categories 
          WHERE page_id = $1
        `, [pageId]);
        
        // Add new assignments
        for (const category of categories) {
          await client.query(`
            INSERT INTO page_swipe_categories (page_id, category, is_active)
            VALUES ($1, $2, true)
          `, [pageId, category]);
        }
        
        await client.query('COMMIT');
        
        console.log(`[SwipeLinksService] Assigned categories to page ${pageId}:`, categories);
        return { success: true, categories };
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error assigning categories to page:', error);
      throw error;
    }
  }

  /**
   * Get available categories
   * @returns {Promise<Array>} Array of categories
   */
  async getCategories() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            name, display_name, description, color, icon, sort_order
          FROM swipe_link_categories 
          WHERE is_active = true
          ORDER BY sort_order, display_name
        `);
        
        return result.rows;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting categories:', error);
      // Fallback to hardcoded categories if table doesn't exist
      return [
        { name: 'general', display_name: 'General', description: 'General purpose links', color: '#007bff', icon: 'link', sort_order: 0 },
        { name: 'fashion', display_name: 'Fashion', description: 'Fashion and style related links', color: '#e91e63', icon: 'shopping-bag', sort_order: 1 },
        { name: 'beauty', display_name: 'Beauty', description: 'Beauty and cosmetics links', color: '#9c27b0', icon: 'sparkles', sort_order: 2 },
        { name: 'lifestyle', display_name: 'Lifestyle', description: 'Lifestyle and wellness links', color: '#4caf50', icon: 'heart', sort_order: 3 },
        { name: 'food', display_name: 'Food & Drink', description: 'Food and beverage related links', color: '#ff9800', icon: 'utensils', sort_order: 4 },
        { name: 'travel', display_name: 'Travel', description: 'Travel and tourism links', color: '#2196f3', icon: 'plane', sort_order: 5 },
        { name: 'tech', display_name: 'Technology', description: 'Technology and gadgets links', color: '#607d8b', icon: 'laptop', sort_order: 6 },
        { name: 'fitness', display_name: 'Fitness', description: 'Fitness and health links', color: '#f44336', icon: 'dumbbell', sort_order: 7 },
        { name: 'entertainment', display_name: 'Entertainment', description: 'Entertainment and media links', color: '#ff5722', icon: 'play', sort_order: 8 },
        { name: 'education', display_name: 'Education', description: 'Educational content links', color: '#795548', icon: 'book', sort_order: 9 }
      ];
    }
  }

  /**
   * Get swipe links statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_links,
            COUNT(CASE WHEN is_active = true THEN 1 END) as active_links,
            COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_links,
            COUNT(CASE WHEN date = CURRENT_DATE THEN 1 END) as today_links,
            COUNT(CASE WHEN date >= CURRENT_DATE THEN 1 END) as future_links
          FROM swipe_links
        `);
        
        return result.rows[0];
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics for swipe links
   * @returns {Promise<Array>} Array of usage statistics
   */
  async getUsageStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            sl.id as swipe_link_id,
            sl.title,
            sl.category,
            COUNT(usg.id) as total_usage,
            COUNT(CASE WHEN usg.success = true THEN 1 END) as successful_usage,
            COUNT(CASE WHEN usg.success = false THEN 1 END) as failed_usage,
            MAX(usg.used_at) as last_used_at,
            MIN(usg.used_at) as first_used_at
          FROM swipe_links sl
          LEFT JOIN swipe_link_usages usg ON sl.id = usg.swipe_link_id
          GROUP BY sl.id, sl.title, sl.category
          ORDER BY total_usage DESC
        `);
        
        return result.rows;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[SwipeLinksService] Error getting usage stats:', error);
      throw error;
    }
  }
}

module.exports = SwipeLinksService;
