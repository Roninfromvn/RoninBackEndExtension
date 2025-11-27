// webhook.js - Google Drive Webhook Handler
const { google } = require("googleapis");
const path = require("path");
const { config } = require("./config");
const SystemStateService = require('./src/services/SystemStateService');

// Google Drive API
let auth;
try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: config.googleDrive.scopes,
    });
  } else if (config.googleDrive.serviceAccountPath) {
    auth = new google.auth.GoogleAuth({
      keyFile: path.join(__dirname, config.googleDrive.serviceAccountPath),
      scopes: config.googleDrive.scopes,
    });
  } else {
    throw new Error('No Google Drive credentials found');
  }
} catch (error) {
  console.error('❌ Failed to initialize Google Drive auth in webhook.js:', error.message);
  auth = null;
}

const drive = google.drive({ version: "v3", auth });

// Webhook secret để verify
const WEBHOOK_SECRET = process.env.GOOGLE_WEBHOOK_SECRET || 'your-webhook-secret';

// Hàm đăng ký webhook với Google Drive
async function registerDriveWebhook(webhookUrl) {
  try {
    console.log('🔄 Đăng ký webhook với Google Drive...');
    
    // Xóa webhook cũ nếu có
    await removeExistingWebhooks();
    
    // Tạo webhook mới
    const response = await drive.files.watch({
      fileId: config.googleDrive.rootFolderId,
      requestBody: {
        id: `drive-webhook-${Date.now()}`,
        type: 'web_hook',
        address: webhookUrl,
        token: WEBHOOK_SECRET,
        expiration: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 ngày (milliseconds)
      }
    });
    
    // Lưu thông tin webhook vào Firestore
    const webhookData = {
      channelId: response.data.id,
      resourceId: response.data.resourceId,
      address: webhookUrl,
      expiresAt: response.data.expiration,
      registeredAt: new Date(),
      status: 'active'
    };
    
    // Lưu thông tin webhook vào PostgreSQL
    await SystemStateService.setDocument('webhook_status', webhookData);
    console.log('✅ [Webhook] Webhook status saved to PostgreSQL');
    
    console.log('✅ Webhook đã được đăng ký:', response.data);
    return response.data;
    
  } catch (error) {
    console.error('❌ Lỗi đăng ký webhook:', error);
    throw error;
  }
}

// Hàm xóa webhook cũ
async function removeExistingWebhooks() {
  try {
    // Đọc webhook status từ PostgreSQL
    const webhookData = await SystemStateService.getDocument('webhook_status');
    console.log('📖 [Webhook] Reading webhook status from PostgreSQL');
    
    if (webhookData && Object.keys(webhookData).length > 0) {
      
      if (webhookData.channelId && webhookData.resourceId) {
        // Dừng webhook cụ thể
        await drive.channels.stop({
          requestBody: {
            id: webhookData.channelId,
            resourceId: webhookData.resourceId
          }
        });
        
        console.log('🗑️ Đã dừng webhook:', webhookData.channelId);
        
        // Cập nhật status trong PostgreSQL
        await SystemStateService.updateDocument('webhook_status', {
          status: 'stopped',
          stoppedAt: new Date()
        });
        console.log('✅ [Webhook] Webhook status updated in PostgreSQL');
      }
    } else {
      // Fallback: thử dừng webhook với pattern cũ
      const response = await drive.channels.stop({
        requestBody: {
          id: 'drive-webhook-*',
          resourceId: config.googleDrive.rootFolderId
        }
      });
      console.log('🗑️ Đã xóa webhook cũ (fallback)');
    }
  } catch (error) {
    // Webhook có thể không tồn tại, bỏ qua lỗi
    console.log('ℹ️ Không có webhook cũ để xóa hoặc lỗi:', error.message);
  }
}

// Hàm xử lý khi có file mới được thêm
async function handleNewFile(fileId) {
  try {
    console.log(`📁 Xử lý file mới: ${fileId}`);
    
    // Lấy thông tin file từ Google Drive
    const fileResponse = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,parents,createdTime,thumbnailLink'
    });
    
    const file = fileResponse.data;
    
    // Kiểm tra xem có phải ảnh không
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType);
    if (!isImage) {
      console.log(`⏭️ Bỏ qua file không phải ảnh: ${file.name}`);
      return;
    }
    
    // Chuẩn bị dữ liệu file
    const fileData = {
      id: file.id,
      name: file.name,
      createdTime: file.createdTime,
      parents: file.parents || [],
      mimeType: file.mimeType,
      thumbnailLink: file.thumbnailLink || null
    };
    
    // Cập nhật ảnh vào PostgreSQL
    await updateImageInPostgreSQL(fileData);
    
    console.log(`✅ Đã cập nhật manifest với file mới: ${file.name}`);
    
  } catch (error) {
    console.error(`❌ Lỗi xử lý file ${fileId}:`, error);
  }
}

// Hàm cập nhật ảnh mới vào PostgreSQL
async function updateImageInPostgreSQL(fileData) {
  try {
    console.log(`💾 Cập nhật ảnh mới vào PostgreSQL: ${fileData.name}`);
    
    const { pool } = require('./src/db');
    const client = await pool.connect();
    
    try {
      // UPSERT ảnh vào bảng images
      await client.query(`
        INSERT INTO images (id, name, created_time, parents, mime_type, thumbnail_link, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          created_time = EXCLUDED.created_time,
          parents = EXCLUDED.parents,
          mime_type = EXCLUDED.mime_type,
          thumbnail_link = EXCLUDED.thumbnail_link,
          last_synced_at = NOW()
      `, [
        fileData.id,
        fileData.name,
        fileData.createdTime,
        JSON.stringify(fileData.parents || []),
        fileData.mimeType,
        fileData.thumbnailLink
      ]);
      
      console.log(`✅ Đã cập nhật ảnh vào PostgreSQL: ${fileData.name}`);
      
      // Cập nhật system state
      await SystemStateService.updateDocument('manifest_state', {
        lastWebhookUpdate: new Date().toISOString(),
        status: 'webhook_updated'
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Lỗi cập nhật ảnh vào PostgreSQL:', error);
    throw error;
  }
}

// Hàm xử lý webhook request
async function handleWebhookRequest(req, res) {
  try {
    // Verify webhook secret
    const token = req.headers['x-goog-channel-token'];
    if (token !== WEBHOOK_SECRET) {
      console.warn('⚠️ Webhook token không hợp lệ');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const resourceId = req.headers['x-goog-resource-id'];
    const resourceUri = req.headers['x-goog-resource-uri'];
    
    console.log('📨 Nhận webhook:', { resourceId, resourceUri });
    
    // Xử lý thay đổi
    if (resourceUri) {
      // Parse resource URI để lấy file ID
      const match = resourceUri.match(/files\/([^?]+)/);
      if (match) {
        const fileId = match[1];
        await handleNewFile(fileId);
      }
    }
    
    res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('❌ Lỗi xử lý webhook:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  registerDriveWebhook,
  handleWebhookRequest,
  removeExistingWebhooks,
  updateImageInPostgreSQL
};
