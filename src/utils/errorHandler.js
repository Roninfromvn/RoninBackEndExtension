// errorHandler.js - Utility functions for error handling
const logger = require('./logger');

/**
 * Wrapper function để xử lý async errors trong Express routes
 */
const wrapAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Xử lý lỗi API calls với retry logic
 */
async function withRetry(fn, maxRetries = 3, delay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      logger.warn(`Retry ${attempt}/${maxRetries} after ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

/**
 * Xử lý lỗi Facebook API calls
 */
async function safeFacebookCall(fn, context = '') {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Facebook API error in ${context}:`, {
      message: error.message,
      code: error.code,
      subcode: error.subcode,
      timestamp: new Date().toISOString()
    });
    
    // Trả về giá trị mặc định thay vì crash
    return null;
  }
}

/**
 * Xử lý lỗi database operations
 */
async function safeDatabaseCall(fn, context = '') {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Database error in ${context}:`, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      timestamp: new Date().toISOString()
    });
    
    throw error; // Re-throw database errors vì chúng quan trọng
  }
}

/**
 * Validate và sanitize input parameters
 */
function validateParams(params, required = []) {
  const errors = [];
  
  for (const field of required) {
    if (!params[field]) {
      errors.push(`${field} is required`);
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }
  
  return true;
}

/**
 * Format error response cho API
 */
function formatErrorResponse(error, context = '') {
  return {
    error: true,
    message: error.message,
    context: context,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  };
}

/**
 * Log performance metrics
 */
function logPerformance(operation, startTime, success = true) {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation}`, {
    duration: `${duration}ms`,
    success: success,
    timestamp: new Date().toISOString()
  });
}

module.exports = {
  wrapAsync,
  withRetry,
  safeFacebookCall,
  safeDatabaseCall,
  validateParams,
  formatErrorResponse,
  logPerformance
};
