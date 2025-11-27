// foldersStatsApi.js - Fast folder statistics API for dashboard
const express = require('express');
const { pool } = require('../db');
const router = express.Router();

/**
 * GET /api/folders/stats
 * Get folder statistics for dashboard (fast, from PostgreSQL)
 */
router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        parent_id,
        level,
        image_count,
        last_used_at,
        last_posted_at,
        usage_count,
        assigned_pages_count,
        has_captions,
        caption_count
      FROM folder_dashboard_summary
      ORDER BY usage_count DESC, name ASC
    `);

    res.json({
      folders: result.rows,
      total: result.rows.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[FolderStats] Error fetching folder stats:', error);
    res.status(500).json({
      error: 'Failed to fetch folder statistics',
      details: error.message
    });
  }
});

/**
 * GET /api/folders/:folderId/assignments
 * Get pages assigned to a specific folder
 */
router.get('/:folderId/assignments', async (req, res) => {
  try {
    const { folderId } = req.params;

    const result = await pool.query(`
      SELECT 
        pc.page_id,
        p.page_name,
        p.avatar_url,
        pc.enabled,
        pc.posts_per_slot,
        pc.caption_by_folder->$1 as custom_caption,
        pc.updated_at
      FROM page_configs pc
      LEFT JOIN pages p ON p.page_id = pc.page_id
      WHERE pc.folder_ids @> jsonb_build_array($1)::jsonb
      ORDER BY p.page_name
    `, [folderId]);

    res.json({
      folderId,
      assignments: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error(`[FolderStats] Error fetching assignments for folder ${req.params.folderId}:`, error);
    res.status(500).json({
      error: 'Failed to fetch folder assignments',
      details: error.message
    });
  }
});

/**
 * GET /api/folders/:folderId/images/count
 * Get accurate image count from manifest for specific folder
 */
router.get('/:folderId/images/count', async (req, res) => {
  try {
    const { folderId } = req.params;
    const fs = require('fs').promises;
    const path = require('path');
    
    const manifestPath = path.join(__dirname, '../../data/manifest.json');
    
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);
      
      // Count images in this folder
      const imageCount = manifest.filter(file => 
        file.parents && file.parents.includes(folderId)
      ).length;
      
      // Update database count if different
      await pool.query(`
        UPDATE folders 
        SET image_count = $1, updated_at = NOW()
        WHERE id = $2 AND image_count != $1
      `, [imageCount, folderId]);
      
      res.json({
        folderId,
        imageCount,
        source: 'manifest',
        updated: new Date().toISOString()
      });
      
    } catch (manifestError) {
      // Fallback to database count
      const result = await pool.query(`
        SELECT image_count FROM folders WHERE id = $1
      `, [folderId]);
      
      res.json({
        folderId,
        imageCount: result.rows[0]?.image_count || 0,
        source: 'database',
        warning: 'Manifest not available'
      });
    }

  } catch (error) {
    console.error(`[FolderStats] Error counting images for folder ${req.params.folderId}:`, error);
    res.status(500).json({
      error: 'Failed to count folder images',
      details: error.message
    });
  }
});

/**
 * POST /api/folders/refresh-stats
 * Manually refresh folder statistics
 */
router.post('/refresh-stats', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // Run both update functions
      await client.query('SELECT update_folder_image_count()');
      await client.query('SELECT update_folder_usage_stats()');
      
      res.json({
        success: true,
        message: 'Folder statistics refreshed successfully',
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[FolderStats] Error refreshing stats:', error);
    res.status(500).json({
      error: 'Failed to refresh folder statistics',
      details: error.message
    });
  }
});

/**
 * GET /api/folders/tree
 * Get folder hierarchy tree for navigation
 */
router.get('/tree', async (req, res) => {
  try {
    const result = await pool.query(`
      WITH RECURSIVE folder_tree AS (
        -- Root folders (level 0)
        SELECT 
          id, name, parent_id, level, image_count, assigned_pages_count,
          ARRAY[name] as path_array,
          name as path
        FROM folder_dashboard_summary 
        WHERE parent_id IS NULL OR level = 0
        
        UNION ALL
        
        -- Child folders
        SELECT 
          f.id, f.name, f.parent_id, f.level, f.image_count, f.assigned_pages_count,
          ft.path_array || f.name,
          ft.path || ' > ' || f.name
        FROM folder_dashboard_summary f
        JOIN folder_tree ft ON f.parent_id = ft.id
        WHERE f.level <= 3  -- Prevent infinite recursion
      )
      SELECT * FROM folder_tree
      ORDER BY level, path
    `);

    // Build hierarchical structure
    const folderMap = new Map();
    const rootFolders = [];

    // First pass: create all folder objects
    result.rows.forEach(row => {
      folderMap.set(row.id, {
        ...row,
        children: []
      });
    });

    // Second pass: build hierarchy
    result.rows.forEach(row => {
      const folder = folderMap.get(row.id);
      if (row.parent_id && folderMap.has(row.parent_id)) {
        folderMap.get(row.parent_id).children.push(folder);
      } else {
        rootFolders.push(folder);
      }
    });

    res.json({
      tree: rootFolders,
      totalFolders: result.rows.length
    });

  } catch (error) {
    console.error('[FolderStats] Error building folder tree:', error);
    res.status(500).json({
      error: 'Failed to build folder tree',
      details: error.message
    });
  }
});

module.exports = router;
