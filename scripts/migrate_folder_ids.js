// Script để migrate folder_ids từ folder names sang Google Drive IDs
const { pool } = require('../src/db');

async function migrateFolderIds() {
  console.log('🔄 Starting folder IDs migration...');
  
  try {
    const client = await pool.connect();
    
    try {
      // 1. Lấy tất cả page configs có folder_ids
      const result = await client.query(`
        SELECT page_id, folder_ids 
        FROM page_configs 
        WHERE folder_ids IS NOT NULL 
        AND jsonb_array_length(folder_ids) > 0
      `);
      
      console.log(`📋 Found ${result.rows.length} pages with folder_ids`);
      
      // 2. Lấy mapping folder name → Google Drive ID
      const foldersResult = await client.query(`
        SELECT id, name 
        FROM folders 
        WHERE is_active = true
      `);
      
      const nameToIdMap = {};
      foldersResult.rows.forEach(folder => {
        nameToIdMap[folder.name] = folder.id;
      });
      
      console.log(`📁 Found ${Object.keys(nameToIdMap).length} folders mapping`);
      
      // 3. Migrate từng page
      let migratedCount = 0;
      
      for (const row of result.rows) {
        const { page_id, folder_ids } = row;
        const newFolderIds = [];
        let needsUpdate = false;
        
        for (const folderId of folder_ids) {
          if (nameToIdMap[folderId]) {
            // Đây là folder name, convert sang Google Drive ID
            newFolderIds.push(nameToIdMap[folderId]);
            needsUpdate = true;
            console.log(`  📝 ${page_id}: "${folderId}" → "${nameToIdMap[folderId]}"`);
          } else {
            // Đã là Google Drive ID rồi, giữ nguyên
            newFolderIds.push(folderId);
          }
        }
        
        if (needsUpdate) {
          await client.query(`
            UPDATE page_configs 
            SET folder_ids = $1, updated_at = NOW()
            WHERE page_id = $2
          `, [JSON.stringify(newFolderIds), page_id]);
          
          migratedCount++;
          console.log(`✅ Updated page ${page_id}`);
        }
      }
      
      console.log(`🎉 Migration completed! Updated ${migratedCount} pages`);
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Chạy migration
if (require.main === module) {
  migrateFolderIds()
    .then(() => {
      console.log('✅ Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateFolderIds };
