// rateLimit.js - Advanced Rate Limiting Middleware with Redis support
const { config } = require('../config');
const { client: redisClient, ensure: ensureRedis } = require('../src/redis/client');

/**
 * Redis-based rate limiting helper
 * Uses Redis INCR and EXPIRE for distributed rate limiting
 */
async function checkRateLimit(key, maxRequests, windowMs) {
  try {
    await ensureRedis();
    
    const redisKey = `rate-limit:${key}`;
    const now = Date.now();
    const windowStart = now - (now % windowMs);
    const resetTime = windowStart + windowMs;
    
    // Use Redis transaction for atomic operations
    const multi = redisClient.multi();
    multi.incr(redisKey);
    multi.expire(redisKey, Math.ceil(windowMs / 1000)); // Convert to seconds
    
    const results = await multi.exec();
    const count = results[0][1]; // INCR result
    
    // If this is the first request in the window, set the window start
    if (count === 1) {
      await redisClient.hset(`${redisKey}:meta`, 'windowStart', windowStart);
      await redisClient.expire(`${redisKey}:meta`, Math.ceil(windowMs / 1000));
    }
    
    return {
      count,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetTime,
      windowStart
    };
  } catch (error) {
    console.error('❌ Redis rate limit error:', error);
    // Fallback to allow request if Redis is unavailable
    return {
      count: 0,
      limit: maxRequests,
      remaining: maxRequests,
      resetTime: Date.now() + windowMs,
      windowStart: Date.now()
    };
  }
}

/**
 * Advanced Rate Limiting Middleware
 * Supports multiple rate limit strategies
 */
function rateLimit(options = {}) {
  const {
    keyGenerator = (req) => req.ip, // Default: IP-based
    maxRequests = config.rateLimit.maxRequests,
    windowMs = config.rateLimit.windowMs,
    message = 'Too many requests, please try again later.',
    statusCode = 429,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req, res, next) => {
    // Skip rate limiting if disabled
    if (!config.security.enableRateLimit) {
      return next();
    }

    try {
      const key = keyGenerator(req);
      
      // Check rate limit using Redis
      const rateLimitData = await checkRateLimit(key, maxRequests, windowMs);

      // Check if limit exceeded
      if (rateLimitData.count > maxRequests) {
        const retryAfter = Math.ceil((rateLimitData.resetTime - Date.now()) / 1000);
        
        res.set({
          'Retry-After': retryAfter,
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': new Date(rateLimitData.resetTime).toISOString()
        });

        return res.status(statusCode).json({
          error: 'Rate limit exceeded',
          message,
          retryAfter,
          resetTime: new Date(rateLimitData.resetTime).toISOString()
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': rateLimitData.remaining,
        'X-RateLimit-Reset': new Date(rateLimitData.resetTime).toISOString()
      });

      // Track request for conditional counting
      if (skipSuccessfulRequests || skipFailedRequests) {
        const originalSend = res.send;
        res.send = function(data) {
          const statusCode = res.statusCode;
          const isSuccess = statusCode >= 200 && statusCode < 400;
          
          if ((skipSuccessfulRequests && isSuccess) || (skipFailedRequests && !isSuccess)) {
            // Note: In Redis-based rate limiting, we can't easily decrement
            // This is a limitation of the distributed approach
            console.warn('⚠️ Conditional rate limiting not fully supported with Redis');
          }
          
          return originalSend.call(this, data);
        };
      }

      next();
    } catch (error) {
      console.error('❌ Rate limit error:', error);
      // Continue without rate limiting on error
      next();
    }
  };
}

/**
 * Agent-based rate limiting
 * Limits requests per agent ID
 */
function agentRateLimit() {
  return rateLimit({
    keyGenerator: (req) => {
      const agentId = req.headers['x-agent'] || req.verifiedAgent || 'unknown';
      return `agent:${agentId}`;
    },
    maxRequests: config.rateLimit.maxRequestsPerAgent,
    message: 'Agent rate limit exceeded'
  });
}

/**
 * Page-based rate limiting
 * Limits requests per Facebook page
 */
function pageRateLimit() {
  return rateLimit({
    keyGenerator: (req) => {
      const pageId = req.body?.pageId || req.query?.pageId || 'unknown';
      return `page:${pageId}`;
    },
    maxRequests: config.rateLimit.maxRequestsPerPage,
    message: 'Page rate limit exceeded'
  });
}

/**
 * Combined rate limiting for critical endpoints
 */
function criticalRateLimit() {
  return rateLimit({
    keyGenerator: (req) => {
      const agentId = req.headers['x-agent'] || req.verifiedAgent || 'unknown';
      const pageId = req.body?.pageId || req.query?.pageId || 'unknown';
      return `critical:${agentId}:${pageId}`;
    },
    maxRequests: Math.min(config.rateLimit.maxRequestsPerAgent, config.rateLimit.maxRequestsPerPage),
    message: 'Critical operation rate limit exceeded'
  });
}

/**
 * Get rate limit status for a key
 */
async function getRateLimitStatus(key) {
  try {
    await ensureRedis();
    const redisKey = `rate-limit:${key}`;
    const count = await redisClient.get(redisKey);
    
    if (!count) return null;
    
    const ttl = await redisClient.ttl(redisKey);
    const resetTime = Date.now() + (ttl * 1000);
    
    return {
      count: parseInt(count),
      limit: config.rateLimit.maxRequests,
      remaining: Math.max(0, config.rateLimit.maxRequests - parseInt(count)),
      resetTime: new Date(resetTime).toISOString(),
      ttl
    };
  } catch (error) {
    console.error('❌ Error getting rate limit status:', error);
    return null;
  }
}

/**
 * Reset rate limit for a key
 */
async function resetRateLimit(key) {
  try {
    await ensureRedis();
    const redisKey = `rate-limit:${key}`;
    await redisClient.del(redisKey);
    await redisClient.del(`${redisKey}:meta`);
    return true;
  } catch (error) {
    console.error('❌ Error resetting rate limit:', error);
    return false;
  }
}

module.exports = {
  rateLimit,
  agentRateLimit,
  pageRateLimit,
  criticalRateLimit,
  getRateLimitStatus,
  resetRateLimit
};
