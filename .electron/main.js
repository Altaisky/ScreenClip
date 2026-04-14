const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { networkInterfaces } = require('os');

let mainWindow;
let tray = null;
let serverProcess = null;
let isServerRunning = false;

/** Получить первый не внутренний IPv4 адрес (локальная сеть) */
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Пропускаем внутренние и не-IPv4 адреса
      if (!net.internal && net.family === 'IPv4') {
        return net.address;
      }
    }
  }
  return '127.0.0.1'; // fallback
}

const SERVER_DIR = path.join(__dirname, '..', 'pc-server');
const SERVER_SCRIPT = path.join(SERVER_DIR, 'index.js');

// API key для общения с сервером
const SERVER_API_KEY = process.env.SCREENCLIP_API_KEY || require('crypto').randomBytes(16).toString('hex');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 600,
    webPreferences: { 
      nodeIntegration: true, 
      contextIsolation: false,
      webSecurity: false // Разрешаем HTTP-запросы к localhost:3000
    },
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
    { label: 'Принудительная остановка', click: forceStopAll },
    { label: 'Выйти', click: () => { if (serverProcess) serverProcess.kill(); app.quit(); }}
  ]);
  tray.setToolTip('ScreenClip Server');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function startServer() {
  if (isServerRunning) return;
  const { fork } = require('child_process');
  serverProcess = fork(SERVER_SCRIPT, [], {
    cwd: SERVER_DIR,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    env: { ...process.env, SCREENCLIP_API_KEY: SERVER_API_KEY }
  });

  serverProcess.stdout.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Server is running')) {
      isServerRunning = true;
      if (mainWindow) mainWindow.webContents.send('server-status', { status: 'running', message: 'Сервер запущен' });
      if (tray) tray.setToolTip('ScreenClip: Сервер запущен');
    }
  });
  
  // Обработка IPC-сообщений от сервера
  serverProcess.on('message', (msg) => {
    if (msg.type === 'server-status' && mainWindow) {
      mainWindow.webContents.send('server-status', { status: msg.status, message: msg.message });
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
  serverProcess.on('error', (err) => {
    if (mainWindow) mainWindow.webContents.send('server-status', { status: 'error', message: 'Ошибка сервера: ' + err.message });
  });
  if (mainWindow) mainWindow.webContents.send('server-status', { status: 'starting', message: 'Запуск сервера...' });
}

function stopServer() {
  if (!serverProcess) { isServerRunning = false; return; }
  try {
    // Пробуем graceful shutdown
    if (serverProcess.connected) {
      serverProcess.send({ cmd: 'shutdown' });
    }
    // Ждём 1 сек, затем kill
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        try { serverProcess.kill('SIGTERM'); } catch (e) {}
      }
    }, 1000);
  } catch (e) {
    // Если что-то пошло не так — жёстко убиваем
    try { serverProcess.kill('SIGKILL'); } catch (e) {}
  }
  serverProcess = null;
  isServerRunning = false;
}

/** Принудительная остановка: убивает ТОЛЬКО наш сервер и clipboard-helper */
function forceStopAll() {
  console.log('[force-stop] Stopping only ScreenClip processes...');

  // Останавливаем НАШ серверный процесс (который мы сами fork'нули)
  if (serverProcess && !serverProcess.killed) {
    try {
      if (serverProcess.connected) {
        serverProcess.send({ cmd: 'shutdown' });
      }
      serverProcess.kill('SIGKILL');
      console.log('[force-stop] Our server process killed');
    } catch (e) {
      console.log('[force-stop] Error killing server process:', e.message);
    }
  }

  serverProcess = null;
  isServerRunning = false;

  // Убиваем ТОЛЬКО clipboard-helper.exe от НАШЕГО сервера
  const { exec } = require('child_process');
  exec('taskkill /F /IM clipboard-helper.exe 2>nul', (err) => {
    if (err && err.code !== 128) {
      console.log('[force-stop] Error killing clipboard-helper.exe:', err.message);
    } else {
      console.log('[force-stop] clipboard-helper.exe killed');
    }
  });

  // ВАЖНО: НЕ ищем и НЕ убиваем другие node.exe процессы!
  // Раньше использовался wmic для поиска процессов по командной строке,
  // что могло случайно убить посторонние Node.js приложения.

  if (mainWindow) {
    mainWindow.webContents.send('server-status', {
      status: 'stopped',
      message: 'Все процессы ScreenClip остановлены'
    });
  }
  if (tray) {
    tray.setToolTip('ScreenClip: Остановлено принудительно');
  }
}
function restartServer() { stopServer(); setTimeout(startServer, 1000); }

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', () => {});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('get-server-status', () => ({ isRunning: isServerRunning }));
ipcMain.handle('start-server', () => { startServer(); return true; });
ipcMain.handle('stop-server', () => { stopServer(); return true; });
ipcMain.handle('restart-server', () => { restartServer(); return true; });
ipcMain.handle('force-stop-all', () => { forceStopAll(); return true; });
ipcMain.handle('get-local-ip', () => getLocalIP());
ipcMain.handle('get-api-key', () => SERVER_API_KEY);

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

// Получить последний скриншот (base64)
ipcMain.handle('get-latest-screenshot', async () => {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      http.get('http://localhost:3000/latest-screenshot', (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data);
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  } catch (e) { return null; }
});

// Получить метаданные последнего скриншота
ipcMain.handle('get-screenshot-info', async () => {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      http.get('http://localhost:3000/screenshot-info', (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString());
            resolve(data);
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null));
    });
  } catch (e) { return null; }
});

// Сохранить скриншот на диск
ipcMain.handle('save-screenshot', async (event, base64Data) => {
  try {
    const { dialog } = require('electron');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить скриншот',
      defaultPath: `screenclip-${Date.now()}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
      return true;
    }
    return false;
  } catch (e) { return false; }
});
