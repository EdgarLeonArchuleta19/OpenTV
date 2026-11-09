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
    _portal: raw.portal === true || raw._portal === true || (vodApi && vodApi.mode === 'portal' && String(raw.id || '').length > 10)
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
