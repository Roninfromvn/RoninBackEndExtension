const { google } = require("googleapis");
const path = require("path");

// Import config để đồng bộ với index.js
const { config } = require("./config");

/*
 * ======================================================================================
 * MANIFEST WORKER - Đồng bộ hoàn chỉnh (Folders + Images)
 * 
 * Vai trò mới:
 * - Đồng bộ folder structure vào PostgreSQL
 * - Đồng bộ ảnh vào PostgreSQL
 * - Tất cả trong 1 bước duy nhất
 * ======================================================================================
 */

// Cấu hình từ config (đồng bộ với index.js)
const ROOT_FOLDER_ID = config.googleDrive.rootFolderId;
const CHUNK_SIZE = 500; // Giảm chunk size để tránh timeout
const MAX_DOCUMENT_SIZE = 900 * 1024; // 900KB để an toàn
const BATCH_LIMIT = 250; // Giảm batch limit để tránh timeout

// PostgreSQL System State Service
const SystemStateService = require('./src/services/SystemStateService');

// Google Drive API (đồng bộ với index.js)
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
    const serviceAccountPath = path.resolve(config.googleDrive.serviceAccountPath);
    auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: config.googleDrive.scopes,
    });
  } else {
    throw new Error('No Google Drive credentials found');
  }
} catch (error) {
  console.error('❌ Worker: Failed to initialize Google Drive auth:', error);
  process.exit(1);
}

const drive = google.drive({ version: "v3", auth });

// =========================
// QUÉT DRIVE VÀ ĐỒNG BỘ HOÀN CHỈNH
// =========================

// Liệt kê file theo query (có phân trang)
async function listByQuery(q, fields = "files(id,name,mimeType,parents,createdTime,thumbnailLink),nextPageToken", pageSize = 1000) {
  let out = [];
  let pageToken = null;
  do {
    const resp = await drive.files.list({
      q,
      fields,
      pageSize,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    out = out.concat(resp.data.files || []);
    pageToken = resp.data.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Lấy thời gian cập nhật cuối cùng từ system state (PostgreSQL)
async function getLastUpdateTime() {
  try {
    console.log('🔍 [Worker] Getting last update time from PostgreSQL...');
    const data = await SystemStateService.getDocument('manifest_state');
    
    if (data && data.lastProcessed) {
      const lastProcessed = new Date(data.lastProcessed);
      console.log(`📅 [Worker] Last processed time: ${lastProcessed.toISOString()}`);
      return lastProcessed;
    }
    
    console.log('📅 [Worker] No previous processing time found, starting from beginning');
    return new Date(0); // Lần đầu chạy
  } catch (error) {
    console.error('❌ [Worker] Error getting last update time from PostgreSQL:', error);
    // Fallback to Firestore for compatibility
    try {
      console.log('🔄 [Worker] Falling back to Firestore...');
      const doc = await SYS_STATE_COL.doc('manifest_state').get();
      if (doc.exists) {
        const data = doc.data();
        if (data.lastProcessed) {
          return data.lastProcessed.toDate ? data.lastProcessed.toDate() : new Date(data.lastProcessed);
        }
      }
    } catch (firestoreError) {
      console.error('❌ [Worker] Firestore fallback also failed:', firestoreError);
    }
    console.log('⚠️ Using default time (epoch)');
    return new Date(0);
  }
}

// Quét toàn bộ Drive và phân loại (folders + images)
async function scanDriveComplete(lastUpdateTime, forceFullScan = false) {
  console.log('🔄 Bắt đầu quét toàn bộ Drive...');
  if (forceFullScan) {
    console.log('🔄 Chế độ quét toàn bộ (bỏ qua thời gian)');
  } else {
    console.log('🔄 Chế độ quét ảnh mới từ:', lastUpdateTime.toISOString());
  }
  
  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const allFolders = [];
  const allImages = [];
  const queue = [ROOT_FOLDER_ID];

  while (queue.length) {
    const folderId = queue.shift();

    // 1) Ảnh trong folder hiện tại (mới hoặc tất cả tùy theo mode)
    let imageQuery = `'${folderId}' in parents and trashed=false and (` +
      `mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/webp')`;
    
    if (!forceFullScan) {
      imageQuery += ` and createdTime > '${lastUpdateTime.toISOString()}'`;
    }
    
    const imgs = await listByQuery(
      imageQuery,
      "files(id,name,createdTime,parents,mimeType,thumbnailLink),nextPageToken"
    );
    allImages.push(...imgs);

    // 2) Tất cả folders (không phân biệt mới/cũ)
    const folders = await listByQuery(
      `'${folderId}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`,
      "files(id,name,createdTime,parents),nextPageToken"
    );
    
    // Thêm vào danh sách folders
    allFolders.push(...folders);
    
    // Thêm vào queue để duyệt tiếp
    folders.forEach(f => queue.push(f.id));
  }

  console.log(`✅ Quét hoàn thành:`);
  console.log(`   - 📁 Folders: ${allFolders.length}`);
  if (forceFullScan) {
    console.log(`   - 🖼️ Tổng ảnh: ${allImages.length}`);
  } else {
    console.log(`   - 🖼️ Ảnh mới: ${allImages.length}`);
  }
  
  return { allFolders, allImages };
}

// =========================
// ĐỒNG BỘ FOLDERS
// =========================


// Lưu folders vào PostgreSQL (new)
async function syncFoldersToPostgreSQL(folders, syncTimestamp = new Date()) {
  console.log('💾 Bắt đầu đồng bộ folders vào PostgreSQL...');
  
  const syncedIds = new Set();

  if (folders.length === 0) {
    console.log('✅ Không có folders cần đồng bộ vào PostgreSQL');
  }

  try {
    // Use EasyMigrationService for PostgreSQL sync
    const EasyMigrationService = require('./src/services/EasyMigrationService');
    const migrationService = new EasyMigrationService();
    
    // Create a custom sync method that doesn't truncate (for incremental updates)
    const { pool } = require('./src/db');
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Insert root folder first if needed
      const rootFolderId = config.googleDrive.rootFolderId;
      if (rootFolderId) {
        const rootQuery = `
          INSERT INTO folders (id, name, parent_id, created_time, synced_at, level)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            synced_at = EXCLUDED.synced_at
        `;
        
        await client.query(rootQuery, [
          rootFolderId,
          'Root Folder',
          null,
          new Date(),
          syncTimestamp,
          0
        ]);

        syncedIds.add(rootFolderId);
      }
      
      let syncedCount = 0;
      
      // Sync all folders with upsert
      for (const folder of folders) {
        const query = `
          INSERT INTO folders (id, name, parent_id, created_time, synced_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            parent_id = EXCLUDED.parent_id,
            synced_at = EXCLUDED.synced_at,
            updated_at = EXCLUDED.updated_at
        `;
        
        const values = [
          folder.id,
          folder.name,
          folder.parents?.[0] || null,
          folder.createdTime ? new Date(folder.createdTime) : null,
          syncTimestamp,
          syncTimestamp
        ];
        
        await client.query(query, values);
        syncedCount++;
        syncedIds.add(folder.id);
      }
      
      await client.query('COMMIT');
      console.log(`✅ Hoàn thành đồng bộ ${syncedCount} folders vào PostgreSQL`);
      
      return { syncedCount, syncedIds: Array.from(syncedIds) };
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Lỗi đồng bộ PostgreSQL:', error);
    throw error;
  }
}

// =========================
// ĐỒNG BỘ ẢNH VÀO POSTGRESQL
// =========================

// Đồng bộ ảnh vào bảng images PostgreSQL
async function syncImagesToPostgreSQL(images, syncTimestamp = new Date()) {
  console.log(`💾 Bắt đầu đồng bộ ${images.length} ảnh vào PostgreSQL...`);
  
  if (images.length === 0) {
    console.log('📝 Không có ảnh nào cần đồng bộ');
    return { successCount: 0, errorCount: 0, syncedIds: [] };
  }
  
  const { pool } = require('./src/db');
  const client = await pool.connect();
  
  try {
    let successCount = 0;
    let errorCount = 0;
    const syncedIds = [];
    
    for (const image of images) {
      try {
        await client.query(`
          INSERT INTO images (id, name, created_time, parents, mime_type, thumbnail_link, last_synced_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            created_time = EXCLUDED.created_time,
            parents = EXCLUDED.parents,
            mime_type = EXCLUDED.mime_type,
            thumbnail_link = EXCLUDED.thumbnail_link,
            last_synced_at = $7
        `, [
          image.id,
          image.name,
          image.createdTime,
          JSON.stringify(image.parents || []),
          image.mimeType,
          image.thumbnailLink,
          syncTimestamp
        ]);
        
        successCount++;
        syncedIds.push(image.id);
        
        // Log progress every 1000 images
        if (successCount % 1000 === 0) {
          console.log(`📊 Đã đồng bộ ${successCount}/${images.length} ảnh...`);
        }
        
      } catch (imageError) {
        errorCount++;
        console.error(`❌ Lỗi đồng bộ ảnh ${image.id}:`, imageError.message);
      }
    }
    
    console.log(`✅ Hoàn thành đồng bộ ảnh vào PostgreSQL:`);
    console.log(`   - ✅ Thành công: ${successCount} ảnh`);
    console.log(`   - ❌ Lỗi: ${errorCount} ảnh`);
    
    return { successCount, errorCount, syncedIds };
    
  } catch (error) {
    console.error('❌ Lỗi trong quá trình đồng bộ ảnh:', error);
    throw error;
  } finally {
    client.release();
  }
}

// =========================
// CẬP NHẬT MANIFEST VỚI ẢNH MỚI
// =========================



// =========================
// CẬP NHẬT SYSTEM STATE
// =========================

async function updateSystemState(totalImages, newImagesCount = 0, totalFolders = 0) {
  console.log('📊 [Worker] Updating system state to PostgreSQL...');
  
  try {
    // Update PostgreSQL only
    await SystemStateService.updateDocument('manifest_state', {
      totalImages,
      totalFolders,
      newImagesAdded: newImagesCount,
      lastProcessed: new Date().toISOString(),
      status: 'processed',
      version: '1.0'
    });
    
    console.log(`✅ [Worker] PostgreSQL system state updated: ${totalImages} images, ${totalFolders} folders (${newImagesCount} new images)`);
    
  } catch (error) {
    console.error('❌ [Worker] Error updating system state to PostgreSQL:', error);
    throw error;
  }
}

// =========================
// HÀM CHÍNH - ĐỒNG BỘ HOÀN CHỈNH
// =========================

async function processCompleteSync(forceFullScan = false) {
  try {
    // Optional hard reset: clear images table before syncing
    const resetImages = process.argv.includes('--reset-images');
    if (resetImages) {
      console.log('⚠️  Reset mode enabled: clearing images table before full sync...');
      await resetImagesTable();
    }
    if (forceFullScan) {
      console.log('🚀 Bắt đầu đồng bộ HOÀN TOÀN (Quét lại toàn bộ)...');
    } else {
      console.log('🚀 Bắt đầu đồng bộ hoàn chỉnh (Folders + Images)...');
    }
    console.log('📅 Thời gian bắt đầu:', new Date().toISOString());
    console.log('📁 Root Folder ID:', ROOT_FOLDER_ID);

    // BƯỚC 1: Lấy thời gian cập nhật cuối
    console.log('\n=== BƯỚC 1: LẤY THỜI GIAN CẬP NHẬT CUỐI ===');
    const lastUpdateTime = forceFullScan ? new Date(0) : await getLastUpdateTime();
    if (forceFullScan) {
      console.log('📅 Chế độ quét toàn bộ: Bỏ qua thời gian cập nhật');
    } else {
      console.log('📅 Thời gian cập nhật cuối:', lastUpdateTime.toISOString());
    }

    // BƯỚC 2: Quét toàn bộ Drive (folders + images)
    console.log('\n=== BƯỚC 2: QUÉT TOÀN BỘ DRIVE ===');
    const { allFolders, allImages } = await scanDriveComplete(lastUpdateTime, forceFullScan);

    // BƯỚC 3: Đồng bộ folders vào PostgreSQL
    console.log('\n=== BƯỚC 3: ĐỒNG BỘ FOLDERS ===');
    
    // Sync to PostgreSQL only
    const folderSyncTimestamp = new Date();
    const folderSyncResult = await syncFoldersToPostgreSQL(allFolders, folderSyncTimestamp);

    if (forceFullScan) {
      const folderIds = folderSyncResult?.syncedIds || [];
      await cleanupMissingFolders(folderIds);
    }

    // BƯỚC 4: Đồng bộ ảnh vào PostgreSQL
    if (forceFullScan || allImages.length > 0) {
      console.log('\n=== BƯỚC 4: ĐỒNG BỘ ẢNH VÀO POSTGRESQL ===');
      
      if (forceFullScan) {
        // Chế độ quét toàn bộ: Đồng bộ tất cả ảnh
        console.log(`📊 Quét toàn bộ: Đồng bộ ${allImages.length} ảnh vào PostgreSQL`);
        const imageSyncTimestamp = new Date();
        const imageSyncResult = await syncImagesToPostgreSQL(allImages, imageSyncTimestamp);

        if (forceFullScan) {
          if (imageSyncResult.errorCount > 0) {
            console.warn('⚠️  Bỏ qua bước dọn ảnh vì có lỗi khi đồng bộ, tránh xoá nhầm dữ liệu.');
          } else {
            await cleanupMissingImages(imageSyncResult.syncedIds || []);
          }
        }
      } else {
        // Chế độ quét ảnh mới: Chỉ đồng bộ ảnh mới
        console.log(`📊 Đồng bộ ${allImages.length} ảnh mới vào PostgreSQL`);
        await syncImagesToPostgreSQL(allImages);
      }
    } else {
      console.log('\n=== BƯỚC 4: KHÔNG CÓ ẢNH MỚI ===');
      console.log('✅ Không có ảnh mới nào cần cập nhật');
    }

    // BƯỚC 5: Cập nhật system state
    console.log('\n=== BƯỚC 5: CẬP NHẬT SYSTEM STATE ===');
    if (forceFullScan) {
      await updateSystemState(allImages.length, allImages.length, allFolders.length);
    } else {
      // Lấy tổng số ảnh từ PostgreSQL thay vì Firestore
      const { pool } = require('./src/db');
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as total FROM images');
        const totalImages = parseInt(result.rows[0].total);
        await updateSystemState(totalImages, allImages.length, allFolders.length);
      } finally {
        client.release();
      }
    }

    // BƯỚC 6: Cập nhật folder image counts từ PostgreSQL
    console.log('\n=== BƯỚC 6: CẬP NHẬT FOLDER IMAGE COUNTS ===');
    await updateFolderImageCountsFromPostgreSQL();

    console.log('\n🎉 HOÀN THÀNH ĐỒNG BỘ HOÀN CHỈNH!');
    console.log(`📊 Tổng kết:`);
    console.log(`   - 📁 Folders: ${allFolders.length}`);
    if (forceFullScan) {
      console.log(`   - 🖼️ Tổng ảnh: ${allImages.length}`);
      console.log(`   - 🔄 Chế độ: Quét toàn bộ`);
    } else {
      // Lấy tổng số ảnh từ PostgreSQL
      const { pool } = require('./src/db');
      const client = await pool.connect();
      try {
        const result = await client.query('SELECT COUNT(*) as total FROM images');
        const totalImages = parseInt(result.rows[0].total);
        console.log(`   - 🖼️ Ảnh mới: ${allImages.length}`);
        console.log(`   - 🖼️ Tổng ảnh: ${totalImages}`);
        console.log(`   - 🔄 Chế độ: Quét ảnh mới`);
      } finally {
        client.release();
      }
    }
    console.log(`   - ⏰ Thời gian hoàn thành: ${new Date().toISOString()}`);

  } catch (error) {
    console.error('❌ Lỗi trong quá trình đồng bộ hoàn chỉnh:', error);
    throw error;
  }
}

// =========================
// MAIN FUNCTION
// =========================

async function main() {
  try {
    // Kiểm tra argument để quyết định chế độ quét
    const forceFullScan = process.argv.includes('--full-scan') || process.argv.includes('--reset');
    
    if (forceFullScan) {
      console.log('🚀 Manifest Worker - Chế độ QUÉT TOÀN BỘ (Reset hoàn toàn)');
    } else {
      console.log('🚀 Manifest Worker - Đồng bộ hoàn chỉnh (Folders + Images)');
    }
    console.log('📁 Root Folder ID:', ROOT_FOLDER_ID);
    console.log('🔧 Chunk Size:', CHUNK_SIZE);
    console.log('📏 Max Document Size:', (MAX_DOCUMENT_SIZE / 1024).toFixed(2), 'KB');
    if (forceFullScan) {
      console.log('🔄 Chế độ: Quét toàn bộ (bỏ qua manifest cũ)');
    }
    console.log('');

    await processCompleteSync(forceFullScan);
    
    console.log('\n✅ Worker hoàn thành thành công!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Worker thất bại:', error);
    process.exit(1);
  }
}

// Chạy worker nếu được gọi trực tiếp
if (require.main === module) {
  main();
}


// Cập nhật folder image counts từ bảng images PostgreSQL
async function updateFolderImageCountsFromPostgreSQL() {
  console.log('📊 [Worker] Updating folder image counts from PostgreSQL...');
  
  try {
    const { pool } = require('./src/db');
    const client = await pool.connect();
    
    try {
      // Đếm ảnh theo folder từ bảng images
      const result = await client.query(`
        SELECT 
          jsonb_array_elements_text(parents) as folder_id,
          COUNT(DISTINCT id) as image_count
        FROM images 
        WHERE parents IS NOT NULL AND parents != '[]'::jsonb
        GROUP BY jsonb_array_elements_text(parents)
      `);
      
      console.log(`📊 Found ${result.rows.length} folders with images`);
      
      let updatedCount = 0;
      
      // Cập nhật image_count cho từng folder
      for (const row of result.rows) {
        const folderId = row.folder_id;
        const imageCount = parseInt(row.image_count);
        
        const updateResult = await client.query(`
          UPDATE folders 
          SET image_count = $1, updated_at = NOW()
          WHERE id = $2
        `, [imageCount, folderId]);
        
        if (updateResult.rowCount > 0) {
          updatedCount++;
          console.log(`  📁 ${folderId}: ${imageCount} images`);
        }
      }
      
      // Reset count cho folders không có ảnh
      const resetResult = await client.query(`
        UPDATE folders 
        SET image_count = 0, updated_at = NOW()
        WHERE id NOT IN (
          SELECT DISTINCT jsonb_array_elements_text(parents) 
          FROM images 
          WHERE parents IS NOT NULL AND parents != '[]'::jsonb
        )
        AND image_count > 0
      `);
      
      console.log(`✅ Updated ${updatedCount} folders with image counts`);
      console.log(`🔄 Reset ${resetResult.rowCount} folders to 0 images`);
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Error updating folder image counts:', error);
    // Don't throw - this is not critical
  }
}

// Export functions để test/module usage
module.exports = {
  processCompleteSync,
  syncImagesToPostgreSQL,
  updateSystemState,
  scanDriveComplete,
  syncFoldersToPostgreSQL,
  updateFolderImageCountsFromPostgreSQL,
  listByQuery,
  cleanupMissingFolders,
  cleanupMissingImages
};

// Helper: hard reset images table (use with --reset-images)
async function resetImagesTable() {
  try {
    const { pool } = require('./src/db');
    const client = await pool.connect();
    try {
      console.log('🧹 Deleting all rows from images...');
      await client.query('DELETE FROM images');
      console.log('✅ Images table cleared');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error clearing images table:', error);
    throw error;
  }
}

// Helper: hard reset folders table (use with full scan)
async function resetFoldersTable() {
  try {
    const { pool } = require('./src/db');
    const client = await pool.connect();
    try {
      console.log('🧹 Deleting all rows from folders...');
      await client.query('TRUNCATE TABLE folders CASCADE');
      console.log('✅ Folders table cleared');
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error clearing folders table:', error);
    throw error;
  }
}

async function cleanupMissingFolders(validFolderIds = []) {
  console.log('🧹 [Worker] Cleaning up folders missing from Drive snapshot...');

  try {
    const { pool } = require('./src/db');
    const client = await pool.connect();

    try {
      const ids = Array.from(new Set(validFolderIds.filter(Boolean)));
      let result;

      if (ids.length === 0) {
        result = await client.query('DELETE FROM folders');
      } else {
        result = await client.query(`
          DELETE FROM folders
          WHERE NOT (id = ANY($1::text[]))
        `, [ids]);
      }

      if (result.rowCount > 0) {
        console.log(`✅ Removed ${result.rowCount} folders that are no longer in Drive`);
      } else {
        console.log('✅ No folders removed during cleanup');
      }

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error cleaning up folders:', error);
    throw error;
  }
}

async function cleanupMissingImages(validImageIds = []) {
  console.log('🧹 [Worker] Cleaning up images missing from Drive snapshot...');

  try {
    const { pool } = require('./src/db');
    const client = await pool.connect();

    try {
      const ids = Array.from(new Set(validImageIds.filter(Boolean)));
      let result;

      if (ids.length === 0) {
        result = await client.query('DELETE FROM images');
      } else {
        result = await client.query(`
          DELETE FROM images
          WHERE NOT (id = ANY($1::text[]))
        `, [ids]);
      }

      if (result.rowCount > 0) {
        console.log(`✅ Removed ${result.rowCount} images that are no longer in Drive`);
      } else {
        console.log('✅ No images removed during cleanup');
      }

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Error cleaning up images:', error);
    throw error;
  }
}
