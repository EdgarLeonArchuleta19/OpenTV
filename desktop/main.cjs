'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

protocol.registerSchemesAsPrivileged([{ scheme: 'xuper', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);

const info = require('../package.json');
const { createService } = require('./service.cjs');
const systemAudio = require('./system-volume.cjs');
let windowRef;
let shortcutFor = () => null;
let service;
let quitting = false;
let fullscreenRequested = false;
const TITLE_BAR_HEIGHT = 36;

function toggleFullscreen(flag) {
  if (!windowRef) return false;
  fullscreenRequested = typeof flag === 'boolean' ? flag : !windowRef.isFullScreen();
  windowRef.setFullScreen(fullscreenRequested);
  return fullscreenRequested;
}

/* Portable mode: when a "data" folder sits next to "OpenTV.exe", the
   profile (favourites, history, preferences) lives there, so the whole folder
   can be copied to another PC or a USB stick. Otherwise %APPDATA% is used. */
const appDataDir = app.getPath('appData');
const defaultUserData = path.join(appDataDir, 'OpenTV');
const legacyUserData = path.join(appDataDir, 'XuperDesktop');
/* Single-file portable exe (electron-builder): it unpacks to a temporary
   folder on every start and reports where the real .exe is. Keep the profile
   next to that .exe so it travels with it. */
const singleExeDir = process.env.PORTABLE_EXECUTABLE_DIR;
const portableData = singleExeDir
  ? path.join(singleExeDir, 'OpenTV - datos')
  : path.join(path.dirname(process.execPath), 'data');
if (singleExeDir) { try { fs.mkdirSync(portableData, { recursive: true }); } catch { /* read-only media */ } }
const isPortable = fs.existsSync(portableData) && fs.statSync(portableData).isDirectory();

function migrateProfileIfNeeded(targetDir) {
  try {
    const fresh = !fs.existsSync(path.join(targetDir, 'Local Storage'));
    const legacyPortable = singleExeDir ? path.join(singleExeDir, 'Xuper Desktop - datos') : null;
    const sourceDir = (legacyPortable && fs.existsSync(legacyPortable))
      ? legacyPortable
      : (fs.existsSync(legacyUserData) ? legacyUserData : null);
    if (fresh && sourceDir && sourceDir !== targetDir) {
      const skip = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Crashpad', 'blob_storage', 'Shared Dictionary']);
      fs.cpSync(sourceDir, targetDir, {
        recursive: true,
        filter: (src) => !skip.has(path.basename(src)) && !/^Singleton/.test(path.basename(src)) && path.basename(src) !== 'lockfile'
      });
    }
  } catch { /* the profile starts empty if it cannot be copied */ }
}

const activeUserData = isPortable ? portableData : defaultUserData;
migrateProfileIfNeeded(activeUserData);
app.setPath('userData', activeUserData);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setName('OpenTV');
  if (process.platform === 'win32') app.setAppUserModelId('com.techpoint.opentv');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.on('second-instance', () => {
    if (windowRef) { if (windowRef.isMinimized()) windowRef.restore(); windowRef.focus(); }
  });
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox('No se pudo abrir OpenTV', error.message);
    app.quit();
  });
}

async function start() {
  process.env.XUPER_FFMPEG_PATH = process.platform === 'win32'
    ? path.join(app.getAppPath(), 'bin', 'ffmpeg.exe')
    : (process.env.XUPER_FFMPEG_PATH || '/usr/bin/ffmpeg');
  process.env.XUPER_DESKTOP_TRANSCODE = '1';

  const root = path.resolve(app.getAppPath(), 'ui');
  protocol.handle('xuper', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname || '/index.html')); }
    catch { return new Response('Bad path', { status: 400 }); }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).href);
  });

  // Dark native title bar and dialogs on Windows 10/11, matching the app.
  nativeTheme.themeSource = 'dark';
  service = createService();
  const trusted = (event) => event.sender === windowRef?.webContents &&
    event.senderFrame?.url?.startsWith('xuper://app/');

  ipcMain.handle('desktop:service', (event, method, parameters) => {
    if (!trusted(event) || typeof method !== 'string' || !service.methods.includes(method)) {
      return { returnValue: false, errorText: 'Operación no permitida' };
    }
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
        JSON.stringify(parameters).length > 65536) parameters = {};
    return service.call(method, parameters);
  });
  ipcMain.handle('desktop:fullscreen', (event, flag) => {
    if (!trusted(event)) return false;
    if (flag === 'query') return Boolean(windowRef?.isFullScreen());
    return toggleFullscreen(flag);
  });
  ipcMain.handle('desktop:system-volume', (event, command, value) => {
    if (!trusted(event) || ['get', 'set', 'mute'].indexOf(command) === -1) return { error: 'Operación no permitida' };
    return systemAudio.systemVolume(command, value);
  });
  ipcMain.handle('desktop:info', (event) => trusted(event) ? {
    version: info.version, platform: process.platform, arch: process.arch,
    independent: true, upstream: info.upstream?.commit || null
  } : null);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');

  const iconPath = path.join(root, 'images', 'icon-large.png');
  windowRef = new BrowserWindow({
    title: 'OpenTV', width: 1360, height: 840, minWidth: 960, minHeight: 600,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#0e0e11', show: false, autoHideMenuBar: true,
    // Own title bar: the page draws the strip (logo, drag area) and Windows
    // keeps its real minimize/maximize/close buttons on top of it.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0e11', symbolColor: '#e6e6ea', height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      // Keep the decoder and playback timers active while the user minimizes
      // the window or switches to another app. Closing still shuts media down.
      backgroundThrottling: false,
      webSecurity: true, allowRunningInsecureContent: false
    }
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('xuper://app/')) event.preventDefault();
  });
  windowRef.on('enter-full-screen', () => {
    fullscreenRequested = true;
    windowRef?.webContents.send('desktop:fullscreen-changed', true);
  });
  windowRef.on('leave-full-screen', () => {
    fullscreenRequested = false;
    windowRef?.webContents.send('desktop:fullscreen-changed', false);
  });
  // Esc leaves full screen first (like any video player). That key press is
  // consumed, so it does not also close the player or go back a screen.
  windowRef.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'Escape' && !input.isAutoRepeat && windowRef && windowRef.isFullScreen()) {
      event.preventDefault();
      toggleFullscreen(false);
      return;
    }
    // The window has no menu bar any more, so its shortcuts live here.
    const shortcut = shortcutFor(input);
    if (shortcut) { event.preventDefault(); if (!input.isAutoRepeat) shortcut(); }
  });
  windowRef.once('ready-to-show', () => windowRef.show());
  windowRef.on('closed', () => { windowRef = null; app.quit(); });

  const action = (name) => windowRef?.webContents.send('desktop:action', name);
  const shortcuts = {
    'Ctrl+H': () => action('home'),
    'Ctrl+F': () => action('search'),
    'Ctrl+J': () => action('history'),
    'Ctrl+,': () => action('settings'),
    'F11': () => toggleFullscreen(),
    // The floating window needs a user gesture; run it as one.
    'Ctrl+P': () => windowRef?.webContents.executeJavaScript('window.__xuper && window.__xuper.show("pip")', true).catch(() => {}),
    'Alt+ArrowLeft': () => action('back'),
    'Ctrl+R': () => windowRef?.reload(),
    'F5': () => windowRef?.reload()
  };
  shortcutFor = (input) => {
    const key = input.key.length === 1 ? input.key.toUpperCase() : input.key;
    const combo = (input.control ? 'Ctrl+' : '') + (input.alt ? 'Alt+' : '') + (input.shift ? 'Shift+' : '') + key;
    return shortcuts[combo] || null;
  };
  // No menu bar: the title bar is the app's own. Copy/paste keep working in
  // text fields without it.
  Menu.setApplicationMenu(null);

  try {
    await windowRef.loadURL('xuper://app/index.html?screen=home');
  } catch (error) {
    // A user reload can replace the first navigation before its load completes.
    if (error.code !== 'ERR_ABORTED' && error.errno !== -3) throw error;
  }
}

app.on('before-quit', () => {
  if (quitting) return;
  quitting = true;
  try { service?.close(); } catch { /* shutdown continues */ }
  try { systemAudio.stop(); } catch { /* shutdown continues */ }
});
app.on('window-all-closed', () => app.quit());
