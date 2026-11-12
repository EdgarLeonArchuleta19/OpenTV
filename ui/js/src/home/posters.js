/* home/posters.js — Pósteres: carga diferida, memoria de imágenes, reintentos y creación de tarjetas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --------------------------------------------------------------- posters */
/* Chromium 53 retains decoded poster bitmaps very aggressively.  Keep the
   DOM/focus graph intact, but attach each source only when its tile is near
   the visible viewport and release it again when changing page/screen. */
var posterMemoryTimer = null;

/* Android app (Capacitor, "OpenTVImg" in its user agent): images go through
   the app, which downloads each one once, decodes it already reduced to the
   size it is shown at and keeps that small copy on disk, like Glide in
   native TV apps. The WebView then never decodes a full-size cover for a
   small tile (the main cause of stutter on the Fire TV). `w` is the width in
   page pixels. */
var nativeImageSizer = /OpenTVImg\/\d/.test(navigator.userAgent || '');
function sizedImageUrl(url, w) {
  if (!nativeImageSizer || !url || !w || !/^https?:\/\//i.test(url)) { return url; }
  var px = Math.round(w * (window.innerWidth || 1920) / 1920 * (window.devicePixelRatio || 1));
  return 'https://opentv-img.local/i?w=' + px + '&u=' + encodeURIComponent(url);
}
function tileImageUrl(img) {
  var src = img.getAttribute('data-poster-src');
  var tile = closest(img, '.poster, .bento, .continue-card');
  return sizedImageUrl(src, tile ? parseFloat(tile.style.width) : 0);
}

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
  }, platformIsTv() ? 150 : 80);
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
  /* Desktop never unloads a poster, so only the ones still waiting need a
     look (a long session has hundreds already on screen). */
  var sel = window.XUPER_DESKTOP ? 'img[data-poster-src]:not([src])' : 'img[data-poster-src]';
  /* TVs: only the posters of the page on screen, and rows far from the
     scroll position are skipped by their written position (measuring
     hundreds of catalogue posters after every key press cost ~18 ms). */
  var tvPage = null;
  if (platformIsTv() && window.XUPER_DESKTOP && state.screen === 'home') {
    tvPage = document.querySelector('.home-page.is-current');
  }
  var imgs;
  if (tvPage) {
    /* Only the rows (and catalogue lines) near the scroll position. */
    imgs = [];
    var top0 = tvPage.scrollTop;
    var lines = tvPage.children;
    for (var l = 0; l < lines.length; l++) {
      var lineTop = parseFloat(lines[l].style.top);
      if (!isNaN(lineTop) && (lineTop < top0 - 900 || lineTop > top0 + 1800)) { continue; }
      var found = lines[l].querySelectorAll(sel);
      for (var k = 0; k < found.length; k++) { imgs.push(found[k]); }
    }
  } else {
    imgs = document.querySelectorAll(sel);
  }
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
        img.src = tileImageUrl(img);
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
      img.src = tileImageUrl(img);
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
    pimg.decoding = 'async';
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
