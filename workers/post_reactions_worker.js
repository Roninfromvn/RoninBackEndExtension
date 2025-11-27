// post_reactions_worker.js - Worker để fetch post reactions từ Facebook API
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Pool } = require('pg');
const Redis = require('ioredis');

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

console.log('[DB] Environment check:', {
  PGHOST: process.env.PGHOST,
  PGPORT: process.env.PGPORT,
  PGUSER: process.env.PGUSER,
  PGDATABASE: process.env.PGDATABASE,
  PGPASSWORD: process.env.PGPASSWORD ? '***SET***' : '***NOT SET***'
});

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================================
// BACKEND API CONNECTION
// ============================================================================

const BACKEND_URL = process.env.SELF_BASE_URL || 'http://127.0.0.1:3210';

// ============================================================================
// HTTP CLIENT
// ============================================================================

class HttpClient {
  async get(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}

// ============================================================================
// BACKEND API CLASS
// ============================================================================

class BackendAPI {
  constructor() {
    this.baseUrl = BACKEND_URL;
    this.http = new HttpClient();
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
}

// ============================================================================
// FACEBOOK API CLASS
// ============================================================================

class FacebookAPI {
  constructor() {
    this.baseUrl = 'https://graph.facebook.com/v23.0';
  }

  // Lấy reactions cho 1 post
  async getPostReactions(postId, accessToken) {
    try {
      const fields = [
        'reactions.type(LIKE).summary(total_count).limit(0).as(like)',
        'reactions.type(LOVE).summary(total_count).limit(0).as(love)',
        'reactions.type(WOW).summary(total_count).limit(0).as(wow)',
        'reactions.type(HAHA).summary(total_count).limit(0).as(haha)',
        'reactions.type(SAD).summary(total_count).limit(0).as(sad)',
        'reactions.type(ANGRY).summary(total_count).limit(0).as(angry)',
        'reactions.type(CARE).summary(total_count).limit(0).as(care)',
        'comments.summary(true)',
        'shares'
      ].join(',');

      const url = `${this.baseUrl}/${postId}?fields=${fields}&access_token=${accessToken}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Facebook API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`[FacebookAPI] Error fetching reactions for post ${postId}:`, error.message);
      throw error;
    }
  }

  // Lấy reactions cho nhiều posts cùng lúc (batch)
  async getBatchPostReactions(postIds, accessToken, batchSize = 50) {
    try {
      console.log(`[FacebookAPI] Fetching reactions for ${postIds.length} posts in batches of ${batchSize}`);
      
      const results = [];
      const batches = [];
      
      // Chia thành các batch
      for (let i = 0; i < postIds.length; i += batchSize) {
        batches.push(postIds.slice(i, i + batchSize));
      }
      
      // Xử lý từng batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`[FacebookAPI] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} posts)`);
        
        // Tạo batch request cho Facebook API
        const batchRequests = batch.map(postId => ({
          method: 'GET',
          relative_url: `${postId}?fields=reactions.type(LIKE).summary(total_count).limit(0).as(like),reactions.type(LOVE).summary(total_count).limit(0).as(love),reactions.type(WOW).summary(total_count).limit(0).as(wow),reactions.type(HAHA).summary(total_count).limit(0).as(haha),reactions.type(SAD).summary(total_count).limit(0).as(sad),reactions.type(ANGRY).summary(total_count).limit(0).as(angry),reactions.type(CARE).summary(total_count).limit(0).as(care),comments.summary(true),shares`
        }));
        
        const batchUrl = `${this.baseUrl}?batch=${encodeURIComponent(JSON.stringify(batchRequests))}&access_token=${accessToken}`;
        
        const response = await fetch(batchUrl);
        if (!response.ok) {
          throw new Error(`Facebook Batch API error: ${response.status} ${response.statusText}`);
        }
        
        const batchData = await response.json();
        
        // Parse batch results
        for (let i = 0; i < batchData.length; i++) {
          const item = batchData[i];
          if (item.code === 200) {
            try {
              const postData = JSON.parse(item.body);
              results.push({
                postId: batch[i],
                data: postData
              });
            } catch (parseError) {
              console.error(`[FacebookAPI] Error parsing batch response for post ${batch[i]}:`, parseError.message);
            }
          } else {
            console.error(`[FacebookAPI] Batch request failed for post ${batch[i]}: ${item.body}`);
          }
        }
        
        // Rate limiting giữa các batch
        if (batchIndex < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log(`[FacebookAPI] Successfully fetched reactions for ${results.length}/${postIds.length} posts`);
      return results;
      
    } catch (error) {
      console.error(`[FacebookAPI] Error in batch processing:`, error.message);
      throw error;
    }
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

class DatabaseOps {
  async getPostsForReactionsSync() {
    const client = await pool.connect();
    try {
      // Lấy posts trong phạm vi 20 ngày gần nhất
      const query = `
        SELECT 
          p.post_id,
          p.page_id,
          p.message,
          p.created_time,
          p.permalink_url,
          p.link_ảnh
        FROM posts p
        INNER JOIN post_reactions_daily prd ON p.post_id = prd.post_id
        WHERE p.post_id IS NOT NULL
          AND p.created_time >= NOW() - INTERVAL '20 days'
        ORDER BY p.created_time DESC
        LIMIT 500
      `;
      
      const result = await client.query(query);
      console.log(`[DatabaseOps] Found ${result.rows.length} posts within 20 days to update reactions`);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async updatePostReactions(postId, reactionsData) {
    const client = await pool.connect();
    try {
      const {
        like_count = 0,
        love_count = 0,
        wow_count = 0,
        haha_count = 0,
        sad_count = 0,
        angry_count = 0,
        care_count = 0,
        comments_count = 0,
        shares_count = 0
      } = reactionsData;

      const total_reactions = like_count + love_count + wow_count + haha_count + sad_count + angry_count + care_count;

      // Chỉ UPDATE reactions, không INSERT mới
      const query = `
        UPDATE post_reactions_daily 
        SET 
          like_count = $1,
          love_count = $2,
          wow_count = $3,
          haha_count = $4,
          sad_count = $5,
          angry_count = $6,
          care_count = $7,
          comments_count = $8,
          shares_count = $9,
          total_reactions = $10,
          updated_at = NOW()
        WHERE post_id = $11
      `;

      const params = [
        like_count, love_count, wow_count, haha_count,
        sad_count, angry_count, care_count, comments_count, shares_count, total_reactions,
        postId
      ];

      const result = await client.query(query, params);
      
      if (result.rowCount > 0) {
        console.log(`[DatabaseOps] ✅ Updated reactions for post ${postId}: ${like_count} likes, ${love_count} loves, ${total_reactions} total`);
      } else {
        console.log(`[DatabaseOps] ⚠️ No post found with ID ${postId} in post_reactions_daily`);
      }
      
      return result;
    } finally {
      client.release();
    }
  }

  // Batch update reactions cho nhiều posts
  async batchUpdatePostReactions(reactionsData) {
    const client = await pool.connect();
    try {
      console.log(`[DatabaseOps] Starting batch update for ${reactionsData.length} posts`);
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const item of reactionsData) {
        try {
          const { postId, data } = item;
          
          const {
            like_count = 0,
            love_count = 0,
            wow_count = 0,
            haha_count = 0,
            sad_count = 0,
            angry_count = 0,
            care_count = 0,
            comments_count = 0,
            shares_count = 0
          } = {
            like_count: data.like?.summary?.total_count || 0,
            love_count: data.love?.summary?.total_count || 0,
            wow_count: data.wow?.summary?.total_count || 0,
            haha_count: data.haha?.summary?.total_count || 0,
            sad_count: data.sad?.summary?.total_count || 0,
            angry_count: data.angry?.summary?.total_count || 0,
            care_count: data.care?.summary?.total_count || 0,
            comments_count: data.comments?.summary?.total_count || 0,
            shares_count: data.shares?.count || 0
          };

          const total_reactions = like_count + love_count + wow_count + haha_count + sad_count + angry_count + care_count;

          const query = `
            UPDATE post_reactions_daily 
            SET 
              like_count = $1,
              love_count = $2,
              wow_count = $3,
              haha_count = $4,
              sad_count = $5,
              angry_count = $6,
              care_count = $7,
              comments_count = $8,
              shares_count = $9,
              total_reactions = $10,
              updated_at = NOW()
            WHERE post_id = $11
          `;

          const params = [
            like_count, love_count, wow_count, haha_count,
            sad_count, angry_count, care_count, comments_count, shares_count, total_reactions,
            postId
          ];

          await client.query(query, params);
          successCount++;
          
        } catch (error) {
          errorCount++;
          console.error(`[DatabaseOps] Error updating reactions for post ${item.postId}:`, error.message);
        }
      }
      
      console.log(`[DatabaseOps] Batch update completed: ${successCount} success, ${errorCount} errors`);
      return { successCount, errorCount };
      
    } finally {
      client.release();
    }
  }

  async getPageToken(pageId) {
    try {
      const backendAPI = new BackendAPI();
      return await backendAPI.getPageToken(pageId);
    } catch (error) {
      console.error(`[DatabaseOps] Error getting token for page ${pageId}:`, error.message);
      throw error;
    }
  }
}

// ============================================================================
// MAIN WORKER LOGIC
// ============================================================================

class PostReactionsWorker {
  constructor() {
    this.facebookAPI = new FacebookAPI();
    this.dbOps = new DatabaseOps();
    this.processedCount = 0;
    this.errorCount = 0;
  }

  async processPost(post) {
    try {
      console.log(`[Worker] Processing post ${post.post_id} from page ${post.page_id}`);
      
      // Lấy access token cho page
      const accessToken = await this.dbOps.getPageToken(post.page_id);
      
      // Fetch reactions từ Facebook API
      const reactionsData = await this.facebookAPI.getPostReactions(post.post_id, accessToken);
      
      // Parse reactions data
      const parsedReactions = {
        like_count: reactionsData.like?.summary?.total_count || 0,
        love_count: reactionsData.love?.summary?.total_count || 0,
        wow_count: reactionsData.wow?.summary?.total_count || 0,
        haha_count: reactionsData.haha?.summary?.total_count || 0,
        sad_count: reactionsData.sad?.summary?.total_count || 0,
        angry_count: reactionsData.angry?.summary?.total_count || 0,
        care_count: reactionsData.care?.summary?.total_count || 0,
        comments_count: reactionsData.comments?.summary?.total_count || 0,
        shares_count: reactionsData.shares?.count || 0
      };

      // Update reactions vào database
      await this.dbOps.updatePostReactions(post.post_id, parsedReactions);
      
      this.processedCount++;
      console.log(`[Worker] ✅ Successfully processed post ${post.post_id}`);
      
      // Rate limiting - delay giữa các requests
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      this.errorCount++;
      console.error(`[Worker] ❌ Error processing post ${post.post_id}:`, error.message);
    }
  }

  async run() {
    console.log('[Worker] 🚀 Starting Post Reactions Worker...');
    
    try {
      // Lấy posts cần sync
      const posts = await this.dbOps.getPostsForReactionsSync();
      
      if (posts.length === 0) {
        console.log('[Worker] No posts found to sync reactions');
        return;
      }

      console.log(`[Worker] Found ${posts.length} posts to process`);
      
      // Group posts by page_id để lấy tokens hiệu quả
      const postsByPage = {};
      for (const post of posts) {
        if (!postsByPage[post.page_id]) {
          postsByPage[post.page_id] = [];
        }
        postsByPage[post.page_id].push(post);
      }
      
      console.log(`[Worker] Grouped posts into ${Object.keys(postsByPage).length} pages`);
      
      // Xử lý tất cả pages trong 1 batch để tối ưu tốc độ
      const pageEntries = Object.entries(postsByPage);
      
      console.log(`[Worker] Processing ${pageEntries.length} pages in single batch for maximum efficiency`);
      
      // Process tất cả pages cùng lúc
      const pagePromises = pageEntries.map(async ([pageId, pagePosts]) => {
        try {
          console.log(`[Worker] Processing page ${pageId} with ${pagePosts.length} posts`);
          
          // Lấy access token cho page
          const accessToken = await this.dbOps.getPageToken(pageId);
          
          // Lấy post IDs
          const postIds = pagePosts.map(post => post.post_id);
          
          // Fetch reactions cho tất cả posts của page này với fallback strategy
          let reactionsData = [];
          
          try {
            // Thử Facebook Batch API trước (nhanh hơn)
            console.log(`[Worker] Trying Facebook Batch API for ${pagePosts.length} posts...`);
            reactionsData = await this.facebookAPI.getBatchPostReactions(postIds, accessToken, 50);
            console.log(`[Worker] ✅ Batch API successful: ${reactionsData.length} posts`);
            
          } catch (batchError) {
            console.log(`[Worker] ⚠️ Batch API failed, falling back to individual requests: ${batchError.message}`);
            
            // Fallback: Individual requests
            const postBatchSize = 10;
            for (let i = 0; i < pagePosts.length; i += postBatchSize) {
              const postBatch = pagePosts.slice(i, i + postBatchSize);
              console.log(`[Worker] Processing fallback post batch ${Math.floor(i/postBatchSize) + 1}/${Math.ceil(pagePosts.length/postBatchSize)} for page ${pageId}`);
              
              // Process từng post trong batch
              for (const post of postBatch) {
                try {
                  const postReactions = await this.facebookAPI.getPostReactions(post.post_id, accessToken);
                  reactionsData.push({
                    postId: post.post_id,
                    data: postReactions
                  });
                  
                  // Rate limiting giữa các posts
                  await new Promise(resolve => setTimeout(resolve, 200));
                  
                } catch (error) {
                  console.error(`[Worker] Error fetching reactions for post ${post.post_id}:`, error.message);
                }
              }
              
              // Rate limiting giữa các post batches
              if (i + postBatchSize < pagePosts.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
            
            console.log(`[Worker] ✅ Fallback completed: ${reactionsData.length} posts`);
          }
          
          // Batch update database
          const updateResult = await this.dbOps.batchUpdatePostReactions(reactionsData);
          
          console.log(`[Worker] ✅ Completed page ${pageId}: ${updateResult.successCount} success, ${updateResult.errorCount} errors`);
          
          return {
            pageId,
            successCount: updateResult.successCount,
            errorCount: updateResult.errorCount
          };
          
        } catch (error) {
          console.error(`[Worker] ❌ Error processing page ${pageId}:`, error.message);
          return {
            pageId,
            successCount: 0,
            errorCount: pagePosts.length
          };
        }
      });
      
      // Chờ tất cả pages hoàn thành
      console.log(`[Worker] Waiting for all ${pageEntries.length} pages to complete...`);
      const results = await Promise.all(pagePromises);
      
      // Tổng hợp kết quả
      for (const result of results) {
        this.processedCount += result.successCount;
        this.errorCount += result.errorCount;
      }
      
      console.log(`[Worker] 🎉 Completed! Processed: ${this.processedCount}, Errors: ${this.errorCount}`);
      
    } catch (error) {
      console.error('[Worker] Fatal error:', error.message);
    } finally {
      await pool.end();
      process.exit(0);
    }
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

if (require.main === module) {
  const worker = new PostReactionsWorker();
  worker.run().catch(error => {
    console.error('[Main] Worker failed:', error);
    process.exit(1);
  });
}

module.exports = { PostReactionsWorker, FacebookAPI, DatabaseOps };
