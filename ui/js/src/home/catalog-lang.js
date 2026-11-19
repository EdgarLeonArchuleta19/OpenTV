/* home/catalog-lang.js — Idioma del catálogo: en español (por defecto) el título, la sinopsis y los episodios de los títulos de los addons se toman de TMDB.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The catalogue still comes from the addons (Cinemeta answers in English);
   only what is shown is translated, through the service's TMDB lookups
   ("es:<imdb id>", "es-season:<tmdb id>:<season>", service/tmdb.js and
   Tmdb.java). Titles without an IMDb id (Kitsu's anime) stay as they are.
   The English texts are kept (item._en): the search still finds a title by
   its English name, and switching to Inglés reloads the app with them. */
var CATALOG_LANG_KEY = 'opentv_catalog_lang_v1';
var CATALOG_ES_CACHE_KEY = 'opentv_catalog_es_v1';
var CATALOG_ES_CACHE_MAX = 600;
var catalogEsCache = null;
var catalogEsSaveTimer = null;
var catalogEsWaiting = {};

function catalogLang() { return safeLocalRead(CATALOG_LANG_KEY, 'es') === 'en' ? 'en' : 'es'; }

function setCatalogLang(lang) {
  var next = lang === 'en' ? 'en' : 'es';
  if (next === catalogLang()) { return; }
  safeLocalWrite(CATALOG_LANG_KEY, next);
  /* Every screen shows the other texts at once: start again. */
  setTimeout(function () { location.reload(); }, 150);
}

function itemImdbId(item) {
  var id = String((item && item._stremioId) || '');
  return /^tt\d{5,10}$/.test(id) ? id : '';
}

/* imdb id -> { t: title, o: overview, id: tmdb id, k: 'movie'|'tv', at }.
   One cache for every profile (texts, not choices), on its own key. */
function catalogEsStore() {
  if (catalogEsCache) { return catalogEsCache; }
  catalogEsCache = {};
  try {
    var raw = localStorage.getItem(CATALOG_ES_CACHE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') { catalogEsCache = parsed; }
  } catch (eRead) { /* storage off */ }
  return catalogEsCache;
}

function saveCatalogEsSoon() {
  if (catalogEsSaveTimer) { return; }
  catalogEsSaveTimer = setTimeout(function () {
    catalogEsSaveTimer = null;
    var store = catalogEsStore();
    var keys = Object.keys(store);
    if (keys.length > CATALOG_ES_CACHE_MAX) {
      keys.sort(function (a, b) { return (store[a].at || 0) - (store[b].at || 0); });
      for (var i = 0; i < keys.length - CATALOG_ES_CACHE_MAX; i++) { delete store[keys[i]]; }
    }
    try { localStorage.setItem(CATALOG_ES_CACHE_KEY, JSON.stringify(store)); } catch (eSave) { /* full */ }
  }, 1500);
}

function applyEsTexts(item, es) {
  if (!item._en) { item._en = { title: item.title, synopsis: item.synopsis, alias: item.alias }; }
  if (es.t) {
    item.title = es.t;
    /* The English name stays searchable. */
    if (!item.alias || item.alias === item._en.title) { item.alias = item._en.title; }
  }
  if (es.o) { item.synopsis = es.o; item._esShown = true; }
  item._esTmdb = es.id || 0;
  item._esKind = es.k || '';
}

/* Gives `item` its Spanish texts: from the cache at once, else from TMDB.
   done(changed) runs once they are in (changed false when nothing to do). */
function localizeItem(item, done) {
  done = done || function () {};
  if (!item || catalogLang() !== 'es') { done(false); return; }
  if (item._esDone) { done(false); return; }
  var imdb = itemImdbId(item);
  if (!imdb) { item._esDone = true; done(false); return; }
  var hit = catalogEsStore()[imdb];
  if (hit) { applyEsTexts(item, hit); item._esDone = true; done(true); return; }
  var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
  if (!api) { done(false); return; }
  /* One request per title, however many places ask for it. */
  if (catalogEsWaiting[imdb]) { catalogEsWaiting[imdb].push({ item: item, done: done }); return; }
  catalogEsWaiting[imdb] = [{ item: item, done: done }];
  api('es:' + imdb).then(function (out) {
    var waiting = catalogEsWaiting[imdb] || [];
    delete catalogEsWaiting[imdb];
    var found = out && !out.error && out.item;
    var es = found ? { t: found.title || '', o: found.overview || '', id: found.tmdbId, k: found.kind, at: Date.now() } : null;
    /* Not on TMDB: remembered too, so it is not asked again. */
    if (out && !out.error) {
      catalogEsStore()[imdb] = es || { t: '', o: '', id: 0, k: '', at: Date.now() };
      saveCatalogEsSoon();
    }
    waiting.forEach(function (w) {
      if (es) { applyEsTexts(w.item, es); }
      w.item._esDone = !!(out && !out.error);
      w.done(!!es);
    });
  });
}

/* The episodes of one season of a series in Spanish (names and summaries),
   once its Spanish texts are known. done(changed). */
function localizeSeason(item, seasonNumber, episodes, done) {
  done = done || function () {};
  if (!item || catalogLang() !== 'es' || !episodes || !episodes.length || !seasonNumber) { done(false); return; }
  localizeItem(item, function () {
    var tmdbId = item._esTmdb;
    if (!tmdbId || item._esKind !== 'tv') { done(false); return; }
    var key = tmdbId + ':' + seasonNumber;
    if (episodes._esKey === key) { done(false); return; }
    var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
    if (!api) { done(false); return; }
    api('es-season:' + key).then(function (out) {
      var list = out && !out.error && out.episodes;
      if (!list || !list.length) { done(false); return; }
      var byNumber = {};
      for (var i = 0; i < list.length; i++) { byNumber[list[i].number] = list[i]; }
      var changed = false;
      for (var e = 0; e < episodes.length; e++) {
        var ep = episodes[e];
        var n = ep.number !== undefined && ep.number !== null ? ep.number : e + 1;
        var es = byNumber[n];
        if (!es) { continue; }
        if (!ep._en) { ep._en = { title: ep.title, synopsis: ep.synopsis }; }
        /* TMDB says "Episodio 5" when it has no Spanish name: keep the
           addon's one then. */
        if (es.title && !/^(episodio|episode)\s*\d+$/i.test(es.title)) { ep.title = es.title; changed = true; }
        if (es.overview) { ep.synopsis = es.overview; changed = true; }
      }
      episodes._esKey = key;
      done(changed);
    });
  });
}

/* Anime from Kitsu: its episode pictures are uploaded by people and come in
   every size and quality (825 px to heavily compressed 4K). When the series
   is found on TMDB with certainty, its own pictures (and, in Spanish, the
   episode names) are used instead:
   - a TV series first aired the same year as Kitsu's entry (Kitsu lists
     each season apart: "Attack on Titan" 2017 is the 2nd season, not found
     here, so nothing changes), and
   - whose first season has exactly as many episodes.
   Anything else keeps Kitsu's pictures. done(changed). */
function animeEpisodeStills(item, episodes, done) {
  done = done || function () {};
  var id = String((item && item._stremioId) || '');
  if (!/^kitsu:/.test(id) || !episodes || !episodes.length || episodes._stillsKey) { done(false); return; }
  var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
  var year = String((item && item.year) || '').slice(0, 4);
  if (!api || !/^\d{4}$/.test(year)) { done(false); return; }
  episodes._stillsKey = 'pending';
  var name = (item._en && item._en.title) || item.title || '';
  api('search:' + name).then(function (out) {
    var list = (out && !out.error && out.items) || [];
    var show = null;
    for (var i = 0; i < list.length && !show; i++) {
      if (list[i].kind === 'tv' && String(list[i].year) === year) { show = list[i]; }
    }
    if (!show) { episodes._stillsKey = 'none'; done(false); return; }
    api('es-season:' + show.tmdbId + ':1').then(function (s) {
      var eps = (s && !s.error && s.episodes) || [];
      if (eps.length !== episodes.length) { episodes._stillsKey = 'none'; done(false); return; }
      var byNumber = {};
      for (var k = 0; k < eps.length; k++) { byNumber[eps[k].number] = eps[k]; }
      var changed = false;
      var spanish = catalogLang() === 'es';
      for (var e = 0; e < episodes.length; e++) {
        var ep = episodes[e];
        var n = ep.number !== undefined && ep.number !== null ? ep.number : e + 1;
        var match = byNumber[n];
        if (!match) { continue; }
        if (match.still) { ep._kitsuThumb = ep.thumb; ep.thumb = match.still; changed = true; }
        if (spanish) {
          if (!ep._en) { ep._en = { title: ep.title, synopsis: ep.synopsis }; }
          if (match.title && !/^(episodio|episode)\s*\d+$/i.test(match.title)) { ep.title = match.title; changed = true; }
          if (match.overview) { ep.synopsis = match.overview; changed = true; }
        }
      }
      episodes._stillsKey = String(show.tmdbId);
      done(changed);
    });
  });
}
