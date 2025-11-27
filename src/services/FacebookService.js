// src/services/FacebookService.js - Facebook API operations
const { AppError } = require('../../middleware/errorHandler');
const { logger } = require('../utils/logger');

class FacebookService {
  constructor() {
    this.apiBase = 'https://graph.facebook.com/v18.0';
  }

  /**
   * Upload ảnh lên Facebook
   * @param {Object} params - Tham số upload
   * @param {string} params.pageId - ID của Facebook page
   * @param {string} params.pageToken - Access token của page
   * @param {Buffer} params.fileBuf - Buffer của file ảnh
   * @param {string} params.mime - MIME type của file
   * @param {string} params.caption - Caption cho ảnh
   * @returns {Promise<Object>} Kết quả upload
   */
  async uploadPhoto({ pageId, pageToken, fileBuf, mime, caption }) {
    const startTime = Date.now();
    
    try {
      // logger.info('facebook_upload_started', { 
      //   pageId, 
      //   operation: 'upload_photo',
      //   fileSize: fileBuf.length,
      //   mime 
      // });
      
      const url = `${this.apiBase}/${pageId}/photos`;
      const formData = new FormData();
      
      // Tạo blob từ buffer
      const blob = new Blob([fileBuf], { type: mime });
      formData.append('source', blob, 'image.jpg');
      
      if (caption) {
        formData.append('message', caption);
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pageToken}`
        },
        body: formData
      });

      const result = await response.json();
      const duration = Date.now() - startTime;
      
      if (!response.ok) {
        const error = result.error || {};
        logger.error('facebook_upload_api_error', { 
          pageId, 
          fbCode: error.code, 
          fbType: error.type,
          fbMessage: error.message,
          duration,
          statusCode: response.status,
          statusText: response.statusText
        });
        
        // Tạo error với Facebook context
        const fbError = new AppError(
          `Facebook API error: ${error.message || response.statusText}`, 
          502, 
          'FB_UPLOAD_ERROR',
          { 
            pageId, 
            fbCode: error.code, 
            fbType: error.type,
            statusCode: response.status
          }
        );
        fbError.fb = error; // Thêm Facebook error context
        throw fbError;
      }

      // logger.info('facebook_upload_success', { 
      //   pageId, 
      //   photoId: result.id,
      //   duration 
      // });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Nếu đã là AppError với Facebook context, chỉ log thêm
      if (error instanceof AppError && error.fb) {
        logger.error('facebook_upload_error', { 
          pageId, 
          error: error.message,
          fbCode: error.fb.code,
          fbType: error.fb.type,
          duration 
        });
        throw error;
      }
      
      logger.error('facebook_upload_error', { 
        pageId, 
        error: error.message,
        duration 
      });
      
      if (error instanceof AppError) {
        throw error;
      }
      
             throw new AppError('Failed to upload photo to Facebook', 502, 'FB_UPLOAD_ERROR', { 
         pageId, 
         originalError: error.message 
       });
    }
  }

  /**
   * Upload video lên Facebook
   * @param {Object} params - Tham số upload
   * @param {string} params.pageId - ID của Facebook page
   * @param {string} params.pageToken - Access token của page
   * @param {Buffer} params.fileBuf - Buffer của file video
   * @param {string} params.mime - MIME type của file
   * @param {string} params.caption - Caption cho video
   * @returns {Promise<Object>} Kết quả upload
   */
  async uploadVideo({ pageId, pageToken, fileBuf, mime, caption }) {
    try {
      console.log(`[FacebookService] Bắt đầu upload video cho page ${pageId}...`);
      
      const url = `${this.apiBase}/${pageId}/videos`;
      const formData = new FormData();
      
      // Tạo blob từ buffer
      const blob = new Blob([fileBuf], { type: mime });
      formData.append('source', blob, 'video.mp4');
      
      if (caption) {
        formData.append('description', caption);
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${pageToken}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (!response.ok) {
        const error = result.error || {};
        console.error('[FacebookService] ❌ Facebook API error:', error);
                 throw new AppError(
           `Facebook API error: ${error.message || response.statusText}`, 
           502, 
           'FB_UPLOAD_ERROR',
           { 
             pageId, 
             fbCode: error.code, 
             fbType: error.type 
           }
         );
      }

      console.log(`[FacebookService] ✅ Upload video thành công: ${result.id}`);
      return result;
    } catch (error) {
      console.error(`[FacebookService] ❌ Lỗi upload video cho page ${pageId}:`, error.message);
      
      if (error instanceof AppError) {
        throw error;
      }
      
             throw new AppError('Failed to upload video to Facebook', 502, 'FB_UPLOAD_ERROR', { 
         pageId, 
         originalError: error.message 
       });
    }
  }

  /**
   * Post comment lên ảnh/video
   * @param {Object} params - Tham số comment
   * @param {string} params.photoId - ID của ảnh/video
   * @param {string} params.pageToken - Access token của page
   * @param {string} params.message - Nội dung comment
   * @returns {Promise<Object>} Kết quả comment
   */
  async postComment({ photoId, pageToken, message }) {
    try {
      console.log(`[FacebookService] Bắt đầu post comment cho ${photoId}...`);
      
      const url = `${this.apiBase}/${photoId}/comments`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pageToken}`
        },
        body: JSON.stringify({
          message: message
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        const error = result.error || {};
        console.error('[FacebookService] ❌ Facebook API error:', error);
                 throw new AppError(
           `Facebook API error: ${error.message || response.statusText}`, 
           502, 
           'FB_COMMENT_ERROR',
           { 
             photoId, 
             fbCode: error.code, 
             fbType: error.type 
           }
         );
      }

      console.log(`[FacebookService] ✅ Post comment thành công: ${result.id}`);
      return result;
    } catch (error) {
      console.error(`[FacebookService] ❌ Lỗi post comment cho ${photoId}:`, error.message);
      
      if (error instanceof AppError) {
        throw error;
      }
      
             throw new AppError('Failed to post comment to Facebook', 502, 'FB_COMMENT_ERROR', { 
         photoId, 
         originalError: error.message 
       });
    }
  }

  /**
   * Kiểm tra quyền của page token
   * @param {string} pageId - ID của Facebook page
   * @param {string} pageToken - Access token của page
   * @returns {Promise<Object>} Thông tin quyền của page
   */
  async checkPagePermissions(pageId, pageToken) {
    try {
      console.log(`[FacebookService] Kiểm tra quyền page ${pageId}...`);
      
      const url = `${this.apiBase}/${pageId}?fields=id,name,access_token,permissions`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${pageToken}`
        }
      });

      const result = await response.json();
      
      if (!response.ok) {
        const error = result.error || {};
                 throw new AppError(
           `Facebook API error: ${error.message || response.statusText}`, 
           502, 
           'FB_PERMISSION_ERROR',
           { pageId, fbCode: error.code }
         );
      }

      console.log(`[FacebookService] ✅ Kiểm tra quyền thành công: ${result.name}`);
      return result;
    } catch (error) {
      console.error(`[FacebookService] ❌ Lỗi kiểm tra quyền page ${pageId}:`, error.message);
      
      if (error instanceof AppError) {
        throw error;
      }
      
             throw new AppError('Failed to check page permissions', 502, 'FB_PERMISSION_ERROR', { 
         pageId, 
         originalError: error.message 
       });
    }
  }
}

module.exports = FacebookService;
