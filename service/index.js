/*
 * OpenTV local service (PC through Electron, LG webOS through Luna).
 *
 * Movies and series come from the viewer's addons (the page talks to them
 * directly); this service does what a page cannot: play any file (FFmpeg
 * relay, header proxy), serve subtitles without CORS, torrents and downloads
 * (PC), and the viewer's M3U lists for TV en vivo.
 */
'use strict';

var Service = require('webos-service');
var pkg = require('./package.json');
var m3u = require('./m3u');
var proxy = require('./proxy');
var relay = require('./ffmpeg-relay');
var mediaDuration = require('./media-duration');
var dnsx = require('./dnsx');
var netdiag = require('./netdiag');
var tmdb = require('./tmdb');
var urlmod = require('url');

try {
  var httpsMod = require('https');
  var httpMod = require('http');
  if (httpsMod.globalAgent) { httpsMod.globalAgent.maxSockets = 32; }
  if (httpMod.globalAgent) { httpMod.globalAgent.maxSockets = 32; }
} catch (eAgent) { /* ignore */ }

var service = new Service(pkg.name);

/* Prevent unexpected network errors or aborts from terminating the service */
process.on('uncaughtException', function (err) {
  console.error('[opentv-service] uncaughtException:', (err && err.stack) || err);
});

/* Intercept process.exit so idle timers in webos-service do not kill the proxy */
try {
  process.exit = function (code) {
    console.log('[opentv-service] blocked process.exit(' + code + ') to keep streaming alive');
  };
} catch (eExit) { /* ignore */ }

/* Prolong idleTimeout to 24h and create a persistent activity */
if (service.activityManager) {
  try {
    service.activityManager.idleTimeout = 86400;
    service.activityManager.create('keepAlive', function (act) {
      console.log('[opentv-service] persistent activity created');
    });
  } catch (eAct) {
    console.log('[opentv-service] activityManager init note: ' + (eAct && eAct.message));
  }
}

function fail(message, err, code) {
  message.respond({
    returnValue: false,
    errorText: (err && err.message) || err || 'error',
    errorCode: code || (err && err.portalCode) || 1
  });
}

function respond(message, err, payload) {
  if (err) { return fail(message, err); }
  var out = payload || {};
  out.returnValue = true;
  message.respond(out);
}

/* tmdb({ list: 'movie-week' | 'tv-week' | 'movie-top' | 'tv-top' }): this
   week's trends for the home screen (TVs and Android; Electron calls
   tmdb.js directly). The key stays in the service. */
service.register('tmdb', function (message) {
  var payload = message.payload || {};
  tmdb.list(String(payload.list || ''), function (out) {
    if (out.error) { return message.respond({ returnValue: false, errorText: out.error, unavailable: !!out.unavailable }); }
    /* (item / episodes: the Spanish texts of a title, "es:" lists.) */
    respond(message, null, { items: out.items, item: out.item, episodes: out.episodes });
  });
});

service.register('ping', function (message) {
  message.respond({
    returnValue: true,
    service: pkg.name,
    version: pkg.version,
    proxyPort: proxy.port(),
    relayAvailable: relay.available(),
    ffmpegPath: relay.path(),
    relayPort: relay.port()
  });
});

/* keepAlive subscription keeps the Luna bus connection alive so the service never terminates */
service.register('keepAlive', function (message) {
  message.respond({
    returnValue: true,
    subscribed: !!message.isSubscription
  });
});

/* heartbeat method for periodic pings */
service.register('heartbeat', function (message) {
  message.respond({
    returnValue: true,
    alive: true,
    proxyPort: proxy.port(),
    timestamp: Date.now()
  });
});

service.register('mediaDuration', function (message) {
  mediaDuration.get(message.payload && message.payload.durationId, function (err, data) {
    respond(message, err, data);
  });
});

/* A link that already names the video file (…/movie.mp4, …/index.m3u8) and
   is not a resolver: nothing to follow, no extra round trip before playing. */
function looksLikeMediaFile(u) {
  var path = String(u || '').split(/[?#]/)[0];
  return /\.(mp4|m4v|mkv|webm|avi|mov|ts|m2ts|m3u8|mpd)$/i.test(path) && !/\/resolve\//i.test(path);
}

/* Some addon sources (e.g. /resolve/... endpoints) answer with a 302 redirect
 * to the real CDN file. Resolving that redirect once here avoids hitting the
 * addon's resolver on every FFmpeg/player Range request (duration probe,
 * keyframe seek, subtitle hash), which can trigger HTTP 429 rate limits and
 * hides the real file extension (.ts, .mp4, .mkv, .m3u8). */
function followRedirects(targetUrl, headers, done) {
  if (!/^https?:\/\//i.test(targetUrl) || /^https?:\/\/127\.0\.0\.1(?::|\/|$)/i.test(targetUrl) || looksLikeMediaFile(targetUrl)) {
    return done(targetUrl);
  }
  var current = targetUrl;
  var hops = 0;
  function step() {
    var parsed = urlmod.parse(current);
    var secure = parsed.protocol === 'https:';
    var mod = secure ? httpsMod : httpMod;
    if (!mod || !parsed.hostname) { return done(current); }
    var reqHeaders = { Range: 'bytes=0-0' };
    Object.keys(headers || {}).forEach(function (k) {
      if (!/\r|\n/.test(k + headers[k])) { reqHeaders[k] = String(headers[k]); }
    });
    var finished = false;
    function finish(nextUrl) {
      if (finished) { return; }
      finished = true;
      if (nextUrl && hops < 5) {
        current = nextUrl;
        hops++;
        return step();
      }
      done(current);
    }
    var req = mod.request({
      method: 'GET',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (secure ? 443 : 80),
      path: parsed.path || '/',
      headers: reqHeaders
    }, function (res) {
      var loc = res.statusCode >= 300 && res.statusCode < 400 && res.headers && res.headers.location;
      res.resume();
      try { req.abort(); } catch (e) { /* closed */ }
      if (loc) {
        var resolved = urlmod.resolve(current, String(loc));
        if (/^https?:\/\//i.test(resolved)) { return finish(resolved); }
      }
      finish(null);
    });
    req.on('error', function () { finish(null); });
    req.setTimeout(3500, function () {
      try { req.abort(); } catch (e) { /* closed */ }
      finish(null);
    });
    req.end();
  }
  step();
}

/* resolveExternal({url, headers, name, forceRelay, videoCopy, audioTrack, duration})
 * A link chosen in Stremio mode (an addon's HTTP/HLS source, or a torrent
 * already served on loopback by torrentStart). Same answer shape as resolve,
 * so the player handles it like a portal title:
 *   HLS               -> as is, or through the proxy when it needs headers
 *   MP4/WebM          -> as is (proxy when it needs headers); FFmpeg relay ready
 *   MKV/AVI/other     -> FFmpeg relay (copies the video when the UI allows it) */
service.register('resolveExternal', function (message) {
  var p = message.payload || {};
  var rawUrl = String(p.url || '');
  if (!/^https?:\/\//i.test(rawUrl)) { return fail(message, new Error('La fuente no tiene un enlace http(s) válido')); }
  var headers = (p.headers && typeof p.headers === 'object') ? p.headers : {};
  var hasHeaders = Object.keys(headers).length > 0;
  followRedirects(rawUrl, headers, function (url) {
    var name = String(p.name || '') + ' ' + url.split('?')[0];
    var isHls = /\.m3u8\b/i.test(name);
    var webReady = /\.(mp4|m4v|webm|mov)\b/i.test(name) && p.notWebReady !== true && p.notWebReady !== 'true';
    var stream = { url: url, headers: headers, duration: mediaDuration.seconds(p.duration) };

    if (isHls) {
      if (!hasHeaders) { return respond(message, null, { url: url, resolvedUrl: url, proxyPath: url, isHls: true, mime: 'application/vnd.apple.mpegurl' }); }
      return proxy.start(function (perr) {
        if (perr) { return fail(message, perr); }
        var token = proxy.add(url, headers, 0, '');
        respond(message, null, { resolvedUrl: url, proxyPath: proxy.baseUrl() + '/media/' + token + '/stream.m3u8', isHls: true, mime: 'application/vnd.apple.mpegurl' });
      });
    }

    var forceRelay = p.forceRelay === true || p.forceRelay === 'true' || !webReady;
    if (forceRelay && !relay.available()) {
      return fail(message, new Error('Este vídeo necesita el modo compatible y falta ffmpeg.exe en la carpeta bin de OpenTV'));
    }
    var relayOpts = { hevc: false, audio: Number(p.audioTrack) || 0, videoCopy: p.videoCopy === true || p.videoCopy === 'true' };
    var out = { resolvedUrl: url, mime: 'video/mp4', isHls: false, durationId: mediaDuration.register(stream) };
    if (relay.available()) { out.relayUrl = relay.register(stream, relayOpts); }
    if (forceRelay) {
      out.proxyPath = out.relayUrl;
      out.isRelay = true;
      return respond(message, null, out);
    }
    if (!hasHeaders) {
      out.proxyPath = url;
      return respond(message, null, out);
    }
    proxy.start(function (perr) {
      if (perr) { return fail(message, perr); }
      out.proxyPath = proxy.baseUrl() + '/media/' + proxy.add(url, headers, stream.duration, '') + '/stream.mp4';
      respond(message, null, out);
    });
  });
});

/* videoHash({url, headers}) -> { hash, size }: the OpenSubtitles hash of the
 * playing file, so the subtitles addon answers subtitles for this exact
 * release (in sync), as Stremio does. */
service.register('videoHash', function (message) {
  var p = message.payload || {};
  if (!/^https?:\/\//i.test(String(p.url || ''))) { return fail(message, new Error('Sin enlace')); }
  require('./video-hash').videoHash(String(p.url), (p.headers && typeof p.headers === 'object') ? p.headers : {}, function (err, info) {
    respond(message, err, info);
  });
});

/* proxySubtitles({subtitles:[{lang, url}]}): subtitle files from a Stremio
 * addon, served through the loopback proxy like the catalog's own. */
service.register('proxySubtitles', function (message) {
  var list = ((message.payload || {}).subtitles || []).filter(function (s) {
    return s && /^https?:\/\//i.test(String(s.url || ''));
  }).slice(0, 60);
  proxy.start(function (perr) {
    if (perr) { return fail(message, perr); }
    respond(message, null, { subtitles: list.map(function (s) {
      return { lang: String(s.lang || ''), format: 'srt', url: proxy.addSubtitle(s.url) };
    }) });
  });
});

/* subtitleCat({imdbId, title, year, kind, season, episode, filename}):
 * fallback subtitle search on SubtitleCat when OpenSubtitles fails or misses. */
service.register('subtitleCat', function (message) {
  require('./subtitlecat').search(message.payload || {}, function (err, subs) {
    respond(message, null, { subtitles: subs || [] });
  });
});

/* resolveShortCode({code}): resolves a Downloader numeric code (aftv.news/N)
 * or short code (!abc -> py.md/abc, abc -> cutt.ly/abc) to its target URL. */
service.register('resolveShortCode', function (message) {
  var code = String((message.payload || {}).code || '').trim();
  if (!code) { return fail(message, new Error('Código vacío')); }
  var startUrl = /^\d{4,9}$/.test(code) ? ('https://aftv.news/' + code)
    : (code.charAt(0) === '!' ? ('https://py.md/' + encodeURIComponent(code.slice(1)))
    : (/^[A-Za-z0-9_-]{2,48}$/.test(code) ? ('https://cutt.ly/' + encodeURIComponent(code)) : ''));
  if (!startUrl) { return fail(message, new Error('Código corto no válido')); }
  resolveRedirectTarget(startUrl, 0, function (err, target) {
    if (err || !target) { return fail(message, err || new Error('No se pudo resolver el código')); }
    respond(message, null, { url: target });
  });
});

/* pluginFetch({url, method, headers, body, bodyBase64, redirect, timeoutMs}): CORS-free
 * HTTP request for JS plugins (kino-plugin.json / plugin.js). */
service.register('pluginFetch', function (message) {
  var p = message.payload || {};
  var targetUrl = String(p.url || '').trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return respond(message, null, { ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: 'URL no válida' });
  }
  var method = String(p.method || 'GET').toUpperCase();
  var headers = (p.headers && typeof p.headers === 'object') ? p.headers : {};
  var bodyBuf = p.bodyBase64 != null ? Buffer.from(String(p.bodyBase64), 'base64')
    : (p.body != null ? Buffer.from(String(p.body), 'utf8') : null);
  var follow = p.redirect !== 'manual';
  var timeoutMs = Math.min(25000, Math.max(1500, Number(p.timeoutMs) || 12000));
  var allowLan = p.allowLan === true || p.allowLan === 'true';
  runPluginHttp(targetUrl, method, headers, bodyBuf, follow, timeoutMs, 0, allowLan, function (resObj) {
    respond(message, null, resObj);
  });
});

/* Each hop (the first request and every redirect) is checked by
   netguard and sent to the very address that was checked. */
function runPluginHttp(targetUrl, method, reqHeaders, bodyBuf, follow, timeoutMs, depth, allowLan, cb) {
  var done = false;
  function finish(out) { if (!done) { done = true; cb(out); } }
  if (depth > 5) { return finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: 'Demasiadas redirecciones' }); }
  var parsed = urlmod.parse(targetUrl);
  var mod = parsed.protocol === 'https:' ? httpsMod : httpMod;
  if (!mod || !parsed.hostname) { return finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: 'Host inválido' }); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: 'URL no válida' });
  }
  require('./netguard').check(parsed.hostname, allowLan, function (gErr, ip) {
    if (gErr) { return finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: gErr.message }); }
    sendPluginHttp(parsed, ip, targetUrl, method, reqHeaders, bodyBuf, follow, timeoutMs, depth, allowLan, finish);
  });
}

function sendPluginHttp(parsed, ip, targetUrl, method, reqHeaders, bodyBuf, follow, timeoutMs, depth, allowLan, finish) {
  var mod = parsed.protocol === 'https:' ? httpsMod : httpMod;
  var h = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' };
  for (var k in reqHeaders) {
    /* (A name or value Node refuses would throw inside the service.) */
    if (Object.prototype.hasOwnProperty.call(reqHeaders, k) && reqHeaders[k] != null &&
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && !/[^\t\x20-\x7e\x80-\xff]/.test(String(reqHeaders[k]))) {
      h[k] = String(reqHeaders[k]);
    }
  }
  if (bodyBuf && !h['Content-Length'] && !h['content-length']) {
    h['Content-Length'] = bodyBuf.length;
  }
  var defaultPort = parsed.protocol === 'https:' ? '443' : '80';
  if (!h.Host && !h.host) { h.Host = parsed.hostname + (parsed.port && String(parsed.port) !== defaultPort ? ':' + parsed.port : ''); }
  var opts = {
    hostname: ip,
    servername: /^[\d.]+$|:/.test(parsed.hostname) ? undefined : parsed.hostname,
    port: parsed.port,
    path: parsed.path || '/',
    method: method,
    headers: h
  };
  var req = mod.request(opts, function (res) {
    if (follow && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      var nextUrl = urlmod.resolve(targetUrl, res.headers.location);
      var nextMethod = (res.statusCode === 307 || res.statusCode === 308) ? method : 'GET';
      var nextBody = (nextMethod === method) ? bodyBuf : null;
      return runPluginHttp(nextUrl, nextMethod, reqHeaders, nextBody, follow, timeoutMs, depth + 1, allowLan, finish);
    }
    var chunks = [], size = 0;
    res.on('data', function (c) {
      size += c.length;
      if (size <= 2 * 1024 * 1024) { chunks.push(c); }
    });
    res.on('end', function () {
      var outHeaders = {};
      var setCookies = [];
      for (var hk in res.headers) {
        if (Object.prototype.hasOwnProperty.call(res.headers, hk) && res.headers[hk] != null) {
          var lowK = hk.toLowerCase();
          if (lowK === 'set-cookie') {
            setCookies = Array.isArray(res.headers[hk]) ? res.headers[hk].map(String) : [String(res.headers[hk])];
            outHeaders[lowK] = setCookies.join('\n');
          } else {
            outHeaders[lowK] = Array.isArray(res.headers[hk]) ? res.headers[hk].join(', ') : String(res.headers[hk]);
          }
        }
      }
      var buf = Buffer.concat(chunks);
      finish({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode || 0,
        url: targetUrl,
        headers: outHeaders,
        setCookies: setCookies,
        text: buf.toString('utf8'),
        base64: buf.toString('base64')
      });
    });
  });
  req.setTimeout(timeoutMs, function () {
    try { req.abort(); } catch (e) {}
    finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: 'Timeout' });
  });
  req.on('error', function (e) {
    finish({ ok: false, status: 0, url: targetUrl, headers: {}, text: '', error: (e && e.message) || 'Network error' });
  });
  if (bodyBuf) { req.write(bodyBuf); }
  req.end();
}

function resolveRedirectTarget(currentUrl, depth, cb) {
  if (depth > 6) { return cb(null, currentUrl); }
  var parsed = urlmod.parse(currentUrl);
  var mod = parsed.protocol === 'https:' ? httpsMod : httpMod;
  if (!mod || !parsed.hostname) { return cb(new Error('Dirección no válida')); }
  var req = mod.get({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path || '/',
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' }
  }, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      var next = urlmod.resolve(currentUrl, res.headers.location);
      return resolveRedirectTarget(next, depth + 1, cb);
    }
    var chunks = [], size = 0;
    res.on('data', function (c) {
      size += c.length;
      if (size <= 128 * 1024) { chunks.push(c); }
    });
    res.on('end', function () {
      var html = Buffer.concat(chunks).toString('utf8');
      /* go.aftvnews.com embeds the target link inside the HTML redirect page. */
      if (/aftvnews\.com/i.test(parsed.hostname)) {
        var m = /href=["'](https?:\/\/(?!(?:[a-z0-9-]+\.)?aftvnews\.com)[^"'<>]+)["']/i.exec(html);
        if (m && m[1]) { return cb(null, m[1]); }
      }
      cb(null, currentUrl);
    });
  });
  req.setTimeout(7000, function () { try { req.abort(); } catch (e) {} cb(new Error('Tiempo agotado al consultar el código')); });
  req.on('error', function (e) { cb(e); });
}

/* Torrents (PC only: the Electron service is the only one with the engine;
 * on other platforms these methods answer "not available"). */
var torrentsAvailable = !!(process.versions && process.versions.electron);
function torrents() { return require('./torrents'); }

service.register('torrentStart', function (message) {
  if (!torrentsAvailable) { return fail(message, new Error('Los torrents solo están disponibles en la app de PC')); }
  var p = message.payload || {};
  torrents().start({ infoHash: p.infoHash, fileIdx: p.fileIdx, sources: p.sources, alternatives: p.alternatives }, function (err, info) {
    respond(message, err, info);
  });
});

/* torrentProbe({torrents}): PC only, the people each torrent really has now. */
service.register('torrentProbe', function (message) {
  if (!torrentsAvailable) { return respond(message, null, { results: {} }); }
  torrents().probe(message.payload || {}, function (err, out) { respond(message, err, out); });
});

service.register('torrentStats', function (message) {
  if (!torrentsAvailable) { return respond(message, null, { active: false }); }
  respond(message, null, torrents().stats());
});

service.register('torrentStop', function (message) {
  if (!torrentsAvailable) { return respond(message, null, {}); }
  torrents().stop(function () { respond(message, null, {}); });
});

/* Downloads (PC only, like torrents): Videos\OpenTV, watched without internet. */
function downloads() { return require('./downloads'); }

service.register('downloadStart', function (message) {
  if (!torrentsAvailable) { return fail(message, new Error('Las descargas solo están disponibles en la app de PC')); }
  downloads().start(message.payload || {}, function (err, info) { respond(message, err, info); });
});

service.register('downloadList', function (message) {
  if (!torrentsAvailable) { return respond(message, null, { items: [], dir: '' }); }
  respond(message, null, downloads().list());
});

service.register('downloadAction', function (message) {
  if (!torrentsAvailable) { return fail(message, new Error('Las descargas solo están disponibles en la app de PC')); }
  var p = message.payload || {};
  downloads().action(String(p.id || ''), String(p.action || ''), function (err, info) { respond(message, err, info); });
});

service.register('downloadOpen', function (message) {
  if (!torrentsAvailable) { return fail(message, new Error('Las descargas solo están disponibles en la app de PC')); }
  downloads().open(String((message.payload || {}).id || ''), function (err, info) { respond(message, err, info); });
});

/* TV en vivo: the viewer's own M3U lists. */
service.register('fetchM3u', function (message) {
  var payload = message.payload || {};
  if (!payload.url) { return fail(message, new Error('url requerida')); }
  m3u.fetchM3u(payload.url, function (err, channels) {
    if (err) { return fail(message, err); }
    respond(message, null, { channels: channels || [] });
  });
});

/* epg({url, ids}): now and next for those channels, from the list's
   programme guide (service/epg.js). */
service.register('epg', function (message) {
  var payload = message.payload || {};
  require('./epg').get(payload.url, payload.ids, function (err, programmes) {
    if (err) { return fail(message, err); }
    respond(message, null, { programmes: programmes });
  });
});

/* epgSchedule({url, id}): one channel's programmes for the next 12 hours
   (TV en vivo → Programación). */
service.register('epgSchedule', function (message) {
  var payload = message.payload || {};
  require('./epg').schedule(payload.url, payload.id, function (err, programmes) {
    if (err) { return fail(message, err); }
    respond(message, null, { programmes: programmes || [] });
  });
});

/* resolveLive({streamUrl}): an M3U channel plays its own link. */
service.register('resolveLive', function (message) {
  var payload = message.payload || {};
  if (!payload.streamUrl) { return fail(message, new Error('El canal no tiene enlace')); }
  respond(message, null, { url: payload.streamUrl, proxyPath: payload.streamUrl, isHls: true });
});

/* abortMedia(): immediately kills all upstream sockets and buffers in proxy & relay */
service.register('abortMedia', function (message) {
  try { relay.stop(); } catch (eRelay) { /* ignore */ }
  try {
    proxy.killActiveStreams();
  } catch (eKill) { /* ignore */ }
  message.respond({ returnValue: true });
});

/* netdiag(): read-only report used by "Diagnóstico de red" (TVs). It
 * resolves the hosts the videos came from with the TV resolver and with DoH,
 * then tests TCP/TLS, so a blocked DNS can be told apart from a dead server. */
service.register('netdiag', function (message) {
  var payload = message.payload || {};
  /* Hosts seen recently are the ones that actually serve the video. Stale
     entries would make an old, already-changed CDN look like a network fault. */
  var hosts = [];
  var cached = dnsx.summary();
  for (var i = 0; i < cached.length; i++) {
    if (cached[i] && cached[i].host && cached[i].ageMs < 120000 && hosts.indexOf(cached[i].host) === -1) {
      hosts.push(cached[i].host);
    }
  }
  if (payload.hosts && payload.hosts.length) { hosts = payload.hosts.concat(hosts); }
  /* The page reports its real viewport so a cropped UI can be diagnosed from
     a photo of this screen (720p / 2K / 4K sets differ). */
  var screen = null;
  if (Number(payload.screenW) > 0 && Number(payload.screenH) > 0) {
    screen = {
      w: Number(payload.screenW),
      h: Number(payload.screenH),
      scale: Number(payload.screenScale) || 0,
      panelW: Number(payload.panelW) || 0,
      panelH: Number(payload.panelH) || 0
    };
  }
  var reportData = null;
  var layersData = null;
  var settled = false;
  function finish() {
    if (settled || !reportData || !layersData) { return; }
    settled = true;
    reportData.version = pkg.version;
    reportData.layers = layersData;
    reportData.codec = { h264: payload.codecH264 || '', hevc: payload.codecHEVC || '', hls: payload.codecHLS || '' };
    respond(message, null, reportData);
  }
  netdiag.run({ hosts: hosts, screen: screen }, function (err, report) {
    reportData = (err || !report) ? { verdict: 'incompleto', hosts: [], providers: [] } : report;
    finish();
  });
  var layerTimer = setTimeout(function () {
    if (!layersData) { layersData = {}; finish(); }
  }, 9000);
  netdiag.runLayers({
    liveUrl: payload.liveUrl || '', liveHeaders: payload.liveHeaders || {},
    vodUrl: payload.vodUrl || '', vodHeaders: payload.vodHeaders || {}
  }, function (lerr, layers) {
    clearTimeout(layerTimer);
    layersData = layers || {};
    finish();
  });
});

console.log('[opentv-service] started ' + pkg.name + ' v' + pkg.version);
