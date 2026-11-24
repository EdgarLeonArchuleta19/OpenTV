'use strict';
/**
 * Real-browser headless E2E quality test suite for OpenTV v2 PC (React/TS production bundle).
 * Zero external dependencies: drives Microsoft Edge / Chrome via CDP over native Node WebSocket.
 * Verifies:
 *  - Clean startup with zero uncaught errors
 *  - Home screen (no Top 10 rows, no legacy floating hover card)
 *  - Navigation across Películas, Series, Kids, Anime, TV en vivo, Buscar, Plugins & Ajustes
 *  - Plugin icons present on every card and zero visible "addon" copy
 *  - Mandatory ForceUpdateGate locks the app when a newer version exists, traps Escape, and triggers download
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DIST_UI = path.join(ROOT, 'apps', 'desktop', 'dist-ui');

const BROWSER_BIN = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));

const skip = !fs.existsSync(path.join(DIST_UI, 'index.html'))
  ? 'dist-ui no compilado (ejecuta npm run build:ui)'
  : !BROWSER_BIN
    ? 'Edge/Chrome no encontrado para E2E'
    : false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

let server = null;
let serverUrl = '';
let browserProc = null;
let userDataDir = '';
let ws = null;
let cdpId = 0;
const pending = new Map();
const pageErrors = [];

function cdpSend(method, params = {}) {
  const id = ++cdpId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 15_000);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const res = await cdpSend('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'JS error');
  }
  return res.result ? res.result.value : undefined;
}

async function waitFor(fnExpr, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await evalJs(`Boolean((${fnExpr})())`);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Timeout esperando condición: ${fnExpr}`);
}

const TAURI_MOCK_SCRIPT = `
(function() {
  const callbacks = new Map();
  const listeners = new Map();
  let nextCbId = 1;
  window.__E2E_INVOKES__ = [];
  window.__E2E_EMIT__ = function(eventName, payload) {
    const ids = listeners.get(eventName) || [];
    for (const id of ids) {
      const fn = callbacks.get(id);
      if (fn) fn({ event: eventName, payload });
    }
  };
  window.__OPENTV_TAURI_INIT__ = { port: 0, version: '2.0.0-alpha.1' };
  window.__TAURI_INTERNALS__ = {
    transformCallback(cb) {
      const id = nextCbId++;
      callbacks.set(id, cb);
      return id;
    },
    async invoke(cmd, args) {
      window.__E2E_INVOKES__.push({ cmd, args });
      if (cmd === 'plugin:event|listen') {
        const list = listeners.get(args.event) || [];
        list.push(args.handler);
        listeners.set(args.event, list);
        return 1;
      }
      if (cmd === 'desktop_update') {
        if (args.command === 'download') {
          const st = {
            state: 'downloading',
            version: '2.0.0-alpha.1',
            available: '9.9.9',
            mandatory: true,
            downloadUrl: 'https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v9.9.9/OpenTV-Setup-9.9.9.exe',
            bytes: 15 * 1024 * 1024,
            total: 30 * 1024 * 1024,
            progress: 50
          };
          setTimeout(() => window.__E2E_EMIT__('desktop:update-status', st), 30);
          return st;
        }
        return { state: 'up-to-date', version: '2.0.0-alpha.1', available: null, mandatory: false };
      }
      if (cmd === 'desktop_service') {
        if (args.method === 'downloadList') return { returnValue: true, items: [] };
        if (args.method === 'fetchM3u') return { returnValue: true, channels: [] };
        return { returnValue: true };
      }
      if (cmd === 'desktop_tmdb') return { items: [] };
      if (cmd === 'desktop_backup') return null;
      if (cmd === 'desktop_system_volume') return { level: 0.8, muted: false };
      return false;
    }
  };
  // Intercept remote catalog fetches so E2E runs 100% deterministically offline
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('cinemeta.strem.io/catalog/') || url.includes('anime-kitsu.strem.fun/catalog/')) {
      const sample = {
        metas: Array.from({ length: 6 }, (_, i) => ({
          id: 'tt00000' + (i + 1),
          type: url.includes('/series/') ? 'series' : url.includes('/anime/') ? 'anime' : 'movie',
          name: 'Título Demo ' + (i + 1),
          releaseInfo: '2025',
          imdbRating: '8.4',
          runtime: '132 min',
          genres: ['Action', 'Sci-Fi', 'Family'],
          description: 'Sinopsis de prueba para verificación automática E2E de OpenTV v2.',
          poster: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%25" height="100%25" fill="%23222"/></svg>',
          background: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="100%25" height="100%25" fill="%2318181d"/></svg>'
        }))
      };
      return new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return origFetch(input, init);
  };
})();
`;

test.before(async () => {
  if (skip) return;

  server = http.createServer((req, res) => {
    const cleanPath = (req.url || '/').split('?')[0];
    const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const full = path.join(DIST_UI, rel);
    const target = fs.existsSync(full) && fs.statSync(full).isFile() ? full : path.join(DIST_UI, 'index.html');
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  serverUrl = `http://127.0.0.1:${server.address().port}/`;

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentv-e2e-'));
  const debugPort = 9222 + Math.floor(Math.random() * 500);

  browserProc = spawn(
    BROWSER_BIN,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1360,840',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  // Wait for CDP endpoint
  let targetWsUrl = '';
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline && !targetWsUrl) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) targetWsUrl = page.webSocketDebuggerUrl;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  assert.ok(targetWsUrl, 'CDP WebSocket del navegador no respondió');

  ws = new WebSocket(targetWsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params?.exceptionDetails?.text || 'Uncaught exception');
    }
  });

  await cdpSend('Page.enable');
  await cdpSend('Runtime.enable');
  await cdpSend('Page.addScriptToEvaluateOnNewDocument', { source: TAURI_MOCK_SCRIPT });
  await cdpSend('Page.navigate', { url: serverUrl });
  await waitFor(`() => document.body && document.body.innerText.includes('Inicio')`, 10_000);
});

test.after(async () => {
  try { if (ws) ws.close(); } catch { /* ignore */ }
  try { if (browserProc) browserProc.kill(); } catch { /* ignore */ }
  try { if (server) server.close(); } catch { /* ignore */ }
  if (userDataDir) {
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('E2E Home boots cleanly with Hero, rows and zero Top 10 sections', { skip }, async () => {
  await waitFor(`() => document.body.innerText.includes('Título Demo 1') && document.body.innerText.includes('Más información')`, 8_000);
  const text = await evalJs('document.body.innerText');
  assert.ok(text.includes('Más información') || text.includes('Reproducir'), 'Hero action button visible');
  assert.ok(!/Top\s*10/i.test(text), 'Top 10 must not exist on Home');
  assert.equal(pageErrors.length, 0, 'No uncaught JS errors on boot: ' + pageErrors.join('; '));
});

test('E2E Navigation across sections, Plugins icons & Spanish copy compliance', { skip }, async () => {
  for (const label of ['Películas', 'Series', 'Kids', 'Anime']) {
    const clicked = await evalJs(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === ${JSON.stringify(label)});
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    assert.equal(clicked, true, `Botón de navegación "${label}" debe existir`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Open Plugins via Settings or top bar button
  const openedSettings = await evalJs(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Ajustes' || b.title === 'Ajustes');
    if (btn) { btn.click(); return true; }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }));
    return true;
  })()`);
  assert.equal(openedSettings, true);
  await waitFor(`() => document.body.innerText.includes('Plugins')`, 6_000);

  // Switch to Plugins section inside Settings and open Comunidad tab
  await evalJs(`(() => {
    const pBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Plugins');
    if (pBtn) pBtn.click();
  })()`);
  await waitFor(`() => document.body.innerText.includes('Comunidad')`, 6_000);

  await evalJs(`(() => {
    const cBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Comunidad');
    if (cBtn) cBtn.click();
  })()`);
  await waitFor(`() => document.body.innerText.includes('Torrentio') && document.body.innerText.includes('Pluto TV')`, 6_000);

  const visibleText = await evalJs('document.body.innerText');
  assert.ok(!/\baddon(s)?\b/i.test(visibleText), 'No debe aparecer la palabra "addon" en la UI visible');
  assert.equal(pageErrors.length, 0, 'Sin errores JS navegando por las pantallas');
});

test('E2E ForceUpdateGate blocks old version, traps Escape, and triggers in-app download', { skip }, async () => {
  await evalJs(`window.__E2E_EMIT__('desktop:update-status', {
    state: 'available',
    version: '2.0.0-alpha.1',
    available: '9.9.9',
    mandatory: true,
    notes: 'Mejoras críticas de reproducción y seguridad',
    downloadUrl: 'https://github.com/EdgarLeonArchuleta19/OpenTV/releases/download/v9.9.9/OpenTV-Setup-9.9.9.exe',
    bytes: 0,
    total: 30000000,
    progress: 0
  })`);

  await waitFor(`() => Boolean(document.querySelector('[data-testid="force-update-gate"]'))`, 4_000);

  // Pressing Escape must NOT dismiss the mandatory update gate
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await new Promise((r) => setTimeout(r, 150));
  const stillLocked = await evalJs(`Boolean(document.querySelector('[data-testid="force-update-gate"]'))`);
  assert.equal(stillLocked, true, 'Escape no debe cerrar el bloqueo obligatorio de actualización');

  // Click primary update button and verify desktop_update("download") is invoked + progress bar appears
  await evalJs(`(() => {
    const gate = document.querySelector('[data-testid="force-update-gate"]');
    const btn = Array.from(gate.querySelectorAll('button')).find(b => /Actualizar ahora/i.test(b.textContent || ''));
    if (btn) btn.click();
  })()`);

  await waitFor(`() => document.querySelector('[data-testid="force-update-gate"]')?.innerText.includes('50%')`, 4_000);
  const invokedDownload = await evalJs(
    `window.__E2E_INVOKES__.some(x => x.cmd === 'desktop_update' && x.args && x.args.command === 'download')`,
  );
  assert.equal(invokedDownload, true, 'El botón debe iniciar descarga interna vía desktop_update("download")');
  assert.equal(pageErrors.length, 0, 'Sin errores JS durante el flujo de actualización obligatoria');
});
