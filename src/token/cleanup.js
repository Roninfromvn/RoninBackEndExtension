// cleanup.js - Cron job dọn dẹp token cũ
const cron = require('node-cron');
const { getAllPagesWithTokens, cleanupOldTokens } = require('./store');
const { clearCachedToken } = require('./cache');

// Cấu hình cleanup
const CLEANUP_CONFIG = {
  KEEP_TOKENS_PER_PAGE: 5,
  ERROR_TOKEN_DAYS: 14,
  EXPIRED_TOKEN_DAYS: 3,
  NEAR_EXPIRE_HOURS: 24
};

// Cleanup tokens cho một page cụ thể
async function cleanupPageTokens(pageId) {
  try {
    console.log(`[Cleanup] Bắt đầu cleanup cho page ${pageId}`);
    
    const deletedCount = await cleanupOldTokens(pageId, CLEANUP_CONFIG.KEEP_TOKENS_PER_PAGE);
    
    if (deletedCount > 0) {
      console.log(`[Cleanup] Đã xóa ${deletedCount} tokens cũ cho page ${pageId}`);
      
      // Clear cache nếu không còn tokens
      const remainingTokens = await getAllPagesWithTokens();
      if (!remainingTokens.includes(pageId)) {
        await clearCachedToken(pageId);
        console.log(`[Cleanup] Đã clear cache cho page ${pageId} (không còn tokens)`);
      }
    } else {
      console.log(`[Cleanup] Page ${pageId} không cần cleanup`);
    }
    
    return deletedCount;
    
  } catch (error) {
    console.error(`[Cleanup] Lỗi cleanup page ${pageId}:`, error.message);
    return 0;
  }
}

// Cleanup tất cả pages
async function cleanupAllPages() {
  try {
    console.log('[Cleanup] 🧹 Bắt đầu cleanup tất cả pages...');
    
    const pages = await getAllPagesWithTokens();
    console.log(`[Cleanup] Tìm thấy ${pages.length} pages cần cleanup`);
    
    let totalDeleted = 0;
    const results = [];
    
    for (const pageId of pages) {
      try {
        const deletedCount = await cleanupPageTokens(pageId);
        totalDeleted += deletedCount;
        
        results.push({
          pageId,
          deletedCount,
          success: true
        });
        
      } catch (error) {
        console.error(`[Cleanup] Lỗi cleanup page ${pageId}:`, error.message);
        results.push({
          pageId,
          deletedCount: 0,
          success: false,
          error: error.message
        });
      }
    }
    
    console.log(`[Cleanup] ✅ Hoàn thành cleanup: ${totalDeleted} tokens đã được xóa`);
    console.log(`[Cleanup] 📊 Kết quả:`, {
      totalPages: pages.length,
      totalDeleted,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length
    });
    
    return {
      totalPages: pages.length,
      totalDeleted,
      results
    };
    
  } catch (error) {
    console.error('[Cleanup] Lỗi cleanup tất cả pages:', error.message);
    throw error;
  }
}

// Khởi tạo cron job
function initCleanupCron() {
  // Chạy mỗi đêm lúc 2:00 AM
  const cronExpression = '0 2 * * *';
  
  console.log(`[Cleanup] Khởi tạo cron job dọn dẹp: ${cronExpression}`);
  
  cron.schedule(cronExpression, async () => {
    try {
      console.log('[Cleanup] 🕐 Cron job dọn dẹp được kích hoạt');
      
      const startTime = Date.now();
      const result = await cleanupAllPages();
      const duration = Date.now() - startTime;
      
      console.log(`[Cleanup] ⏱️  Cron job hoàn thành trong ${duration}ms`);
      
      // Log kết quả summary
      if (result.totalDeleted > 0) {
        console.log(`[Cleanup] 🎯 Cleanup thành công: ${result.totalDeleted} tokens đã được xóa`);
      } else {
        console.log('[Cleanup] 🎯 Không có tokens nào cần cleanup');
      }
      
    } catch (error) {
      console.error('[Cleanup] ❌ Cron job cleanup thất bại:', error.message);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });
  
  console.log('[Cleanup] Cron job dọn dẹp đã được khởi tạo');
}

// Manual cleanup function (có thể gọi từ API)
async function manualCleanup() {
  try {
    console.log('[Cleanup] 🚀 Manual cleanup được kích hoạt');
    
    const startTime = Date.now();
    const result = await cleanupAllPages();
    const duration = Date.now() - startTime;
    
    console.log(`[Cleanup] ⏱️  Manual cleanup hoàn thành trong ${duration}ms`);
    
    return {
      success: true,
      duration,
      ...result
    };
    
  } catch (error) {
    console.error('[Cleanup] ❌ Manual cleanup thất bại:', error.message);
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Health check cho cleanup system
async function getCleanupHealth() {
  try {
    const pages = await getAllPagesWithTokens();
    
    return {
      status: 'healthy',
      lastRun: new Date().toISOString(),
      totalPages: pages.length,
      config: CLEANUP_CONFIG
    };
    
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      lastRun: null
    };
  }
}

// Export functions
module.exports = {
  initCleanupCron,
  cleanupAllPages,
  cleanupPageTokens,
  manualCleanup,
  getCleanupHealth,
  CLEANUP_CONFIG
};
