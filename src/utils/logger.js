// src/utils/logger.js - Structured logging with Winston
const { createLogger, format, transports } = require('winston');
const path = require('path');
const { config } = require('../../config');

// Tạo thư mục logs nếu chưa tồn tại
const fs = require('fs');
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format cho correlation ID
const correlationFormat = format((info) => {
  if (info.correlationId) {
    info.correlationId = info.correlationId;
  }
  return info;
});

// Custom format cho development
const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (correlationId) {
      log = `[${correlationId}] ${log}`;
    }
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Production format (JSON)
const prodFormat = format.combine(
  format.timestamp(),
  correlationFormat(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

// Tạo logger
const logger = createLogger({
  level: config.server.nodeEnv === 'production' ? 'info' : 'debug',
  format: config.server.nodeEnv === 'production' ? prodFormat : devFormat,
  defaultMeta: { 
    service: 'posting-system',
    environment: config.server.nodeEnv 
  },
  transports: [
    // Console transport
    new transports.Console({
      format: config.server.nodeEnv === 'production' ? prodFormat : devFormat
    }),
    
    // File transports (chỉ trong production)
    ...(config.server.nodeEnv === 'production' ? [
      new transports.File({ 
        filename: path.join(logsDir, 'error.log'), 
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
      }),
      new transports.File({ 
        filename: path.join(logsDir, 'combined.log'),
        maxsize: 5242880, // 5MB
        maxFiles: 5
      })
    ] : [])
  ]
});

// Helper functions cho các loại log phổ biến
const logHelpers = {
  // Log cho API requests
  apiRequest: (req, message, meta = {}) => {
    logger.info('api_request', {
      message,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.correlationId,
      ...meta
    });
  },

  // Log cho API responses
  apiResponse: (req, statusCode, duration, meta = {}) => {
    logger.info('api_response', {
      method: req.method,
      url: req.url,
      statusCode,
      duration,
      correlationId: req.correlationId,
      ...meta
    });
  },

  // Log cho business operations
  business: (operation, message, meta = {}) => {
    logger.info('business_operation', {
      operation,
      message,
      ...meta
    });
  },

  // Log cho external service calls
  externalService: (service, operation, message, meta = {}) => {
    logger.info('external_service', {
      service,
      operation,
      message,
      ...meta
    });
  },

  // Log cho performance metrics
  performance: (operation, duration, meta = {}) => {
    logger.info('performance', {
      operation,
      duration,
      ...meta
    });
  },

  // Log cho security events
  security: (event, message, meta = {}) => {
    logger.warn('security_event', {
      event,
      message,
      ...meta
    });
  },

  // Log cho system events
  system: (event, message, meta = {}) => {
    logger.info('system_event', {
      event,
      message,
      ...meta
    });
  }
};

// Middleware để thêm correlation ID
const addCorrelationId = (req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || 
                     req.headers['x-request-id'] || 
                     `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Thêm correlation ID vào response headers
  res.setHeader('x-correlation-id', req.correlationId);
  
  next();
};

// Middleware để log requests
const logRequest = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logHelpers.apiRequest(req, 'Incoming request');
  
  // Override res.end để log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    logHelpers.apiResponse(req, res.statusCode, duration);
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

module.exports = {
  logger,
  logHelpers,
  addCorrelationId,
  logRequest
};
