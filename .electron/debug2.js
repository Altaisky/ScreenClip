// Clear the npm electron package from cache before it gets required
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function(request, parent, isMain) {
  if (request === 'electron') {
    // Let Electron's internal module loader handle it
    // by removing the npm package from the resolution path
    throw new Error('SKIP_NPM_ELECTRON');
  }
  return originalResolveFilename.apply(this, arguments);
};

try {
  require('electron');
} catch(e) {
  if (e.message === 'SKIP_NPM_ELECTRON') {
    console.log('Intercepted npm electron package');
    // Now try to get the real electron module
    // Electron's internal modules should be accessible
    console.log('process.type:', process.type);
    console.log('process.versions.electron:', process.versions.electron);
    
    // Try to access internal electron binding
    try {
      const internal = process._linkedBinding('electron_renderer');
      console.log('_linkedBinding electron_renderer:', typeof internal);
      if (internal) console.log('app:', internal.app ? 'found' : 'not found');
    } catch(e2) {
      console.log('_linkedBinding error:', e2.message);
    }
    
    // Try to access via global
    console.log('global.app:', typeof global.app);
    console.log('global.BrowserWindow:', typeof global.BrowserWindow);
  } else {
    console.log('Other error:', e.message);
  }
}

process.exit(0);
