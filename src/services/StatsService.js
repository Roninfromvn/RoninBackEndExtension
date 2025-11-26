// src/services/StatsService.js
const db = require('../db');

// Hàm Ghi Log sau khi Extension đăng bài thành công
async function createPostLog(logData) {
    const { postId, pageId, fileId, postUrl, status = 'success' } = logData;

    const result = await db.query(
        `INSERT INTO post_logs (post_id, page_id, file_id, post_url, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [postId, pageId, fileId, postUrl, status]
    );
    return result.rows[0];
}

module.exports = {
    createPostLog,
    // ... Thêm các hàm lấy Stats (ví dụ: getPageInsights) sau này
};