/*
 * XuperTV webOS service: portal catalog + playback resolver.
 *
 * Why a service: the Magis portal sends no Access-Control-Allow-Origin and
 * rejects OPTIONS, so a packaged web app cannot POST to it directly. Node
 * services are not bound by the page's CORS rules, so the encrypted protocol
 * runs here and the app receives plain JSON through Luna.
 */
'use strict';

var Service = require('webos-service');
var pkg = require('./package.json');
var magis = require('./magis');
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
    respond(message, null, { items: out.items });
  });
});

service.register('ping', function (message) {
  message.respond({
    returnValue: true,
    service: pkg.name,
    version: pkg.version,
    portalHosts: magis.constants.ROOT_CODES ? 'magis' : 'none',
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

/* home({root}) -> { items:[...] } for one portal root */
service.register('home', function (message) {
  var root = (message.payload && message.payload.root) || 'movies';
  magis.home(root, function (err, data) { respond(message, err, data); });
});

/* search({value, pageNum, pageSize}) -> { items:[...], total } */
service.register('search', function (message) {
  var p = message.payload || {};
  var value = p.value || '';
  magis.search(value, { pageNum: p.pageNum, pageSize: p.pageSize }, function (err, data) { respond(message, err, data); });
});

/* detail({contentId}) -> { item, episodes, seasons } */
service.register('detail', function (message) {
  var id = message.payload && message.payload.contentId;
  magis.detail(id, function (err, data) { respond(message, err, data); });
});

service.register('mediaDuration', function (message) {
  mediaDuration.get(message.payload && message.payload.durationId, function (err, data) {
    respond(message, err, data);
  });
});

/* Subtitle files live on a CDN without CORS headers, so the page cannot read
 * them directly.  Rewrite every subtitle URL to a loopback proxy URL. */
function attachSubtitles(payload) {
  if (!payload || !payload.subtitles || !payload.subtitles.length) { return payload; }
  payload.subtitles = payload.subtitles.map(function (sub) {
    return {
      lang: sub.lang,
      format: sub.format,
      url: proxy.addSubtitle(sub.url)
    };
  });
  return payload;
}

/* resolve({contentId, seriesContentId, playbackMode, trackIndex}) */
function resolveStream(message, forceRelay) {
  var payload = message.payload || {};
  var options = { trackIndex: payload.trackIndex, preferHeight: payload.preferHeight };
  magis.resolve(payload.contentId, payload.seriesContentId, options, function (err, stream) {
    if (err) { return fail(message, err); }
    if (!stream || !/^https?:\/\//i.test(stream.url || '')) {
      return fail(message, new Error('El portal no devolvió un enlace de vídeo válido'));
    }
    stream.duration = mediaDuration.seconds(stream.duration) || mediaDuration.seconds(payload.duration);
    stream.durationId = mediaDuration.register(stream);

    var isHevc = /hevc|h\.?265/i.test(stream.codec || '') || /hevc|h\.?265/i.test(stream.mime || '');
    /* 1.4.2 renamed the UI modes to direct/relay; accept both spellings so an
       older app build and the current one both reach the relay. */
    var useSmoothMode = forceRelay || payload.forceRelay === true || payload.forceRelay === 'true' ||
      payload.playbackMode === 'smooth' || payload.playbackMode === 'relay';
    /* When smooth mode (Modo Fluido) is requested by the user, always route via
       the on-device FFmpeg relay so the native player receives clean fragmented MP4. */
    if (useSmoothMode && !relay.available()) {
      return fail(message, new Error('El modo compatible no está disponible: falta ffmpeg.exe en la carpeta bin de OpenTV'));
    }

    /* Keep the proven Fluent path single-hop: FFmpeg consumes the resolved
       portal stream itself and emits fragmented MP4 on :8787.  Sending the
       same stream through proxy -> FFmpeg adds a second local HTTP consumer;
       on webOS it can leave both waiting for the other side and the player
       remains permanently at "Conectando…".  The proxy is still started for
       subtitle URLs only. */
    /* The UI sets videoCopy when its player decodes this video codec itself
       (for example Electron with HEVC): FFmpeg then copies the video and only
       converts Dolby audio to AAC, instead of re-encoding everything. */
    var relayOpts = {
      hevc: isHevc,
      audio: Number(payload.audioTrack) || 0,
      videoCopy: payload.videoCopy === true || payload.videoCopy === 'true'
    };
    if (useSmoothMode) {
      var relayUrl = relay.register(stream, relayOpts);
      console.log('[opentv-service] routing stream via direct ffmpeg relay: ' + relayUrl);
      stream.proxyPath = relayUrl;
      stream.mime = 'video/mp4';
      stream.isRelay = true;
      stream.isHls = false;
      proxy.start(function (perr) {
        if (perr) { return fail(message, perr); }
        respond(message, null, attachSubtitles(stream));
      });
      return;
    }

    var streamHost = (urlmod.parse(stream.url || '').hostname) || '';
    dnsx.resolve(streamHost, function (dnsErr, dnsRes) {
      var resolvedIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';

      proxy.start(function (perr, port) {
        if (perr) { return fail(message, perr); }
        var token = proxy.add(stream.url, stream.headers, stream.duration, resolvedIp);
        var extension = stream.mime === 'video/mp4' ? 'mp4' : 'ts';
        stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.' + extension;
        if (relay.available()) {
          stream.relayUrl = relay.register(stream, relayOpts);
        }
        stream.isHls = false;
        attachSubtitles(stream);
        respond(message, null, stream);
      });
    });
  });
}
service.register('resolve', function (message) { resolveStream(message, false); });

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
  torrents().start({ infoHash: p.infoHash, fileIdx: p.fileIdx, sources: p.sources }, function (err, info) {
    respond(message, err, info);
  });
});

service.register('torrentStats', function (message) {
  if (!torrentsAvailable) { return respond(message, null, { active: false }); }
  respond(message, null, torrents().stats());
});

service.register('torrentStop', function (message) {
  if (!torrentsAvailable) { return respond(message, null, {}); }
  torrents().stop(function () { respond(message, null, {}); });
});
/* Separate Luna method: avoids older webOS bridges dropping custom boolean
   fields from a resolve payload. */
service.register('resolveSmooth', function (message) { resolveStream(message, true); });

/* mediaInfo({contentId, seriesContentId}) -> { audio, subtitles, tracks }
 * Audio languages and subtitle files for the in-player dialog.  It runs
 * before playback and returns no playable URL, license or headers. */
service.register('mediaInfo', function (message) {
  var payload = message.payload || {};
  magis.mediaInfo(payload.contentId, payload.seriesContentId, function (err, info) {
    if (err) { return fail(message, err); }
    proxy.start(function (perr) {
      if (perr) { return fail(message, perr); }
      respond(message, null, attachSubtitles(info));
    });
  });
});

service.register('liveChannels', function (message) {
  var payload = message.payload || {};
  magis.getLiveChannels(payload.columnId, payload.pageNum, payload.pageSize, function (err, channels, hasMore) {
    if (err) { return fail(message, err); }
    respond(message, null, {
      channels: channels || [],
      pageNum: Math.max(1, parseInt(payload.pageNum, 10) || 1),
      hasMore: !!hasMore
    });
  });
});

service.register('liveCategories', function (message) {
  magis.getLiveCategories(function (err, categories) {
    if (err) { return fail(message, err); }
    respond(message, null, { categories: categories || [] });
  });
});

service.register('fetchM3u', function (message) {
  var payload = message.payload || {};
  if (!payload.url) { return fail(message, new Error('url requerida')); }
  magis.fetchM3u(payload.url, function (err, channels) {
    if (err) { return fail(message, err); }
    respond(message, null, { channels: channels || [] });
  });
});

service.register('resolveLive', function (message) {
  var payload = message.payload || {};
  if (payload.streamUrl) {
    return respond(message, null, { url: payload.streamUrl, proxyPath: payload.streamUrl, isHls: true });
  }
  if (!payload.channelCode) { return fail(message, new Error('channelCode requerido')); }
  magis.resolveLive(payload.channelCode, function (err, stream) {
    if (err) { return fail(message, err); }
    var streamHost = (urlmod.parse(stream.url || '').hostname) || '';
    dnsx.resolve(streamHost, function (dnsErr, dnsRes) {
      var resolvedIp = (dnsRes && dnsRes.ips && dnsRes.ips[0]) || '';
      proxy.start(function (perr) {
        if (perr) { return fail(message, perr); }
        var token = proxy.add(stream.url, stream.headers, 0, resolvedIp, stream.backupUrls);
        stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.m3u8';
        stream.isHls = true;
        respond(message, null, stream);
      });
    });
  });
});

/* abortMedia(): immediately kills all upstream sockets and buffers in proxy & relay */
service.register('abortMedia', function (message) {
  try { relay.stop(); } catch (eRelay) { /* ignore */ }
  try {
    proxy.killActiveStreams();
  } catch (eKill) { /* ignore */ }
  message.respond({ returnValue: true });
});

/* prewarm(): start the anonymous session so the first home call is fast */
service.register('prewarm', function (message) {
  magis.ensureSession(function (err) {
    if (err) { return fail(message, err); }
    message.respond({ returnValue: true, sn: magis.session.sn, userId: magis.session.userId });
  });
});

/* netdiag(): read-only report used by "Diagnóstico de red".
 * It resolves the portal/CDN hostnames with the TV resolver and with DoH,
 * then tests TCP/TLS, so a blocked DNS can be told apart from a dead server. */
service.register('netdiag', function (message) {
  var payload = message.payload || {};
  var hosts = [];
  var constants = magis.constants || {};
  if (constants.HOSTS && constants.HOSTS.length) {
    hosts = constants.HOSTS.slice(0);
  }
  /* CDN hosts seen recently are the ones that actually serve the video.  Stale
     entries would make an old, already-changed CDN look like a network fault. */
  var cached = dnsx.summary();
  for (var i = 0; i < cached.length; i++) {
    if (cached[i] && cached[i].host && cached[i].ageMs < 120000 && hosts.indexOf(cached[i].host) === -1) {
      hosts.push(cached[i].host);
    }
  }
  if (payload.hosts && payload.hosts.length) {
    hosts = payload.hosts.concat(hosts);
  }
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
    /* Codec info forwarded from the browser page */
    reportData.codec = {
      h264: payload.codecH264 || '',
      hevc: payload.codecHEVC || '',
      hls:  payload.codecHLS  || ''
    };
    respond(message, null, reportData);
  }

  /* 1. Run DNS and host reachability check */
  netdiag.run({ hosts: hosts, screen: screen }, function (err, report) {
    reportData = (err || !report) ? { verdict: 'incompleto', hosts: [], providers: [] } : report;
    finish();
  });

  /* 2. Run session and layer check in parallel with 9s deadline */
  var layerTimer = setTimeout(function () {
    if (!layersData) {
      var s = magis.session || {};
      layersData = {
        portal:  { ok: false, error: 'tiempo agotado' },
        session: { userId: s.userId ? '✓' : '?', token: s.userToken ? '✓' : '?', ready: !!s.ready, error: 'tiempo agotado' }
      };
      finish();
    }
  }, 9000);

  magis.ensureSession(function (sessErr) {
    var sess = magis.session || {};
    var portalHost = (magis.constants && magis.constants.HOSTS && magis.constants.HOSTS[0]) || '';
    var portalUrl  = portalHost ? ('https://' + portalHost + '/api/portalCore/v8/active') : '';
    var layerOpts = {
      portalUrl:   portalUrl,
      session:     { userId: sess.userId || '', userToken: sess.userToken || '', ready: !!sess.ready, error: sessErr ? (sessErr.message || 'error') : '' },
      liveUrl:     payload.liveUrl  || '',
      liveHeaders: payload.liveHeaders || {},
      vodUrl:      payload.vodUrl   || '',
      vodHeaders:  payload.vodHeaders  || {}
    };

    netdiag.runLayers(layerOpts, function (lerr, layers) {
      clearTimeout(layerTimer);
      layersData = layers || {};
      finish();
    });
  });
});

console.log('[opentv-service] started ' + pkg.name + ' v' + pkg.version);
