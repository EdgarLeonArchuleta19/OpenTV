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
  return !!window.XUPER_DESKTOP && safeLocalRead(CATALOG_DENSITY_KEY, 'normal') === 'compact';
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
  /* TVs: a fixed size with exactly six posters (four "Seguir viendo" cards)
     on screen and a margin on the right; fewer images to load and draw. */
  if (platformIsTv()) {
    ROW_W = 1560;   /* 240..1800 on screen: 120 px of margin on the right */
    ROW_POSTER_W = 240;
    ROW_POSTER_H = 346;
    ROW_STEP = 264;
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

/* ------------------------------------------------------ TV: cards on top */
/* TVs have no big hero (its full-screen image, slow zoom and cross-fades
   cost too much on a Fire TV): two large cards that stay in place while
   what they show changes every few seconds, and four small cards under
   them. On Inicio they show this week's trends (TMDB), on the other
   sections the portal's titles. */
var TVF_GAP = 24;
var TVF_BIG_H = 372, TVF_SMALL_H = 216;
var TVF_ROTATE_MS = 8000;
var tvFeatureCards = [];
var tvFeatureTimer = null;

function tvCardArt(item) { return item._trendArt || heroArt(item) || item.poster || ''; }

/* Shows `item` in a card (image, kind, title, details). */
function setFeatureCard(card, item) {
  card._item = item;
  var img = card._img;
  var src = tvCardArt(item);
  img.setAttribute('data-poster-src', src);
  if (img.getAttribute('src')) { img.src = tileImageUrl(img); }
  card._kicker.textContent = isSeriesItem(item) ? 'Serie' : 'Película';
  card._title.textContent = item.title || '';
  if (card._meta) { card._meta.textContent = itemMetaLine(item) || ''; }
}

function makeFeatureCard(item, x, y, w, h, small) {
  var c = el('div', 'poster focusable gold tvf-card' + (small ? ' is-small' : ''));
  abs(c, x, y, w, h);
  var img = el('img', 'p-img');
  img.decoding = 'async';
  img.onerror = posterImageError;
  img.onload = posterImageLoaded;
  c.appendChild(img);
  c.appendChild(el('div', 'tvf-shade'));
  var text = el('div', 'tvf-text');
  c._kicker = el('div', 'tvf-kicker');
  c._title = el('div', 'tvf-title');
  text.appendChild(c._kicker);
  text.appendChild(c._title);
  if (!small) { c._meta = el('div', 'tvf-meta'); text.appendChild(c._meta); }
  c.appendChild(text);
  c._img = img;
  setFeatureCard(c, item);
  c._activate = function () { openDetail(c._item); };
  schedulePosterMemoryPass();
  return c;
}

/* Lays the block on the page from y = 20. Returns the y below it, or 0 when
   the section has no titles with wide art. */
function appendTvFeature(page, all, opts) {
  var pool = [];
  for (var i = 0; i < all.length && pool.length < 12; i++) {
    if (tvCardArt(all[i]) && (heroArt(all[i]) || all[i]._trendArt) && hasUsableCover(all[i])) { pool.push(all[i]); }
  }
  if (pool.length < 2) { return 0; }
  /* The list comes best first (the trends, then the portal's titles): the
     big cards open with #1 and #2, the small ones show #3 to #6, and the big
     ones then take turns with #7 onwards. */
  var small = pool.slice(2, 6);
  var big = pool.slice(0, 2).concat(pool.slice(6));
  var bigW = Math.floor((ROW_W - TVF_GAP) / 2);
  var smallW = Math.floor((ROW_W - TVF_GAP * 3) / 4);
  var y = 20;
  for (var b = 0; b < 2; b++) {
    var card = makeFeatureCard(big[b % big.length], ROW_X + b * (bigW + TVF_GAP), y, bigW, TVF_BIG_H, false);
    card._turns = big.filter(function (v, n) { return n % 2 === b; });
    card._turn = 0;
    card._page = page;
    /* Dashes that tell which of the card's titles is showing. */
    if (card._turns.length > 1) {
      card._dots = el('div', 'tvf-dots');
      for (var d = 0; d < card._turns.length; d++) { card._dots.appendChild(el('i', d === 0 ? 'is-on' : '')); }
      card.appendChild(card._dots);
    }
    page.appendChild(card);
    if (card._turns.length > 1) { tvFeatureCards.push(card); }
  }
  y += TVF_BIG_H + 28;
  for (var s = 0; s < small.length; s++) {
    page.appendChild(makeFeatureCard(small[s], ROW_X + s * (smallW + TVF_GAP), y, smallW, TVF_SMALL_H, true));
  }
  if (small.length) { y += TVF_SMALL_H + 36; }
  if (!tvFeatureTimer && tvFeatureCards.length) { tvFeatureTimer = setInterval(rotateTvFeatures, TVF_ROTATE_MS); }
  return y;
}

/* Every few seconds each big card shows its next title: the new image is
   loaded first and then swapped in one go (no cross-fade to draw), only on
   the section on screen and never under the remote. */
function rotateTvFeatures() {
  tvFeatureCards = tvFeatureCards.filter(function (c) { return document.documentElement.contains(c); });
  if (state.screen !== 'home' || document.hidden) { return; }
  tvFeatureCards.forEach(function (card) {
    if (!card._page.classList.contains('is-current') || card._page.scrollTop > 200 || state.focus === card) { return; }
    var next = card._turns[(card._turn + 1) % card._turns.length];
    var pre = new Image();
    var apply = function () {
      if (state.focus === card) { return; }
      card._turn = (card._turn + 1) % card._turns.length;
      setFeatureCard(card, next);
      card._img.src = pre.src;
      if (card._dots) {
        for (var d = 0; d < card._dots.children.length; d++) { card._dots.children[d].className = d === card._turn ? 'is-on' : ''; }
      }
    };
    /* Swap only once the new picture is decoded: on a Fire TV the card
       showed one empty frame otherwise (a flash every 8 s). */
    pre.onload = function () {
      if (pre.decode) { pre.decode().then(apply, apply); } else { apply(); }
    };
    pre.src = sizedImageUrl(tvCardArt(next), parseFloat(card.style.width));
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
  if (!window.XUPER_DESKTOP || !pages) { return; }
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
