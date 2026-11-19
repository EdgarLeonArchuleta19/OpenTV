'use strict';
/*
 * TMDB (themoviedb.org) trending lists, shared by every platform: Electron
 * calls it in its main process and the TVs / Android reach it through the
 * service method "tmdb". Plain https and callbacks: it also runs on the
 * old Node of the LG webOS service.
 *
 * The key never reaches the page. It is read from
 *   1. OPENTV_TMDB_TOKEN (read access token) or OPENTV_TMDB_KEY (API key)
 *   2. config/tmdb.json  { "readAccessToken": "…", "apiKey": "…" }, next to
 *      the service folder (the repository) or inside it (packaged builds).
 * config/tmdb.json is ignored by git (the repository is public). Without a
 * key the trending rows simply stay off.
 *
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 */
var fs = require('fs');
var path = require('path');
var https = require('https');

var CACHE_MS = 6 * 60 * 60 * 1000;
var LISTS = {
  'movie-week': '/trending/movie/week',
  'tv-week': '/trending/tv/week',
  'movie-top': '/movie/top_rated',
  'tv-top': '/tv/top_rated',
  /* Kids and Anime sections: what is popular right now in those genres. */
  'kids-movie': '/discover/movie?with_genres=10751&sort_by=popularity.desc&include_adult=false',
  'kids-tv': '/discover/tv?with_genres=10762&sort_by=popularity.desc',
  'anime-tv': '/discover/tv?with_genres=16&with_original_language=ja&sort_by=popularity.desc'
};
var cache = {};
var credentials;

function readCredentials() {
  if (credentials !== undefined) { return credentials; }
  credentials = null;
  if (process.env.OPENTV_TMDB_TOKEN || process.env.OPENTV_TMDB_KEY) {
    credentials = { readAccessToken: process.env.OPENTV_TMDB_TOKEN || '', apiKey: process.env.OPENTV_TMDB_KEY || '' };
    return credentials;
  }
  var files = [path.join(__dirname, '..', 'config', 'tmdb.json'), path.join(__dirname, 'config', 'tmdb.json')];
  for (var i = 0; i < files.length && !credentials; i++) {
    try {
      var data = JSON.parse(fs.readFileSync(files[i], 'utf8'));
      if (data && (data.readAccessToken || data.apiKey)) { credentials = data; }
    } catch (e) { /* not there */ }
  }
  return credentials;
}

function available() { return !!readCredentials(); }

/* Only what the rows need: titles, year, poster/backdrop, rating. */
function slim(r, kind) {
  return {
    tmdbId: r.id,
    kind: kind,
    date: String(r.release_date || r.first_air_date || ''),
    title: r.title || r.name || '',
    original: r.original_title || r.original_name || '',
    year: String(r.release_date || r.first_air_date || '').slice(0, 4),
    rating: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : 0,
    poster: r.poster_path ? 'https://image.tmdb.org/t/p/w342' + r.poster_path : '',
    backdrop: r.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + r.backdrop_path : ''
  };
}

/* done({ items } | { error, unavailable? }) */
/* One TMDB answer in Spanish (Mexico): done(error, json). `extra` is added
   to the query (page, region). */
function fetchJson(route, extra, creds, done) {
  var query = 'language=es-MX' + (extra || '') + (creds.readAccessToken ? '' : '&api_key=' + encodeURIComponent(creds.apiKey));
  var headers = { accept: 'application/json' };
  if (creds.readAccessToken) { headers.Authorization = 'Bearer ' + creds.readAccessToken; }
  var finished = false;
  function finish(err, json) { if (!finished) { finished = true; done(err, json); } }
  var path3 = '/3' + route + (route.indexOf('?') === -1 ? '?' : '&') + query;
  var req = https.get({ host: 'api.themoviedb.org', path: path3, headers: headers }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      if (res.statusCode !== 200) { return finish('TMDB respondió ' + res.statusCode); }
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}); }
      catch (e) { finish('Respuesta de TMDB no válida'); }
    });
  });
  req.setTimeout(10000, function () { req.abort(); finish('Sin conexión con TMDB'); });
  req.on('error', function () { finish('Sin conexión con TMDB'); });
}

/* One page of a TMDB list: done(error, results). */
function fetchPage(route, page, creds, done) {
  /* (No region for a search: it turns the year into Mexico's release date,
     "El padrino" 1998, and then it no longer matches the addons' 1972.) */
  var extra = (route.indexOf('/search/') === 0 ? '' : '&region=MX') + '&page=' + page;
  fetchJson(route, extra, creds, function (err, json) { done(err, err ? null : (json.results || [])); });
}

/* ---- Spanish texts for the addons' titles (catalogue language) ----
   The catalogue still comes from the addons (Cinemeta speaks English);
   these only translate what is shown:
   "es:<imdb id>"                 → { item: { tmdbId, kind, title, overview } }
   "es-season:<tmdb id>:<season>" → { episodes: [{ number, title, overview, still }] } */
var ES_CACHE_MAX = 500;
var esCache = {}, esCacheSize = 0;
function esCached(key, make, done) {
  var hit = esCache[key];
  if (hit && Date.now() - hit.at < CACHE_MS * 4) { return done(hit.out); }
  make(function (out) {
    if (!out.error) {
      if (esCacheSize >= ES_CACHE_MAX) { esCache = {}; esCacheSize = 0; }
      esCache[key] = { at: Date.now(), out: out };
      esCacheSize++;
    }
    done(out);
  });
}
function spanishTitle(imdb, done) {
  if (!/^tt\d{5,10}$/.test(imdb)) { return done({ error: 'Id no válido' }); }
  var creds = readCredentials();
  if (!creds) { return done({ error: 'Sin clave de TMDB', unavailable: true }); }
  esCached('t:' + imdb, function (back) {
    fetchJson('/find/' + imdb + '?external_source=imdb_id', '', creds, function (err, json) {
      if (err) { return back({ error: err }); }
      var r = (json.movie_results && json.movie_results[0]) || (json.tv_results && json.tv_results[0]);
      if (!r) { return back({ item: null }); }
      back({ item: {
        tmdbId: r.id,
        kind: json.movie_results && json.movie_results[0] ? 'movie' : 'tv',
        title: r.title || r.name || '',
        overview: r.overview || ''
      } });
    });
  }, done);
}
function spanishSeason(tmdbId, season, done) {
  if (!/^\d{1,9}$/.test(tmdbId) || !/^\d{1,4}$/.test(season)) { return done({ error: 'Id no válido' }); }
  var creds = readCredentials();
  if (!creds) { return done({ error: 'Sin clave de TMDB', unavailable: true }); }
  esCached('s:' + tmdbId + ':' + season, function (back) {
    fetchJson('/tv/' + tmdbId + '/season/' + season, '', creds, function (err, json) {
      if (err) { return back({ error: err }); }
      var eps = (json.episodes || []).map(function (e) {
        return { number: e.episode_number, title: e.name || '', overview: e.overview || '',
          still: e.still_path ? 'https://image.tmdb.org/t/p/w780' + e.still_path : '' };
      });
      back({ episodes: eps });
    });
  }, done);
}

/* Today as YYYY-MM-DD in the local time zone (TMDB's dates). */
function localDate() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* done({ items } | { error, unavailable? }). Two pages (40 titles): only
   the ones our catalogue has are shown, so a longer list fills the rows. */
var PAGES = 2;
function list(name, done) {
  if (/^search:/.test(String(name))) { return search(String(name).slice(7), done); }
  var es = /^es:(tt\d+)$/.exec(String(name));
  if (es) { return spanishTitle(es[1], done); }
  var esSeason = /^es-season:(\d+):(\d+)$/.exec(String(name));
  if (esSeason) { return spanishSeason(esSeason[1], esSeason[2], done); }
  var route = LISTS[name];
  if (!route) { return done({ error: 'Lista no permitida' }); }
  var creds = readCredentials();
  if (!creds) { return done({ error: 'Sin clave de TMDB', unavailable: true }); }
  var hit = cache[name];
  if (hit && Date.now() - hit.at < CACHE_MS) { return done({ items: hit.items, cached: true }); }
  var kind = route.indexOf('/tv') !== -1 ? 'tv' : 'movie';
  var all = [];
  (function next(page) {
    fetchPage(route, page, creds, function (err, results) {
      if (err && !all.length) { return done({ error: err }); }
      if (!err) { all = all.concat(results); }
      if (!err && page < PAGES && results.length) { return next(page + 1); }
      /* Only what is already out: the weekly trends also bring films that
         open next month (no date, or a date after today). */
      var today = localDate();
      var items = all.map(function (r) { return slim(r, kind); }).filter(function (r) { return r.title && r.date && r.date <= today; });
      cache[name] = { at: Date.now(), items: items };
      done({ items: items });
    });
  })(1);
}

/* The search box: "search:<text>" finds movies and series by their Spanish
   (or original) title, so the app can look the original title up in the
   addons (Cinemeta only knows English titles). One page, no people. */
var SEARCH_CACHE_MAX = 200;
var searchCache = {}, searchCacheSize = 0;
function search(text, done) {
  var q = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (q.length < 2) { return done({ items: [] }); }
  var creds = readCredentials();
  if (!creds) { return done({ error: 'Sin clave de TMDB', unavailable: true }); }
  var key = q.toLowerCase();
  var hit = searchCache[key];
  if (hit && Date.now() - hit.at < CACHE_MS) { return done({ items: hit.items, cached: true }); }
  fetchPage('/search/multi?include_adult=false&query=' + encodeURIComponent(q), 1, creds, function (err, results) {
    if (err) { return done({ error: err }); }
    var items = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r || (r.media_type !== 'movie' && r.media_type !== 'tv')) { continue; }
      var s = slim(r, r.media_type);
      if (s.title) { items.push(s); }
    }
    if (searchCacheSize >= SEARCH_CACHE_MAX) { searchCache = {}; searchCacheSize = 0; }
    searchCache[key] = { at: Date.now(), items: items };
    searchCacheSize++;
    done({ items: items });
  });
}

module.exports = { list: list, search: search, available: available };
