const path = require('path');
const { exec } = require('child_process');

// Запуск Electron из node_modules
const electronPath = path.join(__dirname, 'node_modules', '.bin', 'electron.cmd');
const appPath = __dirname;

console.log('Launching Electron...');
console.log('Electron path:', electronPath);
console.log('App path:', appPath);

exec(`"${electronPath}" "${appPath}"`, {
  cwd: __dirname,
  stdio: 'inherit'
}, (err) => {
  if (err) console.error('Launch error:', err);
});
