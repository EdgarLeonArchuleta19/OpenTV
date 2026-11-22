/* screens/plugins.js — Ajustes → Plugins: los addons de películas y series
   (compatibles con Stremio) y las listas M3U de TV en vivo, juntos, en dos
   pestañas de tarjetas:
   - "Mis plugins": los instalados. Al elegir una tarjeta se encienden sus
     dos botones, Configurar (la ventana de ese plugin) y Eliminar (pide
     una segunda pulsación).
   - "Comunidad": recomendados, con buscador y categoría; elegir la tarjeta
     lo agrega. En la tele solo los esenciales.
   Cada tarjeta lleva el logo del plugin (el de su manifest) o, si no tiene,
   un icono de lo que da. "Agregar plugin" abre una ventana para pegar un
   enlace. La misma vista se usa en PC, tele y celular
   (mobile/mobile-app.js); cambia solo el CSS.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Essentials shown on TVs: direct and torrent source addons in Spanish,
   Spanish subtitles, and the best free channel lists. */
var PLUGINS_TV_ESSENTIALS = {
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json': true,
  'https://raw.githubusercontent.com/syberia1/frametv/HEAD/kino-plugin.json': true,
  'https://mg.homelabx.qzz.io/manifest.json': true,
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/kino-plugin.json': true,
  'https://torrentio.strem.fun/manifest.json': true,
  'https://torrentsdb.com/manifest.json': true,
  'https://addon.peerflix.mov/language=es,en/manifest.json': true,
  'https://cncverse.dpdns.org/manifest.json': true,
  'https://subtitles.website/stremio/manifest.json': true,
  pluto_mx: true,
  plex_mx: true,
  pluto_ar: true,
  es_tdt: true,
  latam_spa: true,
  sports_iptv: true
};

/* Recommended at the top of Comunidad for each device: the three best,
   checked with real titles (links that answer as video, sources in Spanish).
   - TV: light direct links first (HLS plays at once on a 1 GB Fire TV), then
     the torrent addon with the most sources in Spanish.
   - Phone: direct links (mobile data, battery), then Torrentio.
   - PC: Torrentio (the only torrent one: most sources and Spanish), then
     two direct-link plugins, Cuevana Pro and Pelispedia. */
var PLUGINS_REC_TV = {
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json': 1,
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/kino-plugin.json': 2,
  'https://torrentio.strem.fun/manifest.json': 3
};

var PLUGINS_REC_PHONE = {
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json': 1,
  'https://raw.githubusercontent.com/syberia1/frametv/HEAD/kino-plugin.json': 2,
  'https://torrentio.strem.fun/manifest.json': 3
};

var PLUGINS_REC_PC = {
  'https://torrentio.strem.fun/manifest.json': 1,
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-cuevanapro/HEAD/kino-plugin.json': 2,
  'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-pelispedia/HEAD/kino-plugin.json': 3
};

function deviceRecommendedMap() {
  if (platformIsTv()) { return PLUGINS_REC_TV; }
  if (typeof isPhone === 'function' && isPhone()) { return PLUGINS_REC_PHONE; }
  return PLUGINS_REC_PC;
}

function deviceRecommendedLabel() {
  if (platformIsTv()) { return 'Recomendados para tu TV'; }
  if (typeof isPhone === 'function' && isPhone()) { return 'Recomendados para tu celular'; }
  return 'Recomendados para PC';
}

/* Categories of the community TV lists (by PRESET_ADDONS id); a list not
   named here is a country list. */
var PLUGIN_LIST_CATS = {
  pluto_mx: 'gratis', pluto_ar: 'gratis', plex_mx: 'gratis', samsung_es: 'gratis',
  pluto_es: 'gratis', freetv_world: 'gratis',
  sports_iptv: 'deportes', movies_iptv: 'cine', news: 'noticias',
  kids: 'infantil', animation: 'infantil', music: 'musica', documentary: 'documentales'
};

/* The category filter of Comunidad (`icon`: the drawn icon of a card
   without a logo). */
var PLUGIN_CATS = [
  { id: 'all', label: 'Todas' },
  { id: 'recomendados', label: 'Recomendados', icon: 'star' },
  { id: 'directas', label: 'Fuentes directas', icon: 'play' },
  { id: 'torrents', label: 'Torrents', icon: 'play' },
  { id: 'catalogos', label: 'Catálogos y sagas', icon: 'film' },
  { id: 'subtitulos', label: 'Subtítulos', icon: 'cc' },
  { id: 'gratis', label: 'Televisión gratis', icon: 'tv' },
  { id: 'deportes', label: 'Deportes en vivo', icon: 'ball' },
  { id: 'paises', label: 'TV por país', icon: 'globe' },
  { id: 'noticias', label: 'Noticias', icon: 'news' },
  { id: 'infantil', label: 'Infantil y animación', icon: 'star' },
  { id: 'cine', label: 'Cine y series TV', icon: 'film' },
  { id: 'musica', label: 'Música', icon: 'music' },
  { id: 'documentales', label: 'Documentales', icon: 'leaf' }
];

var pluginsTab = 'mine';
var pluginsQuery = '';
var pluginsCat = 'all';

function pluginCat(id) {
  for (var i = 0; i < PLUGIN_CATS.length; i++) { if (PLUGIN_CATS[i].id === id) { return PLUGIN_CATS[i]; } }
  return PLUGIN_CATS[0];
}

/* The community catalog: device-recommended plugins first, then the rest of
   the movie and series addons and TV lists. */
function communityPlugins() {
  var tv = platformIsTv();
  var recMap = deviceRecommendedMap();
  var recLabel = deviceRecommendedLabel();
  var out = [];
  if (platformHas('addons')) {
    RECOMMENDED_VOD_ADDONS.forEach(function (rec) {
      if (rec.pcOnly && !platformHas('window')) { return; }
      if (tv && !PLUGINS_TV_ESSENTIALS[rec.url]) { return; }
      var rank = recMap[rec.url] || 0;
      out.push({
        type: 'vod', cat: rec.cat || 'vod', name: rec.name, desc: rec.desc, url: rec.url,
        recRank: rank, recLabel: rank ? recLabel : '', _idx: out.length
      });
    });
  }
  PRESET_ADDONS.forEach(function (p) {
    if (tv && !PLUGINS_TV_ESSENTIALS[p.id]) { return; }
    var rank = recMap[p.id] || 0;
    out.push({
      type: 'tv', cat: PLUGIN_LIST_CATS[p.id] || 'paises', name: p.name, desc: p.desc, url: p.url, preset: p,
      recRank: rank, recLabel: rank ? recLabel : '', _idx: out.length
    });
  });
  out.sort(function (a, b) {
    if (!!a.recRank !== !!b.recRank) { return a.recRank ? -1 : 1; }
    if (a.recRank && b.recRank) { return a.recRank - b.recRank; }
    return a._idx - b._idx;
  });
  return out;
}

function pluginMatches(p, q, cat) {
  if (cat === 'recomendados') { if (!p.recRank) { return false; } }
  else if (cat !== 'all' && !(cat === p.type || cat === p.cat)) { return false; }
  if (q && norm(p.name + ' ' + p.desc + ' ' + pluginCat(p.cat).label + ' ' + (p.recLabel || '')).indexOf(q) === -1) { return false; }
  return true;
}

function pluginTypeLabel(type) {
  return type === 'vod' ? 'Películas y series' : 'TV en vivo';
}

function isPluginInstalled(p) {
  if (p.type === 'vod') { return isVodAddonInstalled(p.url); }
  var saved = getSavedAddons();
  for (var i = 0; i < saved.length; i++) { if (saved[i].url === p.url) { return true; } }
  return false;
}

/* The community entry of an installed TV list (for its category), or null. */
function communityListFor(url) {
  for (var i = 0; i < PRESET_ADDONS.length; i++) { if (PRESET_ADDONS[i].url === url) { return PRESET_ADDONS[i]; } }
  return null;
}

/* After a TV list changes: TV en vivo shows it at once. */
function pluginsLiveChanged() {
  reloadLiveLists();
}

/* Installs a community plugin. done(err, text). */
function installCommunityPlugin(p, done) {
  if (p.type === 'vod') {
    installVodAddon({ url: p.url }, function (err, count, info) {
      if (!err && info && info.logo) { rememberPluginLogo(p.url, info.logo); }
      done(err, err ? '' : 'Agregado');
    });
    return;
  }
  installAddon(p.preset || { name: p.name, url: p.url }, function (err, count) {
    if (!err) { pluginsLiveChanged(); }
    done(err, err ? '' : count + ' canales');
  });
}

function m3uDisplayNameFromUrl(url) {
  var m = /^https?:\/\/([^\/:?#]+)/i.exec(url || '');
  var host = m ? m[1].replace(/^www\./i, '') : '';
  if (/get\.php\?/i.test(url) && /username=/i.test(url)) {
    return 'IPTV · ' + (host || 'Xtream');
  }
  var last = String(url || '').split('?')[0].split('/').pop() || '';
  if (/\.m3u8?$/i.test(last)) {
    var base = last.replace(/\.m3u8?$/i, '').replace(/[_-]+/g, ' ').trim();
    if (base.length >= 2 && base.length <= 28) { return 'Lista · ' + base; }
  }
  return host ? ('Lista · ' + host) : 'Lista M3U';
}

function playDirectOrMagnetFromModal(link, done) {
  var isMagnet = /^magnet:\?/i.test(link);
  var hashMatch = /xt=urn:btih:([A-Za-z0-9]{32,40})/i.exec(link);
  var dnMatch = /[?&]dn=([^&]+)/i.exec(link);
  var title = 'Vídeo directo';
  if (dnMatch && dnMatch[1]) {
    try { title = decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')); } catch (e) {}
  } else if (!isMagnet) {
    var seg = String(link || '').split('?')[0].split('/').pop() || '';
    if (seg) { try { title = decodeURIComponent(seg); } catch (e2) { title = seg; } }
  }
  var src;
  if (isMagnet) {
    if (!platformHas('torrents')) { return done('Los enlaces magnet (torrents) no están soportados en este aparato'); }
    if (!hashMatch) { return done('El enlace magnet no contiene un infoHash válido'); }
    src = { addon: 'Magnet', kind: 'torrent', infoHash: hashMatch[1].toLowerCase(), url: '', label: title, filename: title };
  } else {
    src = { addon: 'Directo', kind: 'direct', url: link, infoHash: '', label: title, filename: title };
  }
  var item = {
    id: 'direct:' + Date.now(),
    title: title,
    kind: 'pelicula',
    type: 'movie',
    poster: '',
    cover: '',
    _stremio: true,
    _stremioId: 'direct:' + Date.now(),
    _stremioType: 'movie',
    _stremioSource: src
  };
  done(null, 'Reproduciendo ' + title, { isDirectPlay: true, item: item });
}

/* Universal plugin installer: accepts a Stremio manifest.json (or base domain),
   an addon_catalog collection, a JS plugin repo (`owner/repo` or web domain),
   an M3U / M3U8 playlist, an Xtream Codes URL (get.php?username=...),
   a magnet:/direct video link, or a short code (Downloader numeric code / !py.md / cutt.ly). */
function installPluginFromUrl(url, done, _fromShortCode) {
  url = (url || '').trim();
  if (!url) { done('Pega un enlace o código primero'); return; }
  /* Magnet link or direct video file (.mp4, .mkv, .webm) -> play immediately. */
  if (/^magnet:\?/i.test(url) || (/^https?:\/\//i.test(url) && /\.(mp4|mkv|webm|avi|mov)(\?.*)?$/i.test(url))) {
    playDirectOrMagnetFromModal(url, done);
    return;
  }
  /* GitHub owner/repo shorthand (e.g. "baskettv23/Framextv"). */
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
    installVodAddon({ url: 'https://raw.githubusercontent.com/' + url + '/HEAD/kino-plugin.json' }, function (err, count, info) {
      done(err, err ? '' : (info && info.name ? info.name : 'Plugin') + ' agregado' + (count ? ' · ' + count + ' títulos' : ''));
    });
    return;
  }
  /* Short code (Downloader digits or !code) without dots or slashes. */
  if (!_fromShortCode && !/[:\/.]/.test(url) && (/^\d{4,9}$/.test(url) || /^![A-Za-z0-9_-]{2,48}$/.test(url))) {
    portalServiceCall('resolveShortCode', { code: url }, function (err, res) {
      if (err || !res || !res.url || res.url === url) {
        done((err && err.message) || err || 'Ese código corto no lleva a ningún plugin válido');
        return;
      }
      installPluginFromUrl(res.url, done, true);
    }, 10000);
    return;
  }
  if (!/^(https?|stremio):\/\//i.test(url) && /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(url)) {
    url = 'https://' + url;
  }
  if (!/^(https?|stremio):\/\//i.test(url)) { done('la dirección debe empezar con https://'); return; }
  var isExplicitStremio = /^stremio:\/\//i.test(url) || /(?:manifest|kino-plugin)\.json(\?|#|$)/i.test(url) ||
    (typeof resolveJsPluginRepoFromInput === 'function' && !!resolveJsPluginRepoFromInput(url));
  var isExplicitM3u = /\.m3u8?(\?|#|$)/i.test(url) || (/get\.php\?/i.test(url) && /username=/i.test(url));
  if (isExplicitStremio) {
    if (!platformHas('addons')) { done('los plugins de películas no están disponibles aquí'); return; }
    installVodAddon({ url: url }, function (err, count, info) {
      if (!err && info && info.isCollection) {
        done(null, 'Colección: ' + info.name, info);
        return;
      }
      done(err, err ? '' : (info && info.name ? info.name : 'Plugin') + ' agregado' + (count ? ' · ' + count + ' títulos' : ''));
    });
    return;
  }
  if (isExplicitM3u) {
    installAddon({ id: 'custom_' + Date.now(), name: m3uDisplayNameFromUrl(url), url: url }, function (err, count) {
      if (!err) { pluginsLiveChanged(); }
      done(err, err ? '' : 'Lista de TV agregada · ' + count + ' canales');
    });
    return;
  }
  /* Ambiguous domain or path: try Stremio manifest first, then fall back to M3U. */
  if (platformHas('addons')) {
    installVodAddon({ url: url }, function (vErr, count, info) {
      if (!vErr && info) {
        if (info.isCollection) {
          done(null, 'Colección: ' + info.name, info);
          return;
        }
        done(null, (info.name || 'Plugin') + ' agregado' + (count ? ' · ' + count + ' títulos' : ''));
        return;
      }
      installAddon({ id: 'custom_' + Date.now(), name: m3uDisplayNameFromUrl(url), url: url }, function (mErr, chCount) {
        if (!mErr) {
          pluginsLiveChanged();
          done(null, 'Lista de TV agregada · ' + chCount + ' canales');
          return;
        }
        done(vErr || mErr);
      });
    });
    return;
  }
  installAddon({ id: 'custom_' + Date.now(), name: m3uDisplayNameFromUrl(url), url: url }, function (err, count) {
    if (!err) { pluginsLiveChanged(); }
    done(err, err ? '' : 'Lista de TV agregada · ' + count + ' canales');
  });
}

/* A line in Spanish for an installed addon's card: what it gives (the
   manifests' own descriptions are mostly in English). */
function pluginAddonDesc(ad) {
  var parts = [];
  if (addonHas(ad, 'catalog')) { parts.push('filas de títulos'); }
  if (addonHas(ad, 'stream')) { parts.push('fuentes para reproducir'); }
  if (addonHas(ad, 'subtitles')) { parts.push('subtítulos'); }
  if (!parts.length) { return 'Plugin compatible con Stremio.'; }
  var text = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1] : parts[0];
  return 'Da ' + text + ' a películas y series.';
}

/* The drawn icon of an installed addon without a logo: what it gives. */
function pluginAddonIcon(ad) {
  if (addonHas(ad, 'stream')) { return 'play'; }
  if (addonHas(ad, 'catalog')) { return 'film'; }
  if (addonHas(ad, 'subtitles')) { return 'cc'; }
  return 'puzzle';
}

/* ------------------------------------------------------------- logos */
/* The logos of the community's addons, read once from their manifests and
   kept (their own key: a URL per manifest). Installed addons carry theirs. */
var PLUGIN_LOGOS_KEY = 'opentv_plugin_logos_v1';
var pluginLogoAsked = {};

function pluginLogos() {
  try { return JSON.parse(localStorage.getItem(PLUGIN_LOGOS_KEY) || '{}') || {}; } catch (e) { return {}; }
}

function rememberPluginLogo(url, logo) {
  var all = pluginLogos();
  if (all[url] === logo) { return; }
  all[url] = logo || '';
  try { localStorage.setItem(PLUGIN_LOGOS_KEY, JSON.stringify(all)); } catch (e) { /* full */ }
}

/* The logo of an addon (manifest URL): at once when known, else read and
   handed to `later` (once per session; '' when it has none). */
function pluginLogoFor(url, later) {
  var base = stremioBaseFromUrl(url);
  var addons = getVodSourcesConfig().addons;
  for (var i = 0; i < addons.length; i++) {
    if (stremioBaseFromUrl(addons[i].url) === base && addons[i].logo) { return addons[i].logo; }
  }
  var known = pluginLogos();
  if (Object.prototype.hasOwnProperty.call(known, url)) { return known[url]; }
  if (!pluginLogoAsked[url]) {
    pluginLogoAsked[url] = true;
    addonRequest(url, function (err, manifest) {
      if (err || !manifest) { return; }
      var rawLogo = manifest.logo || manifest.icon || '';
      var logo = '';
      if (/^https?:\/\//i.test(rawLogo)) {
        logo = rawLogo;
      } else if (rawLogo) {
        logo = base + '/' + String(rawLogo).replace(/^\//, '');
      }
      rememberPluginLogo(url, logo);
      if (logo && later) { later(logo); }
    });
  }
  return '';
}

var PL_ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15M10 7V5h4v2M6.5 7l.8 12.2a1 1 0 0 0 1 .8h7.4a1 1 0 0 0 1-.8L17.5 7"/><path d="M10.3 11v5.5M13.7 11v5.5"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>'
};

/* Icons for a plugin without a logo (line drawings, one colour). */
var PL_KIND_ICONS = {
  film: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="5" y="6" width="22" height="20" rx="3"/><path d="M10.5 6v20M21.5 6v20M5 11.5h5.5M5 16h5.5M5 20.5h5.5M21.5 11.5H27M21.5 16H27M21.5 20.5H27"/></svg>',
  play: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="16" cy="16" r="11"/><path d="M13.5 11.5v9l7.5-4.5z" fill="currentColor"/></svg>',
  cc: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="7.5" width="23" height="17" rx="3.5"/><path d="M14 13.6a3 3 0 1 0 0 4.8M22.5 13.6a3 3 0 1 0 0 4.8"/></svg>',
  puzzle: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 11h5a3 3 0 1 1 6 0h5v5a3 3 0 1 1 0 6v4H7v-5a3 3 0 1 0 0-6z"/></svg>',
  tv: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="24" height="16" rx="3"/><path d="m12 4 4 5 4-5M11 28h10"/></svg>',
  globe: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="16" cy="16" r="11"/><path d="M5 16h22M16 5c3 3.2 4.5 6.9 4.5 11S19 23.8 16 27c-3-3.2-4.5-6.9-4.5-11S13 8.2 16 5z"/></svg>',
  ball: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="16" cy="16" r="11"/><path d="m16 11 4.3 3.1-1.6 5h-5.4l-1.6-5zM16 11V5.5M20.3 14.1l5.2-1.6M18.7 19.1l3.2 4.6M13.3 19.1l-3.2 4.6M11.7 14.1l-5.2-1.6"/></svg>',
  news: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h15v18H9a2 2 0 0 1-2-2z"/><path d="M22 12h3v11a2 2 0 0 1-2 2M11 12h7M11 16h7M11 20h4"/></svg>',
  star: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m16 5 3.3 6.9 7.5 1-5.5 5.2 1.4 7.5L16 22l-6.7 3.6 1.4-7.5-5.5-5.2 7.5-1z"/></svg>',
  music: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 23V8l13-3v15"/><circle cx="9" cy="23" r="3"/><circle cx="22" cy="20" r="3"/></svg>',
  leaf: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 25c0-10 6-17 19-18-1 13-8 19-18 19"/><path d="M7 25 18 14"/></svg>'
};

/* ------------------------------------------------------------- cards */

/* opts: { name, desc, kind, meta, logo, icon, actions: [button…] } → a
   focusable card. Its logo, or the drawn `icon` when it has none (or the
   picture fails). */
function pluginCard(opts) {
  var card = el('div', 'pl-card focusable');
  var top = el('div', 'pl-top');
  var mark = el('div', 'pl-mark');
  function drawIcon() {
    mark.classList.remove('has-logo');
    mark.innerHTML = PL_KIND_ICONS[opts.icon] || PL_KIND_ICONS.puzzle;
  }
  card._setLogo = function (logo) {
    if (!logo) { drawIcon(); return; }
    var img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = drawIcon;
    img.src = logo;
    clear(mark);
    mark.classList.add('has-logo');
    mark.appendChild(img);
  };
  card._setLogo(opts.logo);
  top.appendChild(mark);
  /* The card's buttons: round icons in its top right corner. */
  var actions = el('div', 'pl-actions');
  (opts.actions || []).forEach(function (a) { actions.appendChild(a); });
  top.appendChild(actions);
  card.appendChild(top);
  var info = el('div', 'pl-info');
  info.appendChild(el('div', 'pl-name', opts.name));
  var meta = opts.kind + (opts.meta && opts.meta !== opts.kind ? ' · ' + opts.meta : '');
  if (meta) { info.appendChild(el('div', 'pl-meta', meta)); }
  if (opts.desc) { info.appendChild(el('div', 'pl-desc', opts.desc)); }
  card.appendChild(info);
  return card;
}

/* A button of a card: a round icon; its name is the tooltip and what a
   screen reader says. _label(text, icon) changes both. */
function pluginCardButton(icon, label, cls) {
  var b = el('div', 'pl-btn' + (cls ? ' ' + cls : ''));
  b._icon = icon;
  b._label = function (text, newIcon) {
    if (newIcon !== undefined) { b._icon = newIcon; }
    b.innerHTML = b._icon ? PL_ICONS[b._icon] : '<i class="pl-spin"></i>';
    b.setAttribute('data-tip', text);
    b.setAttribute('aria-label', text);
    b._text = text;
  };
  b._label(label);
  return b;
}

/* ------------------------------------------------------------ modals */

/* A window over the app (same frame as "Elegir fuente": focus stays
   inside, Back closes it; a bottom sheet on the phone). */
function pluginsModal(title, sub) {
  if (sourcePickerOpen) { closeSourcePicker(); }
  sourcePickerOpen = true;
  sourcePickerReturn = state.focus;
  sourcePickerSeq++;
  var root = el('div', 'source-picker pl-modal');
  var panel = el('div', 'srcp-panel pl-panel');
  var head = el('div', 'srcp-head');
  head.appendChild(el('div', 'srcp-title', title));
  if (sub) { head.appendChild(el('div', 'pl-modal-sub', sub)); }
  panel.appendChild(head);
  var body = el('div', 'pl-modal-body');
  panel.appendChild(body);
  var foot = el('div', 'pl-modal-foot');
  panel.appendChild(foot);
  root.appendChild(panel);
  root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
  mountOverlay(root);
  sourcePickerNode = root;
  return { root: root, body: body, foot: foot };
}

function pluginsModalButton(label, cls, run, icon) {
  var b = el('div', 'pl-mbtn focusable' + (cls ? ' ' + cls : ''));
  if (icon) { b.innerHTML = PL_ICONS[icon]; }
  b.appendChild(el('span', null, label));
  b._activate = run;
  return b;
}

/* A text field that works with a keyboard, a phone and a remote: Enter
   runs `_enter`; on the remote, up/down/Back leave the field. */
function pluginsInput(cls, placeholder, type) {
  var input = document.createElement('input');
  input.type = type || 'text';
  input.className = cls + ' focusable';
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'off');
  input._activate = function () { input.focus(); };
  input.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;
    if (k === 13) { ev.preventDefault(); ev.stopPropagation(); if (input._enter) { input._enter(); } return; }
    if (k === 38 || k === 40 || k === 27 || (k === 8 && !input.value && platformIsTv())) {
      ev.preventDefault();
      ev.stopPropagation();
      input.blur();
      handleKey({ keyCode: k === 8 ? 27 : k, key: '', preventDefault: function () {} });
      return;
    }
    ev.stopPropagation();
  });
  return input;
}

/* One block of a plugin's settings window: a title, a line and controls. */
function pluginsModalSection(title, text) {
  var sec = el('div', 'pl-msec');
  sec.appendChild(el('div', 'pl-msec-title', title));
  if (text) { sec.appendChild(el('div', 'pl-msec-text', text)); }
  var row = el('div', 'pl-msec-row');
  sec.appendChild(row);
  sec._row = row;
  return sec;
}

/* Counts user-added plugins currently active (VOD addons excluding the 3
   built-ins, plus active M3U TV lists). */
function activeUserPluginsCount() {
  var n = 0;
  if (platformHas('addons')) {
    var vod = getVodSourcesConfig().addons || [];
    for (var i = 0; i < vod.length; i++) {
      if (vod[i] && !vod[i].disabled && !isBuiltinVodAddon(vod[i])) { n++; }
    }
  }
  var lists = getSavedAddons() || [];
  for (var j = 0; j < lists.length; j++) {
    if (lists[j] && !lists[j].disabled) { n++; }
  }
  return n;
}

/* Shows a one-time modal notice whenever the user crosses above 5 active
   plugins (only right when crossing from <= 5 to > 5). */
function maybeWarnManyPlugins(prevCount) {
  var now = activeUserPluginsCount();
  if (prevCount <= 5 && now > 5) {
    var m = pluginsModal('Rendimiento de plugins',
      'Tienes más de 5 plugins activos al mismo tiempo. Esto puede afectar el rendimiento; ten en cuenta eso y deja activos los plugins que mejor te funcionen.');
    m.root.classList.add('is-confirm');
    var ok = pluginsModalButton('Entendido', 'is-primary', closeSourcePicker);
    m.foot.appendChild(ok);
    setFocus(ok);
  }
}

/* Asks before something that cannot be undone from here (Eliminar).
   The focus starts on Cancelar. */
function openPluginConfirm(title, text, okLabel, onOk) {
  var m = pluginsModal(title, text);
  var cancel = pluginsModalButton('Cancelar', '', closeSourcePicker);
  var ok = pluginsModalButton(okLabel, 'is-danger', function () { closeSourcePicker(); onOk(); }, 'trash');
  m.root.classList.add('is-confirm');
  m.foot.appendChild(cancel);
  m.foot.appendChild(ok);
  setFocus(cancel);
}

/* A Stremio collection (addon_catalog): shows its addons so the viewer can
   pick which ones to install. */
function openAddonCollectionModal(info, onChanged) {
  var m = pluginsModal(info.name || 'Colección de plugins', 'Elige cuáles plugins de esta colección quieres agregar.');
  var list = el('div', 'pl-optlist');
  var first = null;
  (info.addons || []).forEach(function (item) {
    var on = isVodAddonInstalled(item.url);
    var busy = false;
    var row = el('div', 'pl-opt focusable' + (on ? ' is-on' : ''));
    var ic = el('span', 'pl-opt-icon');
    ic.innerHTML = PL_KIND_ICONS.puzzle;
    row.appendChild(ic);
    row.appendChild(el('span', 'pl-opt-label', item.name));
    var stateEl = el('span', 'pl-opt-count', on ? 'Agregado' : 'Agregar');
    row.appendChild(stateEl);
    row._activate = function () {
      if (on || busy) { return; }
      busy = true;
      stateEl.textContent = 'Agregando…';
      installVodAddon({ url: item.url }, function (err, count, addedInfo) {
        busy = false;
        if (err || (addedInfo && addedInfo.isCollection)) {
          stateEl.textContent = 'Error';
          showToast('No se pudo agregar ' + item.name, 'err');
          return;
        }
        on = true;
        row.classList.add('is-on');
        stateEl.textContent = 'Agregado';
        if (addedInfo && addedInfo.logo) { rememberPluginLogo(item.url, addedInfo.logo); }
        showToast('Se agregó ' + item.name);
        if (onChanged) { onChanged(); }
      });
    };
    list.appendChild(row);
    if (!first) { first = row; }
  });
  m.body.appendChild(list);
  var close = pluginsModalButton('Cerrar', '', closeSourcePicker);
  m.foot.appendChild(close);
  setFocus(first || close);
}

/* Xtream Codes modal: Server URL + Username + Password -> M3U live & VOD list. */
function openXtreamLoginModal(initialServer, onAdded) {
  var m = pluginsModal('Cuenta IPTV / Xtream', 'Escribe los datos de tu servidor Xtream Codes para cargar sus canales.');
  var srvInput = pluginsInput('pl-field', 'Servidor (ej. http://servidor.com:8080)', 'url');
  if (initialServer && /^https?:\/\//i.test(initialServer)) { srvInput.value = initialServer; }
  var userInput = pluginsInput('pl-field', 'Usuario', 'text');
  var passInput = pluginsInput('pl-field', 'Contraseña', 'password');
  var msg = el('div', 'pl-modal-msg', '');
  m.body.appendChild(srvInput);
  m.body.appendChild(userInput);
  m.body.appendChild(passInput);
  m.body.appendChild(msg);
  var busy = false;
  var add = pluginsModalButton('Conectar', 'is-primary', function () {
    if (busy) { return; }
    var srv = (srvInput.value || '').trim().replace(/\/+$/, '');
    var usr = (userInput.value || '').trim();
    var pwd = (passInput.value || '').trim();
    if (!srv || !usr || !pwd) {
      msg.textContent = 'Completa el servidor, el usuario y la contraseña.';
      msg.className = 'pl-modal-msg is-err';
      return;
    }
    if (!/^https?:\/\//i.test(srv)) { srv = 'http://' + srv; }
    var xtreamUrl = srv + '/get.php?username=' + encodeURIComponent(usr) + '&password=' + encodeURIComponent(pwd) + '&type=m3u_plus&output=ts';
    busy = true;
    add.querySelector('span').textContent = 'Conectando…';
    msg.textContent = '';
    installPluginFromUrl(xtreamUrl, function (err, text) {
      busy = false;
      add.querySelector('span').textContent = 'Conectar';
      if (err) {
        msg.textContent = 'No se pudo conectar: ' + err;
        msg.className = 'pl-modal-msg is-err';
        return;
      }
      closeSourcePicker();
      if (onAdded) { onAdded(text); }
    });
  });
  srvInput._enter = function () { setFocus(userInput); userInput.focus(); };
  userInput._enter = function () { setFocus(passInput); passInput.focus(); };
  passInput._enter = add._activate;
  m.foot.appendChild(pluginsModalButton('Cancelar', '', closeSourcePicker));
  m.foot.appendChild(add);
  setFocus(srvInput.value ? userInput : srvInput);
}

/* "Agregar plugin": paste a manifest.json, domain, .m3u, Xtream link, magnet or short code. */
function openAddPluginModal(onAdded) {
  var m = pluginsModal('Agregar plugin', 'Pega el enlace de un plugin (manifest.json, sitio web o usuario/repo), lista M3U, magnet o código corto.');
  var input = pluginsInput('pl-field', 'https://…, usuario/repo, lista.m3u, magnet: o código', 'url');
  var msg = el('div', 'pl-modal-msg', '');
  m.body.appendChild(input);
  m.body.appendChild(msg);
  if (platformIsTv()) {
    var tip = el('div', 'pl-tv-tip');
    tip.appendChild(el('b', null, 'Consejo para la tele: '));
    tip.appendChild(document.createTextNode('acorta el enlace en tu celular (aftv.news, py.md o cutt.ly) y escribe aquí solo el código corto (ej. 8065900 o !micodigo) para no teclear toda la URL.'));
    m.body.appendChild(tip);
  }
  var busy = false;
  var xtreamBtn = pluginsModalButton('Cuenta Xtream', '', function () {
    var cur = (input.value || '').trim();
    closeSourcePicker();
    openXtreamLoginModal(cur, onAdded);
  });
  var add = pluginsModalButton('Agregar', 'is-primary', function () {
    if (busy) { return; }
    var url = (input.value || '').trim();
    if (!url) { msg.textContent = 'Pega un enlace primero.'; msg.className = 'pl-modal-msg is-err'; return; }
    busy = true;
    add.querySelector('span').textContent = 'Agregando…';
    msg.textContent = '';
    var prevCount = activeUserPluginsCount();
    installPluginFromUrl(url, function (err, text, extraInfo) {
      busy = false;
      add.querySelector('span').textContent = 'Agregar';
      if (err) { msg.textContent = 'No se pudo agregar: ' + err; msg.className = 'pl-modal-msg is-err'; return; }
      closeSourcePicker();
      if (extraInfo && extraInfo.isDirectPlay && extraInfo.item) {
        if (typeof expandToFullscreen === 'function') { expandToFullscreen(extraInfo.item, null); }
        return;
      }
      if (extraInfo && extraInfo.isCollection) {
        openAddonCollectionModal(extraInfo, function () { if (onAdded) { onAdded(text); } });
        return;
      }
      if (onAdded) { onAdded(text); }
      maybeWarnManyPlugins(prevCount);
    });
  });
  input._enter = add._activate;
  m.foot.appendChild(pluginsModalButton('Cancelar', '', closeSourcePicker));
  m.foot.appendChild(xtreamBtn);
  m.foot.appendChild(add);
  setFocus(input);
  if (!platformIsTv()) { setTimeout(function () { input.focus(); }, 60); }
}

/* "Categoría": the filter as a list to pick from. */
function openPluginCategoryModal(items, onPick) {
  var m = pluginsModal('Categoría', '');
  var list = el('div', 'pl-optlist');
  var first = null;
  PLUGIN_CATS.forEach(function (c) {
    var n = 0;
    items.forEach(function (p) { if (pluginMatches(p, '', c.id)) { n++; } });
    if (!n) { return; }
    var on = c.id === pluginsCat;
    var row = el('div', 'pl-opt focusable' + (on ? ' is-on' : ''));
    var ic = el('span', 'pl-opt-icon');
    ic.innerHTML = c.icon ? PL_KIND_ICONS[c.icon] : PL_KIND_ICONS.puzzle;
    row.appendChild(ic);
    row.appendChild(el('span', 'pl-opt-label', c.label));
    row.appendChild(el('span', 'pl-opt-count', String(n)));
    row._activate = function () { closeSourcePicker(); onPick(c.id); };
    list.appendChild(row);
    if (on || !first) { first = row; }
  });
  m.body.appendChild(list);
  m.foot.appendChild(pluginsModalButton('Cerrar', '', closeSourcePicker));
  setFocus(first);
}

/* Configurar: the window of one plugin, with what that plugin allows.
   Addons: their place in the order (whose rows and sources come first) and,
   when the addon has its own options, its settings page and a field for the
   link it gives back. TV lists: their name and reloading the channels. */
function openPluginSettings(entry, repaint) {
  var m = pluginsModal('Configurar ' + entry.name, entry.kind + (entry.meta ? ' · ' + entry.meta : ''));
  var first = null;
  function keep(node) { if (!first) { first = node; } return node; }
  var msg = el('div', 'pl-modal-msg', '');
  function say(text, err) { msg.textContent = text || ''; msg.className = 'pl-modal-msg' + (err ? ' is-err' : ' is-ok'); }

  if (entry.type === 'vod') {
    var order = pluginsModalSection('Orden', 'Sus filas y sus fuentes salen antes que las de los plugins que están más abajo. Ahora: ' +
      (entry.index + 1) + ' de ' + entry.total + '.');
    var up = pluginsModalButton('Subir', '', function () {
      if (entry.move(-1)) { closeSourcePicker(); repaint(entry.index - 1); showToast(entry.name + ' subió al lugar ' + entry.index); }
    }, 'up');
    var down = pluginsModalButton('Bajar', '', function () {
      if (entry.move(1)) { closeSourcePicker(); repaint(entry.index + 1); showToast(entry.name + ' bajó al lugar ' + (entry.index + 2)); }
    }, 'down');
    if (entry.index > 0) { order._row.appendChild(keep(up)); }
    if (entry.index < entry.total - 1) { order._row.appendChild(keep(down)); }
    if (entry.total > 1) { m.body.appendChild(order); }

    var own = pluginsModalSection('Opciones del plugin', entry.configurable
      ? (entry.canOpen ? 'Se abren en el navegador. Al terminar, copia el enlace nuevo que te da y pégalo aquí.'
        : 'Ábrelas en tu celular o PC en ' + entry.configUrl + ' y pega aquí el enlace nuevo que te dé.')
      : 'Este plugin no tiene opciones propias. Si tienes un enlace suyo ya configurado, pégalo aquí.');
    if (entry.configurable && entry.canOpen) {
      own._row.appendChild(keep(pluginsModalButton('Abrir opciones', '', function () { entry.openConfig(); showToast('Se abrieron las opciones en el navegador', 'info'); }, 'open')));
    }
    var link = pluginsInput('pl-field', 'Enlace nuevo (…/manifest.json)', 'url');
    var save = pluginsModalButton('Usar este enlace', 'is-primary', function () {
      var url = (link.value || '').trim();
      if (!url) { say('Pega un enlace primero.', true); return; }
      say('Guardando…');
      entry.replace(url, function (err) {
        if (err) { say('No se pudo usar: ' + err, true); return; }
        closeSourcePicker();
        repaint(entry.index);
        showToast('Se guardó la configuración de ' + entry.name);
      });
    });
    link._enter = save._activate;
    own.appendChild(link);
    var saveRow = el('div', 'pl-msec-row');
    saveRow.appendChild(save);
    own.appendChild(saveRow);
    keep(link);
    if (entry.jsAddon && entry.jsAddon.settingsSchema && entry.jsAddon.settingsSchema.length) {
      var jsSec = pluginsModalSection('Ajustes del plugin', 'Opciones propias de ' + entry.name + '.');
      var curCfg = typeof loadJsPluginConfig === 'function' ? loadJsPluginConfig(entry.jsAddon) : {};
      entry.jsAddon.settingsSchema.forEach(function (field) {
        if (!field || !field.key || field.type === 'section' || field.type === 'status' || field.type === 'action') { return; }
        var fLabel = field.label || field.key;
        if (field.type === 'toggle' || typeof field.default === 'boolean') {
          var isOn = !!curCfg[field.key];
          var tBtn = pluginsModalButton(fLabel + ': ' + (isOn ? 'Activado' : 'Desactivado'), isOn ? 'is-primary' : '', function () {
            curCfg[field.key] = !curCfg[field.key];
            if (typeof saveJsPluginConfig === 'function') { saveJsPluginConfig(entry.jsAddon, curCfg); }
            tBtn.querySelector('span').textContent = fLabel + ': ' + (curCfg[field.key] ? 'Activado' : 'Desactivado');
            tBtn.classList.toggle('is-primary', !!curCfg[field.key]);
            showToast('Guardado: ' + fLabel);
          });
          jsSec._row.appendChild(keep(tBtn));
        } else if (field.type === 'select' && Array.isArray(field.options) && field.options.length) {
          var curVal = curCfg[field.key];
          field.options.forEach(function (opt) {
            var oVal = opt && opt.value !== undefined ? opt.value : opt;
            var oLab = (opt && opt.label) || String(oVal);
            var sBtn = pluginsModalButton(fLabel + ' · ' + oLab, curVal === oVal ? 'is-primary' : '', function () {
              curCfg[field.key] = oVal;
              if (typeof saveJsPluginConfig === 'function') { saveJsPluginConfig(entry.jsAddon, curCfg); }
              showToast(fLabel + ': ' + oLab);
              closeSourcePicker();
              openPluginSettings(entry, repaint);
            });
            jsSec._row.appendChild(keep(sBtn));
          });
        } else {
          var tInput = pluginsInput('pl-field', fLabel + (field.hint ? ' (' + field.hint + ')' : ''), field.type === 'password' ? 'password' : 'text');
          tInput.value = curCfg[field.key] != null ? String(curCfg[field.key]) : '';
          var tSave = pluginsModalButton('Guardar ' + fLabel, '', function () {
            curCfg[field.key] = (tInput.value || '').trim();
            if (typeof saveJsPluginConfig === 'function') { saveJsPluginConfig(entry.jsAddon, curCfg); }
            showToast('Guardado: ' + fLabel);
          });
          tInput._enter = tSave._activate;
          jsSec.appendChild(tInput);
          var tRow = el('div', 'pl-msec-row');
          tRow.appendChild(tSave);
          jsSec.appendChild(tRow);
          keep(tInput);
        }
      });
      m.body.appendChild(jsSec);
    } else {
      m.body.appendChild(own);
    }
    /* JS plugins run apart from the app and cannot reach the home network
       (a NAS, a media server) unless the viewer allows it here. */
    if (entry.jsAddon && typeof jsPluginAllowsLan === 'function') {
      var lanSec = pluginsModalSection('Red de tu casa',
        'Permite que este plugin lea servidores de tu red (un NAS, Jellyfin, Plex en casa). Déjalo bloqueado si no lo necesitas.');
      var lanOn = jsPluginAllowsLan(entry.jsAddon);
      var lanBtn = pluginsModalButton(lanOn ? 'Permitida' : 'Bloqueada', lanOn ? 'is-primary' : '', function () {
        lanOn = !lanOn;
        setJsPluginAllowsLan(entry.jsAddon, lanOn);
        lanBtn.querySelector('span').textContent = lanOn ? 'Permitida' : 'Bloqueada';
        lanBtn.classList.toggle('is-primary', lanOn);
        showToast(lanOn ? entry.name + ' puede usar la red de tu casa' : entry.name + ' ya no usa la red de tu casa', 'info');
      });
      lanSec._row.appendChild(keep(lanBtn));
      m.body.appendChild(lanSec);
    }
    /* A plugin that gives sources: how OpenTV picks among them (language,
       quality, sources per quality…). The same for every source plugin. */
    if (entry.hasStream) {
      var prefs = pluginsModalSection('Preferencias de fuentes', 'Cómo elige OpenTV la fuente al reproducir. Valen para todos tus plugins de fuentes.');
      prefs.appendChild(buildSourcePrefsEditor(null));
      m.body.appendChild(prefs);
    }
  } else {
    var nameSec = pluginsModalSection('Nombre', 'Así se ve la lista en Plugins y en TV en vivo.');
    var nameField = pluginsInput('pl-field', 'Nombre de la lista');
    nameField.value = entry.name;
    var saveName = pluginsModalButton('Guardar nombre', 'is-primary', function () {
      var v = (nameField.value || '').trim();
      if (!v) { say('Escribe un nombre.', true); return; }
      entry.rename(v);
      closeSourcePicker();
      repaint(entry.index);
      showToast('Nombre guardado');
    });
    nameField._enter = saveName._activate;
    nameSec.appendChild(nameField);
    var nameRow = el('div', 'pl-msec-row');
    nameRow.appendChild(saveName);
    nameSec.appendChild(nameRow);
    keep(nameField);
    m.body.appendChild(nameSec);
    var chSec = pluginsModalSection('Canales', 'Vuelve a leer la lista para traer los canales nuevos.');
    var reload = pluginsModalButton('Recargar canales', '', function () {
      say('Recargando…');
      entry.reload(function (err, count) {
        if (err) { say('No se pudo recargar: ' + err, true); return; }
        say('');
        showToast(entry.name + ' · ' + count + ' canales');
      });
    }, 'refresh');
    chSec._row.appendChild(reload);
    m.body.appendChild(chSec);
  }
  if (entry.url) { m.body.appendChild(el('div', 'pl-modal-url', entry.url)); }
  m.body.appendChild(msg);
  if (entry.toggle) {
    m.foot.appendChild(pluginsModalButton(entry.disabled ? 'Poner en uso' : 'Dejar sin usar', '', function () {
      var on = entry.toggle();
      closeSourcePicker();
      repaint(entry.index);
      showToast(entry.name + (on ? ' en uso' : ' sin usar'));
    }, 'power'));
  }
  var close = pluginsModalButton('Cerrar', '', closeSourcePicker);
  m.foot.appendChild(close);
  setFocus(first || close);
}

/* -------------------------------------------------------------- view */

/* The whole page under the title: tabs, Agregar plugin and the cards. */
function buildPluginsView() {
  var view = el('div', 'pl-view');
  var bar = el('div', 'pl-bar');
  var tabs = el('div', 'sd-tabs pl-tabs');
  tabs.setAttribute('role', 'tablist');
  var addBtn = el('div', 'pl-add-btn focusable');
  addBtn.innerHTML = PL_ICONS.plus;
  addBtn.appendChild(el('span', null, 'Agregar plugin'));
  bar.appendChild(tabs);
  bar.appendChild(addBtn);
  var note = el('div', 'pl-note', '');
  note.hidden = true;
  var body = el('div', 'pl-body');
  view.appendChild(bar);
  view.appendChild(note);
  view.appendChild(body);

  function say(text) {
    note.textContent = text || '';
    note.hidden = !text;
  }

  function show(id, focusNode) {
    pluginsTab = id;
    var all = tabs.querySelectorAll('.sd-tab');
    for (var i = 0; i < all.length; i++) {
      var on = all[i]._tab === id;
      all[i].classList.toggle('is-on', on);
      all[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    clear(body);
    if (id === 'community') { fillCommunity(body, view); } else { fillMine(body, view, say); }
    if (focusNode && focusNode.isConnected) { setFocus(focusNode); }
  }
  view._show = show;

  [{ id: 'mine', label: 'Mis plugins' }, { id: 'community', label: 'Comunidad' }].forEach(function (t) {
    var b = el('div', 'sd-tab focusable', t.label);
    b.setAttribute('role', 'tab');
    b._tab = t.id;
    b._activate = function () { say(''); show(t.id, b); };
    tabs.appendChild(b);
  });
  addBtn._activate = function () {
    openAddPluginModal(function (text) {
      show('mine');
      showToast(text);
      setFocus(addBtn);
    });
  };
  show(pluginsTab);
  return view;
}

/* A card of Mis plugins: choosing it turns its two buttons on (focus on
   the first); leaving the card, or Back, turns them off again. With a
   mouse or a finger the buttons work at once. */
function openablePluginCard(card, buttons) {
  function setOpen(on) {
    card.classList.toggle('is-open', on);
    buttons.forEach(function (b) {
      var usable = on && !b.classList.contains('is-off');
      b.classList.toggle('focusable', usable);
      if (!on && b._reset) { b._reset(); }
    });
  }
  function close(focusCard) {
    setOpen(false);
    if (focusCard) { setFocus(card, true); }
  }
  card._activate = function () {
    var usable = buttons.filter(function (b) { return !b.classList.contains('is-off'); });
    if (!usable.length) { return; }
    /* Only one card open at a time. */
    var others = card.parentNode ? card.parentNode.querySelectorAll('.pl-card.is-open') : [];
    for (var i = 0; i < others.length; i++) { if (others[i] !== card && others[i]._close) { others[i]._close(false); } }
    setOpen(true);
    setFocus(usable[0]);
  };
  card._close = close;
  buttons.forEach(function (b, i) {
    b._onMove = function (dir) {
      var usable = buttons.filter(function (x) { return x.classList.contains('focusable'); });
      var at = usable.indexOf(b);
      if (dir === 'right' && at >= 0 && at < usable.length - 1) { setFocus(usable[at + 1]); return true; }
      if (dir === 'left' && at > 0) { setFocus(usable[at - 1]); return true; }
      if (dir === 'up') { close(true); return true; }
      /* Down, or sideways past the ends: on from the card itself. */
      close(true);
      return false;
    };
    b._onBack = function () { close(true); return true; };
    /* Mouse and touch: the button straight away (no need to pick the card). */
    b.addEventListener('click', function (ev) {
      if (b.classList.contains('is-off')) { return; }
      ev.stopPropagation();
      if (!card.classList.contains('is-open')) { card._activate(); }
      setFocus(b, true);
      if (b._run) { b._run(); }
    });
    b._activate = function () { if (b._run) { b._run(); } };
  });
  setOpen(false);
}

/* Mis plugins: every installed addon and list as a card. */
function fillMine(body, view, say) {
  var grid = el('div', 'pl-grid');
  var addons = platformHas('addons');
  var entries = [];
  if (addons) {
    var vodList = getVodSourcesConfig().addons;
    vodList.forEach(function (ad, idx) {
      var builtin = isBuiltinVodAddon(ad);
      var configUrl = ad.baseUrl ? ad.baseUrl + '/configure' : '';
      var baseMeta = addonOffers(ad);
      entries.push({
        type: 'vod', name: ad.name || 'Plugin', kind: 'Películas y series',
        meta: (baseMeta ? baseMeta + ' · ' : '') + (ad.disabled ? 'Sin usar' : 'En uso'),
        desc: pluginAddonDesc(ad), logo: ad.logo, icon: pluginAddonIcon(ad), builtin: builtin, url: ad.url,
        disabled: !!ad.disabled,
        hasStream: addonHas(ad, 'stream'),
        index: idx, total: vodList.length,
        jsAddon: ad.kind === 'jsplugin' ? ad : null,
        configurable: !!ad.configurable, configUrl: configUrl,
        canOpen: !!(ad.configurable && configUrl && window.desktop && window.desktop.openAddonConfig),
        openConfig: function () { window.desktop.openAddonConfig(configUrl); },
        toggle: function () {
          var c = getVodSourcesConfig();
          if (!c.addons[idx]) { return true; }
          c.addons[idx].disabled = !c.addons[idx].disabled;
          var on = !c.addons[idx].disabled;
          saveVodSourcesConfig(c);
          syncExternalVodCatalogs(function () {});
          return on;
        },
        move: function (by) {
          var c = getVodSourcesConfig();
          var to = idx + by;
          if (to < 0 || to >= c.addons.length) { return false; }
          c.addons.splice(to, 0, c.addons.splice(idx, 1)[0]);
          saveVodSourcesConfig(c);
          syncExternalVodCatalogs(function () {});
          return true;
        },
        /* A configured link of the same addon: it takes this one's place. */
        replace: function (url, done) {
          installVodAddon({ url: url }, function (err, count, info) {
            if (err) { return done(err); }
            var c = getVodSourcesConfig();
            var at = -1, old = -1;
            for (var i = 0; i < c.addons.length; i++) {
              if (c.addons[i].url === info.url) { at = i; }
              if (c.addons[i].url === ad.url) { old = i; }
            }
            if (at >= 0 && old >= 0 && at !== old) {
              var fresh = c.addons.splice(at, 1)[0];
              if (at < old) { old--; }
              /* The built-in ones stay (seedDefaultVodAddons would add them back). */
              if (builtin) { c.addons.splice(old + 1, 0, fresh); } else { c.addons.splice(old, 1, fresh); }
              saveVodSourcesConfig(c);
              syncExternalVodCatalogs(function () {});
            }
            done(null);
          });
        },
        remove: builtin ? null : function () {
          var c = getVodSourcesConfig();
          c.addons.splice(idx, 1);
          saveVodSourcesConfig(c);
          syncExternalVodCatalogs(function () {});
        }
      });
    });
  }
  var lists = getSavedAddons();
  lists.forEach(function (ad, idx) {
    var preset = communityListFor(ad.url);
    var cat = preset ? (PLUGIN_LIST_CATS[preset.id] || 'paises') : 'tv';
    var baseMeta = ad.count ? ad.count + ' canales' : 'Lista M3U';
    entries.push({
      type: 'tv', name: ad.name || 'Lista M3U', kind: 'TV en vivo',
      meta: baseMeta + ' · ' + (ad.disabled ? 'Sin usar' : 'En uso'),
      desc: preset ? preset.desc : 'Lista M3U agregada por enlace.', icon: pluginCat(cat).icon || 'tv', url: ad.url,
      disabled: !!ad.disabled,
      index: idx, total: lists.length,
      toggle: function () {
        var cur = getSavedAddons();
        if (!cur[idx]) { return true; }
        cur[idx].disabled = !cur[idx].disabled;
        var on = !cur[idx].disabled;
        saveSavedAddons(cur);
        pluginsLiveChanged();
        return on;
      },
      rename: function (name) {
        var cur = getSavedAddons();
        if (cur[idx]) { cur[idx].name = name; saveSavedAddons(cur); pluginsLiveChanged(); }
      },
      reload: function (done) {
        installAddon({ id: ad.id, name: ad.name, url: ad.url }, function (err, count) {
          if (!err) { pluginsLiveChanged(); }
          done(err, count);
        });
      },
      remove: function () {
        var cur = getSavedAddons();
        cur.splice(idx, 1);
        saveSavedAddons(cur);
        pluginsLiveChanged();
      }
    });
  });

  /* After a change: the page again, the focus on the card at `at`. */
  function repaint(at) {
    view._show('mine');
    var cards = view.querySelectorAll('.pl-card');
    var target = cards[Math.max(0, Math.min(at || 0, cards.length - 1))];
    if (target) { setFocus(target); }
  }

  var builtinEntries = [];
  var userEntries = [];
  entries.forEach(function (entry) {
    if (entry.builtin) { builtinEntries.push(entry); }
    else { userEntries.push(entry); }
  });
  var ordered = builtinEntries.concat(userEntries);

  function buildMineCard(entry, cardIdx) {
    if (entry.builtin) {
      var lockBtn = pluginCardButton('lock', 'Incluido con OpenTV · siempre activo', 'is-off is-builtin-lock');
      var bCard = pluginCard({
        name: entry.name, desc: entry.desc, kind: entry.kind, meta: 'Incluido · Siempre activo',
        logo: entry.logo, icon: entry.icon, actions: [lockBtn]
      });
      bCard.classList.add('is-builtin');
      bCard._activate = function () {};
      return bCard;
    }
    var cfgBtn = pluginCardButton('gear', 'Configurar');
    var useBtn = pluginCardButton('power', entry.disabled ? 'Apagado · Pulsar para encender' : 'En uso · Pulsar para apagar',
      'is-use' + (entry.disabled ? ' is-paused-btn' : ' is-on'));
    var delBtn = pluginCardButton('trash', 'Eliminar', 'is-danger');
    var card = pluginCard({
      name: entry.name, desc: entry.desc, kind: entry.kind, meta: entry.meta, logo: entry.logo, icon: entry.icon,
      actions: [cfgBtn, useBtn, delBtn]
    });
    if (entry.disabled) { card.classList.add('is-paused'); }
    cfgBtn._run = function () { openPluginSettings(entry, function () { repaint(cardIdx); }); };
    useBtn._run = function () {
      var prev = activeUserPluginsCount();
      var on = entry.toggle();
      repaint(cardIdx);
      showToast(entry.name + (on ? ' en uso' : ' apagado'));
      if (on) { maybeWarnManyPlugins(prev); }
    };
    delBtn._run = function () {
      openPluginConfirm('¿Eliminar ' + entry.name + '?',
        entry.type === 'tv' ? 'Sus canales dejan de salir en TV en vivo. Puedes volver a agregarla cuando quieras.'
          : 'Deja de dar sus títulos, fuentes o subtítulos. Puedes volver a agregarlo cuando quieras.',
        'Eliminar', function () {
          entry.remove();
          repaint(cardIdx);
          showToast('Se eliminó ' + entry.name);
        });
    };
    openablePluginCard(card, [cfgBtn, useBtn, delBtn]);
    return card;
  }

  /* What is missing, in one short line above the cards. */
  if (addons) {
    var all = getVodSourcesConfig().addons;
    var hasCatalog = all.some(function (ad) { return !ad.disabled && addonHas(ad, 'catalog'); });
    var hasStream = all.some(function (ad) { return !ad.disabled && addonHas(ad, 'stream'); });
    var warnText = !hasCatalog ? 'Sin plugin de catálogo: no hay películas ni series.'
      : (!hasStream ? 'Sin plugin de fuentes no se puede reproducir. Hay recomendados en Comunidad.' : '');
    if (warnText) { body.appendChild(el('div', 'pl-warn', warnText)); }
  }

  var sectionsWrap = el('div', 'pl-sections');
  var idxCursor = 0;
  if (builtinEntries.length) {
    var bSec = el('div', 'pl-section');
    var bHead = el('div', 'pl-section-head');
    bHead.appendChild(el('div', 'pl-section-title', 'Incluidos con OpenTV'));
    bHead.appendChild(el('div', 'pl-section-sub', 'Vienen con la app y siempre están activos'));
    bSec.appendChild(bHead);
    var bGrid = el('div', 'pl-grid');
    builtinEntries.forEach(function (entry) {
      bGrid.appendChild(buildMineCard(entry, idxCursor++));
    });
    bSec.appendChild(bGrid);
    sectionsWrap.appendChild(bSec);
  }
  var uSec = el('div', 'pl-section');
  var uHead = el('div', 'pl-section-head');
  uHead.appendChild(el('div', 'pl-section-title', 'Tus plugins'));
  uHead.appendChild(el('div', 'pl-section-sub', 'Fuentes, catálogos y listas de TV agregados por ti'));
  uSec.appendChild(uHead);
  var uGrid = el('div', 'pl-grid');
  if (userEntries.length) {
    userEntries.forEach(function (entry) {
      uGrid.appendChild(buildMineCard(entry, idxCursor++));
    });
  } else {
    uGrid.appendChild(el('div', 'pl-empty', 'Aún no agregaste plugins. Explora la pestaña Comunidad o pulsa Agregar plugin.'));
  }
  uSec.appendChild(uGrid);
  sectionsWrap.appendChild(uSec);
  body.appendChild(sectionsWrap);
  /* Addons saved with only their URL (the preinstalled ones): read their
     manifests once for the logo and what they offer. */
  if (addons && !view._refreshed) {
    view._refreshed = true;
    refreshAddonManifests(getVodSourcesConfig(), function () {
      if (body.isConnected && pluginsTab === 'mine') { view._show('mine'); }
    });
  }
}

/* Comunidad: search, category and the community plugins grouped in clear
   sections (Recomendados, Fuentes directas, Torrents, Catálogos, Subtítulos,
   Televisión gratis, Deportes, IPTV y TV por país). Choosing a card adds it. */
var COMMUNITY_SECTIONS = [
  {
    id: 'recomendados',
    titleFn: deviceRecommendedLabel,
    sub: 'Los mejores plugins seleccionados para este aparato',
    match: function (p) { return !!p.recRank; }
  },
  {
    id: 'directas',
    title: 'Fuentes directas (Películas, Series y Anime)',
    sub: 'Reproducción directa por enlace HTTP sin usar torrents',
    match: function (p) { return p.cat === 'directas'; }
  },
  {
    id: 'torrents',
    title: 'Torrents',
    sub: 'Fuentes P2P en español e inglés hasta en 4K',
    match: function (p) { return p.cat === 'torrents'; }
  },
  {
    id: 'catalogos',
    title: 'Catálogos y sagas',
    sub: 'Tendencias de plataformas y colecciones completas en orden',
    match: function (p) { return p.cat === 'catalogos'; }
  },
  {
    id: 'subtitulos',
    title: 'Subtítulos',
    sub: 'Proveedores adicionales de subtítulos en español',
    match: function (p) { return p.cat === 'subtitulos'; }
  },
  {
    id: 'gratis',
    title: 'Televisión gratis (Pluto, Plex, TDT)',
    sub: 'Canales 24/7 gratuitos y verificados en español',
    match: function (p) { return p.cat === 'gratis'; }
  },
  {
    id: 'deportes',
    title: 'Deportes en vivo',
    sub: 'Canales deportivos y transmisiones de competiciones',
    match: function (p) { return p.cat === 'deportes'; }
  },
  {
    id: 'iptv',
    title: 'IPTV por país y temática',
    sub: 'Canales abiertos de Latinoamérica, infantil, noticias, cine y música',
    match: function (p) {
      return p.type === 'tv' && p.cat !== 'gratis' && p.cat !== 'deportes';
    }
  }
];

function buildCommunityCard(p) {
  var on = isPluginInstalled(p);
  var busy = false;
  var addBtn = pluginCardButton(on ? 'check' : 'plus', on ? 'Agregado' : 'Agregar', on ? 'is-done' : 'is-add');
  var card;
  var logo = p.type === 'vod' ? pluginLogoFor(p.url, function (l) { if (card && card.isConnected) { card._setLogo(l); } }) : '';
  card = pluginCard({
    name: p.name, desc: p.desc, kind: pluginTypeLabel(p.type),
    meta: pluginCat(p.cat).label,
    logo: logo, icon: pluginCat(p.cat).icon, actions: [addBtn]
  });
  if (on) { card.classList.add('is-installed'); }
  card._activate = function () {
    if (on || busy) { return; }
    busy = true;
    addBtn.className = 'pl-btn is-busy';
    addBtn._label('Agregando…', '');
    showToast('Agregando ' + p.name + '…', 'info');
    var prevCount = activeUserPluginsCount();
    installCommunityPlugin(p, function (err, text) {
      busy = false;
      if (err) {
        addBtn.className = 'pl-btn is-err';
        addBtn._label('No cargó', 'plus');
        showToast('No se pudo agregar ' + p.name, 'err');
        setTimeout(function () { if (!on) { addBtn.className = 'pl-btn is-add'; addBtn._label('Agregar', 'plus'); } }, 2500);
        return;
      }
      on = true;
      card.classList.add('is-installed');
      addBtn.className = 'pl-btn is-done';
      addBtn._label('Agregado', 'check');
      showToast('Se agregó ' + p.name + (text && text !== 'Agregado' ? ' · ' + text : ''));
      maybeWarnManyPlugins(prevCount);
    });
  };
  return card;
}

function fillCommunity(body, view) {
  var items = communityPlugins();
  var tools = el('div', 'pl-tools');
  var search = el('div', 'pl-search');
  var icon = el('span', 'pl-search-icon');
  icon.innerHTML = PL_ICONS.search;
  search.appendChild(icon);
  var input = pluginsInput('pl-search-input', 'Buscar plugins');
  input.value = pluginsQuery;
  search.appendChild(input);
  var select = el('div', 'pl-select focusable');
  select.appendChild(el('span', 'pl-select-label', 'Categoría'));
  var selValue = el('span', 'pl-select-value', pluginCat(pluginsCat).label);
  select.appendChild(selValue);
  var chev = el('span', 'pl-select-chev');
  chev.innerHTML = PL_ICONS.chevron;
  select.appendChild(chev);
  tools.appendChild(search);
  tools.appendChild(select);
  var count = el('div', 'pl-count', '');
  var contentBox = el('div', 'pl-sections');
  body.appendChild(tools);
  body.appendChild(count);
  body.appendChild(contentBox);

  function paint() {
    clear(contentBox);
    var q = norm(pluginsQuery);
    var shown = 0;
    if (!q && pluginsCat === 'all') {
      var dedupTv = platformIsTv();
      var seenInSections = {};
      COMMUNITY_SECTIONS.forEach(function (sec) {
        var list = items.filter(function (p) {
          if (!sec.match(p)) { return false; }
          if (dedupTv && seenInSections[p.url]) { return false; }
          return true;
        });
        if (!list.length) { return; }
        var wrap = el('div', 'pl-section');
        var head = el('div', 'pl-section-head');
        head.appendChild(el('div', 'pl-section-title', sec.titleFn ? sec.titleFn() : sec.title));
        if (sec.sub) { head.appendChild(el('div', 'pl-section-sub', sec.sub)); }
        wrap.appendChild(head);
        var grid = el('div', 'pl-grid');
        list.forEach(function (p) {
          if (dedupTv) { seenInSections[p.url] = true; }
          shown++;
          grid.appendChild(buildCommunityCard(p));
        });
        wrap.appendChild(grid);
        contentBox.appendChild(wrap);
      });
      count.textContent = '';
    } else {
      var grid = el('div', 'pl-grid');
      items.forEach(function (p) {
        if (!pluginMatches(p, q, pluginsCat)) { return; }
        shown++;
        grid.appendChild(buildCommunityCard(p));
      });
      count.textContent = shown ? shown + (shown === 1 ? ' plugin' : ' plugins') : '';
      if (!shown) { grid.appendChild(el('div', 'pl-empty', 'No hay plugins con esa búsqueda.')); }
      contentBox.appendChild(grid);
    }
    selValue.textContent = pluginCat(pluginsCat).label;
    select.classList.toggle('is-filtered', pluginsCat !== 'all');
  }

  input.addEventListener('input', function () { pluginsQuery = input.value || ''; paint(); });
  input._enter = function () { input.blur(); var first = contentBox.querySelector('.pl-card'); if (first) { setFocus(first); } };
  select._activate = function () {
    openPluginCategoryModal(items, function (id) {
      pluginsCat = id;
      paint();
      setFocus(select);
    });
  };
  paint();
}

/* ------------------------------------------------------------ PC / TV */

function buildSourcesPanel() {
  var page = desktopSettingsPage('sd-sources pl-page scrollable', 'Plugins', '');
  page.body.appendChild(buildPluginsView());
  return page.panel;
}
