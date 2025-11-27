// middleware/errorHandler.js - Comprehensive error handling
const { config } = require('../config');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429, 'RATE_LIMIT_ERROR');
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message, originalError = null) {
    super(`External service error (${service}): ${message}`, 502, 'EXTERNAL_SERVICE_ERROR', {
      service,
      originalError: originalError?.message || originalError
    });
  }
}

// Error logger
function logError(error, req = null) {
  const errorInfo = {
    timestamp: new Date().toISOString(),
    message: error.message,
    code: error.code || 'UNKNOWN_ERROR',
    statusCode: error.statusCode || 500,
    stack: error.stack,
    url: req?.url,
    method: req?.method,
    ip: req?.ip || req?.connection?.remoteAddress,
    userAgent: req?.headers?.['user-agent'],
    correlationId: req?.correlationId,
    body: req?.body,
    query: req?.query,
    params: req?.params,
    // Facebook API specific error details
    fbCode: error.fb?.code,
    fbType: error.fb?.type,
    fbMessage: error.fb?.message,
    // Additional context
    details: error.details,
    stepLogs: error.details?.stepLogs
  };

  // Log to console in development
  if (config.server.nodeEnv === 'development') {
    console.error('🚨 Error Details:', JSON.stringify(errorInfo, null, 2));
  }

  // TODO: Log to file or external service in production
  // if (config.logging.filePath) {
  //   // Log to file
  // }
}

// Async error wrapper
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Main error handling middleware
function errorHandler(err, req, res, next) {
  // Log error
  logError(err, req);

  // Default error
  let error = {
    message: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    statusCode: err.statusCode || 500
  };

  // Development mode: include stack trace
  if (config.server.nodeEnv === 'development') {
    error.stack = err.stack;
    error.details = err.details;
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error = {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details: err.details || err.message
    };
  }

  if (err.name === 'CastError') {
    error = {
      message: 'Invalid ID format',
      code: 'INVALID_ID_ERROR',
      statusCode: 400
    };
  }

  if (err.code === 'ENOENT') {
    error = {
      message: 'File not found',
      code: 'FILE_NOT_FOUND_ERROR',
      statusCode: 404
    };
  }

  // Handle Google Drive API errors
  if (err.code === 'DRIVE_API_ERROR') {
    error = {
      message: 'Google Drive API error',
      code: 'DRIVE_API_ERROR',
      statusCode: 502,
      details: err.details
    };
  }

  // Handle Facebook API errors
  if (err.fb) {
    error = {
      message: 'Facebook API error',
      code: 'FACEBOOK_API_ERROR',
      statusCode: 502,
      details: {
        fbCode: err.fb.code,
        fbMessage: err.fb.message,
        fbType: err.fb.type
      }
    };
  }

  // Send error response
  res.status(error.statusCode).json({
    ok: false,
    error: error.message,
    code: error.code,
    ...(error.details && { details: error.details }),
    ...(error.stack && config.server.nodeEnv === 'development' && { stack: error.stack }),
    timestamp: new Date().toISOString()
  });
}

// 404 handler
function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });
}

// Graceful shutdown handler
function gracefulShutdown(server, signal) {
  console.log(`\n🔄 Received ${signal}. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ExternalServiceError,
  asyncHandler,
  errorHandler,
  notFoundHandler,
  gracefulShutdown,
  logError
};
