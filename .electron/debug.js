console.log('=== ELECTRON DEBUG ===');
console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);

try {
  const e = require('electron');
  console.log('require(electron) type:', typeof e);
  if (typeof e === 'object') {
    console.log('require(electron) keys:', Object.keys(e));
  } else {
    console.log('require(electron) value:', e);
  }
} catch(err) {
  console.log('require(electron) error:', err.message);
}

process.exit(0);
