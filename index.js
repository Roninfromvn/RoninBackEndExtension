// index.js
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const dataApiRouter = require('./src/routes/dataApi'); // Sẽ tạo ở Bước 4.C

const app = express();
const PORT = config.PORT;

// Middleware cơ bản
app.use(express.json()); // Xử lý body JSON (cho việc ghi Log Stats)
app.use(express.urlencoded({ extended: true }));

// --- KẾT NỐI ROUTE ---
app.use('/api/v1/data', dataApiRouter); 
// --------------------

// Kiểm tra kết nối DB và khởi động server
db.query('SELECT 1 AS connected')
  .then(() => {
    console.log('✅ Database connected successfully.');
    app.listen(PORT, () => {
      console.log(`🚀 Ronin Metadata/Stats BE running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Database connection FAILED:', err.message);
    console.error('Please check your .env and PostgreSQL server.');
    process.exit(1);
  });