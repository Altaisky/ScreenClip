# ScreenClip

Система удалённого захвата экрана: скриншоты с Android → буфер обмена Windows.

## Как работает

1. **Android-приложение** делает скриншот (через встряхивание или кнопку)
2. Скриншот отправляется по HTTP на PC-сервер
3. PC-сервер копирует изображение в буфер обмена Windows
4. Пользователь вставляет через Ctrl+V

## Компоненты

- **Electron** — GUI для управления сервером (tray-иконка)
- **PC-сервер** (Node.js, порт 3000) — принимает скриншоты и копирует в clipboard
- **Android-приложение** (Capacitor) — захват экрана через MediaProjection API

## Требования

### Windows (PC-сервер)
- **Node.js** 16+
- **.NET Framework 4.x** (для clipboard-helper.exe)

### Android (телефон)
- Android 10+ (для старых версий может не работать)
- MediaProjection API

## Установка и запуск

### 1. PC-сервер и Electron GUI

```bash
# Установить зависимости для pc-server
cd pc-server
npm install

# Установить зависимости для Electron
cd ../.electron
npm install
```

### 2. Запуск

**Вариант А: Через launcher.cmd**
```bash
# В корне проекта
launcher.cmd
```

**Вариант Б: Вручную**
```bash
# Запустить Electron GUI
cd .electron
npm start
```

### 3. Настройка Android

1. Откройте Electron-приложение (появится tray-иконка)
2. Нажмите "Запустить сервер"
3. Скопируйте **IP-адрес** и **API-ключ** из окна
4. Откройте Android-приложение
5. Введите IP и API-ключ в настройках
6. Дайте разрешение на захват экрана
7. Встряхните телефон или нажмите "Capture"

## Структура проекта

```
ScreenClip/
├── .electron/           # Electron GUI
│   ├── main.js          # Главный процесс
│   ├── index.html       # UI управления
│   └── package.json
├── pc-server/           # HTTP-сервер
│   ├── index.js         # Express сервер (порт 3000)
│   ├── clipboard-monitor.js  # Мониторинг clipboard
│   ├── clipboard-helper.cs   # C# helper для clipboard
│   └── package.json
├── android/             # Android-приложение (Capacitor)
├── www/                 # Web UI для WebView
└── launcher.cmd         # Быстрый запуск
```

## API

### PC-сервер

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/screenshot` | Загрузка скриншота (multipart/form-data) |

**Заголовки:**
- `X-API-Key: <ваш_ключ>` — обязательный

**Ответ:**
```json
{ "message": "Screenshot copied to clipboard" }
```

## Troubleshooting

### clipboard-helper.exe не компилируется
- Убедитесь, что .NET Framework 4.x установлен
- Проверьте, что `clipboard-helper.cs` существует в `pc-server/`

### Скриншоты не приходят
- Проверьте, что PC-сервер запущен (статус в tray)
- Убедитесь, что телефон и PC в одной сети
- Проверьте IP-адрес в настройках Android

### "Force Stop" не помогает
- Закройте Electron полностью через tray → "Выйти"
- Убедитесь, что нет других процессов `clipboard-helper.exe` в Диспетчере задач

## Безопасность

- API-ключ генерируется случайно при каждом запуске
- Сервер слушает `0.0.0.0` — доступен из локальной сети
- Файлы скриншотов не сохраняются (удаляются после копирования в clipboard)

## Лицензия

ISC
