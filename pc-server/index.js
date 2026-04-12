const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

app.use(cors());

// Хранилище скриншотов: id -> { path, timestamp }
const screenshots = new Map();
let screenshotCounter = 0;

// Настройка multer — сохраняет файлы во временную папку
const SCREENSHOT_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SCREENSHOT_DIR),
  filename: (req, file, cb) => {
    screenshotCounter++;
    const id = `shot_${screenshotCounter}_${Date.now()}`;
    cb(null, id + '.png');
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST /screenshot — загрузка скриншота с телефона
app.post('/screenshot', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const id = path.basename(req.file.filename, '.png');
  screenshots.set(id, {
    path: req.file.path,
    timestamp: Date.now(),
    size: req.file.size
  });

  console.log(`Screenshot saved: ${id} (${req.file.size} bytes)`);
  res.json({ id, message: 'Screenshot uploaded successfully' });

  // Автоматическое копирование в буфер обмена
  copyToClipboard(req.file.path);
});

// GET /screenshot/:id — отдача скриншота (для Electron / буфера обмена)
app.get('/screenshot/:id', (req, res) => {
  const { id } = req.params;
  const info = screenshots.get(id);

  if (!info) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }

  if (!fs.existsSync(info.path)) {
    screenshots.delete(id);
    return res.status(404).json({ error: 'Screenshot file missing' });
  }

  res.sendFile(info.path);
});

// GET /screenshots — список всех скриншотов
app.get('/screenshots', (req, res) => {
  const list = [];
  for (const [id, info] of screenshots.entries()) {
    list.push({ id, timestamp: info.timestamp, size: info.size });
  }
  res.json(list);
});

// DELETE /screenshot/:id — удаление скриншота
app.delete('/screenshot/:id', (req, res) => {
  const { id } = req.params;
  const info = screenshots.get(id);

  if (!info) {
    return res.status(404).json({ error: 'Screenshot not found' });
  }

  if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
  screenshots.delete(id);
  res.json({ message: 'Screenshot deleted' });
});

// Автоматическое копирование скриншота в буфер обмена
function copyToClipboard(filePath) {
  const escapedPath = filePath.replace(/'/g, "''");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Drawing.Image]::FromFile('${escapedPath}'); [System.Windows.Forms.Clipboard]::SetImage($img); $img.Dispose();`;
  
  exec(`powershell -Command "${ps}"`, (err) => {
    if (err) {
      console.error(`Clipboard error: ${err.message}`);
    } else {
      console.log(`Screenshot copied to clipboard`);
    }
  });
}

// Очистка старыхых скриншотов старше 1 часа (каждые 10 минут)
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  for (const [id, info] of screenshots.entries()) {
    if (now - info.timestamp > ONE_HOUR) {
      if (fs.existsSync(info.path)) fs.unlinkSync(info.path);
      screenshots.delete(id);
      console.log(`Cleaned up old screenshot: ${id}`);
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Listening on all interfaces — accessible from local network`);
});
