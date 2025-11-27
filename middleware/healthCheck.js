// middleware/healthCheck.js - Health check system
const { config } = require('../config');
const { ExternalServiceError } = require('./errorHandler');

class HealthChecker {
  constructor() {
    this.checks = new Map();
    this.lastCheck = null;
    this.checkInterval = null;
    this.healthStatus = {
      status: 'unknown',
      timestamp: null,
      uptime: 0,
      checks: {},
      version: require('../package.json').version,
      environment: config.server.nodeEnv
    };
  }

  // Add health check
  addCheck(name, checkFn, critical = false) {
    this.checks.set(name, { fn: checkFn, critical, lastCheck: null, lastResult: null });
  }

  // Run all health checks
  async runChecks() {
    const results = {};
    let overallStatus = 'healthy';
    const startTime = Date.now();

    for (const [name, check] of this.checks) {
      try {
        const result = await check.fn();
        check.lastResult = result;
        check.lastCheck = Date.now();
        
        results[name] = {
          status: 'healthy',
          timestamp: check.lastCheck,
          details: result,
          responseTime: result.responseTime || 0
        };
      } catch (error) {
        check.lastResult = { error: error.message };
        check.lastCheck = Date.now();
        
        results[name] = {
          status: 'unhealthy',
          timestamp: check.lastCheck,
          error: error.message,
          critical: check.critical
        };

        if (check.critical) {
          overallStatus = 'critical';
        } else if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      }
    }

    this.healthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: results,
      version: require('../package.json').version,
      environment: config.server.nodeEnv,
      responseTime: Date.now() - startTime
    };

    this.lastCheck = Date.now();
    return this.healthStatus;
  }

  // Start periodic health checks
  startPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.runChecks();
        
        // Log status changes
        if (this.healthStatus.status !== 'healthy') {
          console.warn(`⚠️ Health check status: ${this.healthStatus.status}`);
        }
      } catch (error) {
        console.error('❌ Health check error:', error);
      }
    }, config.healthCheck.intervalMs);

    // Run initial check
    this.runChecks();
  }

  // Stop periodic checks
  stopPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Get current health status
  getStatus() {
    return this.healthStatus;
  }

  // Check if system is healthy
  isHealthy() {
    return this.healthStatus.status === 'healthy';
  }

  // Check if system is critical
  isCritical() {
    return this.healthStatus.status === 'critical';
  }
}

// Create health checker instance
const healthChecker = new HealthChecker();

// Add default health checks

// PostgreSQL Database health check
healthChecker.addCheck('database', async () => {
  const start = Date.now();
  
  try {
    const { pool } = require('../src/db');
    const client = await pool.connect();
    
    try {
      await client.query('SELECT 1');
      return {
        status: 'connected',
        responseTime: Date.now() - start,
        database: process.env.PGDATABASE || 'posting_analytics_db'
      };
    } finally {
      client.release();
    }
  } catch (error) {
    throw new ExternalServiceError('PostgreSQL Database', error.message, error);
  }
}, true);

// Redis health check
healthChecker.addCheck('redis', async () => {
  const start = Date.now();
  
  try {
    const Redis = require('ioredis');
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    
    await redis.ping();
    redis.disconnect();
    
    return {
      status: 'connected',
      responseTime: Date.now() - start,
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    };
  } catch (error) {
    throw new ExternalServiceError('Redis', error.message, error);
  }
}, false);

// Workers (PM2) health check
healthChecker.addCheck('workers', async () => {
  const start = Date.now();
  
  try {
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const pm2 = spawn('npx', ['pm2', 'status'], { 
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true 
      });
      
      let output = '';
      let errorOutput = '';
      
      pm2.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      pm2.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      pm2.on('close', (code) => {
        if (code === 0) {
          // Check if there are any workers running
          const hasWorkers = output.includes('posting-workers') && !output.includes('stopped');
          const workerCount = (output.match(/posting-workers/g) || []).length;
          
          resolve({
            status: hasWorkers ? 'running' : 'stopped',
            responseTime: Date.now() - start,
            workerCount: workerCount,
            pm2Output: output.trim()
          });
        } else {
          reject(new Error(`PM2 status failed: ${errorOutput}`));
        }
      });
      
      pm2.on('error', (error) => {
        reject(new Error(`Failed to check PM2 status: ${error.message}`));
      });
      
      // Timeout after 10 seconds
      setTimeout(() => {
        pm2.kill();
        reject(new Error('PM2 status check timeout'));
      }, 10000);
    });
  } catch (error) {
    throw new ExternalServiceError('Workers (PM2)', error.message, error);
  }
}, false);

healthChecker.addCheck('system', async () => {
  const start = Date.now();
  
  // Check memory usage
  const memUsage = process.memoryUsage();
  if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
    throw new Error('High memory usage');
  }

  // Check CPU usage (simple check)
  const cpuUsage = process.cpuUsage();
  
  return {
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
    },
    cpu: {
      user: Math.round(cpuUsage.user / 1000) + 'ms',
      system: Math.round(cpuUsage.system / 1000) + 'ms'
    },
    responseTime: Date.now() - start
  };
}, true);

// Google Drive API health check
healthChecker.addCheck('google_drive', async () => {
  const start = Date.now();
  
  try {
    const { google } = require('googleapis');
    const { config } = require('../config');
    
    let auth;
    // Thử đọc credentials từ environment variables trước
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: config.googleDrive.scopes,
      });
    } else if (config.googleDrive.serviceAccountPath) {
      // Fallback to file-based credentials
      const path = require('path');
      const serviceAccountPath = path.resolve(config.googleDrive.serviceAccountPath);
      auth = new google.auth.GoogleAuth({
        keyFile: serviceAccountPath,
        scopes: config.googleDrive.scopes,
      });
    } else {
      throw new Error('No Google Drive credentials found');
    }
    
    const drive = google.drive({ version: 'v3', auth });
    
    // Test API call
    await drive.files.list({
      pageSize: 1,
      fields: 'files(id,name)',
      q: `'${config.googleDrive.rootFolderId}' in parents`
    });
    
    return {
      status: 'connected',
      responseTime: Date.now() - start
    };
  } catch (error) {
    throw new ExternalServiceError('Google Drive', error.message, error);
  }
}, true);

// Firestore health check
healthChecker.addCheck('firestore', async () => {
  const start = Date.now();
  
  try {
    const { Firestore } = require('@google-cloud/firestore');
    
    let firestore;
    // Thử đọc credentials từ environment variables trước
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      firestore = new Firestore({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
      });
    } else if (config.googleDrive.serviceAccountPath) {
      // Fallback to file-based credentials
      const path = require('path');
      const serviceAccountPath = path.resolve(config.googleDrive.serviceAccountPath);
      firestore = new Firestore({
        keyFilename: serviceAccountPath,
      });
    } else {
      throw new Error('No Firestore credentials found');
    }
    
    // Test connection
    await firestore.collection('sys_state').doc('health_check').get();
    
    return {
      status: 'connected',
      responseTime: Date.now() - start
    };
  } catch (error) {
    throw new ExternalServiceError('Firestore', error.message, error);
  }
}, true);

// Facebook API health check
healthChecker.addCheck('facebook_api', async () => {
  const start = Date.now();
  
  try {
    // Test Facebook Graph API endpoint
    const response = await fetch(`https://graph.facebook.com/${config.facebook.apiVersion}/me?access_token=test`);
    
    // We expect an error for invalid token, but the API should be reachable
    if (response.status === 400 && response.statusText.includes('Invalid')) {
      return {
        status: 'reachable',
        responseTime: Date.now() - start
      };
    }
    
    return {
      status: 'connected',
      responseTime: Date.now() - start
    };
  } catch (error) {
    throw new ExternalServiceError('Facebook API', error.message, error);
  }
}, false);

// Google Drive Webhook health check
healthChecker.addCheck('drive_webhook', async () => {
  const start = Date.now();
  
  try {
    const { Firestore } = require('@google-cloud/firestore');
    
    let firestore;
    // Thử đọc credentials từ environment variables trước
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      firestore = new Firestore({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
      });
    } else if (config.googleDrive.serviceAccountPath) {
      // Fallback to file-based credentials
      const path = require('path');
      const serviceAccountPath = path.resolve(config.googleDrive.serviceAccountPath);
      firestore = new Firestore({
        keyFilename: serviceAccountPath,
      });
    } else {
      throw new Error('No Firestore credentials found');
    }
    
    // Check webhook status from Firestore
    const webhookDoc = await firestore.collection('sys_state').doc('webhook_status').get();
    
    if (webhookDoc.exists) {
      const data = webhookDoc.data();
      return {
        status: 'active',
        channelId: data.channelId || 'unknown',
        resourceId: data.resourceId || 'unknown',
        expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : 'unknown',
        responseTime: Date.now() - start
      };
    } else {
      return {
        status: 'not_configured',
        responseTime: Date.now() - start
      };
    }
  } catch (error) {
    throw new ExternalServiceError('Drive Webhook', error.message, error);
  }
}, false);

// Health check middleware
function healthCheckMiddleware(req, res) {
  const status = healthChecker.getStatus();
  
  // Set appropriate status code
  let statusCode = 200;
  if (status.status === 'degraded') statusCode = 200; // Still operational
  if (status.status === 'critical') statusCode = 503; // Service unavailable
  
  res.status(statusCode).json(status);
}

// Detailed health check (for monitoring)
function detailedHealthCheckMiddleware(req, res) {
  const status = healthChecker.getStatus();
  
  // Add more detailed information
  const detailedStatus = {
    ...status,
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
      title: process.title
    },
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      PWD: process.cwd()
    }
  };
  
  res.json(detailedStatus);
}

// Start health checks when module is loaded
if (config.server.nodeEnv === 'production') {
  console.log('🚀 Starting periodic health checks in production mode...');
  healthChecker.startPeriodicChecks();
} else {
  console.log('🔧 Development mode: Starting periodic health checks...');
  // Run periodic health checks in development mode too
  healthChecker.startPeriodicChecks();
  healthChecker.runChecks().then(() => {
    console.log('✅ Initial health check completed');
  }).catch(error => {
    console.warn('⚠️ Initial health check failed:', error.message);
  });
}

module.exports = {
  healthChecker,
  healthCheckMiddleware,
  detailedHealthCheckMiddleware
};
