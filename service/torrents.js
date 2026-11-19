/*
 * Torrent playback for the PC app (Stremio mode): one torrent at a time,
 * downloaded in the order the player reads it and served on loopback as a
 * normal HTTP file with Range support, so <video>, the proxy and the FFmpeg
 * relay treat it like any other link.
 *
 *   start({ infoHash, fileIdx, sources, alternatives }) -> { url, name, length, infoHash }
 *   stats()                                             -> { peers, speed, available, racing, ... }
 *   stop()                                              -> engine destroyed, cache deleted
 *
 * Source race: `alternatives` (up to 3 more torrents of the same title, best
 * first, chosen by the page) start at the same time as the chosen one. A
 * torrent is alive once it has its metadata and either the whole video is
 * available among the connected peers (a seed, or several partial peers
 * that together hold every piece) or it already downloaded some of it. The
 * chosen torrent wins as soon as it is alive; otherwise the best-ranked
 * alive one wins after a short grace, and the others are destroyed. The
 * answer's infoHash tells the page which one plays.
 *
 * Peers: a fixed list of public trackers plus the community's "best" list
 * (refreshed at most once a day), the addon's own trackers and DHT.
 *
 * The cache lives in the system temp folder and is deleted when the torrent
 * stops (leaving the player or starting another one) and when the app closes.
 * Only loaded in the Electron service: TVs and phones never require it.
 */
'use strict';

var http = require('http');
var https = require('https');
var os = require('os');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var HOST = '127.0.0.1';
var CACHE = path.join(os.tmpdir(), 'opentv-torrents');
var READY_TIMEOUT_MS = 60000;
var IDLE_STOP_MS = 10 * 60 * 1000;   /* nobody reading for 10 min: stop and free the disk */

var RACE_MAX = 4;                    /* torrents started at once (chosen + alternatives) */
var RACE_TICK_MS = 500;
var RACE_GRACE_MS = 4000;            /* a better-ranked torrent may still turn alive */
var RACE_HEAD_START_MS = 4000;       /* only the chosen torrent can win before this */
var RACE_SETTLE_MS = 12000;          /* none alive by now: the best one with metadata plays */
var ALIVE_BYTES = 1024 * 1024;       /* downloaded this much: it works */

/* Public trackers added to every torrent so peers are found quickly even
   when the addon sends none (DHT is used too). Same list as Torrents.java. */
var DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://tracker.tryhackx.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.gmi.gd:6969/announce',
  'http://tracker.renfei.net:8080/announce'
];

/* The community-kept list of working public trackers, refreshed at most
   once a day and kept between runs (the torrent cache is deleted, so it
   lives next to it). */
var TRACKERS_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt';
var TRACKERS_FILE = path.join(os.tmpdir(), 'opentv-trackers.txt');
var TRACKERS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var TRACKERS_MAX = 40;
var fetchedTrackers = [];
var trackersCheckedAt = 0;

var VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
var MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', ts: 'video/mp2t', m2ts: 'video/mp2t', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  mpg: 'video/mpeg', mpeg: 'video/mpeg' };

var torrentStream = null;
var server = null, port = 0, serverWaiters = null;
var current = null;   /* the torrent playing: { key, hash, engine, file, token, started, lastRead, ready, waiters } */
var racing = null;    /* torrents starting: { key, jobs, waiters, timer, started, firstAliveAt } */
var idleTimer = null;

function lib() {
  if (!torrentStream) { torrentStream = require('torrent-stream'); }
  return torrentStream;
}

function extOf(name) {
  var m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/* ------------------------------------------------------------ trackers */

function parseTrackers(text) {
  var out = [];
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var t = line.trim();
    if (/^(udp|https?|wss?):\/\/\S+$/i.test(t) && out.indexOf(t) === -1 && out.length < TRACKERS_MAX) { out.push(t); }
  });
  return out;
}

function readSavedTrackers() {
  try {
    var st = fs.statSync(TRACKERS_FILE);
    fetchedTrackers = parseTrackers(fs.readFileSync(TRACKERS_FILE, 'utf8'));
    return Date.now() - st.mtimeMs < TRACKERS_MAX_AGE_MS;
  } catch (e) { return false; }
}

/* Never blocks a start: the list read now is used, a fresh one next time. */
function refreshTrackers() {
  if (Date.now() - trackersCheckedAt < 60 * 60 * 1000) { return; }
  trackersCheckedAt = Date.now();
  if (readSavedTrackers()) { return; }
  var req = https.get(TRACKERS_URL, { timeout: 10000 }, function (res) {
    if (res.statusCode !== 200) { res.resume(); return; }
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (d) { if (body.length < 65536) { body += d; } });
    res.on('end', function () {
      var list = parseTrackers(body);
      if (!list.length) { return; }
      fetchedTrackers = list;
      fs.writeFile(TRACKERS_FILE, list.join('\n') + '\n', function () {});
    });
  });
  req.on('timeout', function () { req.destroy(); });
  req.on('error', function () { /* offline: the fixed list is enough */ });
}

function trackersFrom(sources) {
  var list = DEFAULT_TRACKERS.slice();
  fetchedTrackers.forEach(function (t) { if (list.indexOf(t) === -1) { list.push(t); } });
  (Array.isArray(sources) ? sources : []).forEach(function (s) {
    var m = /^tracker:(.+)$/i.exec(String(s || ''));
    if (m && list.indexOf(m[1]) === -1) { list.push(m[1]); }
  });
  return list;
}

/* The file the addon pointed at (fileIdx), or the biggest video file. */
function pickFile(files, fileIdx) {
  var idx = Number(fileIdx);
  if (fileIdx !== undefined && fileIdx !== null && fileIdx !== '' && idx >= 0 && files[idx]) { return files[idx]; }
  var best = null;
  files.forEach(function (f) {
    if (VIDEO_EXT.test(f.name) && (!best || f.length > best.length)) { best = f; }
  });
  return best;
}

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

/* GET /t/<token>/<name>: the selected file with Range support. */
function serve(req, res) {
  /* The player sends /media/abort to whatever local server it last used
     (the proxy's way to cut downloads): nothing to cut here. */
  if ((req.url || '').indexOf('/media/abort') === 0) {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }
  var m = /^\/t\/([0-9a-f]{16})\//.exec(req.url || '');
  var c = current;
  if (!m || !c || !c.file || c.token !== m[1]) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  var file = c.file;
  var total = file.length;
  var headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[extOf(file.name)] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  };
  var start = 0, end = total - 1, status = 200;
  var range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, total - Number(range[2]));
    } else {
      start = Number(range[1]) || 0;
      if (range[2] !== '') { end = Math.min(total - 1, Number(range[2])); }
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + total });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
  }
  headers['Content-Length'] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD') { return res.end(); }
  c.lastRead = Date.now();
  var stream = file.createReadStream({ start: start, end: end });
  stream.on('data', function () { c.lastRead = Date.now(); });
  stream.on('error', function () { try { res.destroy(); } catch (e) { /* closed */ } });
  res.on('close', function () { try { stream.destroy(); } catch (e) { /* done */ } });
  stream.pipe(res);
}

function removeCache(done) {
  fs.rm(CACHE, { recursive: true, force: true }, function () { if (done) { done(); } });
}

function destroyJob(j, done) {
  try {
    j.engine.destroy(function () {
      try { j.engine.remove(function () { if (done) { done(); } }); } catch (e) { if (done) { done(); } }
    });
  } catch (eDestroy) { if (done) { done(); } }
}

function stop(done) {
  var c = current;
  var r = racing;
  current = null;
  racing = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (r) {
    clearInterval(r.timer);
    (r.waiters || []).forEach(function (cb) { cb(new Error('Se canceló la carga del torrent')); });
    r.waiters = null;
  }
  var jobs = (r ? r.jobs : []).concat(c ? [c] : []);
  if (!jobs.length) { return removeCache(done); }
  var left = jobs.length;
  jobs.forEach(function (j) { destroyJob(j, function () { if (--left === 0) { removeCache(done); } }); });
}

function describe(c) {
  return {
    url: 'http://' + HOST + ':' + port + '/t/' + c.token + '/' + encodeURIComponent(c.file.name),
    name: c.file.name,
    length: c.file.length,
    mime: MIME[extOf(c.file.name)] || '',
    infoHash: c.hash
  };
}

/* ---------------------------------------------------------------- race */

function candidatesFrom(opts) {
  var list = [{ infoHash: opts.infoHash, fileIdx: opts.fileIdx, sources: opts.sources }]
    .concat(Array.isArray(opts.alternatives) ? opts.alternatives : []);
  var out = [], seen = {};
  list.forEach(function (c) {
    var hash = String((c && c.infoHash) || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash) || seen[hash] || out.length >= RACE_MAX) { return; }
    seen[hash] = true;
    out.push({ hash: hash, fileIdx: c.fileIdx, sources: c.sources });
  });
  return out;
}

function keyOf(hash, fileIdx) {
  return hash + ':' + (fileIdx === undefined || fileIdx === null ? '' : fileIdx);
}

function openJob(cand) {
  var engine = lib()('magnet:?xt=urn:btih:' + cand.hash, {
    tmp: CACHE,
    trackers: trackersFrom(cand.sources),
    connections: 100,
    uploads: 6,
    dht: true,
    verify: true
  });
  var j = { key: keyOf(cand.hash, cand.fileIdx), hash: cand.hash, engine: engine, file: null, ready: false,
    failed: '', token: crypto.randomBytes(8).toString('hex'), started: Date.now(), lastRead: Date.now(),
    firstPiece: 0, lastPiece: -1 };
  engine.on('ready', function () {
    var file = pickFile(engine.files, cand.fileIdx);
    if (!file) { j.failed = 'El torrent no tiene ningún vídeo'; return; }
    engine.files.forEach(function (f) { if (f !== file) { f.deselect(); } });
    file.select();
    var pl = engine.torrent && engine.torrent.pieceLength;
    if (pl) {
      j.firstPiece = Math.floor(file.offset / pl);
      j.lastPiece = Math.floor((file.offset + file.length - 1) / pl);
    }
    j.file = file;
  });
  engine.on('error', function (err) { j.failed = (err && err.message) || 'No se pudo abrir el torrent'; });
  return j;
}

/* Share of the video's pieces that some connected peer has (0..1). */
function availability(j) {
  var wires = j.engine && j.engine.swarm ? j.engine.swarm.wires : [];
  if (!j.file || j.lastPiece < j.firstPiece || !wires.length) { return 0; }
  var have = 0, total = j.lastPiece - j.firstPiece + 1;
  for (var p = j.firstPiece; p <= j.lastPiece; p++) {
    if (j.engine.bitfield && j.engine.bitfield.get(p)) { have++; continue; }
    for (var w = 0; w < wires.length; w++) {
      /* (peer-wire-protocol keeps the peer's pieces as a plain array.) */
      var bits = wires[w].peerPieces;
      if (bits && bits[p]) { have++; break; }
    }
  }
  return have / total;
}

function isAlive(j) {
  if (!j.file || j.failed) { return false; }
  var sw = j.engine.swarm;
  if (sw && sw.downloaded >= ALIVE_BYTES) { return true; }
  return availability(j) >= 1;
}

function race(cands, done) {
  var r = { key: keyOf(cands[0].hash, cands[0].fileIdx), jobs: [], waiters: [done], started: Date.now(), firstAliveAt: 0, timer: null };
  racing = r;
  try {
    cands.forEach(function (c) { r.jobs.push(openJob(c)); });
  } catch (eEngine) {
    racing = null;
    r.jobs.forEach(function (j) { destroyJob(j); });
    return done(eEngine);
  }
  function settle(err, winner) {
    if (racing !== r) { return; }
    clearInterval(r.timer);
    racing = null;
    var w = r.waiters;
    r.waiters = null;
    r.jobs.forEach(function (j) { if (j !== winner) { destroyJob(j); } });
    if (winner) {
      winner.ready = true;
      current = winner;
      if (!idleTimer) {
        idleTimer = setInterval(function () {
          if (current && Date.now() - current.lastRead > IDLE_STOP_MS) { stop(); }
        }, 60000);
      }
    }
    w.forEach(function (cb) { cb(err, winner ? describe(winner) : null); });
  }
  function tick() {
    if (racing !== r) { return clearInterval(r.timer); }
    var now = Date.now(), elapsed = now - r.started;
    var alive = -1, meta = -1, failed = 0;
    r.jobs.forEach(function (j, i) {
      if (j.failed) { failed++; return; }
      if (j.file && meta === -1) { meta = i; }
      /* Once alive, it stays so (the peers' count moves from one read to the next). */
      if (!j.wasAlive && isAlive(j)) { j.wasAlive = true; }
      if (alive === -1 && j.wasAlive) { alive = i; }
    });
    /* One torrent only: it plays as soon as its metadata is in (as before). */
    if (r.jobs.length === 1 && meta === 0) { return settle(null, r.jobs[0]); }
    if (alive === 0) { return settle(null, r.jobs[0]); }
    if (alive > 0) {
      /* A better-ranked one gets the grace only if it has its metadata
         (it may be about to work); one still without it is likely dead. */
      var hope = elapsed < RACE_HEAD_START_MS && !r.jobs[0].failed;
      for (var b = 0; b < alive; b++) { if (!r.jobs[b].failed && r.jobs[b].file) { hope = true; } }
      if (!r.firstAliveAt) { r.firstAliveAt = now; }
      if (!hope || now - r.firstAliveAt >= RACE_GRACE_MS) { return settle(null, r.jobs[alive]); }
      return;
    }
    if (failed === r.jobs.length) { return settle(new Error(r.jobs[0].failed || 'No se pudo abrir el torrent')); }
    if (meta !== -1 && elapsed >= RACE_SETTLE_MS) { return settle(null, r.jobs[meta]); }
    if (elapsed >= READY_TIMEOUT_MS) {
      settle(new Error('No se encontraron fuentes para este torrent. Prueba con otra fuente.'));
    }
  }
  r.timer = setInterval(tick, RACE_TICK_MS);
}

function start(opts, done) {
  opts = opts || {};
  var cands = candidatesFrom(opts);
  if (!cands.length || cands[0].hash !== String(opts.infoHash || '').toLowerCase()) { return done(new Error('El torrent no es válido')); }
  var key = keyOf(cands[0].hash, cands[0].fileIdx);
  refreshTrackers();
  /* Playing wins over looking: a probe still running gives way. */
  stopProbe();
  startServer(function (serr) {
    if (serr) { return done(serr); }
    if (current && current.key === key && current.ready) { return done(null, describe(current)); }
    if (racing && racing.key === key && racing.waiters) { racing.waiters.push(done); return; }
    stop(function () { race(cands, done); });
  });
}

/* -------------------------------------------------------------- probe */
/* "Cambiar fuente" (PC): how many people each torrent really has now, and
   how much of its video they hold between them, instead of the addon's old
   count. Up to PROBE_MAX torrents are opened for PROBE_MS without
   downloading any of the video (only the metadata), then closed. One probe
   at a time; starting a torrent stops it. */
var PROBE_MAX = 6;
var PROBE_MS = 8000;
var PROBE_CACHE = path.join(os.tmpdir(), 'opentv-torrent-probe');
var probing = null;   /* { jobs, timer, done } */

function stopProbe() {
  var p = probing;
  probing = null;
  if (!p) { return; }
  clearTimeout(p.timer);
  p.jobs.forEach(function (j) { destroyJob(j); });
  if (p.done) { p.done(new Error('Se canceló la comprobación')); }
}

function probe(opts, done) {
  stopProbe();
  var list = [], seen = {};
  (Array.isArray(opts && opts.torrents) ? opts.torrents : []).forEach(function (t) {
    var hash = String((t && t.infoHash) || '').toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(hash) || seen[hash] || list.length >= PROBE_MAX) { return; }
    /* The one playing or starting already reports itself in stats(). */
    if ((current && current.hash === hash) || (racing && racing.jobs.some(function (j) { return j.hash === hash; }))) { return; }
    seen[hash] = true;
    list.push({ hash: hash, fileIdx: t.fileIdx, sources: t.sources });
  });
  if (!list.length) { return done(null, { results: {} }); }
  refreshTrackers();
  var p = { jobs: [], timer: null, done: null };
  try {
    list.forEach(function (c) {
      var engine = lib()('magnet:?xt=urn:btih:' + c.hash, { tmp: PROBE_CACHE, trackers: trackersFrom(c.sources), connections: 40, uploads: 0, dht: true, verify: false });
      var j = { hash: c.hash, engine: engine, file: null, firstPiece: 0, lastPiece: -1 };
      engine.on('ready', function () {
        /* Nothing selected: torrent-stream downloads no piece of the video. */
        var file = pickFile(engine.files, c.fileIdx);
        var pl = engine.torrent && engine.torrent.pieceLength;
        if (!file || !pl) { return; }
        engine.files.forEach(function (f) { f.deselect(); });
        j.firstPiece = Math.floor(file.offset / pl);
        j.lastPiece = Math.floor((file.offset + file.length - 1) / pl);
        j.file = file;
      });
      engine.on('error', function () { /* reported as nobody */ });
      p.jobs.push(j);
    });
  } catch (eEngine) {
    p.jobs.forEach(function (j) { destroyJob(j); });
    return done(eEngine);
  }
  p.done = done;
  probing = p;
  p.timer = setTimeout(function () {
    if (probing !== p) { return; }
    var results = {};
    p.jobs.forEach(function (j) {
      var wires = j.engine.swarm ? j.engine.swarm.wires.length : 0;
      results[j.hash] = { peers: wires, available: j.file ? Math.round(availability(j) * 100) : -1 };
    });
    var cb = p.done;
    p.done = null;
    stopProbe();
    fs.rm(PROBE_CACHE, { recursive: true, force: true }, function () {});
    cb(null, { results: results });
  }, PROBE_MS);
}

function stats() {
  var r = racing;
  if (r) {
    var peers = 0, speed = 0, downloaded = 0, best = 0;
    r.jobs.forEach(function (j) {
      var sw = j.engine.swarm;
      if (!sw) { return; }
      peers += sw.wires.length;
      speed += sw.downloadSpeed ? Math.round(sw.downloadSpeed()) : 0;
      downloaded += sw.downloaded;
      best = Math.max(best, availability(j));
    });
    return { active: true, ready: false, racing: r.jobs.length, peers: peers, speed: speed,
      downloaded: downloaded, available: Math.round(best * 100), seconds: Math.round((Date.now() - r.started) / 1000) };
  }
  var c = current;
  if (!c) { return { active: false }; }
  var swarm = c.engine.swarm;
  return {
    active: true,
    ready: c.ready,
    racing: 0,
    name: c.file ? c.file.name : '',
    length: c.file ? c.file.length : 0,
    peers: swarm ? swarm.wires.length : 0,
    speed: swarm && swarm.downloadSpeed ? Math.round(swarm.downloadSpeed()) : 0,
    upload: swarm && swarm.uploadSpeed ? Math.round(swarm.uploadSpeed()) : 0,
    downloaded: swarm ? swarm.downloaded : 0,
    available: Math.round(availability(c) * 100),
    seconds: Math.round((Date.now() - c.started) / 1000)
  };
}

function close() {
  stopProbe();
  stop();
  if (server) { try { server.close(); } catch (e) { /* closed */ } server = null; port = 0; }
}

/* A previous run that crashed may have left pieces behind. */
removeCache();

module.exports = { start: start, stop: stop, stats: stats, probe: probe, close: close, CACHE: CACHE,
  /* (tests) */ _parseTrackers: parseTrackers, _candidatesFrom: candidatesFrom };
