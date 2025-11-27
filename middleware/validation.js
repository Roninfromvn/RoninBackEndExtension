// middleware/validation.js - Input validation middleware
const { config } = require('../config');

// Validation schemas
const schemas = {
  postPhoto: {
    pageId: { type: 'string', required: true, minLength: 1, maxLength: 50 },
    pageToken: { type: 'string', required: true, minLength: 1, maxLength: 1000 },
    fileId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    caption: { type: 'string', required: false, maxLength: 2200 },
    comment: { type: 'string', required: false, maxLength: 8000 },
    doReserve: { type: 'boolean', required: false, default: true },
    markUsed: { type: 'boolean', required: false, default: true }
  },
  
  requestPost: {
    pageToken: { type: 'string', required: true, minLength: 1, maxLength: 1000 }
  },
  
  reserve: {
    fileId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    day: { type: 'string', required: false, maxLength: 10 }
  },
  
  pageUsed: {
    pageId: { type: 'string', required: true, minLength: 1, maxLength: 50 },
    fileId: { type: 'string', required: true, minLength: 1, maxLength: 100 }
  },
  
  captions: {
    folderId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    captions: { type: 'array', required: true, maxLength: 100 }
  },
  
  comments: {
    folderId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    comments: { type: 'array', required: true, maxLength: 100 }
  },
  
  pageCfg: {
    pageId: { type: 'string', required: true, minLength: 1, maxLength: 50 },
    enabled: { type: 'boolean', required: false, default: false },
    folderIds: { type: 'array', required: false, default: [] },
    schedule: { type: 'array', required: false, default: [] },
    postsPerSlot: { type: 'number', required: false, min: 1, max: 10, default: 1 },
    defaultCaption: { type: 'string', required: false, maxLength: 2200, default: '' },
    captionByFolder: { type: 'object', required: false, default: {} }
  },
  
  agentHello: {
    agentId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    agentLabel: { type: 'string', required: false, maxLength: 200 },
    extVersion: { type: 'string', required: false, maxLength: 50 },
    pages: { type: 'array', required: false, default: [] }
  },
  
  assignments: {
    agentId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    allowedPages: { type: 'array', required: false, default: [] }
  },
  
  manualPost: {
    pageIds: { type: 'array', required: true, minLength: 1, maxLength: 50 },
    priority: { type: 'string', required: false, enum: ['high', 'normal', 'low'], default: 'high' },
    agentId: { type: 'string', required: false, maxLength: 100 }
  },
  
  webhookRegistration: {
    webhookUrl: { type: 'string', required: true, maxLength: 500 }
  },
  
  manifest: {
    limit: { type: 'number', required: false, min: 1, max: 10000, default: 1000 },
    after: { type: 'string', required: false, maxLength: 1000 }
  },
  
  listAll: {
    rootFolderId: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    limit: { type: 'number', required: false, min: 1, max: 10000, default: 1000 },
    after: { type: 'string', required: false, maxLength: 1000 }
  }
};

// Validation functions
function validateString(value, schema) {
  if (schema.required && (!value || typeof value !== 'string')) {
    throw new Error(`${schema.fieldName || 'Field'} is required and must be a string`);
  }
  if (value && typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) {
      throw new Error(`${schema.fieldName || 'Field'} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength && value.length > schema.maxLength) {
      throw new Error(`${schema.fieldName || 'Field'} must be at most ${schema.maxLength} characters`);
    }
  }
  return value;
}

function validateNumber(value, schema) {
  if (schema.required && (value === undefined || value === null)) {
    throw new Error(`${schema.fieldName || 'Field'} is required`);
  }
  if (value !== undefined && value !== null) {
    const num = Number(value);
    if (isNaN(num)) {
      throw new Error(`${schema.fieldName || 'Field'} must be a valid number`);
    }
    if (schema.min !== undefined && num < schema.min) {
      throw new Error(`${schema.fieldName || 'Field'} must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && num > schema.max) {
      throw new Error(`${schema.fieldName || 'Field'} must be at most ${schema.max}`);
    }
    return num;
  }
  return schema.default;
}

function validateBoolean(value, schema) {
  if (schema.required && value === undefined) {
    throw new Error(`${schema.fieldName || 'Field'} is required`);
  }
  if (value === undefined || value === null) {
    return schema.default;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
}

function validateArray(value, schema) {
  if (schema.required && (!value || !Array.isArray(value))) {
    throw new Error(`${schema.fieldName || 'Field'} is required and must be an array`);
  }
  if (value && Array.isArray(value)) {
    if (schema.maxLength && value.length > schema.maxLength) {
      throw new Error(`${schema.fieldName || 'Field'} must have at most ${schema.maxLength} items`);
    }
    return value;
  }
  return schema.default || [];
}

function validateObject(value, schema) {
  if (schema.required && (!value || typeof value !== 'object')) {
    throw new Error(`${schema.fieldName || 'Field'} is required and must be an object`);
  }
  if (value && typeof value === 'object') {
    return value;
  }
  return schema.default || {};
}

// Main validation function
function validateRequest(schemaName) {
  return (req, res, next) => {
    try {
      const schema = schemas[schemaName];
      if (!schema) {
        return res.status(400).json({ 
          ok: false, 
          error: `Unknown validation schema: ${schemaName}` 
        });
      }

      const validatedData = {};
      const errors = [];

      // Validate each field
      for (const [fieldName, fieldSchema] of Object.entries(schema)) {
        try {
          fieldSchema.fieldName = fieldName;
          
          switch (fieldSchema.type) {
            case 'string':
              validatedData[fieldName] = validateString(req.body[fieldName] || req.query[fieldName], fieldSchema);
              break;
            case 'number':
              validatedData[fieldName] = validateNumber(req.body[fieldName] || req.query[fieldName], fieldSchema);
              break;
            case 'boolean':
              validatedData[fieldName] = validateBoolean(req.body[fieldName] || req.query[fieldName], fieldSchema);
              break;
            case 'array':
              validatedData[fieldName] = validateArray(req.body[fieldName] || req.query[fieldName], fieldSchema);
              break;
            case 'object':
              validatedData[fieldName] = validateObject(req.body[fieldName] || req.query[fieldName], fieldSchema);
              break;
            default:
              errors.push(`Unknown field type: ${fieldSchema.type} for field ${fieldName}`);
          }
        } catch (fieldError) {
          errors.push(fieldError.message);
        }
      }

      if (errors.length > 0) {
        return res.status(400).json({
          ok: false,
          error: 'Validation failed',
          details: errors
        });
      }

      // Attach validated data to request
      req.validated = validatedData;
      next();
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'Validation middleware error',
        details: error.message
      });
    }
  };
}

// File validation
function validateFileUpload(req, res, next) {
  try {
    // Check file size
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxSizeBytes = config.security.maxFileSizeMB * 1024 * 1024;
    
    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        ok: false,
        error: `File too large. Maximum size is ${config.security.maxFileSizeMB}MB`
      });
    }

    // Check content type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      return res.status(415).json({
        ok: false,
        error: 'Unsupported content type'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'File validation error',
      details: error.message
    });
  }
}

// Rate limiting validation
function validateRateLimit(req, res, next) {
  // Simple in-memory rate limiting (in production, use Redis)
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!req.app.locals.rateLimit) {
    req.app.locals.rateLimit = new Map();
  }
  
  const clientData = req.app.locals.rateLimit.get(clientIP) || { 
    count: 0, 
    resetTime: now + config.rateLimit.windowMs 
  };
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + config.rateLimit.windowMs;
  } else {
    clientData.count++;
  }
  
  if (clientData.count > config.rateLimit.maxRequests) {
    return res.status(429).json({
      ok: false,
      error: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
    });
  }
  
  req.app.locals.rateLimit.set(clientIP, clientData);
  next();
}

module.exports = {
  validateRequest,
  validateFileUpload,
  validateRateLimit,
  validateString,
  validateNumber,
  validateBoolean,
  validateArray,
  validateObject,
  schemas
};
