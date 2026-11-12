/* services/vod-api.js — Cliente de la API VOD: normalización de títulos, temporadas y peticiones HTTP.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------- VOD API
   XMLHttpRequest is used deliberately: it works on Chromium 53, where
   fetch/async functions are not a safe webOS 4 baseline. */
var vodApi = window.XUPERTV_API || {};
/* Desktop harness override: ?service=http://127.0.0.1:8910 */
var devServiceParam = /[?&]service=([^&]+)/.exec(window.location.search || '');
if (devServiceParam) { vodApi.devServiceUrl = decodeURIComponent(devServiceParam[1]); }
var vodApiState = { loading: false, source: 'demo', error: null };
var portalState = { refreshing: false, lastSync: 0, roots: 0, error: null };
var PORTAL_ROOTS = ['featured', 'movies', 'series', 'anime', 'kids', 'free'];

function apiArray(payload) {
  if (Object.prototype.toString.call(payload) === '[object Array]') { return payload; }
  if (!payload) { return []; }
  var keys = ['items', 'movies', 'results', 'recommendList', 'movieList',
              'totalMovieList', 'programList', 'data'];
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.toString.call(payload[keys[i]]) === '[object Array]') {
      return payload[keys[i]];
    }
    if (payload[keys[i]] && typeof payload[keys[i]] === 'object') {
      var nested = apiArray(payload[keys[i]]);
      if (nested.length) { return nested; }
    }
  }
  return [];
}

function apiError(payload) {
  if (!payload || typeof payload !== 'object') { return ''; }
  var code = payload.returnCode || payload.code || payload.errorCode || '';
  var message = payload.errorMessage || payload.message || payload.msg || '';
  if (!code && !message) { return ''; }
  return (code ? String(code) + ': ' : '') + (message ? String(message) : 'La API rechazó la petición');
}

function apiUrl(kind) {
  var direct = vodApi[kind + 'Url'];
  if (direct) { return String(direct); }
  var base = String(vodApi.baseUrl || '').replace(/\/$/, '');
  var path = String(vodApi[kind + 'Path'] || '');
  return base && path ? base + (path.charAt(0) === '/' ? path : '/' + path) : '';
}

function xuperSession() {
  var session = vodApi.session || {};
  return {
    userId: String(session.userId || ''),
    userToken: String(session.userToken || ''),
    portalCode: String(session.portalCode || ''),
    homePageCode: String(session.homePageCode || ''),
    version: String(session.version || '4.34.4')
  };
}

function hasXuperSession() {
  var session = xuperSession();
  return !!(session.userId && session.userToken && session.portalCode);
}

function xuperPayload(kind, value) {
  var session = xuperSession();
  if (kind === 'catalog') {
    return {
      userId: session.userId,
      userToken: session.userToken,
      portalCode: session.portalCode,
      homePageCode: session.homePageCode,
      version: session.version
    };
  }
  if (kind === 'search') {
    return {
      userToken: session.userToken,
      userId: session.userId,
      portalCode: session.portalCode,
      columnId: '',
      value: value || '',
      type: '',
      pageSize: 20,
      pageNum: 1,
      filter: ''
    };
  }
  return {
    userToken: session.userToken,
    userId: session.userId,
    portalCode: session.portalCode,
    programId: value
  };
}

function apiImage(value) {
  if (!value) { return ''; }
  value = String(value);
  if (/^https?:\/\//i.test(value) || value.indexOf('data:') === 0) { return value; }
  if (!vodApi.imageBaseUrl) { return value; }
  return String(vodApi.imageBaseUrl).replace(/\/$/, '') + '/' + value.replace(/^\//, '');
}

function apiText(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function isSeriesItem(item) {
  if (!item) { return false; }
  return item.type === 'teleplay' || item.type === 'series' || item.kind === 'serie' ||
         (item.category && item.category.indexOf('serie') !== -1) ||
         (item.episodes && item.episodes.length > 0) ||
         (item.seasons && item.seasons.length > 0) ||
         (item.volumeCount && parseInt(item.volumeCount, 10) > 1);
}

function normalizeVod(raw, index) {
  raw = raw || {};
  var genres = raw.genres || raw.genre || [];
  if (typeof genres === 'string') { genres = genres.split(','); }
  if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = []; }
  var names = [];
  for (var i = 0; i < genres.length; i++) {
    names.push(typeof genres[i] === 'string' ? genres[i] : (genres[i].name || ''));
  }
  var runtime = raw.duration || raw.runtimeSeconds || '';
  if (!durationToSeconds(runtime) && raw.runtimeMinutes) runtime = Number(raw.runtimeMinutes) * 60;
  if (!durationToSeconds(runtime) && raw.runtime) runtime = typeof raw.runtime === 'number' ? raw.runtime * 60 : raw.runtime;
  var type = apiText(raw.type || raw.programType, '');
  var isSeries = type === 'teleplay' || type === 'series' || norm(apiText(raw.kind || '', '')) === 'serie' ||
                 norm(apiText(raw.category || '', '')).indexOf('serie') !== -1 ||
                 (raw.episodes && raw.episodes.length > 0) ||
                 (raw.seasons && raw.seasons.length > 0) ||
                 (raw.volumeCount && parseInt(raw.volumeCount, 10) > 1) ||
                 (raw.volumnCount && parseInt(raw.volumnCount, 10) > 1);
  return {
    id: apiText(raw.id || raw.vodId || raw.programId || raw.program_id || raw.tmdb_id, 'api-' + index),
    title: apiText(raw.title || raw.name || raw.programName || raw.programTitle || raw.original_title, 'Sin título'),
    category: norm(apiText(raw.category || raw.section || raw.collection || raw.homeSection, '')),
    score: apiText(raw.score || raw.vote_average || raw.rating || raw.movieRate || raw.programScore, '—'),
    year: apiText(raw.year || raw.release_year || raw.programYear || (raw.releaseDate || raw.releaseTime || raw.release_date || '').slice(0, 4), '—'),
    duration: apiText(runtime, '—'),
    genres: names.length ? names : ['Sin clasificar'],
    director: apiText(raw.director, '—'),
    actors: apiText(raw.actors || raw.actorDisplay || raw.cast, '—'),
    synopsis: apiText(raw.synopsis || raw.overview || raw.description || raw.programUpdateContent, 'Sin sinopsis disponible.'),
    kind: isSeries ? 'serie' : apiText(raw.kind || raw.media_type, 'película'),
    poster: apiImage(raw.posterUrl || raw.poster_url || raw.poster || raw.poster_path || raw.image || raw.imageUrl || raw.cover || raw.coverUrl || raw.programPoster || raw.programImage),
    landscape: apiImage(raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage),
    backdrop: apiImage(raw.backdropUrl || raw.backdrop_url || raw.backdrop || raw.backdrop_path),
    streamUrl: raw.streamUrl || raw.stream_url || '',
    /* Magis portal records (service / snapshot). */
    type: type || (isSeries ? 'teleplay' : 'movie'),
    row: apiText(raw.row, ''),
    /* Every home shelf the title is on (the TOP rankings included). */
    _rows: raw._rows && raw._rows.length ? raw._rows.slice() : (raw.rows && raw.rows.length ? raw.rows.slice() : []),
    alias: apiText(raw.alias, ''),
    country: apiText(raw.country || raw.originalCountry, ''),
    releaseDate: apiText(raw.releaseDate || raw.releaseTime, ''),
    tagline: apiText(raw.tagline || raw.viewPoint, ''),
    volumeCount: parseInt(raw.volumeCount || raw.volumnCount, 10) || 0,
    updateCount: parseInt(raw.updateCount, 10) || 0,
    episodes: raw.episodes || [],
    seasons: raw.seasons || [],
    moreAudio: raw.moreAudio !== undefined ? raw.moreAudio : 0,
    moreSubtitle: raw.moreSubtitle !== undefined ? raw.moreSubtitle : 0,
    _stremio: raw._stremio === true,
    _stremioBase: raw._stremioBase || '',
    _stremioType: raw._stremioType || '',
    _portal: raw._stremio ? false : (raw.portal === true || raw._portal === true || (vodApi && vodApi.mode === 'portal' && String(raw.id || '').length > 10))
  };
}

function apiRequest(url, done, options) {
  options = options || {};
  var xhr = new XMLHttpRequest();
  var finished = false;
  var timeout = parseInt(vodApi.timeoutMs, 10) || 10000;
  function finish(error, payload) {
    if (finished) { return; }
    finished = true;
    done(error, payload);
  }
  xhr.open(options.method || 'GET', url, true);
  xhr.timeout = timeout;
  var headers = vodApi.headers || {};
  for (var name in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, name)) { xhr.setRequestHeader(name, headers[name]); }
  }
  if (options.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
    xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
  }
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }
    if (xhr.status < 200 || xhr.status >= 300) { finish('HTTP ' + xhr.status); return; }
    try { finish(null, JSON.parse(xhr.responseText)); }
    catch (err) { finish('La API no devolvió JSON válido'); }
  };
  xhr.onerror = function () { finish('Error de red o CORS'); };
  xhr.ontimeout = function () { finish('Tiempo de espera agotado'); };
  try { xhr.send(options.body === undefined ? null : JSON.stringify(options.body)); }
  catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
}

/* Some portal catalogues publish every season as a separate series card
   ("The Walking Dead T1", "The Walking Dead T2", ...).  Treat only an
   explicit trailing season marker as a grouping signal; ordinary titles
   such as spin-offs are left untouched. */
function catalogSeasonMarker(item) {
  if (!item || !isSeriesItem(item)) { return null; }
  var title = String(item.title || item.alias || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  var match = /^(.*?)(?:\s*[-–:|]?\s*(?:temporada|season)\s*(\d+)|\s*[-–:|]?\s*[st]\s*0?(\d+))\s*$/i.exec(title);
  if (!match || !match[1]) { return null; }
  var number = parseInt(match[2] || match[3], 10);
  if (!number || number > 99) { return null; }
  return { title: match[1].replace(/\s+$/, ''), number: number };
}

function groupCatalogSeasons(items) {
  var groups = {}, out = [];
  for (var i = 0; i < items.length; i++) {
    var marker = catalogSeasonMarker(items[i]);
    if (!marker) { out.push(items[i]); continue; }
    var key = norm(marker.title);
    if (!groups[key]) { groups[key] = { title: marker.title, items: [] }; }
    groups[key].items.push({ item: items[i], number: marker.number });
  }
  for (var key in groups) {
    if (!groups.hasOwnProperty(key)) { continue; }
    var group = groups[key];
    if (group.items.length < 2) {
      out.push(group.items[0].item);
      continue;
    }
    group.items.sort(function (a, b) { return a.number - b.number; });
    var main = group.items[0].item;
    var allCats = {};
    main._catalogSeasons = [];
    main._seriesGroup = true;
    main._seriesTitle = group.title;
    main.title = group.title;
    main.alias = group.title;
    main.seasons = [];
    for (var s = 0; s < group.items.length; s++) {
      var part = group.items[s];
      var cats = String(part.item.category || '').split(',');
      for (var c = 0; c < cats.length; c++) { if (cats[c]) { allCats[cats[c]] = true; } }
      var season = { id: part.item.id, number: part.number, title: group.title };
      main._catalogSeasons.push(season);
      main.seasons.push(season);
    }
    main.category = Object.keys(allCats).join(',');
    out.push(main);
  }
  return out;
}

function replaceVod(records, source, portal) {
  if (!records.length) { return false; }
  var previous = {};
  for (var p = 0; p < VOD.length; p++) { previous[String(VOD[p].id)] = VOD[p]; }
  VOD.splice(0, VOD.length);
  var normalizedItems = [];
  for (var i = 0; i < records.length; i++) {
    var item = normalizeVod(records[i], i + 1);
    keepKidsSafe(item);
    if (portal && records[i].portal !== false) { item._portal = true; }
    /* Keep the addon fields (Stremio mode: _stremioId, _stremioBase…). */
    for (var key in records[i]) {
      if (Object.prototype.hasOwnProperty.call(records[i], key) && /^_(stremio|plain)/.test(key) && item[key] === undefined) {
        item[key] = records[i][key];
      }
    }
    var old = previous[String(item.id)];
    if (old) {
      /* Keep what the detail/player already learned about this title. */
      if (old.episodes) { item.episodes = old.episodes; }
      if (old.seasons) { item.seasons = old.seasons; }
      if (old._detailsLoaded) { item._detailsLoaded = true; }
      if (!item.streamUrl && old.streamUrl) { item.streamUrl = old.streamUrl; }
    }
    normalizedItems.push(item);
  }
  var catalogItems = groupCatalogSeasons(normalizedItems);
  for (var n = 0; n < catalogItems.length; n++) {
    VOD.push(catalogItems[n]);
  }
  if (state.detail) {
    var foundDetail = false;
    for (var d = 0; d < VOD.length; d++) {
      if (String(VOD[d].id) === String(state.detail.id)) {
        state.detail = VOD[d];
        foundDetail = true;
        break;
      }
    }
    if (!foundDetail) { state.detail = VOD[0]; }
  }
  vodApiState.source = source;
  vodApiState.error = null;
  refreshVodViews();
  return true;
}

/* A real catalog may not have every home section. Prefer the declared
   category, then fall back to positional demo slices so the reconstructed
   layouts always have content to show. */
function vodFor(category, count, fallbackStart) {
  var out = [], i;
  if (category) {
    for (i = 0; i < VOD.length; i++) {
      var cats = norm(VOD[i].category || '').split(',');
      if (cats.indexOf(category) !== -1) { out.push(VOD[i]); }
    }
  }
  out = withCovers(out);
  if (!out.length) { out = VOD.slice(fallbackStart, fallbackStart + count); }
  if (!out.length) { out = VOD.slice(0, count); }
  /* Fill short sections with other catalog entries so the sample never shows
     one poster repeated across a whole mosaic. A real backend normally sends
     enough items per section; this only affects the bundled demo catalog. */
  if (out.length < count && VOD.length) {
    var seen = {};
    for (i = 0; i < out.length; i++) { seen[String(out[i].id)] = true; }
    var cursor = 0;
    while (out.length < count && cursor < VOD.length * 2) {
      var cand = VOD[cursor % VOD.length];
      cursor++;
      if (!seen[String(cand.id)]) {
        out.push(cand);
        seen[String(cand.id)] = true;
      }
    }
  }
  return out;
}

function refreshVodViews() {
  if (homeBuilt && window.XUPER_DESKTOP && pages.length) {
    markCatalogPagesStale();
    if (historyDrawerOpen) { renderHistoryDrawer(); }
    if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
    return;
  }
  if (homeBuilt) {
    var rail = $('home-tabs');
    var railWasExpanded = !!(rail && rail.classList.contains('is-expanded') && !rail.classList.contains('is-collapsed'));
    var focusWasTab = !!(state.focus && state.focus._tab !== undefined);
    var focusWasNotify = !!(state.focus && closest(state.focus, '#home-notify'));
    var hadContentFocus = !!(state.focus && closest(state.focus, '.home-page'));
    pages = [];
    tabEls = [];
    buildHome();
    selectTab(state.tab, false);
    if (state.screen === 'home') {
      if (focusWasTab && tabEls[state.tab]) { setFocus(tabEls[state.tab], true); }
      else if (focusWasNotify) {
        var n = firstIn($('home-notify'));
        if (n) { setFocus(n, true); }
      } else if (hadContentFocus) {
        var page = pages[TABS[state.tab].page];
        var f = page ? firstIn(page) : null;
        if (f) { setFocus(f, true); }
      }
      if (railWasExpanded && rail) {
        /* The reference keeps the full labels on the first paint even while
           the content holds focus; preserve that across a catalog refresh. */
        rail.classList.add('is-expanded');
        rail.classList.remove('is-collapsed');
        var railBg = document.querySelector('.home-sidebar-bg');
        if (railBg && !window.XUPER_DESKTOP) { railBg.classList.add('is-on'); }
      }
    }
  }
  if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
  if (state.detail) { buildDetail(state.detail); }
}

function bundledCatalog() {
  var data = window.XUPERTV_CATALOG;
  return data ? apiArray(data) : [];
}

/* ------------------------------------------- Modos del catálogo (solo PC)
   Películas y series salen del catálogo integrado (magis.js) o, en modo
   manual, solo de los addons de Stremio que añade el usuario
   (manifest.json / catalog / meta / stream). La app no trae ningún addon.
   TV en vivo no depende de esto: tiene sus propias listas M3U.
   Solo en PC (capacidad 'addons'); en teles y celulares es siempre automático. */
var VOD_SOURCES_STORAGE_KEY = 'opentv_vod_sources_v1';

function getVodSourcesConfig() {
  var cfg = { mode: 'auto', addons: [] };
  try {
    var raw = localStorage.getItem(VOD_SOURCES_STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      /* 'portal' (old "Modo servidor") and the old fallback mode are both
         the automatic mode now. */
      cfg.mode = parsed.mode === 'external' ? 'external' : 'auto';
      if (Object.prototype.toString.call(parsed.addons) === '[object Array]') {
        for (var i = 0; i < parsed.addons.length; i++) {
          var ad = parsed.addons[i];
          /* Dropped from old configs: the built-in sample addon and the
             preinstalled WatchHub (it only linked to other apps). */
          if (ad && ad.url && !/^builtin:\/\//i.test(ad.url) && ad.id !== 'default_watchhub') { cfg.addons.push(ad); }
        }
      }
    }
  } catch (e) {}
  if (!platformHas('addons')) { cfg.mode = 'auto'; return cfg; }
  seedDefaultVodAddons(cfg);
  if (cfg.mode === 'external' && !cfg.addons.length) { cfg.mode = 'auto'; }
  return cfg;
}

/* PC: the addons Stremio itself comes with, installed once (the viewer can
   remove them; they are not added again). They are only URLs: nothing is
   asked of them until the Stremio mode is on.
   (Stremio's "Local Files" lives in Stremio's own local server, so it cannot
   be part of OpenTV.) */
var VOD_DEFAULTS_KEY = 'opentv_vod_defaults_v1';
var DEFAULT_VOD_ADDONS = [
  { id: 'default_cinemeta', name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
  { id: 'default_opensubtitles', name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' }
];

function seedDefaultVodAddons(cfg) {
  try {
    if (localStorage.getItem(VOD_DEFAULTS_KEY)) { return; }
    localStorage.setItem(VOD_DEFAULTS_KEY, '1');
  } catch (e) { return; }
  var have = {};
  for (var i = 0; i < cfg.addons.length; i++) { have[stremioBaseFromUrl(cfg.addons[i].url)] = true; }
  for (var d = 0; d < DEFAULT_VOD_ADDONS.length; d++) {
    var def = DEFAULT_VOD_ADDONS[d];
    if (have[stremioBaseFromUrl(def.url)]) { continue; }
    cfg.addons.push({ id: def.id, name: def.name, url: def.url, baseUrl: stremioBaseFromUrl(def.url), kind: 'stremio' });
  }
  saveVodSourcesConfig(cfg);
}

function stremioModeOn() {
  return getVodSourcesConfig().mode === 'external';
}

/* The "Stremio" mark next to the logo and in Mi cuenta (body class). */
function paintStremioModeMark() {
  if (document.body) { document.body.classList.toggle('is-stremio-mode', stremioModeOn()); }
}

function saveVodSourcesConfig(cfg) {
  try {
    localStorage.setItem(VOD_SOURCES_STORAGE_KEY, JSON.stringify({
      mode: (cfg && cfg.mode) || 'auto',
      addons: (cfg && cfg.addons) || []
    }));
  } catch (e) {}
}

function normalizeStremioManifestUrl(url) {
  var clean = String(url || '').trim().replace(/^stremio:\/\//i, 'https://');
  if (!clean) { return ''; }
  if (!/^https?:\/\//i.test(clean)) { clean = 'https://' + clean; }
  return clean;
}

function stremioBaseFromUrl(url) {
  var clean = normalizeStremioManifestUrl(url);
  return clean.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/$/, '');
}

/* Addon requests carry no custom headers: those would force a CORS
   preflight, and Stremio addons only promise plain GET with CORS. */
function addonRequest(url, done, timeoutMs) {
  var xhr = new XMLHttpRequest();
  var finished = false;
  function finish(error, payload) {
    if (finished) { return; }
    finished = true;
    done(error, payload);
  }
  try {
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs || 15000;
  } catch (eOpen) { return finish('Enlace no válido'); }
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) { return; }
    if (xhr.status < 200 || xhr.status >= 300) { finish('HTTP ' + xhr.status); return; }
    try { finish(null, JSON.parse(xhr.responseText)); }
    catch (err) { finish('El addon no devolvió JSON válido'); }
  };
  xhr.onerror = function () { finish('No se pudo conectar con el addon'); };
  xhr.ontimeout = function () { finish('El addon tardó demasiado en responder'); };
  try { xhr.send(null); } catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
}

/* ---- What an addon offers (from its manifest) ---- */
function stremioResources(manifest) {
  var out = [];
  var list = (manifest && manifest.resources) || [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (typeof r === 'string') { out.push({ name: r }); }
    else if (r && r.name) { out.push({ name: r.name, types: r.types, idPrefixes: r.idPrefixes }); }
  }
  return out;
}

function catalogExtras(cat) {
  var names = [], required = [];
  var extra = (cat && cat.extra) || [];
  for (var i = 0; i < extra.length; i++) {
    if (!extra[i] || !extra[i].name) { continue; }
    names.push(extra[i].name);
    if (extra[i].isRequired) { required.push(extra[i].name); }
  }
  var supported = (cat && cat.extraSupported) || [];
  for (var s = 0; s < supported.length; s++) { if (names.indexOf(supported[s]) === -1) { names.push(supported[s]); } }
  var req = (cat && cat.extraRequired) || [];
  for (var q = 0; q < req.length; q++) { if (required.indexOf(req[q]) === -1) { required.push(req[q]); } }
  return { names: names, required: required };
}

/* The parts of a manifest kept with the installed addon. */
function stremioAddonInfo(manifest, url) {
  var catalogs = [];
  var list = (manifest && manifest.catalogs) || [];
  for (var i = 0; i < list.length; i++) {
    var cat = list[i];
    if (!cat || !cat.id || (cat.type !== 'movie' && cat.type !== 'series')) { continue; }
    var ex = catalogExtras(cat);
    catalogs.push({ type: cat.type, id: cat.id, name: cat.name || '',
      home: !ex.required.length, search: ex.names.indexOf('search') !== -1 });
  }
  return {
    url: url,
    baseUrl: stremioBaseFromUrl(url),
    kind: 'stremio',
    name: (manifest && manifest.name) || 'Addon',
    desc: (manifest && manifest.description) || '',
    logo: (manifest && manifest.logo) || '',
    configurable: !!(manifest && manifest.behaviorHints && (manifest.behaviorHints.configurable || manifest.behaviorHints.configurationRequired)),
    types: (manifest && manifest.types) || [],
    idPrefixes: (manifest && manifest.idPrefixes) || null,
    resources: stremioResources(manifest),
    catalogs: catalogs
  };
}

/* Does this addon answer `resource` for that type and id? */
function addonSupports(ad, resource, type, id) {
  var res = ad && ad.resources;
  if (!res || !res.length) { return false; }
  for (var i = 0; i < res.length; i++) {
    if (res[i].name !== resource) { continue; }
    var types = res[i].types || ad.types || [];
    if (types.length && type && types.indexOf(type) === -1) { return false; }
    var prefixes = res[i].idPrefixes || ad.idPrefixes;
    if (prefixes && prefixes.length && id) {
      for (var p = 0; p < prefixes.length; p++) { if (String(id).indexOf(prefixes[p]) === 0) { return true; } }
      return false;
    }
    return true;
  }
  return false;
}

/* Addon ids in the app are 'stremio:<id>' so they never mix with the
   integrated catalog (history, Mi lista); _stremioId is the addon's own. */
function stremioMetaToVodRecord(meta, baseUrl, rowName) {
  if (!meta || !meta.id) { return null; }
  var isSeries = meta.type === 'series' || meta.type === 'tv';
  var genres = meta.genres || meta.genre || [];
  if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = [String(genres)]; }
  var catParts = ['destacado', isSeries ? 'serie' : 'pelicula'];
  for (var g = 0; g < genres.length; g++) {
    var gn = norm(String(genres[g] || ''));
    if (gn.indexOf('anim') !== -1) { catParts.push('anime'); }
    if (gn.indexOf('family') !== -1 || gn.indexOf('kids') !== -1 || gn.indexOf('infantil') !== -1) { catParts.push('infantil'); }
  }
  return {
    id: 'stremio:' + meta.id,
    title: String(meta.name || meta.title || 'Sin título'),
    category: catParts.join(','),
    row: rowName || '',
    _rows: rowName ? [rowName] : [],
    score: String(meta.imdbRating || meta.rating || '—'),
    year: String(meta.releaseInfo || meta.year || '—').slice(0, 4),
    duration: meta.runtime || '—',
    genres: genres.length ? genres : [],
    director: Object.prototype.toString.call(meta.director) === '[object Array]' ? meta.director.join(', ') : (meta.director || '—'),
    actors: Object.prototype.toString.call(meta.cast) === '[object Array]' ? meta.cast.join(', ') : (meta.cast || '—'),
    synopsis: meta.description || meta.overview || '',
    kind: isSeries ? 'serie' : 'película',
    type: isSeries ? 'teleplay' : 'movie',
    poster: meta.poster || '',
    landscape: meta.background || meta.poster || '',
    backdrop: meta.background || meta.poster || '',
    logo: meta.logo || '',
    portal: false,
    _portal: false,
    _stremio: true,
    _stremioId: String(meta.id),
    _stremioBase: baseUrl || '',
    _stremioType: isSeries ? 'series' : 'movie'
  };
}

function catalogUrl(base, cat, extra) {
  return base + '/catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) +
    (extra ? '/' + extra : '') + '.json';
}

/* Row names: "Popular · Películas"; with several addons that would repeat,
   the addon's name is added. */
function stremioRowName(ad, cat, taken) {
  var kind = cat.type === 'series' ? 'Series' : 'Películas';
  var name = cat.name ? (cat.name + ' · ' + kind) : kind;
  if (taken[name]) { name += ' (' + ad.name + ')'; }
  taken[name] = true;
  return name;
}

var STREMIO_HOME_CATALOGS = 12;   /* rows per addon */
var STREMIO_CATALOG_PAGES = 2;    /* two pages per row (usually 100 titles or more) */

/* Every home catalog of one addon, one row each. */
function fetchAddonCatalogs(ad, taken, done) {
  var cats = [];
  for (var i = 0; i < (ad.catalogs || []).length && cats.length < STREMIO_HOME_CATALOGS; i++) {
    if (ad.catalogs[i].home) { cats.push(ad.catalogs[i]); }
  }
  var items = [];
  var pending = cats.length;
  if (!pending) { return done(items); }
  cats.forEach(function (cat) {
    var rowName = stremioRowName(ad, cat, taken);
    var got = 0;
    function page(n) {
      addonRequest(catalogUrl(ad.baseUrl, cat, n ? 'skip=' + got : ''), function (err, payload) {
        var metas = (!err && payload && payload.metas) ? payload.metas : [];
        for (var m = 0; m < metas.length; m++) {
          var rec = stremioMetaToVodRecord(metas[m], ad.baseUrl, rowName);
          if (rec) { items.push(rec); }
        }
        got += metas.length;
        if (metas.length && n + 1 < STREMIO_CATALOG_PAGES) { return page(n + 1); }
        if (--pending === 0) { done(items); }
      });
    }
    page(0);
  });
}

/* Reads a manifest (or the user's own JSON / M3U catalogue). */
function inspectVodAddon(url, done) {
  if (/\.m3u8?(\?.*)?$/i.test(url)) { return done(null, { url: url, baseUrl: '', kind: 'm3u', name: 'Lista M3U', resources: [], catalogs: [] }); }
  var manifestUrl = /\/manifest\.json(\?.*)?$/i.test(url) ? url : (stremioBaseFromUrl(url) + '/manifest.json');
  addonRequest(manifestUrl, function (err, manifest) {
    if (!err && manifest && (manifest.id || manifest.name) && (manifest.resources || manifest.catalogs)) {
      return done(null, stremioAddonInfo(manifest, manifestUrl));
    }
    addonRequest(url, function (jErr, jPayload) {
      if (jErr || !jPayload || !(jPayload.metas || apiArray(jPayload).length)) {
        return done(err || jErr || 'No es un addon compatible (manifest.json) ni un catálogo válido');
      }
      done(null, { url: url, baseUrl: stremioBaseFromUrl(url), kind: 'json', name: 'Catálogo JSON', resources: [], catalogs: [] });
    });
  });
}

/* Titles of a user's plain JSON or M3U catalogue. */
function fetchPlainCatalog(ad, done) {
  if (ad.kind === 'm3u') {
    portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
      var items = [];
      var list = (!err && payload && payload.channels) || [];
      for (var i = 0; i < list.length; i++) {
        var ch = list[i];
        var row = ch.group || ad.name || 'Catálogo M3U';
        items.push({ id: 'm3uvod-' + (ch.id || (i + 1)), title: ch.name || ('Vídeo ' + (i + 1)),
          category: 'destacado,pelicula', row: row, _rows: [row], poster: ch.logo || '', landscape: ch.logo || '',
          backdrop: ch.logo || '', streamUrl: ch.streamUrl || '', kind: 'película', type: 'movie',
          portal: false, _portal: false, _stremio: true, _plain: true });
      }
      done(items);
    });
    return;
  }
  addonRequest(ad.url, function (err, payload) {
    var arr = (!err && payload) ? (payload.metas || apiArray(payload)) : [];
    var out = [];
    for (var k = 0; k < arr.length; k++) {
      var rec = arr[k] && arr[k].id && arr[k].type ? stremioMetaToVodRecord(arr[k], ad.baseUrl, ad.name) : null;
      if (rec) { if (arr[k].streamUrl) { rec.streamUrl = arr[k].streamUrl; } out.push(rec); }
    }
    done(out);
  });
}

function installVodAddon(addonInput, done) {
  done = done || function () {};
  var url = normalizeStremioManifestUrl(addonInput && addonInput.url);
  if (!url) { return done('Pega la URL de un addon (https://…/manifest.json)'); }
  inspectVodAddon(url, function (err, info) {
    if (err) { return done(err); }
    var cfg = getVodSourcesConfig();
    var replaced = false;
    for (var i = 0; i < cfg.addons.length; i++) {
      if (cfg.addons[i].url === info.url || cfg.addons[i].url === url) {
        info.id = cfg.addons[i].id;
        cfg.addons[i] = info;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      info.id = 'vod_addon_' + Date.now();
      cfg.addons.push(info);
    }
    saveVodSourcesConfig(cfg);
    if (cfg.mode !== 'external') { return done(null, 0, info); }
    syncExternalVodCatalogs(function (sErr, count) { done(null, count, info); });
  });
}

/* Old installs kept only the URL: read their manifests again once. */
function refreshAddonManifests(cfg, done) {
  var stale = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    if (!cfg.addons[i].resources && cfg.addons[i].kind !== 'm3u' && cfg.addons[i].kind !== 'json') { stale.push(i); }
  }
  if (!stale.length) { return done(); }
  var left = stale.length;
  stale.forEach(function (idx) {
    inspectVodAddon(cfg.addons[idx].url, function (err, info) {
      if (!err && info) { info.id = cfg.addons[idx].id; cfg.addons[idx] = info; }
      if (--left === 0) { saveVodSourcesConfig(cfg); done(); }
    });
  });
}

/* Manual (Stremio) mode: the whole catalog comes from the user's addons. */
function syncExternalVodCatalogs(done, forceApply) {
  done = done || function () {};
  var cfg = getVodSourcesConfig();
  if (cfg.mode !== 'external' && !forceApply) { return done(null, 0); }
  if (!cfg.addons.length) { return done(null, 0); }
  refreshAddonManifests(cfg, function () {
    var byId = {}, all = [], taken = {};
    var left = cfg.addons.length;
    function collect(items) {
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var prev = byId[it.id];
        if (!prev) { byId[it.id] = it; all.push(it); continue; }
        /* The same title in two rows: keep one record, in both rows. */
        for (var r = 0; r < it._rows.length; r++) {
          if (prev._rows.indexOf(it._rows[r]) === -1) { prev._rows.push(it._rows[r]); }
        }
      }
    }
    function finished() {
      if (--left > 0) { return; }
      if (all.length) { replaceVod(all, 'stremio-external', false); }
      done(null, all.length);
    }
    /* Addons are read in parallel; rows keep the order of the list. */
    var results = [];
    cfg.addons.forEach(function (ad, idx) {
      function store(items) {
        results[idx] = items;
        if (left === 1) { for (var k = 0; k < results.length; k++) { collect(results[k] || []); } }
        finished();
      }
      if (ad.kind === 'm3u' || ad.kind === 'json') { fetchPlainCatalog(ad, store); }
      else { fetchAddonCatalogs(ad, taken, store); }
    });
  });
}

/* Catalog modes for movies and series (PC only):
   - 'auto'      the integrated catalog (recommended).
   - 'external'  only what the user's Stremio addons bring.
   Switching saves the choice and reloads the catalog at once. */
var VOD_SOURCE_MODES = [
  { id: 'auto', title: 'Modo automático', badge: 'Recomendado',
    desc: 'Películas y series del catálogo integrado de OpenTV. No necesitas configurar nada.' },
  { id: 'external', title: 'Modo Addons',
    desc: 'Películas y series solo de los addons que tú agregues abajo (compatibles con Stremio). Al reproducir eliges la fuente: enlace directo o torrent.' }
];

function applyVodSourceMode(mode, done) {
  done = done || function () {};
  var cfg = getVodSourcesConfig();
  var previous = cfg.mode;
  if (mode === 'external' && !cfg.addons.length) {
    return done('Primero agrega al menos un addon abajo.');
  }
  if (mode === 'external' && !cfg.addons.some(function (ad) {
    return ad.kind === 'm3u' || ad.kind === 'json' || (ad.catalogs && ad.catalogs.length) || !ad.resources;
  })) {
    /* (Torrentio, for example, only gives sources: it has nothing to browse.) */
    return done('Ninguno de tus addons tiene Catálogo. Agrega uno con Catálogo para tener películas y series; los que solo dan Fuentes se usan al reproducir.');
  }
  cfg.mode = mode === 'external' ? 'external' : 'auto';
  saveVodSourcesConfig(cfg);
  if (cfg.mode === 'external') {
    syncExternalVodCatalogs(function (err, count) {
      if (!count) {
        /* No addon answered: keep the previous mode so the app is not left empty. */
        var back = getVodSourcesConfig();
        back.mode = previous;
        saveVodSourcesConfig(back);
        return done('Tus addons no devolvieron títulos (¿tienen catálogo y están en línea?). Se mantuvo el modo anterior.');
      }
      vodApiState.error = null;
      paintStremioModeMark();
      if (typeof resetTrendingForMode === 'function') { resetTrendingForMode(); }
      done(null, count);
    }, true);
    return;
  }
  /* Automatic: drop the addon titles and load the integrated catalog. */
  var own = [];
  for (var i = 0; i < VOD.length; i++) { if (!VOD[i]._stremio) { own.push(VOD[i]); } }
  if (own.length && own.length !== VOD.length) { replaceVod(own, 'portal-snapshot', false); }
  vodApiState.error = null;
  paintStremioModeMark();
  loadVodCatalog();
  if (typeof resetTrendingForMode === 'function') { resetTrendingForMode(); }
  done(null, own.length);
}

/* Search in the addons that offer it (catalogs with the "search" extra). */
function searchStremioAddons(query, done) {
  var cfg = getVodSourcesConfig();
  var jobs = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    var ad = cfg.addons[i];
    for (var c = 0; c < (ad.catalogs || []).length; c++) {
      if (ad.catalogs[c].search) { jobs.push({ ad: ad, cat: ad.catalogs[c] }); }
    }
  }
  if (!jobs.length) { return done([]); }
  var results = [], left = jobs.length;
  jobs.forEach(function (job, idx) {
    addonRequest(catalogUrl(job.ad.baseUrl, job.cat, 'search=' + encodeURIComponent(query)), function (err, payload) {
      var metas = (!err && payload && payload.metas) ? payload.metas : [];
      var recs = [];
      for (var m = 0; m < metas.length; m++) {
        var rec = stremioMetaToVodRecord(metas[m], job.ad.baseUrl, '');
        if (rec) { recs.push(rec); }
      }
      results[idx] = recs;
      if (--left === 0) {
        var out = [], seen = {};
        for (var r = 0; r < results.length; r++) {
          for (var k = 0; k < (results[r] || []).length; k++) {
            if (!seen[results[r][k].id]) { seen[results[r][k].id] = true; out.push(results[r][k]); }
          }
        }
        done(out);
      }
    }, 12000);
  });
}

/* Details (synopsis, seasons, episodes) from the first addon with "meta"
   for this title: the one it came from first. */
function loadStremioMeta(item, done) {
  done = done || function () {};
  if (!item || !item._stremio || item._plain) { return done(item); }
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var sid = item._stremioId || String(item.id).replace(/^stremio:/, '');
  var cfg = getVodSourcesConfig();
  var bases = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    if (addonSupports(cfg.addons[i], 'meta', type, sid)) {
      if (cfg.addons[i].baseUrl === item._stremioBase) { bases.unshift(cfg.addons[i].baseUrl); }
      else { bases.push(cfg.addons[i].baseUrl); }
    }
  }
  item._detailLoading = true;
  var idx = 0;
  function next() {
    if (idx >= bases.length) {
      item._detailLoading = false;
      item._detailsLoaded = true;
      if (isSeriesItem(item) && !(item.episodes && item.episodes.length)) {
        item._detailError = 'Ninguno de tus addons da los capítulos de esta serie';
      }
      if (state.detail === item && state.screen === 'detail') { buildDetail(item); }
      return done(item);
    }
    var base = bases[idx++];
    addonRequest(base + '/meta/' + encodeURIComponent(type) + '/' + encodeURIComponent(sid) + '.json', function (err, payload) {
      var meta = (!err && payload && payload.meta) ? payload.meta : null;
      if (!meta) { return next(); }
      applyStremioMeta(item, meta);
      item._detailLoading = false;
      item._detailsLoaded = true;
      if (state.detail === item && state.screen === 'detail') { buildDetail(item); }
      done(item);
    });
  }
  next();
}

function applyStremioMeta(item, meta) {
  if (meta.description) { item.synopsis = meta.description; }
  if (meta.runtime) { item.duration = meta.runtime; }
  if (meta.imdbRating) { item.score = String(meta.imdbRating); }
  if (meta.genres && meta.genres.length) { item.genres = meta.genres; }
  if (meta.background) { item.backdrop = meta.background; item.landscape = meta.background; }
  if (meta.cast && meta.cast.length) { item.actors = meta.cast.join(', '); }
  if (meta.director && meta.director.length) { item.director = [].concat(meta.director).join(', '); }
  if (!(meta.videos && meta.videos.length && isSeriesItem(item))) { return; }
  var seasonsMap = {}, seasonsList = [];
  for (var v = 0; v < meta.videos.length; v++) {
    var vid = meta.videos[v];
    var sNum = parseInt(vid.season, 10);
    if (!sNum || sNum < 1) { continue; }   /* season 0: extras */
    if (!seasonsMap[sNum]) {
      seasonsMap[sNum] = { id: item.id + ':S' + sNum, number: sNum, title: 'Temporada ' + sNum, _episodes: [] };
      seasonsList.push(seasonsMap[sNum]);
    }
    var epNum = parseInt(vid.episode || vid.number, 10) || (seasonsMap[sNum]._episodes.length + 1);
    seasonsMap[sNum]._episodes.push({
      id: vid.id || (item._stremioId + ':' + sNum + ':' + epNum),
      number: epNum,
      seriesNumber: epNum,
      title: vid.name || vid.title || ('Capítulo ' + epNum),
      synopsis: vid.overview || vid.description || '',
      thumb: vid.thumbnail || item.backdrop || item.poster || '',
      released: vid.released || ''
    });
  }
  seasonsList.sort(function (a, b) { return a.number - b.number; });
  for (var s = 0; s < seasonsList.length; s++) {
    seasonsList[s]._episodes.sort(function (a, b) { return a.number - b.number; });
    seasonsList[s].episodes = seasonsList[s]._episodes;
  }
  if (seasonsList.length) {
    item.seasons = seasonsList;
    item.episodes = seasonsList[0]._episodes;
    state.detailSeason = 0;
    state.detailEpisode = item.episodes[0] || null;
  }
}

/* "Seguir viendo" in Stremio mode: a title watched from a search or a row
   that is no longer in the catalog is rebuilt from its history record. */
var stremioHistoryItems = {};
function stremioItemFromHistory(r) {
  var key = String(r.id);
  if (stremioHistoryItems[key]) { return stremioHistoryItems[key]; }
  var item = stremioMetaToVodRecord({
    id: key.replace(/^stremio:/, ''), type: r.series ? 'series' : 'movie',
    name: r.title, poster: r.poster, background: r.landscape
  }, r.stremioBase || '', '');
  stremioHistoryItems[key] = item;
  return item;
}
