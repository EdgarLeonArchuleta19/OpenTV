'use strict';
/*
 * TMDB (themoviedb.org) trending lists for the home screen.
 *
 * The key is read here, in the main process, and never reaches the page:
 *   1. OPENTV_TMDB_TOKEN (read access token) or OPENTV_TMDB_KEY (API key)
 *   2. config/tmdb.json  { "readAccessToken": "…", "apiKey": "…" }
 * config/tmdb.json is ignored by git (the repository is public) and is
 * packaged into the installer when it exists at build time.
 * Without a key the home screen simply has no TMDB rows.
 *
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 */
const fs = require('node:fs');
const path = require('node:path');

const CACHE_MS = 6 * 60 * 60 * 1000;
const LISTS = {
  'movie-week': '/trending/movie/week',
  'tv-week': '/trending/tv/week',
  'movie-top': '/movie/top_rated',
  'tv-top': '/tv/top_rated'
};
const cache = {};
let credentials;

function readCredentials() {
  if (credentials !== undefined) return credentials;
  credentials = null;
  if (process.env.OPENTV_TMDB_TOKEN || process.env.OPENTV_TMDB_KEY) {
    credentials = { readAccessToken: process.env.OPENTV_TMDB_TOKEN || '', apiKey: process.env.OPENTV_TMDB_KEY || '' };
    return credentials;
  }
  try {
    const file = path.join(__dirname, '..', '..', 'config', 'tmdb.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && (data.readAccessToken || data.apiKey)) credentials = data;
  } catch { /* no key: TMDB rows stay off */ }
  return credentials;
}

function available() { return Boolean(readCredentials()); }

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

async function list(name) {
  const route = LISTS[name];
  if (!route) return { error: 'Lista no permitida' };
  const creds = readCredentials();
  if (!creds) return { error: 'Sin clave de TMDB', unavailable: true };
  const hit = cache[name];
  if (hit && Date.now() - hit.at < CACHE_MS) return { items: hit.items, cached: true };
  const url = new URL('https://api.themoviedb.org/3' + route);
  url.searchParams.set('language', 'es-MX');
  url.searchParams.set('region', 'MX');
  const headers = { accept: 'application/json' };
  if (creds.readAccessToken) headers.Authorization = 'Bearer ' + creds.readAccessToken;
  else url.searchParams.set('api_key', creds.apiKey);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { error: 'TMDB respondió ' + res.status };
    const data = await res.json();
    const kind = name.indexOf('tv') === 0 ? 'tv' : 'movie';
    const items = (data.results || []).slice(0, 20).map((r) => slim(r, kind)).filter((r) => r.title);
    cache[name] = { at: Date.now(), items };
    return { items };
  } catch (error) {
    return { error: 'Sin conexión con TMDB' };
  }
}

module.exports = { list, available };
