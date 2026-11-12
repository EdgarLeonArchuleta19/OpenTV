/* core/focus.js — Motor de foco: visibilidad, enfoque, scroll al foco y navegación espacial con flechas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------ focus core */
function isVisible(node) {
  if (!node || !node.getBoundingClientRect) { return false; }
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') { return false; }
  if (node.offsetParent === null) { return false; }
  var r = node.getBoundingClientRect();
  /* moveFocus reads it right after focusables(): measured only once. */
  node._visRect = r;
  if (r.width < 1 || r.height < 1) { return false; }
  if (historyDrawerOpen) { return !!closest(node, '.history-drawer'); }
  if (profilePickerOpen) { return !!closest(node, '.profile-picker'); }
  if (liveGuideOpen) { return !!closest(node, '.live-guide'); }
  if (dialogAddonsOpen) { return !!closest(node, '#dialog-addons'); }
  if (sourcePickerOpen) { return !!closest(node, '#dialog-sources'); }
  if (state.episodeBrowserOpen) {
    return !!closest(node, '#player-episodes');
  }
  if (state.categoryPickerOpen) {
    return !!closest(node, '#player-categories');
  }
  if (dialogPlaySettingsOpen) {
    return !!closest(node, '#dialog-playsettings');
  }
  if (playSettingViewOpen) {
    return !!closest(node, '#player-playsetting-view');
  }
  var page = closest(node, '.home-page');
  if (page && !page.classList.contains('is-current')) { return false; }
  var panel = closest(node, '.settings-panel');
  if (panel && !panel.classList.contains('is-active')) { return false; }
  var hot = closest(node, '.search-hot');
  if (hot && hot.classList.contains('is-hidden')) { return false; }
  var res = closest(node, '.search-results');
  if (res && !res.classList.contains('is-active')) { return false; }
  var pc = closest(node, '.player-channels');
  if (pc && !pc.classList.contains('is-active')) { return false; }
  var ib = closest(node, '.player-infobar');
  if (ib && !ib.classList.contains('is-active')) { return false; }
  return true;
}

function focusables() {
  return focusablesIn(document);
}
function focusablesIn(root) {
  if (!root) { return []; }
  var nodes = root.querySelectorAll('.focusable');
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    if (isVisible(nodes[i])) { out.push(nodes[i]); }
  }
  return out;
}

/* TV scrolling is instant: the content is in place on the very next frame
   (fast moves were preferred over glides, which kept the Fire TV painting
   and decoding images for the whole animation). Scrolls asked for during a
   key press run on the next frame, once: the key handler returns at once
   and the browser restyles a single time. Pass null for an axis that stays. */
var smoothScrollOk = false;
var tvScrollQueue = [];
var tvScrollFrame = 0;
function tvScrollTo(box, left, top) {
  for (var i = 0; i < tvScrollQueue.length; i++) {
    if (tvScrollQueue[i].box === box) { tvScrollQueue.splice(i, 1); break; }
  }
  tvScrollQueue.push({ box: box, left: left, top: top });
  if (tvScrollFrame) { return; }
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
  tvScrollFrame = raf(function () {
    tvScrollFrame = 0;
    var jobs = tvScrollQueue;
    tvScrollQueue = [];
    for (var j = 0; j < jobs.length; j++) { tvScrollNow(jobs[j].box, jobs[j].left, jobs[j].top); }
  });
}
function tvScrollNow(box, left, top) {
  if (smoothScrollOk && box.scrollTo) {
    var o = { behavior: 'smooth' };
    if (left !== null) { o.left = left; }
    if (top !== null) { o.top = top; }
    box.scrollTo(o);
    return;
  }
  if (left !== null) { box.scrollLeft = left; }
  if (top !== null) { box.scrollTop = top; }
}

/* TVs, like Android TV's Leanback rows: the focus stays put and the content
   moves to it. The focused poster sits in the first slot of its row and the
   focused row at the top of the page (the first rows just stay, there is
   nothing above them). Returns false for anything that is not a home row. */
function tvReveal(node) {
  var page = closest(node, '.home-page');
  if (!page) { return false; }
  /* Positions come from what is written on the elements (rows and posters
     are placed with left/top), so nothing is measured on a key press. */
  var line = childOf(node, page);
  var lineTop = line ? parseFloat(line.style.top) : NaN;
  if (isNaN(lineTop)) { return false; }   /* TV en vivo and others: classic reveal */
  var strip = closest(node, '.d-row-strip');
  if (strip) {
    var cell = childOf(node, strip);
    var cellLeft = cell ? parseFloat(cell.style.left) : NaN;
    if (!isNaN(cellLeft)) {
      if (strip._tvMax === undefined) { strip._tvMax = Math.max(0, strip.scrollWidth - strip.clientWidth); }
      /* The focus moves along the row; the row only slides when the
         focused poster would leave the screen, and then shows half of the
         next one (so there is clearly more). */
      var curX = strip._tvX || 0;
      var cellW = parseFloat(cell.style.width) || cell.offsetWidth;
      var row = strip.parentNode;
      var stripPageLeft = (parseFloat(row && row.style.left) || 0) + (parseFloat(strip.style.left) || 0);
      var viewW = Math.min(strip.clientWidth, 1920 - 60 - stripPageLeft);
      var wantX = curX;
      if (cellLeft - ROW_PAD < curX) { wantX = cellLeft - ROW_PAD; }
      else if (cellLeft + cellW + cellW * 0.5 > curX + viewW) { wantX = cellLeft + cellW + cellW * 0.5 - viewW; }
      wantX = Math.max(0, Math.min(strip._tvMax, Math.round(wantX)));
      if (wantX !== curX) {
        strip._tvX = wantX;
        tvScrollTo(strip, wantX, null);
      }
    }
  }
  /* The big cards and the trends under them are one block: while the remote
     is in it the page stays at its top. Further down, the focused row is
     centred on the screen. */
  /* Same row as before (moving sideways): the page stays where it is. */
  if (page._tvLine !== line || !document.documentElement.contains(line)) {
    page._tvLine = line;
    var wantY = 0;
    if (lineTop >= 560) {
      var lineH = line.offsetHeight || 0;
      wantY = Math.round(lineTop + lineH / 2 - page.clientHeight / 2);
      wantY = Math.max(0, Math.min(page.scrollHeight - page.clientHeight, wantY));
    }
    tvScrollTo(page, null, wantY);
  }
  return true;
}

/* The ancestor of node that is a direct child of parent (or null). */
function childOf(node, parent) {
  var n = node;
  while (n && n.parentNode !== parent) { n = n.parentNode; }
  return n;
}

/* TVs, Leanback style: left/right go to the neighbouring poster of the row
   and up/down to the row above/below, to the poster at the same place on
   screen. Everything comes from the written positions: no measuring.
   Returns the target, null at an edge, or undefined when the focus is not
   in a home row (then the spatial search decides). */
function tvStructuralMove(node, dir, page) {
  var strip = closest(node, '.d-row-strip');
  if ((dir === 'left' || dir === 'right') && !strip) {
    /* Cards and catalogue posters placed straight on the page: the nearest
       one on the same line (same written top) on that side. */
    var me = childOf(node, page);
    var myTop = me ? parseFloat(me.style.top) : NaN;
    if (isNaN(myTop) || me !== node) { return undefined; }
    var myLeft = parseFloat(me.style.left);
    var sideBest = null, sideGap = 1e9;
    var row = page.children;
    for (var r = 0; r < row.length; r++) {
      var o = row[r];
      if (o === me || !o.classList.contains('focusable') || o.style.display === 'none' || parseFloat(o.style.top) !== myTop) { continue; }
      var d = parseFloat(o.style.left) - myLeft;
      if ((dir === 'right' ? d > 0 : d < 0) && Math.abs(d) < sideGap) { sideGap = Math.abs(d); sideBest = o; }
    }
    return sideBest;
  }
  if (dir === 'left' || dir === 'right') {
    var cell = childOf(node, strip);
    var n = cell && (dir === 'right' ? cell.nextElementSibling : cell.previousElementSibling);
    while (n) {
      var f = n.classList.contains('focusable') ? n : n.querySelector('.focusable');
      if (f && f.style.display !== 'none') { return f; }
      n = dir === 'right' ? n.nextElementSibling : n.previousElementSibling;
    }
    return null;
  }
  var cur = childOf(node, page);
  var curTop = cur ? parseFloat(cur.style.top) : NaN;
  if (isNaN(curTop)) { return undefined; }
  var curX = tvPageX(node, page);
  /* The next line: the nearest written top above / below. */
  var kids = page.children;
  var lineTop = null;
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k.style.display === 'none' || !(k.classList.contains('d-row') || k.classList.contains('focusable'))) { continue; }
    var t = parseFloat(k.style.top);
    if (isNaN(t)) { continue; }
    if (dir === 'down' ? (t > curTop && (lineTop === null || t < lineTop)) : (t < curTop && (lineTop === null || t > lineTop))) { lineTop = t; }
  }
  if (lineTop === null) { return dir === 'up' ? undefined : null; }
  var best = null, bestGap = 1e9;
  for (var j = 0; j < kids.length; j++) {
    var g = kids[j];
    if (g.style.display === 'none' || parseFloat(g.style.top) !== lineTop) { continue; }
    var cands = g.classList.contains('focusable') ? [g] : g.querySelectorAll('.focusable');
    for (var c = 0; c < cands.length; c++) {
      if (cands[c].style.display === 'none') { continue; }
      var gap = Math.abs(tvPageX(cands[c], page) - curX);
      if (gap < bestGap) { bestGap = gap; best = cands[c]; }
    }
  }
  return best;
}

/* Where an element is across the page (written positions, minus how far
   its row has been moved by tvReveal). */
function tvPageX(node, page) {
  var strip = closest(node, '.d-row-strip');
  if (strip && page.contains(strip)) {
    var cell = childOf(node, strip);
    var row = strip.parentNode;
    return (parseFloat(row.style.left) || 0) + (parseFloat(strip.style.left) || 0) +
      (parseFloat(cell && cell.style.left) || 0) - (strip._tvX || 0);
  }
  var top = childOf(node, page);
  return parseFloat(top && top.style.left) || 0;
}

function reveal(node) {
  /* A section still sliding in reads shifted on screen (its first poster
     looked off the right edge, and the row was scrolled to "show" it).
     Measure once it has landed. */
  if (window.XUPER_DESKTOP && !platformIsTv() && closest(node, '.home-page.is-entering')) {
    setTimeout(function () { if (state.focus === node) { reveal(node); } }, 420);
    return;
  }
  if (platformIsTv() && window.XUPER_DESKTOP && tvReveal(node)) { return; }
  var box = closest(node, '.scrollable');
  var tvCenter = platformIsTv() && window.XUPER_DESKTOP;
  while (box) {
    var er = node.getBoundingClientRect();
    var br = box.getBoundingClientRect();
    if (tvCenter && box.scrollHeight > box.clientHeight + 1) {
      /* TVs (search, details, Mi lista, the guide, Ajustes…): the focused
         element is centred, and near the top the list stays at its start,
         as it was opened. The target comes from where the element sits in
         the content (not from the current scroll, which may still be
         gliding), so quick presses never leave a poster half out. */
      /* The TV canvas (1920×1080) is scaled to the screen (a Fire TV's
         WebView is 960×540): on-screen sizes are scaled, scrollTop is not.
         Mixing them left every move half done. Everything here is in
         canvas pixels, centred on the part of the box that is on screen. */
      var scale = br.height / (box.offsetHeight || br.height) || 1;
      var visTop = Math.max(br.top, 0), visBottom = Math.min(br.bottom, window.innerHeight);
      var visH = Math.max(1, (visBottom - visTop) / scale);
      var contentTop = box.scrollTop + (er.top - visTop) / scale + (visTop - br.top) / scale;
      var elH = er.height / scale;
      var maxTop = box.scrollHeight - box.clientHeight;
      var wantTop = contentTop - (visTop - br.top) / scale + elH / 2 - visH / 2;
      if (contentTop + elH <= visH * 0.62) { wantTop = 0; }
      wantTop = Math.round(Math.max(0, Math.min(maxTop, wantTop)));
      /* Same target as the last press (moving sideways): leave the glide
         alone; ask again only if it never got there. */
      var settled = Date.now() - (box._tvAt || 0) > 700;
      if (box._tvTop !== wantTop || (settled && Math.abs(wantTop - box.scrollTop) > 4)) {
        box._tvTop = wantTop;
        box._tvAt = Date.now();
        tvScrollTo(box, null, wantTop);
      }
    } else if (er.top < br.top) {
      box.scrollTop -= (br.top - er.top) + 12;
    } else if (er.bottom > br.bottom) {
      box.scrollTop += (er.bottom - br.bottom) + 12;
    }
    if (box.scrollWidth > box.clientWidth + 1) {
      /* A row can be wider than the screen (it runs under the edges), so
         what counts is the part of it that is on screen; on TVs the menu
         icons cover the left edge, and half of the next poster stays in
         view so the remote always shows where it goes next. */
      var tv = platformIsTv();
      var viewLeft = Math.max(br.left, tv ? window.innerWidth * 150 / 1920 : 0);
      var viewRight = Math.min(br.right, window.innerWidth);
      var room = tv ? Math.round(er.width * 0.5) : 12;
      /* On-screen pixels to the box's own (the TV canvas is scaled). */
      var hs = (br.width / (box.offsetWidth || br.width)) || 1;
      if (er.left < viewLeft) {
        box.scrollLeft -= ((viewLeft - er.left) + room) / hs;
      } else if (er.right > viewRight) {
        box.scrollLeft += ((er.right - viewRight) + room) / hs;
      }
    }
    box = closest(box.parentNode, '.scrollable');
  }
}

/* The menu on the left follows the focus (also called by showScreen: the
   focus can land on a tab while another screen is still showing, and the
   menu then stayed closed with the focus hidden inside it). */
function syncHomeRail(node) {
  /* The tab rail expands while it holds focus and collapses to icons as soon
     as the content takes focus (observed on the running app). */
  var rail = $('home-tabs');
  if (rail && node && state.screen === 'home') {
    var inRail = closest(node, '.home-tabs');
    /* Desktop: the rail always shows icon + label; the pages make room for
       it (desktop/theme.css) instead of the rail covering them. */
    var keepOpen = !!window.XUPER_DESKTOP;
    /* TVs: the menu on the left opens over the page; only opacities change,
       nothing on the page moves ("Teles" in desktop/tw/input.css). */
    /* (On the menu and its backdrop, not on <body>: a class on <body> makes
       the browser restyle the whole app on every move.) */
    if (keepOpen && platformIsTv() && rail.classList.contains('tv-open') !== !!inRail) {
      rail.classList.toggle('tv-open', !!inRail);
      var tvBg = document.querySelector('.home-sidebar-bg');
      if (tvBg) { tvBg.classList.toggle('tv-open', !!inRail); }
    }
    rail.classList.toggle('is-expanded', keepOpen || !!inRail);
    rail.classList.toggle('is-collapsed', !keepOpen && !inRail);
    var railBg = document.querySelector('.home-sidebar-bg');
    if (railBg) { railBg.classList.toggle('is-on', !keepOpen && !!inRail); }
    var homeScreen = $('screen-home');
    if (homeScreen) { homeScreen.classList.toggle('is-rail-open', !keepOpen && !!inRail); }
  }
}

/* Desktop: the focus ring (white frame + zoom) is shown only while the
   keyboard is being used, like Windows does. With the mouse, the current
   element is still tracked, just not highlighted. The TV always shows it. */
var focusRingVisible = !window.XUPER_DESKTOP || platformIsTv();

function setFocusRingVisible(on) {
  on = !!on;
  if (on === focusRingVisible) { return; }
  focusRingVisible = on;
  document.body.classList.toggle('is-keyboard-nav', on);
  if (state.focus) { state.focus.classList.toggle('is-focused', on); }
}

function installFocusRingMode() {
  if (!window.XUPER_DESKTOP || platformIsTv()) {
    if (focusRingVisible && document.body) { document.body.classList.add('is-keyboard-nav'); }
    return;
  }
  var NAV_KEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1, PageUp: 1, PageDown: 1 };
  document.addEventListener('keydown', function (event) {
    if (NAV_KEYS[event.key] && !(event.target && event.target.tagName === 'INPUT')) { setFocusRingVisible(true); }
  }, true);
  document.addEventListener('pointerdown', function () { setFocusRingVisible(false); }, true);
  var lastX = -1, lastY = -1;
  document.addEventListener('pointermove', function (event) {
    if (!focusRingVisible) { return; }
    if (lastX >= 0 && Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 12) { setFocusRingVisible(false); }
    lastX = event.clientX; lastY = event.clientY;
  }, true);
}

function setFocus(node, silent) {
  if (!node) { return; }
  if (state.focus === node) {
    if (!silent) { reveal(node); }
    return;
  }
  if (state.focus) {
    state.focus.classList.remove('is-focused');
    /* TVs: the poster that loses focus keeps its own layer while it shrinks
       back, so the zoom out is animated by the compositor too. */
    if (platformIsTv()) {
      var prevFocus = state.focus;
      prevFocus.classList.add('was-focused');
      setTimeout(function () { prevFocus.classList.remove('was-focused'); }, 260);
    }
  }
  state.focus = node;
  if (focusRingVisible) { node.classList.add('is-focused'); }
  if (node._onFocus) { node._onFocus(); }
  /* Each home section keeps where the viewer was, for coming back from the
     menu (home.js enterTab). */
  if (state.screen === 'home') {
    var homePage = closest(node, '.home-page');
    if (homePage) { homePage._lastFocus = node; }
  }
  renderPlaySettingRowFocus();
  syncHomeRail(node);
  if (!silent) { reveal(node); }
  schedulePosterMemoryPass();
}

function firstIn(container) {
  var nodes = container.querySelectorAll('.focusable');
  for (var i = 0; i < nodes.length; i++) {
    if (isVisible(nodes[i])) { return nodes[i]; }
  }
  return null;
}

function moveFocus(dir) {
  /* Lost focus (nothing yet, or the element was rebuilt away: its position
     reads 0,0 and the next move would jump anywhere): start again from the
     current section. */
  if (state.focus && !document.documentElement.contains(state.focus)) {
    state.focus = null;
    /* Inside the channel guide the focus stays in the guide. */
    if (liveGuideOpen) {
      var inGuide = guideFocusFallback();
      if (inGuide) { setFocus(inGuide); return; }
    }
    if (state.screen === 'home' && TABS[state.tab] && pages[TABS[state.tab].page]) {
      var again = firstIn(pages[TABS[state.tab].page]) || tabEls[state.tab];
      if (again) { setFocus(again); return; }
    }
  }
  if (!state.focus) {
    var f = focusables();
    if (f.length) { setFocus(f[0]); }
    return;
  }
  /* The guide is open but the focus is somewhere behind it: back into it. */
  if (liveGuideOpen && !closest(state.focus, '.live-guide')) {
    var guideNode = guideFocusFallback();
    if (guideNode) { setFocus(guideNode); return; }
  }
  if (state.focus._onMove && state.focus._onMove(dir)) { return; }

  var inPage = state.screen === 'home' && closest(state.focus, '.home-page');
  var inSidebar = state.screen === 'home' && closest(state.focus, '.home-tabs');
  /* (Not on TV en vivo: preview, channel list and controls sit side by side
     there, so moves across them must stay free.) */
  var tvRowNav = !!inPage && platformIsTv() && !!window.XUPER_DESKTOP && inPage !== pages[0];

  /* TVs: rows move by position (no measuring), like Leanback. */
  if (tvRowNav) {
    var target = tvStructuralMove(state.focus, dir, inPage);
    if (target) { setFocus(target); return; }
    if (target === null) {
      if (dir === 'left' && tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
  }

  /* TVs: only look where the next element can be (the same row for
     left/right, the current page and the top icons for up/down) instead
     of measuring every element of the app on each key press. */
  var list;
  var banded = false;
  if (tvRowNav && (dir === 'left' || dir === 'right')) {
    var line = closest(state.focus, '.d-row-strip') || closest(state.focus, '.hero-info') || closest(state.focus, '.live-dock');
    list = line ? focusablesIn(line) : focusablesIn(inPage);
  } else if (tvRowNav) {
    /* Up/down: only the rows near this one (their position is written on
       them, so the far ones are skipped without measuring them). */
    list = focusablesNear(inPage, pageLineTop(state.focus, inPage), 1300);
    banded = true;
    if (dir === 'up') { list = list.concat(focusablesIn($('home-notify'))); }
  } else {
    list = focusables();
  }
  var fr = state.focus.getBoundingClientRect();
  var fx = fr.left + fr.width / 2;
  var fy = fr.top + fr.height / 2;
  var best = pickFocusTarget(list, dir, fr, fx, fy, inPage, inSidebar, tvRowNav);
  /* Nothing in the nearby rows (a very tall row): look at the whole page. */
  if (!best && banded) {
    list = focusablesIn(inPage);
    if (dir === 'up') { list = list.concat(focusablesIn($('home-notify'))); }
    best = pickFocusTarget(list, dir, fr, fx, fy, inPage, inSidebar, tvRowNav);
  }

  if (best) {
    setFocus(best);
    return;
  }

  if (window.XUPER_DESKTOP && !platformIsTv() && dir === 'up' && inPage) {
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    return;
  }
  /* Leftmost limit reached in page content: now focus sidebar tab (the TV
     menu on the left). */
  if (dir === 'left' && inPage && (!window.XUPER_DESKTOP || platformIsTv())) {
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
  }
}

/* Page-relative top of the page child (row, grid poster, hero) that holds
   node, read from its inline position: no layout needed. NaN if unknown. */
function pageLineTop(node, page) {
  var n = node;
  while (n && n.parentNode !== page) { n = n.parentNode; }
  if (!n || !n.style) { return NaN; }
  return parseFloat(n.style.top);
}

/* Visible focusables of a page whose row starts within `range` px of
   `top` (rows without a written position are always included). */
function focusablesNear(page, top, range) {
  if (isNaN(top)) { return focusablesIn(page); }
  var nodes = page.querySelectorAll('.focusable');
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    var t = pageLineTop(nodes[i], page);
    if (!isNaN(t) && Math.abs(t - top) > range) { continue; }
    if (isVisible(nodes[i])) { out.push(nodes[i]); }
  }
  return out;
}

/* Spatial navigation: the best candidate of `list` in direction `dir`. */
function pickFocusTarget(list, dir, fr, fx, fy, inPage, inSidebar, tvRowNav) {
  var best = null;
  var bestScore = 1e9;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c === state.focus) { continue; }
    /* Don't let sidebar tabs intercept left navigation while inside page content */
    if (inPage && closest(c, '.home-tabs')) { continue; }
    /* Desktop: from the page, up goes to the tab bar, not the icons. */
    if (inPage && window.XUPER_DESKTOP && !platformIsTv() && closest(c, '.home-notify')) { continue; }
    /* Don't let page content intercept navigation while inside sidebar tabs */
    if (inSidebar && !closest(c, '.home-tabs')) { continue; }

    var r = c._visRect || c.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height / 2;
    var dx = cx - fx;
    var dy = cy - fy;
    var primary, secondary, overlap;

    if (dir === 'left') {
      if (dx > -4) { continue; }
      primary = Math.max(0, fr.left - r.right);
      secondary = Math.abs(dy);
      overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      /* TVs: left/right stay on the same line of the page (no diagonal
         jumps to the row below at the end of a row or of the buttons). */
      if (!overlap && tvRowNav) { continue; }
    } else if (dir === 'right') {
      if (dx < 4) { continue; }
      primary = Math.max(0, r.left - fr.right);
      secondary = Math.abs(dy);
      overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      if (!overlap && tvRowNav) { continue; }
    } else if (dir === 'up') {
      if (dy > -4) { continue; }
      primary = Math.max(0, fr.top - r.bottom);
      secondary = Math.abs(dx);
      overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
    } else {
      if (dy < 4) { continue; }
      primary = Math.max(0, r.top - fr.bottom);
      secondary = Math.abs(dx);
      overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
    }
    var score = primary + secondary * 2 + (overlap ? 0 : 320);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
