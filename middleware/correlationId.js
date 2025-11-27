// middleware/correlationId.js - Correlation ID middleware
const { v4: uuidv4 } = require('uuid');

/**
 * Middleware để thêm correlation ID cho mỗi request
 * Correlation ID giúp track toàn bộ flow của một request
 */
function addCorrelationId(req, res, next) {
  // Lấy correlation ID từ header hoặc tạo mới
  req.correlationId = req.headers['x-correlation-id'] || 
                     req.headers['x-request-id'] || 
                     uuidv4();
  
  // Thêm correlation ID vào response headers
  res.setHeader('x-correlation-id', req.correlationId);
  
  // Thêm correlation ID vào request object để các middleware khác có thể sử dụng
  req.requestId = req.correlationId;
  
  next();
}

module.exports = { addCorrelationId };
