// workers/simple_stats_worker.js - Worker đơn giản để lấy page stats
// 
// FEATURES:
// - Chỉ lấy fan_count, follower_count hiện tại
// - Batch processing để tối ưu performance
// - Smart error handling và retry logic
// - Configurable và dễ maintain
// - Không phụ thuộc vào deprecated Facebook APIs

require('dotenv').config({ path: '../.env' });
const { pool } = require('../src/db');

// Configuration
const CONFIG = {
  // Facebook API
  FB_API_VERSION: process.env.FB_API_VERSION || 'v19.0',
  FB_BASE_URL: `https://graph.facebook.com/${process.env.FB_API_VERSION || 'v19.0'}`,
  
  // Backend API
  BACKEND_URL: process.env.SELF_BASE_URL || 'http://127.0.0.1:3210',
  
  // Processing
  BATCH_SIZE: 5, // Xử lý 5 pages cùng lúc
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000, // 2 giây
  
  // Timeouts
  REQUEST_TIMEOUT: 15000, // 15 giây
  SERVER_WAIT_TIMEOUT: 30000, // 30 giây
};

// Utility functions
const utils = {
  // Delay helper
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Format number for logging
  formatNumber: (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  },
  
  // Safe JSON parse
  safeJsonParse: (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
};

// HTTP client với retry logic
class HttpClient {
  constructor() {
    this.retryCount = 0;
  }
  
  async request(url, options = {}) {
    const { timeout = CONFIG.REQUEST_TIMEOUT, maxRetries = CONFIG.MAX_RETRIES, ...fetchOptions } = options;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, { 
          ...fetchOptions, 
          signal: controller.signal 
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const text = await response.text();
        return utils.safeJsonParse(text);
        
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`[HttpClient] Retry ${attempt}/${maxRetries} after ${delay}ms: ${error.message}`);
        await utils.delay(delay);
      }
    }
  }
  
  async get(url, options = {}) {
    return this.request(url, { method: 'GET', ...options });
  }
}

// Facebook API client
class FacebookAPI {
  constructor() {
    this.http = new HttpClient();
    this.baseUrl = CONFIG.FB_BASE_URL;
  }
  
  async getPageStats(pageId, accessToken, lastSyncTime = null) {
    try {
      const url = `${this.baseUrl}/${pageId}`;
      
      // Base fields
      let fields = 'fan_count,followers_count,picture';
      
      // Posts fields với limit cao hơn
      if (lastSyncTime) {
        // Incremental sync: chỉ lấy posts sau lastSyncTime
        const sinceTime = Math.floor(lastSyncTime.getTime() / 1000);
        fields += `,posts.since(${sinceTime}).limit(200){id,full_picture,created_time,from,permalink_url,updated_time,message}`;
      } else {
        // Full sync: lấy 200 posts gần nhất
        fields += `,posts.limit(200){id,full_picture,created_time,from,permalink_url,updated_time,message}`;
      }
      
      const params = {
        fields: fields,
        access_token: accessToken
      };
      
      const queryString = new URLSearchParams(params).toString();
      const fullUrl = `${url}?${queryString}`;
      
      console.log(`[FacebookAPI] Getting stats for page ${pageId}${lastSyncTime ? ' (incremental)' : ' (full)'}`);
      const data = await this.http.get(fullUrl);
      
      return {
        fan_count: data.fan_count || 0,
        followers_count: data.followers_count || 0,
        picture: data.picture?.data?.url || null,
        posts: data.posts?.data || [],
        paging: data.posts?.paging || null,
        success: true
      };
      
    } catch (error) {
      console.error(`[FacebookAPI] Error getting stats for page ${pageId}:`, error.message);
      return {
        fan_count: 0,
        followers_count: 0,
        picture: null,
        posts: [],
        paging: null,
        success: false,
        error: error.message
      };
    }
  }
  
  // Method để lấy posts tiếp theo (pagination)
  async getMorePosts(pageId, accessToken, nextUrl) {
    try {
      console.log(`[FacebookAPI] Getting more posts for page ${pageId} via pagination`);
      const data = await this.http.get(nextUrl);
      
      return {
        posts: data.data || [],
        paging: data.paging || null,
        success: true
      };
      
    } catch (error) {
      console.error(`[FacebookAPI] Error getting more posts for page ${pageId}:`, error.message);
      return {
        posts: [],
        paging: null,
        success: false,
        error: error.message
      };
    }
  }
}

// Backend API client
class BackendAPI {
  constructor() {
    this.http = new HttpClient();
    this.baseUrl = CONFIG.BACKEND_URL;
  }
  
  async waitForServer() {
    console.log(`[BackendAPI] Waiting for server at ${this.baseUrl}...`);
    
    for (let i = 0; i < 10; i++) {
      try {
        const response = await this.http.get(`${this.baseUrl}/health`, { timeout: 5000 });
        if (response.status === 'ok' || response.status === 'critical' || response.status === 'healthy') {
          console.log(`[BackendAPI] Server ready at ${this.baseUrl}`);
          return true;
        }
      } catch (error) {
        console.log(`[BackendAPI] Server not ready, attempt ${i + 1}/10`);
      }
      
      if (i < 9) await utils.delay(2000);
    }
    
    throw new Error(`Server not ready after 10 attempts`);
  }
  
  async getPageToken(pageId) {
    try {
      const data = await this.http.get(`${this.baseUrl}/api/worker/token/${pageId}`);
      return data.token;
    } catch (error) {
      console.error(`[BackendAPI] Error getting token for page ${pageId}:`, error.message);
      throw error;
    }
  }
  
  async getPages() {
    try {
      const data = await this.http.get(`${this.baseUrl}/api/pages`);
      return data.pages || [];
    } catch (error) {
      console.error(`[BackendAPI] Error getting pages:`, error.message);
      throw error;
    }
  }
}

// Database operations
class DatabaseOps {
  constructor() {
    this.pool = pool;
  }
  
  async updatePageStats(pageId, date, stats) {
    const client = await this.pool.connect();
    
    try {
      const { fan_count, followers_count, picture } = stats;
      
      // Update page stats
      await client.query(`
        INSERT INTO page_stats_daily (page_id, date, fan_count, follower_count, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (page_id, date) DO UPDATE SET 
          fan_count = EXCLUDED.fan_count,
          follower_count = EXCLUDED.follower_count,
          updated_at = NOW()
      `, [pageId, date, fan_count, followers_count]);
      
      // Update page avatar if available
      if (picture) {
        await client.query(`
          UPDATE pages SET avatar_url = $1, updated_at = NOW()
          WHERE page_id = $2
        `, [picture, pageId]);
      }
      
      console.log(`[DatabaseOps] Updated stats for page ${pageId}: ${utils.formatNumber(fan_count)} fans, ${utils.formatNumber(followers_count)} followers`);
      
    } finally {
      client.release();
    }
  }
  
  async updatePagePosts(pageId, posts) {
    if (!posts || posts.length === 0) return;
    
    const client = await this.pool.connect();
    
    try {
      for (const post of posts) {
        const { id, full_picture, created_time, permalink_url, message, updated_time } = post;
        
        // Insert/update post vào bảng posts
        await client.query(`
          INSERT INTO posts (post_id, page_id, created_time, updated_time, permalink_url, message, link_ảnh, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (post_id) DO UPDATE SET 
            updated_time = EXCLUDED.updated_time,
            permalink_url = EXCLUDED.permalink_url,
            message = EXCLUDED.message,
            link_ảnh = EXCLUDED.link_ảnh,
            updated_at = NOW()
        `, [
          id, 
          pageId, 
          new Date(created_time), 
          new Date(updated_time), 
          permalink_url, 
          message || '', 
          full_picture || null
        ]);

        // Insert reactions ban đầu vào post_reactions_daily
        await this.insertPostReactions(client, id, pageId, created_time);
      }
      
      console.log(`[DatabaseOps] Updated ${posts.length} posts for page ${pageId}`);
      
    } finally {
      client.release();
    }
  }

  async insertPostReactions(client, postId, pageId, createdTime) {
    try {
      const postDate = new Date(createdTime).toISOString().split('T')[0];
      
      // Insert reactions ban đầu với giá trị 0
      await client.query(`
        INSERT INTO post_reactions_daily (
          post_id, date, like_count, love_count, wow_count, haha_count,
          sad_count, angry_count, care_count, comments_count, shares_count, total_reactions
        ) VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (post_id, date) DO NOTHING
      `, [postId, postDate]);
      
      console.log(`[DatabaseOps] Inserted initial reactions for post ${postId} on ${postDate}`);
      
    } catch (error) {
      console.error(`[DatabaseOps] Error inserting initial reactions for post ${postId}:`, error.message);
    }
  }
  
  async getSyncTracking(pageId) {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT last_sync_time, last_post_id, posts_count
        FROM sync_tracking 
        WHERE page_id = $1
      `, [pageId]);
      
      return result.rows[0] || null;
      
    } finally {
      client.release();
    }
  }
  
  async updateSyncTracking(pageId, data) {
    const client = await this.pool.connect();
    
    try {
      const { last_sync_time, last_post_id, posts_count } = data;
      
      await client.query(`
        INSERT INTO sync_tracking (page_id, last_sync_time, last_post_id, posts_count, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (page_id) DO UPDATE SET 
          last_sync_time = EXCLUDED.last_sync_time,
          last_post_id = EXCLUDED.last_post_id,
          posts_count = EXCLUDED.posts_count,
          updated_at = NOW()
      `, [pageId, last_sync_time, last_post_id, posts_count]);
      
      console.log(`[DatabaseOps] Updated sync tracking for page ${pageId}`);
      
    } finally {
      client.release();
    }
  }
  
  async logIngestionRun(date, stats) {
    const client = await this.pool.connect();
    
    try {
      const { totalPages, successPages, failedPages } = stats;
      
      await client.query(`
        INSERT INTO ingestion_runs (run_date, status, pages_processed, pages_success, pages_failed, completed_at)
        VALUES ($1, 'success', $2, $3, $4, NOW())
        ON CONFLICT (run_date) DO UPDATE SET 
          status = 'success',
          pages_processed = EXCLUDED.pages_processed,
          pages_success = EXCLUDED.pages_success,
          pages_failed = EXCLUDED.pages_failed,
          completed_at = NOW(),
          error_message = NULL
      `, [date, totalPages, successPages, failedPages]);
      
      console.log(`[DatabaseOps] Logged ingestion run: ${successPages}/${totalPages} pages successful`);
      
    } finally {
      client.release();
    }
  }
}

// Main worker class
class SimpleStatsWorker {
  constructor() {
    this.facebookAPI = new FacebookAPI();
    this.backendAPI = new BackendAPI();
    this.dbOps = new DatabaseOps();
  }
  
  async processPage(pageId, pageName) {
    try {
      console.log(`[Worker] Processing page: ${pageId} (${pageName || 'unnamed'})`);
      
      // Lấy page token
      const pageToken = await this.backendAPI.getPageToken(pageId);
      
      // Kiểm tra sync tracking
      const syncInfo = await this.dbOps.getSyncTracking(pageId);
      const lastSyncTime = syncInfo?.last_sync_time;
      
      if (lastSyncTime) {
        console.log(`[Worker] Page ${pageId} last synced at: ${lastSyncTime}`);
      } else {
        console.log(`[Worker] Page ${pageId} first time sync`);
      }
      
      // Lấy page stats từ Facebook (incremental hoặc full)
      const stats = await this.facebookAPI.getPageStats(pageId, pageToken, lastSyncTime);
      
      if (stats.success) {
        // Nếu có pagination, lấy thêm posts
        let allPosts = [...stats.posts];
        let nextUrl = stats.paging?.next;
        
        // Lấy posts tiếp theo nếu có
        while (nextUrl && allPosts.length < 500) { // Giới hạn 500 posts
          const morePosts = await this.facebookAPI.getMorePosts(pageId, pageToken, nextUrl);
          if (morePosts.success && morePosts.posts.length > 0) {
            allPosts = [...allPosts, ...morePosts.posts];
            nextUrl = morePosts.paging?.next;
            console.log(`[Worker] Page ${pageId}: Got ${morePosts.posts.length} more posts, total: ${allPosts.length}`);
          } else {
            break;
          }
        }
        
        // Update stats với tất cả posts
        stats.posts = allPosts;
        
        return { success: true, stats, syncInfo };
      } else {
        return { success: false, error: stats.error };
      }
      
    } catch (error) {
      console.error(`[Worker] Error processing page ${pageId}:`, error.message);
      return { success: false, error: error.message };
    }
  }
  
  async processBatch(pages) {
    console.log(`[Worker] Processing batch of ${pages.length} pages...`);
    
    const results = await Promise.allSettled(
      pages.map(page => this.processPage(page.page_id, page.page_name))
    );
    
    const successful = [];
    const failed = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push({ page: pages[index], stats: result.value.stats });
      } else {
        failed.push({ page: pages[index], error: result.reason || result.value?.error });
      }
    });
    
    return { successful, failed };
  }
  
  async runIngestion(targetDate = null) {
    const date = targetDate || new Date().toISOString().split('T')[0];
    console.log(`\n🚀 [Worker] Starting simple stats ingestion for date: ${date}`);
    
    try {
      // Đợi server sẵn sàng
      await this.backendAPI.waitForServer();
      
      // Lấy danh sách pages
      const pages = await this.backendAPI.getPages();
      console.log(`[Worker] Found ${pages.length} pages to process`);
      
      if (pages.length === 0) {
        console.log('[Worker] No pages found, skipping ingestion.');
        return;
      }
      
      // Xử lý theo batch
      const batches = [];
      for (let i = 0; i < pages.length; i += CONFIG.BATCH_SIZE) {
        batches.push(pages.slice(i, i + CONFIG.BATCH_SIZE));
      }
      
      console.log(`[Worker] Processing ${pages.length} pages in ${batches.length} batches...`);
      
      let totalSuccessful = 0;
      let totalFailed = 0;
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`\n[Worker] Processing batch ${i + 1}/${batches.length} (${batch.length} pages)...`);
        
        const result = await this.processBatch(batch);
        
                 // Update database cho successful pages
         for (const { page, stats, syncInfo } of result.successful) {
           await this.dbOps.updatePageStats(page.page_id, date, stats);
           
           // Update posts if available
           if (stats.posts && stats.posts.length > 0) {
             await this.dbOps.updatePagePosts(page.page_id, stats.posts);
           }
           
           // Update sync tracking
           if (stats.posts && stats.posts.length > 0) {
             const lastPost = stats.posts[stats.posts.length - 1];
             await this.dbOps.updateSyncTracking(page.page_id, {
               last_sync_time: new Date(),
               last_post_id: lastPost.id,
               posts_count: (syncInfo?.posts_count || 0) + stats.posts.length
             });
           }
           
           totalSuccessful++;
         }
        
        // Log failed pages
        for (const { page, error } of result.failed) {
          console.error(`[Worker] Failed to process page ${page.page_id}: ${error}`);
          totalFailed++;
        }
        
        // Delay giữa các batch để tránh rate limit
        if (i < batches.length - 1) {
          console.log(`[Worker] Waiting 2 seconds before next batch...`);
          await utils.delay(2000);
        }
      }
      
      // Log ingestion run
      await this.dbOps.logIngestionRun(date, {
        totalPages: pages.length,
        successPages: totalSuccessful,
        failedPages: totalFailed
      });
      
      console.log(`\n✅ [Worker] Ingestion completed successfully!`);
      console.log(`📊 Summary: ${totalSuccessful}/${pages.length} pages processed successfully`);
      console.log(`❌ Failed: ${totalFailed} pages`);
      
    } catch (error) {
      console.error('\n❌ [Worker] Ingestion failed:', error.message);
      throw error;
    }
  }
}

// Export function để sử dụng
async function runIngestion(targetDate = null) {
  const worker = new SimpleStatsWorker();
  return await worker.runIngestion(targetDate);
}

// Run nếu được gọi trực tiếp
if (require.main === module) {
  const targetDate = process.argv[2];
  
  runIngestion(targetDate)
    .then(() => {
      console.log('\n🎉 Worker finished successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Worker finished with error:', error.message);
      process.exit(1);
    });
}

module.exports = { runIngestion, SimpleStatsWorker };
