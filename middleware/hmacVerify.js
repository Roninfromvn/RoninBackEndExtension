// hmacVerify.js - HMAC Authentication Middleware
const crypto = require('crypto');
const { config } = require('../config');

/**
 * HMAC Verification Middleware
 * Verifies request authenticity using HMAC signature
 */
function hmacVerify(req, res, next) {
  // Skip HMAC if disabled
  if (!config.security.enableHmac) {
    return next();
  }

  try {
    const signature = req.headers['x-signature'];
    const timestamp = req.headers['x-ts'];
    const agentId = req.headers['x-agent'];

    // Check required headers
    if (!signature || !timestamp || !agentId) {
      return res.status(401).json({
        error: 'Missing required headers: x-signature, x-ts, x-agent'
      });
    }

    // Check timestamp expiry
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);
    
    if (Math.abs(now - requestTime) > config.security.hmacExpirySeconds) {
      return res.status(401).json({
        error: 'Request expired',
        details: `Request timestamp ${requestTime} is too old (current: ${now})`
      });
    }

    // Reconstruct signature
    const method = req.method.toUpperCase();
    const path = req.originalUrl || req.url;
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body) || '').digest('hex');
    
    const message = `${method}:${path}:${timestamp}:${agentId}:${bodyHash}`;
    const expectedSignature = crypto.createHmac('sha256', config.security.hmacSecret)
      .update(message)
      .digest('hex');

    // Verify signature
    if (!crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      return res.status(401).json({
        error: 'Invalid signature',
        details: 'HMAC verification failed'
      });
    }

    // Add verified info to request
    req.verifiedAgent = agentId;
    req.verifiedTimestamp = requestTime;

    next();
  } catch (error) {
    console.error('❌ HMAC verification error:', error);
    return res.status(500).json({
      error: 'Internal server error during verification'
    });
  }
}

/**
 * Generate HMAC signature for client use
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {string} agentId - Agent identifier
 * @param {object} body - Request body
 * @returns {object} Signature data
 */
function generateHmacSignature(method, path, agentId, body = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${agentId}:${bodyHash}`;
  const signature = crypto.createHmac('sha256', config.security.hmacSecret)
    .update(message)
    .digest('hex');

  return {
    signature,
    timestamp,
    headers: {
      'x-signature': signature,
      'x-ts': timestamp.toString(),
      'x-agent': agentId
    }
  };
}

module.exports = {
  hmacVerify,
  generateHmacSignature
};
