/* home/trending.js — Escritorio: "Tendencias de la semana" de TMDB, solo con títulos de nuestro catálogo.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* TMDB says what is popular this week; each title is looked up in the
   catalogue (first the loaded one, then the portal search) and only the
   ones that can actually be played make it into the row, in TMDB's order.
   The result is kept for a few hours so the home screen shows it at once. */
var TRENDING_KEY = 'opentv_trending_v1';
var TRENDING_TTL_MS = 6 * 60 * 60 * 1000;
var TRENDING_MAX = 14;
var TRENDING_SEARCHES = 10;
var TRENDING_LISTS = [
  { list: 'movie-week', title: 'Tendencias de la semana · Películas', series: false },
  { list: 'tv-week', title: 'Tendencias de la semana · Series', series: true }
];
var trendingRows = [];
var trendingLoading = false;

function tmdbApi() {
  return window.XUPER_DESKTOP && window.desktop && window.desktop.tmdb ? window.desktop.tmdb : null;
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
  for (var i = 0; i < tmdbItems.length; i++) {
    var hit = catalogMatch(tmdbItems[i], VOD);
    if (hit) { out[i] = hit; } else { missing.push(i); }
  }
  var pending = Math.min(missing.length, TRENDING_SEARCHES);
  function finish() {
    var items = [], seen = {};
    for (var j = 0; j < out.length && items.length < TRENDING_MAX; j++) {
      if (out[j] && !seen[out[j].id]) { seen[out[j].id] = true; items.push(out[j]); }
    }
    done({ title: def.title, items: items });
  }
  if (!pending) { finish(); return; }
  missing.slice(0, TRENDING_SEARCHES).forEach(function (idx) {
    searchPortalFor(tmdbItems[idx], function (hit) {
      if (hit) { out[idx] = hit; }
      if (--pending === 0) { finish(); }
    });
  });
}

function trendingRowsFromCache() {
  var saved = safeLocalRead(TRENDING_KEY, null);
  if (!saved || !saved.rows || Date.now() - (saved.at || 0) > TRENDING_TTL_MS * 4) { return null; }
  return saved;
}

/* Called on start-up and every few hours (desktop only). */
function loadTrending() {
  var api = tmdbApi();
  if (!api || trendingLoading) { return; }
  var cached = trendingRowsFromCache();
  if (cached) {
    trendingRows = cached.rows;
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
    safeLocalWrite(TRENDING_KEY, { at: Date.now(), rows: rows });
    refreshTrendingPage();
  }
}

/* New rows: rebuild Inicio now if the viewer is not in the middle of it,
   otherwise the next time it is shown. */
function refreshTrendingPage() {
  catalogStaleAt = Date.now() + 1;
  var tab = TABS[state.tab];
  var page = tab ? pages[tab.page] : null;
  if (tab && tab.page === 1 && page && state.screen === 'home' && page.scrollTop < 80) {
    ensurePageBuilt(1);
    showHeroForPage(1);
  }
}

/* kind: 'movie' / 'series' shows only that row (Películas, Series pages).
   Only titles currently available in the active VOD catalogue are shown. */
function appendTrendingRows(page, y, kind) {
  for (var i = 0; i < trendingRows.length; i++) {
    var row = trendingRows[i];
    if (!row || !row.items || !row.items.length) { continue; }
    if (kind && row.items[0] && (!!isSeriesItem(row.items[0])) !== (kind === 'series')) { continue; }
    var avail = [];
    for (var j = 0; j < row.items.length; j++) {
      var found = row.items[j] && vodById(row.items[j].id);
      if (found && hasUsableCover(found)) { avail.push(found); }
    }
    if (avail.length >= 4) {
      y = appendPosterRow(page, y, kind ? 'Tendencias de la semana' : row.title, avail);
    }
  }
  return y;
}

function installTrending() {
  if (!tmdbApi()) { return; }
  /* The catalogue must be there to match against: wait for it a little. */
  setTimeout(loadTrending, 6000);
  setInterval(loadTrending, TRENDING_TTL_MS);
}
