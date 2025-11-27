// cache.js - Cache & Lock system với Redis + in-memory fallback
const Redis = require('ioredis');

// Khởi tạo Redis client (với fallback khi Redis không khả dụng)
let redis = null;

// Chỉ kết nối Redis nếu có biến môi trường REDIS_URL và REDIS_ENABLED=true
if (process.env.REDIS_URL && process.env.REDIS_ENABLED === 'true') {
  try {
    redis = new Redis(process.env.REDIS_URL, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0
    });
    
    redis.on('error', (error) => {
      console.warn('[Cache] Redis connection error (disabling Redis):', error.message);
      redis.disconnect();
      redis = null;
    });
    
    console.log('[Cache] Redis client initialized');
  } catch (error) {
    console.warn('[Cache] Redis initialization failed (using in-memory fallback):', error.message);
    redis = null;
  }
} else {
  console.log('[Cache] 📝 Using in-memory cache (Redis disabled)');
}

// Prefix cho các key
const PREFIXES = {
  PAGE_TOKEN: 'pt:',
  PAGE_TOKEN_META: 'pt_meta:',
  LOCK: 'lock:rotate:page:'
};

// TTL mặc định
const TTL = {
  PAGE_TOKEN: 12 * 60 * 60, // 12 giờ
  PAGE_TOKEN_META: 12 * 60 * 60, // 12 giờ
  LOCK: 300 // 5 phút
};

// In-memory fallback cache
const memoryCache = new Map();

// Lấy cached token
async function getCachedToken(pageId) {
  try {
    if (!redis) {
      // Fallback to memory cache
      const cached = memoryCache.get(PREFIXES.PAGE_TOKEN + pageId);
      if (cached && cached.expiry > Date.now()) {
        console.log(`[Cache] Memory cache hit cho page ${pageId}`);
        return cached.value;
      }
      console.log(`[Cache] Memory cache miss cho page ${pageId}`);
      return null;
    }
    
    const key = PREFIXES.PAGE_TOKEN + pageId;
    const token = await redis.get(key);
    
    if (token) {
      console.log(`[Cache] Cache hit cho page ${pageId}`);
      return token;
    }
    
    console.log(`[Cache] Cache miss cho page ${pageId}`);
    return null;
    
  } catch (error) {
    console.error(`[Cache] Lỗi lấy cached token cho page ${pageId}:`, error.message);
    return null;
  }
}

// Lưu token vào cache
async function setCachedToken(pageId, token, ttlSec = TTL.PAGE_TOKEN) {
  try {
    if (!redis) {
      // Fallback to memory cache
      const key = PREFIXES.PAGE_TOKEN + pageId;
      memoryCache.set(key, {
        value: token,
        expiry: Date.now() + (ttlSec * 1000)
      });
      console.log(`[Cache] Đã cache token vào memory cho page ${pageId}, TTL: ${ttlSec}s`);
      return;
    }
    
    const key = PREFIXES.PAGE_TOKEN + pageId;
    await redis.setex(key, ttlSec, token);
    
    console.log(`[Cache] Đã cache token cho page ${pageId}, TTL: ${ttlSec}s`);
    
  } catch (error) {
    console.error(`[Cache] Lỗi cache token cho page ${pageId}:`, error.message);
  }
}

// Lấy metadata của cached token
async function getCachedTokenMeta(pageId) {
  try {
    if (!redis) {
      // Fallback to memory cache
      const cached = memoryCache.get(PREFIXES.PAGE_TOKEN_META + pageId);
      if (cached && cached.expiry > Date.now()) {
        return cached.value;
      }
      return null;
    }
    
    const key = PREFIXES.PAGE_TOKEN_META + pageId;
    const meta = await redis.get(key);
    
    if (meta) {
      return JSON.parse(meta);
    }
    
    return null;
    
  } catch (error) {
    console.error(`[Cache] Lỗi lấy token meta cho page ${pageId}:`, error.message);
    return null;
  }
}

// Lưu metadata của token vào cache
async function setCachedTokenMeta(pageId, meta, ttlSec = TTL.PAGE_TOKEN_META) {
  try {
    if (!redis) {
      // Fallback to memory cache
      const key = PREFIXES.PAGE_TOKEN_META + pageId;
      memoryCache.set(key, {
        value: meta,
        expiry: Date.now() + (ttlSec * 1000)
      });
      console.log(`[Cache] Đã cache token meta vào memory cho page ${pageId}`);
      return;
    }
    
    const key = PREFIXES.PAGE_TOKEN_META + pageId;
    await redis.setex(key, ttlSec, JSON.stringify(meta));
    
    console.log(`[Cache] Đã cache token meta cho page ${pageId}`);
    
  } catch (error) {
    console.error(`[Cache] Lỗi cache token meta cho page ${pageId}:`, error.message);
  }
}

// Xóa cached token
async function clearCachedToken(pageId) {
  try {
    if (!redis) {
      // Fallback to memory cache
      const tokenKey = PREFIXES.PAGE_TOKEN + pageId;
      const metaKey = PREFIXES.PAGE_TOKEN_META + pageId;
      memoryCache.delete(tokenKey);
      memoryCache.delete(metaKey);
      console.log(`[Cache] Đã xóa cache memory cho page ${pageId}`);
      return;
    }
    
    const tokenKey = PREFIXES.PAGE_TOKEN + pageId;
    const metaKey = PREFIXES.PAGE_TOKEN_META + pageId;
    
    await redis.del(tokenKey, metaKey);
    
    console.log(`[Cache] Đã xóa cache cho page ${pageId}`);
    
  } catch (error) {
    console.error(`[Cache] Lỗi xóa cache cho page ${pageId}:`, error.message);
  }
}

// Lấy lock cho page
async function acquirePageLock(pageId, ttlSec = TTL.LOCK) {
  try {
    if (!redis) {
      // Fallback to memory lock (simple implementation)
      const lockKey = PREFIXES.LOCK + pageId;
      const existingLock = memoryCache.get(lockKey);
      
      if (existingLock && existingLock.expiry > Date.now()) {
        return null; // Lock đang được giữ
      }
      
      const lockValue = Date.now().toString();
      memoryCache.set(lockKey, {
        value: lockValue,
        expiry: Date.now() + (ttlSec * 1000)
      });
      
      console.log(`[Cache] Memory lock acquired cho page ${pageId}, TTL: ${ttlSec}s`);
      return lockValue;
    }
    
    const lockKey = PREFIXES.LOCK + pageId;
    const lockValue = Date.now().toString();
    
    // Thử lấy lock với SET NX EX
    const result = await redis.set(lockKey, lockValue, 'EX', ttlSec, 'NX');
    
    if (result === 'OK') {
      console.log(`[Cache] Đã lấy lock cho page ${pageId}, TTL: ${ttlSec}s`);
      return lockValue;
    }
    
    console.log(`[Cache] Không thể lấy lock cho page ${pageId} - đang bận`);
    return null;
    
  } catch (error) {
    console.error(`[Cache] Lỗi lấy lock cho page ${pageId}:`, error.message);
    return null;
  }
}

// Giải phóng lock cho page
async function releasePageLock(pageId, lockValue) {
  try {
    if (!redis) {
      // Fallback to memory lock
      const lockKey = PREFIXES.LOCK + pageId;
      const existingLock = memoryCache.get(lockKey);
      
      if (existingLock && existingLock.value === lockValue) {
        memoryCache.delete(lockKey);
        console.log(`[Cache] Memory lock released cho page ${pageId}`);
      }
      return;
    }
    
    const lockKey = PREFIXES.LOCK + pageId;
    
    // Chỉ xóa lock nếu value khớp (tránh xóa lock của process khác)
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    
    const result = await redis.eval(script, 1, lockKey, lockValue);
    
    if (result === 1) {
      console.log(`[Cache] Đã giải phóng lock cho page ${pageId}`);
    } else {
      console.log(`[Cache] Lock cho page ${pageId} đã bị thay đổi hoặc hết hạn`);
    }
    
  } catch (error) {
    console.error(`[Cache] Lỗi giải phóng lock cho page ${pageId}:`, error.message);
  }
}

// Wrapper function để sử dụng lock
async function withPageLock(pageId, fn, ttlSec = TTL.LOCK) {
  if (!redis && !process.env.REDIS_ENABLED) {
    // Không có Redis, chạy trực tiếp mà không lock
    console.log(`[Cache] No Redis - executing without lock for page ${pageId}`);
    return await fn();
  }
  
  const lockValue = await acquirePageLock(pageId, ttlSec);
  
  if (!lockValue) {
    throw new Error(`Không thể lấy lock cho page ${pageId}`);
  }
  
  try {
    const result = await fn();
    return result;
  } finally {
    await releasePageLock(pageId, lockValue);
  }
}

// Kiểm tra trạng thái Redis
async function checkRedisHealth() {
  try {
    if (!redis) return false;
    await redis.ping();
    return true;
  } catch (error) {
    console.error('[Cache] Redis health check failed:', error.message);
    return false;
  }
}

// Đóng kết nối Redis
async function closeRedis() {
  try {
    if (redis) {
      await redis.quit();
      console.log('[Cache] Đã đóng kết nối Redis');
    }
  } catch (error) {
    console.error('[Cache] Lỗi đóng Redis:', error.message);
  }
}

// Cleanup memory cache (cho development)
function cleanupMemoryCache() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, value] of memoryCache.entries()) {
    if (value.expiry <= now) {
      memoryCache.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[Cache] Đã cleanup ${cleanedCount} expired memory cache entries`);
  }
}

// Auto cleanup memory cache mỗi 5 phút
setInterval(cleanupMemoryCache, 5 * 60 * 1000);

module.exports = {
  getCachedToken,
  setCachedToken,
  getCachedTokenMeta,
  setCachedTokenMeta,
  clearCachedToken,
  acquirePageLock,
  releasePageLock,
  withPageLock,
  checkRedisHealth,
  closeRedis,
  cleanupMemoryCache
};
