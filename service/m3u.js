'use strict';
// m3u.js  (ES5: also runs on the TV's old Node)
// TV en vivo: the viewer's own M3U lists. fetchM3u downloads a list (http/s,
// redirects, size cap, DoH-prepared like the rest of the service) and
// parseM3u turns it into channels { name, logo, group, streamUrl, channelCode }.

var https = require('https');
var http = require('http');
var url = require('url');
var dnsx = require('./dnsx');

function parseM3u(content) {
  var lines = (content || '').split(/\r?\n/);
  var channels = [];
  var cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf('#EXTINF:') === 0) {
      var commaIdx = line.indexOf(',');
      var meta = line.slice(8, commaIdx > 0 ? commaIdx : undefined);
      var title = commaIdx > 0 ? line.slice(commaIdx + 1).trim() : 'Canal';
      var logoMatch = /tvg-logo="([^"]+)"/i.exec(meta);
      var groupMatch = /group-title="([^"]+)"/i.exec(meta);
      cur = {
        name: title,
        logo: logoMatch ? logoMatch[1] : '',
        group: groupMatch ? groupMatch[1] : 'Addon',
        isAddon: true,
        now: 'En vivo',
        fav: false
      };
    } else if (line && line.indexOf('#') !== 0 && cur) {
      cur.url = line;
      cur.streamUrl = line;
      cur.channelCode = 'm3u_' + (channels.length + 1);
      cur.index = channels.length + 1;
      channels.push(cur);
      cur = null;
    }
  }
  return channels;
}

var M3U_MAX_BYTES = 20 * 1024 * 1024;
var M3U_MAX_REDIRECTS = 5;

function fetchM3u(urlStr, callback, redirects) {
  /* Abort, timeout and error can each fire: answer only once. */
  var answered = false;
  function done(err, chs) {
    if (answered) { return; }
    answered = true;
    callback(err, chs);
  }
  if (!urlStr) { return done(new Error('URL de la lista requerida')); }
  if (!/^https?:\/\//i.test(urlStr)) { return done(new Error('La lista debe ser una dirección http(s)')); }
  redirects = redirects || 0;
  if (redirects > M3U_MAX_REDIRECTS) { return done(new Error('Demasiadas redirecciones al descargar la lista')); }
  var mod = urlStr.indexOf('https://') === 0 ? https : http;
  var opts = url.parse(urlStr);
  opts.rejectUnauthorized = true;
  opts.method = 'GET';
  opts.headers = {
    'User-Agent': 'Mozilla/5.0 (SmartHub; SMART-TV; U; Linux/SmartTV) AppleWebKit/538.1+ (KHTML, like Gecko) Safari/538.1+'
  };
  dnsx.prepare(opts, function (prepErr, prepped) {
    if (prepErr) { return done(prepErr); }
    var req = mod.get(prepped, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchM3u(url.resolve(urlStr, res.headers.location), done, redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return done(new Error('HTTP ' + res.statusCode + ' al descargar la lista'));
      }
      var chunks = [];
      var size = 0;
      res.on('data', function (c) {
        if (answered) { return; }
        size += c.length;
        if (size > M3U_MAX_BYTES) {
          done(new Error('La lista es demasiado grande'));
          try { req.abort(); } catch (eAbort) { /* ignore */ }
          return;
        }
        chunks.push(c);
      });
      res.on('end', function () {
        if (answered) { return; }
        done(null, parseM3u(Buffer.concat(chunks).toString('utf8')));
      });
    });
    req.on('error', function (err) { done(err); });
    req.setTimeout(20000, function () { req.abort(); done(new Error('Tiempo de espera agotado al descargar la lista')); });
  });
}

module.exports = { parseM3u: parseM3u, fetchM3u: fetchM3u };
