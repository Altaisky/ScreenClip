const electron = require('electron');
console.log('electron module:', typeof electron);
console.log('electron keys:', Object.keys(electron).slice(0, 10));
console.log('app:', electron.app);
console.log('BrowserWindow:', electron.BrowserWindow);
