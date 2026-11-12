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
    title: r.title || r.name || '',
    original: r.original_title || r.original_name || '',
    year: String(r.release_date || r.first_air_date || '').slice(0, 4),
    rating: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : 0,
    poster: r.poster_path ? 'https://image.tmdb.org/t/p/w342' + r.poster_path : '',
    backdrop: r.backdrop_path ? 'https://image.tmdb.org/t/p/w780' + r.backdrop_path : ''
  };
}

/* done({ items } | { error, unavailable? }) */
/* One page of a TMDB list: done(error, results). */
function fetchPage(route, page, creds, done) {
  var query = 'language=es-MX&region=MX&page=' + page + (creds.readAccessToken ? '' : '&api_key=' + encodeURIComponent(creds.apiKey));
  var headers = { accept: 'application/json' };
  if (creds.readAccessToken) { headers.Authorization = 'Bearer ' + creds.readAccessToken; }
  var finished = false;
  function finish(err, results) { if (!finished) { finished = true; done(err, results); } }
  var path3 = '/3' + route + (route.indexOf('?') === -1 ? '?' : '&') + query;
  var req = https.get({ host: 'api.themoviedb.org', path: path3, headers: headers }, function (res) {
    var chunks = [];
    res.on('data', function (c) { chunks.push(c); });
    res.on('end', function () {
      if (res.statusCode !== 200) { return finish('TMDB respondió ' + res.statusCode); }
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')).results || []); }
      catch (e) { finish('Respuesta de TMDB no válida'); }
    });
  });
  req.setTimeout(10000, function () { req.abort(); finish('Sin conexión con TMDB'); });
  req.on('error', function () { finish('Sin conexión con TMDB'); });
}

/* done({ items } | { error, unavailable? }). Two pages (40 titles): only
   the ones our catalogue has are shown, so a longer list fills the rows. */
var PAGES = 2;
function list(name, done) {
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
      var items = all.map(function (r) { return slim(r, kind); }).filter(function (r) { return r.title; });
      cache[name] = { at: Date.now(), items: items };
      done({ items: items });
    });
  })(1);
}

module.exports = { list: list, available: available };
