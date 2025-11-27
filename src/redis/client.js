// src/redis/client.js
const { createClient } = require('ioredis');

let client = null;

// Only initialize Redis client if REDIS_URL and REDIS_ENABLED are set
if (process.env.REDIS_URL && process.env.REDIS_ENABLED === 'true') {
  try {
    client = createClient({ 
      url: process.env.REDIS_URL,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0
    });
    
    client.on('error', (error) => {
      console.warn('[Redis] Redis connection error (disabling Redis):', error.message);
      client.disconnect();
      client = null;
    });
    
    console.log('[Redis] Redis client initialized');
  } catch (error) {
    console.warn('[Redis] Redis initialization failed (using fallback):', error.message);
    client = null;
  }
} else {
  console.log('[Redis] 📝 Using fallback mode (Redis disabled)');
}

async function ensure() {
  if (!client) {
    throw new Error('Redis client not available');
  }
  
  if (client.status !== 'ready' && client.status !== 'connecting') {
    await client.connect();
  }
  return client;
}

module.exports = { client, ensure };
