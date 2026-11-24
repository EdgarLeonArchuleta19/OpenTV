'use strict';
/* The Rust service over HTTP, the way the app reaches it: the contract the
   desktop app (Tauri `desktop_service`, apps/desktop/src-tauri/src/commands.rs)
   and Android (RustServiceBridge.kt) rely on. Offline: lists and guides come
   from a small server on the LAN address (NetGuard refuses 127.0.0.1). Skipped when the binary is not built
   (`npm run build:service`). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const EXE = process.platform === 'win32' ? 'opentv-service.exe' : 'opentv-service';
const BINARY = [
  path.join(ROOT, 'bin', EXE),
  path.join(ROOT, 'core', 'target', 'release', EXE),
  path.join(ROOT, 'core', 'target', 'debug', EXE)
].find((p) => fs.existsSync(p));
const TOKEN = 'test-token-0123456789abcdef';
const skip = BINARY ? false : 'opentv-service no está compilado (npm run build:service)';

let service = null;
let port = 0;
let fixtures = null;
let fixturesPort = 0;
// NetGuard always refuses this device (127.0.0.1), so the fixtures are served on the
// machine's LAN address and the calls pass allowLan, like a home-network playlist.
const FIXTURE_HOST = (() => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(a.address)) return a.address;
    }
  }
  return '';
})();
const lanSkip = FIXTURE_HOST ? false : 'sin dirección de red local para los fixtures';
const fx = (p) => 'http://' + FIXTURE_HOST + ':' + fixturesPort + p;
let tmp = '';

function request(pathname, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: opts.port || port,
      path: pathname,
      method: opts.method || 'GET',
      headers: opts.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

/* What Electron does: POST JSON with the session token. */
function call(method, params) {
  return request('/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OpenTV-Token': TOKEN },
    body: params || {}
  });
}

function xmltvTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + ' +0000';
}

test.before(async () => {
  if (skip) return;
  const now = Date.now();
  const guide = '<?xml version="1.0"?><tv>' +
    '<channel id="ch1"><display-name>Uno</display-name></channel>' +
    '<programme start="' + xmltvTime(now - 30 * 60000) + '" stop="' + xmltvTime(now + 30 * 60000) + '" channel="ch1"><title>Noticias</title></programme>' +
    '<programme start="' + xmltvTime(now + 30 * 60000) + '" stop="' + xmltvTime(now + 90 * 60000) + '" channel="ch1"><title>Deportes</title></programme>' +
    '</tv>';
  fixtures = http.createServer((req, res) => {
    if (req.url === '/list.m3u') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      res.end('#EXTM3U url-tvg="' + fx('/guide.xml') + '"\n' +
        '#EXTINF:-1 tvg-id="ch1" tvg-logo="http://img.example/1.png" group-title="Noticias",Canal Uno\n' +
        'http://stream.example/uno.m3u8\n' +
        '#EXTINF:-1 group-title="Deportes",Canal Dos\n' +
        'http://stream.example/dos.m3u8\n');
      return;
    }
    if (req.url === '/guide.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(guide);
      return;
    }
    if (req.url === '/hls/master.m3u8' || req.url === '/hls/obfuscated.txt') {
      if (req.headers.referer !== 'https://plugin.example/') {
        res.writeHead(403); res.end('missing referer'); return;
      }
      const ct = req.url.endsWith('.txt') ? 'text/plain' : 'application/vnd.apple.mpegurl';
      res.writeHead(200, { 'Content-Type': ct });
      res.end('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=NONE,URI="key.bin"\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n');
      return;
    }
    if (req.url === '/hls/seg0.ts') {
      if (req.headers.referer !== 'https://plugin.example/') {
        res.writeHead(403); res.end('missing referer'); return;
      }
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      res.end('TS-SEGMENT-BYTES-OK');
      return;
    }
    if (req.url === '/video.mp4') {
      const payload = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': payload.length });
      res.end(payload);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('secreto-de-la-red-local');
  });
  await new Promise((r) => fixtures.listen(0, FIXTURE_HOST || '127.0.0.1', r));
  fixturesPort = fixtures.address().port;

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opentv-rs-test-'));
  service = spawn(BINARY, ['--port', '0', '--token', TOKEN,
    '--cache-dir', path.join(tmp, 'cache'), '--downloads-dir', path.join(tmp, 'dl')], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('el servicio no arrancó')), 15000);
    service.stdout.on('data', (d) => {
      buf += d.toString();
      const m = /OPENTV_READY port=(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    service.on('exit', (code) => { clearTimeout(timer); reject(new Error('el servicio terminó: ' + code)); });
  });
});

test.after(async () => {
  if (service) {
    service.removeAllListeners('exit');
    service.stdin.end();
    service.kill();
  }
  if (fixtures) fixtures.close();
  if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* in use */ } }
});

test('ping answers with the engine, the port and what the device can do', { skip }, async () => {
  const r = await call('ping');
  assert.equal(r.status, 200);
  assert.equal(r.json.returnValue, true);
  assert.equal(r.json.engine, 'rust');
  assert.equal(r.json.proxyPort, port);
  assert.equal(typeof r.json.torrents, 'boolean');
  assert.equal(typeof r.json.downloads, 'boolean');
  assert.ok(r.json.storage && typeof r.json.storage.free === 'number');
});

test('without the session token no method runs (header or __token)', { skip }, async () => {
  const none = await request('/ping');
  assert.equal(none.status, 401);
  assert.equal(none.json.returnValue, false);
  const wrong = await request('/ping', { headers: { 'X-OpenTV-Token': 'otro' } });
  assert.equal(wrong.status, 401);
  /* Android's page sends it in the address (no CORS preflight). */
  const query = await request('/ping?__token=' + TOKEN);
  assert.equal(query.status, 200);
  assert.equal(query.json.returnValue, true);
});

test('a website open in a browser cannot reach any route; the app pages can', { skip }, async () => {
  const evil = { Origin: 'https://sitio-malo.example', 'X-OpenTV-Token': TOKEN };
  for (const p of ['/ping', '/img?w=100&u=https%3A%2F%2Fimg.example%2Fa.png', '/media/abort', '/mpv/events']) {
    const r = await request(p, { headers: evil });
    assert.equal(r.status, 403, p);
  }
  /* The JS plugin sandbox iframe has the opaque origin "null". */
  const sandbox = await request('/ping', { headers: { Origin: 'null', 'X-OpenTV-Token': TOKEN } });
  assert.equal(sandbox.status, 403);
  for (const origin of ['opentv://app', 'http://localhost']) {
    const r = await request('/ping', { headers: { Origin: origin, 'X-OpenTV-Token': TOKEN } });
    assert.equal(r.status, 200, origin);
    assert.equal(r.headers['access-control-allow-origin'], origin);
  }
  const pre = await request('/ping', {
    method: 'OPTIONS',
    headers: { Origin: 'opentv://app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-opentv-token' }
  });
  assert.ok(pre.status < 300);
  assert.equal(pre.headers['access-control-allow-origin'], 'opentv://app');
});

test('netguardCheck: never this device, the home network only when allowed', { skip }, async () => {
  const loop = await call('netguardCheck', { host: '127.0.0.1' });
  assert.equal(loop.json.allowed, false);
  const lan = await call('netguardCheck', { host: '192.168.1.10' });
  assert.equal(lan.json.allowed, false);
  const lanOk = await call('netguardCheck', { host: '192.168.1.10', allowLan: true });
  assert.equal(lanOk.json.allowed, true);
  const pub = await call('netguardCheck', { host: '1.1.1.1' });
  assert.equal(pub.json.allowed, true);
});

test('pluginFetch refuses this device: a plugin never reads local servers', { skip }, async () => {
  const r = await call('pluginFetch', { url: 'http://127.0.0.1:' + fixturesPort + '/' });
  assert.equal(r.json.ok, false);
  assert.ok(r.json.error);
  assert.doesNotMatch(r.text, /secreto-de-la-red-local/);
});

test('fetchM3u gives the channels with the fields TV en vivo reads', { skip: skip || lanSkip }, async () => {
  const r = await call('fetchM3u', { url: fx('/list.m3u'), allowLan: true });
  assert.equal(r.json.returnValue, true, r.text);
  const ch = r.json.channels;
  assert.equal(ch.length, 2);
  assert.equal(ch[0].name, 'Canal Uno');
  assert.equal(ch[0].group, 'Noticias');
  assert.equal(ch[0].tvgId, 'ch1');
  assert.equal(ch[0].logo, 'http://img.example/1.png');
  assert.equal(ch[0].streamUrl, 'http://stream.example/uno.m3u8');
  assert.equal(ch[0].epg, fx('/guide.xml'));
  assert.equal(ch[1].group, 'Deportes');
});

test('epg and epgSchedule give now / next for the asked channels', { skip: skip || lanSkip }, async () => {
  const url = fx('/guide.xml');
  const r = await call('epg', { url, ids: ['ch1', 'nada'], allowLan: true });
  assert.equal(r.json.returnValue, true, r.text);
  const list = r.json.programmes.ch1;
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.equal(list[0].t, 'Noticias');
  assert.ok(list[0].s <= Date.now() && list[0].e > Date.now());
  const s = await call('epgSchedule', { url, id: 'ch1', allowLan: true });
  assert.equal(s.json.returnValue, true, s.text);
  assert.deepEqual(s.json.programmes.map((p) => p.t), ['Noticias', 'Deportes']);
});

test('the Android page sends arrays and objects as JSON in the address', { skip: skip || lanSkip }, async () => {
  const url = fx('/guide.xml');
  const q = 'url=' + encodeURIComponent(url) + '&ids=' + encodeURIComponent(JSON.stringify(['ch1'])) + '&allowLan=true&__token=' + TOKEN;
  const r = await request('/epg?' + q);
  assert.equal(r.json.returnValue, true, r.text);
  assert.ok(r.json.programmes.ch1.length >= 1);
});

test('an unknown method is an error, not a crash', { skip }, async () => {
  for (const m of ['noExiste', 'mediaDuration', 'netdiag']) {
    const r = await call(m);
    assert.equal(r.status, 200);
    assert.equal(r.json.returnValue, false);
    assert.equal(r.json.errorText, 'Operación no disponible');
  }
  const after = await call('ping');
  assert.equal(after.json.returnValue, true);
});

test('downloadList and torrentStats answer even when nothing is running', { skip }, async () => {
  const d = await call('downloadList');
  assert.equal(d.json.returnValue, true, d.text);
  const t = await call('torrentStats');
  assert.equal(t.json.returnValue, true, t.text);
});

test('resolveExternal proxies HLS with headers, survives abortMedia, rewrites segments to /hls/ and sends a single CORS header', { skip: skip || lanSkip }, async () => {
  // Real playback always calls abortMedia (stopPlayerVideo) before opening a new stream.
  const ab1 = await call('abortMedia');
  assert.equal(ab1.json.returnValue, true);

  const r = await call('resolveExternal', {
    url: fx('/hls/master.m3u8'),
    allowLan: true,
    headers: { Referer: 'https://plugin.example/' }
  });
  assert.equal(r.json.returnValue, true, r.text);
  assert.equal(r.json.isHls, true);
  assert.match(r.json.proxyPath, /^http:\/\/127\.0\.0\.1:\d+\/media\/[a-f0-9]+\/stream\.m3u8$/);

  const m3u8Path = new URL(r.json.proxyPath).pathname;
  const tok = /^\/media\/([a-f0-9]+)\//.exec(m3u8Path)[1];
  // playUrl() also aborts any prior stream while sparing the new token via exceptToken.
  const ab2 = await call('abortMedia', { exceptToken: tok });
  assert.equal(ab2.json.returnValue, true);

  const manifest = await request(m3u8Path, { headers: { Origin: 'opentv://app' } });
  assert.equal(manifest.status, 200);
  // Single clean Access-Control-Allow-Origin (never duplicated "*" + "opentv://app").
  assert.equal(manifest.headers['access-control-allow-origin'], 'opentv://app');
  const lines = manifest.text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^http:\/\/127\.0\.0\.1:\d+\/hls\/[a-f0-9]+\/[A-Za-z0-9_-]+$/);

  // Fetching the rewritten segment forwards the original Referer header cleanly.
  const segPath = new URL(lines[0]).pathname;
  const seg = await request(segPath, { headers: { Origin: 'opentv://app' } });
  assert.equal(seg.status, 200);
  assert.equal(seg.text, 'TS-SEGMENT-BYTES-OK');
  assert.equal(seg.headers['access-control-allow-origin'], 'opentv://app');
});

test('resolveExternal detects obfuscated .txt HLS playlists by #EXTM3U content', { skip: skip || lanSkip }, async () => {
  const r = await call('resolveExternal', {
    url: fx('/hls/obfuscated.txt'),
    allowLan: true,
    headers: { Referer: 'https://plugin.example/' }
  });
  assert.equal(r.json.returnValue, true, r.text);
  assert.equal(r.json.isHls, true);
  assert.match(r.json.proxyPath, /\/stream\.m3u8$/);
  const manifest = await request(new URL(r.json.proxyPath).pathname, { headers: { Origin: 'opentv://app' } });
  assert.equal(manifest.status, 200);
  assert.match(manifest.text, /\/hls\/[a-f0-9]+\//);
});

test('downloadStart + downloadOpen saves a direct video and serves it with Range', { skip: skip || lanSkip }, async () => {
  const start = await call('downloadStart', {
    title: 'Prueba Directa',
    targetId: 'movie:test1',
    url: fx('/video.mp4'),
    allowLan: true,
    filename: 'prueba.mp4'
  });
  assert.equal(start.json.returnValue, true, start.text);
  const id = start.json.id;
  assert.ok(id);

  let item = null;
  for (let i = 0; i < 40; i++) {
    const lst = await call('downloadList');
    item = (lst.json.items || []).find((x) => x.id === id);
    if (item && item.status === 'done') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.ok(item && item.status === 'done', 'download finished');

  const opened = await call('downloadOpen', { id });
  assert.equal(opened.json.returnValue, true, opened.text);
  const dlPath = new URL(opened.json.url).pathname;
  const partial = await request(dlPath, { headers: { Origin: 'opentv://app', Range: 'bytes=0-9' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.text, '0123456789');
  assert.equal(partial.headers['access-control-allow-origin'], 'opentv://app');
});

test('mediaProbe rejects non-http schemes and compatStart/compatStop enforce valid URLs', { skip }, async () => {
  const ping = await call('ping');
  assert.equal(ping.json.returnValue, true);
  assert.equal(typeof ping.json.relayAvailable, 'boolean');

  const badProbe = await call('mediaProbe', { url: 'file:///C:/Windows/win.ini' });
  if (ping.json.relayAvailable) {
    assert.equal(badProbe.json.returnValue, false);
  }

  const badCompat = await call('compatStart', { url: 'file:///C:/Windows/win.ini' });
  assert.equal(badCompat.json.returnValue, false);

  const stop = await call('compatStop');
  assert.equal(stop.json.returnValue, true);
});
