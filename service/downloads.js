/*
 * Downloads for the PC app (Modo Addons): a movie or an episode saved to
 * Videos\OpenTV to watch without internet. Only loaded in the Electron
 * service, like torrents.js.
 *
 *   start({ title, subtitle, targetId, itemId, kind, url, headers, infoHash,
 *           fileIdx, sources, filename, duration })     -> { id }
 *   list()                                               -> { items, dir }
 *   action(id, 'pause' | 'resume' | 'remove' | 'delete')
 *   open(id)                                             -> { url, name }  (loopback)
 *
 * Direct links resume with HTTP Range; HLS is saved with FFmpeg (-c copy);
 * torrents use their own torrent-stream engine with the files under
 * Videos\OpenTV\.partes, moved next to the others when complete. The list
 * survives restarts (.opentv-descargas.json); unfinished ones come back paused.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var https = require('https');
var urlmod = require('url');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var HOST = '127.0.0.1';
var DIR = path.join(os.homedir(), 'Videos', 'OpenTV');
var PARTS = path.join(DIR, '.partes');
var STATE_FILE = path.join(DIR, '.opentv-descargas.json');
var MAX_ACTIVE = 2;
var MAX_ITEMS = 200;
var FFMPEG = process.env.OPENTV_FFMPEG_PATH ||
  (process.platform === 'win32' ? path.join(__dirname, '..', 'bin', 'ffmpeg.exe') : '/usr/bin/ffmpeg');

var items = null;       /* [{ id, title, subtitle, targetId, itemId, kind, … status, bytes, total, speed, error, file }] */
var running = {};       /* id -> { stop(keep) } */
var saveTimer = null;
var server = null, port = 0, serverWaiters = null;
var torrentStream = null;

var VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
var MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', ts: 'video/mp2t', m2ts: 'video/mp2t' };

function lib() {
  if (!torrentStream) { torrentStream = require('torrent-stream'); }
  return torrentStream;
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* exists */ }
}

/* ------------------------------------------------------------ state */
function load() {
  if (items) { return; }
  items = [];
  try {
    var saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (Array.isArray(saved)) {
      items = saved.filter(function (it) { return it && it.id && it.file; }).map(function (it) {
        /* Cut by closing the app: it goes on by itself (a pause made by the
           viewer stays a pause). */
        if (it.status === 'downloading' || it.status === 'queued' || it.resumeOnStart) { it.status = 'queued'; resumeLater = true; }
        delete it.resumeOnStart;
        it.speed = 0;
        if (it.status === 'done' && !exists(it.file)) { it.status = 'missing'; }
        return it;
      });
    }
  } catch (e) { /* first run */ }
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch (e) { return false; }
}

function saveSoon() {
  if (saveTimer) { return; }
  saveTimer = setTimeout(function () { saveTimer = null; saveNow(); }, 1500);
}

function saveNow() {
  if (!items) { return; }
  ensureDir(DIR);
  var keep = items.map(function (it) {
    var copy = {};
    Object.keys(it).forEach(function (k) { if (k !== 'speed' && k !== '_run') { copy[k] = it[k]; } });
    return copy;
  });
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(keep)); } catch (e) { /* disk full or read-only */ }
}

function find(id) {
  load();
  for (var i = 0; i < items.length; i++) { if (items[i].id === id) { return items[i]; } }
  return null;
}

/* "Película (2010)" → a name Windows accepts, unique in the folder. */
function safeName(text) {
  var name = String(text || 'Video').replace(/[<>:"\/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/[. ]+$/, '').slice(0, 120);
  return name || 'Video';
}

function uniqueFile(base, ext) {
  var taken = {};
  items.forEach(function (it) { taken[it.file.toLowerCase()] = true; });
  for (var n = 1; n < 1000; n++) {
    var file = path.join(DIR, base + (n > 1 ? ' (' + n + ')' : '') + ext);
    if (!taken[file.toLowerCase()] && !exists(file) && !exists(file + '.part')) { return file; }
  }
  return path.join(DIR, base + ' ' + Date.now() + ext);
}

function extFrom(text, fallback) {
  var m = /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts)(?:$|[?#])/i.exec(String(text || ''));
  return m ? '.' + m[1].toLowerCase() : fallback;
}

/* ------------------------------------------------------------ API */
function start(p, done) {
  load();
  p = p || {};
  var kind = p.infoHash ? 'torrent' : (/\.m3u8\b/i.test(String(p.url || '')) ? 'hls' : 'direct');
  if (kind === 'torrent' && !/^[0-9a-f]{40}$/i.test(String(p.infoHash))) { return done(new Error('El torrent no es válido')); }
  if (kind !== 'torrent' && !/^https?:\/\//i.test(String(p.url || ''))) { return done(new Error('La fuente no tiene un enlace http(s) válido')); }
  /* The same file already in the list: keep that one. */
  for (var i = 0; i < items.length; i++) {
    var o = items[i];
    if (o.targetId && o.targetId === p.targetId && o.status !== 'error' && o.status !== 'missing') {
      if (o.status === 'paused') { o.status = 'queued'; pump(); }
      return done(null, { id: o.id, existing: true });
    }
  }
  ensureDir(DIR);
  var base = safeName(p.title + (p.subtitle ? ' - ' + p.subtitle : ''));
  var ext = kind === 'hls' ? '.mp4' : extFrom(p.filename || p.url, '.mkv');
  var it = {
    id: crypto.randomBytes(8).toString('hex'),
    title: String(p.title || '').slice(0, 200),
    subtitle: String(p.subtitle || '').slice(0, 200),
    targetId: String(p.targetId || ''),
    itemId: String(p.itemId || ''),
    poster: /^https?:\/\//i.test(String(p.poster || '')) ? String(p.poster) : '',
    kind: kind,
    url: String(p.url || ''),
    headers: (p.headers && typeof p.headers === 'object') ? p.headers : {},
    infoHash: kind === 'torrent' ? String(p.infoHash).toLowerCase() : '',
    fileIdx: p.fileIdx,
    sources: Array.isArray(p.sources) ? p.sources.slice(0, 50) : [],
    duration: Number(p.duration) || 0,
    file: uniqueFile(base, ext),
    status: 'queued', bytes: 0, total: 0, speed: 0, error: '', created: Date.now()
  };
  items.unshift(it);
  while (items.length > MAX_ITEMS) { halt(items.pop(), false); }
  saveSoon();
  pump();
  done(null, { id: it.id });
}

function publicItem(it) {
  return { id: it.id, title: it.title, subtitle: it.subtitle, targetId: it.targetId, itemId: it.itemId, poster: it.poster,
    kind: it.kind, status: it.status, bytes: it.bytes, total: it.total, speed: it.speed || 0, error: it.error,
    fileName: path.basename(it.file), created: it.created };
}

var resumeLater = false;

function list() {
  load();
  if (resumeLater) { resumeLater = false; pump(); }
  return { items: items.map(publicItem), dir: DIR };
}

function action(id, what, done) {
  var it = find(id);
  if (!it) { return done(new Error('Esa descarga ya no existe')); }
  if (what === 'pause') {
    halt(it, true);
    if (it.status === 'downloading' || it.status === 'queued') { it.status = 'paused'; it.speed = 0; }
  } else if (what === 'resume') {
    if (it.status === 'paused' || it.status === 'error') { it.status = 'queued'; it.error = ''; }
  } else if (what === 'remove' || what === 'delete') {
    halt(it, false);
    items.splice(items.indexOf(it), 1);
    /* Unfinished pieces always go; the finished file only when asked. */
    rm(it.file + '.part');
    if (it.infoHash) { rmDir(path.join(PARTS, it.infoHash + '-' + it.id)); }
    if (what === 'delete' || it.status !== 'done') { rm(it.file); }
  } else {
    return done(new Error('Acción desconocida'));
  }
  saveSoon();
  pump();
  done(null, publicItem(it));
}

/* Stops a running download and frees its slot at once: the old request may
   never report back (a destroyed request only closes), and whatever it
   reports later is ignored (once() sees another run). */
function halt(it, keep) {
  var run = running[it.id];
  if (!run) { return; }
  delete running[it.id];
  it._run = null;
  it.speed = 0;
  try { run.stop(keep); } catch (e) { /* already stopped */ }
}

function rm(file) { try { fs.unlinkSync(file); } catch (e) { /* not there */ } }
function rmDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* not there */ } }

/* Start queued downloads while fewer than MAX_ACTIVE run. */
function pump() {
  load();
  var active = Object.keys(running).length;
  for (var i = items.length - 1; i >= 0 && active < MAX_ACTIVE; i--) {
    var it = items[i];
    if (it.status !== 'queued' || running[it.id]) { continue; }
    it.status = 'downloading';
    it.error = '';
    active++;
    (it.kind === 'torrent' ? runTorrent : (it.kind === 'hls' ? runHls : runDirect))(it);
  }
  saveSoon();
}

function finished(it, err) {
  delete running[it.id];
  it.speed = 0;
  if (it.status === 'downloading') {
    if (err) { it.status = 'error'; it.error = String(err.message || err).slice(0, 300); }
    else { it.status = 'done'; it.finished = Date.now(); }
  }
  saveSoon();
  pump();
}

/* A run ends once: a paused request can still fire its error or close
   later, maybe after the same download was resumed by a new run. */
function once(it) {
  var token = {};
  it._run = token;
  var ended = false;
  return function (err) {
    if (ended || it._run !== token) { return; }
    ended = true;
    finished(it, err);
  };
}

/* Bytes per second over the last few seconds. */
function speedMeter(it) {
  var samples = [];
  return function (bytes) {
    var now = Date.now();
    samples.push([now, bytes]);
    while (samples.length > 2 && now - samples[0][0] > 4000) { samples.shift(); }
    var first = samples[0];
    it.speed = now > first[0] ? Math.max(0, Math.round((bytes - first[1]) * 1000 / (now - first[0]))) : 0;
  };
}

/* ------------------------------------------------------------ direct links */
function runDirect(it) {
  var end = once(it);
  var part = it.file + '.part';
  var have = 0;
  try { have = fs.statSync(part).size; } catch (e) { have = 0; }
  var stopped = false, req = null, out = null;
  running[it.id] = { stop: function () { stopped = true; try { if (req) { req.destroy(); } } catch (e) { /* closed */ } } };
  var meter = speedMeter(it);

  function get(url, redirects) {
    var u = urlmod.parse(url);
    var headers = {};
    Object.keys(it.headers || {}).forEach(function (k) { if (!/\r|\n/.test(k + it.headers[k])) { headers[k] = String(it.headers[k]); } });
    if (!headers['User-Agent'] && !headers['user-agent']) { headers['User-Agent'] = 'Mozilla/5.0 OpenTV'; }
    if (have > 0) { headers.Range = 'bytes=' + have + '-'; }
    var mod = u.protocol === 'https:' ? https : http;
    req = mod.get({ protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, headers: headers }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) {
        res.resume();
        return get(urlmod.resolve(url, res.headers.location), redirects + 1);
      }
      if (res.statusCode === 416 && have > 0) {
        /* Already complete. */
        res.resume();
        return complete();
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return end(new Error('El servidor respondió ' + res.statusCode + (res.statusCode === 403 || res.statusCode === 410 ? ': el enlace caducó, vuelve a descargar desde la ficha' : '')));
      }
      if (res.statusCode === 200) { have = 0; }   /* no resume: from the start */
      var range = /\/(\d+)$/.exec(res.headers['content-range'] || '');
      it.total = range ? Number(range[1]) : (have + (Number(res.headers['content-length']) || 0));
      it.bytes = have;
      out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
      res.on('data', function (chunk) { it.bytes += chunk.length; meter(it.bytes); });
      res.on('error', function (e) { if (!stopped) { end(e); } });
      out.on('error', function (e) { stopped = true; try { req.destroy(); } catch (x) { /* closed */ } end(e); });
      out.on('finish', function () {
        if (stopped) { return end(null); }
        if (it.total && it.bytes < it.total) { return end(new Error('La descarga se cortó; reanúdala')); }
        complete();
      });
      res.pipe(out);
    });
    req.on('error', function (e) { if (!stopped) { end(e); } else { end(null); } });
    req.setTimeout(30000, function () { try { req.destroy(new Error('El servidor dejó de responder')); } catch (e) { /* closed */ } });
  }

  function complete() {
    try { fs.renameSync(part, it.file); } catch (e) { return end(e); }
    if (!it.total) { it.total = it.bytes; }
    end(null);
  }

  get(it.url, 0);
}

/* ------------------------------------------------------------ HLS */
function runHls(it) {
  var end = once(it);
  var part = it.file + '.part';
  var args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-y'];
  var lines = [];
  Object.keys(it.headers || {}).forEach(function (k) {
    if (/\r|\n/.test(k + it.headers[k])) { return; }
    if (k.toLowerCase() === 'user-agent') { args.push('-user_agent', String(it.headers[k])); }
    else { lines.push(k + ': ' + it.headers[k] + '\r\n'); }
  });
  if (lines.length) { args.push('-headers', lines.join('')); }
  args.push('-i', it.url, '-map', '0:v:0?', '-map', '0:a?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-f', 'mp4', part);
  var child, stopped = false, log = '';
  try { child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
  catch (e) { return end(e); }
  running[it.id] = { stop: function () { stopped = true; try { child.kill('SIGKILL'); } catch (e) { /* ended */ } } };
  var meter = speedMeter(it);
  child.stderr.on('data', function (d) {
    log = (log + String(d)).slice(-4000);
    var size = /size=\s*(\d+)\s*(KiB|kB)/.exec(String(d));
    if (size) { it.bytes = Number(size[1]) * 1024; meter(it.bytes); }
    var dur = /Duration:\s*(\d+):(\d\d):(\d\d)/.exec(log);
    if (dur && !it.duration) { it.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]); }
    var time = /time=(\d+):(\d\d):(\d\d)/.exec(String(d));
    /* No byte total for HLS: progress is time / duration, shown as bytes. */
    if (time && it.duration) {
      var done = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
      it.total = Math.round(it.bytes * it.duration / Math.max(1, done));
    }
  });
  child.on('error', function (e) { end(e); });
  child.on('close', function (code) {
    /* HLS cannot resume: a paused one starts again. */
    if (stopped) { rm(part); it.bytes = 0; return end(null); }
    if (code !== 0) { rm(part); return end(new Error('FFmpeg no pudo guardar el vídeo: ' + (log.split('\n').filter(Boolean).pop() || code))); }
    try { fs.renameSync(part, it.file); } catch (e) { return end(e); }
    it.total = it.bytes;
    end(null);
  });
}

/* ------------------------------------------------------------ torrents */
function runTorrent(it) {
  var end = once(it);
  var dir = path.join(PARTS, it.infoHash + '-' + it.id);
  ensureDir(dir);
  var engine, file = null, stopped = false, timer = null, meter = speedMeter(it);
  var trackers = ['udp://tracker.opentrackr.org:1337/announce', 'udp://open.demonii.com:1337/announce',
    'udp://open.stealth.si:80/announce', 'udp://tracker.torrent.eu.org:451/announce', 'udp://explodie.org:6969/announce'];
  (it.sources || []).forEach(function (s) {
    var m = /^tracker:(.+)$/i.exec(String(s || ''));
    if (m && trackers.indexOf(m[1]) === -1) { trackers.push(m[1]); }
  });
  try {
    engine = lib()('magnet:?xt=urn:btih:' + it.infoHash, {
      path: dir, tmp: dir, trackers: trackers, connections: 60, uploads: 4, dht: true, verify: true
    });
  } catch (e) { return end(e); }

  function stop(keep, err) {
    if (stopped) { return; }
    stopped = true;
    if (timer) { clearInterval(timer); }
    try { engine.destroy(function () { if (!keep) { rmDir(dir); } end(err || null); }); }
    catch (e) { end(err || null); }
  }
  running[it.id] = { stop: function (keep) { stop(keep); } };

  var readyTimer = setTimeout(function () {
    if (!file) { stop(true, new Error('No se encontraron personas compartiendo este torrent. Prueba más tarde u otra fuente.')); }
  }, 120000);

  engine.on('ready', function () {
    clearTimeout(readyTimer);
    if (stopped) { return; }
    var idx = Number(it.fileIdx);
    file = (it.fileIdx !== undefined && it.fileIdx !== null && it.fileIdx !== '' && engine.files[idx]) ? engine.files[idx] : null;
    if (!file) {
      engine.files.forEach(function (f) { if (VIDEO_EXT.test(f.name) && (!file || f.length > file.length)) { file = f; } });
    }
    if (!file) { return stop(false, new Error('El torrent no tiene ningún vídeo')); }
    /* The torrent's own extension (the addon may not say it). */
    var ext = path.extname(file.name).toLowerCase();
    if (ext && VIDEO_EXT.test(file.name) && path.extname(it.file).toLowerCase() !== ext) {
      it.file = it.file.slice(0, -path.extname(it.file).length) + ext;
    }
    engine.files.forEach(function (f) { if (f !== file) { f.deselect(); } });
    file.select();
    it.total = file.length;
    var pieceLen = engine.torrent.pieceLength;
    var firstPiece = Math.floor(file.offset / pieceLen);
    var lastPiece = Math.floor((file.offset + file.length - 1) / pieceLen);
    timer = setInterval(function () {
      var have = 0;
      for (var p = firstPiece; p <= lastPiece; p++) { if (engine.bitfield.get(p)) { have++; } }
      var total = lastPiece - firstPiece + 1;
      it.bytes = Math.min(file.length, Math.round(file.length * have / total));
      meter(engine.swarm ? engine.swarm.downloaded : it.bytes);
      if (have === total) { done(); }
    }, 1000);
  });
  engine.on('idle', function () { if (file && !stopped) { done(); } });
  engine.on('error', function (e) { stop(true, e); });

  var moving = false;
  function done() {
    if (moving || stopped) { return; }
    moving = true;
    if (timer) { clearInterval(timer); timer = null; }
    var from = path.join(dir, file.path);
    stopped = true;
    engine.destroy(function () {
      try { fs.renameSync(from, it.file); }
      catch (e) {
        /* Another drive: copy instead. */
        try { fs.copyFileSync(from, it.file); } catch (e2) { return end(e2); }
      }
      rmDir(dir);
      it.bytes = it.total;
      end(null);
    });
  }
}

/* ------------------------------------------------------------ playback */
function startServer(done) {
  if (port) { return done(null, port); }
  if (serverWaiters) { serverWaiters.push(done); return; }
  serverWaiters = [done];
  server = http.createServer(serve);
  server.on('error', function (err) {
    var w = serverWaiters || [];
    serverWaiters = null;
    w.forEach(function (cb) { cb(err); });
  });
  server.listen(0, HOST, function () {
    port = server.address().port;
    var w = serverWaiters || [];
    serverWaiters = null;
    w.forEach(function (cb) { cb(null, port); });
  });
}

/* GET /d/<id>/<name>: a finished download with Range support. */
function serve(req, res) {
  if ((req.url || '').indexOf('/media/abort') === 0) { res.writeHead(204); return res.end(); }
  var m = /^\/d\/([0-9a-f]{16})\//.exec(req.url || '');
  var it = m && find(m[1]);
  if (!it || it.status !== 'done' || !exists(it.file)) { res.writeHead(404); return res.end(); }
  var total = fs.statSync(it.file).size;
  var ext = path.extname(it.file).slice(1).toLowerCase();
  var headers = { 'Accept-Ranges': 'bytes', 'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  var start = 0, end = total - 1, status = 200;
  var range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    if (range[1] === '' && range[2] !== '') { start = Math.max(0, total - Number(range[2])); }
    else { start = Number(range[1]) || 0; if (range[2] !== '') { end = Math.min(total - 1, Number(range[2])); } }
    if (start > end || start >= total) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); return res.end(); }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
  }
  headers['Content-Length'] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { return res.end(); }
  var stream = fs.createReadStream(it.file, { start: start, end: end });
  stream.on('error', function () { try { res.destroy(); } catch (e) { /* closed */ } });
  res.on('close', function () { try { stream.destroy(); } catch (e) { /* done */ } });
  stream.pipe(res);
}

function open(id, done) {
  var it = find(id);
  if (!it || it.status !== 'done') { return done(new Error('La descarga no está completa')); }
  if (!exists(it.file)) { it.status = 'missing'; saveSoon(); return done(new Error('El archivo ya no está en ' + DIR)); }
  startServer(function (err) {
    if (err) { return done(err); }
    var name = path.basename(it.file);
    done(null, { url: 'http://' + HOST + ':' + port + '/d/' + it.id + '/' + encodeURIComponent(name), name: name });
  });
}

/* Closing the app: stop everything, keep what was downloaded. */
function close() {
  Object.keys(running).forEach(function (id) {
    var it = find(id);
    if (it) { it.status = 'paused'; it.resumeOnStart = true; halt(it, true); }
  });
  /* Waiting ones too: they start with the app next time. */
  (items || []).forEach(function (it) { if (it.status === 'queued') { it.resumeOnStart = true; } });
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveNow();
  if (server) { try { server.close(); } catch (e) { /* closed */ } server = null; port = 0; }
}

module.exports = { start: start, list: list, action: action, open: open, close: close, DIR: DIR, safeName: safeName };
