'use strict';

const {
  app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell,
  globalShortcut, powerSaveBlocker, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

// Jaga perekaman tetap mulus walau jendela diminimalkan / tidak fokus.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const APP_NAME = 'Rekam Studio';
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mkv']);

let win = null;
let selectedSourceId = null;
let rec = null; // { handle, file, bytes }
let psbId = null;
let allowClose = false;
let minimizedByUs = false;
let settings = null;

/* ---------------- Pengaturan ---------------- */

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = () => ({
  resolution: '1080',
  fps: 60,
  quality: 'high',
  format: 'mp4',
  systemAudio: true,
  mic: false,
  micId: 'default',
  noiseSuppression: true,
  countdown: true,
  minimizeOnRecord: false,
  hideFromCapture: true,
  saveDir: path.join(app.getPath('videos'), APP_NAME),
});

function loadSettings() {
  try {
    settings = { ...defaultSettings(), ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = defaultSettings();
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Gagal menyimpan pengaturan:', err);
  }
}

/* ---------------- Utilitas ---------------- */

const send = (channel, ...args) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
};

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

function uniquePath(dir, base, ext) {
  let file = path.join(dir, `${base}.${ext}`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i}).${ext}`);
  return file;
}

// Hanya izinkan aksi pada file video di dalam folder simpan.
function isManagedFile(file) {
  if (typeof file !== 'string') return false;
  const rel = path.relative(path.resolve(settings.saveDir), path.resolve(file));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) && VIDEO_EXT.has(path.extname(file).toLowerCase());
}

function stopPowerBlocker() {
  if (psbId !== null && powerSaveBlocker.isStarted(psbId)) powerSaveBlocker.stop(psbId);
  psbId = null;
}

/* ---------------- Jendela ---------------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    frame: false,
    show: false,
    title: APP_NAME,
    backgroundColor: '#0a0c10',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // Jendela Rekam Studio tidak ikut terekam (mencegah efek cermin tak berujung).
  win.setContentProtection(!!settings.hideFromCapture);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));

  win.on('close', (e) => {
    if (!rec || allowClose) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Simpan & Keluar', 'Batal'],
      defaultId: 0,
      cancelId: 1,
      title: APP_NAME,
      message: 'Rekaman sedang berjalan.',
      detail: 'Hentikan dan simpan rekaman sebelum keluar?',
    });
    if (choice === 0) send('shortcut', 'stop-and-close');
  });

  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/* ---------------- Capture ---------------- */

function setupDisplayMedia() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((s) => s.id === selectedSourceId)
        || sources.find((s) => s.id.startsWith('screen:'));
      if (!source) return callback({});
      const streams = { video: source };
      if (request.audioRequested && process.platform === 'win32') streams.audio = 'loopback';
      callback(streams);
    } catch (err) {
      console.error('Gagal memilih sumber:', err);
      callback({});
    }
  }, { useSystemPicker: false });
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:toggle-maximize', () => {
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('win:close', () => win?.close());
  ipcMain.on('win:close-now', () => { allowClose = true; win?.close(); });
  ipcMain.on('win:title', (_e, title) => win?.setTitle(String(title)));

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    const allowed = Object.keys(defaultSettings());
    for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k)) settings[k] = v;
    saveSettings();
    if (win && 'hideFromCapture' in (patch || {})) win.setContentProtection(!!settings.hideFromCapture);
    return settings;
  });

  ipcMain.handle('app:info', () => {
    const pkg = require('./package.json');
    return { name: APP_NAME, version: pkg.version, author: pkg.author.name || pkg.author };
  });

  ipcMain.handle('dir:choose', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Pilih folder penyimpanan',
      defaultPath: settings.saveDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    settings.saveDir = res.filePaths[0];
    saveSettings();
    return settings.saveDir;
  });

  ipcMain.handle('dir:open', async () => {
    await fsp.mkdir(settings.saveDir, { recursive: true });
    return shell.openPath(settings.saveDir);
  });

  ipcMain.handle('sources:list', async () => {
    const own = win ? win.getMediaSourceId() : null;
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 480, height: 270 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.id !== own && s.name !== APP_NAME)
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });

  ipcMain.handle('source:select', (_e, id) => { selectedSourceId = id; return true; });

  ipcMain.handle('rec:start', async (_e, ext) => {
    if (rec) throw new Error('Perekaman sudah berjalan');
    const safeExt = ext === 'webm' ? 'webm' : 'mp4';
    await fsp.mkdir(settings.saveDir, { recursive: true });
    const file = uniquePath(settings.saveDir, `Rekaman ${timestamp()}`, safeExt);
    const handle = await fsp.open(file, 'w');
    rec = { handle, file, bytes: 0 };
    psbId = powerSaveBlocker.start('prevent-app-suspension');
    return file;
  });

  ipcMain.handle('rec:chunk', async (_e, data) => {
    if (!rec) return 0;
    const buf = data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await rec.handle.write(buf);
    rec.bytes += buf.byteLength;
    return rec.bytes;
  });

  ipcMain.handle('rec:stop', async () => {
    if (!rec) return null;
    const { handle, file, bytes } = rec;
    rec = null;
    stopPowerBlocker();
    await handle.close();
    if (bytes === 0) {
      await fsp.unlink(file).catch(() => {});
      return null;
    }
    return { path: file, name: path.basename(file), size: bytes };
  });

  ipcMain.on('rec:state', (_e, state) => {
    if (!win) return;
    if (state === 'recording' && settings.minimizeOnRecord && !win.isMinimized()) {
      minimizedByUs = true;
      win.minimize();
    } else if (state === 'idle' && minimizedByUs) {
      minimizedByUs = false;
      if (win.isMinimized()) win.restore();
    }
  });

  ipcMain.handle('files:list', async () => {
    let names = [];
    try { names = await fsp.readdir(settings.saveDir); } catch { return []; }
    const files = await Promise.all(names
      .filter((n) => VIDEO_EXT.has(path.extname(n).toLowerCase()))
      .map(async (n) => {
        const full = path.join(settings.saveDir, n);
        try {
          const st = await fsp.stat(full);
          return st.isFile() ? { name: n, path: full, size: st.size, mtime: st.mtimeMs } : null;
        } catch { return null; }
      }));
    return files.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, 200);
  });

  ipcMain.handle('files:open', (_e, file) => (isManagedFile(file) ? shell.openPath(file) : 'invalid'));
  ipcMain.handle('files:reveal', (_e, file) => { if (isManagedFile(file)) shell.showItemInFolder(file); });
  ipcMain.handle('files:trash', async (_e, file) => {
    if (!isManagedFile(file) || (rec && rec.file === file)) return false;
    await shell.trashItem(file);
    return true;
  });
}

// Ctrl+Alt dipilih agar tidak bentrok dengan Ctrl+Shift+R (hard reload) di browser.
const SHORTCUTS = {
  'CommandOrControl+Alt+R': 'toggle',
  'CommandOrControl+Alt+P': 'pause',
};

function registerShortcuts() {
  for (const [accel, action] of Object.entries(SHORTCUTS)) {
    let ok = false;
    try { ok = globalShortcut.register(accel, () => send('shortcut', action)); } catch { /* format tidak valid */ }
    if (!ok) console.warn(`Pintasan ${accel} sudah dipakai aplikasi lain`);
  }
}

/* ---------------- Siklus aplikasi ---------------- */

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!gotLock) return;
  app.setAppUserModelId('com.imronsf.rekamstudio');
  loadSettings();
  setupDisplayMedia();
  registerIpc();
  createWindow();
  registerShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopPowerBlocker();
  if (rec) { rec.handle.close().catch(() => {}); rec = null; }
});

app.on('window-all-closed', () => app.quit());
