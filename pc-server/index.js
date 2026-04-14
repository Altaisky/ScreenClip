const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const clipboard = require('./clipboard-monitor');

const app = express();
const PORT = 3000;

// Генерируем API ключ при запуске (или берём из переменной окружения)
const API_KEY = process.env.SCREENCLIP_API_KEY || crypto.randomBytes(16).toString('hex');

// ВАЖНО: API-ключ ОПЦИОНАЛЕН для локального использования.
// Android-приложение пока не передаёт ключ, поэтому мы не блокируем запросы.
// Ключ логируется для будущей настройки безопасности.
function optionalApiKeyAuth(req, res, next) {
  const providedKey = req.headers['x-api-key'] || req.query['api_key'];
  if (providedKey) {
    if (providedKey !== API_KEY) {
      console.warn('[auth] Invalid API key provided');
      // Не блокируем — просто логируем
    } else {
      console.log('[auth] Valid API key provided');
    }
  } else {
    console.log('[auth] No API key provided (allowing for local use)');
  }
  next();
}

app.use(cors());

// Временное хранилище для скриншота (только для передачи в clipboard)
const TEMP_DIR = path.join(os.tmpdir(), 'screenclip-temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Хранение последнего скриншота для превью в Electron
let lastScreenshot = {
  data: null,       // Buffer с данными изображения
  timestamp: null,  // Время получения
  size: 0           // Размер в байтах
};

// multer сохраняет во временный файл только для передачи в clipboard
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    cb(null, `temp_${Date.now()}.png`);
  }
});

// Фильтр файлов — принимаем только изображения
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Only images are allowed.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  }
});

// POST /screenshot — загрузка скриншота с телефона → сразу в буфер обмена
app.post('/screenshot', optionalApiKeyAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    console.log(`Screenshot received (${req.file.size} bytes, ${req.file.mimetype}) — copying to clipboard...`);

    // Сохраняем данные для превью (до удаления файла)
    try {
      lastScreenshot.data = fs.readFileSync(filePath);
      lastScreenshot.timestamp = Date.now();
      lastScreenshot.size = req.file.size;
    } catch (e) {
      console.error('[preview] Failed to read file:', e.message);
    }

    // Копируем в буфер обмена
    const success = await copyToClipboard(filePath);

    if (success) {
      // Удаляем временный файл ТОЛЬКО после успешного копирования
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn('Could not delete temp file:', e.message);
      }
      console.log('Screenshot copied to clipboard successfully');
      res.json({ message: 'Screenshot copied to clipboard' });
    } else {
      console.error('Failed to copy screenshot to clipboard (preview saved)');
      // Возвращаем 200 — превью всё равно работает
      res.json({ message: 'Screenshot saved (clipboard failed)', warning: 'Clipboard copy failed' });
    }
  } catch (err) {
    console.error('[error] /screenshot handler error:', err.message);
    if (err.stack) console.error('[error] Stack:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /screenshot-info — метаданные последнего скриншота
app.get('/screenshot-info', (req, res) => {
  if (!lastScreenshot || !lastScreenshot.data) {
    return res.json({ hasScreenshot: false });
  }
  res.json({
    hasScreenshot: true,
    timestamp: lastScreenshot.timestamp,
    size: lastScreenshot.size
  });
});

// GET /latest-screenshot — отдаёт последний скриншот (base64)
app.get('/latest-screenshot', (req, res) => {
  if (!lastScreenshot || !lastScreenshot.data) {
    return res.status(404).json({ error: 'No screenshot available' });
  }
  res.json({
    data: lastScreenshot.data.toString('base64'),
    timestamp: lastScreenshot.timestamp,
    size: lastScreenshot.size
  });
});

// Глобальный обработчик ошибок multer
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size: 50 MB' });
  }
  if (err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error('[error] Unhandled error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
});

// Автоматическое копирование скриншота в буфер обмена
async function copyToClipboard(filePath) {
  clipboard.ignoreNextChange();
  const success = await clipboard.copyImageToClipboard(filePath);
  if (!success) {
    clipboard.resetIgnoreNext();
  }
  return success;
}

// ВАЖНО: Мониторинг и автоочистка буфера ОТКЛЮЧЕНЫ по умолчанию.
// Раньше буфер очищался через 1 сек после любого изменения,
// что мешало пользователю копировать свои данные.
// Скриншоты всё равно попадают в буфер — просто не очищаются автоматически.

function startClipboardMonitoring() {
  console.log('[clipboard] Auto-clear is DISABLED. Screenshots will stay in clipboard until you copy something else.');
  // Если когда-нибудь понадобится включить автоочистку — раскомментируйте:
  /*
  if (clipboardMonitored) return;
  clipboardMonitored = true;

  clipboard.startMonitor(() => {
    console.log('Clipboard change detected — scheduling clear...');
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clipboard.clearClipboard();
      console.log('Clipboard cleared');
      clearTimer = null;
    }, 5000); // 5 секунд — более разумный таймаут
  });
  */
}

// Очистка временных файлов при запуске (на случай если остались)
function cleanupTempFiles() {
  if (fs.existsSync(TEMP_DIR)) {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      } catch (e) {
        // игнорируем ошибки
      }
    }
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Listening on all interfaces — accessible from local network`);
  console.log(`Screenshots go directly to clipboard, no files saved permanently`);

  // Очистка временных файлов
  cleanupTempFiles();

  // Компилируем и запускаем clipboard сервер
  clipboard.compileHelper().then((ok) => {
    if (ok) {
      console.log('[clipboard] Starting clipboard server...');
      return clipboard.startServer().then((started) => {
        if (started) {
          console.log('[clipboard] Clipboard server started, monitoring enabled');
          startClipboardMonitoring();
        } else {
          console.error('[clipboard] WARNING: Clipboard server failed to start.');
          console.error('[clipboard] Screenshots will be received but NOT copied to clipboard.');
          console.error('[clipboard] Check that .NET Framework is installed and helper.exe can compile.');
        }
      });
    } else {
      console.error('[clipboard] WARNING: Helper.exe compilation failed.');
      console.error('[clipboard] The server will run but clipboard functionality will be disabled.');
      console.error('[clipboard] To fix: ensure .NET Framework 4.x is installed and clipboard-helper.cs exists.');
    }
  }).catch((e) => {
    console.error('[clipboard] Unexpected error during initialization:', e.message);
    if (e.stack) console.error('[clipboard] Stack:', e.stack);
  });
});

// Graceful shutdown — обработка SIGTERM и сообщений от Electron
function gracefulShutdown() {
  console.log('[server] Shutting down gracefully...');
  clipboard.stopMonitor();
  clipboard.stopServer();
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Electron fork — слушаем команды управления
if (process.send) {
  // Сообщаем Electron'у что сервер готов
  process.send({ type: 'server-status', status: 'running', message: 'Сервер запущен' });
  
  process.on('message', (msg) => {
    if (msg.cmd === 'shutdown') {
      gracefulShutdown();
    }
  });
}

// Глобальная обработка ошибок — чтобы сервер не падал полностью
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.message);
  if (err.stack) console.error('[server] Stack:', err.stack);
  // Не завершаем процесс — логируем и продолжаем работу
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled rejection at:', promise, 'reason:', reason);
  // Не завершаем процесс — логируем и продолжаем работу
});
