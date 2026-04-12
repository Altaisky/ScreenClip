const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;
let tray = null;
let serverProcess = null;
let isServerRunning = false;

const SERVER_DIR = path.join(__dirname, '..', 'pc-server');
const SERVER_SCRIPT = path.join(SERVER_DIR, 'index.js');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    resizable: false,
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('close', (event) => {
    if (isServerRunning) { event.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  let trayIcon = nativeImage.createEmpty();
  const iconPath = path.join(__dirname, 'icon.png');
  if (fs.existsSync(iconPath)) trayIcon = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть', click: () => mainWindow.show() },
    { label: 'Перезапустить сервер', click: restartServer },
    { type: 'separator' },
    { label: 'Выйти', click: () => { if (serverProcess) serverProcess.kill(); app.quit(); }}
  ]);
  tray.setToolTip('ScreenClip Server');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function startServer() {
  if (isServerRunning) return;
  const { fork } = require('child_process');
  serverProcess = fork(SERVER_SCRIPT, [], { cwd: SERVER_DIR, stdio: 'pipe', windowsHide: true });

  serverProcess.stdout.on('data', (data) => {
    if (data.toString().includes('Server is running')) {
      isServerRunning = true;
      if (mainWindow) mainWindow.webContents.send('server-status', { status: 'running', message: 'Сервер запущен' });
      if (tray) tray.setToolTip('ScreenClip: Сервер запущен');
    }
  });
  serverProcess.stderr.on('data', (data) => {
    if (mainWindow) mainWindow.webContents.send('server-status', { status: 'error', message: data.toString() });
  });
  serverProcess.on('close', (code) => {
    isServerRunning = false;
    if (mainWindow) mainWindow.webContents.send('server-status', { status: 'stopped', message: 'Сервер остановлен (код ' + code + ')' });
    if (tray) tray.setToolTip('ScreenClip: Сервер остановлен');
  });
  if (mainWindow) mainWindow.webContents.send('server-status', { status: 'starting', message: 'Запуск сервера...' });
}

function stopServer() { if (serverProcess) { serverProcess.kill(); serverProcess = null; } isServerRunning = false; }
function restartServer() { stopServer(); setTimeout(startServer, 1000); }

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => {});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('get-server-status', () => ({ isRunning: isServerRunning }));
ipcMain.handle('start-server', () => { startServer(); return true; });
ipcMain.handle('stop-server', () => { stopServer(); return true; });
ipcMain.handle('restart-server', () => { restartServer(); return true; });

ipcMain.handle('copy-to-clipboard', async (event, screenshotId) => {
  try {
    const http = require('http');
    const { exec } = require('child_process');
    const tempFilePath = path.join(os.tmpdir(), 'clipboard-' + screenshotId + '.png');
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/screenshot/' + screenshotId, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        fs.writeFileSync(tempFilePath, Buffer.concat(chunks));
        const escapedPath = tempFilePath.replace(/'/g, "''");
        const ps = "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Drawing.Image]::FromFile('" + escapedPath + "'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose();";
        exec('powershell -Command "' + ps + '"', () => { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); });
      });
    });
    req.on('error', () => {});
    req.end();
    return true;
  } catch (e) { return false; }
});
