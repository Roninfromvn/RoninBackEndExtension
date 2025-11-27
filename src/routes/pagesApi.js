// pagesApi.js - Pages API với kết nối PostgreSQL + Firestore
const express = require('express');
const router = express.Router();
const { Firestore } = require('@google-cloud/firestore');
const path = require('path');

// Import database connection
const { pool } = require('../db');

// Khởi tạo Firestore
let firestore;
try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    console.log('🔐 [PagesAPI] Using Firestore credentials from environment variables');
    firestore = new Firestore({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      },
      projectId: process.env.GOOGLE_PROJECT_ID
    });
  } else {
    console.log('🔐 [PagesAPI] Using Firestore key file');
    firestore = new Firestore({
      keyFilename: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH || './service-account.json'
    });
  }
} catch (error) {
  console.error('❌ [PagesAPI] Firestore initialization failed:', error.message);
  firestore = null;
}

// Collections
const pageCfgCol = firestore ? firestore.collection('page_cfg') : null;
const foldersCol = firestore ? firestore.collection('folders') : null;

// Wrapper function để xử lý async errors
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ============================================================================
// PAGES ENDPOINTS - THỨ TỰ QUAN TRỌNG!
// ============================================================================

// 1. GET /api/pages - Lấy danh sách tất cả pages với data hoàn chỉnh
router.get('/pages', wrap(async (req, res) => {
  try {
    const { status, limit = 100, offset = 0, sort = 'created_at', order = 'desc' } = req.query;
    
    let whereClause = '';
    let params = [];
    let paramIndex = 1;
    
    if (status) {
      whereClause = 'WHERE p.status = $1';
      params.push(status);
      paramIndex++;
    }
    
    // Query cơ bản từ PostgreSQL - LẤY DỮ LIỆU THẬT TỪ SQL
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
        -- Lấy stats thật từ page_stats_daily hoặc từ posts table
        COALESCE(
          (SELECT fan_count FROM page_stats_daily ps WHERE ps.page_id = p.page_id AND ps.date = CURRENT_DATE),
          (SELECT COUNT(*) FROM posts WHERE page_id = p.page_id) * 100, -- Fallback: estimate từ số posts
          0
        ) as fan_count,
        COALESCE(
          (SELECT follower_count FROM page_stats_daily ps WHERE ps.page_id = p.page_id AND ps.date = CURRENT_DATE),
          (SELECT COUNT(*) FROM posts WHERE page_id = p.page_id) * 50, -- Fallback: estimate từ số posts
          0
        ) as follower_count,
        -- Sync tracking
        COALESCE(sync.last_sync_time, p.created_at) as last_sync_time,
        COALESCE(sync.posts_count, 0) as posts_count
      FROM pages p
      LEFT JOIN LATERAL (
        SELECT last_sync_time, posts_count
        FROM sync_tracking st
        WHERE st.page_id = p.page_id
      ) sync ON true
      ${whereClause}
      ORDER BY p.${sort} ${order.toUpperCase()}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const limitParam = parseInt(limit);
    const offsetParam = parseInt(offset);
    params.push(limitParam, offsetParam);
    
    const client = await pool.connect();
    
    try {
      const result = await client.query(query, params);
      
      // Lấy thêm data từ Firestore (pageCfg)
      const pagesWithFirestoreData = await Promise.all(
        result.rows.map(async (page) => {
          if (!firestore || !pageCfgCol) {
            return {
              ...page,
              folderIds: [],
              enabled: true,
              schedule: [],
              postsPerSlot: 1,
              defaultCaption: '',
              captionByFolder: {}
            };
          }
          
          try {
            const pageCfgDoc = await pageCfgCol.doc(page.page_id).get();
            if (pageCfgDoc.exists) {
              const pageCfg = pageCfgDoc.data();
              return {
                ...page,
                folderIds: pageCfg.folderIds || [],
                enabled: pageCfg.enabled !== false,
                schedule: pageCfg.schedule || [],
                postsPerSlot: pageCfg.postsPerSlot || 1,
                defaultCaption: pageCfg.defaultCaption || '',
                captionByFolder: pageCfg.captionByFolder || {}
              };
            } else {
              return {
                ...page,
                folderIds: [],
                enabled: true,
                schedule: [],
                postsPerSlot: 1,
                defaultCaption: '',
                captionByFolder: {}
              };
            }
          } catch (error) {
            console.warn(`[PagesAPI] Error getting Firestore data for page ${page.page_id}:`, error.message);
            return {
              ...page,
              folderIds: [],
              enabled: true,
              schedule: [],
              postsPerSlot: 1,
              defaultCaption: '',
              captionByFolder: {}
            };
          }
        })
      );
      
      res.json({
        success: true,
        pages: pagesWithFirestoreData,
        total: pagesWithFirestoreData.length,
        pagination: {
          limit: limitParam,
          offset: offsetParam,
          sort,
          order
        },
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[PagesAPI] Get pages error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// 2. GET /api/pages/search - Tìm kiếm pages (PHẢI ĐỂ TRƯỚC /:pageId)
router.get('/pages/search', wrap(async (req, res) => {
  try {
    const { q, status, limit = 20, offset = 0 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Search query is required' 
      });
    }
    
    let whereClause = 'WHERE (p.page_name ILIKE $1 OR p.notes ILIKE $1)';
    let params = [`%${q.trim()}%`];
    let paramIndex = 2;
    
    if (status) {
      whereClause += ' AND p.status = $' + paramIndex;
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
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN p.page_name ILIKE $1 THEN 1
          WHEN p.page_name ILIKE $1 || '%' THEN 2
          ELSE 3
        END,
        p.page_name
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    const limitParam = parseInt(limit);
    const offsetParam = parseInt(offset);
    params.push(limitParam, offsetParam);
    
    const client = await pool.connect();
    
    try {
      const result = await client.query(query, params);
      
      // Lấy thêm data từ Firestore
      const pagesWithFirestoreData = await Promise.all(
        result.rows.map(async (page) => {
          if (!firestore || !pageCfgCol) {
            return { ...page, folderIds: [], enabled: true };
          }
          
          try {
            const pageCfgDoc = await pageCfgCol.doc(page.page_id).get();
            if (pageCfgDoc.exists) {
              const pageCfg = pageCfgDoc.data();
              return {
                ...page,
                folderIds: pageCfg.folderIds || [],
                enabled: pageCfg.enabled !== false
              };
            } else {
              return { ...page, folderIds: [], enabled: true };
            }
          } catch (error) {
            console.warn(`[PagesAPI] Error getting Firestore data for page ${page.page_id}:`, error.message);
            return { ...page, folderIds: [], enabled: true };
          }
        })
      );
      
      res.json({
        success: true,
        pages: pagesWithFirestoreData,
        total: pagesWithFirestoreData.length,
        query: q.trim(),
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
    console.error('[PagesAPI] Search pages error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// 3. POST /api/pages/by-ids - Lấy pages theo specific page IDs (FAST VERSION)
router.post('/pages/by-ids', wrap(async (req, res) => {
  try {
    const { pageIds } = req.body;
    
    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'pageIds array is required' 
      });
    }
    
    // Validate pageIds
    const validPageIds = pageIds.filter(id => id && typeof id === 'string').slice(0, 100); // Limit to 100 pages
    
    if (validPageIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No valid page IDs provided' 
      });
    }
    
    // Create placeholders for IN clause
    const placeholders = validPageIds.map((_, index) => `$${index + 1}`).join(',');
    
    // 🚀 OPTIMIZED QUERY - Bỏ subqueries phức tạp để tăng tốc
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
        -- Simplified stats - chỉ lấy từ page_stats_daily, không fallback
        COALESCE(ps.fan_count, 0) as fan_count,
        COALESCE(ps.follower_count, 0) as follower_count,
        -- Sync info
        COALESCE(sync.last_sync_time, p.created_at) as last_sync_time,
        COALESCE(sync.posts_count, 0) as posts_count
      FROM pages p
      LEFT JOIN page_stats_daily ps ON ps.page_id = p.page_id AND ps.date = CURRENT_DATE
      LEFT JOIN sync_tracking sync ON sync.page_id = p.page_id
      WHERE p.page_id IN (${placeholders})
      ORDER BY p.page_name
    `;
    
    const client = await pool.connect();
    
    try {
      const result = await client.query(query, validPageIds);
      
      // Lấy thêm data từ Firestore (pageCfg)
      const pagesWithFirestoreData = await Promise.all(
        result.rows.map(async (page) => {
          if (!firestore || !pageCfgCol) {
            return {
              ...page,
              folderIds: [],
              enabled: true,
              schedule: [],
              postsPerSlot: 1,
              defaultCaption: '',
              captionByFolder: {}
            };
          }
          
          try {
            const pageCfgDoc = await pageCfgCol.doc(page.page_id).get();
            if (pageCfgDoc.exists) {
              const pageCfg = pageCfgDoc.data();
              return {
                ...page,
                folderIds: pageCfg.folderIds || [],
                enabled: pageCfg.enabled !== false,
                schedule: pageCfg.schedule || [],
                postsPerSlot: pageCfg.postsPerSlot || 1,
                defaultCaption: pageCfg.defaultCaption || '',
                captionByFolder: pageCfg.captionByFolder || {}
              };
            } else {
              return {
                ...page,
                folderIds: [],
                enabled: true,
                schedule: [],
                postsPerSlot: 1,
                defaultCaption: '',
                captionByFolder: {}
              };
            }
          } catch (error) {
            console.warn(`[PagesAPI] Error getting Firestore data for page ${page.page_id}:`, error.message);
            return {
              ...page,
              folderIds: [],
              enabled: true,
              schedule: [],
              postsPerSlot: 1,
              defaultCaption: '',
              captionByFolder: {}
            };
          }
        })
      );
      
      res.json({
        success: true,
        pages: pagesWithFirestoreData,
        total: pagesWithFirestoreData.length,
        requestedIds: validPageIds.length,
        foundIds: pagesWithFirestoreData.length,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[PagesAPI] Get pages by IDs error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// 4. GET /api/pages/:pageId - Lấy thông tin chi tiết của một page
router.get('/pages/:pageId', wrap(async (req, res) => {
  try {
    const { pageId } = req.params;
    
    if (!pageId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing pageId parameter' 
      });
    }
    
    const client = await pool.connect();
    
    try {
      // Query thông tin chi tiết page với stats và tính toán change
      const result = await client.query(`
        SELECT 
          p.page_id,
          p.page_name,
          p.facebook_url,
          p.notes,
          p.status,
          p.avatar_url,
          p.created_at,
          p.updated_at,
          -- Stats hôm nay
          COALESCE(today_stats.fan_count, 0) as fan_count,
          COALESCE(today_stats.follower_count, 0) as follower_count,
          -- Stats hôm qua để tính change
          COALESCE(yesterday_stats.fan_count, 0) as yesterday_fan_count,
          COALESCE(yesterday_stats.follower_count, 0) as yesterday_follower_count,
          -- Sync tracking
          COALESCE(sync.last_sync_time, p.created_at) as last_sync_time,
          COALESCE(sync.posts_count, 0) as posts_count,
          COALESCE(sync.last_post_id, '') as last_post_id
        FROM pages p
        LEFT JOIN LATERAL (
          SELECT fan_count, follower_count
          FROM page_stats_daily ps
          WHERE ps.page_id = p.page_id
          AND ps.date = CURRENT_DATE
        ) today_stats ON true
        LEFT JOIN LATERAL (
          SELECT fan_count, follower_count
          FROM page_stats_daily ps
          WHERE ps.page_id = p.page_id
          AND ps.date = (CURRENT_DATE - INTERVAL '1 day')
        ) yesterday_stats ON true
        LEFT JOIN LATERAL (
          SELECT last_sync_time, posts_count, last_post_id
          FROM sync_tracking st
          WHERE st.page_id = p.page_id
        ) sync ON true
        WHERE p.page_id = $1
      `, [pageId]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Page not found',
          code: 'PAGE_NOT_FOUND',
          pageId: pageId
        });
      }
      
      const page = result.rows[0];
      
      // Lấy thêm data từ Firestore
      let firestoreData = {
        folderIds: [],
        enabled: true,
        schedule: [],
        postsPerSlot: 1,
        defaultCaption: '',
        captionByFolder: {}
      };
      
      if (firestore && pageCfgCol) {
        try {
          const pageCfgDoc = await pageCfgCol.doc(pageId).get();
          if (pageCfgDoc.exists) {
            const pageCfg = pageCfgDoc.data();
            firestoreData = {
              folderIds: pageCfg.folderIds || [],
              enabled: pageCfg.enabled !== false,
              schedule: pageCfg.schedule || [],
              postsPerSlot: pageCfg.postsPerSlot || 1,
              defaultCaption: pageCfg.defaultCaption || '',
              captionByFolder: pageCfg.captionByFolder || {}
            };
          }
        } catch (error) {
          console.warn(`[PagesAPI] Error getting Firestore data for page ${pageId}:`, error.message);
        }
      }
      
      // Tính toán change và growth
      const fanChange = page.fan_count - page.yesterday_fan_count;
      const followerChange = page.follower_count - page.yesterday_follower_count;
      
      const fanGrowth = page.yesterday_fan_count > 0 ? 
        ((fanChange / page.yesterday_fan_count) * 100).toFixed(1) : '0.0';
      const followerGrowth = page.yesterday_follower_count > 0 ? 
        ((followerChange / page.yesterday_follower_count) * 100).toFixed(1) : '0.0';
      
      res.json({
        success: true,
        page: {
          page_id: page.page_id,
          page_name: page.page_name,
          facebook_url: page.facebook_url,
          notes: page.notes,
          status: page.status,
          avatar_url: page.avatar_url,
          created_at: page.created_at,
          updated_at: page.updated_at,
          // Stats
          fan_count: page.fan_count,
          follower_count: page.follower_count,
          fan_change: fanChange,
          follower_change: followerChange,
          fan_growth: `${fanChange >= 0 ? '+' : ''}${fanGrowth}%`,
          follower_growth: `${followerChange >= 0 ? '+' : ''}${followerGrowth}%`,
          // Sync info
          last_sync_time: page.last_sync_time,
          posts_count: page.posts_count,
          last_post_id: page.last_post_id,
          // Firestore data
          ...firestoreData
        },
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[PagesAPI] Get page details error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// 4. GET /api/pages/:pageId/posts - Lấy posts của một page
router.get('/pages/:pageId/posts', wrap(async (req, res) => {
  try {
    const { pageId } = req.params;
    const { page = 1, limit = 20, sort = 'created_time', order = 'desc' } = req.query;
    
    if (!pageId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing pageId parameter' 
      });
    }
    
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 posts per page
    const offset = (pageNum - 1) * limitNum;
    
    const client = await pool.connect();
    
    try {
      // Query posts với pagination
      const postsQuery = `
        SELECT 
          post_id,
          page_id,
          message,
          created_time,
          updated_time,
          permalink_url,
          link_ảnh,
          created_at,
          updated_at
        FROM posts
        WHERE page_id = $1
        ORDER BY ${sort} ${order.toUpperCase()}
        LIMIT $2 OFFSET $3
      `;
      
      const postsResult = await client.query(postsQuery, [pageId, limitNum, offset]);
      
      // Đếm tổng số posts
      const countQuery = `
        SELECT COUNT(*) as total
        FROM posts
        WHERE page_id = $1
      `;
      
      const countResult = await client.query(countQuery, [pageId]);
      const total = parseInt(countResult.rows[0].total);
      
      res.json({
        success: true,
        posts: postsResult.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: pageNum * limitNum < total,
          hasPrev: pageNum > 1
        },
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[PagesAPI] Get page posts error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

// 4. POST /api/pages/by-ids-fast - FAST VERSION (không Firestore)
router.post('/pages/by-ids-fast', wrap(async (req, res) => {
  try {
    const { pageIds } = req.body;
    
    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'pageIds array is required' 
      });
    }
    
    const validPageIds = pageIds.filter(id => id && typeof id === 'string').slice(0, 100);
    if (validPageIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No valid page IDs provided' 
      });
    }
    
    const placeholders = validPageIds.map((_, index) => `$${index + 1}`).join(',');
    
    // 🚀 ULTRA FAST QUERY - chỉ lấy basic info
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
        0 as fan_count,
        0 as follower_count,
        p.created_at as last_sync_time,
        0 as posts_count
      FROM pages p
      WHERE p.page_id IN (${placeholders})
      ORDER BY p.page_name
    `;
    
    const client = await pool.connect();
    try {
      const result = await client.query(query, validPageIds);
      
      // 🚀 NO FIRESTORE - just add defaults
      const pages = result.rows.map(page => ({
        ...page,
        folderIds: [],
        enabled: true,
        schedule: ['12:00'],
        postsPerSlot: 1,
        defaultCaption: '',
        captionByFolder: {}
      }));
      
      res.json({
        success: true,
        pages: pages,
        total: pages.length,
        requestedIds: validPageIds.length,
        foundIds: pages.length,
        timestamp: new Date().toISOString()
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[PagesAPI] Get pages by IDs (fast) error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
}));

module.exports = router;
