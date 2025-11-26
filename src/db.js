// src/db.js
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.DB_URL,
});

// Hàm query cơ bản
module.exports = {
  /**
   * Thực thi một truy vấn SQL
   * @param {string} text - Câu lệnh SQL
   * @param {Array<any>} params - Tham số cho câu lệnh
   */
  query: (text, params) => {
    console.log('EXECUTING QUERY:', text);
    return pool.query(text, params);
  },
  pool: pool,
};