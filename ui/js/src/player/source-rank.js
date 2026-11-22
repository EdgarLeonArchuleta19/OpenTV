/* player/source-rank.js — Modo Addons (solo PC): qué es cada fuente (idiomas,
   calidad, CAM, códec, sitio), las preferencias de fuentes del usuario (como
   la página "configure" de Torrentio, pero aplicadas por OpenTV a todos los
   addons) y la elección de la mejor fuente para este usuario y su internet.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var SOURCE_PREFS_KEY = 'opentv_source_prefs_v1';
var NET_SPEED_KEY = 'opentv_net_speed_v1';
var SOURCE_HEALTH_KEY = 'opentv_source_health_v1';
var sessionDirectMbps = 0;

/* Languages a source can be tagged with, in the order the chips show them. */
var SOURCE_LANG_LABELS = {
  latino: 'Latino', castellano: 'Castellano', es: 'Español', en: 'Inglés', pt: 'Portugués',
  fr: 'Francés', it: 'Italiano', de: 'Alemán', ru: 'Ruso', ja: 'Japonés', ko: 'Coreano', multi: 'Multi'
};
/* The languages the viewer can put first (Ajustes → Preferencias de addons). */
var SOURCE_PREF_LANGS = ['latino', 'castellano', 'en', 'pt'];

/* Flags as the addons write them (Torrentio: 🇲🇽 = latino, 🇪🇸 = España). */
var SOURCE_FLAGS = [
  ['🇲🇽', 'latino'], ['🇦🇷', 'latino'], ['🇨🇴', 'latino'], ['🇨🇱', 'latino'], ['🇵🇪', 'latino'], ['🇻🇪', 'latino'],
  ['🇪🇸', 'castellano'], ['🇬🇧', 'en'], ['🇺🇸', 'en'], ['🇵🇹', 'pt'], ['🇧🇷', 'pt'], ['🇫🇷', 'fr'],
  ['🇮🇹', 'it'], ['🇩🇪', 'de'], ['🇷🇺', 'ru'], ['🇯🇵', 'ja'], ['🇰🇷', 'ko'], ['🌎', 'multi'], ['🌐', 'multi'], ['🌍', 'multi']
];

/* "Subtítulos en español" is not Spanish audio. */
var SUBS_ES_RE = /\b(vose|v\.o\.s\.e|subtitulad[oa]s?|subs?[\s._-]*(esp|spa|español|espanol|latino|lat|es))\b/gi;
var LATINO_RE = /\b(latino|latina|latam|lat|latinoamerican[oa]|espa[ñn]ol[\s._-]*latino|dual[\s._-]*lat(ino)?)\b/i;
var CASTELLANO_RE = /\b(castellano|castilian|es[-_]es|espa[ñn]ol[\s._-]*(de[\s._-]*)?espa[ñn]a)\b/i;
var SPANISH_RE = /\b(spanish|espa[ñn]ol|esp|spa)\b/i;
var ENGLISH_RE = /\b(english|eng|ingl[eé]s)\b/i;
var MULTI_RE = /\b(multi([\s._-]?(audio|lang|language|sub))?|dual([\s._-]?audio)?)\b/i;
var CAM_RE = /\b((hd)?cam(rip)?|hd-?ts|telesync|tele-?cine|hd-?tc|(dvd|bd)?scr(eener)?|pre-?dvd)\b/i;

/* What a source is, from what the addon wrote about it (name, title, file). */
function sourceTags(name, title, filename) {
  var raw = String(name || '') + '\n' + String(title || '') + '\n' + String(filename || '');
  var text = raw.replace(/[\[\]()]/g, ' ');
  var subsEs = false;
  var audioText = text.replace(SUBS_ES_RE, function () { subsEs = true; return ' '; });
  var langs = [];
  function add(l) { if (langs.indexOf(l) === -1) { langs.push(l); } }
  for (var i = 0; i < SOURCE_FLAGS.length; i++) {
    if (raw.indexOf(SOURCE_FLAGS[i][0]) !== -1) { add(SOURCE_FLAGS[i][1]); }
  }
  if (LATINO_RE.test(audioText)) { add('latino'); }
  if (CASTELLANO_RE.test(audioText)) { add('castellano'); }
  if (langs.indexOf('latino') === -1 && langs.indexOf('castellano') === -1 && SPANISH_RE.test(audioText)) { add('es'); }
  if (ENGLISH_RE.test(audioText)) { add('en'); }
  if (/\b(portugu[eê]s|portuguese|dublado)\b/i.test(audioText)) { add('pt'); }
  if (/\b(french|fran[cç]ais|vff|truefrench)\b/i.test(audioText)) { add('fr'); }
  if (/\b(italian|ita)\b/i.test(audioText)) { add('it'); }
  if (/\b(german|deutsch|ger)\b/i.test(audioText)) { add('de'); }
  if (/\b(russian|rus)\b/i.test(audioText)) { add('ru'); }
  var multi = MULTI_RE.test(audioText) || langs.indexOf('multi') !== -1;
  if (multi && langs.indexOf('multi') === -1) { add('multi'); }
  /* "Dual" and multi-audio releases keep the original (almost always English) track. */
  if (multi && langs.indexOf('en') === -1) { add('en'); }
  var only = langs.filter(function (l) { return l !== 'multi'; });
  var hdr = /\b(hdr(10)?\+?|dv|dovi|dolby[\s._-]?vision)\b/i.test(text);
  /* Torrentio and most scrapers: "⚙️ ThePirateBay" after the size. */
  var site = /⚙️?\s*([^\n👤💾⚙]+)/.exec(String(title || ''));
  return {
    langs: only,
    /* Nothing said about the language: the original audio (usually English). */
    original: !only.length,
    multi: multi,
    subsEs: subsEs,
    cam: CAM_RE.test(text) || /(^|[\s.\-])TS($|[\s.\-])/.test(raw.replace(/\.ts$/i, '')),
    hevc: /\b(x\.?265|h\.?265|hevc)\b/i.test(text),
    tenBit: /\b10[\s._-]?bits?\b/i.test(text),
    hdr: hdr,
    remux: /\bremux\b/i.test(text),
    /* Audio and video codecs some devices cannot decode (Fire TV: DTS, TrueHD). */
    audioDts: /\bdts([\s._-]?(hd|ma|x|es))*\b/i.test(text),
    audioTrueHd: /\btrue[\s._-]?hd\b/i.test(text),
    audioEac3: /\b(e-?ac-?3|ddp|dd\+)([\s._-]?[257]\.[01])?\b/i.test(text),
    av1: /\bav1\b/i.test(text),
    threeD: /\b(3d|h-?sbs|half-?sbs|h-?ou)\b/i.test(text),
    mp4: /\.(mp4|m4v)\b/i.test(String(filename || '') + ' ' + String(title || '')),
    provider: site ? site[1].trim().slice(0, 40) : ''
  };
}

function sourceHasLang(src, lang) {
  if (lang === 'en') { return src.langs.indexOf('en') !== -1 || src.original; }
  return src.langs.indexOf(lang) !== -1;
}

/* "Latino · Inglés", "Subs ES", "CAM"… for the source list. */
function sourceLangText(src) {
  var out = [];
  src.langs.forEach(function (l) { if (SOURCE_LANG_LABELS[l]) { out.push(SOURCE_LANG_LABELS[l]); } });
  if (src.multi && out.length < 2) { out.push('Multi'); }
  if (src.subsEs) { out.push('Subs ES'); }
  return out.join(' · ');
}

/* ------------------------------------------------ preferences */
function defaultSourcePrefs() {
  var audio = typeof preferredLanguageCode === 'function' ? preferredLanguageCode() : 'es';
  return {
    langs: audio === 'en' ? ['en'] : (audio === 'pt' ? ['pt'] : ['latino', 'castellano']),
    quality: 'auto',        /* auto (by the connection) | 4K | 1080p | 720p | SD */
    exclude: [],            /* 4K 1080p 720p SD CAM unknown */
    minSeeds: 0,
    maxMovieGB: 0,
    maxEpisodeGB: 0,
    perQuality: 0,          /* at most N per quality and addon (0 = all) */
    hiddenProviders: [],
    providers: [],          /* sites seen, to offer them in the editor */
    autoPlay: true,
    subsFrom: 'file'        /* file | addons | fileOnly | addonsOnly: where subtitles come from first */
  };
}

function loadSourcePrefs() {
  var p = defaultSourcePrefs();
  try {
    var s = JSON.parse(localStorage.getItem(SOURCE_PREFS_KEY) || 'null');
    if (s && typeof s === 'object') {
      if (Object.prototype.toString.call(s.langs) === '[object Array]') {
        p.langs = s.langs.filter(function (l) { return SOURCE_PREF_LANGS.indexOf(l) !== -1; });
      }
      if (/^(auto|4K|1080p|720p|SD)$/.test(s.quality)) { p.quality = s.quality; }
      if (Object.prototype.toString.call(s.exclude) === '[object Array]') {
        p.exclude = s.exclude.filter(function (q) { return /^(4K|1080p|720p|SD|CAM|unknown)$/.test(q); });
      }
      ['minSeeds', 'maxMovieGB', 'maxEpisodeGB', 'perQuality'].forEach(function (k) {
        var n = Number(s[k]);
        if (n >= 0 && n < 10000) { p[k] = n; }
      });
      ['hiddenProviders', 'providers'].forEach(function (k) {
        if (Object.prototype.toString.call(s[k]) === '[object Array]') {
          p[k] = s[k].filter(function (x) { return typeof x === 'string' && x; }).slice(0, 60);
        }
      });
      if (typeof s.autoPlay === 'boolean') { p.autoPlay = s.autoPlay; }
      if (/^(file|addons|fileOnly|addonsOnly)$/.test(s.subsFrom)) { p.subsFrom = s.subsFrom; }
    }
  } catch (e) { /* defaults */ }
  return p;
}

function saveSourcePrefs(p) {
  try { localStorage.setItem(SOURCE_PREFS_KEY, JSON.stringify(p)); } catch (e) { /* full */ }
}

/* Sites seen in the results, so the editor can offer to hide them. */
function noteSourceProviders(list) {
  var p = loadSourcePrefs();
  var changed = false;
  list.forEach(function (s) {
    if (s.provider && p.providers.indexOf(s.provider) === -1) { p.providers.push(s.provider); changed = true; }
  });
  if (changed) { p.providers = p.providers.slice(-60); saveSourcePrefs(p); }
}

/* Why a source is hidden by the preferences ('' = it is shown). */
function sourcePrefsBlock(src, prefs, isEpisode) {
  var q = src.cam ? 'CAM' : (src.quality || 'unknown');
  if (prefs.exclude.indexOf(q) !== -1) { return 'calidad'; }
  if (src.kind === 'torrent' && prefs.minSeeds > 0 && src.seeds !== null && src.seeds < prefs.minSeeds) { return 'semillas'; }
  var maxGB = isEpisode ? prefs.maxEpisodeGB : prefs.maxMovieGB;
  if (maxGB > 0 && src.sizeBytes > maxGB * 1073741824) { return 'tamaño'; }
  if (src.provider && prefs.hiddenProviders.indexOf(src.provider) !== -1) { return 'sitio'; }
  return '';
}

/* ------------------------------------------------ the connection */
/* Mbps the viewer's internet is known to reach (0 = not known yet): the
   fastest real download seen (torrents, downloads). Chromium's own estimate
   (navigator.connection) is not used: with little traffic it said ~1 Mbps on
   a fast line, which would have picked SD sources. */
function knownNetSpeed() {
  try {
    var s = JSON.parse(localStorage.getItem(NET_SPEED_KEY) || 'null');
    /* A peak older than two weeks may be another network. */
    if (s && s.mbps > 0 && Date.now() - (s.at || 0) < 14 * 86400000) { return Number(s.mbps) || 0; }
  } catch (e) { /* none */ }
  return 0;
}

/* bytesPerSec measured on a real download (only ever raises the peak). */
function noteNetSpeed(bytesPerSec) {
  var mbps = (Number(bytesPerSec) || 0) * 8 / 1000000;
  if (!(mbps > 0.2)) { return; }
  try {
    var s = JSON.parse(localStorage.getItem(NET_SPEED_KEY) || 'null') || {};
    var old = (s.mbps > 0 && Date.now() - (s.at || 0) < 14 * 86400000) ? Number(s.mbps) : 0;
    if (mbps > old) { localStorage.setItem(NET_SPEED_KEY, JSON.stringify({ mbps: Math.round(mbps * 10) / 10, at: Date.now() })); }
  } catch (e) { /* ignore */ }
}

/* Session throughput observed on direct/HLS streams (exponential moving average)
   so slow Wi-Fi or mobile networks adapt right away without waiting for torrents. */
function noteDirectSpeed(bytesPerSec) {
  var mbps = (Number(bytesPerSec) || 0) * 8 / 1000000;
  if (!(mbps > 0.2) || mbps > 500) { return; }
  sessionDirectMbps = sessionDirectMbps > 0 ? (sessionDirectMbps * 0.6 + mbps * 0.4) : mbps;
  noteNetSpeed(bytesPerSec);
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('opentv:direct-speed', function (ev) {
    if (ev && ev.detail) { noteDirectSpeed(ev.detail); }
  });
}

function isMeteredConnection() {
  try {
    var c = navigator && (navigator.connection || navigator.mozConnection || navigator.webkitConnection);
    if (!c) { return false; }
    return !!(c.saveData || c.type === 'cellular');
  } catch (e) { return false; }
}

function effectiveNetSpeed() {
  var peak = knownNetSpeed();
  if (sessionDirectMbps > 0) {
    return peak > 0 ? Math.min(peak, Math.round(sessionDirectMbps * 10) / 10) : Math.round(sessionDirectMbps * 10) / 10;
  }
  return peak;
}

/* ------------------------------------------------ source health (direct & plugin) */
function sourceHealthKey(src) {
  if (!src) { return ''; }
  if (src.url) {
    var m = /^https?:\/\/([^\/:?#]+)/i.exec(src.url);
    if (m) { return m[1].toLowerCase().replace(/^www\./, ''); }
  }
  return String(src.provider || src.addon || '').toLowerCase().trim();
}

function loadSourceHealth() {
  try { return JSON.parse(localStorage.getItem(SOURCE_HEALTH_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function noteSourceOutcome(src, ok, startupMs) {
  var key = sourceHealthKey(src);
  if (!key) { return; }
  var map = loadSourceHealth();
  var rec = map[key] || { ok: 0, fail: 0, streakFail: 0, avgMs: 0, at: 0 };
  if (ok) {
    rec.ok = Math.min(99, (rec.ok || 0) + 1);
    rec.streakFail = 0;
    if (startupMs > 0 && startupMs < 60000) {
      rec.avgMs = rec.avgMs > 0 ? Math.round(rec.avgMs * 0.65 + startupMs * 0.35) : Math.round(startupMs);
    }
  } else {
    rec.fail = Math.min(99, (rec.fail || 0) + 1);
    rec.streakFail = Math.min(5, (rec.streakFail || 0) + 1);
  }
  rec.at = Date.now();
  map[key] = rec;
  var keys = Object.keys(map);
  if (keys.length > 60) {
    keys.sort(function (a, b) { return (map[a].at || 0) - (map[b].at || 0); });
    for (var i = 0; i < keys.length - 60; i++) { delete map[keys[i]]; }
  }
  try { localStorage.setItem(SOURCE_HEALTH_KEY, JSON.stringify(map)); } catch (e) {}
}

function sourceHealthScore(src) {
  var key = sourceHealthKey(src);
  if (!key) { return 0; }
  var rec = loadSourceHealth()[key];
  if (!rec || Date.now() - (rec.at || 0) > 7 * 86400000) { return 0; }
  var delta = 0;
  if (rec.streakFail > 0) { delta -= Math.min(780, rec.streakFail * 260); }
  else if (rec.ok >= 2) { delta += 50; }
  if (rec.avgMs > 0) {
    if (rec.avgMs < 2000) { delta += 80; }
    else if (rec.avgMs > 6000) { delta -= 120; }
  }
  return delta;
}

/* ------------------------------------------------ this device */
/* Android: what the device decodes and shows, and its free space (the
   service's ping). null on PC: there the relay converts any audio and
   Chromium decodes HEVC, so nothing is ruled out. */
var deviceProfile = null;
function setDeviceProfile(media, storage) {
  deviceProfile = { media: media || null, storage: storage || null };
}

/* How bad a source is for this device: 0 = fine. A file whose audio or
   video the device cannot decode would play silent or not at all. */
function sourceDevicePenalty(src, isTorrent) {
  var d = deviceProfile;
  if (!d) { return 0; }
  var p = 0, m = d.media;
  if (m) {
    if (src.audioDts && m.dts === false) { p += 2500; }
    if (src.audioTrueHd && m.truehd === false) { p += 2500; }
    if (src.audioEac3 && m.eac3 === false) { p += 1500; }
    if (src.hevc && m.hevc === false) { p += 3000; }
    else if (src.hevc && src.tenBit && m.hevc10 === false) { p += 2000; }
    if (src.av1 && m.av1 === false) { p += 3000; }
    if (src.quality === '4K' && m.uhd === false) { p += 900; }
    if (src.hdr && m.hdr === false) { p += 500; }
  }
  /* A torrent bigger than the free space: it cannot be watched to the end. */
  var free = d.storage && d.storage.free;
  if (isTorrent && free > 0 && src.sizeBytes > free * 0.9) { p += 2000; }
  return p;
}

/* "Sin sonido en este aparato (DTS)": why the device avoids a source. */
function sourceDeviceNote(src) {
  var d = deviceProfile, m = d && d.media;
  if (!d) { return ''; }
  if (m && ((src.audioDts && m.dts === false) || (src.audioTrueHd && m.truehd === false))) { return 'Audio no compatible con este aparato'; }
  if (m && ((src.hevc && m.hevc === false) || (src.av1 && m.av1 === false))) { return 'Vídeo no compatible con este aparato'; }
  var free = d.storage && d.storage.free;
  if (src.kind === 'torrent' && free > 0 && src.sizeBytes > free * 0.9) { return 'No cabe en este aparato'; }
  return '';
}

var SOURCE_Q_RANK = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1 };

/* Full HD unless the connection is known to be slower. */
function sourceTargetQuality(prefs, mbps) {
  if (prefs.quality !== 'auto') { return prefs.quality; }
  if (!mbps || mbps >= 8) { return '1080p'; }
  if (mbps >= 3.5) { return '720p'; }
  return 'SD';
}

/* ------------------------------------------------ the score */
/* ctx: { prefs, mbps, duration (s), episode }. Higher is better. Language
   first, then a playable quality for this connection, then a healthy
   torrent, then files that play without heavy conversion. A CAM only wins
   when everything else is CAM too (new releases). */
function scoreSource(src, ctx) {
  var prefs = ctx.prefs;
  var score = 0;
  var n = prefs.langs.length;
  var langScore = 0;
  for (var i = 0; i < n; i++) {
    var l = prefs.langs[i];
    var w = (n - i) * 1000;
    if (src.langs.indexOf(l) !== -1) { langScore = Math.max(langScore, w); }
    else if (l === 'en' && src.original) { langScore = Math.max(langScore, w - 250); }
    else if ((l === 'latino' || l === 'castellano') && src.langs.indexOf('es') !== -1) { langScore = Math.max(langScore, w - 500); }
  }
  score += langScore;
  /* Dubbed into a language the viewer did not ask for. */
  if (n && !langScore && src.langs.length && !src.multi) { score -= 400; }

  var target = SOURCE_Q_RANK[sourceTargetQuality(prefs, ctx.mbps)];
  var rank = SOURCE_Q_RANK[src.quality] || 1.5;
  score += rank === target ? 600 : (rank < target ? 600 - 220 * (target - rank) : 600 - 150 * (rank - target));
  if (src.cam) { score -= 6000; }

  var secs = ctx.duration > 0 ? ctx.duration : (ctx.episode ? 2700 : 6600);
  var mbpsNeeded = src.sizeBytes ? src.sizeBytes * 8 / secs / 1000000 : 0;
  if (ctx.mbps > 0 && mbpsNeeded > ctx.mbps * 0.85) { score -= 300 + Math.min(500, 100 * mbpsNeeded / ctx.mbps); }
  if (mbpsNeeded > 30 || src.remux) { score -= 250; }
  if (src.quality === '1080p' && mbpsNeeded > 0 && mbpsNeeded < 1) { score -= 120; }

  if (src.kind === 'torrent') {
    if (src.seeds !== null) {
      score += src.seeds < 3 ? -350 : Math.min(260, 90 * Math.log(src.seeds + 1) / Math.LN10);
    }
    if (ctx.metered && src.sizeBytes > 2.5 * 1073741824) { score -= 350; }
  } else {
    var isHlsDirect = /\.m3u8(\?|$)/i.test(src.url || '');
    var isLazyDirect = !src.url && !!src.jsLazyRef;
    score += src.notWebReady ? 40 : 200;   /* starts at once, no peers needed; web-ready direct links first */
    if (isHlsDirect && ((typeof platformIsTv === 'function' && platformIsTv()) || ctx.metered || (ctx.mbps > 0 && ctx.mbps < 12))) {
      score += 70;  /* adaptive HLS handles fluctuating bandwidth without stalling */
    }
    if (isLazyDirect) { score -= 45; }
    if ((typeof platformIsTv === 'function' && platformIsTv()) || ctx.metered) { score += 120; }
  }
  /* Spanish subtitles bundled with an English/original stream help Spanish viewers. */
  var wantsEs = prefs.langs.indexOf('latino') !== -1 || prefs.langs.indexOf('castellano') !== -1;
  if (wantsEs && !langScore) {
    var hasEsSubs = !!src.subsEs;
    if (!hasEsSubs && Array.isArray(src.subtitles)) {
      for (var si = 0; si < src.subtitles.length; si++) {
        if (/^(es|spa|spn|lat)/i.test(String((src.subtitles[si] && (src.subtitles[si].lang || src.subtitles[si].language)) || ''))) {
          hasEsSubs = true; break;
        }
      }
    }
    if (hasEsSubs) { score += 140; }
  }
  score += sourceHealthScore(src);
  if (src.hevc) { score -= 80; }
  if (src.tenBit) { score -= 60; }
  if (src.hdr) { score -= 140; }
  if (src.threeD) { score -= 500; }
  if (src.mp4 || /\.mp4(\?|$)/i.test(src.url || '')) { score += 30; }
  /* Android: what this device cannot decode, show or store. */
  score -= sourceDevicePenalty(src, src.kind === 'torrent');
  /* The addon's own order breaks ties. */
  return score - (src._i || 0) * 0.5;
}

function sourceRankContext(item, episode) {
  var target = episode || item || {};
  var metered = isMeteredConnection();
  var mbps = effectiveNetSpeed();
  if (metered && (!mbps || mbps > 7)) { mbps = 6; }
  return {
    prefs: loadSourcePrefs(),
    mbps: mbps,
    metered: metered,
    duration: typeof durationToSeconds === 'function' ? durationToSeconds(target.duration || (item && item.duration)) : 0,
    episode: !!episode
  };
}

/* Direct-source auto-fallback: next best direct sources of the same language
   (excluding already-tried URLs/refs) when the chosen direct server fails. */
function directFallbackAlternatives(chosen, list, ctx, max, triedKeys) {
  if (!chosen || chosen.kind !== 'direct' || !(max > 0)) { return []; }
  triedKeys = triedKeys || {};
  var langs = chosen.langs || [];
  var picked = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || s.kind !== 'direct') { continue; }
    var k = s.url || (s.jsAddonUrl + '|' + s.jsLazyRef);
    if (!k || triedKeys[k]) { continue; }
    if (s.cam && !chosen.cam) { continue; }
    if (sourcePrefsBlock(s, ctx.prefs, ctx.episode)) { continue; }
    if (langs.length && !langs.some(function (l) { return (s.langs || []).indexOf(l) !== -1; })) { continue; }
    picked.push({ src: s, key: k, score: scoreSource(s, ctx) });
  }
  picked.sort(function (a, b) { return b.score - a.score; });
  var out = [], seen = {};
  for (var p = 0; p < picked.length && out.length < max; p++) {
    if (seen[picked[p].key]) { continue; }
    seen[picked[p].key] = true;
    out.push(picked[p].src);
  }
  return out;
}

/* The best of `list` for ctx, among the ones the preferences show (or among
   all of them when the preferences hide every source).
   On TV and Android (non-desktop), direct links always come before torrents
   so a torrent is only recommended when no non-CAM direct source exists. */
function bestSource(list, ctx) {
  var directFirst = (ctx && typeof ctx.preferDirect === 'boolean') ? ctx.preferDirect
    : (typeof platformHas === 'function' ? !platformHas('window') : false);
  if (directFirst) {
    var directPool = [];
    for (var d = 0; d < list.length; d++) {
      var cand = list[d];
      if (cand && cand.kind === 'direct' && !cand.cam && !sourcePrefsBlock(cand, ctx.prefs, ctx.episode)) {
        directPool.push(cand);
      }
    }
    if (directPool.length) {
      var bestDirect = null, bestDirectScore = -Infinity;
      for (var j = 0; j < directPool.length; j++) {
        var ds = scoreSource(directPool[j], ctx);
        if (ds > bestDirectScore) { bestDirectScore = ds; bestDirect = directPool[j]; }
      }
      if (bestDirect) { return bestDirect; }
    }
  }
  var best = null, bestScore = -Infinity, shown = 0;
  for (var pass = 0; pass < 2 && !best; pass++) {
    for (var i = 0; i < list.length; i++) {
      if (pass === 0 && sourcePrefsBlock(list[i], ctx.prefs, ctx.episode)) { continue; }
      shown++;
      var s = scoreSource(list[i], ctx);
      if (s > bestScore) { bestScore = s; best = list[i]; }
    }
    if (pass === 0 && shown) { break; }
  }
  return best;
}

/* Source race: other torrents of the same title that may start together
   with `chosen` (the service keeps the one that works). Only close ones:
   the same audio language when chosen has one, no CAM unless chosen is a
   CAM, shown by the preferences and not far below it in the ranking, so a
   race never trades a Latino Full HD for an English 720p. Best first. */
var RACE_SCORE_GAP = 450;
function torrentRaceAlternatives(chosen, list, ctx, max) {
  if (!chosen || chosen.kind !== 'torrent' || !(max > 0)) { return []; }
  var base = scoreSource(chosen, ctx);
  var langs = chosen.langs || [];
  var picked = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || s.kind !== 'torrent' || !s.infoHash || s.infoHash === chosen.infoHash) { continue; }
    if (s.cam && !chosen.cam) { continue; }
    if (sourcePrefsBlock(s, ctx.prefs, ctx.episode)) { continue; }
    if (langs.length && !langs.some(function (l) { return (s.langs || []).indexOf(l) !== -1; })) { continue; }
    var sc = scoreSource(s, ctx);
    if (sc < base - RACE_SCORE_GAP) { continue; }
    picked.push({ src: s, score: sc });
  }
  picked.sort(function (a, b) { return b.score - a.score; });
  var out = [], seen = {};
  for (var p = 0; p < picked.length && out.length < max; p++) {
    if (seen[picked[p].src.infoHash]) { continue; }
    seen[picked[p].src.infoHash] = true;
    out.push(picked[p].src);
  }
  return out;
}

/* "Latino · Full HD · 85 semillas · 2,1 GB": why it was chosen. */
function sourceReason(src) {
  var q = { '4K': '4K', '1080p': 'Full HD', '720p': 'HD', 'SD': 'SD' }[src.quality] || '';
  var parts = [];
  var langs = sourceLangText(src);
  if (langs) { parts.push(langs); }
  if (src.cam) { parts.push('CAM'); }
  if (q) { parts.push(q); }
  if (src.kind === 'torrent') { if (src.seeds !== null) { parts.push(src.seeds + (src.seeds === 1 ? ' semilla' : ' semillas')); } }
  else { parts.push('Directo'); }
  if (src.size) { parts.push(src.size.replace('.', ',')); }
  return parts.join(' · ');
}

/* ------------------------------------------------ preferences editor */
/* The options of Torrentio's configure page, applied by OpenTV to every
   addon; in Ajustes → Preferencias de addons and inside "Elegir fuente".
   Same rows as the rest of Ajustes (screens/settings-hub.js): grouped, the
   name and ⓘ on the left, the choices on the right. onChange runs after
   each change (already saved). */
function buildSourcePrefsEditor(onChange) {
  var root = el('div', 'set-page srcpref');
  var group = root;
  function changed() { if (onChange) { onChange(); } }
  function section(title) { group = settingsGroup(root, title); }
  function row(label, hint) {
    var r = el('div', 'set-row');
    var name = el('div', 'set-row-name');
    name.appendChild(el('span', null, label));
    if (hint) { name.appendChild(settingsInfo(hint)); }
    r.appendChild(name);
    var seg = el('div', 'set-seg is-wrap');
    r.appendChild(seg);
    group.appendChild(r);
    return seg;
  }
  function chip(parent, text, on, run) {
    var c = el('div', 'set-seg-btn focusable' + (on ? ' is-on' : ''), text);
    c.setAttribute('role', 'button');
    c._activate = function () { run(); paint(); changed(); };
    parent.appendChild(c);
    return c;
  }
  function paint() {
    var keep = state.focus && state.focus.classList && state.focus.classList.contains('set-seg-btn') ? state.focus.textContent : '';
    var keepRow = keep && state.focus.parentNode ? Array.prototype.indexOf.call(root.querySelectorAll('.set-seg'), state.focus.parentNode) : -1;
    clear(root);
    group = root;
    var p = loadSourcePrefs();
    function save() { saveSourcePrefs(p); }

    section('Idioma');
    var langs = row('Idiomas preferidos', 'Toca en orden: el 1 va primero. Sin bandera de idioma = inglés (original).');
    SOURCE_PREF_LANGS.forEach(function (l) {
      var pos = p.langs.indexOf(l);
      chip(langs, (pos !== -1 ? (pos + 1) + ' · ' : '') + SOURCE_LANG_LABELS[l], pos !== -1, function () {
        if (pos !== -1) { p.langs.splice(pos, 1); } else { p.langs.push(l); }
        save();
      });
    });
    var subs = row('Subtítulos', 'Los del archivo vienen con el vídeo y van sincronizados. Si no hay, se usan los de tus plugins.');
    [['file', 'Archivo primero'], ['addons', 'Plugins primero'], ['fileOnly', 'Solo archivo'], ['addonsOnly', 'Solo plugins']].forEach(function (o) {
      chip(subs, o[1], p.subsFrom === o[0], function () { p.subsFrom = o[0]; save(); });
    });

    section('Calidad');
    var mbps = knownNetSpeed();
    var quality = row('Calidad', mbps ? 'Tu internet: ~' + Math.round(mbps) + ' Mbps. Automática elige la mejor que alcanza.'
      : 'Automática busca Full HD y baja si tu internet no alcanza.');
    [['auto', 'Automática'], ['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD']].forEach(function (o) {
      chip(quality, o[1], p.quality === o[0], function () { p.quality = o[0]; save(); });
    });
    var exclude = row('Ocultar', 'Calidades que nunca se muestran. CAM: grabadas en el cine.');
    [['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD'], ['CAM', 'CAM'], ['unknown', 'Sin calidad']].forEach(function (o) {
      var on = p.exclude.indexOf(o[0]) !== -1;
      chip(exclude, o[1], on, function () {
        if (on) { p.exclude.splice(p.exclude.indexOf(o[0]), 1); } else { p.exclude.push(o[0]); }
        save();
      });
    });
    var per = row('Máximo por calidad', 'Cuántas fuentes de cada calidad muestra cada plugin.');
    [[0, 'Todas'], [3, '3'], [5, '5'], [10, '10']].forEach(function (o) {
      chip(per, o[1], p.perQuality === o[0], function () { p.perQuality = o[0]; save(); });
    });

    section('Torrents');
    var seeds = row('Mínimo de semillas', 'Se ocultan los torrents con menos personas compartiendo.');
    [[0, 'Cualquiera'], [2, '2'], [5, '5'], [10, '10'], [25, '25']].forEach(function (o) {
      chip(seeds, o[1], p.minSeeds === o[0], function () { p.minSeeds = o[0]; save(); });
    });
    var movie = row('Tamaño máximo · Películas');
    [[0, 'Sin límite'], [2, '2 GB'], [4, '4 GB'], [8, '8 GB'], [15, '15 GB']].forEach(function (o) {
      chip(movie, o[1], p.maxMovieGB === o[0], function () { p.maxMovieGB = o[0]; save(); });
    });
    var ep = row('Tamaño máximo · Capítulos');
    [[0, 'Sin límite'], [0.5, '500 MB'], [1, '1 GB'], [2, '2 GB'], [4, '4 GB']].forEach(function (o) {
      chip(ep, o[1], p.maxEpisodeGB === o[0], function () { p.maxEpisodeGB = o[0]; save(); });
    });
    if (p.providers.length || p.hiddenProviders.length) {
      var sites = row('Sitios', 'Toca un sitio para ocultar sus fuentes (tachado = oculto).');
      var all = p.providers.slice();
      p.hiddenProviders.forEach(function (h) { if (all.indexOf(h) === -1) { all.push(h); } });
      all.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
      all.forEach(function (name) {
        var hidden = p.hiddenProviders.indexOf(name) !== -1;
        var c = chip(sites, name, !hidden, function () {
          if (hidden) { p.hiddenProviders.splice(p.hiddenProviders.indexOf(name), 1); } else { p.hiddenProviders.push(name); }
          save();
        });
        if (hidden) { c.classList.add('is-struck'); }
      });
    }

    section('Al reproducir');
    var auto = row('Fuente', 'La recomendada se elige por idioma, calidad, semillas y lo que tu aparato reproduce.');
    chip(auto, 'Usar la recomendada', p.autoPlay, function () { p.autoPlay = true; save(); });
    chip(auto, 'Preguntarme', !p.autoPlay, function () { p.autoPlay = false; save(); });

    var reset = el('div', 'set-reset');
    var rb = el('div', 'set-seg-btn focusable', 'Restablecer');
    rb._activate = function () {
      var keepSites = loadSourcePrefs().providers;
      var d = defaultSourcePrefs();
      d.providers = keepSites;
      saveSourcePrefs(d);
      paint();
      changed();
    };
    reset.appendChild(rb);
    root.appendChild(reset);

    /* Keep the focus on the choice that was pressed (the rows are redrawn). */
    if (keep && keepRow !== -1) {
      var rows = root.querySelectorAll('.set-seg');
      var target = rows[keepRow] && rows[keepRow].querySelectorAll('.set-seg-btn');
      var pick = null;
      for (var i = 0; target && i < target.length && !pick; i++) {
        if (target[i].textContent.replace(/^\d+ · /, '') === keep.replace(/^\d+ · /, '')) { pick = target[i]; }
      }
      if (pick) { setFocus(pick); }
    }
  }
  paint();
  return root;
}
