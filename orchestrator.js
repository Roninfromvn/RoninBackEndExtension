// orchestrator.js - Khởi chạy và quản lý các worker bằng pm2
const pm2 = require('pm2');
const { config } = require('./config');
const metrics = require('./src/metrics/metrics');

const WORKER_SCRIPT = 'posting_worker.js';
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 10);
const INSTANCES = WORKER_CONCURRENCY; // Lấy số luồng từ ENV, mặc định là 10
const WORKER_NAME = 'posting-workers';

pm2.connect((err) => {
    if (err) {
        console.error(err);
        process.exit(2);
    }

    console.log(`[Orchestrator] Đang khởi chạy ${INSTANCES} luồng cho ${WORKER_SCRIPT}...`);
    
    // Cập nhật metrics
    metrics.set('workers.configured', WORKER_CONCURRENCY);
    metrics.startReporter();

    pm2.start({
        script: WORKER_SCRIPT,
        name: WORKER_NAME,
        instances: INSTANCES,
        exec_mode: 'fork', // Mỗi worker là một tiến trình riêng biệt
        max_memory_restart: '300M', // Tự khởi động lại nếu dùng quá 300MB RAM
        autorestart: true,
        watch: false // Không tự restart khi code thay đổi, chỉ restart khi lỗi
    }, (err, apps) => {
        if (err) {
            console.error('[Orchestrator] ❌ Lỗi khi khởi chạy workers:', err);
        } else {
            console.log(`[Orchestrator] ✅ Đã khởi chạy thành công ${apps.length} workers.`);
            console.log(`[Orchestrator] Dùng lệnh "npm run workers:logs" để xem log.`);
            console.log(`[Orchestrator] Dùng lệnh "npm run workers:stop" để dừng.`);
            
            // Cập nhật số worker đang chạy
            metrics.set('workers.alive', apps.length);
        }
        // Ngắt kết nối khỏi daemon pm2 để script có thể kết thúc
        pm2.disconnect();
    });
});
