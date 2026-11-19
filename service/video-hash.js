'use strict';
// video-hash.js  (ES5: also runs on the TV's old Node)
// The OpenSubtitles hash of a video (size + the first and last 64 KB, as
// 64-bit little-endian words): the subtitles addon uses it, like Stremio,
// to answer subtitles made for this exact file (same cut, same frame rate),
// which is what keeps them in sync. Read with two Range requests, so it
// works for a torrent on loopback and for an addon's direct link.

var http = require('http');
var https = require('https');
var urlmod = require('url');

var CHUNK = 65536;
var cache = {};

function request(url, headers, range, redirects, done) {
  var u = urlmod.parse(url);
  var h = {};
  Object.keys(headers || {}).forEach(function (k) { if (!/\r|\n/.test(k + headers[k])) { h[k] = String(headers[k]); } });
  h.Range = range;
  var mod = u.protocol === 'https:' ? https : http;
  var finished = false;
  function end(err, a, b) { if (!finished) { finished = true; done(err, a, b); } }
  var req = mod.get({ protocol: u.protocol, hostname: u.hostname, port: u.port, path: u.path, headers: h }, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
      res.resume();
      return request(urlmod.resolve(url, res.headers.location), headers, range, redirects + 1, end);
    }
    if (res.statusCode !== 206) { res.resume(); return end(new Error('sin Range (' + res.statusCode + ')')); }
    var total = Number((/\/(\d+)$/.exec(res.headers['content-range'] || '') || [])[1]) || 0;
    var parts = [], got = 0;
    res.on('data', function (c) {
      parts.push(c);
      got += c.length;
      if (got >= CHUNK) { try { req.abort(); } catch (e) { /* closed */ } end(null, Buffer.concat(parts).slice(0, CHUNK), total); }
    });
    res.on('end', function () { end(null, Buffer.concat(parts).slice(0, CHUNK), total); });
    res.on('error', function (e) { end(e); });
  });
  req.on('error', function (e) { end(e); });
  req.setTimeout(15000, function () { try { req.abort(); } catch (e) { /* closed */ } end(new Error('tiempo agotado')); });
}

/* Adds the 64-bit little-endian words of buf into sum = [lo, hi] (uint32). */
function addWords(sum, buf) {
  for (var i = 0; i + 8 <= buf.length; i += 8) {
    var lo = sum[0] + buf.readUInt32LE(i);
    var carry = lo > 0xffffffff ? 1 : 0;
    sum[0] = lo >>> 0;
    sum[1] = (sum[1] + buf.readUInt32LE(i + 4) + carry) >>> 0;
  }
}

function hex8(n) { var s = (n >>> 0).toString(16); while (s.length < 8) { s = '0' + s; } return s; }

/* hash(buffers…, size) → 16 hex chars. */
function compute(head, tail, size) {
  var sum = [size % 4294967296 >>> 0, Math.floor(size / 4294967296) >>> 0];
  addWords(sum, head);
  addWords(sum, tail);
  return hex8(sum[1]) + hex8(sum[0]);
}

/* videoHash(url, headers, done(err, { hash, size })) */
function videoHash(url, headers, done) {
  if (cache[url]) { return done(null, cache[url]); }
  request(url, headers, 'bytes=0-' + (CHUNK - 1), 0, function (err, head, size) {
    if (err) { return done(err); }
    if (!(size >= CHUNK * 2)) { return done(new Error('archivo demasiado pequeño')); }
    request(url, headers, 'bytes=' + (size - CHUNK) + '-' + (size - 1), 0, function (err2, tail) {
      if (err2) { return done(err2); }
      if (head.length < CHUNK || tail.length < CHUNK) { return done(new Error('lectura incompleta')); }
      var out = { hash: compute(head, tail, size), size: size };
      cache[url] = out;
      done(null, out);
    });
  });
}

module.exports = { videoHash: videoHash, compute: compute };
