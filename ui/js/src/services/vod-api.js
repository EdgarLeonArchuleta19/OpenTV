/* services/vod-api.js — Cliente de la API VOD: normalización de títulos, temporadas y peticiones HTTP.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------- VOD API
   XMLHttpRequest is used deliberately: it works on the oldest TV
   WebViews, where fetch/async functions are not a safe baseline. */
var vodApi = window.OPENTV_API || {};
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
    /* Records marked as coming from the old portal (history only). */
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
  done = trackedCallback(done);   /* the loading bar at the top (core/loader.js) */
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
  if (homeBuilt && window.OPENTV_DESKTOP && pages.length) {
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
        if (railBg && !window.OPENTV_DESKTOP) { railBg.classList.add('is-on'); }
      }
    }
  }
  if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
  if (state.detail) { buildDetail(state.detail); }
}

/* ------------------------------------------- Addons
   Películas y series salen solo de los addons del usuario (compatibles con
   Stremio: manifest.json / catalog / meta / stream). Vienen instalados
   Cinemeta y OpenSubtitles, como en Stremio; los de fuentes los agrega cada
   usuario. TV en vivo no depende de esto: tiene sus propias listas M3U.
   (The automatic catalog and its 'auto' mode were removed: `mode` is always
   'external', kept so saved configs and older checks read the same.) */
var VOD_SOURCES_STORAGE_KEY = 'opentv_vod_sources_v1';

function getVodSourcesConfig() {
  var cfg = { mode: 'external', addons: [] };
  try {
    var raw = localStorage.getItem(VOD_SOURCES_STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
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
  seedDefaultVodAddons(cfg);
  return cfg;
}

/* The addons that come with the app (as Stremio's own); they cannot be
   removed (seedDefaultVodAddons).
   (Stremio's "Local Files" lives in Stremio's own local server, so it cannot
   be part of OpenTV.) */
var VOD_DEFAULTS_KEY = 'opentv_vod_defaults_v1';
var DEFAULT_VOD_ADDONS = [
  { id: 'default_cinemeta', name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
  { id: 'default_opensubtitles', name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' }
];

/* Anime: the community's Kitsu catalog (Japanese anime as it is: airing,
   popular, best rated, with its own search). A catalog only, no sources;
   one of the app's own addons, right after Cinemeta. */
var VOD_ANIME_KEY = 'opentv_vod_anime_v1';
var DEFAULT_ANIME_ADDON = { id: 'default_kitsu', name: 'Anime Kitsu', url: 'https://anime-kitsu.strem.fun/manifest.json' };

/* The three that come with the app (Cinemeta, Anime Kitsu, OpenSubtitles)
   cannot be removed: they are always in the list (one missing, also from
   an install where the viewer had removed it, is put back at the end;
   Kitsu right after Cinemeta). They give the catalog and subtitles only. */
function builtinVodAddons() {
  return DEFAULT_VOD_ADDONS.slice(0, 1).concat([DEFAULT_ANIME_ADDON], DEFAULT_VOD_ADDONS.slice(1));
}

function isBuiltinVodAddon(ad) {
  var base = ad && ad.url ? stremioBaseFromUrl(ad.url) : '';
  if (!base) { return false; }
  var list = builtinVodAddons();
  for (var i = 0; i < list.length; i++) { if (stremioBaseFromUrl(list[i].url) === base) { return true; } }
  return false;
}

/* Recommended addons ("Recomendados" in Ajustes → Addons): Torrentio and
   TorrentsDB. None is preinstalled: the viewer adds them from here.
   TorrentsDB works without debrid. */
var RECOMMENDED_VOD_ADDONS = [
  { name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json', desc: 'Fuentes para reproducir películas y series, en varios idiomas y calidades' },
  { name: 'TorrentsDB', url: 'https://torrentsdb.com/manifest.json', desc: 'Fuentes torrent sin debrid, con proveedores y estrenos en varios idiomas' }
];

function isVodAddonInstalled(url) {
  var base = stremioBaseFromUrl(url);
  var addons = getVodSourcesConfig().addons;
  for (var i = 0; i < addons.length; i++) { if (stremioBaseFromUrl(addons[i].url) === base) { return true; } }
  return false;
}

function seedDefaultVodAddons(cfg) {
  /* (Kept so the stored flags still mean "the defaults were handed out".) */
  try {
    if (!localStorage.getItem(VOD_DEFAULTS_KEY)) { localStorage.setItem(VOD_DEFAULTS_KEY, '1'); }
    if (!localStorage.getItem(VOD_ANIME_KEY)) { localStorage.setItem(VOD_ANIME_KEY, '1'); }
  } catch (e) { /* ignore */ }
  var have = {};
  for (var i = 0; i < cfg.addons.length; i++) { have[stremioBaseFromUrl(cfg.addons[i].url)] = true; }
  var list = builtinVodAddons();
  var changed = false;
  for (var d = 0; d < list.length; d++) {
    var def = list[d];
    if (have[stremioBaseFromUrl(def.url)]) { continue; }
    var rec = { id: def.id, name: def.name, url: def.url, baseUrl: stremioBaseFromUrl(def.url), kind: 'stremio' };
    /* Kitsu goes after Cinemeta, so the rows keep Cinemeta first. */
    var at = cfg.addons.length;
    if (def === DEFAULT_ANIME_ADDON) {
      for (var c = 0; c < cfg.addons.length; c++) { if (/v3-cinemeta\.strem\.io/.test(cfg.addons[c].url || '')) { at = c + 1; } }
    }
    cfg.addons.splice(at, 0, rec);
    changed = true;
  }
  if (changed) { saveVodSourcesConfig(cfg); }
}

/* Always on: addons are the only source of movies and series. */
function stremioModeOn() {
  return true;
}
function saveVodSourcesConfig(cfg) {
  try {
    localStorage.setItem(VOD_SOURCES_STORAGE_KEY, JSON.stringify({
      mode: 'external',
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
  done = trackedCallback(done);   /* the loading bar at the top (core/loader.js) */
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
    /* ("anime": Kitsu's lists, movies and series mixed, for the Anime section.) */
    if (!cat || !cat.id || (cat.type !== 'movie' && cat.type !== 'series' && cat.type !== 'anime')) { continue; }
    var ex = catalogExtras(cat);
    /* The genres the catalog can be filtered by (Cinemeta: Animation, Family…):
       Kids and Anime ask for those lists (fetchAddonCatalogs). */
    var genres = [];
    for (var e = 0; e < (cat.extra || []).length; e++) {
      if (cat.extra[e] && cat.extra[e].name === 'genre' && cat.extra[e].options) { genres = cat.extra[e].options.slice(0, 60); }
    }
    if (!genres.length && cat.genres) { genres = cat.genres.slice(0, 60); }
    catalogs.push({ type: cat.type, id: cat.id, name: cat.name || '',
      home: !ex.required.length, search: ex.names.indexOf('search') !== -1, genres: genres });
  }
  return {
    manifestV: 3,
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
/* Something to play with: an addon that gives sources (Cinemeta and
   OpenSubtitles, the preinstalled ones, give none). Without one, titles
   show their information only. */
function hasSourceAddons() {
  var addons = getVodSourcesConfig().addons;
  for (var i = 0; i < addons.length; i++) { if (addonSupports(addons[i], 'stream')) { return true; } }
  return false;
}

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
/* An installed addon has anime lists (Kitsu): then Anime shows only those,
   and the other catalogs' "Anime" genre stays in Películas / Series. */
var animeCatalogInstalled = (function () {
  /* (From the saved list at start; each catalog sync updates it.) */
  try {
    var saved = JSON.parse(localStorage.getItem(VOD_SOURCES_STORAGE_KEY) || 'null');
    return !!(saved && saved.addons && hasAnimeCatalog(saved.addons));
  } catch (e) { return false; }
})();
function hasAnimeCatalog(addons) {
  for (var i = 0; i < addons.length; i++) {
    for (var c = 0; c < (addons[i].catalogs || []).length; c++) {
      if (addons[i].catalogs[c].type === 'anime' && addons[i].catalogs[c].home) { return true; }
    }
  }
  return false;
}

/* `anime`: the title comes from an anime list (it only goes to Anime). */
function stremioMetaToVodRecord(meta, baseUrl, rowName, anime) {
  if (!meta || !meta.id) { return null; }
  var isSeries = meta.type === 'series' || meta.type === 'tv' || (meta.type === 'anime' && !/movie/i.test(String(meta.subtype || '')));
  /* An open run of years ("2022–", "2019–2023") is a series even in a movie
     catalogue (see the series/movie note in syncExternalVodCatalogs). */
  if (!isSeries && meta.type === 'movie' && /^\s*\d{4}\s*[–—-]/.test(String(meta.releaseInfo || meta.year || ''))) { isSeries = true; }
  var genres = meta.genres || meta.genre || [];
  if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = [String(genres)]; }
  var catParts = anime ? ['anime'] : ['destacado', isSeries ? 'serie' : 'pelicula'];
  for (var g = 0; g < genres.length && !anime; g++) {
    var gn = norm(String(genres[g] || ''));
    /* "Anime" is Japanese animation. "Animation" alone is neither Anime
       (it was: cartoons ended up there) nor Kids (it also has adult shows):
       only "Family" goes to Kids, what a kids profile sees. */
    if (gn === 'anime' && !animeCatalogInstalled) { catParts.push('anime'); }
    if (gn.indexOf('family') !== -1 || gn.indexOf('kids') !== -1 || gn.indexOf('infantil') !== -1) { catParts.push('infantil'); }
  }
  return {
    _animeCat: !!anime,
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
var ANIME_ROW_NAMES = {
  'kitsu-anime-trending': 'Tendencias del anime',
  'kitsu-anime-airing': 'En emisión',
  'kitsu-anime-popular': 'Los más populares',
  'kitsu-anime-rating': 'Mejor valorados'
};

var stremioRowOrder = {}, stremioRowSeq = 0;

function stremioRowName(ad, cat, taken) {
  var kind = cat.type === 'series' ? 'Series' : 'Películas';
  var name = cat.type === 'anime' ? (ANIME_ROW_NAMES[cat.id] || ((cat.name || 'Anime') + ' · Anime'))
    : (cat.name ? (cat.name + ' · ' + kind) : kind);
  if (taken[name]) { name += ' (' + ad.name + ')'; }
  taken[name] = true;
  /* The rows follow the addons' order (portalRowsFor), not the order in
     which titles happen to show up first. */
  if (!(name in stremioRowOrder)) { stremioRowOrder[name] = stremioRowSeq++; }
  return name;
}

var STREMIO_HOME_CATALOGS = 12;   /* rows per addon */
var STREMIO_CATALOG_PAGES = 2;    /* two pages per row (usually 100 titles or more) */

/* Kids and Anime: the lists a catalog gives filtered by these genres (the
   popular lists barely have them). Titles get their section from their own
   genres (stremioMetaToVodRecord): Family / Animation → Kids, Anime → Anime. */
var STREMIO_SECTION_GENRES = [['Family', 'Familia'], ['Animation', 'Animación'], ['Anime', 'Anime']];

function fetchAddonCatalogs(ad, taken, done) {
  var cats = [];
  for (var i = 0; i < (ad.catalogs || []).length && cats.length < STREMIO_HOME_CATALOGS; i++) {
    if (ad.catalogs[i].home) { cats.push({ cat: ad.catalogs[i], extra: '' }); }
  }
  /* One genre list per type (movie, series), from the first catalog that
   offers that genre. */
  var done2 = {};
  for (var c = 0; c < (ad.catalogs || []).length; c++) {
    var cg = ad.catalogs[c];
    if (!cg.home || !cg.genres || !cg.genres.length || cg.type === 'anime') { continue; }
    STREMIO_SECTION_GENRES.forEach(function (g) {
      var key = cg.type + ':' + g[0];
      if (done2[key] || cg.genres.indexOf(g[0]) === -1) { return; }
      /* With an anime catalog installed, Anime shows that one instead. */
      if (g[0] === 'Anime' && animeCatalogInstalled) { return; }
      done2[key] = true;
      cats.push({ cat: { type: cg.type, id: cg.id, name: g[1] }, extra: 'genre=' + encodeURIComponent(g[0]), one: true });
    });
  }
  /* Each list keeps its own bucket: the rows come out in the addon's order,
     not in the order the answers happen to arrive. */
  var buckets = cats.map(function () { return []; });
  var pending = cats.length;
  if (!pending) { return done([]); }
  cats.forEach(function (job, jobIndex) {
    var cat = job.cat;
    var rowName = stremioRowName(ad, cat, taken);
    var got = 0;
    function page(n) {
      var extra = [job.extra, n ? 'skip=' + got : ''].filter(function (x) { return x; }).join('&');
      addonRequest(catalogUrl(ad.baseUrl, cat, extra), function (err, payload) {
        var metas = (!err && payload && payload.metas) ? payload.metas : [];
        for (var m = 0; m < metas.length; m++) {
          var rec = stremioMetaToVodRecord(metas[m], ad.baseUrl, rowName, cat.type === 'anime');
          /* A series found in a movie list stays out of that movie row. */
          if (rec && cat.type === 'movie' && rec._stremioType === 'series') { rec.row = ''; rec._rows = []; }
          if (rec) { buckets[jobIndex].push(rec); }
        }
        got += metas.length;
        if (metas.length && !job.one && n + 1 < STREMIO_CATALOG_PAGES) { return page(n + 1); }
        if (--pending === 0) { done([].concat.apply([], buckets)); }
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
    syncExternalVodCatalogs(function (sErr, count) { done(null, count, info); });
  });
}

/* Old installs kept only the URL: read their manifests again once. */
function refreshAddonManifests(cfg, done) {
  var stale = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    /* Also read once more when saved by an older build (no genre lists). */
    if ((!cfg.addons[i].resources || cfg.addons[i].manifestV !== 3) &&cfg.addons[i].kind !== 'm3u' && cfg.addons[i].kind !== 'json') { stale.push(i); }
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

/* The whole catalog comes from the user's addons. Without any addon the
   catalog is emptied (the home then says how to add one). */
function syncExternalVodCatalogs(done) {
  done = done || function () {};
  var cfg = getVodSourcesConfig();
  if (!cfg.addons.length) { animeCatalogInstalled = false; replaceVod([], 'stremio-external', false); return done(null, 0); }
  refreshAddonManifests(cfg, function () {
    animeCatalogInstalled = hasAnimeCatalog(cfg.addons);
    stremioRowOrder = {};
    stremioRowSeq = 0;
    var byId = {}, all = [], taken = {};
    var left = cfg.addons.length;
    function collect(items) {
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var prev = byId[it.id];
        if (!prev) { byId[it.id] = it; all.push(it); continue; }
        /* Cinemeta also lists some series in its movie catalogues (same IMDb
           id, type movie), and asked for that id as a movie it answers with
           another film's details (tt12590266 is "I See Ice"). The series
           record wins, without the movie rows. */
        if (prev._stremioType !== it._stremioType && (prev._stremioType === 'series' || it._stremioType === 'series')) {
          if (it._stremioType === 'series') {
            all[all.indexOf(prev)] = it;
            byId[it.id] = it;
          }
          continue;
        }
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


/* Search in the addons that offer it (catalogs with the "search" extra).
   done(list) once every addon answered; `each(list, pending)`, when given,
   gets the list so far after every answer, so the fast addons show first. */
function searchStremioAddons(query, done, each, noAnime) {
  var cfg = getVodSourcesConfig();
  var jobs = [];
  for (var i = 0; i < cfg.addons.length; i++) {
    var ad = cfg.addons[i];
    for (var c = 0; c < (ad.catalogs || []).length; c++) {
      /* (noAnime: TMDB's trends, which never come from an anime list.) */
      if (ad.catalogs[c].search && !(noAnime && ad.catalogs[c].type === 'anime')) { jobs.push({ ad: ad, cat: ad.catalogs[c] }); }
    }
  }
  if (!jobs.length) { if (each) { each([], 0); } return done([]); }
  var results = [], left = jobs.length;
  function merged() {
    var out = [];
    for (var r = 0; r < results.length; r++) { out = out.concat(results[r] || []); }
    return rankSearchResults(query, out);
  }
  jobs.forEach(function (job, idx) {
    addonRequest(catalogUrl(job.ad.baseUrl, job.cat, 'search=' + encodeURIComponent(query)), function (err, payload) {
      var metas = (!err && payload && payload.metas) ? payload.metas : [];
      var recs = [];
      for (var m = 0; m < metas.length; m++) {
        var rec = stremioMetaToVodRecord(metas[m], job.ad.baseUrl, '', job.cat.type === 'anime');
        if (rec) { rec._searchOrder = m; recs.push(rec); }
      }
      results[idx] = recs;
      left--;
      if (each) { each(merged(), left); }
      if (left === 0) { done(merged()); }
    }, 12000);
  });
}

/* ---- Search order ----
   The addons answer in their own order (all the movies, then all the
   series). One list instead, best match first: the same title, then titles
   that start with the words, then whole words, then the rest; the addon's
   own order breaks ties. The same title from two addons (Cinemeta's and
   Kitsu's "Naruto") is shown once, the anime list's one. */
function searchNorm(text) {
  return norm(String(text || '')).replace(/[^a-z0-9]+/g, ' ').trim();
}

function searchMatchScore(q, item) {
  var best = 0;
  var names = [item.title, item.alias, item._esTitle];
  for (var i = 0; i < names.length; i++) {
    var t = names[i] ? searchNorm(names[i]) : '';
    if (!t) { continue; }
    var s = 0;
    var tc = t.replace(/ /g, ''), qc = q.replace(/ /g, '');
    if (t === q) { s = 100; }
    /* "Intensa-Mente" for "intensamente": the same without spaces. */
    else if (tc === qc) { s = 95; }
    else if (qc.length >= 4 && tc.indexOf(qc) === 0) { s = 75; }
    else if (t.indexOf(q + ' ') === 0 || (t.indexOf(q) === 0 && q.length >= 4)) { s = 80; }
    else if ((' ' + t + ' ').indexOf(' ' + q + ' ') !== -1) { s = 65; }
    else if ((' ' + t).indexOf(' ' + q) !== -1) { s = 55; }
    else if (t.indexOf(q) !== -1) { s = 40; }
    else {
      var words = q.split(' '), hits = 0;
      for (var w = 0; w < words.length; w++) { if (words[w] && (' ' + t).indexOf(' ' + words[w]) !== -1) { hits++; } }
      s = words.length ? Math.round(30 * hits / words.length) : 0;
    }
    if (s > best) { best = s; }
  }
  return best;
}

function rankSearchResults(query, list) {
  var q = searchNorm(query);
  var seen = {}, byTitle = {}, rows = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (!it || seen[it.id]) { continue; }
    seen[it.id] = true;
    var name = searchNorm(it.title);
    var key = name + '|' + String(it.year || '').slice(0, 4) + '|' + (isSeriesItem(it) ? 's' : 'm');
    /* (Also one record twice in an addon: same title, same poster.) */
    var keyArt = it.poster ? name + '|' + it.poster : '';
    var prev = byTitle[key] || (keyArt && byTitle[keyArt]);
    if (prev) {
      if (it._animeCat && !prev.item._animeCat) { prev.item = it; }
      continue;
    }
    var row = { item: it, at: rows.length };
    byTitle[key] = row;
    if (keyArt) { byTitle[keyArt] = row; }
    rows.push(row);
  }
  for (var r = 0; r < rows.length; r++) {
    var item = rows[r].item;
    /* No poster: usually an unknown or broken record, after the rest. */
    rows[r].score = searchMatchScore(q, item) + (item._searchBoost || 0) - Math.min(10, (item._searchOrder || 0) / 3) -
      (item.poster ? 0 : 25);
  }
  rows.sort(function (a, b) { return (b.score - a.score) || (a.at - b.at); });
  return rows.map(function (x) { return x.item; });
}

/* Titles in Spanish: Cinemeta only knows the English ones ("El padrino" →
   nothing). TMDB says the original title, which is then searched in the
   addons. done(list) with what it found (may be empty); never fails. */
var SEARCH_TMDB_TITLES = 3;
var SEARCH_TMDB_BOOST = 12;   /* above an exact title nobody knows */

/* Latin letters only (the addons' titles): not "進撃の巨人". */
function latinTitle(text) {
  var s = String(text || '');
  for (var i = 0; i < s.length; i++) { if (s.charCodeAt(i) > 0x24f) { return false; } }
  return s.length > 0;
}

/* A result that is that TMDB title: its original title (or the Spanish
   one) and the same year, same kind. */
function tmdbTitleIn(t, list) {
  var orig = titleKey(t.original), es = titleKey(t.title);
  for (var i = 0; i < list.length; i++) {
    var v = list[i];
    if (!v || !!isSeriesItem(v) !== (t.kind === 'tv')) { continue; }
    var vt = titleKey(v.title);
    if (vt !== orig && vt !== es) { continue; }
    var y = String(v.year || '').match(/\d{4}/);
    if (t.year && y && Math.abs(parseInt(y[0], 10) - parseInt(t.year, 10)) <= 1) { return v; }
  }
  return null;
}

function searchByTranslatedTitle(query, have, done) {
  var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
  if (!api || norm(query).length < 3) { return done([]); }
  api('search:' + query).then(function (answer) {
    var hits = (answer && answer.items) || [];
    var q = searchNorm(query);
    var picked = [];
    for (var i = 0; i < hits.length && picked.length < SEARCH_TMDB_TITLES; i++) {
      var t = hits[i];
      /* Only the titles that are what was typed, in Spanish. */
      if (!t.title || searchMatchScore(q, { title: t.title }) < 55) { continue; }
      picked.push(t);
    }
    var out = [], jobs = [];
    picked.forEach(function (t, n) {
      var boost = SEARCH_TMDB_BOOST - n * 2;
      /* Already found (the plain search gave it): it goes up, named in
         Spanish too. Else its original title is searched. */
      var known = tmdbTitleIn(t, have);
      if (known) { known._esTitle = t.title; known._searchBoost = boost; return; }
      if (!t.original || titleKey(t.original) === titleKey(t.title) || !latinTitle(t.original)) { return; }
      jobs.push({ t: t, boost: boost });
    });
    if (!jobs.length) { return done(out); }
    var left = jobs.length;
    jobs.forEach(function (job) {
      searchStremioAddons(job.t.original, function (found) {
        var hit = tmdbTitleIn(job.t, found);
        if (hit) {
          hit._esTitle = job.t.title;
          hit._searchBoost = job.boost;
          out.push(hit);
        }
        if (--left === 0) { done(out); }
      });
    });
  }).catch(function () { done([]); });
}

function searchTitles(query, update) {
  var addonList = [], extra = [], addonsDone = false, extraDone = false;
  function emit() {
    update(rankSearchResults(query, extra.concat(addonList)), addonsDone && extraDone);
  }
  searchStremioAddons(query, function (list) {
    addonList = list;
    addonsDone = true;
    /* The translated titles are looked up once the plain search is in,
       so a title already found is not searched again. */
    searchByTranslatedTitle(query, addonList, function (found) {
      extra = found;
      extraDone = true;
      emit();
    });
    if (!extraDone) { emit(); }
  }, function (list, pending) {
    if (!pending) { return; }
    addonList = list;
    emit();
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
  if (meta.description) {
    /* Catalogue in Spanish (home/catalog-lang.js): the addon's English
       description is kept as the original, the Spanish one stays shown. */
    if (item._en && item._esShown) { item._en.synopsis = meta.description; }
    else { item.synopsis = meta.description; }
  }
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
