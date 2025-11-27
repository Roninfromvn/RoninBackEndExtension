// config.js - Quản lý tất cả configuration
require('dotenv').config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 3210,
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3210', 'http://127.0.0.1:3210'],
    selfBaseUrl: process.env.SELF_BASE_URL || 'http://localhost:3210',
  },

  // Google Drive Configuration
  googleDrive: {
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    serviceAccountPath: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/drive'],
  },

  // Webhook Configuration
  webhook: {
    enabled: process.env.WEBHOOK_ENABLED === 'true',
    secret: process.env.GOOGLE_WEBHOOK_SECRET,
    url: process.env.WEBHOOK_URL,
  },

  // Facebook API Configuration
  facebook: {
    apiVersion: process.env.FB_API_VERSION || 'v19.0',
    rateLimitPerMinute: parseInt(process.env.FB_RATE_LIMIT_PER_MINUTE) || 60,
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 60,
    maxRequestsPerAgent: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_AGENT) || 30,
    maxRequestsPerPage: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_PAGE) || 20,
  },

  // Database Configuration
  firestore: {
    collections: {
      reserves: process.env.FIRESTORE_COLLECTION_RESERVES || 'image_reserves',
      postLogs: process.env.FIRESTORE_COLLECTION_POST_LOGS || 'post_logs',
      pageUsed: process.env.FIRESTORE_COLLECTION_PAGE_USED || 'page_used',
      folders: process.env.FIRESTORE_COLLECTION_FOLDERS || 'folders',
      sysState: process.env.FIRESTORE_COLLECTION_SYS_STATE || 'sys_state',
      pageCfg: process.env.FIRESTORE_COLLECTION_PAGE_CFG || 'page_cfg',
      manifestImages: process.env.FIRESTORE_COLLECTION_MANIFEST_IMAGES || 'manifest_images',
      manifestChunks: process.env.FIRESTORE_COLLECTION_MANIFEST_CHUNKS || 'manifest_chunks',
      manifestProcessed: process.env.FIRESTORE_COLLECTION_MANIFEST_PROCESSED || 'manifest_processed',
      agents: process.env.FIRESTORE_COLLECTION_AGENTS || 'agents',
      assignments: process.env.FIRESTORE_COLLECTION_ASSIGNMENTS || 'assignments',
      folderCaptions: process.env.FIRESTORE_COLLECTION_FOLDER_CAPTIONS || 'folder_captions',
      folderComments: process.env.FIRESTORE_COLLECTION_FOLDER_COMMENTS || 'folder_comments',
      notifications: process.env.FIRESTORE_COLLECTION_NOTIFICATIONS || 'notifications',
      postingQueue: process.env.FIRESTORE_COLLECTION_POSTING_QUEUE || 'posting_queue',
    },
  },

  // Security
  security: {
    maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB) || 50,
    maxRequestSizeMB: parseInt(process.env.MAX_REQUEST_SIZE_MB) || 10,
    hmacSecret: process.env.HMAC_SECRET,
    hmacExpirySeconds: parseInt(process.env.HMAC_EXPIRY_SECONDS) || 300, // 5 minutes
    enableHmac: process.env.ENABLE_HMAC === 'true',
    enableRateLimit: process.env.ENABLE_RATE_LIMIT === 'true',
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || './logs/app.log',
  },

  // Health Check
  healthCheck: {
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 30000,
    timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS) || 5000,
  },

  // Queue Configuration
  queue: {
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10, // Số luồng chạy song song
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3, // Số lần thử lại tối đa
    jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS) || 300000, // 5 phút timeout cho mỗi job
    idleTimeoutMs: parseInt(process.env.IDLE_TIMEOUT_MS) || 300000, // 5 phút timeout khi không có việc
  },

  // Worker Configuration
  worker: {
    maxRetries: parseInt(process.env.POSTING_WORKER_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.POSTING_WORKER_RETRY_DELAY_MS) || 300000, // 5 phút
  },

  // Manifest Sync Configuration
  manifestSync: {
    lockTimeoutMs: parseInt(process.env.MANIFEST_SYNC_LOCK_TIMEOUT_MS) || 1800000, // 30 phút
    cronInterval: process.env.MANIFEST_SYNC_CRON_INTERVAL || '*/15 * * * *', // 15 phút
  },

  // Validation Rules
  validation: {
    maxCaptionLength: 2200, // Facebook limit
    maxCommentLength: 8000, // Facebook limit
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxImagesPerPost: 10,
    maxScheduleItems: 24, // Maximum schedule items per page
    maxFoldersPerPage: 100, // Maximum folders per page
  },
};

// Validation function để kiểm tra config
function validateConfig() {
  const errors = [];
  
  // Required environment variables (no defaults)
  const requiredVars = {
    'GOOGLE_DRIVE_ROOT_FOLDER_ID': config.googleDrive.rootFolderId,
    'GOOGLE_WEBHOOK_SECRET': config.webhook.secret,
    'WEBHOOK_URL': config.webhook.url,
    'HMAC_SECRET': config.security.hmacSecret,
  };
  
  // Check Google credentials (either file path OR individual credentials)
  const hasGoogleCredentials = config.googleDrive.serviceAccountPath || 
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
  
  if (!hasGoogleCredentials) {
    errors.push('Either GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY must be set');
  }
  
  // Check for missing required variables
  for (const [varName, value] of Object.entries(requiredVars)) {
    if (!value) {
      errors.push(`${varName} is required but not set`);
    }
  }
  
  // Validate numeric values
  if (config.facebook.rateLimitPerMinute <= 0) {
    errors.push('FB_RATE_LIMIT_PER_MINUTE must be positive');
  }
  
  if (config.security.maxFileSizeMB <= 0) {
    errors.push('MAX_FILE_SIZE_MB must be positive');
  }
  
  if (config.security.maxRequestSizeMB <= 0) {
    errors.push('MAX_REQUEST_SIZE_MB must be positive');
  }
  
  // Validate file paths
  if (config.googleDrive.serviceAccountPath && !config.googleDrive.serviceAccountPath.endsWith('.json')) {
    errors.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH must point to a JSON file');
  }
  
  // Validate webhook URL format
  if (config.webhook.url && !config.webhook.url.startsWith('https://')) {
    errors.push('WEBHOOK_URL must use HTTPS protocol');
  }
  
  // Validate HMAC secret length
  if (config.security.hmacSecret && config.security.hmacSecret.length < 32) {
    errors.push('HMAC_SECRET must be at least 32 characters long');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.map(err => `  - ${err}`).join('\n')}`);
  }
  
  return true;
}

module.exports = { config, validateConfig };
