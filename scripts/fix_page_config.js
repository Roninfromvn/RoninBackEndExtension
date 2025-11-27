#!/usr/bin/env node
/**
 * Script để sửa page config với folder ID đúng
 */

require('dotenv').config();

async function fixPageConfig() {
    console.log('🔧 Fixing page config...\n');
    
    try {
        const PageConfigsService = require('../src/services/PageConfigsService');
        
        const pageId = '543011772233078';
        const correctFolderId = '1DNb7zF1PFcNC4YzFjyBH78Ah1fTTrHDt'; // Folder ID từ manifest
        
        console.log(`📱 Page ID: ${pageId}`);
        console.log(`📁 Correct Folder ID: ${correctFolderId}`);
        
        // Lấy config hiện tại
        let pageConfig = await PageConfigsService.getConfig(pageId);
        
        if (!pageConfig) {
            console.log('❌ Page config not found, creating new one...');
            pageConfig = {
                enabled: true,
                folderIds: [correctFolderId],
                schedule: ['08:00', '12:00', '18:00'],
                postsPerSlot: 1
            };
        } else {
            console.log('📝 Current config:', JSON.stringify(pageConfig, null, 2));
            
            // Cập nhật folder ID
            pageConfig.folderIds = [correctFolderId];
            console.log('✅ Updated folderIds to:', pageConfig.folderIds);
        }
        
        // Lưu config
        await PageConfigsService.setConfig(pageId, pageConfig);
        console.log('✅ Page config updated successfully!');
        
        // Kiểm tra lại
        const updatedConfig = await PageConfigsService.getConfig(pageId);
        console.log('\n📋 Updated config:');
        console.log(JSON.stringify(updatedConfig, null, 2));
        
    } catch (error) {
        console.error('❌ Error fixing page config:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run fix
fixPageConfig();
