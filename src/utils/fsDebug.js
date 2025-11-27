// src/utils/fsDebug.js - Firestore debug logger
function on() { 
  return process.env.FS_DEBUG === '1'; 
}

function t(label) { 
  if (on()) console.time(label); 
}

function tend(label, meta = {}) { 
  if (!on()) return; 
  console.timeEnd(label); 
  console.log('[FS]', JSON.stringify(meta)); 
}

module.exports = { t, tend, on };
