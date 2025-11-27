// index.js
require('dotenv').config();

// Kiểm tra biến môi trường ngay sau khi load
console.log('[BOOT]', { 
  PORT: process.env.PORT, 
  DB: process.env.PGDATABASE, 
  SELF: process.env.SELF_BASE_URL,
  PGHOST: process.env.PGHOST,
  PGUSER: process.env.PGUSER
});

const path = require("path");
const express = require("express");
const cors = require("cors");

// Import config và middleware
const { config, validateConfig } = require("./config");
const { registerDriveWebhook, handleWebhookRequest } = require("./webhook");
const { validateRequest, validateFileUpload, validateRateLimit } = require("./middleware/validation");
const { errorHandler, notFoundHandler, gracefulShutdown, asyncHandler, AppError } = require("./middleware/errorHandler");
const { addCorrelationId } = require("./middleware/correlationId");
const { logger } = require("./src/utils/logger");
const { healthCheckMiddleware, detailedHealthCheckMiddleware } = require("./middleware/healthCheck");
const { hmacVerify } = require("./middleware/hmacVerify");
const { agentRateLimit, pageRateLimit, criticalRateLimit } = require("./middleware/rateLimit");
const cron = require('node-cron');

// Import Services
const GoogleDriveService = require('./src/services/GoogleDriveService');
const FacebookService = require('./src/services/FacebookService');

// Import Token Vault modules
const tokenVaultRouter = require('./src/routes/tokenVault');
const { initCleanupCron } = require('./src/token/cleanup');

// Import Analytics API
const analyticsApiRouter = require('./src/routes/analyticsApi');




// Validate config khi khởi động
try {
  validateConfig();
  logger.info('system_startup', { 
    message: 'Configuration validated successfully',
    environment: config.server.nodeEnv 
  });
} catch (error) {
  logger.error('system_startup_error', { 
    message: 'Configuration validation failed',
    error: error.message 
  });
  process.exit(1);
}

const app = express();

// Add correlation ID middleware
app.use(addCorrelationId);

// CORS configuration từ config
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-agent', 'x-signature', 'x-ts', 'x-correlation-id']
}));

// Handle preflight requests
app.options('*', (req, res) => {
  res.status(204).end();
});

// Body parsing với limits từ config
app.use(express.json({ limit: `${config.security.maxRequestSizeMB}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${config.security.maxRequestSizeMB}mb` }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../Public')));

// Health check endpoints
app.get("/health", healthCheckMiddleware);
app.get("/health/detailed", detailedHealthCheckMiddleware);
app.post("/health/check", asyncHandler(async (req, res) => {
  const { healthChecker } = require("./middleware/healthCheck");
  const status = await healthChecker.runChecks();
  res.json(status);
}));

// Test endpoint để kiểm tra hệ thống
app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "API server is running!",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    workers: config.queue.workerConcurrency || 'not set',
    envVars: {
      WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
      NODE_ENV: process.env.NODE_ENV,
      REDIS_URL: process.env.REDIS_URL ? 'set' : 'not set'
    },
    config: {
      workerConcurrency: config.queue.workerConcurrency,
      maxRetries: config.queue.maxRetries,
      jobTimeoutMs: config.queue.jobTimeoutMs
    }
  });
});

// Token Vault endpoints
app.use('/token', tokenVaultRouter);

// Migrated API endpoints (PostgreSQL) - PHẢI ĐẶT TRƯỚC
const migratedApiRouter = require('./src/routes/migratedApi');
app.use('/api', migratedApiRouter);

// Analytics API endpoints (bao gồm cả pages, stats và health)
app.use('/api', analyticsApiRouter);

// Analytics Admin endpoints
const analyticsAdminRouter = require('./src/routes/analyticsAdmin');
app.use('/admin', analyticsAdminRouter);

// Pages API endpoints (với kết nối PostgreSQL + Firestore)
const pagesApiRouter = require('./src/routes/pagesApi');
app.use('/api', pagesApiRouter);

// Folder Statistics API endpoints (Fast PostgreSQL-based)
const foldersStatsRouter = require('./src/routes/foldersStatsApi');
app.use('/api/folder-stats', foldersStatsRouter);

// Worker control API endpoints
const workerApiRouter = require('./src/routes/workerApi');
app.use('/api', workerApiRouter);

// Swipe Links API endpoints
const swipeLinksApiRouter = require('./src/routes/swipeLinksApi');
app.use('/api/swipe-links', swipeLinksApiRouter);

/* =========================
 * Services
 * ========================= */
const googleDriveService = new GoogleDriveService();
const facebookService = new FacebookService();

/* =========================
 * PostgreSQL Database Connection
 * ========================= */
const { pool } = require('./src/db');

/* =========================
 * Helpers
 * ========================= */
function dayVN() { // YYYY-MM-DD theo GMT+7
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

/**
 * Convert Firestore Timestamp or Date to JavaScript Date safely
 * @param {any} value - Firestore Timestamp, Date, or timestamp number
 * @returns {Date} JavaScript Date object
 */
function toDateSafe(value) {
  if (!value) return new Date();
  
  if (typeof value === 'object' && value.toDate) {
    // Firestore Timestamp
    return value.toDate();
  } else if (value instanceof Date) {
    // JavaScript Date
    return value;
  } else if (typeof value === 'number') {
    // Unix timestamp (seconds or milliseconds)
    return new Date(value > 1000000000000 ? value : value * 1000);
  } else if (typeof value === 'string') {
    // ISO string
    return new Date(value);
  }
  
  return new Date();
}

// Sử dụng GoogleDriveService để download file
async function downloadDriveFileAsBuffer(fileId) {
  try {
    return await googleDriveService.downloadFileAsBuffer(fileId);
  } catch (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

// Retry có backoff cho lỗi tạm thời (HTTP 5xx, hoặc FB code 1/2)
async function withRetry(fn, { retries = 3, baseDelay = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(i + 1);
    } catch (e) {
      lastErr = e;
      const is5xx = e?.status && String(e.status).startsWith("5");
      const fbCode = e?.fb?.code;
      const transient = is5xx || [1, 2].includes(fbCode);
      if (!transient || i === retries - 1) throw e;
      await sleep(baseDelay * Math.pow(2, i)); // exponential backoff
    }
  }
  throw lastErr;
}

// Sử dụng GoogleDriveService để liệt kê file
async function listByQuery(
  q,
  fields = "files(id,name,mimeType,parents,createdTime),nextPageToken",
  pageSize = 1000
) {
  return await googleDriveService.listByQuery(q, fields, pageSize);
}

// Sử dụng GoogleDriveService để quét cây thư mục
async function listAllImagesRecursive(rootFolderId) {
  return await googleDriveService.listAllImagesRecursive(rootFolderId);
}

/* =========================
 * FB helpers (Sử dụng FacebookService)
 * ========================= */
async function fbUploadPhoto({ pageId, pageToken, fileBuf, mime, caption }) {
  try {
    return await facebookService.uploadPhoto({ pageId, pageToken, fileBuf, mime, caption });
  } catch (error) {
    throw new Error(`[FB] ${error.message}`);
  }
}

async function fbComment({ photoId, pageToken, message }) {
  try {
    return await facebookService.postComment({ photoId, pageToken, message });
  } catch (error) {
    throw new Error(`[FB_COMMENT] ${error.message}`);
  }
}

/* =========================
 * APIs
 * ========================= */

// ❌ REMOVED: Old Firestore folders API - replaced by PostgreSQL in migratedApi.js

// ❌ REMOVED: /api/captions API - Firestore dependency removed

// ❌ REMOVED: /api/comments API - Firestore dependency removed

// Lấy ảnh trực tiếp trong 1 folder (không đệ quy) — debug
app.get("/list", asyncHandler(async (req, res) => {
  const { folderId } = req.query;
  if (!folderId) return res.status(400).json({ error: "Missing folderId" });

  const limit = Math.min(Math.max(parseInt(req.query.limit || '1000', 10), 1), 5000);
  const pageToken = req.query.pageToken || null;

  const q = `'${folderId}' in parents and trashed=false and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`;
  const resp = await drive.files.list({
    q,
    fields: "files(id,name,createdTime,parents,mimeType),nextPageToken",
    pageSize: limit,
    pageToken,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  res.json({ items: resp.data.files || [], nextPageToken: resp.data.nextPageToken || null });
}));

// Stream ảnh gốc
app.get("/blob/:fileId", asyncHandler(async (req, res) => {
  const fileId = req.params.fileId;
  const { buf, mime } = await downloadDriveFileAsBuffer(fileId);
  res.set("Content-Type", mime);
  res.send(buf);
}));

// Stream thumbnail (resized image)
app.get("/thumbnail/:fileId", asyncHandler(async (req, res) => {
  const fileId = req.params.fileId;
  const size = req.query.size || '220'; // Default thumbnail size
  
  try {
    const { buf, mime } = await downloadDriveFileAsBuffer(fileId);
    
    // Set appropriate headers for thumbnail
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=3600"); // Cache 1 hour
    res.set("Content-Length", buf.length);
    
    // For now, return the original image
    // TODO: Implement actual thumbnail resizing
    res.send(buf);
  } catch (error) {
    console.error('❌ Error serving thumbnail:', error);
    res.status(404).json({ error: 'Thumbnail not found' });
  }
}));

// Quét cả cây thư mục — debug/manual
app.get("/listAll", asyncHandler(async (req, res) => {
  const { rootFolderId } = req.query;
  if (!rootFolderId) return res.status(400).json({ error: "Missing rootFolderId" });

  const files = await listAllImagesRecursive(rootFolderId);
  const normalized = files.map(f => ({
    id: f.id,
    name: f.name,
    createdTime: f.createdTime,
    parents: f.parents || [],
    mimeType: f.mimeType || 'image/jpeg',
    thumbnailLink: f.thumbnailLink || null,
  })).sort((a, b) => {
    if (a.createdTime === b.createdTime) return a.id.localeCompare(b.id);
    return a.createdTime.localeCompare(b.createdTime);
  });

  const limit = Math.min(Math.max(parseInt(req.query.limit || '5000', 10), 1), 20000);
  let after = null;
  if (req.query.after) {
    try { after = JSON.parse(req.query.after); } catch { after = null; }
  }

  let startIdx = 0;
  if (after && after.createdTime && after.id) {
    startIdx = normalized.findIndex(x => x.createdTime === after.createdTime && x.id === after.id) + 1;
    if (startIdx < 0) startIdx = 0;
  }

  const slice = normalized.slice(startIdx, startIdx + limit);
  const nextAfter = slice.length ? {
    createdTime: slice[slice.length - 1].createdTime,
    id: slice[slice.length - 1].id
  } : null;

  res.json({ items: slice, nextAfter, total: normalized.length });
}));

// ❌ REMOVED: /reserve API - Firestore dependency removed
// ❌ REMOVED: /pageUsed/check API - Firestore dependency removed  
// ❌ REMOVED: /pageUsed/mark API - Firestore dependency removed
// Duplicate checking is now handled by PostLogsService in postingLogic.js

// ✅ NEW: Check if file has been used recently (PostgreSQL-based)
app.post('/api/files/check-used', 
  validateRequest('pageUsed'),
  asyncHandler(async (req, res) => {
    const { pageId, fileId } = req.validated;
    
    try {
      const PostLogsService = require('./src/services/PostLogsService');
      
      // Check if file was used in last 14 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      
      const recentFiles = await PostLogsService.getRecentFiles(pageId, cutoff);
      const isUsed = recentFiles.some(file => file.fileId === fileId);
      
      res.json({ 
        ok: !isUsed, 
        isUsed: isUsed,
        fileId: fileId,
        pageId: pageId,
        checkedAt: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('[API] Error checking file usage:', error);
      throw new AppError('Failed to check file usage', 500, 'FILE_USAGE_CHECK_ERROR', { originalError: error.message });
    }
  })
);

/* ===== Cấu hình Page ===== */
app.get('/pageCfg', asyncHandler(async (req, res) => {
  const { pageId } = req.query;
  if (!pageId) {
    throw new AppError('Missing pageId parameter', 400, 'MISSING_PAGE_ID');
  }
  
  // ✅ READ FROM POSTGRESQL FIRST
  try {
    const PageConfigsService = require('./src/services/PageConfigsService');
    const config = await PageConfigsService.getConfig(pageId);
    
    if (config) {
      // Map PostgreSQL format to Extension format
      const result = {
        enabled: config.enabled || false,
        folderIds: config.folderIds || [],  // ✅ Already camelCase from service
        schedule: config.schedule || [],
        postsPerSlot: config.postsPerSlot || 1,  // ✅ Already camelCase from service
        defaultCaption: config.defaultCaption || "",  // ✅ Already camelCase from service
        captionByFolder: config.captionByFolder || {}  // ✅ Already camelCase from service
      };
      
      console.log('[pageCfg] ✅ Loaded from PostgreSQL:', { pageId, enabled: result.enabled });
      return res.json(result);
    }
  } catch (pgError) {
    console.error('[pageCfg] PostgreSQL read failed:', pgError.message);
    throw new AppError('Failed to read page configuration', 500, 'PAGE_CONFIG_READ_ERROR', { originalError: pgError.message });
  }
  
  // No fallback - PostgreSQL only
  console.log('[pageCfg] ❌ Page config not found in PostgreSQL:', pageId);
  res.status(404).json({ error: 'Page config not found' });
}));

app.post('/pageCfg', 
  validateRequest('pageCfg'),
  asyncHandler(async (req, res) => {
    console.log('[pageCfg] incoming request:', { 
      body: req.body, 
      validated: req.validated,
      timestamp: new Date().toISOString()
    });
    
    const { pageId, enabled, folderIds, schedule, postsPerSlot, defaultCaption, captionByFolder } = req.validated;
    
    // Validate schedule format
    if (schedule && Array.isArray(schedule)) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      const invalidTimes = schedule.filter(time => !timeRegex.test(time));
      if (invalidTimes.length > 0) {
        console.log('[pageCfg] validation error:', { pageId, invalidTimes });
        throw new AppError(
          `Invalid time format in schedule: ${invalidTimes.join(', ')}. Use HH:MM format.`, 
          400, 
          'INVALID_SCHEDULE_FORMAT',
          { pageId, invalidTimes }
        );
      }
    }
    
    // ✅ SAVE TO POSTGRESQL FIRST (with JSONB support)
    try {
      const PageConfigsService = require('./src/services/PageConfigsService');
      
      await PageConfigsService.setConfig(pageId, {
        enabled: !!enabled,
        folder_ids: folderIds || [],
        schedule: schedule || [],
        posts_per_slot: postsPerSlot || 1,
        default_caption: defaultCaption || "",
        caption_by_folder: captionByFolder || {}
      });
      
      console.log('[pageCfg] ✅ Saved to PostgreSQL:', { pageId, enabled });
    } catch (pgError) {
      console.error('[pageCfg] PostgreSQL save failed:', pgError.message);
      throw new AppError('Failed to save page configuration', 500, 'PAGE_CONFIG_SAVE_ERROR', { originalError: pgError.message });
    }
    
    console.log('[pageCfg] success:', { pageId, enabled, timestamp: new Date().toISOString() });
    res.json({ ok: true });
  })
);

  // ===== Page Story Folder Mapping (per Page) =====
  // GET /api/pages/:pageId/story-folder -> { success, storyFolderId|null }
  app.get('/api/pages/:pageId/story-folder', asyncHandler(async (req, res) => {
    const { pageId } = req.params;
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT story_folder_id FROM page_story_folders WHERE page_id = $1`,
          [pageId]
        );
        const storyFolderId = result.rows[0]?.story_folder_id || null;
        res.json({ success: true, storyFolderId });
      } finally { client.release(); }
    } catch (error) {
      console.error('[API] Get story folder error:', error);
      res.status(500).json({ success: false, error: 'Failed to get story folder', details: error.message });
    }
  }));

  // POST /api/pages/:pageId/story-folder { storyFolderId }
  app.post('/api/pages/:pageId/story-folder', asyncHandler(async (req, res) => {
    const { pageId } = req.params;
    const { storyFolderId } = req.body || {};
    if (!storyFolderId || typeof storyFolderId !== 'string') {
      return res.status(400).json({ success: false, error: 'storyFolderId is required' });
    }
    try {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO page_story_folders (page_id, story_folder_id, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (page_id) DO UPDATE SET story_folder_id = EXCLUDED.story_folder_id, updated_at = NOW()`,
          [pageId, storyFolderId]
        );
        res.json({ success: true, pageId, storyFolderId });
      } finally { client.release(); }
    } catch (error) {
      console.error('[API] Set story folder error:', error);
      res.status(500).json({ success: false, error: 'Failed to set story folder', details: error.message });
    }
  }));

  // DELETE /api/pages/:pageId/story-folder
  app.delete('/api/pages/:pageId/story-folder', asyncHandler(async (req, res) => {
    const { pageId } = req.params;
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(`DELETE FROM page_story_folders WHERE page_id = $1`, [pageId]);
        res.json({ success: true, deleted: result.rowCount > 0 });
      } finally { client.release(); }
    } catch (error) {
      console.error('[API] Delete story folder error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete story folder', details: error.message });
    }
  }));

  // GET /api/images/random-story?pageId=... -> picks random from story folder if configured; otherwise returns image=null
  app.get('/api/images/random-story', asyncHandler(async (req, res) => {
    try {
      const { pageId } = req.query;
      if (!pageId) {
        return res.status(400).json({ success: false, error: 'Missing pageId' });
      }

      const client = await pool.connect();
      try {
        // 1) Lookup story folder for page
        const linkResult = await client.query(
          `SELECT story_folder_id FROM page_story_folders WHERE page_id = $1`,
          [pageId]
        );
        const storyFolderId = linkResult.rows[0]?.story_folder_id || null;
        if (!storyFolderId) {
          return res.json({ success: true, image: null, reason: 'NO_STORY_FOLDER' });
        }

        // 2) Get image_count for the story folder
        const countResult = await client.query(
          `SELECT image_count FROM folders WHERE id = $1`,
          [storyFolderId]
        );
        const imageCount = Math.max(parseInt(countResult.rows[0]?.image_count || 0, 10), 0);
        if (imageCount === 0) {
          return res.json({ success: true, image: null, reason: 'EMPTY_STORY_FOLDER' });
        }

        // 3) Random offset and select one image
        const offset = Math.floor(Math.random() * imageCount);
        const imageResult = await client.query(
          `SELECT id, name, created_time, parents, mime_type
          FROM images
          WHERE parents::jsonb ? $1
          ORDER BY created_time ASC, id ASC
          OFFSET $2 LIMIT 1`,
          [storyFolderId, offset]
        );

        if (imageResult.rows.length === 0) {
          return res.json({ success: true, image: null, reason: 'NO_IMAGE_AT_OFFSET' });
        }

        const row = imageResult.rows[0];
        const image = {
          id: row.id,
          name: row.name,
          createdTime: row.created_time,
          parents: row.parents,
          mimeType: row.mime_type,
          thumbnailLink: `${config.server.selfBaseUrl}/thumbnail/${row.id}?size=220`,
          folderId: storyFolderId
        };

        res.json({ success: true, image });
      } finally { client.release(); }
    } catch (error) {
      console.error('[API] /api/images/random-story error:', error);
      res.status(500).json({ success: false, error: 'Random story image selection failed', details: error.message });
    }
  }));

// API để load images theo folder ID (cho frontend)
app.get('/api/folders/:folderId/images', asyncHandler(async (req, res) => {
  const { folderId } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
  
  try {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT id, name, created_time, parents, mime_type, thumbnail_link, last_synced_at
        FROM images
        WHERE parents::jsonb ? $1
        ORDER BY created_time ASC, id ASC
        LIMIT $2
      `;
      
      const result = await client.query(query, [folderId, limit]);
      
      const images = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdTime: row.created_time,
        parents: row.parents,
        mimeType: row.mime_type,
        thumbnailLink: `${config.server.selfBaseUrl}/thumbnail/${row.id}?size=220`
      }));
      
      res.json({
        success: true,
        images: images,
        total: images.length,
        folderId: folderId
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Lỗi load images cho folder:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to load folder images',
      details: error.message 
    });
  }
}));

// Random image across one or more folders (weighted by folders.image_count)
app.get('/api/images/random', asyncHandler(async (req, res) => {
  try {
    // Collect folderIds from query (can be multiple)
    let folderIds = req.query.folderIds;
    if (!folderIds) {
      return res.status(400).json({ success: false, error: 'Missing folderIds' });
    }
    if (!Array.isArray(folderIds)) {
      folderIds = [folderIds];
    }
    // Normalize and dedupe
    folderIds = [...new Set(folderIds.filter(id => typeof id === 'string' && id.trim().length > 0))];
    if (folderIds.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid folderIds' });
    }

    const client = await pool.connect();
    try {
      // Fetch image_count for provided folders
      const countsResult = await client.query(
        `SELECT id, image_count FROM folders WHERE id = ANY($1)`,
        [folderIds]
      );
      const rows = countsResult.rows || [];
      if (rows.length === 0) {
        return res.status(404).json({ success: false, error: 'No folders found' });
      }

      // Build weighted distribution
      const candidates = rows
        .map(r => ({ id: r.id, count: Math.max(parseInt(r.image_count || 0, 10), 0) }))
        .filter(r => r.count > 0);
      if (candidates.length === 0) {
        return res.status(404).json({ success: false, error: 'No images in specified folders' });
      }

      const total = candidates.reduce((sum, c) => sum + c.count, 0);
      // Weighted pick
      const pick = Math.floor(Math.random() * total);
      let acc = 0;
      let chosen = candidates[0];
      for (const c of candidates) {
        acc += c.count;
        if (pick < acc) { chosen = c; break; }
      }

      const offset = Math.floor(Math.random() * chosen.count);

      // Select one image by offset within chosen folder
      const imageResult = await client.query(
        `SELECT id, name, created_time, parents, mime_type
         FROM images
         WHERE parents::jsonb ? $1
         ORDER BY created_time ASC, id ASC
         OFFSET $2 LIMIT 1`,
        [chosen.id, offset]
      );

      if (imageResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'No image found at chosen position' });
      }

      const row = imageResult.rows[0];
      const image = {
        id: row.id,
        name: row.name,
        createdTime: row.created_time,
        parents: row.parents,
        mimeType: row.mime_type,
        thumbnailLink: `${config.server.selfBaseUrl}/thumbnail/${row.id}?size=220`,
        folderId: chosen.id
      };

      res.json({ success: true, image });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[API] /api/images/random error:', error);
    res.status(500).json({ success: false, error: 'Random image selection failed', details: error.message });
  }
}));

/* ===== Manifest ảnh đã xử lý sẵn (đọc từ PostgreSQL) – API cực nhẹ ===== */
app.get('/manifest', asyncHandler(async (req, res) => {
  console.log(`📄 Đọc manifest từ PostgreSQL`);

  try {
    const client = await pool.connect();

    try {
      // Parse query parameters
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10), 1), 20000) : null;
    let after = req.query.after ? JSON.parse(req.query.after) : null;
    let folderIds = req.query.folderIds ? (Array.isArray(req.query.folderIds) ? req.query.folderIds : [req.query.folderIds]) : null;

      // Build SQL query
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      // Filter by folder IDs if provided
    if (folderIds && folderIds.length > 0) {
        const folderConditions = folderIds.map((folderId) => {
          const condition = `parents::jsonb ? $${paramIndex}`;
          queryParams.push(folderId);
          paramIndex++;
          return condition;
        });
        whereConditions.push(`(${folderConditions.join(' OR ')})`);
      }

      // Pagination with cursor
    if (after && after.createdTime && after.id) {
        whereConditions.push(`(created_time > $${paramIndex} OR (created_time = $${paramIndex} AND id > $${paramIndex + 1}))`);
        queryParams.push(after.createdTime, after.id);
        paramIndex += 2;
      }

      // Build final query
      let baseQuery = `
        SELECT id, name, created_time, parents, mime_type, thumbnail_link, last_synced_at
        FROM images
      `;
      
      if (whereConditions.length > 0) {
        baseQuery += ` WHERE ${whereConditions.join(' AND ')}`;
      }
      
      baseQuery += ` ORDER BY created_time ASC, id ASC`;
      
      if (limit) {
        baseQuery += ` LIMIT $${paramIndex}`;
        queryParams.push(limit);
      }

      // Execute query
      const result = await client.query(baseQuery, queryParams);
      
      // Transform results to match expected format
      const items = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdTime: row.created_time,
        parents: row.parents,
        mimeType: row.mime_type,
        thumbnailLink: `${config.server.selfBaseUrl}/thumbnail/${row.id}?size=220`
      }));

      // Calculate nextAfter cursor
      let nextAfter = null;
      if (limit && items.length === limit) {
        const lastItem = items[items.length - 1];
        nextAfter = {
          createdTime: lastItem.createdTime,
          id: lastItem.id
        };
      }

      // Get total count for filtered results
      let totalCount = 0;
      if (folderIds && folderIds.length > 0) {
        const countQuery = `
          SELECT COUNT(*) as total 
          FROM images 
          WHERE ${folderIds.map((_, i) => `parents::jsonb ? $${i + 1}`).join(' OR ')}
        `;
        const countResult = await client.query(countQuery, folderIds);
        totalCount = parseInt(countResult.rows[0].total);
      } else {
        const countResult = await client.query('SELECT COUNT(*) as total FROM images');
        totalCount = parseInt(countResult.rows[0].total);
      }

      res.set({ 'Cache-Control': 'private, no-cache' });
  res.json({
    items,
    nextAfter,
        total: totalCount,
        totalUnfiltered: totalCount,
        source: 'postgresql'
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Lỗi đọc manifest từ PostgreSQL:', error);
    throw new AppError('Failed to read manifest from database', 500, 'MANIFEST_READ_ERROR', { originalError: error.message });
  }
}));


/* ===== Agent/profile báo cáo + phân quyền Page ===== */
app.post('/agent/hello', 
  validateRequest('agentHello'),
  asyncHandler(async (req, res) => {
    const { agentId, agentLabel, extVersion, pages = [] } = req.validated;
    await agentsCol.doc(agentId).set({
      agentLabel: agentLabel || null,
      extVersion: extVersion || null,
      pages: pages.map(p => ({ id: p.id, name: p.name })),
      lastSeen: Date.now()
    }, { merge: true });
    res.json({ ok: true });
  })
);

app.get('/assignments', asyncHandler(async (req, res) => {
  const { agentId } = req.query;
  if (!agentId) {
    throw new AppError('Missing agentId parameter', 400, 'MISSING_AGENT_ID');
  }
  const doc = await assignmentsCol.doc(agentId).get();
  res.json(doc.exists ? doc.data() : { allowedPages: [] });
}));

app.post('/assignments', 
  validateRequest('assignments'),
  asyncHandler(async (req, res) => {
    const { agentId, allowedPages = [] } = req.validated;
    await assignmentsCol.doc(agentId).set({ allowedPages, updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true });
  })
);

// Import PostingService
const PostingService = require('./src/services/PostingService');
const { firestoreSet } = require('./src/utils/firestoreRetry');

// Helper function để xác định lỗi nghiêm trọng cần review
function isCriticalError(error) {
  // Facebook API errors nghiêm trọng
  if (error.fb?.code === 102) return true; // Token expired
  if (error.fb?.code === 190) return true; // Invalid OAuth access token
  if (error.fb?.code === 200) return true; // Permissions error
  if (error.fb?.code === 1) return true;   // Unknown error
  
  // Error codes nghiêm trọng
  const criticalErrorCodes = [
    'FB_UPLOAD_ERROR',
    'FB_PERMISSION_ERROR',
    'DRIVE_DOWNLOAD_ERROR'
  ];
  
  return criticalErrorCodes.includes(error.code);
}

// Helper function để lấy mô tả Facebook error
function getFacebookErrorDescription(fbCode) {
  const descriptions = {
    1: 'Unknown error',
    2: 'Service temporarily unavailable',
    4: 'Application request limit reached',
    17: 'User request limit reached',
    100: 'Invalid parameter',
    102: 'Session has expired',
    190: 'Invalid OAuth access token',
    200: 'Permissions error',
    2500: 'Unknown path components',
    2501: 'Some of the aliases you requested do not exist',
    2502: 'API unknown',
    2503: 'Unable to resolve IP address',
    2504: 'API service',
    2505: 'API method',
    2506: 'API too many calls',
    2507: 'API user too many calls',
    2508: 'API application too many calls',
    2509: 'API deprecated',
    2510: 'API version',
    2511: 'API permission',
    2512: 'API user permission',
    2513: 'API application permission',
    2514: 'API application permission',
    2515: 'API application permission',
    2516: 'API application permission',
    2517: 'API application permission',
    2518: 'API application permission',
    2519: 'API application permission',
    2520: 'API application permission'
  };
  
  return descriptions[fbCode] || 'Unknown Facebook error';
}

/* ===== MANUAL POSTING API ===== */

// POST /api/post/manual - Manual posting for Extension
app.post('/api/post/manual', 
  validateRequest('manualPost'),
  asyncHandler(async (req, res) => {
    const { pageIds, priority = 'high', agentId } = req.validated;
    
    console.log('[ManualPost] Manual posting request:', { pageIds, priority, agentId });
    
    if (!pageIds || pageIds.length === 0) {
      throw new AppError('At least one pageId is required', 400, 'MISSING_PAGE_IDS');
    }
    
    const results = [];
    const jobsCreated = [];
    
    try {
      // Create immediate posting jobs for each page
      for (const pageId of pageIds) {
        try {
          // Generate unique job ID
          const jobId = `manual_${pageId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const requestId = `ext_${agentId || 'unknown'}_${Date.now()}`;
          
          // Create job document
          const jobData = {
            pageId: pageId.toString(),
            requestId,
            priority, // 'high' for manual posts
            status: 'pending',
            scheduledTime: new Date(), // Immediate execution
            createdAt: new Date(),
            source: 'extension_manual',
            agentId: agentId || null,
            metadata: {
              type: 'manual',
              triggeredBy: 'extension',
              userAgent: req.headers['user-agent'] || null
            }
          };
          
          // Save to PostgreSQL posting queue (PostgreSQL only)
          const PostingQueueService = require('./src/services/PostingQueueService');
          const postingQueueService = new PostingQueueService();
          await postingQueueService.addJob(jobData);
          console.log(`[ManualPost] ✅ Job created in PostgreSQL for page ${pageId}: ${jobId}`);
          
          jobsCreated.push({
            jobId,
            pageId,
            requestId,
            status: 'queued',
            scheduledTime: jobData.scheduledTime
          });
          
          console.log(`[ManualPost] ✅ Job created for page ${pageId}: ${jobId}`);
          
        } catch (pageError) {
          console.error(`[ManualPost] ❌ Failed to create job for page ${pageId}:`, pageError);
          
          results.push({
            pageId,
            status: 'error',
            error: pageError.message,
            timestamp: new Date()
          });
        }
      }
      
      // Update nextJobTime để worker check sớm hơn nếu có manual jobs
      if (jobsCreated.length > 0) {
        try {
          const { updateNextJobTime } = require('./scheduler');
          await updateNextJobTime();
          console.log(`[ManualPost] ✅ Updated nextJobTime after creating ${jobsCreated.length} manual jobs`);
        } catch (updateError) {
          console.warn('[ManualPost] ⚠️ Failed to update nextJobTime:', updateError.message);
          // Don't fail the request if update fails
        }
      }
      
      // Return response
      const response = {
        success: true,
        message: `${jobsCreated.length} posting jobs created successfully`,
        data: {
          jobsCreated: jobsCreated.length,
          totalRequested: pageIds.length,
          jobs: jobsCreated,
          errors: results.filter(r => r.status === 'error')
        },
        timestamp: new Date()
      };
      
      console.log('[ManualPost] ✅ Manual posting jobs created:', {
        success: jobsCreated.length,
        errors: results.length,
        pageIds
      });
      
      res.json(response);
      
    } catch (error) {
      console.error('[ManualPost] ❌ Manual posting failed:', error);
      
      throw new AppError(
        'Failed to create manual posting jobs', 
        500, 
        'MANUAL_POST_FAILED',
        { pageIds, originalError: error.message }
      );
    }
  })
);

// GET /api/post/status/:requestId - Check posting status
app.get('/api/post/status/:requestId', asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  
  try {
    // Query jobs by requestId
    const jobsSnapshot = await queueCol.where('requestId', '==', requestId).get();
    
    if (jobsSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: 'Request not found',
        requestId
      });
    }
    
    const jobs = jobsSnapshot.docs.map(doc => ({
      jobId: doc.id,
      ...doc.data()
    }));
    
    // Get posting logs if completed
    const logs = [];
    for (const job of jobs) {
      if (job.status === 'completed' || job.status === 'failed') {
        const logSnapshot = await postLogsCol.where('requestId', '==', requestId).get();
        logs.push(...logSnapshot.docs.map(doc => ({ logId: doc.id, ...doc.data() })));
      }
    }
    
    res.json({
      success: true,
      requestId,
      jobs,
      logs,
      summary: {
        total: jobs.length,
        pending: jobs.filter(j => j.status === 'pending').length,
        processing: jobs.filter(j => j.status === 'processing').length,
        completed: jobs.filter(j => j.status === 'completed').length,
        failed: jobs.filter(j => j.status === 'failed').length
      }
    });
    
  } catch (error) {
    console.error('[PostStatus] Error checking status:', error);
    throw new AppError('Failed to check posting status', 500, 'STATUS_CHECK_FAILED');
  }
}));

// Helper function để xác định mức độ nghiêm trọng của lỗi
function getErrorSeverity(errorCode, fbCode) {
  // Critical errors
  if (fbCode === 102 || fbCode === 190 || fbCode === 200) return 'critical';
  if (['FB_UPLOAD_ERROR', 'FB_PERMISSION_ERROR', 'DRIVE_DOWNLOAD_ERROR'].includes(errorCode)) return 'high';
  
  // Medium errors
  if (['FB_COMMENT_ERROR', 'FILE_VALIDATION_ERROR'].includes(errorCode)) return 'medium';
  
  // Low errors
  return 'low';
}

// API POST /postPhoto - Đăng ảnh lên Facebook
app.post("/postPhoto", 
  hmacVerify,
  agentRateLimit(),
  pageRateLimit(),
  validateRequest('postPhoto'),
  asyncHandler(async (req, res) => {
    const { pageId, pageToken, fileId, caption, comment } = req.validated;
    
    const startTime = Date.now();
    const PostLogsService = require('./src/services/PostLogsService');
    const postLogsService = new PostLogsService();

    logger.info('api_post_photo_started', { 
      pageId, 
      fileId, 
      correlationId: req.correlationId 
    });

    // Ghi log bắt đầu vào PostgreSQL
    const logId = await postLogsService.createLog({
      pageId,
      fileId,
      caption: caption || '',
      comment: comment || '',
      status: "started",
      ts: new Date(),
      correlationId: req.correlationId
    });

    try {
      // Sử dụng PostingService để thực hiện đăng bài
      const postingService = new PostingService();
      const result = await postingService.executePost({
        pageId,
        pageToken,
        fileId,
        caption,
        comment,
        correlationId: req.correlationId
      });

      // Ghi log thành công vào PostgreSQL
      await postLogsService.updateLog(logId, {
        status: "success",
        photoId: result.mediaId,
        commentId: result.commentId,
        fbResponse: result.uploadResult,
        completedAt: new Date(),
        fileName: result.fileName,
        folderId: result.folderId,
        totalTime: result.duration,
        requestDuration: Date.now() - startTime,
        stepLogs: result.stepLogs
      });

      const duration = Date.now() - startTime;
      logger.info('api_post_photo_success', { 
        pageId, 
        fileId, 
        photoId: result.mediaId,
        duration,
        correlationId: req.correlationId 
      });

      return res.json({ 
        ok: true, 
        photoId: result.mediaId,
        logId: logId,
        fileName: result.fileName,
        folderId: result.folderId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Ghi log lỗi chi tiết vào PostgreSQL
      await postLogsService.updateLog(logId, {
        status: "failed",
        errorMessage: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        fbCode: error.fb?.code,
        fbType: error.fb?.type,
        completedAt: new Date(),
        totalTime: duration,
        requestDuration: duration,
        stepLogs: error.details?.stepLogs || [],
        needsReview: isCriticalError(error)
      });

      logger.error('api_post_photo_failed', { 
        pageId, 
        fileId, 
        error: error.message,
        errorCode: error.code,
        fbCode: error.fb?.code,
        fbType: error.fb?.type,
        duration,
        correlationId: req.correlationId,
        logId: logId
      });

      // Re-throw error để asyncHandler xử lý
      throw error;
    }
  })
);

// API GET /postLogs - Lấy lịch sử đăng bài từ PostgreSQL
app.get("/postLogs", asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10), 1), 1000);
  const status = req.query.status; // 'success', 'failed', 'started'
  const pageId = req.query.pageId;
  const correlationId = req.query.correlationId;
  
  try {
    const client = await pool.connect();
    
    try {
      // Build SQL query
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;
  
  // Filter theo status
  if (status && ['success', 'failed', 'started'].includes(status)) {
        whereConditions.push(`status = $${paramIndex}`);
        queryParams.push(status);
        paramIndex++;
  }
  
  // Filter theo pageId
  if (pageId) {
        whereConditions.push(`page_id = $${paramIndex}`);
        queryParams.push(pageId);
        paramIndex++;
  }
  
  // Filter theo correlationId
  if (correlationId) {
        whereConditions.push(`correlation_id = $${paramIndex}`);
        queryParams.push(correlationId);
        paramIndex++;
      }

      // Build final query
      let baseQuery = `
        SELECT id, log_id, page_id, file_id, caption, comment, status, ts, correlation_id, 
               photo_id, comment_id, fb_response, completed_at, file_name, folder_id, 
               total_time, request_duration, step_logs, error_message, error_code, 
               error_details, fb_code, fb_type, needs_review, severity
        FROM post_logs
      `;
      
      if (whereConditions.length > 0) {
        baseQuery += ` WHERE ${whereConditions.join(' AND ')}`;
      }
      
      baseQuery += ` ORDER BY ts DESC LIMIT $${paramIndex}`;
      queryParams.push(limit);

      // Execute query
      const result = await client.query(baseQuery, queryParams);
      
      // Transform results
      const logs = result.rows.map(row => ({
        id: row.log_id || row.id,
        logId: row.log_id,
        pageId: row.page_id,
        fileId: row.file_id,
        caption: row.caption,
        comment: row.comment,
        status: row.status,
        ts: row.ts,
        correlationId: row.correlation_id,
        photoId: row.photo_id,
        commentId: row.comment_id,
        fbResponse: row.fb_response,
        completedAt: row.completed_at,
        fileName: row.file_name,
        folderId: row.folder_id,
        totalTime: row.total_time,
        requestDuration: row.request_duration,
        stepLogs: row.step_logs,
        errorMessage: row.error_message,
        errorCode: row.error_code,
        errorDetails: row.error_details,
        fbCode: row.fb_code,
        fbType: row.fb_type,
        needsReview: row.needs_review,
        severity: row.severity
      }));
  
  // Thống kê
  const stats = {
    total: logs.length,
    success: logs.filter(log => log.status === 'success').length,
    failed: logs.filter(log => log.status === 'failed').length,
    started: logs.filter(log => log.status === 'started').length,
    needsReview: logs.filter(log => log.needsReview === true).length,
    // Error code breakdown
    errorCodes: logs
      .filter(log => log.status === 'failed' && log.errorCode)
      .reduce((acc, log) => {
        acc[log.errorCode] = (acc[log.errorCode] || 0) + 1;
        return acc;
      }, {}),
    // Facebook error codes
    fbErrorCodes: logs
      .filter(log => log.status === 'failed' && log.fbCode)
      .reduce((acc, log) => {
        acc[log.fbCode] = (acc[log.fbCode] || 0) + 1;
        return acc;
      }, {}),
    // Performance metrics
    avgRequestDuration: logs
      .filter(log => log.requestDuration)
      .reduce((sum, log) => sum + log.requestDuration, 0) / 
      logs.filter(log => log.requestDuration).length || 0
  };
  
  res.json({
    logs,
    stats,
    filters: {
      status,
      pageId,
      correlationId,
      limit
        },
        source: 'postgresql'
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Lỗi đọc post logs từ PostgreSQL:', error);
    throw new AppError('Failed to read post logs from database', 500, 'POST_LOGS_READ_ERROR', { originalError: error.message });
  }
}));

// API GET /postLogs/:logId - Lấy chi tiết log theo ID từ PostgreSQL
app.get("/postLogs/:logId", asyncHandler(async (req, res) => {
  const { logId } = req.params;
  
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(
        `SELECT id, log_id, page_id, file_id, caption, comment, status, ts, correlation_id, 
                photo_id, comment_id, fb_response, completed_at, file_name, folder_id, 
                total_time, request_duration, step_logs, error_message, error_code, 
                error_details, fb_code, fb_type, needs_review, severity
         FROM post_logs 
         WHERE log_id = $1 OR id = $1`,
        [logId]
      );
      
      if (result.rows.length === 0) {
    return res.status(404).json({
      ok: false,
      error: 'Log not found',
      code: 'LOG_NOT_FOUND',
      logId
    });
  }
  
      const row = result.rows[0];
      const logData = {
        id: row.log_id || row.id,
        logId: row.log_id,
        pageId: row.page_id,
        fileId: row.file_id,
        caption: row.caption,
        comment: row.comment,
        status: row.status,
        ts: row.ts,
        correlationId: row.correlation_id,
        photoId: row.photo_id,
        commentId: row.comment_id,
        fbResponse: row.fb_response,
        completedAt: row.completed_at,
        fileName: row.file_name,
        folderId: row.folder_id,
        totalTime: row.total_time,
        requestDuration: row.request_duration,
        stepLogs: row.step_logs,
        errorMessage: row.error_message,
        errorCode: row.error_code,
        errorDetails: row.error_details,
        fbCode: row.fb_code,
        fbType: row.fb_type,
        needsReview: row.needs_review,
        severity: row.severity
      };
  
  // Nếu là error log, thêm thông tin phân tích
  if (logData.status === 'failed') {
    const analysis = {
      errorType: logData.errorCode,
      fbError: logData.fbCode ? {
        code: logData.fbCode,
        type: logData.fbType,
        description: getFacebookErrorDescription(logData.fbCode)
      } : null,
      stepLogs: logData.stepLogs || [],
      failedStep: logData.stepLogs?.find(step => step.status === 'failed')?.step,
      duration: logData.totalTime,
      requestDuration: logData.requestDuration,
      timestamp: logData.completedAt,
      needsReview: logData.needsReview,
      severity: getErrorSeverity(logData.errorCode, logData.fbCode)
    };
    
    return res.json({
      ok: true,
      log: {
        ...logData,
        analysis
          },
          source: 'postgresql'
    });
  }
  
  res.json({
    ok: true,
        log: logData,
        source: 'postgresql'
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Lỗi đọc post log từ PostgreSQL:', error);
    throw new AppError('Failed to read post log from database', 500, 'POST_LOG_READ_ERROR', { originalError: error.message });
  }
}));

// API GET /postLogs/review/needed - Lấy logs cần review từ PostgreSQL
app.get("/postLogs/review/needed", asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
  
  try {
    const client = await pool.connect();
    
    try {
      const result = await client.query(`
        SELECT id, log_id, page_id, file_id, caption, comment, status, ts, correlation_id, 
               photo_id, comment_id, fb_response, completed_at, file_name, folder_id, 
               total_time, request_duration, step_logs, error_message, error_code, 
               error_details, fb_code, fb_type, needs_review, severity
        FROM post_logs 
        WHERE needs_review = true
        ORDER BY completed_at DESC
        LIMIT $1
      `, [limit]);
      
      const logs = result.rows.map(row => ({
        id: row.log_id || row.id,
        logId: row.log_id,
        pageId: row.page_id,
        fileId: row.file_id,
        caption: row.caption,
        comment: row.comment,
        status: row.status,
        ts: row.ts,
        correlationId: row.correlation_id,
        photoId: row.photo_id,
        commentId: row.comment_id,
        fbResponse: row.fb_response,
        completedAt: row.completed_at,
        fileName: row.file_name,
        folderId: row.folder_id,
        totalTime: row.total_time,
        requestDuration: row.request_duration,
        stepLogs: row.step_logs,
        errorMessage: row.error_message,
        errorCode: row.error_code,
        errorDetails: row.error_details,
        fbCode: row.fb_code,
        fbType: row.fb_type,
        needsReview: row.needs_review,
        severity: row.severity
      }));
  
  // Thống kê theo severity
  const severityStats = logs.reduce((acc, log) => {
    const severity = getErrorSeverity(log.errorCode, log.fbCode);
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});
  
  res.json({
    logs,
    stats: {
      total: logs.length,
      severity: severityStats
        },
        source: 'postgresql'
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Lỗi đọc logs cần review từ PostgreSQL:', error);
    throw new AppError('Failed to read review logs from database', 500, 'REVIEW_LOGS_READ_ERROR', { originalError: error.message });
  }
}));

/* ===== Google Drive Webhook Endpoint ===== */
app.post("/drive/webhook", asyncHandler(async (req, res) => {
  await handleWebhookRequest(req, res);
}));

// Legacy API endpoint (keep for backward compatibility)
app.post("/api/drive-webhook", asyncHandler(async (req, res) => {
  await handleWebhookRequest(req, res);
}));

/* ===== Cron Fallback for Manifest Sync ===== */
// Sử dụng PostgreSQL SystemStateService cho locking
const SystemStateService = require('./src/services/SystemStateService');

// Chạy mỗi 15 phút để đồng bộ manifest (fallback cho webhook)
if (config.server.nodeEnv === 'production') {
  cron.schedule(config.manifestSync.cronInterval, async () => {
    const now = new Date();
    try {
      // Kiểm tra lock trong PostgreSQL
      const lockData = await SystemStateService.getDocument('manifest_sync_lock');
      
      if (lockData && lockData.status === 'running') {
        const lockTime = new Date(lockData.lockedAt);
          const maxLockDuration = config.manifestSync.lockTimeoutMs;
          
        if ((now - lockTime) > maxLockDuration) {
            console.log(`⚠️ Lock đã quá hạn (${Math.floor((now - lockTime) / 1000 / 60)} phút), sẽ override`);
          } else {
            console.log(`⚠️ Manifest sync is already running. Skipping this run.`);
          return;
          }
        }

        // Đặt khóa với trạng thái 'running'
      await SystemStateService.setDocument('manifest_sync_lock', {
          status: 'running', 
        lockedAt: now.toISOString(),
          processId: process.pid,
          hostname: require('os').hostname(),
        lockTimeout: new Date(now.getTime() + config.manifestSync.lockTimeoutMs).toISOString()
      });
      
      // Nếu không có lỗi, tiến hành chạy tác vụ
      console.log('🕐 Cron job: Đồng bộ manifest định kỳ...');
      
      // Gọi worker để đồng bộ manifest
      const { spawn } = require('child_process');
      const worker = spawn('node', ['worker.js'], {
        cwd: __dirname,
        stdio: 'pipe'
      });
      
      worker.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Cron job: Đồng bộ manifest thành công');
        } else {
          console.warn(`⚠️ Cron job: Đồng bộ manifest thất bại với code ${code}`);
        }
      });
      
      worker.on('error', (error) => {
        console.error('❌ Cron job: Lỗi khi chạy worker:', error);
      });

    } catch (error) {
        console.error('❌ Cron job: Lỗi đồng bộ manifest:', error);
      return;
    }
    
    // Chỉ giải phóng khóa nếu đã chiếm thành công
    try {
      await SystemStateService.setDocument('manifest_sync_lock', {
        status: 'idle', 
        unlockedAt: new Date().toISOString(),
        lastRunAt: now.toISOString()
      });
      console.log('🔓 Manifest sync lock released');
    } catch (lockError) {
      console.error('❌ Lỗi khi giải phóng lock:', lockError);
    }
  });
  
  console.log('⏰ Cron fallback đã được thiết lập (chạy mỗi 15 phút) với PostgreSQL locking');
}

// Khởi tạo Token Vault cleanup cron job
initCleanupCron();
console.log('🧹 Token Vault cleanup cron job đã được thiết lập (chạy mỗi đêm lúc 2:00 AM)');

// API để đăng ký webhook (chỉ dùng trong development hoặc admin)
app.post("/api/register-webhook", 
  validateRequest('webhookRegistration'),
  asyncHandler(async (req, res) => {
    const { webhookUrl } = req.validated;
    const result = await registerDriveWebhook(webhookUrl);
    res.json({ ok: true, result });
  })
);

// Đăng ký error handling middleware (phải ở cuối, trước 404 handler)
app.use(errorHandler);

// Runtime metrics endpoint
app.get('/api/runtime-metrics', (req, res) => {
  try { 
    res.json({ 
      ok: true, 
      metrics: require('./src/metrics/metrics').snapshot() 
    }); 
  } catch(e) { 
    res.status(500).json({ 
      ok: false, 
      error: e.message 
    }); 
  }
});



// Worker API endpoint - Lấy page token không cần authentication
app.get('/api/worker/token/:pageId', asyncHandler(async (req, res) => {
  try {
    const { pageId } = req.params;
    
    // Import Redis-based token store functions
    const { 
      getBestTokenCandidate, 
      loadEncryptedById
    } = require('./src/token/tokenStore.redis');
    
    // Import KMS functions for decryption
    const { decryptTokenWithWrapping } = require('./src/token/kms');
    
    // Lấy best token candidate từ Redis
    const candidate = await getBestTokenCandidate(pageId);
    
    if (!candidate) {
      return res.status(404).json({ 
        error: 'No active tokens found for page',
        pageId 
      });
    }
    
    // Load encrypted token data
    const encryptedData = await loadEncryptedById(pageId, candidate.tokenId);
    
    if (!encryptedData) {
      return res.status(500).json({ 
        error: 'Token data not found',
        pageId 
      });
    }
    
    // Decrypt token
    const decryptedToken = decryptTokenWithWrapping(encryptedData);
    
    res.json({ 
      token: decryptedToken,
      pageId,
      tokenId: candidate.tokenId,
      status: candidate.meta.status,
      issuedAt: candidate.meta.issuedAt
    });
    
  } catch (error) {
    console.error(`[WorkerAPI] Error getting token for page ${req.params.pageId}:`, error);
    res.status(500).json({ 
      error: 'Failed to get page token',
      message: error.message 
    });
  }
}));

// 404 handler
app.use(notFoundHandler);

/* =========================
 * Start server
 * ========================= */
const server = app.listen(config.server.port, () => {
  console.log(`✅ Drive proxy running at http://localhost:${config.server.port}`);
  console.log(`🌍 Environment: ${config.server.nodeEnv}`);
  console.log(`🔍 Health check: http://localhost:${config.server.port}/health`);
  console.log(`🔍 Detailed health check: http://localhost:${config.server.port}/health/detailed`);
  
  // In danh sách routes để debug
  console.log('\n🚀 === MOUNTED ROUTES ===');
  console.log('  GET /health');
  console.log('  GET /health/detailed');
  console.log('  GET /api/test');
  console.log('  GET /api/worker/token/:pageId');
  console.log('  POST /token/user/paste');
  console.log('  GET /token/page/:pageId');
  console.log('  POST /token/page/rotate-bulk');
  console.log('  POST /postPhoto');
  console.log('  GET /manifest');
  console.log('  POST /drive/webhook');
  console.log('  GET /api/runtime-metrics');
  console.log('🚀 === END ROUTES ===\n');
});

// Graceful shutdown
process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));