// src/services/GoogleDriveService.js - Google Drive operations
const { google } = require('googleapis');
const path = require('path');
const { config } = require('../../config');
const { AppError } = require('../../middleware/errorHandler');
const { logger } = require('../utils/logger');

class GoogleDriveService {
  constructor() {
    try {
      // Thử đọc credentials từ environment variables trước
      if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        console.log('🔐 GoogleDriveService: Using credentials from environment variables');
        this.auth = new google.auth.GoogleAuth({
          credentials: {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          },
          scopes: config.googleDrive.scopes,
        });
      } else if (config.googleDrive.serviceAccountPath) {
        // Fallback to file-based credentials
        console.log('📁 GoogleDriveService: Using credentials from file:', config.googleDrive.serviceAccountPath);
        this.auth = new google.auth.GoogleAuth({
          keyFile: path.join(__dirname, '../../..', config.googleDrive.serviceAccountPath),
          scopes: config.googleDrive.scopes,
        });
      } else {
        throw new Error('No Google Drive credentials found in environment or config');
      }
      
      this.drive = google.drive({ version: 'v3', auth: this.auth });
    } catch (error) {
      console.error('❌ Failed to initialize GoogleDriveService:', error.message);
      console.log('⚠️ Google Drive features will be disabled');
      this.auth = null;
      this.drive = null;
    }
  }

  /**
   * Tải file từ Google Drive và trả về buffer
   * @param {string} fileId - ID của file trên Google Drive
   * @returns {Promise<{buf: Buffer, mime: string}>} Buffer và MIME type của file
   */
  async downloadFileAsBuffer(fileId) {
    const startTime = Date.now();
    
    try {
      // logger.info('drive_download_started', { 
      //   fileId, 
      //   operation: 'download_file_as_buffer' 
      // });
      
      const response = await this.drive.files.get({
        fileId: fileId,
        alt: 'media'
      }, {
        responseType: 'arraybuffer'
      });

      const buf = Buffer.from(response.data);
      const mime = response.headers['content-type'] || 'application/octet-stream';
      const duration = Date.now() - startTime;

      if (buf.length === 0) {
        logger.error('drive_download_empty_file', { fileId, duration });
        throw new AppError('Downloaded file is empty', 400, 'EMPTY_FILE', { fileId });
      }

      // logger.info('drive_download_success', { 
      //   fileId, 
      //   size: buf.length, 
      //   mime, 
      //   duration 
      // });
      
      return { buf, mime };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('drive_download_error', { 
        fileId, 
        error: error.message, 
        code: error.code,
        duration 
      });
      
      if (error.code === 404) {
        throw new AppError('File not found on Google Drive', 404, 'DRIVE_FILE_NOT_FOUND', { fileId });
      }
      
      if (error.code === 403) {
        throw new AppError('Access denied to Google Drive file', 403, 'DRIVE_ACCESS_DENIED', { fileId });
      }
      
      throw new AppError('Failed to download file from Google Drive', 502, 'DRIVE_DOWNLOAD_ERROR', { 
        fileId, 
        originalError: error.message 
      });
    }
  }

  /**
   * Lấy metadata của file từ Google Drive
   * @param {string} fileId - ID của file trên Google Drive
   * @returns {Promise<Object>} Metadata của file
   */
  async getFileMetadata(fileId) {
    const startTime = Date.now();
    
    try {
      // logger.info('drive_metadata_started', { 
      //   fileId, 
      //   operation: 'get_file_metadata' 
      // });
      
      const response = await this.drive.files.get({
        fileId: fileId,
        fields: 'id,name,parents,mimeType,size,createdTime,modifiedTime'
      });

      const metadata = response.data;
      const duration = Date.now() - startTime;
      
      // logger.info('drive_metadata_success', { 
      //   fileId, 
      //   fileName: metadata.name,
      //   size: metadata.size,
      //   duration 
      // });
      
      return metadata;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('drive_metadata_error', { 
        fileId, 
        error: error.message, 
        code: error.code,
        duration 
      });
      
      if (error.code === 404) {
        throw new AppError('File not found on Google Drive', 404, 'DRIVE_FILE_NOT_FOUND', { fileId });
      }
      
      throw new AppError('Failed to get file metadata from Google Drive', 502, 'DRIVE_METADATA_ERROR', { 
        fileId, 
        originalError: error.message 
      });
    }
  }

  /**
   * Kiểm tra file có tồn tại và có thể truy cập không
   * @param {string} fileId - ID của file trên Google Drive
   * @returns {Promise<boolean>} True nếu file tồn tại và có thể truy cập
   */
  async fileExists(fileId) {
    try {
      await this.drive.files.get({
        fileId: fileId,
        fields: 'id'
      });
      return true;
    } catch (error) {
      if (error.code === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Validate file type
   * @param {string} mimeType - MIME type của file
   * @param {Array<string>} allowedTypes - Danh sách MIME types được phép
   * @returns {boolean} True nếu file type hợp lệ
   */
  validateFileType(mimeType, allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    return allowedTypes.includes(mimeType);
  }

  /**
   * Liệt kê file theo query (có phân trang)
   * @param {string} q - Query string
   * @param {string} fields - Fields cần lấy
   * @param {number} pageSize - Kích thước trang
   * @returns {Promise<Array>} Danh sách files
   */
  async listByQuery(q, fields = "files(id,name,mimeType,parents,createdTime),nextPageToken", pageSize = 1000) {
    const startTime = Date.now();
    
    try {
      logger.info('drive_list_query_started', { 
        query: q, 
        fields, 
        pageSize,
        operation: 'list_by_query' 
      });
      
      let out = [];
      let pageToken = null;
      
      do {
        const response = await this.drive.files.list({
          q,
          fields,
          pageSize,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        
        out = out.concat(response.data.files || []);
        pageToken = response.data.nextPageToken || null;
      } while (pageToken);
      
      const duration = Date.now() - startTime;
      logger.info('drive_list_query_success', { 
        query: q, 
        resultCount: out.length,
        duration 
      });
      
      return out;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('drive_list_query_error', { 
        query: q, 
        error: error.message, 
        code: error.code,
        duration 
      });
      
      throw new AppError('Failed to list files from Google Drive', 502, 'DRIVE_LIST_ERROR', { 
        query: q, 
        originalError: error.message 
      });
    }
  }

  /**
   * Quét cả cây thư mục từ folder gốc (BFS, đệ quy theo hàng đợi)
   * @param {string} rootFolderId - ID của folder gốc
   * @returns {Promise<Array>} Danh sách tất cả ảnh trong cây thư mục
   */
  async listAllImagesRecursive(rootFolderId) {
    const startTime = Date.now();
    const FOLDER_MIME = "application/vnd.google-apps.folder";
    
    try {
      logger.info('drive_list_recursive_started', { 
        rootFolderId, 
        operation: 'list_all_images_recursive' 
      });
      
      const images = [];
      const queue = [rootFolderId];

      while (queue.length) {
        const folderId = queue.shift();
        const imgs = await this.listByQuery(
          `'${folderId}' in parents and trashed=false and (mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`,
          "files(id,name,createdTime,parents,mimeType),nextPageToken"
        );
        images.push(...imgs);
        const subs = await this.listByQuery(
          `'${folderId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`,
          "files(id,name),nextPageToken"
        );
        subs.forEach(f => queue.push(f.id));
      }
      
      const duration = Date.now() - startTime;
      logger.info('drive_list_recursive_success', { 
        rootFolderId, 
        imageCount: images.length,
        duration 
      });
      
      return images;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('drive_list_recursive_error', { 
        rootFolderId, 
        error: error.message,
        duration 
      });
      
      throw new AppError('Failed to list images recursively from Google Drive', 502, 'DRIVE_RECURSIVE_LIST_ERROR', { 
        rootFolderId, 
        originalError: error.message 
      });
    }
  }
}

module.exports = GoogleDriveService;
