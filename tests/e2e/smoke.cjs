'use strict';
/*
 * End-to-end smoke test: opens the real UI in Electron (like platforms/electron/main.cjs,
 * with a throw-away profile), walks the main screens and fails on any page
 * error or missing piece. Run with:  npm run test:e2e
 * Works offline: a fake addon on loopback (catalog, meta, search, a source)
 * fills movies and series, like a real addon compatible with Stremio.
 */
const { app, BrowserWindow, ipcMain, net, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const UI = path.join(ROOT, 'ui');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'opentv-e2e-'));

protocol.registerSchemesAsPrivileged([{ scheme: 'opentv', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'opentv-img', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('mute-audio');

const results = [];
const pageErrors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* A tiny addon compatible with Stremio on 127.0.0.1: 14 movies and 6 series
   in its catalogs, search, meta with episodes, and a direct source. */
function startFakeAddon() {
  const http = require('node:http');
  const movies = Array.from({ length: 14 }, (_, i) => ({ id: 'tt10' + (i + 10), type: 'movie', name: 'Película Prueba ' + (i + 1),
    poster: '', genres: ['Acción'], releaseInfo: '2024', description: 'Sinopsis de prueba.' }));
  const series = Array.from({ length: 6 }, (_, i) => ({ id: 'tt20' + (i + 10), type: 'series', name: 'Serie Prueba ' + (i + 1),
    poster: '', genres: ['Drama'], releaseInfo: '2023' }));
  const manifest = { id: 'org.opentv.prueba', version: '1.0.0', name: 'Prueba', types: ['movie', 'series'], idPrefixes: ['tt'],
    resources: ['catalog', 'meta', 'stream'],
    catalogs: [{ type: 'movie', id: 'top', name: 'Popular' }, { type: 'series', id: 'top', name: 'Popular' },
      { type: 'movie', id: 'buscar', name: 'Buscar', extra: [{ name: 'search', isRequired: true }] }] };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let body = null, m;
    /* A picture for the image resizer check (platforms/electron/sized-images.cjs). */
    if (p === '/picture.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(fs.readFileSync(path.join(UI, 'assets', 'original', 'common', 'img_thubnail_default.png')));
      return;
    }
    if (p === '/manifest.json') body = manifest;
    else if ((m = /^\/catalog\/(movie|series)\/top\.json$/.exec(p))) body = { metas: m[1] === 'movie' ? movies : series };
    else if ((m = /^\/catalog\/movie\/buscar\/search=(.+)\.json$/.exec(p))) body = { metas: movies.filter((x) => x.name.toLowerCase().includes(m[1].toLowerCase())) };
    else if ((m = /^\/meta\/(movie|series)\/(.+)\.json$/.exec(p))) {
      const base = (m[1] === 'movie' ? movies : series).find((x) => x.id === m[2]) || {};
      body = { meta: Object.assign({}, base, m[1] === 'series' ? { videos: [1, 2, 3].map((e) => ({ id: m[2] + ':1:' + e, season: 1, episode: e, title: 'Capítulo ' + e })) } : {}) };
    } else if (/^\/stream\//.test(p)) body = { streams: [{ name: 'Prueba\n1080p', title: 'Prueba.1080p.mp4\n🇲🇽', url: 'http://127.0.0.1:9/prueba.mp4' }] };
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body || {}));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
}

app.whenReady().then(async () => {
  require(path.join(ROOT, 'platforms', 'electron', 'sized-images.cjs')).install(protocol, net, path.join(profile, 'sized-images'));
  protocol.handle('opentv', (request) => {
    const url = new URL(request.url);
    const file = path.resolve(UI, '.' + decodeURIComponent(url.pathname || '/index.html'));
    if (!file.startsWith(UI + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  process.env.OPENTV_FFMPEG_PATH = path.join(ROOT, 'bin', 'ffmpeg.exe');
  let service = null;
  try { service = require(path.join(ROOT, 'platforms', 'electron', 'service.cjs')).createService(); } catch (e) { pageErrors.push('service: ' + e.message); }
  ipcMain.handle('desktop:service', (_e, m, p) => (service && service.methods.includes(m) ? service.call(m, p || {}) : { returnValue: false }));
  ipcMain.handle('desktop:fullscreen', () => false);
  /* TMDB trends: no network calls in the test (the rows simply stay off). */
  ipcMain.handle('desktop:tmdb', () => ({ results: [] }));
  /* The rest of the real main process (platforms/electron/main.cjs) that the
     interface calls on start: answered with "nothing to do". */
  ipcMain.handle('desktop:pin', () => false);
  ipcMain.handle('desktop:update', () => null);
  ipcMain.handle('desktop:backup', () => null);
  ipcMain.handle('desktop:open-addon-config', () => false);
  ipcMain.handle('desktop:info', () => ({ version: require(path.join(ROOT, 'package.json')).version }));
  const volume = { volume: 0.5, muted: false };
  ipcMain.handle('desktop:system-volume', (_e, c, v) => {
    if (c === 'set') volume.volume = v;
    if (c === 'mute') volume.muted = !!v;
    return Object.assign({}, volume);
  });

  const win = new BrowserWindow({
    x: -4000, y: 40, width: 1360, height: 820, show: true, skipTaskbar: true, backgroundColor: '#0e0e11',
    webPreferences: { preload: path.join(ROOT, 'platforms', 'electron', 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.on('console-message', (event, level, message) => {
    const text = event.message || message || '';
    const isError = event.level === 'error' || level === 3;
    if (isError && /Uncaught|TypeError|ReferenceError|SyntaxError/.test(text)) pageErrors.push(text);
  });
  win.webContents.on('render-process-gone', (_e, d) => pageErrors.push('renderer gone: ' + d.reason));
  const addonUrl = await startFakeAddon();
  const js = (code) => win.webContents.executeJavaScript(code, true);
  /* Only the fake addon (no network): saved before the app starts. */
  await win.loadURL('opentv://app/index.html?screen=home');
  await js(`localStorage.setItem('opentv_vod_defaults_v1', '1'); localStorage.setItem('opentv_vod_anime_v1', '1');
    localStorage.setItem('opentv_guide_seen_v1', '1');
    localStorage.setItem('opentv_vod_sources_v1', JSON.stringify({ mode: 'external', addons: [{ url: '${addonUrl}/manifest.json' }] })); 1`);
  await win.loadURL('opentv://app/index.html?screen=home');
  async function check(name, code, settle) {
    if (settle) await wait(settle);
    let ok = false, detail = '';
    try { const r = await js(code); ok = r === true || (r && r.ok === true); detail = r && r.detail ? r.detail : ''; }
    catch (e) { detail = e.message; }
    results.push({ name, ok, detail });
  }

  await js("window.addEventListener('error', function (e) { console.error('Uncaught ' + e.message); }); 1");
  await check('home opens with the tab rail', "window.__opentv.skipWelcome(); !!document.querySelector('.home-tabs .tab-item, #home-tabs .focusable')", 2500);
  await check('images come resized (PC image resizer)', `(function(){
      var base = window.desktop && window.desktop.imageSizer;
      if (!base) { return { ok: false, detail: 'no imageSizer' }; }
      return new Promise(function (done) {
        var img = new Image();
        img.onload = function () { done({ ok: img.naturalWidth === 64, detail: img.naturalWidth + 'x' + img.naturalHeight }); };
        img.onerror = function () { done({ ok: false, detail: 'error' }); };
        img.src = base + '?w=64&u=' + encodeURIComponent('${addonUrl}/picture.png');
      });
    })()`, 0);
  await check('opens on Inicio',"(function(){ var t = window.__opentv.state.tab; return { ok: document.querySelectorAll('.home-page')[1].classList.contains('is-current'), detail: 'tab ' + t }; })()", 300);
  await check('TV page has the dock with volume and guide', "(function(){ window.__opentv.selectTab(0); return new Promise(function (done) { setTimeout(function () { done({ ok: !!document.querySelector('.live-dock .live-vol-range') && !!document.querySelector('.live-dock-btn.is-guide') }); }, 1200); }); })()", 300);
  await check('channel guide opens and closes', `(function(){
      document.querySelector('.live-dock-btn.is-guide').click();
      var open = document.querySelector('.live-guide.is-open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var closed = !document.querySelector('.live-guide.is-open');
      return { ok: !!open && closed, detail: 'open=' + !!open + ' closed=' + closed };
    })()`, 500);
  /* TV en vivo comes only from the viewer's M3U lists: a fake list (no
     network) fills the list, the categories and the guide. */
  await check('TV en vivo shows the M3U channels by category', `(function(){
      window.__opentv.live.use([
        { name: 'Canal Prueba', group: 'News', streamUrl: 'http://127.0.0.1:9/a.m3u8', channelCode: 'm3u_1' },
        { name: 'Deporte Prueba', group: 'Sports', streamUrl: 'http://127.0.0.1:9/b.m3u8', channelCode: 'm3u_2' }
      ]);
      /* (A channel already playing from the real lists stays on top, marked is-kept.) */
      var rows = document.querySelectorAll('.live-list .live-row:not(.is-kept)').length;
      var cats = window.__opentv.live.categories().map(function (c) { return c.name; }).join(',');
      document.querySelector('.live-dock-btn.is-guide').click();
      var cards = document.querySelectorAll('.live-guide .lg-card').length;
      var catBtns = document.querySelectorAll('.live-guide .lg-cat').length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: rows === 2 && cards >= 2 && cats === 'Todos,Deportes,Noticias' && catBtns === 5,
        detail: 'rows=' + rows + ' cards=' + cards + ' cats=' + cats + ' buttons=' + catBtns };
    })()`, 300);
  await check('TV en vivo without lists says how to add one', `(function(){
      window.__opentv.live.use([]);
      var s = document.querySelector('.live-list .live-list-status');
      var text = s ? s.textContent : '';
      var ok = /Ajustes → Addons → TV en vivo/.test(text) && !!(s && s.querySelector('.live-add-lists'));
      window.__opentv.live.use([{ name: 'Canal Prueba', group: 'News', streamUrl: 'http://127.0.0.1:9/a.m3u8' }]);
      return { ok: ok, detail: text };
    })()`, 300);
  await check('Destacados shows the addon rows', `(function(){
      window.__opentv.selectTab(1);
      return new Promise(function (done) { setTimeout(function () {
        var n = document.querySelectorAll('.home-page.is-current .d-row').length;
        done({ ok: n >= 1, detail: n + ' rows' });
      }, 1500); });
    })()`);
  await check('Películas shows the grid', `(function(){
      window.__opentv.selectTab(2);
      return new Promise(function (done) { setTimeout(function () {
        var n = document.querySelectorAll('.home-page.is-current .poster').length;
        done({ ok: n >= 12, detail: n + ' posters' });
      }, 1500); });
    })()`);
  await check('search suggests titles while typing', `(function(){
      window.__opentv.show('search');
      var title = (window.__opentv.vod.filter(function (v) { return v.title && v.title.length > 4; })[0] || {}).title || 'casa';
      var input = document.getElementById('desktop-search-input');
      input.focus();
      input.value = title.slice(0, 4);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var n = document.querySelectorAll('.search-suggest.is-open .ss-item').length;
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: n >= 2, detail: n + ' suggestions for "' + title.slice(0, 4) + '"' };
    })()`, 500);
  await check('detail page opens', `(function(){
      window.__opentv.openDetail(0);
      return new Promise(function (done) { setTimeout(function () {
        done({ ok: window.__opentv.state.screen === 'detail', detail: window.__opentv.state.screen });
      }, 1200); });
    })()`);
  await check('the start guide opens from Ayuda', `(function(){
      window.__opentv.show('help');
      var btn = Array.prototype.filter.call(document.querySelectorAll('.sd-help .focusable, .sd-help button'), function (n) { return /Ver la guía/.test(n.textContent); })[0];
      if (btn) { if (btn._activate) { btn._activate(); } else { btn.click(); } }
      var g = document.getElementById('dialog-guide');
      var t = g ? g.querySelector('.srcp-title').textContent : '';
      function button(text) { return g && Array.prototype.filter.call(g.querySelectorAll('.acc-seg-btn'), function (n) { return n.textContent === text; })[0]; }
      /* A real click (like the mouse), not a call: it must reach the button. */
      var next = button('Siguiente');
      if (next) { next.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
      var t2 = g ? g.querySelector('.srcp-title').textContent : '';
      var skip = button('Omitir');
      if (skip) { skip.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
      return { ok: !!g && /Bienvenido/.test(t) && t2 !== t && !document.getElementById('dialog-guide'), detail: t + ' → ' + t2 };
    })()`, 600);
  await check('settings: no PIN lock, Compartir or Diagnóstico', `(function(){
      window.__opentv.settingsPanel(0);
      var labels = Array.prototype.map.call(document.querySelectorAll('.settings-item'), function (n) { return n.textContent.trim(); });
      var gone = ['Bloqueo', 'Compartir', 'Diagnóstico'].every(function (x) { return labels.indexOf(x) === -1; });
      return { ok: labels.length >= 5 && gone && labels.indexOf('Ajustes') !== -1, detail: labels.join(', ') };
    })()`, 600);
  await check('title bar is shown', "!!document.getElementById('app-titlebar')", 0);
  await check('detail of an addon title offers to play it', `(function(){
      var b = Array.prototype.map.call(document.querySelectorAll('#screen-detail .detail-btn'), function (n) { return n.getAttribute('data-kind'); });
      return { ok: b.indexOf('fullscreen') !== -1 && !document.querySelector('.detail-nosrc'), detail: b.join(', ') };
    })()`, 0);
  /* A movie watched to 10:00: Reanudar starts there, "Ver desde el
     principio" shows and starts at 0; without progress it is hidden. */
  await check('detail offers Reanudar and Ver desde el principio', `(function(){
      var X = window.__opentv;
      var vod = X.currentVod();
      var movie = vod.filter(function (it) { return !(it.series || it.type === 'series' || (it.seasons && it.seasons.length)); })[0];
      if (!movie) { return { ok: false, detail: 'sin película en el catálogo' }; }
      var h = X.history();
      h.unshift({ id: String(movie.id), title: movie.title, position: 600, duration: 6000, stremio: !!movie._stremio });
      X.openItem(movie);
      return new Promise(function (done) { setTimeout(function () {
        var restart = document.querySelector('#screen-detail .detail-btn[data-kind="restart"]');
        var play = document.querySelector('#screen-detail .detail-btn[data-kind="fullscreen"] span');
        var shown = !!restart && restart.style.display !== 'none';
        var resume = X.resumePlanFor(movie, null, false);
        var fromStart = X.resumePlanFor(movie, null, true);
        h.shift();
        X.openItem(movie);
        setTimeout(function () {
          var r2 = document.querySelector('#screen-detail .detail-btn[data-kind="restart"]');
          var hidden = !r2 || r2.style.display === 'none';
          done({ ok: shown && hidden && /Reanudar/.test(play ? play.textContent : '') && resume.pos === 600 && fromStart.pos === 0 && fromStart.restarted,
            detail: (play ? play.textContent : '?') + ' · botón ' + (shown ? 'visible' : 'oculto') + ' → sin progreso ' + (hidden ? 'oculto' : 'visible') +
              ' · plan ' + resume.pos + 's / desde el principio ' + fromStart.pos + 's' });
        }, 400);
      }, 600); });
    })()`, 2500);
  await check('Addons page: addons and live lists, no modes', `(function(){
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('sources'));
      var titles = Array.prototype.map.call(document.querySelectorAll('.sd-sources .fx-section .fx-title'), function (n) { return n.textContent; });
      var modes = document.querySelectorAll('.fx-mode').length;
      return { ok: modes === 0 && titles.join('|') === 'Películas y series|TV en vivo', detail: modes + ' modos · ' + titles.join(', ') };
    })()`, 600);
  /* Recomendados (addons) and Buscar (TV lists) share one dialog. */
  await check('Addons page recommends addons and TV lists', `(function(){
      function open(sel) {
        document.querySelector('.sd-sources ' + sel)._activate();
        var dlg = document.getElementById('dialog-addons');
        var out = { on: dlg.classList.contains('is-active'), title: dlg.querySelector('.da-title').textContent,
          names: Array.prototype.map.call(dlg.querySelectorAll('.da-preset-name'), function (n) { return n.textContent; }) };
        document.getElementById('da-btn-exit')._activate();
        out.closed = !dlg.classList.contains('is-active');
        return out;
      }
      var vod = open('.fx-btn.is-recommend');
      var tv = open('.fx-btn.is-search');
      return { ok: vod.on && vod.closed && vod.title === 'Addons recomendados' &&
        vod.names.join('|') === 'Torrentio|TorrentsDB' &&
        tv.on && tv.closed && tv.title === 'Buscar listas de TV' && tv.names[0] === 'Pluto TV México',
        detail: vod.names.join(', ') + ' · TV: ' + tv.names.slice(0, 3).join(', ') + '…' };
    })()`, 600);
  await check('Ajustes has Apariencia, Reproducción and Preferencias de addons', `(function(){
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('playback'));
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.sd-hub .sd-tab'));
      var names = tabs.map(function (t) { return t.textContent; });
      var seen = [];
      tabs.forEach(function (t) {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        var first = document.querySelector('.sd-hub .sd-tab-body .set-row-name span');
        seen.push(first ? first.textContent : '');
      });
      return { ok: names.join('|') === 'Apariencia|Reproducción|Preferencias de addons' &&
        seen.join('|') === 'Tamaño de los pósteres|Calidad|Idiomas preferidos', detail: names.join(', ') + ' → ' + seen.join(', ') };
    })()`, 600);
  /* Without an addon that gives sources: information only, and where to add one. */
  await check('without a source addon the detail says where to add one', `(function(){
      localStorage.setItem('opentv_vod_sources_v1', JSON.stringify({ mode: 'external', addons: [
        { url: 'https://meta.example/manifest.json', resources: [{ name: 'catalog' }, { name: 'meta' }] }] }));
      window.__opentv.openDetail(0);
      return new Promise(function (done) { setTimeout(function () {
        var note = document.querySelector('.detail-nosrc');
        var play = document.querySelector('#screen-detail .detail-btn[data-kind="fullscreen"]');
        done({ ok: !!note && !play, detail: note ? note.textContent : 'sin aviso' });
      }, 800); });
    })()`, 300);
  /* The same interface as a TV: addons there too (no torrents). */
  await win.loadURL('opentv://app/index.html?screen=home&platform=android-tv');
  await check('TV has addons and live lists', `(function(){
      window.__opentv.skipWelcome();
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('sources'));
      return new Promise(function (done) { setTimeout(function () {
        var titles = Array.prototype.map.call(document.querySelectorAll('.fx-section .fx-title'), function (n) { return n.textContent; });
        done({ ok: titles.indexOf('Películas y series') !== -1 && titles.indexOf('TV en vivo') !== -1, detail: titles.join(', ') });
      }, 800); });
    })()`, 2500);
  /* With the remote: reach Recomendados / Buscar, open, move through the
     list, Back closes and the focus comes back to the button. */
  await check('TV remote picks recommended addons and lists', `(function(){
      var X = window.__opentv;
      function cur() { return X.state.focus; }
      function name() { var f = cur(); if (!f) { return '?'; } var n = f.querySelector('.da-preset-name'); return n ? n.textContent : (f.id || f.className); }
      function run(btnSel) {
        var add = document.querySelector('.sd-sources ' + btnSel).parentNode.querySelector('.fx-btn:not(.is-ghost)');
        X.focus(add);
        X.key(39);
        var reached = cur() === document.querySelector('.sd-sources ' + btnSel);
        X.focus('.sd-sources ' + btnSel);
        X.key(13);
        var dlg = document.getElementById('dialog-addons');
        var opened = dlg.classList.contains('is-active');
        var seen = [name()];
        for (var i = 0; i < 3; i++) { X.key(40); seen.push(name()); }
        X.key(27);
        var back = !dlg.classList.contains('is-active') && cur() === document.querySelector('.sd-sources ' + btnSel);
        return { reached: reached, opened: opened, seen: seen, back: back };
      }
      var vod = run('.fx-btn.is-recommend');
      var tv = run('.fx-btn.is-search');
      function moved(r) { return r.seen[1] !== r.seen[3] && r.seen.indexOf('?') === -1; }
      return { ok: vod.reached && vod.opened && moved(vod) && vod.back && tv.reached && tv.opened && moved(tv) && tv.back,
        detail: JSON.stringify({ vod: vod, tv: tv }) };
    })()`, 600);

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
