#!/usr/bin/env node
/**
 * Reset system state - Clear nextJobTime and other scheduler state
 * This script resets the system state to allow fresh scheduling
 */

require('dotenv').config();
const SystemStateService = require('../src/services/SystemStateService');

async function resetSystemState() {
  console.log('🔄 Resetting system state...');
  
  try {
    const systemStateService = require('../src/services/SystemStateService');
    
    // Get current state
    console.log('📊 Getting current system state...');
    const currentState = await systemStateService.getDocument('scheduler_state');
    console.log('Current state:', currentState);
    
    // Reset nextJobTime
    console.log('\n🕐 Resetting nextJobTime...');
    await systemStateService.setDocument('scheduler_state', {
      nextJobTime: null,
      lastSchedulerRun: null,
      schedulerStatus: 'idle',
      resetAt: new Date().toISOString()
    });
    
    console.log('✅ System state reset successfully');
    console.log('   - nextJobTime: cleared');
    console.log('   - lastSchedulerRun: cleared');
    console.log('   - schedulerStatus: idle');
    
  } catch (error) {
    console.error('❌ Failed to reset system state:', error);
    throw error;
  }
}

// Run reset
if (require.main === module) {
  resetSystemState()
    .then(() => {
      console.log('🎉 System state reset completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('💥 System state reset failed:', error);
      process.exit(1);
    });
}

module.exports = { resetSystemState };
