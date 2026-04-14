const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

let monitorInterval = null;
let lastSequence = null;
let serverProcess = null;
let readyCallback = null;
let ignoreNext = false; // Пропустить следующее изменение (наше копирование)
const HELPER_EXE = path.join(__dirname, 'clipboard-helper.exe');
const HELPER_CS = path.join(__dirname, 'clipboard-helper.cs');

/** Пропустить следующее изменение буфера (вызывается после нашего копирования) */
function ignoreNextChange() {
  ignoreNext = true;
}

/** Сбросить флаг игнорирования (если копирование не удалось) */
function resetIgnoreNext() {
  ignoreNext = false;
}

/**
 * Компилирует helper.exe
 */
function compileHelper() {
  return new Promise((resolve) => {
    if (!fs.existsSync(HELPER_CS)) {
      console.error('[clipboard] clipboard-helper.cs not found at:', HELPER_CS);
      console.error('[clipboard] Please ensure the C# source file exists before starting the server.');
      resolve(false);
      return;
    }

    const netDir = process.env.windir + '\\Microsoft.NET\\Framework';
    let cscPath = null;
    for (const v of ['v4.0.30319']) {
      const p = path.join(netDir, v, 'csc.exe');
      if (fs.existsSync(p)) { cscPath = p; break; }
    }

    if (!cscPath) {
      console.error('[clipboard] ERROR: csc.exe (C# compiler) not found.');
      console.error('[clipboard] This is required for clipboard functionality.');
      console.error('[clipboard] Please ensure .NET Framework 4.x is installed.');
      resolve(false);
      return;
    }

    console.log('[clipboard] Compiling helper.exe...');
    // Используем cwd для избежания проблем с пробелами в путях
    const outArg = '/out:clipboard-helper.exe';
    execFile(cscPath, [
      '/out:clipboard-helper.exe',
      '/target:exe',
      '/r:System.Drawing.dll',
      '/r:System.Windows.Forms.dll',
      'clipboard-helper.cs'
    ], { windowsHide: true, cwd: __dirname }, (err, stdout, stderr) => {
      if (err) {
        console.error('[clipboard] Compilation error:', err.message);
        if (stdout) console.error('[clipboard] csc stdout:', stdout);
        if (stderr) console.error('[clipboard] csc stderr:', stderr);
        console.error('[clipboard] Failed to compile helper.exe');
        resolve(false);
        return;
      }
      const ok = fs.existsSync(HELPER_EXE);
      if (ok) {
        console.log('[clipboard] Helper compiled successfully:', HELPER_EXE);
      } else {
        console.error('[clipboard] Compilation completed but helper.exe not found!');
        console.error('[clipboard] Expected path:', HELPER_EXE);
      }
      resolve(ok);
    });
  });
}

/**
 * Запускает helper.exe как долгоживущий серверный процесс.
 */
function startServer() {
  return new Promise((resolve) => {
    if (!fs.existsSync(HELPER_EXE)) {
      console.error('[clipboard] ERROR: helper.exe not found at:', HELPER_EXE);
      console.error('[clipboard] Please compile it first or ensure clipboard-helper.cs exists.');
      console.error('[clipboard] Current working directory:', __dirname);
      resolve(false);
      return;
    }

    // Если старый процесс ещё жив — убиваем его
    if (serverProcess && !serverProcess.killed) {
      console.log('[clipboard] Killing old server process before starting new one');
      try {
        serverProcess.kill('SIGKILL');
      } catch (e) {
        // Игнорируем ошибки
      }
      serverProcess = null;
    }

    try {
      serverProcess = spawn('clipboard-helper.exe', [], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: __dirname
      });

      let output = '';
      let hasResolved = false;

      serverProcess.stderr.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('ready') && !hasResolved) {
          hasResolved = true;
          console.log('[clipboard] Server ready');
          resolve(true);
        }
      });

      serverProcess.on('error', (err) => {
        console.error('[clipboard] Server spawn error:', err.message);
        if (!hasResolved) {
          hasResolved = true;
          resolve(false);
        }
      });

      serverProcess.on('exit', (code, signal) => {
        console.log(`[clipboard] Server exited (code: ${code}, signal: ${signal})`);
        serverProcess = null;
        // Если монитор был запущен и сервер упал неожиданно — перезапускаем
        if (monitorInterval && !hasResolved) {
          console.log('[clipboard] Server crashed during monitoring, restarting...');
          setTimeout(() => {
            startServer().then((ok) => {
              if (ok) {
                console.log('[clipboard] Server restarted successfully');
              } else {
                console.error('[clipboard] Failed to restart server');
              }
            });
          }, 1000);
        }
      });

      // Timeout — если сервер не запустился за 5 секунд
      setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          console.error('[clipboard] Server startup timeout (5s)');
          resolve(false);
        }
      }, 5000);
    } catch (err) {
      console.error('[clipboard] Failed to start server:', err.message);
      resolve(false);
    }
  });
}

/**
 * Отправляет команду серверу и получает ответ.
 */
function sendCommand(cmd) {
  return new Promise((resolve) => {
    if (!serverProcess || !serverProcess.stdin || !serverProcess.stdin.writable) {
      console.warn('[clipboard] Server process not available for command:', cmd);
      resolve(null);
      return;
    }

    try {
      console.log('[clipboard] Sending command:', cmd);
      let data = '';
      let timeoutId = null;
      
      const onData = (chunk) => {
        data += chunk.toString();
        console.log('[clipboard] Received data:', data.trim());
        if (data.includes('\n')) {
          if (timeoutId) clearTimeout(timeoutId);
          serverProcess.stdout.removeListener('data', onData);
          resolve(data.trim());
        }
      };
      serverProcess.stdout.once('data', onData);
      serverProcess.stdin.write(cmd + '\n');
      serverProcess.stdin.cork();
      setTimeout(() => serverProcess.stdin.uncork(), 10);

      // Timeout — 10 секунд на ответ (увеличено для copy операций)
      timeoutId = setTimeout(() => {
        serverProcess.stdout.removeListener('data', onData);
        console.warn('[clipboard] Command timeout:', cmd, '(10s)');
        console.warn('[clipboard] Server process state:', serverProcess ? `pid=${serverProcess.pid}, killed=${serverProcess.killed}, connected=${serverProcess.connected}` : 'null');
        resolve(null);
      }, 10000);
    } catch (err) {
      console.error('[clipboard] sendCommand error:', err.message);
      resolve(null);
    }
  });
}

/**
 * Получает номер последовательности буфера обмена.
 */
async function getClipboardSequence() {
  const result = await sendCommand('seq');
  if (result === null) return null;
  const num = parseInt(result);
  return isNaN(num) ? null : num;
}

/**
 * Копирует изображение в буфер (передаёт путь к файлу).
 */
async function copyImageToClipboard(filePath) {
  console.log('[clipboard] copyImageToClipboard called with:', filePath);
  console.log('[clipboard] Server process alive:', serverProcess && !serverProcess.killed);
  console.log('[clipboard] File exists:', fs.existsSync(filePath));
  
  if (!serverProcess || serverProcess.killed) {
    console.error('[clipboard] ERROR: Server process is dead, cannot copy to clipboard');
    return false;
  }
  
  if (!fs.existsSync(filePath)) {
    console.error('[clipboard] ERROR: File does not exist:', filePath);
    return false;
  }

  const result = await sendCommand('copy ' + filePath);
  console.log('[clipboard] copyImageToClipboard result:', result);
  return result === 'OK';
}

/** Очистить буфер обмена */
async function clearClipboard() {
  const result = await sendCommand('clear');
  console.log('[clipboard] Clear result:', result);
}

/**
 * Запустить фоновый мониторинг буфера.
 */
let monitorCallback = null;
let isRestarting = false; // Защита от множественных рестартов

function startMonitor(onClipboardChange) {
  if (monitorInterval) {
    console.log('[clipboard] Monitor already running, skipping');
    return;
  }
  
  monitorCallback = onClipboardChange;
  isRestarting = false;

  monitorInterval = setInterval(async () => {
    // Если уже пытаемся рестартнуть — пропускаем тик
    if (isRestarting) return;

    const seq = await getClipboardSequence();
    if (seq === null) {
      // Server died — try to restart
      console.log('[clipboard] Server unreachable, restarting...');
      isRestarting = true;
      
      const ok = await startServer();
      isRestarting = false;
      
      if (!ok) {
        console.error('[clipboard] Failed to restart server, will retry on next tick');
        return;
      }
      
      lastSequence = await getClipboardSequence();
      console.log('[clipboard] Server restarted, new sequence:', lastSequence);
      return;
    }
    
    if (lastSequence !== null && seq !== lastSequence) {
      console.log('[clipboard] Sequence changed:', lastSequence, '->', seq, 'ignoreNext:', ignoreNext);
      if (ignoreNext) {
        ignoreNext = false;
        console.log('[clipboard] Ignoring our own change');
      } else {
        if (monitorCallback) {
          monitorCallback();
        }
      }
    }
    lastSequence = seq;
  }, 500);
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('[clipboard] Monitor stopped');
  }
  lastSequence = null;
  isRestarting = false;
  monitorCallback = null;
}

function stopServer() {
  stopMonitor();
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill('SIGTERM');
      console.log('[clipboard] Server stopped gracefully');
    } catch (e) {
      console.warn('[clipboard] Error stopping server:', e.message);
      try {
        serverProcess.kill('SIGKILL');
      } catch (e2) {
        // Игнорируем
      }
    }
  }
  serverProcess = null;
}

module.exports = { startMonitor, stopMonitor, stopServer, clearClipboard, copyImageToClipboard, getClipboardSequence, compileHelper, startServer, ignoreNextChange, resetIgnoreNext };
