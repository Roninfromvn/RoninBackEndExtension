# 🔧 Drive Proxy - Backend Service

**Version:** 1.0.0  
**Status:** ✅ Running  
**Port:** 3210  
**Last Updated:** 2025-01-15

## 📋 Tổng quan

Drive Proxy là backend service chính của hệ thống POSTING, đóng vai trò trung tâm điều hành tự động cho việc đăng bài Facebook và phân tích hiệu suất.

## 🏗️ Kiến trúc

### Core Components
- **Express.js Server**: API server chính
- **Google Drive Integration**: Lấy nội dung từ Google Drive
- **Facebook API**: Đăng bài và thu thập dữ liệu
- **Firestore Database**: Lưu trữ dữ liệu và cấu hình
- **Redis Cache**: Cache token và session
- **PM2 Workers**: Xử lý hàng đợi đăng bài

### Services
- **GoogleDriveService**: Quản lý kết nối Google Drive
- **FacebookService**: Tương tác với Facebook API
- **PostingService**: Logic đăng bài tự động
- **TokenVault**: Quản lý token an toàn

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+
- Redis server (local hoặc cloud)
- PostgreSQL (cho analytics - optional)
- Google Cloud service account

### 2. Installation
```bash
cd drive-proxy
npm install
```

### 3. Environment Setup
```bash
# Copy environment template
cp env.example .env

# Cập nhật các biến quan trọng:
GOOGLE_DRIVE_ROOT_FOLDER_ID=your-folder-id
HMAC_SECRET=your-secret-key
GOOGLE_WEBHOOK_SECRET=your-webhook-secret
WEBHOOK_URL=your-webhook-url
```

### 4. Start Server
```bash
# Development mode
npm run dev

# Production mode
npm start

# Health check
npm run health
```

## 📡 API Endpoints

### Health & Status
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status
- `GET /api/test` - API test endpoint

### Token Management
- `POST /token/user/paste` - Paste user token
- `GET /token/page/:pageId` - Get page token
- `POST /token/page/rotate-bulk` - Rotate multiple tokens

### Google Drive
- `GET /api/folders` - List folders
- `GET /blob/:fileId` - Get file content
- `GET /listAll` - List all files
- `POST /drive/webhook` - Google Drive webhook

### Facebook Posting
- `POST /postPhoto` - Post photo to Facebook
- `GET /postLogs` - Get posting logs
- `GET /postLogs/:logId` - Get specific log

### Analytics
- `GET /manifest` - Get manifest data
- `GET /api/runtime-metrics` - Runtime metrics

## 🔧 Configuration

### Environment Variables

#### Required
```bash
GOOGLE_DRIVE_ROOT_FOLDER_ID=your-folder-id
GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH=./service-account.json
HMAC_SECRET=your-32-char-secret
GOOGLE_WEBHOOK_SECRET=your-webhook-secret
WEBHOOK_URL=https://your-domain.com/api/drive-webhook
```

#### Optional
```bash
PORT=3210
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
NODE_ENV=development
```

### Database Schema
- **PostgreSQL**: Analytics data (page_stats_daily, post_reactions_daily)
- **Firestore**: Configuration, logs, manifests
- **Redis**: Token cache, session data

## 🛠️ Development

### Scripts
```bash
npm start          # Start production server
npm run dev        # Start development with nodemon
npm run worker     # Start posting worker
npm run health     # Health check
npm run workers:start  # Start PM2 workers
npm run workers:stop   # Stop PM2 workers
```

### Project Structure
```
drive-proxy/
├── src/
│   ├── core/          # Core business logic
│   ├── routes/        # API routes
│   ├── services/      # External services
│   ├── token/         # Token management
│   ├── utils/         # Utilities
│   └── metrics/       # Metrics collection
├── middleware/        # Express middleware
├── config.js         # Configuration
├── index.js          # Main server
├── worker.js         # Background worker
└── scheduler.js      # Cron jobs
```

## 📊 Monitoring

### Health Checks
- Database connectivity
- Redis connection
- Google Drive API
- Facebook API
- Worker status

### Metrics
- API response times
- Error rates
- Queue length
- Memory usage
- CPU usage

## 🔒 Security

### Authentication
- HMAC signature verification
- Rate limiting per agent/page
- Token encryption with KMS
- CORS configuration

### Data Protection
- Encrypted token storage
- Secure webhook verification
- Input validation
- SQL injection prevention

## 🚨 Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   ```bash
   # Check Redis server
   redis-cli ping
   ```

2. **Google Drive API Error**
   ```bash
   # Verify service account
   node -e "console.log(require('./service-account.json'))"
   ```

3. **Facebook API Rate Limit**
   ```bash
   # Check rate limit status
   curl http://localhost:3210/api/runtime-metrics
   ```

### Logs
```bash
# View logs
npm run workers:logs

# Check specific worker
pm2 logs posting-workers
```

## 📈 Performance

### Optimization
- Redis caching for tokens
- Connection pooling
- Worker concurrency (10 instances)
- Rate limiting protection
- Memory leak prevention

### Scaling
- Horizontal scaling with PM2
- Load balancing ready
- Database connection pooling
- Cache distribution

## 🔗 Dependencies

### Core
- Express.js - Web framework
- Redis (ioredis) - Caching
- Firestore - Database
- Google APIs - Drive integration
- Facebook Graph API - Social media

### Development
- Nodemon - Auto restart
- Winston - Logging
- PM2 - Process management

## 📝 Changelog

### v1.0.0 (2025-01-15)
- ✅ Initial release
- ✅ Google Drive integration
- ✅ Facebook posting API
- ✅ Token vault system
- ✅ Analytics collection
- ✅ Worker system
- ✅ Health monitoring

## 🤝 Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Check health endpoints
5. Verify environment variables

## 📄 License

ISC License - See LICENSE file for details

---

**Backend Status:** ✅ Operational  
**Last Health Check:** 2025-01-15 16:58:32  
**Uptime:** Running  
**Environment:** Development
