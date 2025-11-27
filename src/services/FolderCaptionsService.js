// FolderCaptionsService.js - Manage folder captions in PostgreSQL
const { pool } = require('../db');
const SystemStateService = require('./SystemStateService');

class FolderCaptionsService {
  
  /**
   * Get captions for a specific folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<Object|null>} Folder captions data
   */
  async getFolderCaptions(folderId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            folder_id,
            folder_name,
            captions,
            created_at,
            updated_at
          FROM folder_captions 
          WHERE folder_id = $1
        `, [folderId]);
        
        if (result.rows.length === 0) {
          return null;
        }
        
        const row = result.rows[0];
        return {
          folderId: row.folder_id,
          folderName: row.folder_name,
          captions: row.captions || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error getting folder captions:', error);
      throw error;
    }
  }
  
  /**
   * Set/Update captions for a folder
   * @param {string} folderId - Folder ID
   * @param {Array} captions - Array of caption strings
   * @param {string} folderName - Folder name (optional)
   * @returns {Promise<Object>} Updated folder captions
   */
  async setFolderCaptions(folderId, captions, folderName = '') {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          INSERT INTO folder_captions (
            folder_id, 
            folder_name,
            captions,
            updated_at
          )
          VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT (folder_id) DO UPDATE SET
            folder_name = EXCLUDED.folder_name,
            captions = EXCLUDED.captions,
            updated_at = CURRENT_TIMESTAMP
          RETURNING 
            folder_id,
            folder_name,
            captions,
            created_at,
            updated_at
        `, [
          folderId,
          folderName,
          JSON.stringify(captions || [])
        ]);
        
        const row = result.rows[0];
        return {
          folderId: row.folder_id,
          folderName: row.folder_name,
          captions: row.captions,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error setting folder captions:', error);
      throw error;
    }
  }
  
  /**
   * Add a caption to a folder
   * @param {string} folderId - Folder ID
   * @param {string} newCaption - New caption to add
   * @returns {Promise<Object>} Updated folder captions
   */
  async addCaption(folderId, newCaption) {
    try {
      const existing = await this.getFolderCaptions(folderId);
      const currentCaptions = existing ? existing.captions : [];
      
      // Add new caption if not already exists
      if (!currentCaptions.includes(newCaption)) {
        currentCaptions.push(newCaption);
      }
      
      return await this.setFolderCaptions(
        folderId, 
        currentCaptions, 
        existing?.folderName || ''
      );
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error adding caption:', error);
      throw error;
    }
  }
  
  /**
   * Remove a caption from a folder
   * @param {string} folderId - Folder ID
   * @param {string} captionToRemove - Caption to remove
   * @returns {Promise<Object>} Updated folder captions
   */
  async removeCaption(folderId, captionToRemove) {
    try {
      const existing = await this.getFolderCaptions(folderId);
      if (!existing) {
        throw new Error(`Folder captions not found for folder: ${folderId}`);
      }
      
      const updatedCaptions = existing.captions.filter(caption => caption !== captionToRemove);
      
      return await this.setFolderCaptions(
        folderId, 
        updatedCaptions, 
        existing.folderName
      );
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error removing caption:', error);
      throw error;
    }
  }
  
  /**
   * Get a random caption for a folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<string>} Random caption or global default caption
   */
  async getRandomCaption(folderId) {
    try {
      const folderCaptions = await this.getFolderCaptions(folderId);
      
      // If folder has captions, pick random
      if (folderCaptions && folderCaptions.captions && folderCaptions.captions.length > 0) {
        const randomIndex = Math.floor(Math.random() * folderCaptions.captions.length);
        // console.log(`[FolderCaptionsService] 🎲 Random caption from folder ${folderId}: ${folderCaptions.captions[randomIndex]}`);
        return folderCaptions.captions[randomIndex];
      }
      
      // Fallback to global default caption (temporary hardcoded)
      const globalDefault = "Beautiful photo! ✨";
      console.log(`[FolderCaptionsService] 🌐 Using global default caption for folder ${folderId}: ${globalDefault}`);
      return globalDefault;
      
      // Final fallback
      console.log(`[FolderCaptionsService] ⚠️ No captions found for folder ${folderId}, using empty string`);
      return '';
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error getting random caption:', error);
      return ''; // Return empty string on error
    }
  }

  /**
   * Get a random comment for a folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<string>} Random comment or null
   */
  async getRandomComment(folderId) {
    try {
      const folderCaptions = await this.getFolderCaptions(folderId);
      
      // If folder has comments, pick random
      if (folderCaptions && folderCaptions.comments && folderCaptions.comments.length > 0) {
        const randomIndex = Math.floor(Math.random() * folderCaptions.comments.length);
        console.log(`[FolderCaptionsService] 🎲 Random comment from folder ${folderId}: ${folderCaptions.comments[randomIndex]}`);
        return folderCaptions.comments[randomIndex];
      }
      
      console.log(`[FolderCaptionsService] ⚠️ No comments found for folder ${folderId}`);
      return null;
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error getting random comment:', error);
      return null; // Return null on error
    }
  }
  
  /**
   * Get all folder captions
   * @returns {Promise<Array>} Array of all folder captions
   */
  async getAllFolderCaptions() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            folder_id,
            folder_name,
            captions,
            created_at,
            updated_at
          FROM folder_captions 
          ORDER BY folder_name ASC, updated_at DESC
        `);
        
        return result.rows.map(row => ({
          folderId: row.folder_id,
          folderName: row.folder_name,
          captions: row.captions || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at
        }));
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error getting all folder captions:', error);
      throw error;
    }
  }
  
  /**
   * Delete folder captions
   * @param {string} folderId - Folder ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteFolderCaptions(folderId) {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          DELETE FROM folder_captions 
          WHERE folder_id = $1
        `, [folderId]);
        
        return result.rowCount > 0;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error deleting folder captions:', error);
      throw error;
    }
  }
  
  /**
   * Get statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const client = await pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            COUNT(*) as total_folders,
            AVG(jsonb_array_length(captions)) as avg_captions_per_folder,
            MAX(jsonb_array_length(captions)) as max_captions_per_folder,
            COUNT(CASE WHEN jsonb_array_length(captions) = 0 THEN 1 END) as folders_with_no_captions
          FROM folder_captions
        `);
        
        const stats = result.rows[0];
        return {
          totalFolders: parseInt(stats.total_folders),
          avgCaptionsPerFolder: parseFloat(stats.avg_captions_per_folder) || 0,
          maxCaptionsPerFolder: parseInt(stats.max_captions_per_folder) || 0,
          foldersWithNoCaptions: parseInt(stats.folders_with_no_captions)
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('[FolderCaptionsService] Error getting stats:', error);
      throw error;
    }
  }
}

module.exports = FolderCaptionsService;
