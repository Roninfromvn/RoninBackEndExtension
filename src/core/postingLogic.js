// src/core/postingLogic.js - Logic cốt lõi để xử lý một bài đăng (PostgreSQL only)
require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const FormData = require('form-data');
const fetch = require('node-fetch');
const { config } = require('../../config');
const { t, tend } = require('../utils/fsDebug');
const metrics = require('../metrics/metrics');

// Import các service
const GoogleDriveService = require('../services/GoogleDriveService');
const FacebookService = require('../services/FacebookService');

// Import PostgreSQL services
const PageConfigsService = require('../services/PageConfigsService');
const PostLogsService = require('../services/PostLogsService');
const FolderCaptionsService = require('../services/FolderCaptionsService');
const systemStateService = require('../services/SystemStateService');

// Tái sử dụng các hàm helpers từ các module khác
// Sử dụng Redis-based token store thay vì Firestore (same as /api/worker/token endpoint)
const { getBestTokenCandidate, loadEncryptedById } = require('../token/tokenStore.redis');
const { decryptTokenWithWrapping } = require('../token/kms');

// Khởi tạo các dịch vụ (PostgreSQL only)
const googleDriveService = new GoogleDriveService();
const facebookService = new FacebookService();
const folderCaptionsService = new FolderCaptionsService();

// Note: All Firestore collections removed - using PostgreSQL only
const MANIFEST_PATH = path.join(__dirname, '../..', 'data', 'manifest.json');

/**
 * Helper để lấy token an toàn từ record
 * @param {object} rec - Record chứa token
 * @returns {string|null} Token hoặc null
 */
function pickToken(rec) { 
  return rec?.token || rec?.access_token || rec?.value || rec?.pageToken || null; 
}

/**
 * Tải file từ Google Drive về buffer
 * @param {string} fileId - ID của file trên Drive
 * @returns {object} { buf: Buffer, mime: string, size: number }
 */
async function downloadDriveFileAsBuffer(fileId) {
  try {
    const result = await googleDriveService.downloadFileAsBuffer(fileId);
    // Lấy thêm size từ metadata nếu cần
    const metadata = await googleDriveService.getFileMetadata(fileId);
    return {
      ...result,
      size: parseInt(metadata.size) || result.buf.length
    };
  } catch (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Đăng ảnh lên Facebook
 * @param {object} params - { pageId, pageToken, fileBuf, mime, caption }
 * @returns {object} Kết quả từ Facebook API
 */
async function fbUploadPhoto({ pageId, pageToken, fileBuf, mime, caption }) {
  try {
    return await facebookService.uploadPhoto({ pageId, pageToken, fileBuf, mime, caption });
  } catch (error) {
    throw new Error(`[FB] ${error.message}`);
  }
}

/**
 * Đăng video nhỏ lên Facebook
 * @param {object} params - { pageId, pageToken, fileBuf, mime, caption }
 * @returns {object} Kết quả từ Facebook API
 */
async function fbUploadVideo({ pageId, pageToken, fileBuf, mime, caption }) {
  try {
    return await facebookService.uploadVideo({ pageId, pageToken, fileBuf, mime, caption });
  } catch (error) {
    throw new Error(`[FB] ${error.message}`);
  }
}

/**
 * Đăng comment lên Facebook
 * @param {object} params - { photoId, pageToken, message }
 * @returns {object} Kết quả từ Facebook API
 */
async function fbComment({ photoId, pageToken, message }) {
  try {
    return await facebookService.postComment({ photoId, pageToken, message });
  } catch (error) {
    throw new Error(`[FB_COMMENT] ${error.message}`);
  }
}

/**
 * Lấy caption từ folder
 * @param {string} folderId - ID của folder chứa ảnh
 * @returns {string} Caption được chọn ngẫu nhiên
 */
async function getCaptionFromFolder(folderId) {
  const timerKey = `pg:get_caption:${folderId}`;
  t(timerKey);
  
  try {
    // ✅ POSTGRESQL ONLY
    const randomCaption = await folderCaptionsService.getRandomCaption(folderId);
    
    if (randomCaption) {
      tend(timerKey, { op: 'GET', path: `folder_captions/${folderId}`, source: 'postgresql' });
      return randomCaption;
    }
    
    return null;
    
  } catch (error) {
    tend(timerKey, { op: 'GET', path: `folder_captions/${folderId}`, extra: { error: error.message } });
    console.warn(`[PostingLogic] Không thể lấy caption từ folder ${folderId}:`, error.message);
    return null;
  }
}

/**
 * Lấy comment từ folder
 * @param {string} folderId - ID của folder chứa ảnh
 * @returns {string} Comment được chọn ngẫu nhiên
 */
async function getCommentFromFolder(folderId) {
  const timerKey2 = `pg:get_comment:${folderId}`;
  t(timerKey2);
  
  try {
    // ✅ POSTGRESQL ONLY - Sử dụng FolderCaptionsService cho comments
    const randomComment = await folderCaptionsService.getRandomComment(folderId);
    
    if (randomComment) {
      tend(timerKey2, { op: 'GET', path: `folder_comments/${folderId}`, source: 'postgresql' });
      return randomComment;
    }
    
    return null;
    
  } catch (error) {
    tend(timerKey2, { op: 'GET', path: `folder_comments/${folderId}`, extra: { error: error.message } });
    console.warn(`[PostingLogic] Không thể lấy comment từ folder ${folderId}:`, error.message);
    return null;
  }
}

/**
 * Kiểm tra ảnh đã được sử dụng trong 14 ngày gần đây
 * @param {string} pageId - ID của page
 * @param {Array} candidateFiles - Danh sách file candidate
 * @returns {Array} Danh sách file không bị trùng
 */
async function filterRecentlyUsedFiles(pageId, candidateFiles) {
  const timerKey3 = `pg:check_recent_used:${pageId}`;
  t(timerKey3);
  
  try {
    // Lấy cutoff time (14 ngày trước)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    
    // ✅ POSTGRESQL ONLY - Sử dụng PostLogsService để check recent files
    const recentFiles = await PostLogsService.getRecentFiles(pageId, cutoff);
    
    const recentlyUsedFileIds = new Set(recentFiles.map(file => file.fileId));
    
    tend(timerKey3, { op: 'QUERY', path: `post_logs`, extra: { recentlyUsedCount: recentlyUsedFileIds.size } });
    
    // Lọc ra file chưa dùng gần đây
    const availableFiles = candidateFiles.filter(file => !recentlyUsedFileIds.has(file.id));
    
    // Nếu không có file nào khả dụng, fallback về tất cả candidates
    if (availableFiles.length === 0) {
      return candidateFiles;
    }
    
    return availableFiles;
  } catch (error) {
    tend(timerKey3, { op: 'QUERY', path: `post_logs`, extra: { error: error.message } });
    console.warn(`[PostingLogic] Không thể kiểm tra file đã dùng, fallback về tất cả candidates:`, error.message);
    return candidateFiles;
  }
}

/**
 * Hàm chính để thực thi việc đăng một bài.
 * @param {object} jobDetails - Chi tiết công việc.
 * @returns {object} Kết quả đăng bài.
 */
async function executePost(jobDetails) {
    const { pageId, forceFileId, forceCaption } = jobDetails;
    const startedAt = new Date();
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Chỉ log khi debug mode
    if (process.env.DEBUG_POSTING === '1') {
        console.log(`[PostingLogic] Executing post for page: ${pageId}, requestId: ${requestId}`);
    }

    try {
        // 1. Lấy token từ Redis (same logic as /api/worker/token endpoint)
        const tokenCandidate = await getBestTokenCandidate(pageId);
        if (!tokenCandidate) {
            throw new Error(`No active tokens found for page ${pageId} in Redis`);
        }
        
        // Load encrypted token data (same as API endpoint)
        const encryptedData = await loadEncryptedById(pageId, tokenCandidate.tokenId);
        if (!encryptedData) {
            throw new Error(`Token data not found for page ${pageId}`);
        }
        
        // Decrypt token (same as API endpoint)
        let pageToken;
        try {
            pageToken = await decryptTokenWithWrapping(encryptedData);
        } catch (decryptError) {
            throw new Error(`Token decryption failed for page ${pageId}: ${decryptError.message}`);
        }
        
        if (!pageToken) {
            throw new Error(`Invalid token format for page ${pageId}`);
        }

        // 2. Lấy cấu hình page (PostgreSQL only)
        const t1 = `get_page_cfg:${pageId}`;
        t(t1);
        
        let pageConfig;
        try {
            pageConfig = await PageConfigsService.getConfig(pageId);
            
            if (!pageConfig) {
                // Default config: sử dụng tất cả folder con của root folder
                pageConfig = {
                    enabled: true,
                    folderIds: [], // Empty = sử dụng tất cả folders
                    schedule: ['08:00', '12:00', '18:00'], // Default schedule
                    postsPerSlot: 1
                };
            }
        } catch (pgError) {
            // Default config nếu có lỗi
            pageConfig = {
                enabled: true,
                folderIds: [], // Empty = sử dụng tất cả folders
                schedule: ['08:00', '12:00', '18:00'],
                postsPerSlot: 1
            };
        }
        
        tend(t1, { op: 'GET', path: `page_cfg/${pageId}`, source: 'postgresql_or_default' });

        // 3. Chọn ảnh
        let selectedFile;
        
        try {
            const manifestContent = await fs.readFile(MANIFEST_PATH, 'utf8');
            const manifest = JSON.parse(manifestContent);
            
            if (forceFileId) {
                selectedFile = manifest.find(file => file.id === forceFileId);
                if (!selectedFile) throw new Error(`Forced fileId ${forceFileId} not found in manifest.`);
            } else {
                // Lọc file theo folder được cấu hình
                let candidateFiles;
                
                if (!pageConfig.folderIds || pageConfig.folderIds.length === 0) {
                    // Không có config folderIds → Lấy tất cả folder con của root folder
                    const ROOT_FOLDER_ID = '1rNDLaYOn4vNKiKAbaqBmSqu14GH0vA8H';
                    
                    // Lấy tất cả files có parent là subfolder của root (không phải trực tiếp trong root)
                    candidateFiles = manifest.filter(file => {
                        if (!file.parents || file.parents.length === 0) return false;
                        // File phải không nằm trực tiếp trong root folder
                        return !file.parents.includes(ROOT_FOLDER_ID);
                    });
                } else {
                    // Có config folderIds → Lọc theo config
                    candidateFiles = manifest.filter(file => 
                        pageConfig.folderIds.some(folderId => file.parents && file.parents.includes(folderId))
                    );
                }
                
                if (candidateFiles.length === 0) {
                    throw new Error(`No available images for page ${pageId}. Check folder configuration or manifest data.`);
                }
                
                // Lọc file đã dùng gần đây (14 ngày)
                const availableFiles = await filterRecentlyUsedFiles(pageId, candidateFiles);
                
                // Chọn file ngẫu nhiên
                selectedFile = availableFiles[Math.floor(Math.random() * availableFiles.length)];
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Manifest file not found at ${MANIFEST_PATH}. Please run worker.js first to generate manifest.`);
            }
            throw error;
        }

        // 4. Chọn caption theo thứ tự ưu tiên: forceCaption → folder caption → default caption
        let caption = '';
        
        if (forceCaption) {
            caption = forceCaption;
        } else if (selectedFile.parents && selectedFile.parents.length > 0) {
            // Tìm folder giao giữa file.parents và pageConfig.folderIds
            const commonFolders = selectedFile.parents.filter(folderId => 
                pageConfig.folderIds && pageConfig.folderIds.includes(folderId)
            );
            
            if (commonFolders.length > 0) {
                // Thử lấy caption từ folder đầu tiên
                const folderCaption = await getCaptionFromFolder(commonFolders[0]);
                if (folderCaption) {
                    caption = folderCaption;
                }
            }
        }
        
        // Fallback về default caption nếu không có caption từ folder
        if (!caption) {
            caption = pageConfig.defaultCaption || '';
        }

        // 5. Tải file từ Drive
        const downloadStart = Date.now();
        const { buf, mime, size } = await downloadDriveFileAsBuffer(selectedFile.id);
        const downloadMs = Date.now() - downloadStart;
        
        // Metrics: Drive download
        metrics.observe('drive.download_ms', downloadMs);
        metrics.inc('drive.bytes_downloaded', buf.length);

        // 6. Đăng lên Facebook theo loại media
        let mediaId, mediaType;
        
        if (mime.startsWith('image/')) {
            const uploadStart = Date.now();
            const uploadResult = await fbUploadPhoto({ 
                pageId, 
                pageToken, 
                fileBuf: buf, 
                mime, 
                caption 
            });
            const uploadMs = Date.now() - uploadStart;
            mediaId = uploadResult.id || uploadResult.post_id;
            mediaType = 'photo';
            
            // Metrics: Facebook upload và media type
            metrics.observe('facebook.upload_ms', uploadMs);
            metrics.inc('media.photo.count');
        } else if (mime.startsWith('video/') && size <= 50 * 1024 * 1024) { // 50MB limit
            const uploadStart = Date.now();
            const uploadResult = await fbUploadVideo({ 
                pageId, 
                pageToken, 
                fileBuf: buf, 
                mime, 
                caption 
            });
            const uploadMs = Date.now() - uploadStart;
            mediaId = uploadResult.id || uploadResult.post_id;
            mediaType = 'video';
            
            // Metrics: Facebook upload và media type
            metrics.observe('facebook.upload_ms', uploadMs);
            metrics.inc('media.video.count');
        } else {
            throw new Error(`Unsupported MIME type: ${mime} (size: ${size} bytes)`);
        }

        // 7. Xử lý comment nếu có
        let commentId = null;
        if (selectedFile.parents && selectedFile.parents.length > 0) {
            const commonFolders = selectedFile.parents.filter(folderId => 
                pageConfig.folderIds && pageConfig.folderIds.includes(folderId)
            );
            
            if (commonFolders.length > 0) {
                const comment = await getCommentFromFolder(commonFolders[0]);
                
                if (comment && comment.trim()) {
                    try {
                        const commentResponse = await fbComment({
                            photoId: mediaId,
                            pageToken,
                            message: comment.trim()
                        });
                        commentId = commentResponse.id;
                    } catch (commentError) {
                        // Comment lỗi không ảnh hưởng đến post chính
                    }
                }
            }
        }

        // 8. Đánh dấu ảnh đã dùng (PostgreSQL only)
        const t2 = `pg:mark_used:${pageId}_${selectedFile.id}`;
        t(t2);
        
        // Sử dụng PostLogsService để track file usage
        try {
            await PostLogsService.markFileUsed(pageId, selectedFile.id);
            tend(t2, { op: 'INSERT', path: `post_logs`, source: 'postgresql' });
        } catch (error) {
            // Không throw error vì đây không phải lỗi nghiêm trọng
        }

        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        // Log thành công sẽ được xử lý ở posting_worker.js
        
        const result = {
            success: true,
            mediaId,
            mediaType,
            commentId,
            fileId: selectedFile.id,
            fileName: selectedFile.name,
            pageId,
            caption,
            comment: commentId ? 'comment_added' : null,
            folderId: selectedFile.parents?.[0] || null,
            startedAt,
            finishedAt,
            durationMs,
            requestId
        };

        // 9. Ghi log thành công (PostgreSQL only)
        const t3 = `log_success:${requestId}`;
        t(t3);
        
        const successLogData = {
            ...result,
            status: 'success',
            ts: new Date(),
            agentId: 'posting-worker',
            pageId,
            fileId: selectedFile.id,
            requestId
        };
        
        // Log to PostgreSQL
        try {
            await PostLogsService.createLog({
                pageId,
                postId: result.mediaId || result.id,
                status: 'success',
                ...successLogData
            });
        } catch (pgError) {
            // Log lỗi không ảnh hưởng đến kết quả chính
        }
        
        tend(t3, { op: 'INSERT', path: `post_logs`, source: 'postgresql' });

        return result;

    } catch (error) {
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        
        // Error log sẽ được xử lý ở posting_worker.js
        
        // Ghi log lỗi (PostgreSQL only)
        const t4 = `log_error:${requestId}`;
        t(t4);
        
        const errorLogData = {
            status: 'error',
            pageId,
            fileId: forceFileId || null,
            error: error.message,
            startedAt,
            finishedAt,
            durationMs,
            requestId,
            ts: new Date(),
            agentId: 'posting-worker'
        };
        
        // Log to PostgreSQL
        try {
            await PostLogsService.createLog({
                pageId,
                postId: null,
                status: 'failed',
                ...errorLogData
            });
        } catch (pgError) {
            // Log lỗi không ảnh hưởng đến kết quả chính
        }
        
        tend(t4, { op: 'INSERT', path: `post_logs`, source: 'postgresql' });
        
        throw error;
    }
}

module.exports = { executePost };
