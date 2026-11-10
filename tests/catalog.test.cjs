'use strict';
/* Home rows, "Seguir viendo", search suggestions and the channel guide store. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./helpers/load-modules.cjs');

const BASE = ['core/utils.js'];
/* Arrays made inside the sandbox come from another realm. */
const plain = (v) => JSON.parse(JSON.stringify(v));
const isSeriesItem = (item) => !!item && (item.type === 'teleplay' || item.kind === 'serie');

function vod(id, title, extra) {
  return Object.assign({ id, title, category: 'destacado', row: 'Fila A', poster: 'p' + id + '.jpg', type: 'movie' }, extra || {});
}

test('rowDisplayName translates portal shelf names', () => {
  const ctx = loadModules(BASE.concat('home/rows.js'));
  assert.equal(ctx.rowDisplayName('Netflix Movie'), 'Películas de Netflix');
  assert.equal(ctx.rowDisplayName('HBO Series'), 'Series de HBO');
  assert.equal(ctx.rowDisplayName('TV Series'), 'TV Series');
  assert.equal(ctx.rowDisplayName('Se acerca Halloween'), 'Se acerca Halloween');
});

test('portalRowsFor groups a section by shelf, in order, and drops tiny shelves', () => {
  const list = [
    vod('1', 'A'), vod('2', 'B'), vod('3', 'C'), vod('4', 'D'),
    vod('5', 'E', { row: 'Netflix Movie' }), vod('6', 'F', { row: 'Netflix Movie' }),
    vod('7', 'G', { row: 'Netflix Movie' }), vod('8', 'H', { row: 'Netflix Movie' }),
    vod('9', 'I', { row: 'Solo uno' }),
    vod('10', 'J', { category: 'pelicula', row: 'Otra sección' })
  ];
  const ctx = loadModules(BASE.concat('home/rows.js'), { VOD: list, withCovers: (l) => l });
  const rows = ctx.portalRowsFor('destacado', 4);
  assert.deepEqual(plain(rows.map((r) => r.title)), ['Fila A', 'Películas de Netflix']);
  assert.equal(rows[0].items.length, 4);
});

test('continueRecords keeps unfinished titles, newest first, and honours filters', () => {
  const history = [
    { id: 'm1', title: 'Película a medias', series: false, position: 600, duration: 6000 },
    { id: 'm2', title: 'Película terminada', series: false, position: 5900, duration: 6000 },
    { id: 's1', title: 'Serie', series: true, episodeNumber: 3, position: 1500, duration: 1600 },
    { id: 'm3', title: 'Recién empezada', series: false, position: 3, duration: 6000 }, // under the 5 s minimum
    { id: 'm4', title: 'Quitada', series: false, position: 900, duration: 6000, hideContinue: true }
  ];
  const ctx = loadModules(BASE.concat('home/rows.js'), { localProfile: { history } });
  assert.deepEqual(plain(ctx.continueRecords('').map((r) => r.id)), ['m1', 's1']);
  assert.deepEqual(plain(ctx.continueRecords('movie').map((r) => r.id)), ['m1']);
  assert.deepEqual(plain(ctx.continueRecords('series').map((r) => r.id)), ['s1']);
  assert.equal(ctx.continueSubtitle(history[0]), 'Quedan 1 h 30 min');
  assert.equal(ctx.continueSubtitle(history[2]), 'Episodio 3 · Quedan 2 min');
});

test('compact density changes the row sizes', () => {
  const ctx = loadModules(BASE.concat('home/rows.js'));
  const normal = ctx.ROW_POSTER_W;
  ctx.catalogStaleAt = 0;
  ctx.setCatalogDensity(true);
  assert.ok(ctx.ROW_POSTER_W < normal);
  assert.ok(ctx.catalogStaleAt > 0, 'pages are marked for rebuild');
  ctx.setCatalogDensity(false);
  assert.equal(ctx.ROW_POSTER_W, normal);
});

test('localSuggestions ranks title starts first and skips duplicates', () => {
  const list = [
    vod('1', 'La casa de papel', { type: 'teleplay', kind: 'serie' }),
    vod('2', 'Casa de mi padre'),
    vod('3', 'Mi casa'),
    vod('4', 'Casa de mi padre'),
    vod('5', 'Otra cosa')
  ];
  const ctx = loadModules(BASE.concat('screens/search-suggest.js'), { VOD: list, isSeriesItem, localProfile: { history: [] } });
  const titles = plain(ctx.localSuggestions('casa').map((i) => i.title));
  assert.deepEqual(titles, ['Casa de mi padre', 'La casa de papel', 'Mi casa']);
  assert.deepEqual(plain(ctx.localSuggestions('c')), [], 'one letter is not enough');
});

test('recent searches: newest first, no duplicates, max 8', () => {
  const ctx = loadModules(BASE.concat('screens/search-suggest.js'), { isSeriesItem });
  for (let i = 1; i <= 10; i++) ctx.rememberRecentSearch('busqueda ' + i);
  ctx.rememberRecentSearch('BUSQUEDA 3');
  const list = ctx.recentSearches();
  assert.equal(list.length, 8);
  assert.equal(list[0], 'BUSQUEDA 3');
  assert.equal(list.filter((q) => q.toLowerCase() === 'busqueda 3').length, 1);
  ctx.rememberRecentSearch('x');
  assert.equal(ctx.recentSearches()[0], 'BUSQUEDA 3', 'one-letter searches are not kept');
});

test('channel guide keeps favourites and recents with what is needed to play them', () => {
  const ctx = loadModules(BASE.concat('live/guide.js', 'live/private.js'), {
    currentLiveCategory: { id: 76182, name: 'Todos' },
    liveChannelKey: (ch) => (ch ? (ch.channelCode || ch.streamUrl || '') : '')
  });
  const a = { channelCode: 'a', name: 'Canal A', logo: 'a.png', liveAddressList: [1, 2] };
  const b = { channelCode: 'b', name: 'Canal B' };
  ctx.rememberLiveChannel(a);
  ctx.rememberLiveChannel(b);
  ctx.rememberLiveChannel(a);
  let saved = ctx.liveSaved();
  assert.deepEqual(plain(saved.recent.map((c) => c.channelCode)), ['a', 'b']);
  assert.equal(saved.recent[0].liveAddressList, undefined, 'only the small copy is stored');
  ctx.syncSavedFavorite(b, true);
  assert.deepEqual(plain(ctx.liveSaved().favs.map((c) => c.name)), ['Canal B']);
  ctx.syncSavedFavorite(b, false);
  saved = ctx.liveSaved();
  assert.equal(saved.favs.length, 0);
});

test('adult categories are taken out of the lists and nothing private is remembered', () => {
  const ctx = loadModules(BASE.concat('live/guide.js', 'live/private.js'), {
    currentLiveCategory: { id: 76182, name: 'Todos' },
    liveChannelKey: (ch) => (ch ? (ch.channelCode || '') : '')
  });
  const cats = [{ id: 76182, name: 'Todos' }, { id: 76206, name: 'Deportes' }, { id: 76208, name: '18+' }, { id: 1, name: 'Adultos +18' }];
  assert.deepEqual(plain(ctx.splitPrivateCategories(cats).map((c) => c.name)), ['Todos', 'Deportes']);
  assert.deepEqual(plain(ctx.privateCategories.map((c) => c.id)), [76208, 1]);
  assert.equal(ctx.isAdultCategory({ id: 5, name: 'Infantil' }), false);
  assert.equal(ctx.privateEnabled(), false, 'off by default');

  ctx.currentLiveCategory = { id: 76208, name: 'Privado', isPrivate: true };
  ctx.rememberLiveChannel({ channelCode: 'x', name: 'Privado 1' });
  assert.equal(ctx.liveSaved().recent.length, 0, 'private channels never reach Recientes');
});
