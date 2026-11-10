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
    if (portal && records[i].portal !== false) { item._portal = true; }
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

/* ------------------------------------------- Fuentes Externas VOD y Stremio Addons
   Permite que el usuario conecte addons compatibles con el protocolo de Stremio
   (manifest.json / catalog / meta / stream) o catálogos JSON/M3U externos para
   que la app siga funcionando incluso si el servidor principal (magis.js) falla. */
var VOD_SOURCES_STORAGE_KEY = 'opentv_vod_sources_v1';
var PRESET_VOD_ADDONS = [
  {
    id: 'stremio_cinemeta',
    name: 'Cinemeta (Catálogo Oficial Stremio)',
    desc: 'Catálogo público de películas y series con pósteres HD, sinopsis y temporadas (IMDb).',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
    kind: 'stremio'
  },
  {
    id: 'stremio_public_movies',
    name: 'Archivo de Cine Abierto (Streams Directos)',
    desc: 'Películas clásicas y cortos abiertos listos para reproducir al instante sin servidor.',
    url: 'builtin://open-cinema',
    kind: 'builtin'
  }
];

function getVodSourcesConfig() {
  try {
    var raw = localStorage.getItem(VOD_SOURCES_STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          mode: parsed.mode || 'auto',
          addons: Object.prototype.toString.call(parsed.addons) === '[object Array]' ? parsed.addons : []
        };
      }
    }
  } catch (e) {}
  return { mode: 'auto', addons: [] };
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
  if (/^builtin:\/\//i.test(clean)) { return clean; }
  if (!/^https?:\/\//i.test(clean)) { clean = 'https://' + clean; }
  return clean;
}

function stremioBaseFromUrl(url) {
  var clean = normalizeStremioManifestUrl(url);
  return clean.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/$/, '');
}

function stremioMetaToVodRecord(meta, baseUrl, forcedCat) {
  if (!meta || (!meta.id && !meta.name)) { return null; }
  var isSeries = meta.type === 'series' || meta.type === 'tv';
  var genres = meta.genres || meta.genre || [];
  var catParts = [];
  if (forcedCat) { catParts.push(forcedCat); }
  catParts.push('featured');
  catParts.push(isSeries ? 'series' : 'movies');
  for (var g = 0; g < genres.length; g++) {
    var gn = norm(String(genres[g] || ''));
    if (gn.indexOf('anim') !== -1) { catParts.push('anime'); }
    if (gn.indexOf('family') !== -1 || gn.indexOf('kids') !== -1 || gn.indexOf('infantil') !== -1) { catParts.push('kids'); }
  }
  return {
    id: String(meta.id || meta.imdb_id || ('stremio-' + Math.random())),
    title: String(meta.name || meta.title || 'Sin título'),
    category: catParts.join(','),
    row: isSeries ? 'Series (Stremio)' : 'Películas (Stremio)',
    _rows: ['Destacados (Stremio)', isSeries ? 'Series (Stremio)' : 'Películas (Stremio)'],
    score: String(meta.imdbRating || meta.rating || '—'),
    year: String(meta.releaseInfo || meta.year || '—').slice(0, 4),
    duration: meta.runtime || '—',
    genres: genres.length ? genres : ['Stremio'],
    director: Object.prototype.toString.call(meta.director) === '[object Array]' ? meta.director.join(', ') : (meta.director || '—'),
    actors: Object.prototype.toString.call(meta.cast) === '[object Array]' ? meta.cast.join(', ') : (meta.cast || '—'),
    synopsis: meta.description || meta.overview || 'Catálogo externo conectado desde Stremio.',
    kind: isSeries ? 'serie' : 'película',
    type: isSeries ? 'teleplay' : 'movie',
    poster: meta.poster || '',
    landscape: meta.background || meta.poster || '',
    backdrop: meta.background || meta.poster || '',
    streamUrl: meta.streamUrl || '',
    portal: false,
    _portal: false,
    _stremio: true,
    _stremioBase: baseUrl || '',
    _stremioType: isSeries ? 'series' : 'movie'
  };
}

function fetchSingleVodAddonItems(addon, done) {
  var url = normalizeStremioManifestUrl(addon && addon.url);
  if (!url) { return done('URL vacía', []); }
  if (url === 'builtin://open-cinema') {
    var openItems = openSamples();
    for (var o = 0; o < openItems.length; o++) {
      openItems[o].category = 'featured,movies,free';
      openItems[o].row = 'Cine Abierto';
      openItems[o]._rows = ['Cine Abierto'];
      openItems[o].portal = false;
    }
    return done(null, openItems, { name: 'Archivo de Cine Abierto', kind: 'builtin' });
  }
  if (/\.m3u8?(\?.*)?$/i.test(url)) {
    portalServiceCall('fetchM3u', { url: url }, function (err, payload) {
      if (err || !payload || !payload.channels || !payload.channels.length) {
        return done(err || 'No se encontraron elementos en la lista M3U', []);
      }
      var items = [];
      for (var i = 0; i < payload.channels.length; i++) {
        var ch = payload.channels[i];
        items.push({
          id: 'm3uvod-' + (ch.id || (i + 1)),
          title: ch.name || ('Vídeo ' + (i + 1)),
          category: 'featured,movies',
          row: ch.group || 'Catálogo M3U',
          _rows: [ch.group || 'Catálogo M3U'],
          poster: ch.logo || '',
          landscape: ch.logo || '',
          backdrop: ch.logo || '',
          streamUrl: ch.streamUrl || '',
          kind: 'película',
          type: 'movie',
          portal: false,
          _portal: false
        });
      }
      done(null, items, { name: addon.name || 'Catálogo M3U VOD', kind: 'm3u' });
    });
    return;
  }
  var baseUrl = stremioBaseFromUrl(url);
  var manifestUrl = /\/manifest\.json(\?.*)?$/i.test(url) ? url : (baseUrl + '/manifest.json');
  apiRequest(manifestUrl, function (err, manifest) {
    if (!err && manifest && (manifest.id || manifest.name) && manifest.catalogs) {
      var catalogs = [];
      for (var c = 0; c < manifest.catalogs.length; c++) {
        var cat = manifest.catalogs[c];
        if (cat && (cat.type === 'movie' || cat.type === 'series') && (!cat.extraRequired || !cat.extraRequired.length)) {
          catalogs.push(cat);
        }
      }
      if (!catalogs.length) {
        catalogs = [{ type: 'movie', id: 'top' }, { type: 'series', id: 'top' }];
      } else if (catalogs.length > 3) {
        catalogs = catalogs.slice(0, 3);
      }
      var collected = [];
      var idx = 0;
      function nextCat() {
        if (idx >= catalogs.length) {
          return done(null, collected, {
            name: manifest.name || addon.name || 'Addon Stremio',
            desc: manifest.description || '',
            kind: 'stremio',
            baseUrl: baseUrl
          });
        }
        var cObj = catalogs[idx++];
        var catUrl = baseUrl + '/catalog/' + encodeURIComponent(cObj.type) + '/' + encodeURIComponent(cObj.id) + '.json';
        apiRequest(catUrl, function (cErr, cPayload) {
          var metas = (!cErr && cPayload && cPayload.metas) ? cPayload.metas : [];
          for (var m = 0; m < Math.min(metas.length, 45); m++) {
            var rec = stremioMetaToVodRecord(metas[m], baseUrl);
            if (rec) { collected.push(rec); }
          }
          nextCat();
        });
      }
      nextCat();
      return;
    }
    /* Fallback: probar si la URL es un JSON directo con películas/series */
    apiRequest(url, function (jErr, jPayload) {
      if (jErr || !jPayload) {
        return done(err || jErr || 'No se pudo leer el manifest.json ni el catálogo JSON', []);
      }
      var arr = jPayload.metas || apiArray(jPayload);
      if (!arr.length) { return done('El enlace no contiene títulos compatibles', []); }
      var out = [];
      for (var k = 0; k < arr.length; k++) {
        if (arr[k].id && arr[k].type && (arr[k].poster || arr[k].imdbRating)) {
          var sRec = stremioMetaToVodRecord(arr[k], baseUrl);
          if (sRec) { out.push(sRec); }
        } else {
          var rawRec = arr[k];
          rawRec.portal = false;
          if (!rawRec.category) { rawRec.category = 'featured,movies'; }
          out.push(rawRec);
        }
      }
      done(null, out, { name: addon.name || 'Catálogo JSON Externo', kind: 'json', baseUrl: baseUrl });
    });
  });
}

function installVodAddon(addonInput, done) {
  done = done || function () {};
  var url = normalizeStremioManifestUrl(addonInput && addonInput.url);
  if (!url) { return done('Escribe una URL válida (https://.../manifest.json o .m3u)'); }
  fetchSingleVodAddonItems({ name: addonInput.name, url: url }, function (err, items, meta) {
    if (err) { return done(err); }
    var cfg = getVodSourcesConfig();
    var exists = false;
    for (var i = 0; i < cfg.addons.length; i++) {
      if (cfg.addons[i].url === url) {
        cfg.addons[i].name = (meta && meta.name) || addonInput.name || cfg.addons[i].name;
        cfg.addons[i].count = items.length;
        cfg.addons[i].kind = (meta && meta.kind) || 'stremio';
        cfg.addons[i].baseUrl = (meta && meta.baseUrl) || stremioBaseFromUrl(url);
        exists = true;
        break;
      }
    }
    if (!exists) {
      cfg.addons.push({
        id: (addonInput && addonInput.id) || ('vod_addon_' + Date.now()),
        name: (meta && meta.name) || (addonInput && addonInput.name) || 'Addon Stremio',
        desc: (meta && meta.desc) || (addonInput && addonInput.desc) || '',
        url: url,
        baseUrl: (meta && meta.baseUrl) || stremioBaseFromUrl(url),
        kind: (meta && meta.kind) || 'stremio',
        count: items.length
      });
    }
    saveVodSourcesConfig(cfg);
    syncExternalVodCatalogs(function () {
      done(null, items.length, meta);
    });
  });
}

function syncExternalVodCatalogs(done, forceApply) {
  done = done || function () {};
  var cfg = getVodSourcesConfig();
  if (cfg.mode === 'portal' && !forceApply) { return done(null, 0); }
  if (!cfg.addons.length) { return done(null, 0); }
  var allExternal = [];
  var idx = 0;
  function next() {
    if (idx >= cfg.addons.length) {
      saveVodSourcesConfig(cfg);
      if (allExternal.length) {
        var combined = allExternal.slice();
        /* Modo manual: el catálogo es solo de tus addons. Respaldo automático:
           se suman a los títulos que ya había. */
        if (cfg.mode !== 'external') {
          var seen = {};
          for (var e = 0; e < combined.length; e++) { seen[String(combined[e].id)] = true; }
          for (var v = 0; v < VOD.length; v++) {
            if (!seen[String(VOD[v].id)]) {
              combined.push(VOD[v]);
              seen[String(VOD[v].id)] = true;
            }
          }
        }
        replaceVod(combined, 'stremio-external', false);
      }
      return done(null, allExternal.length);
    }
    var ad = cfg.addons[idx++];
    fetchSingleVodAddonItems(ad, function (err, items, meta) {
      if (!err && items && items.length) {
        ad.count = items.length;
        if (meta && meta.name && (!ad.name || ad.name === 'Addon Stremio')) { ad.name = meta.name; }
        for (var j = 0; j < items.length; j++) { allExternal.push(items[j]); }
      }
      next();
    });
  }
  next();
}

/* Modos del catálogo de películas y series:
   - 'auto'     Respaldo automático (recomendado): servidor principal y, si
                falla, tus addons.
   - 'external' Modo manual: solo tus addons de Stremio, sin servidor.
   - 'portal'   Modo servidor: solo el servidor principal, sin addons.
   Cambiar de modo guarda la opción y recarga el catálogo al momento. */
var VOD_SOURCE_MODES = [
  { id: 'auto', title: 'Respaldo automático', badge: 'Recomendado',
    desc: 'Usa el servidor principal y, si falla o deja de funcionar, cambia solo a tus addons de Stremio.' },
  { id: 'external', title: 'Modo manual · Stremio',
    desc: 'Solo muestra lo que traen tus addons de Stremio. No se conecta al servidor principal.' },
  { id: 'portal', title: 'Modo servidor',
    desc: 'Solo usa el servidor principal. Tus addons quedan guardados pero no se usan.' }
];

function applyVodSourceMode(mode, done) {
  done = done || function () {};
  var cfg = getVodSourcesConfig();
  var previous = cfg.mode;
  if (mode === 'external' && !cfg.addons.length) {
    return done('Primero conecta al menos un addon de Stremio abajo para usar el modo manual.');
  }
  cfg.mode = mode;
  saveVodSourcesConfig(cfg);
  if (mode === 'external') {
    syncExternalVodCatalogs(function (err, count) {
      if (!count) {
        /* Ningún addon respondió: volver al modo anterior para no dejar la app vacía. */
        var back = getVodSourcesConfig();
        back.mode = previous;
        saveVodSourcesConfig(back);
        return done('Tus addons no devolvieron títulos. Revisa que estén en línea; se mantuvo el modo anterior.');
      }
      done(null, count);
    }, true);
    return;
  }
  /* Respaldo automático o servidor: quitar lo que vino de Stremio y recargar
     desde el servidor principal. */
  var own = [];
  for (var i = 0; i < VOD.length; i++) { if (!VOD[i]._stremio) { own.push(VOD[i]); } }
  if (own.length && own.length !== VOD.length) { replaceVod(own, 'portal-snapshot', false); }
  loadVodCatalog();
  done(null, own.length);
}

function loadStremioMeta(item, done) {
  done = done || function () {};
  if (!item || !item._stremio) { return done(item); }
  var baseUrl = item._stremioBase || 'https://v3-cinemeta.strem.io';
  var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
  var metaUrl = baseUrl.replace(/\/$/, '') + '/meta/' + encodeURIComponent(type) + '/' + encodeURIComponent(item.id) + '.json';
  item._detailLoading = true;
  apiRequest(metaUrl, function (err, payload) {
    item._detailLoading = false;
    var meta = (!err && payload && payload.meta) ? payload.meta : null;
    if (meta) {
      if (meta.description) { item.synopsis = meta.description; }
      if (meta.runtime) { item.duration = meta.runtime; }
      if (meta.imdbRating) { item.score = String(meta.imdbRating); }
      if (meta.genres && meta.genres.length) { item.genres = meta.genres; }
      if (meta.videos && meta.videos.length && isSeriesItem(item)) {
        var seasonsMap = {};
        var seasonsList = [];
        for (var v = 0; v < meta.videos.length; v++) {
          var vid = meta.videos[v];
          var sNum = parseInt(vid.season, 10);
          if (!sNum || sNum < 1) { continue; }
          if (!seasonsMap[sNum]) {
            seasonsMap[sNum] = { id: item.id + ':S' + sNum, number: sNum, _episodes: [] };
            seasonsList.push(seasonsMap[sNum]);
          }
          var epNum = parseInt(vid.episode || vid.number, 10) || (seasonsMap[sNum]._episodes.length + 1);
          seasonsMap[sNum]._episodes.push({
            id: vid.id || (item.id + ':' + sNum + ':' + epNum),
            number: epNum,
            seriesNumber: epNum,
            title: vid.name || vid.title || ('Capítulo ' + epNum),
            synopsis: vid.overview || vid.description || '',
            thumb: vid.thumbnail || item.backdrop || item.poster || '',
            streamUrl: vid.streamUrl || ''
          });
        }
        seasonsList.sort(function (a, b) { return a.number - b.number; });
        for (var s = 0; s < seasonsList.length; s++) {
          seasonsList[s]._episodes.sort(function (a, b) { return a.number - b.number; });
        }
        if (seasonsList.length) {
          item.seasons = seasonsList;
          item.episodes = seasonsList[0]._episodes;
          state.detailSeason = 0;
          state.detailEpisode = item.episodes[0] || null;
        }
      }
    }
    item._detailsLoaded = true;
    if (state.detail === item && state.screen === 'detail') {
      buildDetail(item);
    }
    done(item);
  });
}

function resolveStremioStream(item, episode, done) {
  done = done || function () {};
  if (episode && episode.streamUrl) { return done(episode.streamUrl); }
  if (item && item.streamUrl) { return done(item.streamUrl); }
  var cfg = getVodSourcesConfig();
  var bases = [];
  if (item && item._stremioBase) { bases.push(item._stremioBase); }
  for (var i = 0; i < cfg.addons.length; i++) {
    var b = cfg.addons[i].baseUrl || stremioBaseFromUrl(cfg.addons[i].url);
    if (b && /^https?:\/\//i.test(b) && bases.indexOf(b) === -1) { bases.push(b); }
  }
  var type = (item && item._stremioType) || (isSeriesItem(item) ? 'series' : 'movie');
  var streamId = (episode && episode.id) ? episode.id : (item ? item.id : '');
  var idx = 0;
  function tryNext() {
    if (idx >= bases.length) {
      /* Si el usuario solo instaló un addon de catálogo (ej. Cinemeta) sin addon de streams,
         avisar claramente cómo agregar un addon de streams o usar muestra abierta */
      state.streamError = 'Este addon (ej. Cinemeta) aporta el catálogo y fichas; agrega en Mi cuenta un addon de Stremio con streams HTTP/HLS directos para reproducirlo.';
      setPlayerStatus(state.streamError);
      return done('');
    }
    var base = bases[idx++].replace(/\/$/, '');
    var url = base + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(streamId) + '.json';
    apiRequest(url, function (err, payload) {
      var streams = (!err && payload && payload.streams) ? payload.streams : [];
      for (var s = 0; s < streams.length; s++) {
        if (streams[s] && streams[s].url && /^https?:\/\//i.test(streams[s].url)) {
          return done(streams[s].url);
        }
      }
      tryNext();
    });
  }
  tryNext();
}
