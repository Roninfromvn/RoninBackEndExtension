// src/services/PageService.js
const db = require('../db');

// Lấy Folder ID từ Page ID
async function getFolderIdByPageId(pageId) {
    const result = await db.query(
        'SELECT drive_folder_id FROM pages WHERE page_id = $1',
        [pageId]
    );
    return result.rows.length > 0 ? result.rows[0].drive_folder_id : null;
}

// Lấy Metadata ảnh đã lưu trong DB (đã được đồng bộ từ Drive)
async function getImagesMetadataByFolder(folderId) {
    const result = await db.query(
        `SELECT file_id, file_name, last_modified_time, file_size 
         FROM image_metadata 
         WHERE folder_id = $1 
         ORDER BY last_modified_time DESC`,
        [folderId]
    );
    return result.rows;
}

module.exports = {
    getFolderIdByPageId,
    getImagesMetadataByFolder,
};