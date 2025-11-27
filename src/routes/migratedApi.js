// migratedApi.js - API endpoints for migrated PostgreSQL collections
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Wrapper function để xử lý async errors
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================================
// FOLDERS API (Migrated from Firestore)
// ============================================================================

// GET /api/folders - Ultra-fast folder loading (only id + name for UI)
router.get('/folders', wrap(async (req, res) => {
  try {
    console.log('[MigratedAPI] GET /api/folders - Loading minimal data for UI...');
    
    const client = await pool.connect();
    
    try {
      // ✅ MINIMAL QUERY - chỉ lấy id và name
      const query = `
        SELECT id, name
        FROM folders 
        ORDER BY name ASC
      `;
      
      const result = await client.query(query);
      const folders = result.rows;
      
      console.log(`[MigratedAPI] ⚡ Ultra-fast loaded ${folders.length} folders (id+name only)`);
      
      res.json({
        folders: folders,
        total: folders.length,
        source: 'postgresql_minimal',
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading folders:', error);
    res.status(500).json({ 
      error: 'Failed to load folders',
      details: error.message 
    });
  }
}));

// POST /api/folders/refresh - Refresh folders from Google Drive
router.post('/folders/refresh', wrap(async (req, res) => {
  try {
    console.log('[MigratedAPI] POST /api/folders/refresh - Refreshing from Google Drive...');
    
    const EasyMigrationService = require('../services/EasyMigrationService');
    const migrationService = new EasyMigrationService();
    
    // Sync folders from Google Drive to PostgreSQL
    const result = await migrationService.syncFoldersFromDrive();
    
    if (result.status === 'success') {
      console.log(`[MigratedAPI] ✅ Refreshed ${result.migrated} folders`);
      
      res.json({
        success: true,
        message: 'Folders refreshed successfully',
        migrated: result.migrated,
        timestamp: new Date().toISOString(),
        source: 'google_drive_to_postgresql'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to refresh folders',
        error: result.error,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error refreshing folders:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to refresh folders',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /api/folders/stats - Get folder statistics
router.get('/folders/stats', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_folders,
          COUNT(CASE WHEN parent_id IS NULL THEN 1 END) as root_folders,
          COUNT(CASE WHEN parent_id IS NOT NULL THEN 1 END) as child_folders,
          MAX(synced_at) as last_sync,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active_folders,
          COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_folders
        FROM folders
      `;
      
      const result = await client.query(query);
      const stats = result.rows[0];
      
      res.json({
        stats: {
          total: parseInt(stats.total_folders),
          root: parseInt(stats.root_folders),
          children: parseInt(stats.child_folders),
          active: parseInt(stats.active_folders),
          inactive: parseInt(stats.inactive_folders),
          lastSync: stats.last_sync
        },
        source: 'postgresql',
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error getting folder stats:', error);
    res.status(500).json({ 
      error: 'Failed to get folder stats',
      details: error.message 
    });
  }
}));

// ============================================================================
// PAGE CONFIGS API (Migrated from Firestore pageCfg)
// ============================================================================

// GET /api/page-configs - Get all page configurations
router.get('/page-configs', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT page_id, enabled, folder_ids, schedule, posts_per_slot,
               default_caption, caption_by_folder, created_at, updated_at
        FROM page_configs
        ORDER BY updated_at DESC
      `;
      
      const result = await client.query(query);
      const configs = result.rows;
      
      console.log(`[MigratedAPI] Loaded ${configs.length} page configs`);
      
      res.json({
        configs: configs,
        total: configs.length,
        source: 'postgresql'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading page configs:', error);
    res.status(500).json({ 
      error: 'Failed to load page configs',
      details: error.message 
    });
  }
}));

// GET /api/page-configs/:pageId - Get specific page configuration
router.get('/page-configs/:pageId', wrap(async (req, res) => {
  try {
    const { pageId } = req.params;
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT page_id, enabled, folder_ids, schedule, posts_per_slot,
               default_caption, caption_by_folder, created_at, updated_at
        FROM page_configs
        WHERE page_id = $1
      `;
      
      const result = await client.query(query, [pageId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Page config not found' });
      }
      
      const config = result.rows[0];
      console.log(`[MigratedAPI] Loaded config for page ${pageId}`);
      
      res.json({
        config: config,
        source: 'postgresql'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading page config:', error);
    res.status(500).json({ 
      error: 'Failed to load page config',
      details: error.message 
    });
  }
}));

// POST /api/page-configs/:pageId - Update page configuration
router.post('/page-configs/:pageId', wrap(async (req, res) => {
  try {
    const { pageId } = req.params;
    const { 
      enabled, 
      folderIds, 
      schedule, 
      postsPerSlot, 
      defaultCaption, 
      captionByFolder 
    } = req.body;
    
    const client = await pool.connect();
    
    try {
      const query = `
        INSERT INTO page_configs (
          page_id, enabled, folder_ids, schedule, posts_per_slot,
          default_caption, caption_by_folder, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (page_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          folder_ids = EXCLUDED.folder_ids,
          schedule = EXCLUDED.schedule,
          posts_per_slot = EXCLUDED.posts_per_slot,
          default_caption = EXCLUDED.default_caption,
          caption_by_folder = EXCLUDED.caption_by_folder,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      
      const values = [
        pageId,
        enabled || false,
        JSON.stringify(folderIds || []),
        JSON.stringify(schedule || []),
        postsPerSlot || 1,
        defaultCaption || '',
        JSON.stringify(captionByFolder || {}),
        new Date()
      ];
      
      const result = await client.query(query, values);
      const config = result.rows[0];
      
      console.log(`[MigratedAPI] Updated config for page ${pageId}`);
      
      res.json({
        success: true,
        config: config,
        source: 'postgresql'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error updating page config:', error);
    res.status(500).json({ 
      error: 'Failed to update page config',
      details: error.message 
    });
  }
}));

// ============================================================================
// POST LOGS API (Migrated from Firestore)
// ============================================================================

// GET /api/post-logs - Get post logs with filtering
router.get('/post-logs', wrap(async (req, res) => {
  try {
    const { 
      pageId, 
      status, 
      limit = 100, 
      offset = 0,
      startDate,
      endDate 
    } = req.query;
    
    const client = await pool.connect();
    
    try {
      let query = `
        SELECT id, page_id, status, file_id, file_name, folder_id,
               caption, facebook_post_id, error_message, started_at,
               completed_at, duration_ms, file_size_bytes, created_at
        FROM post_logs
        WHERE 1=1
      `;
      
      const params = [];
      let paramCount = 0;
      
      if (pageId) {
        params.push(pageId);
        query += ` AND page_id = $${++paramCount}`;
      }
      
      if (status) {
        params.push(status);
        query += ` AND status = $${++paramCount}`;
      }
      
      if (startDate) {
        params.push(startDate);
        query += ` AND created_at >= $${++paramCount}`;
      }
      
      if (endDate) {
        params.push(endDate);
        query += ` AND created_at <= $${++paramCount}`;
      }
      
      query += ` ORDER BY created_at DESC`;
      
      if (limit) {
        params.push(parseInt(limit));
        query += ` LIMIT $${++paramCount}`;
      }
      
      if (offset) {
        params.push(parseInt(offset));
        query += ` OFFSET $${++paramCount}`;
      }
      
      const result = await client.query(query, params);
      const logs = result.rows;
      
      console.log(`[MigratedAPI] Loaded ${logs.length} post logs`);
      
      res.json({
        logs: logs,
        total: logs.length,
        source: 'postgresql',
        filters: { pageId, status, startDate, endDate }
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading post logs:', error);
    res.status(500).json({ 
      error: 'Failed to load post logs',
      details: error.message 
    });
  }
}));

// ============================================================================
// AGENTS & ASSIGNMENTS API (Migrated from Firestore)
// ============================================================================

// GET /api/agents - Get all agents
router.get('/agents', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT a.agent_id, a.agent_label, a.ext_version, a.pages, a.last_seen,
               a.created_at, a.updated_at, ass.allowed_pages
        FROM agents a
        LEFT JOIN assignments ass ON a.agent_id = ass.agent_id
        ORDER BY a.last_seen DESC
      `;
      
      const result = await client.query(query);
      const agents = result.rows;
      
      console.log(`[MigratedAPI] Loaded ${agents.length} agents`);
      
      res.json({
        agents: agents,
        total: agents.length,
        source: 'postgresql'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading agents:', error);
    res.status(500).json({ 
      error: 'Failed to load agents',
      details: error.message 
    });
  }
}));

// GET /api/agents/detailed - Get detailed agents info
router.get('/agents/detailed', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT a.agent_id, a.agent_label, a.ext_version, a.pages, a.last_seen,
               a.created_at, a.updated_at, ass.allowed_pages,
               COUNT(p.page_id) as assigned_pages_count
        FROM agents a
        LEFT JOIN assignments ass ON a.agent_id = ass.agent_id
        LEFT JOIN pages p ON p.page_id = ANY(string_to_array(ass.allowed_pages, ','))
        GROUP BY a.agent_id, a.agent_label, a.ext_version, a.pages, a.last_seen,
                 a.created_at, a.updated_at, ass.allowed_pages
        ORDER BY a.last_seen DESC
      `;
      
      const result = await client.query(query);
      const agents = result.rows;
      
      console.log(`[MigratedAPI] Loaded ${agents.length} detailed agents`);
      
      res.json({
        agents: agents,
        total: agents.length,
        source: 'postgresql_detailed'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading detailed agents:', error);
    res.status(500).json({ 
      error: 'Failed to load detailed agents',
      details: error.message 
    });
  }
}));

// GET /api/pages/detailed - Get detailed pages info
router.get('/pages/detailed', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT p.page_id, p.page_name, p.facebook_url, p.notes, p.status, p.avatar_url,
               p.created_at, p.updated_at,
               psd.fan_count, psd.follower_count,
               COUNT(po.post_id) as total_posts
        FROM pages p
        LEFT JOIN (
          SELECT DISTINCT ON (page_id) page_id, fan_count, follower_count
          FROM page_stats_daily
          ORDER BY page_id, date DESC
        ) psd ON p.page_id = psd.page_id
        LEFT JOIN posts po ON p.page_id = po.page_id
        GROUP BY p.page_id, p.page_name, p.facebook_url, p.notes, p.status, p.avatar_url,
                 p.created_at, p.updated_at, psd.fan_count, psd.follower_count
        ORDER BY p.created_at DESC
      `;
      
      const result = await client.query(query);
      const pages = result.rows;
      
      console.log(`[MigratedAPI] Loaded ${pages.length} detailed pages`);
      
      res.json({
        pages: pages,
        total: pages.length,
        source: 'postgresql_detailed'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading detailed pages:', error);
    res.status(500).json({ 
      error: 'Failed to load detailed pages',
      details: error.message 
    });
  }
}));

// POST /api/agents/:agentId - Update agent info
router.post('/agents/:agentId', wrap(async (req, res) => {
  try {
    const { agentId } = req.params;
    const { agentLabel, extVersion, pages } = req.body;
    
    const client = await pool.connect();
    
    try {
      const query = `
        INSERT INTO agents (agent_id, agent_label, ext_version, pages, last_seen, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (agent_id) DO UPDATE SET
          agent_label = EXCLUDED.agent_label,
          ext_version = EXCLUDED.ext_version,
          pages = EXCLUDED.pages,
          last_seen = EXCLUDED.last_seen,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      
      const values = [
        agentId,
        agentLabel || null,
        extVersion || null,
        JSON.stringify(pages || []),
        new Date(),
        new Date()
      ];
      
      const result = await client.query(query, values);
      const agent = result.rows[0];
      
      console.log(`[MigratedAPI] Updated agent ${agentId}`);
      
      res.json({
        success: true,
        agent: agent,
        source: 'postgresql'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error updating agent:', error);
    res.status(500).json({ 
      error: 'Failed to update agent',
      details: error.message 
    });
  }
}));

// ============================================================================
// WORKER SYNC API (Temporary - for testing UI)
// ============================================================================

// POST /api/worker/sync - Trigger sync with different modes
router.post('/worker/sync', wrap(async (req, res) => {
  try {
    const { mode = 'incremental' } = req.body;
    
    console.log(`🚀 Dashboard triggered sync mode: ${mode}`);
    
    // Validate mode
    const validModes = ['incremental', 'full-scan'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sync mode. Must be "incremental" or "full-scan"'
      });
    }

    // Initialize response object
    const response = {
      success: true,
      mode: mode,
      startTime: new Date().toISOString(),
      message: mode === 'full-scan' 
        ? 'Full rebuild started - this will take 30-60 minutes' 
        : 'Quick sync started - this will take 2-5 minutes'
    };
    
    // Call actual worker process
    const { spawn } = require('child_process');
    const workerPath = 'worker.js'; // Use relative path from current directory
    
    // Construct proper arguments based on mode
    const args = mode === 'full-scan' ? ['--full-scan'] : [];
    
    console.log(`🚀 Spawning worker process: ${workerPath}`);
    console.log(`📋 Worker arguments: ${args.join(' ')}`);
    
    const worker = spawn('node', [workerPath, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: process.cwd() // Ensure we're in the right directory
    });
    
    // Collect worker output
    let workerOutput = '';
    let workerError = '';
    
    worker.stdout.on('data', (data) => {
      const output = data.toString();
      workerOutput += output;
      console.log(`[Worker ${mode}] ${output.trim()}`);
    });
    
    worker.stderr.on('data', (data) => {
      const error = data.toString();
      workerError += error;
      console.error(`[Worker ${mode} ERROR] ${error.trim()}`);
    });
    
    // Handle worker completion
    worker.on('close', (code) => {
      console.log(`[Worker ${mode}] Process exited with code ${code}`);
    });
    
    // For incremental sync, wait for completion
    if (mode === 'incremental') {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.kill();
            reject(new Error('Worker timeout after 5 minutes'));
          }, 5 * 60 * 1000); // 5 minutes timeout
          
          worker.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Worker failed with code ${code}`));
            }
          });
        });
        
        // Parse worker output for results
        const newImagesMatch = workerOutput.match(/new images found: (\d+)/i);
        const newImages = newImagesMatch ? parseInt(newImagesMatch[1]) : 0;
        
        response.completed = true;
        response.endTime = new Date().toISOString();
        response.newImages = newImages;
        response.message = `Quick sync completed - ${newImages} new images found`;
        response.workerOutput = workerOutput;
        
      } catch (error) {
        console.error(`❌ Worker ${mode} failed:`, error);
        response.completed = false;
        response.error = error.message;
        response.message = `Quick sync failed: ${error.message}`;
      }
    } else {
      // For full-scan, return immediately (worker runs in background)
      response.completed = false;
      response.message = 'Full rebuild started in background - check server logs for progress';
      response.workerPid = worker.pid;
    }

    console.log(`✅ Sync response:`, response);
    res.json(response);

  } catch (error) {
    console.error('❌ Sync API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}));

// ============================================================================
// FOLDER ASSIGNMENT API (For Dashboard folder -> page assignment)
// ============================================================================

// POST /api/folders/:folderId/assign-page - Assign folder to page (alternative endpoint)
router.post('/folders/:folderId/assign-page', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    const { pageId, caption } = req.body;
    
    if (!pageId) {
      return res.status(400).json({
        error: 'pageId is required'
      });
    }
    
    console.log(`[MigratedAPI] Assigning folder ${folderId} to page ${pageId}`);
    
    // Get current page config
    const client = await pool.connect();
    
    try {
      // First, get existing config
      const existingResult = await client.query(`
        SELECT folder_ids, caption_by_folder, enabled, schedule, posts_per_slot, default_caption
        FROM page_configs 
        WHERE page_id = $1
      `, [pageId]);
      
      let folderIds = [];
      let captionByFolder = {};
      let enabled = true;
      let schedule = [];
      let postsPerSlot = 1;
      let defaultCaption = '';
      
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        folderIds = existing.folder_ids || [];
        captionByFolder = existing.caption_by_folder || {};
        enabled = existing.enabled !== false;
        schedule = existing.schedule || [];
        postsPerSlot = existing.posts_per_slot || 1;
        defaultCaption = existing.default_caption || '';
      }
      
      // Add folder if not already present
      if (!folderIds.includes(folderId)) {
        folderIds.push(folderId);
      }
      
      // Set custom caption if provided
      if (caption && caption.trim()) {
        captionByFolder[folderId] = caption.trim();
      }
      
      // Update page config
      const updateResult = await client.query(`
        INSERT INTO page_configs (
          page_id, enabled, folder_ids, schedule, posts_per_slot,
          default_caption, caption_by_folder, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (page_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          folder_ids = EXCLUDED.folder_ids,
          schedule = EXCLUDED.schedule,
          posts_per_slot = EXCLUDED.posts_per_slot,
          default_caption = EXCLUDED.default_caption,
          caption_by_folder = EXCLUDED.caption_by_folder,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `, [
        pageId,
        enabled,
        JSON.stringify(folderIds),
        JSON.stringify(schedule),
        postsPerSlot,
        defaultCaption,
        JSON.stringify(captionByFolder)
      ]);
      
      console.log(`[MigratedAPI] ✅ Assigned folder ${folderId} to page ${pageId}`);
      
      res.json({
        success: true,
        message: 'Folder assigned to page successfully',
        config: updateResult.rows[0],
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[MigratedAPI] Error assigning folder to page:', error);
    res.status(500).json({ 
      error: 'Failed to assign folder to page',
      details: error.message 
    });
  }
}));

// ============================================================================
// FOLDER CAPTIONS API (New - PostgreSQL)
// ============================================================================

const FolderCaptionsService = require('../services/FolderCaptionsService');
const folderCaptionsService = new FolderCaptionsService();

// GET /api/folder-captions - Get all folder captions
router.get('/folder-captions', wrap(async (req, res) => {
  try {
    console.log('[MigratedAPI] GET /api/folder-captions - Loading all folder captions...');
    
    const folderCaptions = await folderCaptionsService.getAllFolderCaptions();
    
    res.json({
      folderCaptions: folderCaptions,
      total: folderCaptions.length,
      source: 'postgresql',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading folder captions:', error);
    res.status(500).json({ 
      error: 'Failed to load folder captions',
      details: error.message 
    });
  }
}));

// GET /api/folder-captions/:folderId - Get captions for specific folder
router.get('/folder-captions/:folderId', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    console.log(`[MigratedAPI] GET /api/folder-captions/${folderId} - Loading folder captions...`);
    
    const folderCaptions = await folderCaptionsService.getFolderCaptions(folderId);
    
    if (!folderCaptions) {
      return res.status(404).json({
        error: 'Folder captions not found',
        folderId: folderId
      });
    }
    
    res.json({
      ...folderCaptions,
      source: 'postgresql',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error loading folder captions:', error);
    res.status(500).json({ 
      error: 'Failed to load folder captions',
      details: error.message 
    });
  }
}));

// POST /api/folder-captions/:folderId - Set/Update folder captions
router.post('/folder-captions/:folderId', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    const { captions, folderName } = req.body;
    
    console.log(`[MigratedAPI] POST /api/folder-captions/${folderId} - Updating captions...`);
    
    // Validate captions array
    if (captions && !Array.isArray(captions)) {
      return res.status(400).json({
        error: 'Captions must be an array of strings'
      });
    }
    
    const result = await folderCaptionsService.setFolderCaptions(
      folderId, 
      captions || [], 
      folderName || ''
    );
    
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error updating folder captions:', error);
    res.status(500).json({ 
      error: 'Failed to update folder captions',
      details: error.message 
    });
  }
}));

// POST /api/folder-captions/:folderId/add - Add a caption to folder
router.post('/folder-captions/:folderId/add', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    const { caption } = req.body;
    
    if (!caption || typeof caption !== 'string') {
      return res.status(400).json({
        error: 'Caption is required and must be a string'
      });
    }
    
    console.log(`[MigratedAPI] Adding caption to folder ${folderId}: ${caption.substring(0, 50)}...`);
    
    const result = await folderCaptionsService.addCaption(folderId, caption);
    
    res.json({
      success: true,
      message: 'Caption added successfully',
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error adding caption:', error);
    res.status(500).json({ 
      error: 'Failed to add caption',
      details: error.message 
    });
  }
}));

// DELETE /api/folder-captions/:folderId/remove - Remove a caption from folder
router.delete('/folder-captions/:folderId/remove', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    const { caption } = req.body;
    
    if (!caption || typeof caption !== 'string') {
      return res.status(400).json({
        error: 'Caption is required and must be a string'
      });
    }
    
    console.log(`[MigratedAPI] Removing caption from folder ${folderId}: ${caption.substring(0, 50)}...`);
    
    const result = await folderCaptionsService.removeCaption(folderId, caption);
    
    res.json({
      success: true,
      message: 'Caption removed successfully',
      ...result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error removing caption:', error);
    res.status(500).json({ 
      error: 'Failed to remove caption',
      details: error.message 
    });
  }
}));

// GET /api/folder-captions/:folderId/random - Get random caption for folder
router.get('/folder-captions/:folderId/random', wrap(async (req, res) => {
  try {
    const { folderId } = req.params;
    console.log(`[MigratedAPI] Getting random caption for folder ${folderId}`);
    
    const randomCaption = await folderCaptionsService.getRandomCaption(folderId);
    
    res.json({
      folderId: folderId,
      caption: randomCaption,
      source: 'postgresql',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[MigratedAPI] Error getting random caption:', error);
    res.status(500).json({ 
      error: 'Failed to get random caption',
      details: error.message 
    });
  }
}));

module.exports = router;
