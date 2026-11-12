'use strict';
/* Stremio mode (PC): reading an addon's manifest, its titles and its sources,
   and the catalog modes. No network: only the parsing and the rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./helpers/load-modules.cjs');

const plain = (v) => JSON.parse(JSON.stringify(v));
const isSeriesItem = (item) => !!item && (item.type === 'teleplay' || item.kind === 'serie');

function storage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

function load(opts) {
  opts = opts || {};
  return loadModules(['core/utils.js', 'core/platform.js', 'services/vod-api.js', 'player/stremio-sources.js'], {
    localStorage: storage(opts.storage),
    window: { XUPER_DESKTOP: true, location: { search: '', hash: '', href: 'xuper://app/index.html' }, OPENTV_PLATFORM: { name: opts.platform || 'electron', tv: !!opts.tv, has: (c) => (opts.caps || ['addons', 'torrents']).indexOf(c) !== -1 } },
    location: { search: '', hash: '' },
    isSeriesItem,
    vodApi: {},
    state: {}
  });
}

const MANIFEST = {
  id: 'org.example', name: 'Ejemplo', types: ['movie', 'series'], idPrefixes: ['tt'],
  resources: ['catalog', { name: 'meta', types: ['movie', 'series'] }, { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
  catalogs: [
    { type: 'movie', id: 'top', name: 'Popular' },
    { type: 'series', id: 'top', name: 'Popular', extra: [{ name: 'genre' }] },
    { type: 'movie', id: 'search', name: 'Buscar', extra: [{ name: 'search', isRequired: true }] },
    { type: 'channel', id: 'x' }
  ],
  behaviorHints: { configurable: true }
};

test('the manifest says what the addon offers and which catalogs are home rows', () => {
  const ctx = load();
  const info = plain(ctx.stremioAddonInfo(MANIFEST, 'https://addon.example/abc/manifest.json'));
  assert.equal(info.baseUrl, 'https://addon.example/abc');
  assert.equal(info.configurable, true);
  assert.deepEqual(info.catalogs.map((c) => [c.type, c.id, c.home, c.search]),
    [['movie', 'top', true, false], ['series', 'top', true, false], ['movie', 'search', false, true]]);
  assert.equal(ctx.addonSupports(info, 'stream', 'movie', 'tt123'), true);
  assert.equal(ctx.addonSupports(info, 'stream', 'movie', 'kitsu:1'), false);   /* idPrefixes */
  assert.equal(ctx.addonSupports(info, 'subtitles', 'movie', 'tt123'), false);
});

test('addon titles get their own ids, the catalog categories and the row name', () => {
  const ctx = load();
  const movie = plain(ctx.stremioMetaToVodRecord({ id: 'tt1', type: 'movie', name: 'Uno', genres: ['Animation'], poster: 'p.jpg' }, 'https://a', 'Popular · Películas'));
  assert.equal(movie.id, 'stremio:tt1');
  assert.equal(movie._stremioId, 'tt1');
  assert.equal(movie.category, 'destacado,pelicula,anime');
  assert.deepEqual(movie._rows, ['Popular · Películas']);
  const show = plain(ctx.stremioMetaToVodRecord({ id: 'tt2', type: 'series', name: 'Dos', genres: ['Family'] }, 'https://a', ''));
  assert.equal(show.category, 'destacado,serie,infantil');
  assert.equal(show.type, 'teleplay');
});

test('row names stay unique when two addons have a catalog with the same name', () => {
  const ctx = load();
  const taken = {};
  assert.equal(ctx.stremioRowName({ name: 'A' }, { type: 'movie', name: 'Popular' }, taken), 'Popular · Películas');
  assert.equal(ctx.stremioRowName({ name: 'B' }, { type: 'movie', name: 'Popular' }, taken), 'Popular · Películas (B)');
  assert.equal(ctx.stremioRowName({ name: 'B' }, { type: 'series', name: '' }, taken), 'Series');
});

test('sources: quality, size and peers are read, and only playable ones are kept', () => {
  const ctx = load();
  const torrent = plain(ctx.describeStremioStream({ name: 'Addon\n1080p', title: 'Movie.2010.1080p.mkv\n👤 23 💾 2.1 GB ⚙️ Sitio', infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01', fileIdx: 2 }, 'Addon'));
  assert.equal(torrent.kind, 'torrent');
  assert.equal(torrent.quality, '1080p');
  assert.equal(torrent.size, '2.1 GB');
  assert.equal(torrent.seeds, 23);
  assert.equal(torrent.infoHash, 'abcdef0123456789abcdef0123456789abcdef01');
  assert.equal(torrent.label, 'Movie.2010.1080p.mkv');
  assert.equal(Math.round(torrent.sizeBytes / 1048576), 2150);   /* 2.1 GB, for "Más pesadas / ligeras" */
  assert.equal(torrent.spanish, false);
  assert.equal(plain(ctx.describeStremioStream({ title: 'Peli.2026.1080p-Dual-Lat.mkv\n🇲🇽', infoHash: 'f'.repeat(40) }, 'A')).spanish, true);
  assert.equal(ctx.sizeToBytes('481.44 MB') > ctx.sizeToBytes('0.4 GB'), true);
  assert.ok(torrent.detail.indexOf('2.1 GB') === -1);
  const direct = plain(ctx.describeStremioStream({ title: 'Película 4K', url: 'https://cdn/x.mp4', behaviorHints: { notWebReady: true, proxyHeaders: { request: { Referer: 'https://r' } } } }, 'Otro'));
  assert.equal(direct.kind, 'direct');
  assert.equal(direct.quality, '4K');
  assert.equal(direct.notWebReady, true);
  assert.deepEqual(direct.headers, { Referer: 'https://r' });
  assert.equal(ctx.stremioSourcePlayable(torrent), true);
  assert.equal(ctx.stremioSourcePlayable(direct), true);
  assert.equal(ctx.stremioSourcePlayable(plain(ctx.describeStremioStream({ ytId: 'abc' }, 'Y'))), false);
  assert.equal(ctx.stremioSourcePlayable(plain(ctx.describeStremioStream({ externalUrl: 'https://x' }, 'Y'))), false);
});

test('torrents are not offered where the app cannot play them', () => {
  const ctx = load({ caps: ['addons'] });
  const torrent = ctx.describeStremioStream({ infoHash: 'abcdef0123456789abcdef0123456789abcdef01' }, 'A');
  assert.equal(ctx.stremioSourcePlayable(torrent), false);
});

test('modes: only automatic and manual; TVs and phones are always automatic', () => {
  const saved = { opentv_vod_sources_v1: JSON.stringify({ mode: 'external', addons: [{ url: 'https://a/manifest.json', resources: [] }] }) };
  assert.equal(load({ storage: saved }).getVodSourcesConfig().mode, 'external');
  assert.equal(load({ storage: saved, caps: [], tv: true }).getVodSourcesConfig().mode, 'auto');
  /* The old "server" and fallback modes are the automatic one now. */
  assert.equal(load({ storage: { opentv_vod_sources_v1: JSON.stringify({ mode: 'portal', addons: [] }) } }).getVodSourcesConfig().mode, 'auto');
  /* Manual with no addon left is automatic, and the removed sample addon is dropped
     (with the preinstalled addons already handed out once). */
  const cfg = load({ storage: { opentv_vod_defaults_v1: '1', opentv_vod_sources_v1: JSON.stringify({ mode: 'external', addons: [{ url: 'builtin://open-cinema' }] }) } }).getVodSourcesConfig();
  assert.equal(cfg.mode, 'auto');
  assert.equal(cfg.addons.length, 0);
  const ids = plain(load().VOD_SOURCE_MODES.map((m) => m.id));
  assert.deepEqual(ids, ['auto', 'external']);
});

test('PC starts with Stremio\'s own addons, once; the viewer can remove them', () => {
  const ctx = load();
  const names = plain(ctx.getVodSourcesConfig().addons.map((a) => a.name));
  assert.deepEqual(names, ['Cinemeta', 'OpenSubtitles v3']);
  assert.equal(ctx.getVodSourcesConfig().mode, 'auto');   /* installed, not switched on */
  /* Removed by the viewer: not added again. */
  const cfg = ctx.getVodSourcesConfig();
  cfg.addons = cfg.addons.filter((a) => a.name !== 'OpenSubtitles v3');
  ctx.saveVodSourcesConfig(cfg);
  assert.equal(ctx.getVodSourcesConfig().addons.length, 1);
  /* An addon the viewer already had is not duplicated. */
  const had = load({ storage: { opentv_vod_sources_v1: JSON.stringify({ mode: 'auto', addons: [{ name: 'Mío', url: 'https://v3-cinemeta.strem.io/manifest.json' }] }) } });
  assert.equal(had.getVodSourcesConfig().addons.length, 2);
  /* The WatchHub of an earlier build is dropped. */
  const old = load({ storage: { opentv_vod_defaults_v1: '1', opentv_vod_sources_v1: JSON.stringify({ mode: 'auto', addons: [{ id: 'default_watchhub', name: 'WatchHub', url: 'https://watchhub.strem.io/manifest.json' }] }) } });
  assert.equal(old.getVodSourcesConfig().addons.length, 0);
  /* TVs and phones: nothing. */
  assert.equal(load({ caps: [], tv: true }).getVodSourcesConfig().addons.length, 0);
});

test('the chosen source is remembered per movie and per episode', () => {
  const ctx = load();
  const movie = { id: 'stremio:tt1', _stremioId: 'tt1', type: 'movie' };
  const show = { id: 'stremio:tt2', _stremioId: 'tt2', type: 'teleplay' };
  ctx.rememberStremioPick(movie, null, { addon: 'A', url: 'https://x/a.mp4', quality: '1080p' });
  ctx.rememberStremioPick(show, { id: 'tt2:1:3' }, { addon: 'A', infoHash: 'f'.repeat(40), quality: '720p' });
  assert.equal(ctx.savedStremioPick(movie, null).quality, '1080p');
  assert.equal(ctx.savedStremioPick(show, { id: 'tt2:1:3' }).quality, '720p');
  assert.equal(ctx.savedStremioPick(show, { id: 'tt2:1:4' }), null);
  ctx.forgetStremioPick(movie, null);
  assert.equal(ctx.savedStremioPick(movie, null), null);
});
