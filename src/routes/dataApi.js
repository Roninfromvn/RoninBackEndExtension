// src/routes/dataApi.js
const express = require('express');
const router = express.Router();
const PageService = require('../services/PageService');
const StatsService = require('../services/StatsService');

// Endpoint 1: LẤY METADATA ẢNH CHO EXTENSION
// Extension sẽ gọi: GET /api/v1/data/images/by-page/:pageId
router.get('/images/by-page/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        
        const folderId = await PageService.getFolderIdByPageId(pageId);
        if (!folderId) {
            return res.status(404).json({ message: 'Folder not assigned to this Page.' });
        }

        const images = await PageService.getImagesMetadataByFolder(folderId);

        res.json({
            status: 'success',
            folderId: folderId,
            images: images,
        });
    } catch (error) {
        console.error('Error fetching image metadata:', error);
        res.status(500).json({ message: 'Internal server error while fetching metadata.' });
    }
});

// Endpoint 2: EXTENSION GỬI LOG BÀI ĐĂNG (GHI LOG STATS)
// Extension sẽ gọi: POST /api/v1/data/log-post
router.post('/log-post', async (req, res) => {
    try {
        // Log logData chứa: { postId, pageId, fileId, postUrl, status }
        const logData = req.body; 
        
        if (!logData.postId || !logData.pageId) {
             return res.status(400).json({ message: 'Missing required log data (postId or pageId).' });
        }

        const logEntry = await StatsService.createPostLog(logData);

        res.status(201).json({ 
            status: 'success', 
            message: 'Post log recorded.',
            logId: logEntry.id 
        });
    } catch (error) {
        console.error('Error creating post log:', error);
        res.status(500).json({ message: 'Internal server error while recording log.' });
    }
});

module.exports = router;