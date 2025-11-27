// analyticsApi.js - Analytics API cho Extension
const express = require('express');
const router = express.Router();

// Import database connection
const { pool } = require('../db');

// Wrapper function để xử lý async errors
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================================
// ANALYTICS ENDPOINTS
// ============================================================================

// GET /api/analytics/summary - Dashboard Overview
router.get('/analytics/summary', wrap(async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // 1. Tổng quan pages
      const pagesQuery = `
        SELECT 
          COUNT(*) as total_pages,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_pages,
          COUNT(CASE WHEN status = 'error' THEN 1 END) as error_pages
        FROM pages
      `;
      
      const pagesResult = await client.query(pagesQuery);
      const pagesStats = pagesResult.rows[0];
      
      // 2. Tổng stats hôm nay
      const todayStatsQuery = `
        SELECT 
          COALESCE(SUM(fan_count), 0) as total_fans,
          COALESCE(SUM(follower_count), 0) as total_followers
        FROM page_stats_daily 
        WHERE date = CURRENT_DATE
      `;
      
      const todayStatsResult = await client.query(todayStatsQuery);
      const todayStats = todayStatsResult.rows[0];
      
      // 3. Tổng stats hôm qua
      const yesterdayStatsQuery = `
        SELECT 
          COALESCE(SUM(fan_count), 0) as total_fans,
          COALESCE(SUM(follower_count), 0) as total_followers
        FROM page_stats_daily 
        WHERE date = (CURRENT_DATE - INTERVAL '1 day')
      `;
      
      const yesterdayStatsResult = await client.query(yesterdayStatsQuery);
      const yesterdayStats = yesterdayStatsResult.rows[0];
      
      // 4. Tổng posts
      const postsQuery = `
        SELECT COUNT(*) as total_posts
        FROM posts
      `;
      
      const postsResult = await client.query(postsQuery);
      const totalPosts = parseInt(postsResult.rows[0].total_posts);
      
      // 5. Top 5 pages theo fan count
      const topPagesQuery = `
        SELECT 
          p.page_id,
          p.page_name,
          p.avatar_url,
          COALESCE(today_stats.fan_count, 0) as fan_count,
          COALESCE(today_stats.follower_count, 0) as follower_count,
          COALESCE(sync.last_sync_time, p.created_at) as last_sync_time
        FROM pages p
        LEFT JOIN LATERAL (
          SELECT fan_count, follower_count
          FROM page_stats_daily ps
          WHERE ps.page_id = p.page_id
          AND ps.date = CURRENT_DATE
        ) today_stats ON true
        LEFT JOIN LATERAL (
          SELECT last_sync_time
          FROM sync_tracking st
          WHERE st.page_id = p.page_id
        ) sync ON true
        ORDER BY today_stats.fan_count DESC NULLS LAST
        LIMIT 5
      `;
      
      const topPagesResult = await client.query(topPagesQuery);
      
      // 6. Sync status
      const syncQuery = `
        SELECT 
          MAX(completed_at) as last_run,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as success_runs,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_runs
        FROM ingestion_runs
        WHERE run_date >= (CURRENT_DATE - INTERVAL '7 days')
      `;
      
      const syncResult = await client.query(syncQuery);
      const syncStats = syncResult.rows[0];
      
      // Tính toán change
      const fanChange = todayStats.total_fans - yesterdayStats.total_fans;
      const followerChange = todayStats.total_followers - yesterdayStats.total_followers;
      
      res.json({
        success: true,
        pages: {
          total: parseInt(pagesStats.total_pages),
          active: parseInt(pagesStats.active_pages),
          error: parseInt(pagesStats.error_pages)
        },
        stats: {
          totalFans: parseInt(todayStats.total_fans),
          totalFollowers: parseInt(todayStats.total_followers),
          totalPosts: totalPosts,
          todayChange: {
            fans: fanChange,
            followers: followerChange
          }
        },
        topPages: topPagesResult.rows.map(page => ({
          page_id: page.page_id,
          page_name: page.page_name,
          fan_count: parseInt(page.fan_count),
          follower_count: parseInt(page.follower_count),
          avatar_url: page.avatar_url,
          last_sync: page.last_sync_time
        })),
        syncStatus: {
          lastRun: syncStats.last_run,
          status: syncStats.success_runs > 0 ? 'success' : 'unknown',
          successRuns: parseInt(syncStats.success_runs || 0),
          failedRuns: parseInt(syncStats.failed_runs || 0)
        },
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Get summary error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// GET /api/analytics/trends - Growth Trends
router.get('/analytics/trends', wrap(async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysNum = Math.min(parseInt(days), 30); // Max 30 days
    
    const client = await pool.connect();
    
    try {
      // Fan growth trends
      const fanTrendsQuery = `
        SELECT 
          date,
          SUM(fan_count) as total_fans,
          SUM(follower_count) as total_followers
        FROM page_stats_daily 
        WHERE date >= (CURRENT_DATE - INTERVAL '${daysNum} days')
        GROUP BY date
        ORDER BY date ASC
      `;
      
      const fanTrendsResult = await client.query(fanTrendsQuery);
      
      // Post activity trends
      const postTrendsQuery = `
        SELECT 
          DATE(created_time) as date,
          COUNT(*) as posts_count
        FROM posts
        WHERE created_time >= (CURRENT_DATE - INTERVAL '${daysNum} days')
        GROUP BY DATE(created_time)
        ORDER BY date ASC
      `;
      
      const postTrendsResult = await client.query(postTrendsQuery);
      
      // Format data cho charts
      const fanGrowth = fanTrendsResult.rows.map(row => ({
        date: row.date.toISOString().split('T')[0],
        total: parseInt(row.total_fans),
        followers: parseInt(row.total_followers)
      }));
      
      const postActivity = postTrendsResult.rows.map(row => ({
        date: row.date.toISOString().split('T')[0],
        posts: parseInt(row.posts_count)
      }));
      
      res.json({
        success: true,
        trends: {
          fanGrowth,
          postActivity
        },
        period: `${daysNum} days`,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Get trends error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// ============================================================================
// PAGES ENDPOINTS (Cải tiến)
// ============================================================================

// GET /api/pages - Lấy danh sách tất cả pages
router.get('/pages', wrap(async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    
    let whereClause = '';
    let params = [];
    let paramIndex = 1;
    
    if (status) {
      whereClause = 'WHERE status = $1';
      params.push(status);
      paramIndex++;
    }
    
    const query = `
      SELECT 
        page_id,
        page_name,
        facebook_url,
        notes,
        status,
        avatar_url,
        created_at,
        updated_at
      FROM pages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const limitParam = parseInt(limit);
    const offsetParam = parseInt(offset);
    params.push(limitParam, offsetParam);
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      
      res.json({
        success: true,
        pages: result.rows,
        total: result.rows.length,
        pagination: {
          limit: limitParam,
          offset: offsetParam
        },
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Get pages error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// POST /api/pages/sync - Sync page từ Extension
router.post('/pages/sync', wrap(async (req, res) => {
  try {
    const { pageId, pageName, avatar_url } = req.body;
    
    // Validation
    if (!pageId || !pageName) {
      return res.status(400).json({ 
        success: false, 
        error: 'pageId and pageName are required' 
      });
    }
    
    const client = await pool.connect();
    
    try {
      // INSERT với ON CONFLICT DO UPDATE để cập nhật avatar_url
      const result = await client.query(`
        INSERT INTO pages (page_id, page_name, facebook_url, status, avatar_url, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (page_id) DO UPDATE SET
          page_name = EXCLUDED.page_name,
          facebook_url = EXCLUDED.facebook_url,
          avatar_url = EXCLUDED.avatar_url,
          updated_at = NOW()
      `, [
        pageId, 
        pageName, 
        `https://facebook.com/${pageId}`,
        'active',
        avatar_url || `https://graph.facebook.com/${pageId}/picture?type=small`
      ]);
      
      // Kiểm tra xem có insert được không
      if (result.rowCount > 0) {
        console.log(`[AnalyticsAPI] Page ${pageId} (${pageName}) added successfully with avatar: ${avatar_url || 'default'}`);
        res.json({ 
          success: true, 
          message: 'Page added successfully',
          action: 'inserted'
        });
      } else {
        console.log(`[AnalyticsAPI] Page ${pageId} (${pageName}) updated successfully with avatar: ${avatar_url || 'default'}`);
        res.json({ 
          success: true, 
          message: 'Page updated successfully',
          action: 'updated'
        });
      }
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Sync page error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// Route này đã được chuyển sang pagesApi.js để tránh conflict với search API

// ============================================================================
// STATS ENDPOINTS  
// ============================================================================



// GET /api/stats/pages - Lấy danh sách pages với stats (cho PageCardView)
router.get('/stats/pages', wrap(async (req, res) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    
    let whereClause = '';
    let params = [];
    let paramIndex = 1;
    
    if (status) {
      whereClause = 'WHERE p.status = $1';
      params.push(status);
      paramIndex++;
    }
    
    const query = `
      SELECT 
        p.page_id,
        p.page_name,
        p.facebook_url,
        p.notes,
        p.status,
        p.avatar_url,
        p.created_at,
        p.updated_at,
        -- Lấy stats mới nhất từ page_stats_daily
        COALESCE(latest_stats.fan_count, 0) as fan_count,
        COALESCE(latest_stats.follower_count, 0) as follower_count,
        COALESCE(latest_stats.date, p.created_at::date) as stats_date,
        -- Tính change từ ngày trước đó (nếu có)
        COALESCE(latest_stats.fan_count - prev_stats.fan_count, 0) as fan_change,
        COALESCE(latest_stats.follower_count - prev_stats.follower_count, 0) as follower_change
      FROM pages p
      LEFT JOIN LATERAL (
        SELECT fan_count, follower_count, date
        FROM page_stats_daily ps
        WHERE ps.page_id = p.page_id
        ORDER BY ps.date DESC
        LIMIT 1
      ) latest_stats ON true
      LEFT JOIN LATERAL (
        SELECT fan_count, follower_count
        FROM page_stats_daily ps
        WHERE ps.page_id = p.page_id
        AND ps.date < latest_stats.date
        ORDER BY ps.date DESC
        LIMIT 1
      ) prev_stats ON true
      ${whereClause}
      ORDER BY latest_stats.fan_count DESC NULLS LAST, p.page_name ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const limitParam = parseInt(limit);
    const offsetParam = parseInt(offset);
    params.push(limitParam, offsetParam);
    
    console.log('[AnalyticsAPI] Executing query for /api/stats/pages');
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      
      console.log(`[AnalyticsAPI] Found ${result.rows.length} pages from database`);
      console.log('[AnalyticsAPI] Sample raw row:', result.rows[0]);
      
      const pages = result.rows.map(page => {
        const fanCount = page.fan_count ? parseInt(page.fan_count) : 0;
        const followerCount = page.follower_count ? parseInt(page.follower_count) : 0;
        const fanChange = page.fan_change ? parseInt(page.fan_change) : 0;
        const followerChange = page.follower_change ? parseInt(page.follower_change) : 0;
        
        return {
          page_id: page.page_id,
          page_name: page.page_name,
          facebook_url: page.facebook_url || `https://facebook.com/${page.page_id}`,
          avatar_url: page.avatar_url || `https://graph.facebook.com/${page.page_id}/picture?type=small`,
          status: page.status || 'active',
          notes: page.notes || '',
          fan_count: fanCount,
          follower_count: followerCount,
          fan_change: fanChange,
          follower_change: followerChange,
          stats_date: page.stats_date,
          created_at: page.created_at,
          updated_at: page.updated_at
        };
      });
      
      res.json({
        success: true,
        pages: pages,
        total: result.rows.length,
        pagination: {
          limit: limitParam,
          offset: offsetParam
        },
        timestamp: new Date().toISOString(),
        debug: {
          query_executed: true,
          rows_found: result.rows.length
        }
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Get stats pages error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR',
      debug: {
        query_executed: false,
        error_detail: error.stack
      }
    });
  }
}));

// GET /api/stats/pages-overview - Tổng quan pages theo khoảng thời gian
router.get('/stats/pages-overview', wrap(async (req, res) => {
  try {
    const { start, end, pageIds } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end dates are required (YYYY-MM-DD)' });
    }
    
    let whereClause = 'WHERE date >= $1 AND date <= $2';
    let params = [start, end];
    let paramIndex = 3;
    
    if (pageIds) {
      const pageIdArray = pageIds.split(',').map(id => id.trim());
      whereClause += ` AND page_id = ANY($${paramIndex})`;
      params.push(pageIdArray);
      paramIndex++;
    }
    
    const query = `
      SELECT 
        p.page_id,
        p.page_name,
        COUNT(ps.date) as days_with_data,
        SUM(ps.reach) as total_reach,
        SUM(ps.impressions) as total_impressions,
        SUM(ps.engagement) as total_engagement,
        SUM(ps.new_fans) as total_new_fans,
        AVG(ps.reach) as avg_reach,
        AVG(ps.impressions) as avg_impressions,
        AVG(ps.engagement) as avg_engagement
      FROM pages p
      LEFT JOIN page_stats_daily ps ON p.page_id = ps.page_id
      ${whereClause}
      GROUP BY p.page_id, p.page_name
      ORDER BY total_engagement DESC, total_reach DESC
    `;
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      
      res.json({
        success: true,
        pages: result.rows,
        total: result.rows.length,
        period: { start, end },
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Pages overview error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}));

// GET /api/stats/top-posts - Top posts theo metrics
router.get('/stats/top-posts', wrap(async (req, res) => {
  try {
    const { start, end, pageIds, sort = 'engagement', limit = 50 } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end dates are required (YYYY-MM-DD)' });
    }
    
    let whereClause = 'WHERE ps.date >= $1 AND ps.date <= $2';
    let params = [start, end];
    let paramIndex = 3;
    
    if (pageIds) {
      const pageIdArray = pageIds.split(',').map(id => id.trim());
      whereClause += ` AND p.page_id = ANY($${paramIndex})`;
      params.push(pageIdArray);
      paramIndex++;
    }
    
    // Xác định sort field
    let sortField = 'total_engagement';
    switch (sort) {
      case 'reach': sortField = 'total_reach'; break;
      case 'impressions': sortField = 'total_impressions'; break;
      case 'reactions': sortField = 'total_reactions'; break;
      case 'comments': sortField = 'total_comments'; break;
      case 'shares': sortField = 'total_shares'; break;
      default: sortField = 'total_engagement'; break;
    }
    
    const query = `
      SELECT 
        p.page_id,
        p.page_name,
        ps.post_id,
        ps.post_url,
        ps.post_type,
        ps.post_message,
        ps.post_created_time,
        SUM(ps.reach) as total_reach,
        SUM(ps.impressions) as total_impressions,
        SUM(ps.engagement) as total_engagement,
        SUM(ps.reactions) as total_reactions,
        SUM(ps.comments) as total_comments,
        SUM(ps.shares) as total_shares
      FROM pages p
      JOIN page_stats_daily ps ON p.page_id = ps.page_id
      ${whereClause}
      GROUP BY p.page_id, p.page_name, ps.post_id, ps.post_url, ps.post_type, ps.post_message, ps.post_created_time
      ORDER BY ${sortField} DESC
      LIMIT $${paramIndex}
    `;
    
    const limitParam = parseInt(limit);
    params.push(limitParam);
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, params);
      
      res.json({
        success: true,
        posts: result.rows,
        total: result.rows.length,
        period: { start, end },
        sort: sort,
        limit: limitParam,
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Top posts error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}));

// ============================================================================
// FAST PAGES ENDPOINT - For Extension
// ============================================================================


// POST /api/stats/pages/fast - Fast pages stats với page IDs filtering (cho extension cũ)
router.post('/stats/pages/fast', wrap(async (req, res) => {
  try {
    const { pageIds } = req.body;
    const agentId = req.headers['x-agent'];
    
    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'pageIds array is required in request body'
      });
    }
    
    console.log(`[AnalyticsAPI] Getting specific pages: ${pageIds.join(', ')} for agent: ${agentId}`);
    
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          p.page_id,
          p.page_name,
          p.facebook_url,
          p.notes,
          p.status,
          p.avatar_url,
          p.created_at,
          p.updated_at,
          -- Stats from page_stats_daily
          COALESCE(today_stats.fan_count, 0) as fan_count,
          COALESCE(today_stats.follower_count, 0) as follower_count,
          COALESCE(yesterday_stats.fan_count, 0) as yesterday_fan_count,
          COALESCE(yesterday_stats.follower_count, 0) as yesterday_follower_count,
          -- Sync tracking
          COALESCE(sync.last_sync_time, p.created_at) as last_sync_time,
          sync.posts_count
        FROM pages p
        LEFT JOIN LATERAL (
          SELECT fan_count, follower_count
          FROM page_stats_daily ps
          WHERE ps.page_id = p.page_id
          ORDER BY ps.date DESC
          LIMIT 1
        ) today_stats ON true
        LEFT JOIN LATERAL (
          SELECT fan_count, follower_count
          FROM page_stats_daily ps
          WHERE ps.page_id = p.page_id
          ORDER BY ps.date DESC
          OFFSET 1
          LIMIT 1
        ) yesterday_stats ON true
        LEFT JOIN LATERAL (
          SELECT last_sync_time, posts_count
          FROM sync_tracking st
          WHERE st.page_id = p.page_id
        ) sync ON true
        WHERE p.page_id = ANY($1)
        ORDER BY p.page_name
      `;
      
      const result = await client.query(query, [pageIds]);
      
      // Calculate changes
      const pages = result.rows.map(page => ({
        ...page,
        fan_change: page.fan_count - page.yesterday_fan_count,
        follower_change: page.follower_count - page.yesterday_follower_count,
        stats_date: new Date().toISOString().split('T')[0]
      }));
      
      console.log(`[AnalyticsAPI] Found ${pages.length} specific pages`);
      
      res.json({
        success: true,
        pages,
        total: pages.length,
        requestedIds: pageIds,
        foundIds: pages.map(p => p.page_id),
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Specific pages stats error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
}));

// ============================================================================
// HEALTH ENDPOINT
// ============================================================================

// GET /api/health - Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    workers: process.env.WORKER_CONCURRENCY || 'not set',
    envVars: {
      WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL ? 'set' : 'not set'
    }
  });
});

// ❌ REMOVED: Old FoldersCache API - replaced by PostgreSQL in migratedApi.js

// POST /api/folders/refresh - Force refresh cache
router.post('/folders/refresh', async (req, res) => {
  try {
    console.log('[API] POST /api/folders/refresh - Force refreshing folders cache...');
    
    const foldersCache = require('../services/FoldersCache');
    const folders = await foldersCache.forceRefresh();
    
    res.json({
      success: true,
      message: 'Cache refreshed successfully',
      total: folders.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[API] Error refreshing folders cache:', error);
    res.status(500).json({ 
      error: 'Failed to refresh cache',
      details: error.message 
    });
  }
});

// GET /api/drive/folders - Lấy folders trực tiếp từ Google Drive
router.get('/drive/folders', async (req, res) => {
  try {
    console.log('[AnalyticsAPI] Getting folders from Google Drive...');
    
    // Import GoogleDriveService
    const GoogleDriveService = require('../services/GoogleDriveService');
    const googleDriveService = new GoogleDriveService();
    
    // Get root folder ID from config
    const { config } = require('../../config');
    const rootFolderId = config.googleDrive.rootFolderId;
    
    if (!rootFolderId) {
      return res.status(500).json({
        success: false,
        error: 'Root folder ID not configured',
        code: 'MISSING_ROOT_FOLDER_ID'
      });
    }
    
    console.log('[AnalyticsAPI] Root folder ID:', rootFolderId);
    
    // List all folders recursively
    const FOLDER_MIME = "application/vnd.google-apps.folder";
    const folders = [];
    const queue = [rootFolderId];
    
    while (queue.length > 0) {
      const folderId = queue.shift();
      
      // Get folders in current directory
      const folderQuery = `'${folderId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`;
      const folderResults = await googleDriveService.listByQuery(
        folderQuery,
        "files(id,name,createdTime,parents),nextPageToken"
      );
      
      // Add to results
      folders.push(...folderResults);
      
      // Add to queue for recursive scanning
      folderResults.forEach(folder => queue.push(folder.id));
    }
    
    console.log('[AnalyticsAPI] Found folders:', folders.length);
    
    res.json({
      success: true,
      folders: folders,
      total: folders.length,
      rootFolderId: rootFolderId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AnalyticsAPI] Error getting folders from Google Drive:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'DRIVE_FOLDERS_ERROR'
    });
  }
});

// ============================================================================
// FILE MANAGEMENT ENDPOINTS - PHASE 2
// ============================================================================

// GET /api/drive/files/:fileId - Download file content (cải tiến từ /blob/:fileId)
router.get('/drive/files/:fileId', wrap(async (req, res) => {
  try {
    const { fileId } = req.params;
    const { format = 'blob' } = req.query; // 'blob' hoặc 'base64'
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required',
        code: 'MISSING_FILE_ID'
      });
    }
    
    console.log('[AnalyticsAPI] Downloading file:', fileId, 'format:', format);
    
    // Import GoogleDriveService
    const GoogleDriveService = require('../services/GoogleDriveService');
    const googleDriveService = new GoogleDriveService();
    
    // Download file
    const { buf, mime } = await googleDriveService.downloadFileAsBuffer(fileId);
    
    if (format === 'base64') {
      // Return as base64 string
      const base64 = buf.toString('base64');
      res.json({
        success: true,
        fileId: fileId,
        mimeType: mime,
        size: buf.length,
        data: base64,
        format: 'base64',
        timestamp: new Date().toISOString()
      });
    } else {
      // Return as blob (default behavior)
      res.set('Content-Type', mime);
      res.set('Content-Length', buf.length);
      res.set('Cache-Control', 'public, max-age=3600'); // Cache 1 hour
      res.send(buf);
    }
    
  } catch (error) {
    console.error('[AnalyticsAPI] Error downloading file:', error);
    
    if (error.code === 'DRIVE_FILE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
        fileId: req.params.fileId
      });
    }
    
    if (error.code === 'DRIVE_ACCESS_DENIED') {
      return res.status(403).json({
        success: false,
        error: 'Access denied to file',
        code: 'ACCESS_DENIED',
        fileId: req.params.fileId
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'DOWNLOAD_ERROR',
      fileId: req.params.fileId
    });
  }
}));

// GET /api/drive/files/:fileId/metadata - Get file metadata
router.get('/drive/files/:fileId/metadata', wrap(async (req, res) => {
  try {
    const { fileId } = req.params;
    
    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required',
        code: 'MISSING_FILE_ID'
      });
    }
    
    console.log('[AnalyticsAPI] Getting file metadata:', fileId);
    
    // Import GoogleDriveService
    const GoogleDriveService = require('../services/GoogleDriveService');
    const googleDriveService = new GoogleDriveService();
    
    // Get file metadata
    const metadata = await googleDriveService.getFileMetadata(fileId);
    
    res.json({
      success: true,
      fileId: fileId,
      metadata: {
        id: metadata.id,
        name: metadata.name,
        mimeType: metadata.mimeType,
        size: metadata.size ? parseInt(metadata.size) : null,
        createdTime: metadata.createdTime,
        modifiedTime: metadata.modifiedTime,
        parents: metadata.parents || [],
        // Additional computed fields
        isImage: metadata.mimeType && metadata.mimeType.startsWith('image/'),
        isVideo: metadata.mimeType && metadata.mimeType.startsWith('video/'),
        sizeFormatted: metadata.size ? formatFileSize(parseInt(metadata.size)) : null
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AnalyticsAPI] Error getting file metadata:', error);
    
    if (error.code === 'DRIVE_FILE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        code: 'FILE_NOT_FOUND',
        fileId: req.params.fileId
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'METADATA_ERROR',
      fileId: req.params.fileId
    });
  }
}));

// GET /api/drive/files - List files with filtering and pagination
router.get('/drive/files', wrap(async (req, res) => {
  try {
    const { 
      folderId, 
      mimeType, 
      limit = 50, 
      pageToken,
      search 
    } = req.query;
    
    console.log('[AnalyticsAPI] Listing files with params:', { folderId, mimeType, limit, search });
    
    // Import GoogleDriveService
    const GoogleDriveService = require('../services/GoogleDriveService');
    const googleDriveService = new GoogleDriveService();
    
    // Build query
    let query = 'trashed=false';
    
    if (folderId) {
      query += ` and '${folderId}' in parents`;
    }
    
    if (mimeType) {
      if (mimeType === 'image') {
        query += ` and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/gif' or mimeType='image/webp')`;
      } else if (mimeType === 'video') {
        query += ` and mimeType contains 'video/'`;
      } else {
        query += ` and mimeType='${mimeType}'`;
      }
    }
    
    if (search) {
      query += ` and name contains '${search}'`;
    }
    
    // List files
    const files = await googleDriveService.listByQuery(
      query,
      "files(id,name,mimeType,size,createdTime,modifiedTime,parents,thumbnailLink),nextPageToken",
      parseInt(limit)
    );
    
    // Format response
    const formattedFiles = files.map(file => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size ? parseInt(file.size) : null,
      sizeFormatted: file.size ? formatFileSize(parseInt(file.size)) : null,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
      parents: file.parents || [],
      thumbnailLink: file.thumbnailLink,
      isImage: file.mimeType && file.mimeType.startsWith('image/'),
      isVideo: file.mimeType && file.mimeType.startsWith('video/')
    }));
    
    res.json({
      success: true,
      files: formattedFiles,
      total: formattedFiles.length,
      query: {
        folderId,
        mimeType,
        search,
        limit: parseInt(limit)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AnalyticsAPI] Error listing files:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'LIST_FILES_ERROR'
    });
  }
}));

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = router;
