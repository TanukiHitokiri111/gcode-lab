// G-Code Lab — настольное приложение (Electron)
// Раздаёт статическую сборку симулятора с локального адреса 127.0.0.1 во встроенном окне.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const APP_TITLE = 'G-Code Lab';
let mainWindow = null;
let server = null;
let port = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
  '.map': 'application/json',
};

function rootDir() {
  return path.join(__dirname, 'renderer');
}

function logLine(text) {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'app.log'), new Date().toISOString() + ' ' + text + '\n');
  } catch (_) { /* логи не должны ронять приложение */ }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const root = rootDir();
    server = http.createServer((req, res) => {
      try {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        let rel = decodeURIComponent(parsed.pathname);
        if (rel === '/' || rel === '') rel = '/index.html';

        let file = path.join(root, rel);
        if (!path.resolve(file).startsWith(path.resolve(root))) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403');
          return;
        }
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
          file = path.join(file, 'index.html');
        }
        if (!fs.existsSync(file)) {
          // маршруты без расширения отдаём как index.html (SPA-фолбэк), остальное — честный 404
          if (!path.extname(rel)) file = path.join(root, 'index.html');
        }
        if (!fs.existsSync(file)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404');
          return;
        }
        const ext = path.extname(file).toLowerCase();
        const body = fs.readFileSync(file);
        res.writeHead(200, {
          'Content-Type': MIME[ext] || 'application/octet-stream',
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
        });
        res.end(body);
      } catch (err) {
        logLine('http error: ' + (err && err.message));
        try {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('500');
        } catch (_) {}
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      logLine('server started on 127.0.0.1:' + port);
      resolve(port);
    });
  });
}

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') return s;
  } catch (_) {}
  return {};
}

function saveState() {
  if (!mainWindow) return;
  try {
    const b = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(statePath(), JSON.stringify({
      width: b.width, height: b.height, x: b.x, y: b.y,
      maximized: mainWindow.isMaximized(),
    }, null, 2));
  } catch (_) {}
}

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Полный экран', accelerator: 'F11', click: () => toggleFullscreen() },
        { type: 'separator' },
        { label: 'Выход', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Обновить', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Масштаб +', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.1) },
        { label: 'Масштаб −', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
        { label: 'Сбросить масштаб', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { label: 'Инструменты разработчика', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'О программе', click: () => showAbout() },
        { label: 'Сайт проекта', click: () => shell.openExternal('https://cnc.tanukihitokiri.ru/') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function zoom(delta) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  const current = wc.getZoomFactor();
  wc.setZoomFactor(delta === 0 ? 1 : Math.min(3, Math.max(0.5, current + delta)));
}

function toggleFullscreen() {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'О программе',
    message: APP_TITLE,
    detail:
      'Версия ' + app.getVersion() + '\n\n' +
      'Симулятор стойки Fanuc Oi: 3-осевая фрезеровка по G-коду.\n' +
      'Справочник G/M-кодов, привязка датчиком Renishaw OMP60,\n' +
      'смена инструмента M06 с магазином, импорт STL/STEP.\n\n' +
      '© 2026. Программа для личного некоммерческого использования.\n' +
      'Работает локально, без интернета.',
    buttons: ['ОК'],
  });
}

function createWindow() {
  const state = loadState();
  mainWindow = new BrowserWindow({
    width: state.width || 1600,
    height: state.height || 1000,
    x: state.x,
    y: state.y,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#050810',
    title: APP_TITLE,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', saveState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1:')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logLine('render-process-gone: ' + JSON.stringify(details));
  });

  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) logLine('console[' + level + ']: ' + message);
  });

  mainWindow.loadURL('http://127.0.0.1:' + port + '/');
}

process.on('uncaughtException', (err) => {
  logLine('uncaughtException: ' + (err && err.stack ? err.stack : err));
  try { dialog.showErrorBox('Ошибка', String(err && err.message ? err.message : err)); } catch (_) {}
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      buildMenu();
      createWindow();
    } catch (err) {
      logLine('startup failed: ' + (err && err.stack ? err.stack : err));
      dialog.showErrorBox('Не удалось запустить', String(err && err.message ? err.message : err));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    saveState();
    if (server) server.close();
  });
}
