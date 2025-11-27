// src/services/PostingService.js - Posting orchestration service
const GoogleDriveService = require('./GoogleDriveService');
const FacebookService = require('./FacebookService');
const { AppError } = require('../../middleware/errorHandler');
const { logger } = require('../utils/logger');

class PostingService {
  constructor() {
    this.googleDriveService = new GoogleDriveService();
    this.facebookService = new FacebookService();
  }

  /**
   * Thực hiện đăng bài hoàn chỉnh
   * @param {Object} params - Tham số đăng bài
   * @param {string} params.pageId - ID của Facebook page
   * @param {string} params.pageToken - Access token của page
   * @param {string} params.fileId - ID của file trên Google Drive
   * @param {string} params.caption - Caption cho bài đăng
   * @param {string} params.comment - Comment cho bài đăng
   * @param {string} params.correlationId - Correlation ID cho tracking
   * @returns {Promise<Object>} Kết quả đăng bài
   */
  async executePost({ pageId, pageToken, fileId, caption, comment, correlationId }) {
    const startTime = Date.now();
    const stepLogs = [];
    
    logger.info('posting_execute_started', { 
      pageId, 
      fileId, 
      correlationId,
      operation: 'execute_post' 
    });

    try {
      // 1. Tải file từ Google Drive
      logger.info('posting_step_started', { 
        pageId, 
        fileId, 
        correlationId,
        step: 'download_file',
        stepNumber: 1
      });
      
      let buf, mime, fileMetadata;
      try {
        const downloadResult = await this.googleDriveService.downloadFileAsBuffer(fileId);
        buf = downloadResult.buf;
        mime = downloadResult.mime;
        
        stepLogs.push({
          step: 'download_file',
          status: 'success',
          duration: Date.now() - startTime,
          fileSize: buf.length,
          mime
        });
        
        logger.info('posting_step_completed', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'download_file',
          fileSize: buf.length,
          mime
        });
      } catch (error) {
        const stepError = {
          step: 'download_file',
          status: 'failed',
          error: error.message,
          errorCode: error.code,
          duration: Date.now() - startTime
        };
        stepLogs.push(stepError);
        
        logger.error('posting_step_failed', { 
          pageId, 
          fileId, 
          correlationId,
          ...stepError
        });
        throw new AppError(`Failed to download file: ${error.message}`, 502, 'DRIVE_DOWNLOAD_ERROR', { 
          fileId, 
          originalError: error.message,
          step: 'download_file'
        });
      }
      
      // 2. Validate file type
      logger.info('posting_step_started', { 
        pageId, 
        fileId, 
        correlationId,
        step: 'validate_file_type',
        stepNumber: 2,
        mime
      });
      
      try {
        if (!this.googleDriveService.validateFileType(mime)) {
          const stepError = {
            step: 'validate_file_type',
            status: 'failed',
            error: `Invalid file type: ${mime}`,
            errorCode: 'INVALID_FILE_TYPE',
            duration: Date.now() - startTime
          };
          stepLogs.push(stepError);
          
          logger.error('posting_step_failed', { 
            pageId, 
            fileId, 
            correlationId,
            ...stepError
          });
          throw new AppError(`Invalid file type: ${mime}`, 400, 'FILE_VALIDATION_ERROR', { fileId, mime });
        }
        
        stepLogs.push({
          step: 'validate_file_type',
          status: 'success',
          duration: Date.now() - startTime,
          mime
        });
        
        logger.info('posting_step_completed', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'validate_file_type',
          mime
        });
      } catch (error) {
        if (error.code === 'INVALID_FILE_TYPE') {
          throw error; // Re-throw validation errors
        }
        throw new AppError(`File validation failed: ${error.message}`, 400, 'FILE_VALIDATION_ERROR', { 
          fileId, 
          mime,
          originalError: error.message
        });
      }

      // 3. Lấy metadata của file (optional)
      logger.info('posting_step_started', { 
        pageId, 
        fileId, 
        correlationId,
        step: 'get_file_metadata',
        stepNumber: 3
      });
      
      try {
        fileMetadata = await this.googleDriveService.getFileMetadata(fileId);
        stepLogs.push({
          step: 'get_file_metadata',
          status: 'success',
          duration: Date.now() - startTime,
          fileName: fileMetadata.name,
          folderId: fileMetadata.parents?.[0]
        });
        
        logger.info('posting_step_completed', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'get_file_metadata',
          fileName: fileMetadata.name
        });
      } catch (error) {
        stepLogs.push({
          step: 'get_file_metadata',
          status: 'failed',
          error: error.message,
          errorCode: error.code,
          duration: Date.now() - startTime
        });
        
        logger.warn('posting_step_failed', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'get_file_metadata',
          error: error.message 
        });
        // Không throw error, chỉ ghi log cảnh báo
      }

      // 4. Upload lên Facebook
      const uploadStartTime = Date.now();
      logger.info('posting_step_started', { 
        pageId, 
        fileId, 
        correlationId,
        step: 'upload_to_facebook',
        stepNumber: 4,
        mediaType: mime.startsWith('image/') ? 'image' : 'video'
      });
      
      let uploadResult;
      
      try {
        if (mime.startsWith('image/')) {
          uploadResult = await this.facebookService.uploadPhoto({
            pageId,
            pageToken,
            fileBuf: buf,
            mime,
            caption
          });
        } else if (mime.startsWith('video/')) {
          uploadResult = await this.facebookService.uploadVideo({
            pageId,
            pageToken,
            fileBuf: buf,
            mime,
            caption
          });
        } else {
          const stepError = {
            step: 'upload_to_facebook',
            status: 'failed',
            error: `Unsupported file type: ${mime}`,
            errorCode: 'UNSUPPORTED_FILE_TYPE',
            duration: Date.now() - startTime
          };
          stepLogs.push(stepError);
          
          logger.error('posting_step_failed', { 
            pageId, 
            fileId, 
            correlationId,
            ...stepError
          });
                     throw new AppError(`Unsupported file type: ${mime}`, 400, 'FILE_VALIDATION_ERROR', { fileId, mime });
        }

        const mediaId = uploadResult.id || uploadResult.post_id;
        stepLogs.push({
          step: 'upload_to_facebook',
          status: 'success',
          duration: Date.now() - uploadStartTime,
          mediaId,
          mediaType: mime.startsWith('image/') ? 'image' : 'video'
        });
        
        logger.info('posting_step_completed', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'upload_to_facebook',
          mediaId,
          mediaType: mime.startsWith('image/') ? 'image' : 'video'
        });
      } catch (error) {
        const stepError = {
          step: 'upload_to_facebook',
          status: 'failed',
          error: error.message,
          errorCode: error.code,
          fbCode: error.fb?.code,
          fbType: error.fb?.type,
          duration: Date.now() - uploadStartTime
        };
        stepLogs.push(stepError);
        
        logger.error('posting_step_failed', { 
          pageId, 
          fileId, 
          correlationId,
          ...stepError
        });
        throw error; // Re-throw Facebook upload errors
      }

      // 5. Post comment nếu có
      let commentId = null;
      if (comment && comment.trim()) {
        const commentStartTime = Date.now();
        logger.info('posting_step_started', { 
          pageId, 
          fileId, 
          correlationId,
          step: 'post_comment',
          stepNumber: 5
        });
        
        try {
          const commentResult = await this.facebookService.postComment({
            photoId: uploadResult.id || uploadResult.post_id,
            pageToken,
            message: comment.trim()
          });
          commentId = commentResult.id;
          
          stepLogs.push({
            step: 'post_comment',
            status: 'success',
            duration: Date.now() - commentStartTime,
            commentId
          });
          
          logger.info('posting_step_completed', { 
            pageId, 
            fileId, 
            correlationId,
            step: 'post_comment',
            commentId 
          });
        } catch (commentError) {
          stepLogs.push({
            step: 'post_comment',
            status: 'failed',
            error: commentError.message,
            errorCode: commentError.code,
            fbCode: commentError.fb?.code,
            duration: Date.now() - commentStartTime
          });
          
          logger.warn('posting_step_failed', { 
            pageId, 
            fileId, 
            correlationId,
            step: 'post_comment',
            error: commentError.message 
          });
          // Không throw error, chỉ ghi log cảnh báo
        }
      }

      const duration = Date.now() - startTime;
      logger.info('posting_execute_success', { 
        pageId, 
        fileId, 
        correlationId,
        mediaId: uploadResult.id || uploadResult.post_id,
        commentId, 
        duration,
        stepLogs: stepLogs.length
      });

      return {
        success: true,
        mediaId: uploadResult.id || uploadResult.post_id,
        commentId,
        fileId,
        fileName: fileMetadata?.name || 'unknown',
        folderId: fileMetadata?.parents?.[0] || null,
        caption,
        comment: commentId ? 'comment_added' : null,
        duration,
        uploadResult,
        stepLogs
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log final error with all context
      logger.error('posting_execute_error', { 
        pageId, 
        fileId, 
        correlationId,
        error: error.message,
        errorCode: error.code,
        fbCode: error.fb?.code,
        fbType: error.fb?.type,
        duration,
        stepLogs,
        stack: error.stack
      });
      
              throw new AppError(
          `Failed to execute post: ${error.message}`, 
          error.statusCode || 500, 
          error.code || 'POSTING_EXECUTION_ERROR',
          { 
            pageId, 
            fileId, 
            correlationId,
            duration,
            stepLogs,
            originalError: error.message,
            fbCode: error.fb?.code,
            fbType: error.fb?.type
          }
        );
    }
  }

  /**
   * Validate input parameters
   * @param {Object} params - Tham số cần validate
   * @returns {Object} Tham số đã validate
   */
  validateInput(params) {
    const { pageId, pageToken, fileId } = params;
    
    if (!pageId) {
      throw new AppError('Missing pageId parameter', 400, 'MISSING_PAGE_ID');
    }
    
    if (!pageToken) {
      throw new AppError('Missing pageToken parameter', 400, 'MISSING_PAGE_TOKEN');
    }
    
    if (!fileId) {
      throw new AppError('Missing fileId parameter', 400, 'MISSING_FILE_ID');
    }

    return params;
  }

  /**
   * Kiểm tra file có tồn tại trên Google Drive không
   * @param {string} fileId - ID của file
   * @returns {Promise<boolean>} True nếu file tồn tại
   */
  async validateFileExists(fileId) {
    return await this.googleDriveService.fileExists(fileId);
  }

  /**
   * Kiểm tra quyền của page token
   * @param {string} pageId - ID của page
   * @param {string} pageToken - Access token
   * @returns {Promise<Object>} Thông tin quyền
   */
  async validatePagePermissions(pageId, pageToken) {
    return await this.facebookService.checkPagePermissions(pageId, pageToken);
  }
}

module.exports = PostingService;
