# Workers Documentation

## Overview
Workers là các script tự động hóa để thu thập dữ liệu và thực hiện các tác vụ định kỳ.

## Workers Available

### 1. simple_stats_worker.js
**Mục đích:** Thu thập thống kê cơ bản của Facebook pages

**Cách hoạt động:**
1. Kết nối PostgreSQL để lấy danh sách pages
2. Lấy page tokens từ Firestore qua API `/api/worker/token/:pageId`
3. Gọi Facebook Graph API để lấy insights (fan_count, follower_count)
4. Lưu dữ liệu vào bảng `page_stats_daily` trong PostgreSQL

**Cách sử dụng:**

#### A. Chạy trực tiếp (backfill):
```bash
cd drive-proxy
node workers/simple_stats_worker.js [YYYY-MM-DD]
```

#### B. Chạy qua backfill script (14 ngày):
```bash
cd drive-proxy
node run-backfill.js
```

#### C. Trigger qua Admin API:
```bash
curl -X POST http://localhost:3210/admin/run-ingestion \
  -H "Content-Type: application/json" \
  -d '{"targetDate": "2025-01-15"}'
```

**Cấu hình cần thiết:**
- Database PostgreSQL với bảng `pages` và `page_stats_daily`
- Firestore với collection `page_tokens`
- Facebook App credentials trong `.env`
- Backend server đang chạy (port 3210)

**Output:**
- Dữ liệu stats được lưu vào PostgreSQL
- Logs hiển thị tiến trình xử lý
- Error handling cho từng page

## 2. posting_worker.js
**Mục đích:** Tự động đăng bài lên Facebook pages

**Cách hoạt động:**
1. Lấy danh sách posts từ queue trong Firestore
2. Lấy page tokens trực tiếp từ Firestore
3. Upload media lên Facebook (nếu có)
4. Đăng bài với caption và media
5. Cập nhật trạng thái post

**Cách sử dụng:**
```bash
cd drive-proxy
node workers/posting_worker.js
```

## 3. worker.js
**Mục đích:** Đồng bộ Google Drive và Manifest

**Cách hoạt động:**
1. Đồng bộ folders từ Google Drive
2. Cập nhật manifest trong Firestore
3. Xử lý webhooks từ Google Drive

## Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://...

# Google Cloud
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Facebook
FACEBOOK_APP_ID=your-app-id
FACEBOOK_APP_SECRET=your-app-secret

# Backend
SELF_BASE_URL=http://localhost:3210
```

## Troubleshooting

### Worker không thể kết nối backend
- Kiểm tra backend có đang chạy không: `curl http://localhost:3210/health`
- Kiểm tra port 3210 có bị block không

### Không lấy được page tokens
- Kiểm tra Firestore có collection `page_tokens` không
- Kiểm tra tokens có status "active" không
- Kiểm tra API `/api/worker/token/:pageId` có hoạt động không

### Facebook API errors
- Kiểm tra page tokens có hết hạn không
- Kiểm tra Facebook App permissions
- Kiểm tra rate limits

## Monitoring

### Health Check
```bash
curl http://localhost:3210/health
curl http://localhost:3210/admin/health
```

### Logs
Workers sẽ log ra console với format:
```
[WorkerName] [Timestamp] Message
[SimpleStatsWorker] [2025-01-15T10:30:00Z] Processing page: page_id_123
```

## Cron Jobs (Recommended)

### Chạy stats worker hàng ngày:
```bash
# Crontab
0 2 * * * cd /path/to/drive-proxy && node workers/simple_stats_worker.js
```

### Chạy posting worker mỗi giờ:
```bash
# Crontab
0 * * * * cd /path/to/drive-proxy && node workers/posting_worker.js
```
