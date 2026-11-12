/*
 * Torrent playback for the PC app (Stremio mode): one torrent at a time,
 * downloaded in the order the player reads it and served on loopback as a
 * normal HTTP file with Range support, so <video>, the proxy and the FFmpeg
 * relay treat it like any other link.
 *
 *   start({ infoHash, fileIdx, sources, name }) -> { url, name, length }
 *   stats()                                     -> { peers, speed, downloaded, ... }
 *   stop()                                      -> engine destroyed, cache deleted
 *
 * The cache lives in the system temp folder and is deleted when the torrent
 * stops (leaving the player or starting another one) and when the app closes.
 * Only loaded in the Electron service: TVs and phones never require it.
 */
'use strict';

var http = require('http');
var os = require('os');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var HOST = '127.0.0.1';
var CACHE = path.join(os.tmpdir(), 'opentv-torrents');
var READY_TIMEOUT_MS = 60000;
var IDLE_STOP_MS = 10 * 60 * 1000;   /* nobody reading for 10 min: stop and free the disk */

/* Public trackers added to every torrent so peers are found quickly even
   when the addon sends none (DHT is used too). */
var DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce'
];

var VIDEO_EXT = /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
var MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', ts: 'video/mp2t', m2ts: 'video/mp2t', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  mpg: 'video/mpeg', mpeg: 'video/mpeg' };

var torrentStream = null;
var server = null, port = 0, serverWaiters = null;
var current = null;   /* { key, hash, engine, file, token, started, lastRead, ready, waiters } */
var idleTimer = null;

function lib() {
  if (!torrentStream) { torrentStream = require('torrent-stream'); }
  return torrentStream;
}

function extOf(name) {
  var m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function trackersFrom(sources) {
  var list = DEFAULT_TRACKERS.slice();
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

function stop(done) {
  var c = current;
  current = null;
  if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
  if (!c) { return removeCache(done); }
  (c.waiters || []).forEach(function (cb) { cb(new Error('Se canceló la carga del torrent')); });
  c.waiters = null;
  try {
    c.engine.destroy(function () {
      try { c.engine.remove(function () { removeCache(done); }); } catch (e) { removeCache(done); }
    });
  } catch (eDestroy) { removeCache(done); }
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

function start(opts, done) {
  opts = opts || {};
  var hash = String(opts.infoHash || '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) { return done(new Error('El torrent no es válido')); }
  var key = hash + ':' + (opts.fileIdx === undefined || opts.fileIdx === null ? '' : opts.fileIdx);
  startServer(function (serr) {
    if (serr) { return done(serr); }
    if (current && current.key === key) {
      if (current.ready) { return done(null, describe(current)); }
      current.waiters.push(function (err) { done(err, err ? null : describe(current)); });
      return;
    }
    stop(function () {
      var engine;
      try {
        engine = lib()('magnet:?xt=urn:btih:' + hash, {
          tmp: CACHE,
          trackers: trackersFrom(opts.sources),
          connections: 60,
          uploads: 6,
          dht: true,
          verify: true
        });
      } catch (eEngine) { return done(eEngine); }
      var c = { key: key, hash: hash, engine: engine, file: null, ready: false,
        token: crypto.randomBytes(8).toString('hex'), started: Date.now(), lastRead: Date.now(),
        waiters: [function (err) { done(err, err ? null : describe(c)); }] };
      current = c;
      function finish(err) {
        if (current !== c || !c.waiters) { return; }
        var w = c.waiters;
        c.waiters = [];
        w.forEach(function (cb) { cb(err); });
        if (err) { stop(); }
      }
      var timer = setTimeout(function () {
        finish(new Error('No se encontraron fuentes para este torrent. Prueba con otra fuente.'));
      }, READY_TIMEOUT_MS);
      engine.on('ready', function () {
        clearTimeout(timer);
        if (current !== c) { return; }
        var file = pickFile(engine.files, opts.fileIdx);
        if (!file) { return finish(new Error('El torrent no tiene ningún vídeo')); }
        engine.files.forEach(function (f) { if (f !== file) { f.deselect(); } });
        file.select();
        c.file = file;
        c.ready = true;
        finish(null);
      });
      engine.on('error', function (err) { clearTimeout(timer); finish(err); });
      if (!idleTimer) {
        idleTimer = setInterval(function () {
          if (current && Date.now() - current.lastRead > IDLE_STOP_MS) { stop(); }
        }, 60000);
      }
    });
  });
}

function stats() {
  var c = current;
  if (!c) { return { active: false }; }
  var swarm = c.engine.swarm;
  var downloaded = swarm ? swarm.downloaded : 0;
  return {
    active: true,
    ready: c.ready,
    name: c.file ? c.file.name : '',
    length: c.file ? c.file.length : 0,
    peers: swarm ? swarm.wires.length : 0,
    speed: swarm && swarm.downloadSpeed ? Math.round(swarm.downloadSpeed()) : 0,
    upload: swarm && swarm.uploadSpeed ? Math.round(swarm.uploadSpeed()) : 0,
    downloaded: downloaded,
    seconds: Math.round((Date.now() - c.started) / 1000)
  };
}

function close() {
  stop();
  if (server) { try { server.close(); } catch (e) { /* closed */ } server = null; port = 0; }
}

/* A previous run that crashed may have left pieces behind. */
removeCache();

module.exports = { start: start, stop: stop, stats: stats, close: close, CACHE: CACHE };
