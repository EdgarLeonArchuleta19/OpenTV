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

/* resolveExternal({url, headers, name, forceRelay, videoCopy, audioTrack, duration})
 * A link chosen in Stremio mode (an addon's HTTP/HLS source, or a torrent
 * already served on loopback by torrentStart). Same answer shape as resolve,
 * so the player handles it like a portal title:
 *   HLS               -> as is, or through the proxy when it needs headers
 *   MP4/WebM          -> as is (proxy when it needs headers); FFmpeg relay ready
 *   MKV/AVI/other     -> FFmpeg relay (copies the video when the UI allows it) */
service.register('resolveExternal', function (message) {
  var p = message.payload || {};
  var url = String(p.url || '');
  if (!/^https?:\/\//i.test(url)) { return fail(message, new Error('La fuente no tiene un enlace http(s) válido')); }
  var headers = (p.headers && typeof p.headers === 'object') ? p.headers : {};
  var hasHeaders = Object.keys(headers).length > 0;
  var name = String(p.name || '') + ' ' + url.split('?')[0];
  var isHls = /\.m3u8\b/i.test(name);
  var webReady = /\.(mp4|m4v|webm|mov)\b/i.test(name) && p.notWebReady !== true && p.notWebReady !== 'true';
  var stream = { url: url, headers: headers, duration: mediaDuration.seconds(p.duration) };

  if (isHls) {
    if (!hasHeaders) { return respond(message, null, { url: url, proxyPath: url, isHls: true, mime: 'application/vnd.apple.mpegurl' }); }
    return proxy.start(function (perr) {
      if (perr) { return fail(message, perr); }
      var token = proxy.add(url, headers, 0, '');
      respond(message, null, { proxyPath: proxy.baseUrl() + '/media/' + token + '/stream.m3u8', isHls: true, mime: 'application/vnd.apple.mpegurl' });
    });
  }

  var forceRelay = p.forceRelay === true || p.forceRelay === 'true' || !webReady;
  if (forceRelay && !relay.available()) {
    return fail(message, new Error('Este vídeo necesita el modo compatible y falta ffmpeg.exe en la carpeta bin de OpenTV'));
  }
  var relayOpts = { hevc: false, audio: Number(p.audioTrack) || 0, videoCopy: p.videoCopy === true || p.videoCopy === 'true' };
  var out = { mime: 'video/mp4', isHls: false, durationId: mediaDuration.register(stream) };
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
