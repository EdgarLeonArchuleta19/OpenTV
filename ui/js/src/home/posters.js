/* home/posters.js — Pósteres: carga diferida, memoria de imágenes, reintentos y creación de tarjetas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --------------------------------------------------------------- posters */
/* Chromium 53 retains decoded poster bitmaps very aggressively.  Keep the
   DOM/focus graph intact, but attach each source only when its tile is near
   the visible viewport and release it again when changing page/screen. */
var posterMemoryTimer = null;
function schedulePosterMemoryPass() {
  /* Desktop: throttle instead of debounce, so posters keep appearing while
     a list is still gliding under the mouse wheel. */
  if (posterMemoryTimer) {
    if (window.XUPER_DESKTOP) { return; }
    clearTimeout(posterMemoryTimer);
  }
  posterMemoryTimer = setTimeout(function () {
    posterMemoryTimer = null;
    refreshPosterMemory();
  }, 80);
}
function posterBelongsToVisiblePage(img) {
  if (state.screen === 'home') {
    var homePage = closest(img, '.home-page');
    return !!(homePage && homePage.classList.contains('is-current'));
  }
  if (state.screen === 'search') {
    var results = closest(img, '.search-results');
    var hot = closest(img, '.search-hot');
    return !!((results && results.classList.contains('is-active')) ||
              (hot && !hot.classList.contains('is-hidden')));
  }
  if (state.screen === 'detail') {
    /* Related titles live inside the active detail screen, not a home page. */
    var detailScreen = closest(img, '#screen-detail');
    return !!(detailScreen && detailScreen.classList.contains('is-active'));
  }
  return false;
}
function refreshPosterMemory() {
  var imgs = document.querySelectorAll('img[data-poster-src]');
  var viewW = window.innerWidth || 1920;
  var viewH = window.innerHeight || 1080;
  for (var i = 0; i < imgs.length; i++) {
    var img = imgs[i];
    var tile = closest(img, '.poster, .bento, .continue-card');
    var r = tile && tile.getBoundingClientRect ? tile.getBoundingClientRect() : null;
    var marginY = window.XUPER_DESKTOP ? viewH : 420;
    var marginX = window.XUPER_DESKTOP ? viewW / 2 : 320;
    var near = posterBelongsToVisiblePage(img) && r &&
      r.bottom > -marginY && r.top < viewH + marginY && r.right > -marginX && r.left < viewW + marginX;
    if (near) {
      if (!img.getAttribute('src')) {
        img.style.display = '';
        img.src = img.getAttribute('data-poster-src');
      }
    } else if (img.getAttribute('src') && !window.XUPER_DESKTOP) {
      /* (TV only: a PC has memory to spare, and reloading on the way back
         left posters blank while they downloaded again.) */
      /* Removing the source gives Starfish a chance to release the decoded
         texture instead of keeping whole catalog pages resident in RAM. */
      img.removeAttribute('src');
      try { img.src = ''; } catch (eRelease) { /* ignore */ }
    }
  }
}

/* A poster that fails to download (slow CDN, a dropped connection) is
   retried twice on desktop before the placeholder is shown. */
/* Covers that fail to load are remembered for a few days on desktop: those
   titles are left out of the home sections, and wherever they still appear
   (search, related titles) they get an OpenTV generic cover. */
var BROKEN_COVERS_KEY = 'opentv_broken_covers_v1';
var BROKEN_COVER_DAYS = 3;
var brokenCovers = null;
function loadBrokenCovers() {
  if (brokenCovers) { return brokenCovers; }
  brokenCovers = {};
  try {
    var saved = JSON.parse(localStorage.getItem(BROKEN_COVERS_KEY) || '{}') || {};
    var limit = Date.now() - BROKEN_COVER_DAYS * 86400000;
    for (var id in saved) {
      if (Object.prototype.hasOwnProperty.call(saved, id) && saved[id] > limit) { brokenCovers[id] = saved[id]; }
    }
  } catch (eLoad) { /* storage off */ }
  return brokenCovers;
}
function markCoverBroken(item) {
  if (!window.XUPER_DESKTOP || !item || item.id === undefined) { return; }
  var all = loadBrokenCovers();
  if (all[item.id]) { return; }
  all[item.id] = Date.now();
  try { localStorage.setItem(BROKEN_COVERS_KEY, JSON.stringify(all)); } catch (eSave) { /* storage full */ }
  catalogStaleAt = Date.now();
}
function hasUsableCover(item) {
  if (!item || !(item.poster || item.landscape)) { return false; }
  return !loadBrokenCovers()[item.id];
}
/* Home lists on desktop skip titles without a working cover. */
function withCovers(list) {
  if (!window.XUPER_DESKTOP || !list) { return list; }
  var out = [];
  for (var i = 0; i < list.length; i++) { if (hasUsableCover(list[i])) { out.push(list[i]); } }
  return out.length ? out : list;
}
/* OpenTV generic cover: dark card, logo and the title. */
function applyGenericCover(tile, item) {
  if (!window.XUPER_DESKTOP || !tile || tile._generic) { return; }
  tile._generic = true;
  var imgs = tile.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) { imgs[i].style.display = 'none'; }
  tile.classList.add('is-generic', 'is-loaded');
  var cover = el('div', 'generic-cover');
  var mark = el('img', 'gc-mark');
  mark.src = 'images/logo-mark.svg';
  mark.alt = '';
  cover.appendChild(mark);
  cover.appendChild(el('div', 'gc-title', (item && item.title) || 'OpenTV'));
  tile.insertBefore(cover, tile.firstChild);
}

/* Desktop: images fade in once loaded; the tile shows a soft shimmer until then. */
function posterImageLoaded() {
  this.classList.add('is-loaded');
  if (this.parentNode && this.parentNode.classList) { this.parentNode.classList.add('is-loaded'); }
}

function posterImageError() {
  var img = this;
  var tries = img._posterRetries || 0;
  if (window.XUPER_DESKTOP && tries < 2) {
    img._posterRetries = tries + 1;
    setTimeout(function () {
      var src = img.getAttribute('data-poster-src');
      if (!src || !img.isConnected) { return; }
      img.removeAttribute('src');
      img.src = src;
    }, 1500 * (tries + 1));
    return;
  }
  var tile = img.parentNode;
  if (window.XUPER_DESKTOP && tile && tile.classList) {
    markCoverBroken(tile._item);
    applyGenericCover(tile, tile._item);
    return;
  }
  img.style.display = 'none';
  if (tile && tile.classList) { tile.classList.add('is-loaded'); }
}

function makePoster(item, x, y, w, h, opts) {
  opts = opts || {};
  var p = el('div', 'poster focusable' + (opts.gold ? ' gold' : '') + (opts.type3 ? ' type3' : ''));
  abs(p, x, y, w, h);
  if (item.poster) {
    /* Keep the original no-data bitmap underneath: if the remote poster
       fails, removing the <img> reveals the authentic placeholder. */
    var pimg = el('img', 'p-img');
    pimg.setAttribute('data-poster-src', item.poster);
    pimg.onerror = posterImageError;
    pimg.onload = posterImageLoaded;
    p.appendChild(pimg);
  }
  /* sel_poster_nohalo items (free, search, related) draw their own title,
     so the PosterView title/shadow children stay hidden. */
  if (!opts.gold) {
    p.appendChild(el('div', 'p-shade'));
    p.appendChild(el('div', 'p-title', item.title));
  }
  p._item = item;
  if (window.XUPER_DESKTOP && !item.poster) { applyGenericCover(p, item); }
  if (window.XUPER_DESKTOP && item.title) { p.appendChild(el('div', 'p-hover', item.title)); }
  p._activate = function () { openDetail(item); };
  schedulePosterMemoryPass();
  return p;
}

function addPosters(page, areaLeft, areaTop, list, items) {
  var area = el('div', 'poster-area');
  abs(area, areaLeft, areaTop, 1830, 940.5);
  var source = (items && items.length) ? items : VOD;
  if (!source.length) { page.appendChild(area); return area; }
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    area.appendChild(makePoster(source[i % source.length], d.x, d.y, d.w, d.h, d.opts));
  }
  page.appendChild(area);
  return area;
}
