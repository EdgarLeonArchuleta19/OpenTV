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
const { cspFor } = require('../../platforms/electron/csp.cjs');

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
    const served = net.fetch(pathToFileURL(file).href);
    if (!/\.html?$/i.test(file)) return served;
    /* The same page policies as the app (platforms/electron/csp.cjs). */
    return served.then((res) => {
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', cspFor(file));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    });
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
  /* Programme guide: a real FAST list (its header names an XMLTV guide)
     through the real service. Without internet it is reported, not failed. */
  await check('TV en vivo shows what is on now from the list guide', `(function(){
      var X = window.__opentv;
      var LIST = 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u';
      return new Promise(function (done) {
        X.service('fetchM3u', { url: LIST }, function (err, payload) {
          var chs = payload && payload.channels ? payload.channels.slice(0, 40) : [];
          if (err || !chs.length) { return done({ ok: true, detail: 'sin red: ' + (err || 'lista vacía') }); }
          X.live.use(chs);
          var tries = 0;
          (function wait() {
            var withProg = X.live.channels().filter(function (c) { return c.now && c.now !== 'En vivo'; });
            if (!withProg.length && ++tries < 60) { return setTimeout(wait, 500); }
            document.querySelector('.live-dock-btn.is-guide').click();
            var progs = document.querySelectorAll('.live-guide .lg-card .lg-prog').length;
            var under = (document.querySelector('.live-under-prog') || {}).textContent || '';
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            var c0 = withProg[0];
            /* (The channel under the video may be one kept playing from before, without a guide.) */
            var sel = X.channels[X.state.channel];
            var underOk = !(sel && sel.now && sel.now !== 'En vivo') || /Ahora:/.test(under);
            done({ ok: withProg.length > 0 && progs > 0 && underOk,
              detail: withProg.length + '/' + chs.length + ' con programa · tarjetas ' + progs + (c0 ? ' · ' + c0.name + ': ' + c0.now + ' ' + c0.time : '') });
          })();
        }, 30000);
      });
    })()`, 300);
  await check('TV en vivo without lists says how to add one', `(function(){
      window.__opentv.live.use([]);
      var s = document.querySelector('.live-list .live-list-status');
      var text = s ? s.textContent : '';
      var ok = /Ajustes → Plugins/.test(text) && !!(s && s.querySelector('.live-add-lists'));
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
  /* Series: picking an episode looks its sources up first; Reproducir is
     off meanwhile and comes on once they are in. From an episode, up goes
     back to the button row (not to "Leer más"). */
  await check('series: an episode is picked, its sources load, then Reproducir', `(function(){
      var X = window.__opentv;
      var show = X.currentVod().filter(function (it) { return /^Serie Prueba/.test(it.title || it.name || ''); })[0];
      if (!show) { return { ok: false, detail: 'sin serie en el catálogo' }; }
      X.openItem(show);
      return new Promise(function (done) {
        var tries = 0;
        (function waitEpisodes() {
          var eps = document.querySelectorAll('#screen-detail .detail-episode');
          if (eps.length < 2 && tries++ < 30) { setTimeout(waitEpisodes, 200); return; }
          if (eps.length < 2) { done({ ok: false, detail: 'sin capítulos' }); return; }
          function btn(kind) { return document.querySelector('#screen-detail .detail-btn[data-kind="' + kind + '"]'); }
          X.focus(eps[1]);
          eps[1]._activate();
          var play = btn('fullscreen');
          var source = btn('source');
          var waiting = play.getAttribute('aria-disabled') === 'true' && (!source || source.getAttribute('aria-disabled') === 'true');
          var label = play.textContent;
          var t = 0;
          (function waitReady() {
            play = btn('fullscreen');
            /* The result is told in a toast (screens/detail.js). */
            var status = document.querySelector('.ot-toast.is-on .ot-toast-text');
            var ready = play.getAttribute('aria-disabled') !== 'true' && status && /lista/.test(status.textContent);
            if (!ready && t++ < 40) { setTimeout(waitReady, 150); return; }
            X.focus(play);
            X.key(40);
            var below = X.state.focus;
            X.key(38);
            var back = X.state.focus === play;
            done({ ok: waiting && ready && /E2/.test(label) && back,
              detail: label + ' · ' + (waiting ? 'apagado mientras busca' : 'no se apagó') + ' → ' + (status ? status.textContent : '?') +
                ' · abajo ' + (below && below.className) + ' · arriba ' + (back ? 'vuelve a Reproducir' : (X.state.focus && X.state.focus.className)) });
          })();
        })();
      });
    })()`, 600);
  /* The app's own page may not compile code (no 'unsafe-eval'): third-party
     code only ever runs in the plugins' sandbox. */
  await check('the app page cannot compile code (CSP)', `(function(){
      try { new Function('return 1')(); return { ok: false, detail: 'new Function funcionó' }; }
      catch (e) { return { ok: true, detail: String(e && e.name) }; }
    })()`, 0);
  /* JS plugins run apart (ui/plugin-sandbox.html, under the app's real
     page policies): no app storage, window, bridge or network of their own,
     no OpenTV loopback through the app either; kino still works. */
  await check('JS plugins run isolated in the sandbox, kino still works', `(function(){
      var X = window.__opentv;
      var ad = { kind: 'jsplugin', pluginId: 'prueba', name: 'Prueba JS', url: 'https://plugins.example/p/kino-plugin.json',
        baseUrl: 'https://plugins.example/p', entryFile: 'plugin.js', resources: [], catalogs: [], types: ['movie'] };
      var cfg = JSON.parse(localStorage.getItem('opentv_vod_sources_v1') || '{"mode":"external","addons":[]}');
      cfg.addons.push(ad);
      localStorage.setItem('opentv_vod_sources_v1', JSON.stringify(cfg));
      var code = [
        'export async function home() {',
        '  var r = {};',
        '  try { localStorage.getItem("opentv_vod_sources_v1"); r.ls = "open"; } catch (e) { r.ls = "blocked"; }',
        '  try { r.parent = String(window.parent.document.title); } catch (e) { r.parent = "blocked"; }',
        '  r.desktop = typeof window.desktop;',
        '  try { await fetch("https://example.com/"); r.net = "open"; } catch (e) { r.net = "blocked"; }',
        '  var loop = await kino.fetch("http://127.0.0.1:9/x");',
        '  r.loop = loop.ok ? "open" : "refused";',
        '  kino.storage.set("k", "v1");',
        '  r.store = kino.storage.get("k");',
        '  r.hash = kino.crypto.hash("sha256", "abc");',
        '  return { sections: [{ title: "T", items: [{ id: "a1", title: JSON.stringify(r) }] }] };',
        '}'
      ].join(String.fromCharCode(10));
      return new Promise(function (done) {
        X.jsPluginLoadCode(ad, code, function (err, inst) {
          if (err || !inst || typeof inst.home !== 'function') { return done({ ok: false, detail: 'no cargó: ' + err }); }
          inst.home().then(function (res) {
            var r = JSON.parse(res.sections[0].items[0].title);
            setTimeout(function () {
              var saved = localStorage.getItem('opentv_jsp_prueba_k');
              var ok = r.ls === 'blocked' && r.parent === 'blocked' && r.desktop === 'undefined' && r.net === 'blocked' &&
                r.loop === 'refused' && r.store === 'v1' && saved === 'v1' &&
                r.hash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
              done({ ok: ok, detail: JSON.stringify(r) + ' · guardado en la app: ' + saved });
            }, 300);
          }, function (e) { done({ ok: false, detail: 'home falló: ' + (e && e.message) }); });
        });
      });
    })()`, 600);
  await check('Plugins page: Mis plugins shows addons and TV lists as cards', `(function(){
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('sources'));
      var title = document.querySelector('.sd-sources .sd-title').textContent;
      var tabs = Array.prototype.map.call(document.querySelectorAll('.sd-sources .sd-tab'), function (n) { return n.textContent; });
      var kinds = Array.prototype.map.call(document.querySelectorAll('.sd-sources .pl-card .pl-meta'), function (n) { return n.textContent.split(' · ')[0]; });
      var add = !!document.querySelector('.sd-sources .pl-add-btn');
      return { ok: title === 'Plugins' && tabs.join('|') === 'Mis plugins|Comunidad' && add &&
        kinds.indexOf('Películas y series') !== -1 && kinds.indexOf('TV en vivo') !== -1,
        detail: title + ' · ' + tabs.join(', ') + ' · ' + kinds.length + ' tarjetas' };
    })()`, 600);
  await check('Plugins: Agregar plugin window; a card turns on Configurar and Eliminar', `(function(){
      var X = window.__opentv;
      function cur() { return X.state.focus; }
      function text(n) { return n ? (n.getAttribute('aria-label') || n.textContent) : ''; }
      function cardWith(test) {
        return Array.prototype.filter.call(document.querySelectorAll('.sd-sources .pl-card'), test)[0];
      }
      /* (Back ignores a second press within 250 ms: the steps wait.) */
      var steps = [], r = {};
      function step(fn) { steps.push(fn); }
      step(function () {
        document.querySelector('.sd-sources .pl-add-btn')._activate();
        r.addOpen = !!document.querySelector('.pl-modal .pl-field');
        X.key(27);
        r.addClosed = !document.querySelector('.pl-modal');
      });
      /* A built-in plugin: fixed in its own section (cannot be opened, configured or turned off). */
      step(function () {
        r.fixed = cardWith(function (c) { return c.classList.contains('is-builtin'); });
        X.focus(r.fixed);
        X.key(13);
        r.fixedLocked = !!r.fixed && !r.fixed.classList.contains('is-open') && r.fixed.querySelectorAll('.pl-btn').length === 1;
        /* A user plugin card: Configurar, En uso and Eliminar open; Back closes. */
        var userCard = cardWith(function (c) { return !c.classList.contains('is-builtin'); });
        X.focus(userCard);
        X.key(13);
        r.onCfg = text(cur()) === 'Configurar' && userCard.classList.contains('is-open');
        X.key(27);
        r.closed = cur() === userCard && !userCard.classList.contains('is-open');
        X.key(13);
        X.key(39);
        r.onUse = /En uso/.test(text(cur()));
        X.key(39);
        X.key(39);
        r.moves = !userCard.classList.contains('is-open');
      });
      /* A TV list: Eliminar asks in a window (focus on Cancelar, which
         keeps it). Configurar opens that list's own window (name, channels). */
      step(function () {
        var list = cardWith(function (c) { return /^TV en vivo/.test(c.querySelector('.pl-meta').textContent); });
        X.focus(list);
        X.key(13);
        X.key(39);
        X.key(39);
        r.onDel = /Eliminar/.test(text(cur()));
        X.key(13);
        r.confirm = !!document.querySelector('.pl-modal.is-confirm') && text(cur()) === 'Cancelar';
        X.key(13);
        r.kept = !document.querySelector('.pl-modal') && list.isConnected;
        X.key(38);
        r.reset = cur() === list && !list.classList.contains('is-open');
        X.key(13);
        X.key(13);
        r.cfg = Array.prototype.map.call(document.querySelectorAll('.pl-modal .pl-msec-title'), function (n) { return n.textContent; }).join('|');
        X.key(27);
      });
      return new Promise(function (done) {
        var i = 0;
        (function next() {
          if (i < steps.length) { steps[i++](); setTimeout(next, 320); return; }
          var ok = r.addOpen && r.addClosed && r.fixedLocked && r.onCfg && r.closed && r.onUse && r.moves && r.onDel && r.confirm && r.kept && r.reset &&
            r.cfg === 'Nombre|Canales' && !document.querySelector('.pl-modal');
          delete r.fixed;
          done({ ok: ok, detail: JSON.stringify(r) });
        })();
      });
    })()`, 600);
  await check('Comunidad: cards, search and category filter', `(function(){
      document.querySelectorAll('.sd-sources .sd-tab')[1]._activate();
      function names() { return Array.prototype.map.call(document.querySelectorAll('.sd-sources .pl-card .pl-name'), function (n) { return n.textContent; }); }
      var all = names();
      var sections = Array.prototype.map.call(document.querySelectorAll('.sd-sources .pl-section-title'), function (n) { return n.textContent; });
      var input = document.querySelector('.sd-sources .pl-search-input');
      input.value = 'pluto';
      input.dispatchEvent(new Event('input'));
      var found = names();
      input.value = '';
      input.dispatchEvent(new Event('input'));
      document.querySelector('.sd-sources .pl-select')._activate();
      var sports = null;
      Array.prototype.forEach.call(document.querySelectorAll('.pl-modal .pl-opt'), function (o) {
        if (/^Deportes/.test(o.querySelector('.pl-opt-label').textContent)) { sports = o; }
      });
      sports._activate();
      var metas = Array.prototype.map.call(document.querySelectorAll('.sd-sources .pl-card .pl-meta'), function (n) { return n.textContent; });
      var value = document.querySelector('.sd-sources .pl-select-value').textContent;
      document.querySelector('.sd-sources .pl-select')._activate();
      document.querySelector('.pl-modal .pl-opt')._activate();
      document.querySelectorAll('.sd-sources .sd-tab')[0]._activate();
      var pluto = found.length > 0 && found.every(function (n) { return /Pluto/.test(n); });
      var cat = metas.length > 0 && metas.every(function (m) { return / · Deportes/.test(m); });
      return { ok: sections[0] === 'Recomendados para PC' && all.indexOf('FrameXTV +') !== -1 && all.indexOf('FrameXTV') === -1 && all.indexOf('Torrentio') !== -1 && all.indexOf('DeepFlix') !== -1 && all.length > 20 && pluto && cat && /^Deportes/.test(value),
        detail: all.length + ' tarjetas · secciones: ' + sections.length + ' · "pluto": ' + found.length + ' · Deportes: ' + metas.length };
    })()`, 600);
  await check('Ajustes has Apariencia and Reproducción (source preferences live in Plugins)', `(function(){
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('playback'));
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.sd-hub .sd-tab'));
      var names = tabs.map(function (t) { return t.textContent; });
      var seen = [];
      tabs.forEach(function (t) {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        var first = document.querySelector('.sd-hub .sd-tab-body .set-row-name span');
        seen.push(first ? first.textContent : '');
      });
      return { ok: names.join('|') === 'Apariencia|Reproducción' &&
        seen.join('|') === 'Color de acento|Formato de pantalla', detail: names.join(', ') + ' → ' + seen.join(', ') };
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
  await check('TV Comunidad shows only the essentials', `(function(){
      window.__opentv.skipWelcome();
      window.__opentv.settingsPanel(window.__opentv.settingsIndexOf('sources'));
      return new Promise(function (done) { setTimeout(function () {
        document.querySelectorAll('.sd-sources .sd-tab')[1]._activate();
        var sec0 = document.querySelector('.sd-sources .pl-section-title');
        var names = Array.prototype.map.call(document.querySelectorAll('.sd-sources .pl-card .pl-name'), function (n) { return n.textContent; });
        var uniq = [];
        names.forEach(function (n) { if (uniq.indexOf(n) === -1) { uniq.push(n); } });
        done({ ok: sec0 && sec0.textContent === 'Recomendados para tu TV' && uniq.length > 0 && uniq.length <= 24 && uniq.indexOf('FrameXTV +') !== -1 && uniq.indexOf('FrameXTV') === -1 && uniq.indexOf('Torrentio') !== -1 && uniq.indexOf('DeepFlix') !== -1, detail: uniq.length + ' únicos: ' + uniq.slice(0, 6).join(', ') });
      }, 800); });
    })()`, 2500);
  /* With the remote: tabs → search → cards → across → back up; a card of
     Mis plugins turns its buttons on and Back turns them off. */
  await check('TV remote moves through the plugin cards', `(function(){
      var X = window.__opentv;
      function cur() { return X.state.focus; }
      var tabs = document.querySelectorAll('.sd-sources .sd-tab');
      X.focus(tabs[0]);
      X.key(39);
      var toTab = cur() === document.querySelectorAll('.sd-sources .sd-tab')[1];
      X.key(13);
      X.key(40);
      var onSearch = !!cur() && (cur().classList.contains('pl-search-input') || cur().classList.contains('pl-select'));
      X.key(40);
      var first = cur();
      var onCard = !!first && first.classList.contains('pl-card');
      X.key(39);
      var moved = cur() !== first && cur().classList.contains('pl-card');
      X.key(38); X.key(38);
      var backUp = !!cur() && (cur().classList.contains('sd-tab') || cur().classList.contains('pl-add-btn'));
      document.querySelectorAll('.sd-sources .sd-tab')[0]._activate();
      var card = document.querySelector('.sd-sources .pl-card:not(.is-builtin)');
      X.focus(card);
      X.key(13);
      var buttons = !!cur() && cur().classList.contains('pl-btn') && card.classList.contains('is-open');
      X.key(27);
      var back = cur() === card && !card.classList.contains('is-open') && X.state.screen === 'settings';
      return { ok: toTab && onSearch && onCard && moved && backUp && buttons && back,
        detail: JSON.stringify({ toTab: toTab, onSearch: onSearch, onCard: onCard, moved: moved, backUp: backUp, buttons: buttons, back: back }) };
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
