/* home/trending.js — Escritorio: "Tendencias de la semana" de TMDB, solo con títulos de nuestro catálogo.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* TMDB says what is popular this week; each title is looked up in the
   catalogue (first the loaded one, then the portal search) and only the
   ones that can actually be played make it into the row, in TMDB's order.
   The result is kept for a few hours so the home screen shows it at once. */
var TRENDING_KEY = 'opentv_trending_v3';
var TRENDING_TTL_MS = 6 * 60 * 60 * 1000;
var TRENDING_MAX = 14;
var TRENDING_SEARCHES = 20;   /* portal searches per list for the titles not loaded yet */
/* `row: true` lists are also rows of their own on the PC (Inicio, Películas,
   Series); the others only feed the top of Kids and Anime. */
var TRENDING_LISTS = [
  { list: 'movie-week', title: 'Tendencias de la semana · Películas', series: false, row: true },
  { list: 'tv-week', title: 'Tendencias de la semana · Series', series: true, row: true },
  { list: 'kids-movie', title: 'Kids · Películas', series: false, searches: 6 },
  { list: 'kids-tv', title: 'Kids · Series', series: true, searches: 6 },
  { list: 'anime-tv', title: 'Anime', series: true, searches: 6 }
];
/* Which lists feed the top of each section (mixed in turns). */
var TREND_SECTIONS = {
  inicio: ['movie-week', 'tv-week'],
  movie: ['movie-week'],
  series: ['tv-week'],
  kids: ['kids-movie', 'kids-tv'],
  anime: ['anime-tv']
};
var trendingRows = [];
var trendingLoading = false;

/* Each catalog mode (PC) keeps its own trends: in the Stremio mode they are
   looked up among the addons' titles, never the integrated catalog's. */
function trendingCacheKey() {
  return TRENDING_KEY + (typeof stremioModeOn === 'function' && stremioModeOn() ? ':stremio' : '');
}

/* A trend shown only with the catalog of the mode it belongs to. */
function trendFitsMode(item) {
  return !item || typeof libraryModeMatches !== 'function' || libraryModeMatches(item.id, item._stremio);
}

/* The catalog mode changed: the other mode's saved trends now, fresh ones
   once its catalog is loaded. */
function resetTrendingForMode() {
  var saved = trendingRowsFromCache();
  trendingRows = saved ? saved.rows : [];
  refreshTrendingPage();
  setTimeout(loadTrending, 1500);
}

/* Electron asks its main process; TVs and Android ask the service (method
   "tmdb"), which keeps the key. Both answer { items } or { error }. */
function tmdbApi() {
  if (!window.XUPER_DESKTOP) { return null; }
  if (window.desktop && window.desktop.tmdb) { return window.desktop.tmdb; }
  return function (list) {
    return new Promise(function (resolve) {
      portalServiceCall('tmdb', { list: list }, function (error, payload) {
        resolve(error || !payload ? { error: error || 'Sin respuesta' } : payload);
      }, 15000);
    });
  };
}

/* The top of a section (the PC hero, the TV cards): what is popular now on
   TMDB for it ('inicio' mixes movies and series), only titles our catalogue
   can play, the lists taking turns. */
function sectionTrendItems(key) {
  var want = TREND_SECTIONS[key] || [];
  var lists = [];
  for (var t = 0; t < trendingRows.length; t++) {
    var tr = trendingRows[t];
    if (tr && tr.items && tr.items.length && want.indexOf(tr.list) !== -1) { lists.push(tr.items); }
  }
  var out = [], seen = {};
  for (var i = 0; i < TRENDING_MAX; i++) {
    for (var l = 0; l < lists.length; l++) {
      var item = lists[l][i];
      if (item && !seen[item.id] && hasUsableCover(item) && trendFitsMode(item)) { seen[item.id] = true; out.push(item); }
    }
  }
  return out;
}

/* "Spider-Man: Un nuevo día (2026) T2" -> "spider-man un nuevo dia" */
function titleKey(s) {
  return norm(String(s || ''))
    .replace(/\(\d{4}\)/g, ' ')
    .replace(/\s+(t|temporada|season|s)\s*\d+\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function catalogMatch(t, pool) {
  var local = titleKey(t.title), original = titleKey(t.original);
  var best = null;
  for (var i = 0; i < pool.length; i++) {
    var v = pool[i];
    if (!v || !hasUsableCover(v)) { continue; }
    if (!!isSeriesItem(v) !== (t.kind === 'tv')) { continue; }
    var vt = titleKey(v.title), va = titleKey(v.alias);
    /* A catalogue title with an extra qualifier in brackets is a different
       film ("La odisea (The Asylum)"): only its own exact title counts. */
    if (/\([^)]*[a-z][^)]*\)/i.test(String(v.title || ''))) { va = ''; }
    var yearMatch = String(v.year || v.releaseDate || '').match(/\d{4}/);
    var sameYear = !!(t.year && yearMatch && Math.abs(parseInt(yearMatch[0], 10) - parseInt(t.year, 10)) <= 1);
    var unknownYear = !t.year || !yearMatch;
    /* The Spanish title is enough when the year agrees (or is unknown); a
       match on the original title alone also needs the same year, or
       look-alike films ("La odisea (The Asylum)") slip in. */
    if (local && local.length >= 2 && (local === vt || local === va)) {
      if (sameYear) { return v; }
      if (unknownYear) { best = best || v; }
    } else if (original && original.length >= 2 && (original === vt || original === va) && sameYear) {
      return v;
    }
  }
  return best;
}

function searchPortalFor(t, done) {
  if (vodApi.mode !== 'portal' || getVodSourcesConfig().mode === 'external') { done(null); return; }
  portalServiceCall('search', { value: t.title, pageNum: 1, pageSize: 10 }, function (error, payload) {
    if (error || !payload || !payload.items) { done(null); return; }
    var found = [];
    for (var i = 0; i < payload.items.length; i++) {
      var item = normalizeVod(payload.items[i], i + 1);
      item._portal = true;
      found.push(item);
    }
    done(catalogMatch(t, found));
  });
}

/* Keeps the matched titles for a TMDB list, in TMDB order. */
function matchTrending(def, tmdbItems, done) {
  var out = new Array(tmdbItems.length);
  var missing = [];
  /* TMDB's backdrop (780 px wide) is kept with the title: the TV cards use
     it, lighter than the portal's full-size art. */
  function keep(idx, hit) {
    if (tmdbItems[idx].backdrop && !hit._trendArt) { hit._trendArt = tmdbItems[idx].backdrop; }
    out[idx] = hit;
  }
  for (var i = 0; i < tmdbItems.length; i++) {
    var hit = catalogMatch(tmdbItems[i], VOD);
    if (hit) { keep(i, hit); } else { missing.push(i); }
  }
  var searches = def.searches || TRENDING_SEARCHES;
  var pending = Math.min(missing.length, searches);
  function finish() {
    var items = [], seen = {};
    for (var j = 0; j < out.length && items.length < TRENDING_MAX; j++) {
      if (out[j] && !seen[out[j].id]) { seen[out[j].id] = true; items.push(out[j]); }
    }
    done({ title: def.title, list: def.list, items: items });
  }
  if (!pending) { finish(); return; }
  missing.slice(0, searches).forEach(function (idx) {
    searchPortalFor(tmdbItems[idx], function (hit) {
      if (hit) { keep(idx, hit); }
      if (--pending === 0) { finish(); }
    });
  });
}

function trendingRowsFromCache() {
  var saved = safeLocalRead(trendingCacheKey(), null);
  if (!saved || !saved.rows || Date.now() - (saved.at || 0) > TRENDING_TTL_MS * 4) { return null; }
  return saved;
}

/* Called on start-up and every few hours (desktop only). */
function loadTrending() {
  var api = tmdbApi();
  if (!api || trendingLoading) { return; }
  var cached = trendingRowsFromCache();
  if (cached) {
    var hadNone = !trendingRows.length;
    trendingRows = cached.rows;
    /* Inicio was built without trends: show the saved ones now. */
    if (hadNone) { refreshTrendingPage(); }
    if (Date.now() - cached.at < TRENDING_TTL_MS) { return; }
  }
  trendingLoading = true;
  var results = [];
  var left = TRENDING_LISTS.length;
  TRENDING_LISTS.forEach(function (def, n) {
    api(def.list).then(function (answer) {
      if (!answer || !answer.items || !answer.items.length) { step(n, null); return; }
      matchTrending(def, answer.items, function (row) { step(n, row); });
    }).catch(function () { step(n, null); });
  });
  function step(n, row) {
    results[n] = row && row.items.length >= 4 ? row : null;
    if (--left > 0) { return; }
    trendingLoading = false;
    var rows = results.filter(function (r) { return !!r; });
    if (!rows.length) { return; }
    trendingRows = rows;
    safeLocalWrite(trendingCacheKey(), { at: Date.now(), rows: rows });
    refreshTrendingPage();
  }
}

/* New rows: rebuild Inicio now if the viewer is not in the middle of it,
   otherwise the next time it is shown. */
function refreshTrendingPage() {
  catalogStaleAt = Date.now() + 1;
  var tab = TABS[state.tab];
  var page = tab ? pages[tab.page] : null;
  /* (Every catalogue section has trends at its top now, not only Inicio.) */
  if (tab && tab.page > 0 && page && state.screen === 'home' && page.scrollTop < 80) {
    ensurePageBuilt(tab.page);
    showHeroForPage(tab.page);
  }
}

/* kind: 'movie' / 'series' shows only that row (Películas, Series pages).
   Only titles currently available in the active VOD catalogue are shown. */
function appendTrendingRows(page, y, kind) {
  for (var i = 0; i < trendingRows.length; i++) {
    var row = trendingRows[i];
    if (!row || !row.items || !row.items.length) { continue; }
    if (row.list && row.list !== 'movie-week' && row.list !== 'tv-week') { continue; }
    if (kind && row.items[0] && (!!isSeriesItem(row.items[0])) !== (kind === 'series')) { continue; }
    var avail = [];
    for (var j = 0; j < row.items.length; j++) {
      /* Titles found with the portal search are not in the loaded catalogue
         but can be played all the same (only 4 of 14 were shown before). */
      var found = row.items[j] && (vodById(row.items[j].id) || row.items[j]);
      if (found && hasUsableCover(found) && trendFitsMode(found)) { avail.push(found); }
    }
    if (avail.length >= 4) {
      y = appendPosterRow(page, y, kind ? 'Tendencias de la semana' : row.title, avail);
    }
  }
  return y;
}

function installTrending() {
  if (!tmdbApi()) { return; }
  /* The saved trends are there before the first page is built, so Inicio
     opens with them instead of being rebuilt a few seconds later. */
  var saved = trendingRowsFromCache();
  if (saved) { trendingRows = saved.rows; }
  /* The catalogue must be there to match against: wait for it a little. */
  setTimeout(loadTrending, 6000);
  setInterval(loadTrending, TRENDING_TTL_MS);
}
