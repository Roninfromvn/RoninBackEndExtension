// src/config.js
require('dotenv').config();

// Hàm loại bỏ ký tự escape (\n) trong private key để sử dụng
const formatPrivateKey = (key) => key.replace(/\\n/g, '\n');

module.exports = {
  // Cấu hình Server
  PORT: process.env.PORT || 3210,

  // Cấu hình Database
  DB_URL: `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,

  // Cấu hình Google Drive (Sử dụng Service Account)
  GOOGLE_DRIVE_ROOT_FOLDER_ID: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: formatPrivateKey(process.env.GOOGLE_PRIVATE_KEY),
  
  // Các cờ Bật/Tắt tính năng
  ENABLE_HMAC: process.env.ENABLE_HMAC === 'true',
  REDIS_ENABLED: process.env.REDIS_ENABLED === 'true',
  // ... có thể thêm các biến khác khi cần
};