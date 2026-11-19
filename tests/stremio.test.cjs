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
  return loadModules(['core/utils.js', 'core/platform.js', 'services/vod-api.js', 'player/settings-dialog.js', 'player/source-rank.js', 'player/stremio-sources.js'], {
    localStorage: storage(opts.storage),
    window: { OPENTV_DESKTOP: true, location: { search: '', hash: '', href: 'opentv://app/index.html' }, OPENTV_PLATFORM: { name: opts.platform || 'electron', tv: !!opts.tv, has: (c) => (opts.caps || ['addons', 'torrents']).indexOf(c) !== -1 } },
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
  assert.equal(movie.category, 'destacado,pelicula');   /* Animation alone: neither Anime nor Kids */
  assert.deepEqual(movie._rows, ['Popular · Películas']);
  const show = plain(ctx.stremioMetaToVodRecord({ id: 'tt2', type: 'series', name: 'Dos', genres: ['Family'] }, 'https://a', ''));
  assert.equal(show.category, 'destacado,serie,infantil');
  assert.equal(show.type, 'teleplay');
});

test('anime lists (Kitsu) only fill Anime, with Spanish row names; "Anime" genre goes there otherwise', () => {
  const ctx = load();
  const info = plain(ctx.stremioAddonInfo({ id: 'kitsu', name: 'Anime Kitsu', types: ['anime', 'movie', 'series'], idPrefixes: ['kitsu'],
    resources: ['catalog', 'meta'], catalogs: [
      { type: 'anime', id: 'kitsu-anime-trending', name: 'Kitsu Trending' },
      { type: 'anime', id: 'kitsu-anime-list', name: 'Kitsu', extra: [{ name: 'search', isRequired: true }] }] }, 'https://kitsu.example/manifest.json'));
  assert.deepEqual(info.catalogs.map((c) => [c.type, c.id, c.home, c.search]),
    [['anime', 'kitsu-anime-trending', true, false], ['anime', 'kitsu-anime-list', false, true]]);
  assert.equal(ctx.hasAnimeCatalog([info]), true);
  assert.equal(ctx.stremioRowName({ name: 'Anime Kitsu' }, info.catalogs[0], {}), 'Tendencias del anime');
  const aot = plain(ctx.stremioMetaToVodRecord({ id: 'kitsu:7442', type: 'series', name: 'Attack on Titan' }, 'https://kitsu.example', 'Tendencias del anime', true));
  assert.equal(aot.category, 'anime');
  assert.equal(aot._animeCat, true);
  assert.equal(aot._stremioType, 'series');
  const tagged = plain(ctx.stremioMetaToVodRecord({ id: 'tt9', type: 'series', name: 'Naruto', genres: ['Anime', 'Action'] }, 'https://a', ''));
  assert.equal(tagged.category, 'destacado,serie,anime');
});

test('search results: best match first, and the same title from two addons once (the anime one)', () => {
  const ctx = load();
  const rec = (id, name, type, year, anime) => ctx.stremioMetaToVodRecord({ id, type, name, releaseInfo: year }, 'https://a', '', anime);
  const list = [
    rec('tt1', 'Boruto: Naruto Next Generations', 'series', '2017'),
    rec('tt2', 'Naruto Shippuden', 'series', '2007'),
    rec('tt3', 'The Last: Naruto the Movie', 'movie', '2014'),
    rec('tt4', 'Naruto', 'series', '2002'),
    rec('kitsu:11', 'Naruto', 'series', '2002', true)
  ];
  const out = plain(ctx.rankSearchResults('naruto', list).map((x) => x.id));
  assert.deepEqual(out, ['stremio:kitsu:11', 'stremio:tt2', 'stremio:tt1', 'stremio:tt3']);
  /* Accents and punctuation do not matter. */
  const es = plain(ctx.rankSearchResults('el senor de los anillos', [rec('tt5', 'Anillos', 'movie', '2000'), rec('tt6', 'El Señor de los Anillos: La comunidad del anillo', 'movie', '2001')]).map((x) => x.id));
  assert.deepEqual(es, ['stremio:tt6', 'stremio:tt5']);
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

test('addons are the only mode, on every platform; old configs keep their addons', () => {
  const saved = { opentv_vod_sources_v1: JSON.stringify({ mode: 'auto', addons: [{ url: 'https://a/manifest.json', resources: [] }] }) };
  /* An old "automatic" or "portal" config: its addons stay, the mode is addons. */
  assert.equal(load({ storage: saved }).getVodSourcesConfig().mode, 'external');
  assert.equal(load({ storage: saved }).stremioModeOn(), true);
  assert.equal(load({ storage: { opentv_vod_sources_v1: JSON.stringify({ mode: 'portal', addons: [] }) } }).getVodSourcesConfig().mode, 'external');
  /* TVs and phones too. */
  assert.equal(load({ caps: ['addons'], tv: true }).getVodSourcesConfig().addons.length, 3);
  /* The removed sample addon is dropped (preinstalled ones already handed out). */
  const cfg = load({ storage: { opentv_vod_defaults_v1: '1', opentv_vod_anime_v1: '1', opentv_vod_sources_v1: JSON.stringify({ mode: 'external', addons: [{ url: 'builtin://open-cinema' }] }) } }).getVodSourcesConfig();
  /* (Only the app's own three remain.) */
  assert.equal(cfg.addons.length, 3);
});

test('without an addon that gives sources, titles are information only', () => {
  const withMeta = { opentv_vod_defaults_v1: '1', opentv_vod_sources_v1: JSON.stringify({ addons: [
    { url: 'https://cinemeta/manifest.json', resources: [{ name: 'catalog' }, { name: 'meta' }] }] }) };
  assert.equal(load({ storage: withMeta }).hasSourceAddons(), false);
  const withStream = { opentv_vod_defaults_v1: '1', opentv_vod_sources_v1: JSON.stringify({ addons: [
    { url: 'https://src/manifest.json', resources: [{ name: 'stream', types: ['movie'] }] }] }) };
  assert.equal(load({ storage: withStream }).hasSourceAddons(), true);
});

test('the app\'s own three addons are always there and cannot be removed', () => {
  const ctx = load();
  const names = plain(ctx.getVodSourcesConfig().addons.map((a) => a.name));
  assert.deepEqual(names, ['Cinemeta', 'Anime Kitsu', 'OpenSubtitles v3']);
  const cfg = ctx.getVodSourcesConfig();
  assert.equal(cfg.addons.every((a) => ctx.isBuiltinVodAddon(a)), true);
  assert.equal(ctx.isBuiltinVodAddon({ url: 'https://torrentio.strem.fun/manifest.json' }), false);
  /* Removed (an older build allowed it): back again. */
  cfg.addons = cfg.addons.filter((a) => a.name !== 'OpenSubtitles v3' && a.name !== 'Anime Kitsu');
  ctx.saveVodSourcesConfig(cfg);
  assert.deepEqual(plain(ctx.getVodSourcesConfig().addons.map((a) => a.name)), ['Cinemeta', 'Anime Kitsu', 'OpenSubtitles v3']);
  /* An addon the viewer already had is not duplicated. */
  const had = load({ storage: { opentv_vod_sources_v1: JSON.stringify({ mode: 'auto', addons: [{ name: 'Mío', url: 'https://v3-cinemeta.strem.io/manifest.json' }] }) } });
  assert.equal(had.getVodSourcesConfig().addons.length, 3);
  /* An install from before the anime catalog gets it after Cinemeta. */
  const older = load({ storage: { opentv_vod_defaults_v1: '1', opentv_vod_sources_v1: JSON.stringify({ addons: [
    { name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' }, { name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json' }] }) } });
  assert.deepEqual(plain(older.getVodSourcesConfig().addons.map((a) => a.name)), ['Cinemeta', 'Anime Kitsu', 'Torrentio', 'OpenSubtitles v3']);
  /* The WatchHub of an earlier build is dropped (the three come instead). */
  const old = load({ storage: { opentv_vod_defaults_v1: '1', opentv_vod_anime_v1: '1', opentv_vod_sources_v1: JSON.stringify({ mode: 'auto', addons: [{ id: 'default_watchhub', name: 'WatchHub', url: 'https://watchhub.strem.io/manifest.json' }] }) } });
  assert.deepEqual(plain(old.getVodSourcesConfig().addons.map((a) => a.name)), ['Cinemeta', 'Anime Kitsu', 'OpenSubtitles v3']);
  /* TVs and phones get them too. */
  assert.equal(load({ caps: ['addons'], tv: true }).getVodSourcesConfig().addons.length, 3);
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

/* ------------------------------------------------ languages, preferences, best source */
const src = (ctx, title, extra) => plain(ctx.describeStremioStream(Object.assign({ name: 'Torrentio', title, infoHash: 'f'.repeat(40) }, extra || {}), 'Torrentio'));
const rankCtx = (ctx, prefs, mbps) => ({ prefs: Object.assign(ctx.defaultSourcePrefs(), prefs || {}), mbps: mbps || 0, duration: 6600, episode: false });

test('languages: latino, castellano and plain Spanish are told apart; subtitles are not audio', () => {
  const ctx = load();
  assert.deepEqual(src(ctx, 'Peli.2024.1080p.mkv\n👤 10 💾 2 GB ⚙️ X\n🇲🇽').langs, ['latino']);
  assert.deepEqual(src(ctx, 'Peli.2024.1080p.mkv\n👤 10 💾 2 GB ⚙️ X\n🇪🇸').langs, ['castellano']);
  assert.deepEqual(src(ctx, 'Peli 2024 [Español Latino] 720p').langs, ['latino']);
  assert.deepEqual(src(ctx, 'Peli 2024 Castellano BDRip').langs, ['castellano']);
  assert.deepEqual(src(ctx, 'Peli 2024 Spanish 1080p').langs, ['es']);
  /* "Dual" keeps the original track. */
  assert.deepEqual(src(ctx, 'Peli.2024.1080p.Dual.Lat.mkv').langs.slice().sort(), ['en', 'latino']);
  const vose = src(ctx, 'Peli 2024 VOSE 1080p');
  assert.deepEqual(vose.langs, []);
  assert.equal(vose.subsEs, true);
  assert.equal(vose.original, true);
  const plainEn = src(ctx, 'Movie.2024.1080p.WEB-DL.x264.mkv\n👤 50 💾 2 GB ⚙️ ThePirateBay');
  assert.equal(plainEn.original, true);
  assert.equal(plainEn.provider, 'ThePirateBay');
  assert.equal(ctx.sourceHasLang(plainEn, 'en'), true);      /* no flag = original (English) */
  assert.equal(ctx.sourceHasLang(plainEn, 'latino'), false);
  /* A word of the title is not a language: "Cast Away" is not castellano. */
  assert.deepEqual(src(ctx, 'Cast.Away.2000.1080p.mkv').langs, []);
});

test('CAM, HEVC and HDR are recognised', () => {
  const ctx = load();
  assert.equal(src(ctx, 'Peli.2025.HDCAM.x264.mkv').cam, true);
  assert.equal(src(ctx, 'Peli.2025.TS.XviD.avi').cam, true);
  assert.equal(src(ctx, 'Peli.2025.1080p.WEB-DL.mkv').cam, false);
  assert.equal(src(ctx, 'Peli.2025.1080p.WEB-DL.ts').cam, false);   /* .ts is a file type */
  const heavy = src(ctx, 'Peli.2025.2160p.HDR.DV.x265.10bit.mkv');
  assert.equal(heavy.hevc && heavy.hdr && heavy.tenBit, true);
});

test('the best source: the viewer language first, then Full HD, then healthy torrents', () => {
  const ctx = load();
  const en1080 = src(ctx, 'Movie.2024.1080p.WEB-DL.x264.mkv\n👤 400 💾 2.4 GB ⚙️ A');
  const lat720 = src(ctx, 'Peli.2024.720p.mkv\n👤 30 💾 1.1 GB ⚙️ B\n🇲🇽');
  const lat1080 = src(ctx, 'Peli.2024.1080p.mkv\n👤 25 💾 2.2 GB ⚙️ B\n🇲🇽');
  const cas1080 = src(ctx, 'Peli.2024.1080p.mkv\n👤 300 💾 2.2 GB ⚙️ C\n🇪🇸');
  const all = [en1080, lat720, lat1080, cas1080];
  assert.equal(lat720.quality, '720p');
  assert.equal(ctx.bestSource(all, rankCtx(ctx, { langs: ['latino', 'castellano'] })), lat1080);
  assert.equal(ctx.bestSource(all, rankCtx(ctx, { langs: ['castellano', 'latino'] })), cas1080);
  assert.equal(ctx.bestSource(all, rankCtx(ctx, { langs: ['en'] })), en1080);
  /* A slow connection (3 Mbps) prefers the lighter HD file. */
  assert.equal(ctx.bestSource([lat720, lat1080], rankCtx(ctx, { langs: ['latino'] }, 3)), lat720);
  assert.equal(ctx.sourceReason(lat1080), 'Latino · Full HD · 25 semillas · 2,2 GB');
});

test('a CAM is only chosen when there is nothing else (new releases)', () => {
  const ctx = load();
  const cam = src(ctx, 'Peli.2025.HDCAM.mkv\n👤 900 💾 1.4 GB ⚙️ A\n🇲🇽');
  const web = src(ctx, 'Movie.2025.720p.WEB.mkv\n👤 4 💾 1.0 GB ⚙️ B');
  const c = rankCtx(ctx, { langs: ['latino'] });
  assert.equal(ctx.bestSource([cam, web], c), web);
  assert.equal(ctx.bestSource([cam], c), cam);
});

test('preferences hide sources like the Torrentio configure page', () => {
  const ctx = load();
  const p = Object.assign(ctx.defaultSourcePrefs(), { exclude: ['CAM', '4K'], minSeeds: 5, maxMovieGB: 4, hiddenProviders: ['Malo'] });
  assert.equal(ctx.sourcePrefsBlock(src(ctx, 'P.HDCAM.mkv\n👤 50 💾 1 GB ⚙️ A'), p, false), 'calidad');
  assert.equal(ctx.sourcePrefsBlock(src(ctx, 'P.1080p.mkv\n👤 2 💾 1 GB ⚙️ A'), p, false), 'semillas');
  assert.equal(ctx.sourcePrefsBlock(src(ctx, 'P.1080p.mkv\n👤 20 💾 9 GB ⚙️ A'), p, false), 'tamaño');
  assert.equal(ctx.sourcePrefsBlock(src(ctx, 'P.1080p.mkv\n👤 20 💾 1 GB ⚙️ Malo'), p, false), 'sitio');
  assert.equal(ctx.sourcePrefsBlock(src(ctx, 'P.1080p.mkv\n👤 20 💾 1 GB ⚙️ Bueno'), p, false), '');
  /* Everything hidden: the best of all is still offered. */
  const only = src(ctx, 'P.HDCAM.mkv\n👤 50 💾 1 GB ⚙️ A');
  assert.equal(ctx.bestSource([only], { prefs: p, mbps: 0, duration: 0, episode: false }), only);
  ctx.saveSourcePrefs(p);
  assert.deepEqual(plain(ctx.loadSourcePrefs().exclude), ['CAM', '4K']);
});

test('the connection speed only rises from real downloads and sets the target quality', () => {
  const ctx = load();
  ctx.noteNetSpeed(1250000);    /* 10 Mbps */
  ctx.noteNetSpeed(250000);     /* a slow torrent does not lower it */
  assert.equal(ctx.knownNetSpeed(), 10);
  assert.equal(ctx.sourceTargetQuality(ctx.defaultSourcePrefs(), 0), '1080p');
  assert.equal(ctx.sourceTargetQuality(ctx.defaultSourcePrefs(), 5), '720p');
  assert.equal(ctx.sourceTargetQuality(ctx.defaultSourcePrefs(), 2), 'SD');
});

test('audio tracks show their real dub: the track title, else what the source says', () => {
  const ctx = load();
  const list = plain(ctx.stremioAudioList([
    { lang: 'spa', title: 'Latino' }, { lang: 'spa', title: 'Castellano' }, { lang: 'eng', title: '' }, { lang: 'eng', title: 'Commentary' }
  ], null));
  assert.deepEqual(list.map((t) => t.label), ['Español (Latino)', 'Español (Castellano)', 'Inglés', 'Inglés · Comentarios']);
  /* One Spanish track without a title in a source tagged Latino. */
  assert.equal(ctx.audioTrackLabel({ lang: 'spa', title: '' }, { langs: ['latino'] }), 'Español (Latino)');
  assert.equal(ctx.audioTrackLabel({ lang: 'spa', title: '' }, { langs: ['latino', 'castellano'] }), 'Español');
  /* Two tracks with the same name are told apart. */
  const same = plain(ctx.stremioAudioList([{ lang: 'eng', channels: '5.1' }, { lang: 'eng', channels: 'stereo' }], null));
  assert.deepEqual(same.map((t) => t.label), ['Inglés · 5.1', 'Inglés · stereo']);
});

test('on a device that cannot decode DTS or HEVC, or has no room, those sources lose', () => {
  const ctx = load();
  const dts = src(ctx, 'Peli.2024.1080p.BluRay.DTS-HD.MA.5.1.x264.mkv\n👤 300 💾 9 GB ⚙️ A\n🇲🇽');
  const hevc = src(ctx, 'Peli.2024.1080p.WEB.x265.HEVC.mkv\n👤 200 💾 1.8 GB ⚙️ B\n🇲🇽');
  const aac = src(ctx, 'Peli.2024.1080p.WEB-DL.AAC.x264.mkv\n👤 20 💾 2.1 GB ⚙️ C\n🇲🇽');
  assert.equal(dts.audioDts, true);
  const c = rankCtx(ctx, { langs: ['latino'] });
  /* PC (no device profile): the relay converts any audio, nothing is ruled out. */
  assert.equal(ctx.sourceDevicePenalty(dts, true), 0);
  /* A Fire TV without DTS or HEVC decoders and 5 GB free. */
  ctx.setDeviceProfile({ dts: false, truehd: false, hevc: false, uhd: false }, { free: 5 * 1073741824, total: 8 * 1073741824 });
  assert.equal(ctx.bestSource([dts, hevc, aac], c), aac);
  assert.equal(ctx.sourceDeviceNote(dts), 'Audio no compatible con este aparato');
  assert.equal(ctx.sourceDeviceNote(hevc), 'Vídeo no compatible con este aparato');
  const huge = src(ctx, 'Peli.2024.1080p.x264.AAC.mkv\n👤 50 💾 7 GB ⚙️ D\n🇲🇽');
  assert.equal(ctx.sourceDeviceNote(huge), 'No cabe en este aparato');
});
