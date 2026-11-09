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
  function syncArrows() {
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
  var host = makeRowShell(page, y, ROW_HEIGHT, titleText, 'is-posters');
  for (var i = 0; i < items.length; i++) {
    host._strip.appendChild(makePoster(items[i], ROW_PAD + i * ROW_STEP, ROW_PAD, ROW_POSTER_W, ROW_POSTER_H, { gold: true }));
  }
  var tail = el('div', 'd-row-tail');
  abs(tail, ROW_PAD + items.length * ROW_STEP, 0, ROW_PAD, 1);
  host._strip.appendChild(tail);
  return y + ROW_HEIGHT;
}

/* ------------------------------------------------------------ Seguir viendo */
/* Titles started and not finished, newest first. `filter` is 'movie',
   'series' or empty for both. Finished movies (95 %+) drop out; a series
   stays so the next episode is one click away. */
function continueRecords(filter) {
  var out = [];
  var list = localProfile.history || [];
  for (var i = 0; i < list.length && out.length < 20; i++) {
    var r = list[i];
    if (!r || !r.id || r.hideContinue || (r.position || 0) < 20) { continue; }
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
  var item = vodById(r.id);
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
    r.hideContinue = true;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    refreshContinueRows();
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
