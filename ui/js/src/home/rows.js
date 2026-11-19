/* home/rows.js — Filas horizontales del escritorio: "Seguir viendo" y las filas del portal en Destacados.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Rows live on the 1920x1080 page canvas like everything else (absolute
   positions), and each one scrolls sideways inside its own strip: with the
   arrow buttons, a trackpad, Shift + wheel or the keyboard focus. */
var ROW_X = 192;
var ROW_W = 1656;
var ROW_PAD = 18;                 /* room for the hover zoom inside the strip */
var ROW_TITLE_H = 54;
var ROW_POSTER_W, ROW_POSTER_H, ROW_STEP, ROW_HEIGHT;
var CONTINUE_W, CONTINUE_H, CONTINUE_STEP, CONTINUE_ROW_HEIGHT;

/* Catalogue density (Mi cuenta → Apariencia): "compact" shows smaller
   posters, so more titles fit in each row and grid line. */
var CATALOG_DENSITY_KEY = 'opentv_catalog_density_v1';
function catalogCompact() {
  return !!window.OPENTV_DESKTOP && safeLocalRead(CATALOG_DENSITY_KEY, 'normal') === 'compact';
}
function applyCatalogDensity() {
  var compact = catalogCompact();
  ROW_POSTER_W = compact ? 200 : 250;
  ROW_POSTER_H = compact ? 288 : 360;
  ROW_STEP = ROW_POSTER_W + (compact ? 22 : 26);
  ROW_HEIGHT = ROW_TITLE_H + ROW_POSTER_H + ROW_PAD * 2 + 26;
  CONTINUE_W = compact ? 336 : 400;
  CONTINUE_H = compact ? 189 : 225;
  CONTINUE_STEP = CONTINUE_W + 24;
  CONTINUE_ROW_HEIGHT = ROW_TITLE_H + CONTINUE_H + 64 + ROW_PAD * 2 + 20;
  /* TVs: a fixed size, a bit bigger than on a PC so posters read well from
     the sofa (five and a half on screen, four "Seguir viendo" cards) and a
     margin on the right; fewer images to load and draw. */
  if (platformIsTv()) {
    ROW_W = 1560;   /* 240..1800 on screen: 120 px of margin on the right */
    ROW_POSTER_W = 262;
    ROW_POSTER_H = 378;
    ROW_STEP = 288;
    ROW_HEIGHT = ROW_TITLE_H + ROW_POSTER_H + ROW_PAD * 2 + 26;
    CONTINUE_W = 372;
    CONTINUE_H = 209;
    CONTINUE_STEP = 396;
    CONTINUE_ROW_HEIGHT = ROW_TITLE_H + CONTINUE_H + 64 + ROW_PAD * 2 + 20;
  }
  if (document.body) { document.body.classList.toggle('is-catalog-compact', compact); }
}
applyCatalogDensity();

function setCatalogDensity(compact) {
  safeLocalWrite(CATALOG_DENSITY_KEY, compact ? 'compact' : 'normal');
  applyCatalogDensity();
  /* Every catalogue page is rebuilt with the new size next time it shows. */
  catalogStaleAt = Date.now() + 1;
}

function makeRowShell(page, y, height, titleText, extraClass) {
  var host = el('div', 'd-row' + (extraClass ? ' ' + extraClass : ''));
  abs(host, ROW_X, y, ROW_W, height);
  var head = el('div', 'd-row-head');
  head.appendChild(el('div', 'd-row-title', titleText));
  host.appendChild(head);
  var strip = el('div', 'd-row-strip scrollable');
  abs(strip, -ROW_PAD, ROW_TITLE_H - ROW_PAD, ROW_W + ROW_PAD * 2, height - ROW_TITLE_H + ROW_PAD);
  host.appendChild(strip);

  var prev = el('button', 'd-row-arrow is-prev');
  prev.type = 'button';
  prev.innerHTML = UI_ICONS.prev;
  prev.setAttribute('aria-label', 'Anterior');
  var next = el('button', 'd-row-arrow is-next');
  next.type = 'button';
  next.innerHTML = UI_ICONS.next;
  next.setAttribute('aria-label', 'Siguiente');
  function step(dir) {
    var by = Math.max(ROW_STEP, Math.floor(strip.clientWidth * 0.8 / ROW_STEP) * ROW_STEP);
    try { strip.scrollBy({ left: dir * by, behavior: 'smooth' }); }
    catch (eScroll) { strip.scrollLeft += dir * by; }
  }
  prev.addEventListener('click', function (event) { event.stopPropagation(); step(-1); });
  next.addEventListener('click', function (event) { event.stopPropagation(); step(1); });
  host.appendChild(prev);
  host.appendChild(next);
  /* TVs have no pointer arrows: while a row glides only the posters coming
     into view are loaded (measuring the row and toggling classes on every
     frame of the smooth scroll was the main cost on the Fire TV). */
  var tvRows = platformIsTv();
  function syncArrows() {
    if (tvRows) { schedulePosterMemoryPass(); return; }
    var max = strip.scrollWidth - strip.clientWidth;
    host.classList.toggle('at-start', strip.scrollLeft <= 4);
    host.classList.toggle('at-end', strip.scrollLeft >= max - 4);
    schedulePosterMemoryPass();
  }
  strip.addEventListener('scroll', syncArrows, { passive: true });
  /* Measured while the page was hidden the row looked empty, so the arrows
     stayed off until a first scroll: measure again when the pointer comes. */
  host.addEventListener('mouseenter', syncArrows);
  /* A vertical wheel keeps scrolling the page; a sideways swipe or
     Shift + wheel moves the row. */
  strip.addEventListener('wheel', function (event) {
    var dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!dx) { return; }
    event.preventDefault();
    event.stopPropagation();
    strip.scrollLeft += dx;
  }, { passive: false });
  host._strip = strip;
  host._sync = syncArrows;
  page.appendChild(host);
  setTimeout(syncArrows, 0);
  return host;
}

/* "Netflix Movie" -> "Películas de Netflix"; other portal names stay. */
function rowDisplayName(name) {
  /* Stremio rows already read well ("Popular · Series"). */
  if (/ · /.test(name)) { return name; }
  var m = /^(.+?)\s+Movies?$/i.exec(name);
  if (m) { return 'Películas de ' + m[1]; }
  m = /^(.+?)\s+Series$/i.exec(name);
  if (m && !/^tv$/i.test(m[1])) { return 'Series de ' + m[1]; }
  return name;
}

/* Titles of one home section grouped by the portal row they came in, in
   the portal's own order. Rows with too few titles are folded away. */
function portalRowsFor(category, minItems) {
  var order = [], groups = {};
  var list = withCovers(VOD);
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var cats = norm(item.category || '').split(',');
    if (cats.indexOf(category) === -1) { continue; }
    var shelves = item._rows && item._rows.length ? item._rows : (item.row ? [item.row] : []);
    for (var s = 0; s < shelves.length; s++) {
      if (!groups[shelves[s]]) { groups[shelves[s]] = []; order.push(shelves[s]); }
      groups[shelves[s]].push(item);
    }
  }
  /* Addon rows keep the addon's order (stremioRowOrder); others stay where
     they first appeared. */
  var known = typeof stremioRowOrder === 'object' ? stremioRowOrder : {};
  var firstAt = {};
  for (var f = 0; f < order.length; f++) { firstAt[order[f]] = f; }
  order.sort(function (a, b) {
    var ka = a in known ? known[a] : 100000 + firstAt[a];
    var kb = b in known ? known[b] : 100000 + firstAt[b];
    return ka - kb;
  });
  var out = [];
  for (var r = 0; r < order.length; r++) {
    if (groups[order[r]].length >= (minItems || 4)) {
      out.push({ title: rowDisplayName(order[r]), items: groups[order[r]] });
    }
  }
  return out;
}

function appendPosterRow(page, y, titleText, items) {
  return appendPosterRowSized(page, y, titleText, items, ROW_POSTER_W, ROW_POSTER_H, 'is-posters');
}

function appendPosterRowSized(page, y, titleText, items, w, h, extraClass) {
  var step = w + (w < 200 ? 20 : 26);
  var height = ROW_TITLE_H + h + ROW_PAD * 2 + 26;
  var host = makeRowShell(page, y, height, titleText, extraClass);
  for (var i = 0; i < items.length; i++) {
    host._strip.appendChild(makePoster(items[i], ROW_PAD + i * step, ROW_PAD, w, h, { gold: true }));
  }
  var tail = el('div', 'd-row-tail');
  abs(tail, ROW_PAD + items.length * step, 0, ROW_PAD, 1);
  host._strip.appendChild(tail);
  return y + height;
}

/* ------------------------------------------------------- TV: light hero */
/* TVs: the desktop hero's look (big picture fading into the page, title,
   details, synopsis, Reproducir / Más información / Mi lista) built so a
   Fire TV can carry it. What made the desktop hero (home/hero.js) heavy is
   left out:
   - the picture is an element inside the page, not a full-screen layer
     behind the rows (that layer gave every row its own layer too)
   - one picture at the size it is shown (the app's image sizer), no slow
     zoom, no cross-fade: the next picture is decoded first and swapped in
     one go; no blurred buttons
   - it turns by itself only while the remote has been still for a while,
     the section is on screen and scrolled to the top, and never while the
     focus is on its buttons (the viewer may be reading it).
   The buttons sit in a .hero-info block, which TV navigation already moves
   through like a row (core/focus.js): left from Reproducir goes to the menu,
   down to the first row. */
var TVH_ART_H = 660;             /* page height of the picture */
var TVH_ART_W = 1500;            /* its width, from the right edge */
var TVH_ROWS_Y = 650;            /* where the rows start (over the fade) */
var TVH_MAX = 8;
var TVH_ROTATE_MS = 9000;
var TVH_IDLE_MS = 6000;          /* remote untouched this long before turning */
var tvHeroes = [];
var tvHeroTimer = null;
var tvHeroKeyAt = 0;
var tvHeroKeysWatched = false;

function tvHeroArt(item) { return item._trendArt || heroArt(item) || ''; }
/* A title's wide picture, or its poster when it has none (details screen). */
function tvCardArt(item) { return tvHeroArt(item) || item.poster || ''; }

function tvHeroImageUrl(item) { return sizedImageUrl(tvHeroArt(item), TVH_ART_W); }

/* Writes the texts, the Mi lista state and the dashes for the title shown. */
function renderTvHeroText(hero) {
  var item = hero._items[hero._index];
  hero._item = item;
  hero._kicker.textContent = isSeriesItem(item) ? 'Serie' : 'Película';
  var len = String(item.title || '').length;
  hero._title.className = 'hero-title' + (len > 52 ? ' is-xlong' : len > 30 ? ' is-long' : '');
  hero._title.textContent = item.title || '';
  hero._meta.textContent = itemMetaLine(item) || '';
  var syn = String(item.synopsis || '');
  hero._syn.textContent = syn && !/^sin sinopsis/i.test(syn) ? syn : itemGenres(item, 3).join('  •  ');
  var on = inMyList(item);
  hero._fav.classList.toggle('is-on', on);
  hero._fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
  var dots = hero._dots.children;
  for (var d = 0; d < dots.length; d++) { dots[d].className = 'hero-dot' + (d === hero._index ? ' is-active' : ''); }
}

/* Shows title number `index`: the picture is loaded and decoded before
   the swap (a Fire TV showed an empty frame otherwise), then text and
   picture change together. The next one is fetched in the background so
   the following turn is ready. */
function showTvHero(hero, index) {
  var n = hero._items.length;
  index = (index % n + n) % n;
  var item = hero._items[index];
  var url = tvHeroImageUrl(item);
  var seq = ++hero._seq;
  var pre = new Image();
  var apply = function () {
    if (seq !== hero._seq || !hero._info.isConnected) { return; }
    hero._index = index;
    hero._img.src = url;
    renderTvHeroText(hero);
    var after = hero._items[(index + 1) % n];
    if (after !== item) { (new Image()).src = tvHeroImageUrl(after); }
  };
  pre.onload = function () { if (pre.decode) { pre.decode().then(apply, apply); } else { apply(); } };
  pre.onerror = apply;
  pre.src = url;
}

function makeTvHeroButton(cls, html, label) {
  var b = el('div', 'hero-btn focusable' + (cls ? ' ' + cls : ''));
  b.innerHTML = html + (label ? '<span>' + label + '</span>' : '');
  return b;
}

/* Lays the hero at the top of the page. Returns the y where the rows
   start, or 0 when the section has no titles with wide art. */
function appendTvHero(page, all) {
  var items = [];
  for (var i = 0; i < all.length && items.length < TVH_MAX; i++) {
    if (tvHeroArt(all[i]) && hasUsableCover(all[i])) { items.push(all[i]); }
  }
  if (!items.length) { return 0; }
  var hero = { _items: items, _index: 0, _seq: 0, _page: page };

  /* The picture, on the right, fading into the page on the left and at
     the bottom (one shade element). Not focusable: navigation skips it. */
  var art = el('div', 'tvh-art');
  art.style.top = '0px';
  var img = el('img', 'tvh-img');
  img.alt = '';
  img.decoding = 'async';
  art.appendChild(img);
  art.appendChild(el('div', 'tvh-shade'));
  page.appendChild(art);
  hero._img = img;

  /* Text and buttons, as on desktop. */
  var info = el('div', 'hero-info tvh-info');
  abs(info, ROW_X, 40, 1060, 560);
  hero._kicker = el('div', 'hero-kicker');
  hero._title = el('div', 'hero-title');
  hero._meta = el('div', 'hero-meta');
  hero._syn = el('div', 'hero-synopsis');
  info.appendChild(hero._kicker);
  info.appendChild(hero._title);
  info.appendChild(hero._meta);
  info.appendChild(hero._syn);
  var row = el('div', 'hero-buttons');
  var play = makeTvHeroButton('is-primary', UI_ICONS.play, 'Reproducir');
  play._activate = function () { playTitleNow(hero._item); };
  var more = makeTvHeroButton('', UI_ICONS.info, 'Más información');
  more._activate = function () { openDetail(hero._item); };
  var fav = makeTvHeroButton('is-round', UI_ICONS.mylist, '');
  fav._activate = function () {
    var on = toggleMyList(hero._item);
    fav.classList.toggle('is-on', on);
    fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
  };
  hero._fav = fav;
  row.appendChild(play);
  row.appendChild(more);
  row.appendChild(fav);
  info.appendChild(row);
  page.appendChild(info);
  hero._info = info;

  /* Dashes: which title is showing. */
  hero._dots = el('div', 'hero-dots tvh-dots');
  abs(hero._dots, ROW_X + ROW_W - 360, 600, 360, 20);
  for (var d = 0; d < items.length && items.length > 1; d++) { hero._dots.appendChild(el('i', 'hero-dot')); }
  page.appendChild(hero._dots);

  /* First title: picture and text at once, no waiting for a decode. */
  img.src = tvHeroImageUrl(items[0]);
  renderTvHeroText(hero);
  /* Spanish texts (home/catalog-lang.js) as they arrive. */
  items.forEach(function (it) {
    localizeItem(it, function (changed) {
      if (changed && hero._item === it && hero._info.isConnected) { renderTvHeroText(hero); }
    });
  });
  if (items.length > 1) { (new Image()).src = tvHeroImageUrl(items[1]); }

  tvHeroes.push(hero);
  if (!tvHeroKeysWatched) {
    tvHeroKeysWatched = true;
    document.addEventListener('keydown', function () { tvHeroKeyAt = Date.now(); }, true);
  }
  if (!tvHeroTimer) { tvHeroTimer = setInterval(rotateTvHeroes, TVH_ROTATE_MS); }
  return TVH_ROWS_Y;
}

function rotateTvHeroes() {
  tvHeroes = tvHeroes.filter(function (h) { return h._info.isConnected; });
  if (state.screen !== 'home' || document.hidden) { return; }
  if (Date.now() - tvHeroKeyAt < TVH_IDLE_MS) { return; }
  tvHeroes.forEach(function (hero) {
    if (hero._items.length < 2) { return; }
    if (state.focus && hero._info.contains(state.focus)) { return; }
    if (!hero._page.classList.contains('is-current') || hero._page.scrollTop > 200) { return; }
    showTvHero(hero, hero._index + 1);
  });
}

/* ------------------------------------------------------------ Seguir viendo */
/* Titles started and not finished, newest first. `filter` is 'movie',
   'series' or empty for both. Finished movies (95 %+) drop out; a series
   stays so the next episode is one click away. Only titles present in the
   currently active VOD catalogue are shown. */
function continueRecords(filter) {
  var out = [];
  var list = localProfile.history || [];
  for (var i = 0; i < list.length && out.length < 20; i++) {
    var r = list[i];
    if (!r || !r.id || r.hideContinue || (r.position || 0) < 5) { continue; }
    if (!vodForHistoryRecord(r)) { continue; }
    if (filter === 'movie' && r.series) { continue; }
    if (filter === 'series' && !r.series) { continue; }
    if (!r.series && r.duration && r.position / r.duration > 0.95) { continue; }
    out.push(r);
  }
  return out;
}

function vodById(id) {
  for (var i = 0; i < VOD.length; i++) {
    if (String(VOD[i].id) === String(id)) { return VOD[i]; }
  }
  return null;
}

function vodForHistoryRecord(r) {
  if (!r || !r.id) { return null; }
  var direct = vodById(r.id);
  if (direct) { return direct; }
  for (var v = 0; v < VOD.length; v++) {
    var seasons = VOD[v]._catalogSeasons || [];
    for (var s = 0; s < seasons.length; s++) {
      if (String(seasons[s].id) === String(r.id) || (r.seasonId && String(seasons[s].id) === String(r.seasonId))) {
        return VOD[v];
      }
    }
  }
  /* Titles found by search are not in the home catalog (VOD): keep them in
     "Seguir viendo", each with the catalog of the current mode only. */
  var fromAddon = !!r.stremio || String(r.id).indexOf('stremio:') === 0;
  /* (typeof: the unit tests load this module without services/vod-api.js.) */
  if (typeof stremioModeOn === 'function' && stremioModeOn()) { return fromAddon ? stremioItemFromHistory(r) : null; }
  return fromAddon ? null : r;
}

function continueSubtitle(r) {
  var parts = [];
  if (r.series && r.episodeNumber) { parts.push('Episodio ' + r.episodeNumber); }
  if (r.duration) {
    var left = Math.max(0, r.duration - r.position);
    if (left / r.duration < 0.05) { parts.push('Terminado'); }
    else { parts.push(left >= 3600 ? 'Quedan ' + Math.floor(left / 3600) + ' h ' + Math.round((left % 3600) / 60) + ' min'
                                   : 'Quedan ' + Math.max(1, Math.round(left / 60)) + ' min'); }
  }
  return parts.join(' · ');
}

function makeContinueCard(r, x, y) {
  var item = vodForHistoryRecord(r);
  var card = el('div', 'continue-card focusable');
  abs(card, x, y, CONTINUE_W, CONTINUE_H + 64);
  card.style.setProperty('--cc-w', CONTINUE_W + 'px');
  card.style.setProperty('--cc-h', CONTINUE_H + 'px');
  var frame = el('div', 'cc-frame');
  var art = (item && (item.landscape || item.backdrop || item.poster)) || r.poster;
  if (art) {
    var img = el('img', 'cc-img');
    img.decoding = 'async';
    img.setAttribute('data-poster-src', art);
    img.onload = posterImageLoaded;
    img.onerror = function () { img.style.display = 'none'; frame.classList.add('is-generic'); };
    frame.appendChild(img);
  } else {
    frame.classList.add('is-generic');
  }
  frame.appendChild(el('div', 'cc-shade'));
  var play = el('div', 'cc-play');
  play.innerHTML = UI_ICONS.play;
  frame.appendChild(play);
  var bar = el('div', 'cc-progress');
  var fill = el('i');
  var pct = r.duration ? Math.min(100, Math.max(2, Math.round(r.position / r.duration * 100))) : 0;
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  if (pct) { frame.appendChild(bar); }
  card.appendChild(frame);
  card.appendChild(el('div', 'cc-title', r.title || (item && item.title) || 'Contenido'));
  card.appendChild(el('div', 'cc-sub', continueSubtitle(r)));

  var remove = el('button', 'cc-remove');
  remove.type = 'button';
  remove.innerHTML = UI_ICONS.close;
  remove.setAttribute('data-tip', 'Quitar de Seguir viendo');
  remove.addEventListener('click', function (event) {
    event.stopPropagation();
    /* Forgotten entirely (position, chosen source, subtitles), not hidden. */
    forgetWatchedTitle(r.id);
  });
  frame.appendChild(remove);

  card._activate = function () { openHistoryRecord(r); };
  return card;
}

var continueRowHosts = [];

/* Adds the row when there is something to continue and returns the y where
   the next block starts. The slot is remembered so the row can be refreshed
   in place after watching something. */
function appendContinueRow(page, y, filter) {
  var records = continueRecords(filter);
  page._continueFilter = filter;
  page._continueCount = records.length;
  if (!records.length) { return y; }
  var host = makeRowShell(page, y, CONTINUE_ROW_HEIGHT, 'Seguir viendo', 'is-continue');
  host._filter = filter;
  fillContinueRow(host, records);
  continueRowHosts.push(host);
  return y + CONTINUE_ROW_HEIGHT;
}

function fillContinueRow(host, records) {
  var strip = host._strip;
  clear(strip);
  for (var i = 0; i < records.length; i++) {
    strip.appendChild(makeContinueCard(records[i], ROW_PAD + i * CONTINUE_STEP, ROW_PAD));
  }
  var tail = el('div', 'd-row-tail');
  abs(tail, ROW_PAD + records.length * CONTINUE_STEP, 0, ROW_PAD, 1);
  strip.appendChild(tail);
  if (host._sync) { setTimeout(host._sync, 0); }
  schedulePosterMemoryPass();
}

/* After the player (or a removal): update rows in place. When a row has to
   appear or disappear, the page layout changes, so that page is rebuilt the
   next time it is shown. */
function refreshContinueRows() {
  if (!window.OPENTV_DESKTOP || !pages) { return; }
  var alive = [];
  for (var h = 0; h < continueRowHosts.length; h++) {
    if (continueRowHosts[h].parentNode) { alive.push(continueRowHosts[h]); }
  }
  continueRowHosts = alive;
  var stale = false;
  for (var p = 0; p < pages.length; p++) {
    var page = pages[p];
    if (!page || page._continueFilter === undefined || !pagesBuilt[p]) { continue; }
    var records = continueRecords(page._continueFilter);
    if ((records.length > 0) !== (page._continueCount > 0)) { stale = true; continue; }
    page._continueCount = records.length;
    for (var k = 0; k < continueRowHosts.length; k++) {
      if (continueRowHosts[k].parentNode === page && records.length) { fillContinueRow(continueRowHosts[k], records); }
    }
  }
  if (stale) {
    catalogStaleAt = Date.now();
    var current = TABS[state.tab] ? TABS[state.tab].page : 0;
    if (current > 0 && pages[current]) {
      var keep = pages[current].scrollTop;
      ensurePageBuilt(current);
      pages[current].scrollTop = keep;
    }
  }
}

/* ------------------------------------------------------------------ Top 10 */
/* Big outlined rank number behind each poster, like the streaming apps. The
   ranking comes from the portal's own "TOP 15" shelves. */
var TOP10_STEP = 410;
function appendTop10Row(page, y, titleText, items) {
  if (!items || !items.length) { return y; }
  var height = ROW_TITLE_H + 360 + ROW_PAD * 2 + 26;
  var host = makeRowShell(page, y, height, titleText, 'is-top10');
  for (var i = 0; i < items.length; i++) {
    var cell = el('div', 'top10-cell');
    abs(cell, ROW_PAD + i * TOP10_STEP, ROW_PAD, TOP10_STEP - 20, 360);
    var num = el('div', 'top10-num', String(i + 1));
    cell.appendChild(num);
    cell.appendChild(makePoster(items[i], 140, 0, 250, 360, { gold: true }));
    host._strip.appendChild(cell);
  }
  var tail = el('div', 'd-row-tail');
  abs(tail, ROW_PAD + items.length * TOP10_STEP, 0, ROW_PAD, 1);
  host._strip.appendChild(tail);
  return y + height;
}
