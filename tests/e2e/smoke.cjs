'use strict';
/*
 * End-to-end smoke test: opens the real UI in Electron (like desktop/main.cjs,
 * with a throw-away profile), walks the main screens and fails on any page
 * error or missing piece. Run with:  npm run test:e2e
 * Works offline: the bundled catalogue snapshot fills the home pages.
 */
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const UI = path.join(ROOT, 'ui');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opentv-e2e-'));

protocol.registerSchemesAsPrivileged([{ scheme: 'xuper', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('mute-audio');

const results = [];
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  protocol.handle('xuper', (request) => {
    const url = new URL(request.url);
    const file = path.resolve(UI, '.' + decodeURIComponent(url.pathname || '/index.html'));
    if (!file.startsWith(UI + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  process.env.XUPER_FFMPEG_PATH = path.join(ROOT, 'bin', 'ffmpeg.exe');
  let service = null;
  try { service = require(path.join(ROOT, 'desktop', 'service.cjs')).createService(); } catch (e) { pageErrors.push('service: ' + e.message); }
  ipcMain.handle('desktop:service', (_e, m, p) => (service && service.methods.includes(m) ? service.call(m, p || {}) : { returnValue: false }));
  ipcMain.handle('desktop:fullscreen', () => false);
  ipcMain.handle('desktop:info', () => ({ version: require(path.join(ROOT, 'package.json')).version }));
  const volume = { volume: 0.5, muted: false };
  ipcMain.handle('desktop:system-volume', (_e, c, v) => {
    if (c === 'set') volume.volume = v;
    if (c === 'mute') volume.muted = !!v;
    return Object.assign({}, volume);
  });

  const win = new BrowserWindow({
    x: -4000, y: 40, width: 1360, height: 820, show: true, skipTaskbar: true, backgroundColor: '#0e0e11',
    webPreferences: { preload: path.join(ROOT, 'desktop', 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.on('console-message', (event, level, message) => {
    const text = event.message || message || '';
    const isError = event.level === 'error' || level === 3;
    if (isError && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(text)) pageErrors.push(text);
  });
  win.webContents.on('render-process-gone', (_e, d) => pageErrors.push('renderer gone: ' + d.reason));
  await win.loadURL('xuper://app/index.html?screen=home');
  const js = (code) => win.webContents.executeJavaScript(code, true);
  async function check(name, code, settle) {
    if (settle) await wait(settle);
    let ok = false, detail = '';
    try { const r = await js(code); ok = r === true || (r && r.ok === true); detail = r && r.detail ? r.detail : ''; }
    catch (e) { detail = e.message; }
    results.push({ name, ok, detail });
  }

  await js("window.addEventListener('error', function (e) { console.error('Uncaught ' + e.message); }); 1");
  await check('home opens with the tab rail', "window.__xuper.skipWelcome(); !!document.querySelector('.home-tabs .tab-item, #home-tabs .focusable')", 2500);
  await check('opens on Inicio', "(function(){ var t = window.__xuper.state.tab; return { ok: document.querySelectorAll('.home-page')[1].classList.contains('is-current'), detail: 'tab ' + t }; })()", 300);
  await check('TV page has the dock with volume and guide', "(function(){ window.__xuper.selectTab(0); return new Promise(function (done) { setTimeout(function () { done({ ok: !!document.querySelector('.live-dock .live-vol-range') && !!document.querySelector('.live-dock-btn.is-guide') }); }, 1200); }); })()", 300);
  await check('channel guide opens and closes', `(function(){
      document.querySelector('.live-dock-btn.is-guide').click();
      var open = document.querySelector('.live-guide.is-open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var closed = !document.querySelector('.live-guide.is-open');
      return { ok: !!open && closed, detail: 'open=' + !!open + ' closed=' + closed };
    })()`, 500);
  await check('Destacados shows portal rows', `(function(){
      window.__xuper.selectTab(1);
      return new Promise(function (done) { setTimeout(function () {
        var n = document.querySelectorAll('.home-page.is-current .d-row').length;
        done({ ok: n >= 3, detail: n + ' rows' });
      }, 1500); });
    })()`);
  await check('Películas shows the grid', `(function(){
      window.__xuper.selectTab(2);
      return new Promise(function (done) { setTimeout(function () {
        var n = document.querySelectorAll('.home-page.is-current .poster').length;
        done({ ok: n >= 12, detail: n + ' posters' });
      }, 1500); });
    })()`);
  await check('search suggests titles while typing', `(function(){
      window.__xuper.show('search');
      var title = (window.__xuper.vod.filter(function (v) { return v.title && v.title.length > 4; })[0] || {}).title || 'casa';
      var input = document.getElementById('desktop-search-input');
      input.focus();
      input.value = title.slice(0, 4);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var n = document.querySelectorAll('.search-suggest.is-open .ss-item').length;
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: n >= 2, detail: n + ' suggestions for "' + title.slice(0, 4) + '"' };
    })()`, 500);
  await check('detail page opens', `(function(){
      window.__xuper.openDetail(0);
      return new Promise(function (done) { setTimeout(function () {
        done({ ok: window.__xuper.state.screen === 'detail', detail: window.__xuper.state.screen });
      }, 1200); });
    })()`);
  await check('settings has no PIN lock entry', `(function(){
      window.__xuper.settingsPanel(0);
      var labels = Array.prototype.map.call(document.querySelectorAll('.settings-item'), function (n) { return n.textContent.trim(); });
      return { ok: labels.length >= 5 && labels.indexOf('Bloqueo') === -1 && !!document.querySelector('.acc-seg'), detail: labels.join(', ') };
    })()`, 600);
  await check('title bar is shown', "!!document.getElementById('app-titlebar')", 0);

  await wait(500);
  try { service && service.close(); } catch { /* closing */ }
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log((r.ok ? 'ok    ' : 'FALLA ') + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
  }
  for (const e of pageErrors) console.log('ERROR de página: ' + e);
  console.log(failed || pageErrors.length ? '\nE2E: ' + failed + ' fallo(s), ' + pageErrors.length + ' error(es) de página' : '\nE2E: todo bien (' + results.length + ' comprobaciones)');
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked files */ }
  app.exit(failed || pageErrors.length ? 1 : 0);
});
