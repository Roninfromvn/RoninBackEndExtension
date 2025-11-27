
require('dotenv').config();

async function checkPageConfig() {
    console.log('🔍 Checking page config...\n');
    
    try {
        const PageConfigsService = require('../src/services/PageConfigsService');
        
        const pageId = '543011772233078';
        
        console.log(`📱 Checking page ID: ${pageId}`);
        
        // Lấy config hiện tại
        const pageConfig = await PageConfigsService.getConfig(pageId);
        
        if (!pageConfig) {
            console.log('❌ Page config not found');
        } else {
            console.log('✅ Page config found:');
            console.log(JSON.stringify(pageConfig, null, 2));
        }
        
        // Lấy tất cả configs
        console.log('\n📋 All page configs:');
        const allConfigs = await PageConfigsService.getAllConfigs();
        allConfigs.forEach(config => {
            console.log(`- ${config.pageId}: ${config.enabled ? 'enabled' : 'disabled'}, folders: ${config.folderIds?.length || 0}`);
        });
        
    } catch (error) {
        console.error('❌ Error checking page config:', error.message);
        console.error('Stack trace:', error.stack);
    }
}

// Run check
checkPageConfig();
