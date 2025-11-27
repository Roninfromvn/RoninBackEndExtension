// analyticsAdmin.js - Analytics administration routes
require('dotenv').config();

// Kiểm tra biến môi trường
console.log('[AnalyticsAdmin] Environment check:', { 
  SELF_BASE_URL: process.env.SELF_BASE_URL 
});

const express = require('express');
const router = express.Router();

// Import database connection
const { pool } = require('../db');

// POST /admin/sync-pages-to-pg - Đồng bộ pages từ Token Vault sang PostgreSQL
router.post('/sync-pages-to-pg', async (req, res) => {
  try {
    console.log('[AnalyticsAdmin] Starting pages sync...');
    
    // Gọi nội bộ /token/pages để lấy danh sách pages
    const base = process.env.SELF_BASE_URL || 'http://localhost:3210';
    const response = await fetch(`${base}/token/pages`);
    
    if (!response.ok) {
      throw new Error(`/token/pages failed: ${response.status} ${response.statusText}`);
    }
    
    const payload = await response.json();
    const pages = payload.pages || [];
    
    console.log(`[AnalyticsAdmin] Found ${pages.length} pages in Token Vault`);
    
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.json({ 
        synced: 0, 
        note: 'no pages from token vault',
        timestamp: new Date().toISOString()
      });
    }

    // Kết nối database và thực hiện sync
    const client = await pool.connect();
    let syncedCount = 0;
    
    try {
      await client.query('BEGIN');
      
      for (const page of pages) {
        // Chuẩn hóa dữ liệu
        const page_id = typeof page === 'string' ? page : (page.pageId || page.id);
        const page_name = typeof page === 'string' ? null : (page.name || page.pageName || null);
        
        if (!page_id) {
          console.log(`[AnalyticsAdmin] Skipping page with invalid ID:`, page);
          continue;
        }
        
        // UPSERT vào bảng pages
        await client.query(`
          INSERT INTO pages(page_id, page_name, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP)
          ON CONFLICT (page_id) 
          DO UPDATE SET 
            page_name = COALESCE(EXCLUDED.page_name, pages.page_name),
            updated_at = CURRENT_TIMESTAMP
        `, [page_id, page_name]);
        
        syncedCount++;
        console.log(`[AnalyticsAdmin] Synced page: ${page_id} (${page_name || 'unnamed'})`);
      }
      
      await client.query('COMMIT');
      console.log(`[AnalyticsAdmin] Successfully synced ${syncedCount} pages`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    res.json({ 
      synced: syncedCount,
      total: pages.length,
      timestamp: new Date().toISOString(),
      message: `Successfully synced ${syncedCount} pages to PostgreSQL`
    });
    
  } catch (error) {
    console.error('[AnalyticsAdmin] Sync failed:', error.message);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /admin/pages - Lấy danh sách pages từ PostgreSQL
router.get('/pages', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT page_id, page_name, created_at, updated_at
        FROM pages 
        ORDER BY page_id
        LIMIT 1000
      `);
      
      res.json({
        pages: result.rows,
        total: result.rows.length,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAdmin] Get pages failed:', error.message);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /admin/run-ingestion - Chạy worker ingestion
router.post('/run-ingestion', async (req, res) => {
  try {
    const { targetDate } = req.body;
    const date = targetDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`[AnalyticsAdmin] Triggering ingestion for date: ${date}`);
    
    // Import và chạy worker
    const { runIngestion } = require('../../workers/simple_stats_worker');
    await runIngestion(date);
    
    res.json({
      success: true,
      message: `Ingestion completed for ${date}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AnalyticsAdmin] Ingestion trigger failed:', error.message);
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /admin/health - Health check cho analytics admin
router.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      // Test database connection
      await client.query('SELECT 1 as test');
      
      // Count pages
      const pagesResult = await client.query('SELECT COUNT(*) as count FROM pages');
      const pagesCount = parseInt(pagesResult.rows[0].count);
      
      res.json({
        status: 'healthy',
        database: 'connected',
        pages_count: pagesCount,
        timestamp: new Date().toISOString()
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('[AnalyticsAdmin] Health check failed:', error.message);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
