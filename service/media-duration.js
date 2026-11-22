'use strict';

// Verify source metadata independently of a portal's provisional duration.
// This process is independent of the playback relay and never changes its URL.
var crypto = require('crypto');
var path = require('path');
var urlmod = require('url');
var dnsx = require('./dnsx');
var spawn = require('child_process').spawn;
var FFMPEG = process.env.OPENTV_FFMPEG_PATH ||
  (process.platform === 'win32' ? path.join(__dirname, '..', 'bin', 'ffmpeg.exe') : '/usr/bin/ffmpeg');
var MAX_ENTRIES = 100;
var MAX_PROBES = 2;
var DEADLINE_MS = 8000;
var entries = {};
var order = [];
var queue = [];
var running = 0;

function seconds(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? (value > 100000 ? value / 1000 : value) : 0;
  }
  if (typeof value !== 'string') return 0;
  var raw = value.trim().toLowerCase().replace(/,/g, '.');
  if (!raw || /^(?:n\/a|none|null|undefined|unknown|infinity|—|-)$/.test(raw)) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return seconds(Number(raw));
  var clock = /^(\d+):(\d{1,2}(?:\.\d+)?)(?::(\d{1,2}(?:\.\d+)?))?$/.exec(raw);
  if (clock) {
    var first = Number(clock[1]), middle = Number(clock[2]);
    if (middle >= 60 || (clock[3] != null && Number(clock[3]) >= 60)) return 0;
    return clock[3] == null ? first * 60 + middle : first * 3600 + middle * 60 + Number(clock[3]);
  }
  var total = 0, found = false;
  var unit = /(\d+(?:\.\d+)?)\s*(horas?|hours?|hrs?|h|minutos?|minutes?|mins?|min|m|segundos?|seconds?|secs?|sec|seg|s)(?![a-z])/g;
  var match;
  while ((match = unit.exec(raw))) {
    var label = match[2];
    var multiplier = label.charAt(0) === 'h' ? 3600 : label.charAt(0) === 'm' ? 60 : 1;
    total += Number(match[1]) * multiplier;
    found = true;
  }
  return found && isFinite(total) && total > 0 ? total : 0;
}

function value(entry) {
  return { duration: entry.duration || 0, available: !!entry.duration, verified: !!(entry.duration && entry.verified),
    audio: entry.audio || [], subtitles: entry.subtitles || [] };
}

// Text subtitle codecs FFmpeg can turn into WebVTT; picture ones (PGS,
// VobSub, DVB) cannot become text and are listed as not usable.
var TEXT_SUBS = /^(subrip|srt|ass|ssa|webvtt|mov_text|text|microdvd|subviewer|tx3g)$/i;

// The subtitle tracks inside the file, in -map 0:s:<n> order.
function subtitleTracks(output) {
  var lines = String(output || '').split(/\r?\n/);
  var tracks = [], last = null, inInput = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^Input #0/.test(line)) { inInput = true; continue; }
    if (/^(Input #[1-9]|Output #|Stream mapping)/.test(line)) { inInput = false; }
    if (!inInput) { continue; }
    var stream = /^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\(([A-Za-z-]{2,8})\))?(?:\[[^\]]*\])?:\s*(\w+):\s*(.*)$/.exec(line);
    if (stream) {
      last = null;
      if (stream[2] !== 'Subtitle') { continue; }
      var codec = (/^([\w-]+)/.exec(stream[3]) || [])[1] || '';
      last = { lang: (stream[1] || '').toLowerCase(), title: '', codec: codec, text: TEXT_SUBS.test(codec),
        forced: /\(forced\)/.test(stream[3]), default: /\(default\)/.test(stream[3]) };
      tracks.push(last);
      continue;
    }
    var title = /^\s+title\s*:\s*(.+?)\s*$/.exec(line);
    if (title && last && !last.title) { last.title = title[1].slice(0, 80); }
  }
  return tracks.slice(0, 30);
}

// The audio tracks FFmpeg lists for the input, in the order -map 0:a:<n>
// numbers them: language tag, the track's own title ("Latino", "Castellano",
// "Commentary"…), codec and channels.
//   Stream #0:1(spa): Audio: ac3, 48000 Hz, 5.1(side), fltp, 640 kb/s (default)
//     Metadata:
//       title           : Latino
function audioTracks(output) {
  var lines = String(output || '').split(/\r?\n/);
  var tracks = [], last = null, inInput = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^Input #0/.test(line)) { inInput = true; continue; }
    if (/^(Input #[1-9]|Output #|Stream mapping)/.test(line)) { inInput = false; }
    if (!inInput) { continue; }
    var stream = /^\s*Stream #0:\d+(?:\[[^\]]*\])?(?:\(([A-Za-z-]{2,8})\))?(?:\[[^\]]*\])?:\s*(\w+):\s*(.*)$/.exec(line);
    if (stream) {
      last = null;
      if (stream[2] !== 'Audio') { continue; }
      var desc = stream[3];
      var ch = /\b(mono|stereo|2\.1|quad|4\.0|5\.0|5\.1|6\.1|7\.1)\b/.exec(desc);
      last = { lang: (stream[1] || '').toLowerCase(), title: '', codec: (/^([\w-]+)/.exec(desc) || [])[1] || '',
        channels: ch ? ch[1] : '', default: /\(default\)/.test(desc) };
      tracks.push(last);
      continue;
    }
    var title = /^\s+title\s*:\s*(.+?)\s*$/.exec(line);
    if (title && last && !last.title) { last.title = title[1].slice(0, 80); }
  }
  return tracks.slice(0, 16);
}

function register(stream) {
  stream = stream || {};
  var id = crypto.randomBytes(16).toString('hex');
  entries[id] = { stream: stream, duration: seconds(stream.duration), verified: stream.durationVerified === true,
    pending: false, completed: false, waiters: [] };
  order.push(id);
  while (order.length > MAX_ENTRIES) {
    var old = order.shift(), entry = entries[old];
    delete entries[old];
    if (entry && entry.cancel) entry.cancel();
  }
  return id;
}

function drain() {
  while (running < MAX_PROBES && queue.length) {
    var entry = queue.shift();
    if (!entry.pending || !entry.start) continue;
    entry.start();
  }
}

function get(id, done) {
  var entry = typeof id === 'string' && /^[0-9a-f]{32}$/.test(id) ? entries[id] : null;
  if (!entry) return done(new Error('Referencia de vídeo no disponible'));
  var known = seconds(entry.stream.duration);
  if (known && !entry.verified) entry.duration = known;
  if (known && entry.stream.durationVerified === true) entry.verified = true;
  // A positive catalogue value can be only the first buffered fragment. Probe
  // it once as well; only previously verified source metadata skips FFmpeg.
  if ((entry.duration && entry.verified) || entry.completed) return done(null, value(entry));
  entry.waiters.push(done);
  if (entry.pending) return;
  entry.pending = true;
  var child = null, output = '', active = false, finished = false, found = 0, grace = null;
  var timer = setTimeout(function () { finish(found); }, DEADLINE_MS);

  function finish(duration) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (grace) clearTimeout(grace);
    entry.audio = audioTracks(output);
    entry.subtitles = subtitleTracks(output);
    entry.pending = false;
    entry.completed = true;
    var sourceDuration = seconds(duration);
    entry.duration = sourceDuration || seconds(entry.stream.duration) || entry.duration || 0;
    entry.verified = !!sourceDuration || !!(entry.duration && entry.stream.durationVerified === true);
    entry.start = null;
    entry.cancel = null;
    if (active) { active = false; running--; }
    if (child) { try { child.kill('SIGKILL'); } catch (_) { /* exited already */ } }
    var waiting = entry.waiters;
    entry.waiters = [];
    for (var i = 0; i < waiting.length; i++) waiting[i](null, value(entry));
    drain();
  }
  entry.cancel = function () { finish(0); };
  entry.start = function () {
    if (!entry.pending || finished) return;
    active = true;
    running++;
    var target = require('./cachefly').ffmpegUrl(entry.stream.url || '');
    if (!/^https?:\/\//i.test(target)) return finish(0);
    var originalHost = '';
    // Reuse an address that playback already resolved through secure DNS. This
    // is cache-only: a missing entry never starts another resolver request.
    // HTTPS keeps its hostname so FFmpeg can verify its TLS certificate/SNI.
    var parsed = urlmod.parse(target);
    if (parsed.protocol === 'http:' && parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost' &&
        !require('net').isIP(parsed.hostname)) {
      var cached = dnsx.cached(parsed.hostname);
      var ip = cached && cached.ips && cached.ips[0];
      if (ip && require('net').isIP(ip) === 4) {
        originalHost = parsed.host;
        parsed.hostname = ip;
        parsed.host = ip + (parsed.port ? ':' + parsed.port : '');
        parsed.href = null;
        target = urlmod.format(parsed);
      }
    }
    var args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-rw_timeout', '5000000',
      '-probesize', '2M', '-analyzeduration', '3M'].concat(require('./ffmpeg-tls').args(target));
    var lines = [], headers = entry.stream.headers || {};
    Object.keys(headers).forEach(function (name) {
      // Request credentials are used only by FFmpeg; never send them to the UI.
      if (/\r|\n/.test(name + String(headers[name]))) return;
      if (originalHost && name.toLowerCase() === 'host') return;
      if (name.toLowerCase() === 'user-agent') args.push('-user_agent', String(headers[name]));
      else lines.push(name + ': ' + String(headers[name]) + '\r\n');
    });
    if (originalHost) lines.push('Host: ' + originalHost + '\r\n');
    if (lines.length) args.push('-headers', lines.join(''));
    // With no output FFmpeg exits after reading the input metadata. Exit code 1
    // is expected; only a finite Duration line is accepted as a successful probe.
    args.push('-i', target);
    try { child = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch (_) { return finish(0); }
    var tlsFailed = false;
    child.on('error', function () { finish(found); });
    child.on('close', function () {
      /* The source's certificate did not pass: once more without the check
         (ffmpeg-tls.js now skips it for that host). */
      if (!found && tlsFailed && !entry.tlsRetried && !finished) {
        entry.tlsRetried = true;
        active = false;
        running--;
        return entry.start();
      }
      finish(found);
    });
    child.stderr.on('data', function (chunk) {
      if (finished) return;
      if (!found && require('./ffmpeg-tls').noteFailure(target, chunk)) { tlsFailed = true; }
      output = (output + String(chunk)).slice(-65536);
      if (!found) {
        var match = /Duration:\s*(\d+:\d{2}:\d{2}(?:[.,]\d+)?)/i.exec(output);
        found = (match && seconds(match[1])) || 0;
        // The stream list (audio languages) comes right after the Duration
        // line; FFmpeg then exits on its own. Wait a moment for it.
        if (found) grace = setTimeout(function () { finish(found); }, 1500);
      }
      if (found && /At least one output file|Output #0/.test(output)) finish(found);
    });
  };
  queue.push(entry);
  drain();
}

function close() {
  var old = entries;
  entries = {};
  order = [];
  queue = [];
  Object.keys(old).forEach(function (id) { if (old[id].cancel) old[id].cancel(); });
}

module.exports = { register: register, get: get, seconds: seconds, close: close, audioTracks: audioTracks, subtitleTracks: subtitleTracks };
