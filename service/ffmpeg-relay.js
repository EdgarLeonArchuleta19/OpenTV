'use strict';
// ffmpeg-relay.js  (solo ES5: el Node de la TV es muy antiguo)
// Remuxea TS -> MP4 fragmentado (sin recodificar) y lo sirve por HTTP local,
// para que el <video> use el reproductor nativo de la TV con un MP4 en vez del TS.

var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var urlmod = require('url');
var spawn = require('child_process').spawn;
var dnsx = require('./dnsx');

/* Services run in a restricted namespace where /media/developer may not be
 * visible even though it is visible through SSH. Keep the executable next to
 * this service so the spawned process sees the same filesystem. */
var FFMPEG = process.env.OPENTV_FFMPEG_PATH || (__dirname + '/ffmpeg');
var HOST = '127.0.0.1';   // solo local: no es un relay abierto
var PORT = 8787;

var sessions = {};        // token -> { url, headers, audio, hevc }
var current = null;       // { ff } stream activo (solo uno a la vez)
var requestSeq = 0;       // la peticion mas reciente gana (un salto anula el anterior)

function log() {
  var args = Array.prototype.slice.call(arguments);
  try { fs.appendFileSync(require('path').join(require('os').tmpdir(), 'opentv-relay.log'), args.join(' ') + '\n'); } catch (eLog) { /* diagnostic log is optional */ }
  console.log.apply(console, ['[relay]'].concat(args));
}

/* The packaged mode is already 0755 (tools/fix_ipk_modes.py). Try chmod only
   when it is missing, so a root-owned install does not log a false alarm. */
try {
  var mode = fs.statSync(FFMPEG).mode;
  if (!(mode & parseInt('111', 8))) {
    fs.chmodSync(FFMPEG, parseInt('755', 8));
  }
} catch (e) {
  /* Installed packages are owned by root; the service user cannot chmod them.
     Record it: if the packaged mode is wrong, spawn() would fail with EACCES. */
  log('no se pudo aplicar permiso de ejecucion a ffmpeg:', e.message);
}

function stopCurrent() {
  if (current) {
    try { current.ff.kill('SIGKILL'); } catch (e) { /* ya termino */ }
    current = null;
  }
}

// Separa User-Agent (ffmpeg lo quiere en -user_agent) del resto de cabeceras.
function splitHeaders(h) {
  var ua = null;
  var rest = [];
  Object.keys(h || {}).forEach(function (k) {
    if (k.toLowerCase() === 'user-agent') ua = h[k];
    else rest.push(k + ': ' + h[k] + '\r\n');
  });
  return { ua: ua, rest: rest.join('') };
}

// Registra una sesion y devuelve la URL local para el <video>.
// stream: { url, headers } of the file to play (addon source, torrent on loopback)
function register(stream, opts) {
  opts = opts || {};
  var token = crypto.randomBytes(8).toString('hex');
  sessions[token] = {
    url: stream.url,
    headers: stream.headers || {},
    audio: opts.audio || 0,
    hevc: !!opts.hevc,
    /* The player can decode this video itself: only the audio is converted
       (AC3/EAC3, which Chromium cannot play, becomes AAC). */
    videoCopy: !!opts.videoCopy
  };
  return 'http://' + HOST + ':' + PORT + '/s/' + token + '.mp4';
}

function inputArgs(s) {
  var h = splitHeaders(s.headers);
  var args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-probesize', '2M', '-analyzeduration', '3M'
  ];
  if (/^https?:\/\//i.test(s.url)) {   // estas opciones solo existen para entradas HTTP(S)
    args.push('-rw_timeout', '15000000');
    args = args.concat(require('./ffmpeg-tls').args(s.url));
    if (h.ua) args.push('-user_agent', h.ua);
    if (h.rest) args.push('-headers', h.rest);
  }
  return args;
}

/*
 * A copied video can only start on a keyframe. Asked to start at second 17
 * with keyframes every 10 s, ffmpeg starts the video at 10 but the audio at
 * 17, and in a fragmented MP4 that audio plays from the first frame: audio
 * and subtitles end up seconds ahead of the picture. So first find the
 * keyframe at or before `start` (one packet is read, ~0.1 s) and start both
 * tracks there. Answers `start` itself when the probe fails or looks wrong
 * (some TS files seek imprecisely): the old behaviour.
 *
 * `from` is where the viewer was when jumping forward. If the keyframe
 * before `start` is not past it (keyframes far apart), the jump would go
 * nowhere: use the next keyframe instead (that probe reads one whole GOP,
 * so it only runs in that case).
 */
/* A torrent served on loopback has to download the pieces at the new
   position before the probe can read one packet: give it time, or the probe
   gives up and the relay falls back to an unaligned start. */
function probeDeadline(input) {
  return /^http:\/\/127\.0\.0\.1:\d+\/t\//.test(input.url || '') ? 45000 : 8000;
}

function keyframeTimes(input, start, count, done) {
  var finished = false;
  var probe = null;
  var timer = null;
  function finish(list) {
    if (finished) { return; }
    finished = true;
    if (timer) { clearTimeout(timer); }
    try { if (probe) { probe.kill('SIGKILL'); } } catch (eKill) { /* ya termino */ }
    done(list);
  }
  var args = inputArgs(input).concat(['-noaccurate_seek', '-ss', String(start), '-i', input.url,
    '-map', '0:v:0', '-c', 'copy']);
  // Only keyframes (the noise filter drops the rest without decoding).
  if (count > 1) { args.push('-bsf:v', 'noise=drop=not(key)'); }
  args.push('-frames:v', String(count), '-f', 'framecrc', 'pipe:1');
  try { probe = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
  catch (eSpawn) { return done([]); }
  timer = setTimeout(function () { finish([]); }, probeDeadline(input));
  var out = '';
  probe.on('error', function () { finish([]); });
  probe.stdout.on('data', function (d) { out += String(d); });
  probe.on('close', function () {
    var tb = /^#tb 0: (\d+)\/(\d+)/m.exec(out);
    if (!tb) { return finish([]); }
    // Packet times relative to `start` (negative = earlier).
    var re = /^0,\s*(-?\d+),\s*(-?\d+),/mg, m, list = [];
    while ((m = re.exec(out))) { list.push(Number(m[2]) * Number(tb[1]) / Number(tb[2])); }
    finish(list);
  });
}

function probeKeyframe(input, start, from, done) {
  function at(rel) { return Math.max(0, Math.round((start + rel) * 1000) / 1000); }
  keyframeTimes(input, start, 1, function (list) {
    var rel = list[0];
    if (!isFinite(rel) || rel > 0.25 || rel < -20) { return done(start); }
    var prev = at(Math.min(0, rel));
    if (!(from >= 0) || from >= start || prev > from + 1) { return done(prev); }
    keyframeTimes(input, start, 2, function (both) {
      var next = both[1];
      if (isFinite(next) && next > 0 && next < 30) { return done(at(next)); }
      done(prev);
    });
  });
}

/* -ss for a copied video must land just after the keyframe's timestamp: a
   keyframe followed by B-frames is presented ~0.1-0.3 s after where the
   probe sees it, and an -ss even slightly before that makes the demuxer go
   back a whole keyframe interval (to second 0 in a test file). */
var KEYFRAME_MARGIN = 0.5;

function buildArgs(s, start, audio, seekAt) {
  var args = inputArgs(s);
  // Files from addons and torrents (MKV/AVI/TS with cuts) often lack or
  // repeat timestamps: regenerate the missing ones so audio and video keep
  // the same clock.
  args.push('-fflags', '+genpts');
  if (start > 0) {
    // A copied video can only start on a keyframe. With the default accurate
    // seek FFmpeg still cut the converted audio at -ss, so after a jump the
    // audio played up to a whole keyframe interval ahead of the picture
    // (measured: picture from second 0, sound from second 7). Without it,
    // both tracks start at the same keyframe and keep their timestamps.
    if (s.videoCopy) args.push('-noaccurate_seek');
    args.push('-ss', String(seekAt > 0 ? seekAt : start));
  }
  args.push(
    '-i', s.url,
    '-map', '0:v:0', '-map', '0:a:' + audio + '?'
  );
  if (s.videoCopy) {
    // El reproductor decodifica este vídeo por hardware: se copia tal cual
    // (casi sin CPU, arranque y saltos inmediatos) y solo se convierte el audio.
    args.push('-c:v', 'copy');
    if (s.hevc) args.push('-tag:v', 'hvc1');   // la etiqueta que Chromium acepta para HEVC en MP4
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p');
  }
  args.push(
    // Audio follows the video clock: gaps are filled with silence and small
    // drift is corrected by stretching (up to 1000 samples/s, inaudible),
    // instead of the audio sliding further behind after each cut.
    '-af', 'aresample=async=1000',
    '-c:a', 'aac', '-b:a', '160k',
    // El portal entrega AAC dentro de TS como ADTS. MP4/fMP4 exige el Audio
    // Specific Config, que este filtro extrae sin recodificar el audio.
    '-bsf:a', 'aac_adtstoasc'
  );
  if (s.hevc && !s.videoCopy) args.push('-tag:v', 'avc1');
  // A copied video starts on the keyframe before -ss (negative time) while
  // the converted audio starts exactly at -ss (time 0). Chromium ignores the
  // MP4 edit list that would line them up, so the audio played ahead of the
  // picture after a jump whenever the keyframe probe failed (torrents still
  // downloading). Shifting every track by the same amount keeps them in sync.
  args.push('-avoid_negative_ts', 'make_zero');
  args.push(
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );
  return args;
}

/* Adds a second output to `args`: the first video packet and the audio before
 * it, as framecrc lines, in a temp file. The earliest of them is where the
 * main output's time 0 is in the source (make_zero shifts to it). Once read,
 * s.starts[key] holds it for ?where=. Returns the temp file path. */
function measureStart(args, audio, seekAt, key, s) {
  var file = require('path').join(require('os').tmpdir(), 'opentv-relay-' + crypto.randomBytes(6).toString('hex') + '.crc');
  args.push('-map', '0:v:0', '-map', '0:a:' + audio + '?', '-c', 'copy', '-frames:v', '1', '-f', 'framecrc', '-y', file);
  s.measuring = s.measuring || {};
  s.measuring[key] = true;
  var tries = 0;
  var timer = setInterval(function () {
    var text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (eRead) { text = ''; }
    var first = firstPacketTime(text);
    if (first !== null || ++tries > 150) {
      clearInterval(timer);
      delete s.measuring[key];
      if (first !== null) {
        var real = Math.max(0, Math.round((seekAt + first) * 1000) / 1000);
        s.starts = s.starts || {};
        if (Math.abs(real - s.starts[key]) > 0.3) { log('el salto empezó en ' + real + 's (sonda: ' + s.starts[key] + 's)'); }
        s.starts[key] = real;
      }
      try { fs.unlinkSync(file); } catch (eRm) { /* not there */ }
    }
  }, 200);
  return file;
}

/* framecrc text → seconds of the earliest packet (relative to -ss), or null
 * while the video packet has not been written yet. */
function firstPacketTime(text) {
  var tb = {};
  var re = /^#tb (\d+): (\d+)\/(\d+)/mg, m;
  while ((m = re.exec(text))) { tb[m[1]] = Number(m[2]) / Number(m[3]); }
  var line = /^(\d+),\s*(-?\d+),\s*(-?\d+),/mg, min = null, sawVideo = false;
  while ((m = line.exec(text))) {
    if (!tb[m[1]]) { continue; }
    if (m[1] === '0') { sawVideo = true; }
    var t = Number(m[2]) * tb[m[1]];
    if (min === null || t < min) { min = t; }
  }
  return sawVideo ? min : null;
}

/*
 * The bundled static ffmpeg occasionally cannot use webOS's local DNS stub
 * (127.0.0.1), while the platform resolver can. Resolve HTTP CDN names with
 * DoH (dnsx) or the platform utility and preserve the original Host header for the CDN.
 */
function resolveForFfmpeg(s, done) {
  var fixedUrl = require('./cachefly').ffmpegUrl(s.url);
  if (fixedUrl !== s.url) {
    log('CDN CacheFly: ffmpeg usa HTTP (su certificado HTTPS no cubre el dominio)');
    s = { url: fixedUrl, headers: s.headers, audio: s.audio, hevc: s.hevc, videoCopy: s.videoCopy };
  }
  var parsed = urlmod.parse(s.url || '');
  // Solo HTTP: con HTTPS, cambiar el nombre por la IP rompe la verificación
  // TLS (el certificado es del dominio, no de la IP).
  if (!/^http:$/i.test(parsed.protocol || '') || !parsed.hostname || /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) {
    return done(s);
  }

  dnsx.resolve(parsed.hostname, function (err, res) {
    var ip = (res && res.ips && res.ips[0]) || '';
    if (!err && ip) {
      var headers = {};
      Object.keys(s.headers || {}).forEach(function (key) {
        if (key.toLowerCase() !== 'host') headers[key] = s.headers[key];
      });
      headers.Host = parsed.host;
      parsed.hostname = ip;
      parsed.host = ip + (parsed.port ? ':' + parsed.port : '');
      parsed.href = null;
      log('CDN resuelto por DoH (' + (res && res.source) + ') para ffmpeg: ' + parsed.hostname + ' -> ' + ip);
      return done({
        url: urlmod.format(parsed),
        headers: headers,
        audio: s.audio,
        hevc: s.hevc,
        videoCopy: s.videoCopy
      });
    }

    log('DoH no devolvio IP para ' + parsed.hostname + ' (' + (err && err.message) + '), probando DNS del sistema...');
    dnsx.systemLookup(parsed.hostname, 3500, function (errSys, sysRes) {
      var sysIp = (sysRes && sysRes.ip) || '';
      if (errSys || !sysIp || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(sysIp)) {
        log('DNS del sistema no devolvio IPv4; se usa hostname');
        return done(s);
      }
      var headers2 = {};
      Object.keys(s.headers || {}).forEach(function (key) {
        if (key.toLowerCase() !== 'host') headers2[key] = s.headers[key];
      });
      headers2.Host = parsed.host;
      parsed.hostname = sysIp;
      parsed.host = sysIp + (parsed.port ? ':' + parsed.port : '');
      parsed.href = null;
      log('CDN resuelto por DNS del sistema para ffmpeg: ' + sysIp);
      done({
        url: urlmod.format(parsed),
        headers: headers2,
        audio: s.audio,
        hevc: s.hevc,
        videoCopy: s.videoCopy
      });
    });
  });
}

var server = http.createServer(function (req, res) {
  var u = urlmod.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  if (u.pathname === '/abort' || u.pathname === '/media/abort') {
    stopCurrent();
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end('aborted');
  }

  var m = /^\/s\/([0-9a-f]+)\.mp4$/.exec(u.pathname || '');
  var s = m && sessions[m[1]];
  if (!s) {
    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }

  if (req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'none',
      'Access-Control-Allow-Origin': '*'
    });
    return res.end();
  }

  // ?where=<start>: where the stream asked at <start> really begins (the
  // player lines up its clock and the subtitles with it).
  if (u.query.where != null) {
    var asked = Math.max(0, Number(u.query.where) || 0);
    var waited = 0;
    // The measured start is usually ready before the player asks; if not,
    // wait for it a little (the player gives this request 4 s).
    var answer = function () {
      if (s.measuring && s.measuring[String(asked)] && waited < 3000) { waited += 100; return setTimeout(answer, 100); }
      var real = s.starts && s.starts[String(asked)];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ start: real != null ? real : asked }));
    };
    return answer();
  }

  // Subtitles inside the file: ?setsub=<n> picks the text subtitle track the
  // next runs also write (-1 = none); ?vtt=1 answers what was written so far.
  // They come out while the video is read, so a torrent never has to be
  // downloaded whole to get them.
  if (u.query.setsub != null) {
    var n = parseInt(u.query.setsub, 10);
    s.subIndex = n >= 0 && n < 100 ? n : -1;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ sub: s.subIndex }));
  }
  if (u.query.vtt != null) {
    var text = '';
    if (s.vttFile) { try { text = fs.readFileSync(s.vttFile, 'utf8'); } catch (eVtt) { text = ''; } }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ sub: s.subIndex >= 0 ? s.subIndex : -1, base: s.vttBase || 0, text: text }));
  }

  var start = Math.max(0, Number(u.query.start) || 0);
  var audio = Number(u.query.a != null ? u.query.a : s.audio) || 0;

  stopCurrent();   // el player a veces abre y aborta peticiones; no dejamos procesos huerfanos
  var mySeq = ++requestSeq;
  var gone = false;
  var tlsRetried = false;   /* one retry without the certificate check */
  res.on('close', function () { gone = true; });

  resolveForFfmpeg(s, function (input) {
    var from = u.query.from != null ? Number(u.query.from) : -1;
    if (s.videoCopy && start > 0) { probeKeyframe(input, start, from, run); }
    else { run(start); }

  function run(realStart) {
    // A newer request or a closed player while probing: nothing to start.
    if (gone || mySeq !== requestSeq) { return res.end(); }
    s.starts = s.starts || {};
    s.starts[String(start)] = realStart;
    if (realStart !== start) { log('inicio en el keyframe ' + realStart + 's (pedido ' + start + 's)'); }
    // On a keyframe found by the probe: ask a little past it so the demuxer
    // lands on that keyframe and not on the one before.
    var seekAt = (s.videoCopy && realStart > 0 && realStart !== start) ? realStart + KEYFRAME_MARGIN : realStart;
    var args = buildArgs(input, realStart, audio, seekAt);
    // A copied video starts on a keyframe, wherever the probe said: measure
    // where this stream really begins (first packets of a tiny second output)
    // so the player's clock and the subtitles line up even when the probe
    // gave up (torrent pieces still downloading).
    var crcFile = (s.videoCopy && start > 0) ? measureStart(args, audio, seekAt, String(start), s) : '';
    // The chosen subtitle track of the file, as WebVTT written while playing.
    // Its times count from -ss (seekAt): the page adds vttBase.
    if (s.vttFile) { try { fs.unlinkSync(s.vttFile); } catch (eOld) { /* gone */ } s.vttFile = ''; }
    if (s.subIndex >= 0) {
      s.vttFile = require('path').join(require('os').tmpdir(), 'opentv-subs-' + crypto.randomBytes(6).toString('hex') + '.vtt');
      s.vttBase = start > 0 ? seekAt : 0;
      args.push('-map', '0:s:' + s.subIndex, '-c:s', 'webvtt', '-flush_packets', '1', '-f', 'webvtt', '-y', s.vttFile);
    }
    var ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    current = { ff: ff };
    var started = false;
    var tlsFailed = false;

  ff.on('error', function (e) {
    log('no se pudo lanzar ffmpeg:', e.message);
    if (!started) {
      res.writeHead(500, { 'Access-Control-Allow-Origin': '*' });
      started = true;
    }
    res.end();
  });

  ff.stderr.on('data', function (d) {
    log('ffmpeg:', String(d).trim());
    if (!started && require('./ffmpeg-tls').noteFailure(input.url, d)) { tlsFailed = true; }
  });

  ff.stdout.on('data', function (chunk) {
    if (!started) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
        'Access-Control-Allow-Origin': '*'
      });
      started = true;
    }
    // backpressure: si el player va lento, ffmpeg deja de leer del portal
    if (!res.write(chunk)) {
      ff.stdout.pause();
      res.once('drain', function () { ff.stdout.resume(); });
    }
  });

  ff.on('close', function (code) {
    if (crcFile) { try { fs.unlinkSync(crcFile); } catch (eRm) { /* read and removed already */ } }
    if (current && current.ff === ff) current = null;
    /* The source's certificate did not pass: the same start again,
       without the check (ffmpeg-tls.js now skips it for that host). */
    if (!started && tlsFailed && !tlsRetried && !gone && mySeq === requestSeq) {
      tlsRetried = true;
      log('certificado no válido en la fuente: se reintenta sin verificarlo');
      return run(realStart);
    }
    if (!started) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
      started = true;
    }   // ffmpeg no produjo nada
    res.end();
    if (code) log('ffmpeg termino con codigo', code);
  });

    res.on('close', function () { try { ff.kill('SIGKILL'); } catch (e) { /* ya termino */ } });
  }
  });
});

var fallbackPortTried = false;
server.on('error', function (e) {
  if (e && e.code === 'EADDRINUSE' && !fallbackPortTried) {
    fallbackPortTried = true;
    log('puerto ' + PORT + ' ocupado; asignando puerto libre automaticamente...');
    server.listen(0, HOST);
    return;
  }
  log('error del servidor:', e.message);
});
server.on('listening', function () {
  var addr = server.address();
  if (addr && addr.port) { PORT = addr.port; }
  log('escuchando en', HOST + ':' + PORT);
});
server.listen(PORT, HOST);

module.exports = {
  register: register,
  stop: stopCurrent,
  available: function () {
    /* A packaged file can exist but lack +x (ares-package on Windows writes
       0666). Report that as unavailable instead of letting spawn() fail later
       and silently falling back to direct playback. */
    try {
      fs.accessSync(FFMPEG, (fs.constants && fs.constants.X_OK) || fs.X_OK || 1);
      return true;
    } catch (eAccess) {
      return false;
    }
  },
  path: function () { return FFMPEG; },
  port: function () { return PORT; },
  close: function () { stopCurrent(); server.close(); }
};
