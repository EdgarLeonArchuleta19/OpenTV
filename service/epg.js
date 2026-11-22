'use strict';
// epg.js  (ES5: same style as m3u.js)
// TV en vivo: the programme guide of an M3U list. The list's header names
// an XMLTV file (#EXTM3U url-tvg="…", often .xml.gz, up to ~8 MB of text);
// it is downloaded and read as it arrives, keeping per channel only the
// programmes of the next hours with a short title and description. The page
// asks for the channels it shows:
//
//   get(url, ids, done) -> done(err, { id: [ { s, e, t, d }, … ] })   (now and next)
//   schedule(url, id, done) -> done(err, [ { s, e, t, d }, … ])          (one channel, 12 h)
//
// One copy per guide link, kept for EPG_TTL_MS; Android has the same in Epg.java.

var https = require('https');
var http = require('http');
var url = require('url');
var zlib = require('zlib');
var dnsx = require('./dnsx');

var EPG_TTL_MS = 6 * 60 * 60 * 1000;
var EPG_FAIL_TTL_MS = 10 * 60 * 1000;        /* a guide that failed is tried again later */
var EPG_AHEAD_MS = 12 * 60 * 60 * 1000;      /* programmes kept: from now to 12 h ahead */
var EPG_PER_CHANNEL = 10;
var EPG_ANSWER_PER_CHANNEL = 3;              /* now and the next two */
var EPG_SCHEDULE_MAX = 60;                   /* one channel's day: programmes kept */
var EPG_SCHEDULE_CACHE = 12;                 /* channels whose day is kept */
var EPG_MAX_IDS = 4000;
var EPG_MAX_BYTES = 80 * 1024 * 1024;        /* text after decompressing */
var EPG_MAX_REDIRECTS = 5;
var TITLE_MAX = 120;
var DESC_MAX = 220;

var guides = {};   /* url -> { at, failed, byId, waiters } */

/* "20261119050428 +0000" -> ms. */
function xmltvTime(text) {
  var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(String(text || '').trim());
  if (!m) { return 0; }
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) { t -= (m[7] === '-' ? -1 : 1) * ((+m[8]) * 60 + (+(m[9] || 0))) * 60000; }
  return t;
}

function unescapeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, function (a, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (a, d) { return String.fromCharCode(+d); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function clip(s, max) { return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s; }

function attr(tag, name) {
  var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? m[1] : '';
}

/* Reads XMLTV text as it arrives: complete <programme>…</programme>
   blocks go into byId (within [now, now + 12 h]); the rest waits for the
   next piece. */
function makeReader(byId, opts) {
  opts = opts || {};
  var cap = opts.cap || EPG_PER_CHANNEL;
  var buf = '';
  var now = Date.now();
  var until = now + EPG_AHEAD_MS;
  function take(block) {
    var open = /^<programme\b[^>]*>/.exec(block);
    if (!open) { return; }
    var id = unescapeXml(attr(open[0], 'channel'));
    var s = xmltvTime(attr(open[0], 'start'));
    var e = xmltvTime(attr(open[0], 'stop'));
    if (!id || !s || !e || e <= now || s >= until) { return; }
    if (opts.only && id !== opts.only) { return; }
    var title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(block);
    var desc = /<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(block);
    var list = byId[id] || (byId[id] = []);
    if (list.length >= cap * 2) { return; }
    var p = { s: s, e: e, t: clip(unescapeXml(title ? title[1] : ''), TITLE_MAX) || 'Programa' };
    var d = desc ? clip(unescapeXml(desc[1]), DESC_MAX) : '';
    if (d) { p.d = d; }
    list.push(p);
  }
  return {
    write: function (text) {
      buf += text;
      var from = 0;
      for (;;) {
        var a = buf.indexOf('<programme', from);
        if (a === -1) { break; }
        var b = buf.indexOf('</programme>', a);
        if (b === -1) { from = a; break; }
        take(buf.slice(a, b + 12));
        from = b + 12;
      }
      buf = from > 0 ? buf.slice(from) : (buf.length > 1048576 ? buf.slice(-65536) : buf);
    },
    end: function () {
      Object.keys(byId).forEach(function (id) {
        byId[id].sort(function (x, y) { return x.s - y.s; });
        if (byId[id].length > cap) { byId[id] = byId[id].slice(0, cap); }
      });
    }
  };
}

function download(urlStr, reader, done, redirects) {
  var answered = false;
  function finish(err) { if (!answered) { answered = true; done(err); } }
  redirects = redirects || 0;
  if (!/^https?:\/\//i.test(urlStr)) { return finish(new Error('La guía debe ser una dirección http(s)')); }
  if (redirects > EPG_MAX_REDIRECTS) { return finish(new Error('Demasiadas redirecciones al descargar la guía')); }
  var mod = urlStr.indexOf('https://') === 0 ? https : http;
  var opts = url.parse(urlStr);
  opts.rejectUnauthorized = true;
  opts.method = 'GET';
  opts.headers = { 'User-Agent': 'Mozilla/5.0 (OpenTV)', 'Accept-Encoding': 'gzip' };
  dnsx.prepare(opts, function (prepErr, prepped) {
    if (prepErr) { return finish(prepErr); }
    var req = mod.get(prepped, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(url.resolve(urlStr, res.headers.location), reader, finish, redirects + 1);
      }
      if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode + ' al descargar la guía')); }
      var size = 0;
      var text = null;   /* the decoded stream, chosen from the first bytes */
      function feed(s) {
        s.setEncoding('utf8');
        s.on('data', function (chunk) {
          if (answered) { return; }
          size += chunk.length;
          if (size > EPG_MAX_BYTES) { finish(new Error('La guía es demasiado grande')); try { req.abort(); } catch (e) { /* ignore */ } return; }
          reader.write(chunk);
        });
        s.on('end', function () { reader.end(); finish(null); });
        s.on('error', function (err) { finish(err); });
      }
      res.once('data', function (first) {
        var gz = first.length > 1 && first[0] === 0x1f && first[1] === 0x8b;
        text = gz ? zlib.createGunzip() : new (require('stream').PassThrough)();
        feed(text);
        text.write(first);
        res.pipe(text);
      });
      res.on('end', function () { if (!text) { reader.end(); finish(null); } });
    });
    req.on('error', function (err) { finish(err); });
    req.setTimeout(30000, function () { req.abort(); finish(new Error('Tiempo de espera agotado al descargar la guía')); });
  });
}

function load(urlStr, done) {
  var g = guides[urlStr];
  var now = Date.now();
  if (g && !g.waiters && now - g.at < (g.failed ? EPG_FAIL_TTL_MS : EPG_TTL_MS)) { return done(g.failed ? new Error(g.failed) : null, g); }
  if (g && g.waiters) { g.waiters.push(done); return; }
  g = guides[urlStr] = { at: now, failed: '', byId: {}, waiters: [done] };
  download(urlStr, makeReader(g.byId), function (err) {
    var w = g.waiters;
    g.waiters = null;
    g.at = Date.now();
    if (err) { g.failed = err.message || 'No se pudo leer la guía'; g.byId = {}; }
    w.forEach(function (cb) { cb(err || null, g); });
  });
}

function get(urlStr, ids, done) {
  if (!urlStr) { return done(new Error('url requerida')); }
  load(urlStr, function (err, g) {
    if (err) { return done(err); }
    var now = Date.now();
    var out = {};
    (Array.isArray(ids) ? ids : []).slice(0, EPG_MAX_IDS).forEach(function (id) {
      var list = g.byId[String(id)];
      if (!list) { return; }
      var shown = [];
      for (var i = 0; i < list.length && shown.length < EPG_ANSWER_PER_CHANNEL; i++) {
        if (list[i].e > now) { shown.push(list[i]); }
      }
      if (shown.length) { out[id] = shown; }
    });
    done(null, out);
  });
}

/* One channel's programmes for the next 12 h (the "Programación" window).
   The shared copy keeps few per channel (memory on a 1 GB TV); when those
   do not reach far enough, the guide is read again keeping only this
   channel, and that day is kept a while for a few channels. */
var schedules = {};   /* url + '|' + id -> { at, list } */

function schedule(urlStr, id, done) {
  id = String(id || '');
  if (!urlStr || !id) { return done(new Error('url e id requeridos')); }
  var key = urlStr + '|' + id;
  var now = Date.now();
  var hit = schedules[key];
  if (hit && now - hit.at < EPG_TTL_MS) { return done(null, hit.list.filter(function (p) { return p.e > now; })); }
  load(urlStr, function (err, g) {
    if (err) { return done(err); }
    var have = (g.byId[id] || []).filter(function (p) { return p.e > Date.now(); });
    var reach = have.length ? have[have.length - 1].e : 0;
    if (have.length && (have.length < EPG_PER_CHANNEL || reach >= Date.now() + EPG_AHEAD_MS - 60 * 60 * 1000)) {
      return done(null, have);
    }
    var byId = {};
    download(urlStr, makeReader(byId, { only: id, cap: EPG_SCHEDULE_MAX }), function (dErr) {
      if (dErr) { return done(null, have); }
      var list = byId[id] || have;
      var keys = Object.keys(schedules);
      if (keys.length >= EPG_SCHEDULE_CACHE) {
        keys.sort(function (a, b) { return schedules[a].at - schedules[b].at; });
        delete schedules[keys[0]];
      }
      schedules[key] = { at: Date.now(), list: list };
      done(null, list);
    });
  });
}

module.exports = { get: get, schedule: schedule, _xmltvTime: xmltvTime, _makeReader: makeReader, _unescapeXml: unescapeXml };
