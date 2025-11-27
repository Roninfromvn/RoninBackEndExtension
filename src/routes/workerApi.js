// workerApi.js - API endpoints for worker control from dashboard
const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

// POST /api/worker/sync - Trigger sync with different modes
router.post('/sync', async (req, res) => {
    try {
        const { mode = 'incremental' } = req.body;
        
        console.log(`🚀 Dashboard triggered sync mode: ${mode}`);
        
        // Validate mode
        const validModes = ['incremental', 'full-scan'];
        if (!validModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid sync mode. Must be "incremental" or "full-scan"'
            });
        }

        // Construct worker command
        const workerPath = path.join(__dirname, '../../worker.js');
        const args = mode === 'full-scan' ? ['--full-scan'] : [];
        
        // Response data
        const response = {
            success: true,
            mode: mode,
            startTime: new Date().toISOString(),
            message: mode === 'full-scan' 
                ? 'Full rebuild started - this will take 30-60 minutes' 
                : 'Quick sync started - this will take 2-5 minutes'
        };

        // For quick response, we'll start the process but not wait for completion
        if (mode === 'incremental') {
            // Quick sync - can wait for result (usually fast)
            const result = await runWorkerSync(workerPath, args);
            response.completed = true;
            response.endTime = new Date().toISOString();
            response.newImages = result.newImages || 0;
            response.message = `Quick sync completed - ${result.newImages || 0} new images found`;
        } else {
            // Full scan - start in background, don't wait
            startWorkerBackground(workerPath, args);
            response.completed = false;
            response.message = 'Full rebuild started in background';
        }

        res.json(response);

    } catch (error) {
        console.error('❌ Sync API error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/queue/status - Get queue status (alias for /api/worker/status)
router.get('/queue/status', async (req, res) => {
    try {
        // Check if worker is currently running
        // This is a simplified check - in production you might use a more sophisticated status tracking
        const fs = require('fs').promises;
        const systemStatePath = path.join(__dirname, '../../data/system_state.json');
        
        let lastSync = null;
        try {
            const systemState = JSON.parse(await fs.readFile(systemStatePath, 'utf8'));
            lastSync = {
                lastUpdate: systemState.lastUpdate,
                totalFolders: systemState.totalFolders,
                totalImages: systemState.totalImages
            };
        } catch (err) {
            console.log('No system state found');
        }

        res.json({
            success: true,
            queue: {
                isRunning: false, // Simplified - you could track this more precisely
                lastSync: lastSync,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Queue status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// GET /api/worker/status - Get current worker status
router.get('/status', async (req, res) => {
    try {
        // Check if worker is currently running
        // This is a simplified check - in production you might use a more sophisticated status tracking
        const fs = require('fs').promises;
        const systemStatePath = path.join(__dirname, '../../data/system_state.json');
        
        let lastSync = null;
        try {
            const systemState = JSON.parse(await fs.readFile(systemStatePath, 'utf8'));
            lastSync = {
                lastUpdate: systemState.lastUpdate,
                totalFolders: systemState.totalFolders,
                totalImages: systemState.totalImages
            };
        } catch (err) {
            console.log('No system state found');
        }

        res.json({
            success: true,
            isRunning: false, // Simplified - you could track this more precisely
            lastSync: lastSync,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Worker status error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function to run worker and wait for result (for quick sync)
function runWorkerSync(workerPath, args) {
    return new Promise((resolve, reject) => {
        console.log(`📝 Running worker: node ${workerPath} ${args.join(' ')}`);
        
        const worker = spawn('node', [workerPath, ...args], {
            cwd: path.dirname(workerPath),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let output = '';
        let errorOutput = '';

        worker.stdout.on('data', (data) => {
            output += data.toString();
            console.log(`Worker: ${data.toString().trim()}`);
        });

        worker.stderr.on('data', (data) => {
            errorOutput += data.toString();
            console.error(`Worker Error: ${data.toString().trim()}`);
        });

        worker.on('close', (code) => {
            if (code === 0) {
                // Parse output to extract useful info
                const result = {
                    exitCode: code,
                    output: output,
                    newImages: extractNewImagesCount(output)
                };
                resolve(result);
            } else {
                reject(new Error(`Worker exited with code ${code}: ${errorOutput}`));
            }
        });

        worker.on('error', (error) => {
            reject(new Error(`Failed to start worker: ${error.message}`));
        });

        // Timeout for quick sync (10 minutes max)
        setTimeout(() => {
            worker.kill();
            reject(new Error('Worker timeout - sync took too long'));
        }, 10 * 60 * 1000);
    });
}

// Helper function to start worker in background (for full scan)
function startWorkerBackground(workerPath, args) {
    console.log(`🔄 Starting background worker: node ${workerPath} ${args.join(' ')}`);
    
    const worker = spawn('node', [workerPath, ...args], {
        cwd: path.dirname(workerPath),
        stdio: 'ignore', // Don't capture output for background process
        detached: true   // Allow process to continue after parent exits
    });

    worker.unref(); // Don't keep the parent process alive

    worker.on('error', (error) => {
        console.error(`❌ Background worker error: ${error.message}`);
    });

    console.log(`✅ Background worker started with PID: ${worker.pid}`);
}

// Helper function to extract new images count from worker output
function extractNewImagesCount(output) {
    try {
        // Look for patterns like "X ảnh mới" or "newImages: X"
        const patterns = [
            /(\d+)\s+ảnh mới/i,
            /(\d+)\s+new images/i,
            /newImages:\s*(\d+)/i,
            /found\s+(\d+)\s+new/i
        ];

        for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
                return parseInt(match[1], 10);
            }
        }

        return 0;
    } catch (error) {
        console.error('Error extracting new images count:', error);
        return 0;
    }
}

module.exports = router;
