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
  /* Under the on-screen keyboard's panel (core/tv-keyboard.js). */
  if (tvKbPanel && closest(node, '.tvk-covered')) { return false; }
  if (historyDrawerOpen) { return !!closest(node, '.history-drawer'); }
  /* The profile editor opens over the picker (or over Mi cuenta): only its
     own controls take the focus while it is open. */
  if (profileEditor && profileEditor.classList.contains('is-open')) { return !!closest(node, '.profile-editor'); }
  if (profilePickerOpen) { return !!closest(node, '.profile-picker'); }
  /* Closed, they stay in the page (only see-through): their tiles and
     buttons took the focus from the details screen ("Mi usuario" below
     "Ir a Addons"). */
  if (closest(node, '.profile-picker') || closest(node, '.profile-editor')) { return false; }
  if (liveGuideOpen) { return !!closest(node, '.live-guide'); }
  /* TV en vivo's category list is open over the channel list: the arrows
     move through the categories, not the channels behind them. */
  if (liveCatMenuOpen()) { return !!closest(node, '.live-cat-menu'); }
  /* The season list of a series is open over its episodes: likewise. */
  if (seasonPopup) { return !!closest(node, '.season-popup'); }
  if (dialogAddonsOpen) { return !!closest(node, '#dialog-addons'); }
  /* Every window of that kind ("Elegir fuente", the guide, the notices)
     shares .source-picker: only its own buttons can take the focus. */
  if (sourcePickerOpen) { return !!closest(node, '.source-picker'); }
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
      /* Measured once per strip: reading sizes right after the focus class
         changed forced a full style + layout pass inside every key press
         (~15 ms on a Fire TV). */
      if (strip._tvMax === undefined || strip._tvKids !== strip.children.length) {
        strip._tvKids = strip.children.length;
        strip._tvClientW = strip.clientWidth;
        strip._tvMax = Math.max(0, strip.scrollWidth - strip._tvClientW);
      }
      /* The focus moves along the row; the row only slides when the
         focused poster would leave the screen, and then shows half of the
         next one (so there is clearly more). */
      var curX = strip._tvX || 0;
      var cellW = parseFloat(cell.style.width) || cell.offsetWidth;
      var row = strip.parentNode;
      var stripPageLeft = (parseFloat(row && row.style.left) || 0) + (parseFloat(strip.style.left) || 0);
      var viewW = Math.min(strip._tvClientW, 1920 - 60 - stripPageLeft);
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
      /* Written sizes first; the page box is measured again only when its
         lines change (a section loading more rows). */
      var lineH = parseFloat(line.style.height) || line.offsetHeight || 0;
      if (page._tvKids !== page.children.length || !page._tvClientH) {
        page._tvKids = page.children.length;
        page._tvClientH = page.clientHeight;
        page._tvScrollH = page.scrollHeight;
      }
      wantY = Math.round(lineTop + lineH / 2 - page._tvClientH / 2);
      wantY = Math.max(0, Math.min(page._tvScrollH - page._tvClientH, wantY));
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
  /* The next line: the nearest written top above / below. The hero's
     buttons (.hero-info) are a line too: up from any poster of the first
     row, even the far right one, lands on them (the measuring fallback
     went to the top icons instead, which were closer on screen). */
  var kids = page.children;
  var lineTop = null;
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k.style.display === 'none' || !(k.classList.contains('d-row') || k.classList.contains('focusable') || k.classList.contains('hero-info'))) { continue; }
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

/* TVs, details screen of a series: the screen stays still and its lower
   part shows one section at a time. Down from the episodes (or the season
   button) the episodes give way to Recomendaciones; up from those, the
   episodes come back. The focus lands on the card most in line with the
   one it leaves. True when it handled the key. */
function tvDetailSectionMove(dir) {
  if (!platformIsTv() || state.screen !== 'detail' || (dir !== 'up' && dir !== 'down')) { return false; }
  var bottom = state.focus && closest(state.focus, '.detail-bottom');
  if (!bottom || !bottom.classList.contains('tv-sections')) { return false; }
  var sections = bottom.querySelectorAll('.dd-section');
  if (sections.length < 2) { return false; }
  var epSec = sections[0], relSec = sections[1];
  var inEp = epSec.contains(state.focus), inRel = relSec.contains(state.focus);
  var fromRow = closest(state.focus, '.dd-grid, .dd-related');
  var fr = state.focus.getBoundingClientRect();
  var fx = fr.left + fr.width / 2;
  function landIn(sec, remembered) {
    var row = sec.querySelector('.dd-grid, .dd-related');
    if (!row) { return false; }
    if (remembered && remembered.isConnected && row.contains(remembered)) { setFocus(remembered); return true; }
    var cards = row.querySelectorAll('.focusable');
    var best = null, bestD = 1e9;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (r.right < 0 || r.left > window.innerWidth) { continue; }
      var d = Math.abs(r.left + r.width / 2 - fx);
      if (d < bestD) { bestD = d; best = cards[i]; }
    }
    best = best || cards[0];
    if (best) { setFocus(best); return true; }
    return false;
  }
  if (dir === 'down' && inEp && fromRow) {
    bottom._lastEp = state.focus;
    bottom.classList.remove('show-ep');
    bottom.classList.add('show-rel');
    return landIn(relSec, null);
  }
  if (dir === 'up' && inRel && fromRow) {
    bottom.classList.remove('show-rel');
    bottom.classList.add('show-ep');
    return landIn(epSec, bottom._lastEp);
  }
  return false;
}

/* Details screen with the remote or the keyboard: down from Reproducir /
   Cambiar fuente (or any button of that row) to the episodes or the
   recommendations, then up again, comes back to that same button, not to
   "Leer más", which can sit nearer on screen. Up from inside the lower part
   only leaves it from its top line. True when it handled the key. */
function detailBackToButtons(dir) {
  if (!window.OPENTV_DESKTOP || state.screen !== 'detail' || !detailButtons || !detailBottom) { return false; }
  var node = state.focus;
  if (dir === 'down' && detailButtons.contains(node)) {
    detailButtons._last = node;
    return false;
  }
  if (dir !== 'up' || !detailBottom.contains(node)) { return false; }
  var myTop = node.getBoundingClientRect().top;
  var items = detailBottom.querySelectorAll('.focusable');
  for (var i = 0; i < items.length; i++) {
    if (items[i] === node || !isVisible(items[i])) { continue; }
    var r = items[i].getBoundingClientRect();
    if (r.width && r.height && r.bottom <= myTop + 4) { return false; }
  }
  var target = detailButtons._last;
  if (!target || !target.isConnected || !isVisible(target)) {
    target = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"]') || firstIn(detailButtons);
  }
  if (!target || !isVisible(target)) { return false; }
  setFocus(target);
  return true;
}

/* Details screen: left/right along the buttons go one by one, in order.
   Measuring positions skipped "Cambiar fuente", which is joined to
   Reproducir (left from it did nothing, right from Reproducir jumped over
   it). True when it handled the key. */
function detailButtonsRowMove(dir) {
  if (state.screen !== 'detail' || !detailButtons || (dir !== 'left' && dir !== 'right')) { return false; }
  if (!detailButtons.contains(state.focus)) { return false; }
  var all = detailButtons.querySelectorAll('.focusable');
  var row = [];
  for (var i = 0; i < all.length; i++) { if (isVisible(all[i])) { row.push(all[i]); } }
  var at = row.indexOf(state.focus);
  if (at === -1) { return false; }
  var next = row[at + (dir === 'right' ? 1 : -1)];
  if (next) { setFocus(next); }
  return true;
}

/* The player's option menus (the sheet "Audio, subtítulos y más" and the
   "Audio y subtítulos" dialog) move line by line: left/right stay on the
   line (they used to jump to an option of another line), up/down go to the
   next line and land on its chosen option. True when it handled the key. */
function playerMenuLines() {
  var lines = [];
  function add(node) { if (node && isVisible(node) && firstIn(node)) { lines.push(node); } }
  if (dialogPlaySettingsOpen && dialogPlaySettings) {
    var drows = dialogPlaySettings.querySelectorAll('.dps-row');
    for (var d = 0; d < drows.length; d++) { add(drows[d]); }
    if (dpsBtnExit && isVisible(dpsBtnExit)) { lines.push(dpsBtnExit); }
    return lines;
  }
  if (playSettingViewOpen && playSettingView) {
    var prows = playSettingView.querySelectorAll('.psv-row');
    for (var p = 0; p < prows.length; p++) {
      var subs = prows[p].querySelectorAll('.psv-episode-numbers, .psv-episode-ranges');
      if (subs.length) { for (var s = 0; s < subs.length; s++) { add(subs[s]); } }
      else { add(prows[p]); }
    }
  }
  return lines;
}

function playerMenuMove(dir) {
  if (state.screen !== 'player' && state.screen !== 'detail') { return false; }
  if (!dialogPlaySettingsOpen && !playSettingViewOpen) { return false; }
  var lines = playerMenuLines();
  var at = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === state.focus || lines[i].contains(state.focus)) { at = i; break; }
  }
  if (at === -1) { return false; }
  var line = lines[at];
  if (dir === 'left' || dir === 'right') {
    if (line === state.focus) { return true; }
    var all = line.querySelectorAll('.focusable');
    var opts = [];
    for (var k = 0; k < all.length; k++) { if (isVisible(all[k])) { opts.push(all[k]); } }
    var pos = opts.indexOf(state.focus);
    var next = opts[pos + (dir === 'right' ? 1 : -1)];
    if (next) { setFocus(next); }
    return true;
  }
  var to = lines[at + (dir === 'down' ? 1 : -1)];
  if (!to) { return true; }
  if (to.classList.contains('focusable')) { setFocus(to); return true; }
  var chosen = to.querySelector('.focusable.is-selected, .focusable.is-on, .focusable.is-current');
  setFocus(chosen && isVisible(chosen) ? chosen : firstIn(to));
  return true;
}

function reveal(node) {
  /* A section still sliding in reads shifted on screen (its first poster
     looked off the right edge, and the row was scrolled to "show" it).
     Measure once it has landed. */
  if (window.OPENTV_DESKTOP && !platformIsTv() && closest(node, '.home-page.is-entering')) {
    setTimeout(function () { if (state.focus === node) { reveal(node); } }, 420);
    return;
  }
  if (platformIsTv() && window.OPENTV_DESKTOP && tvReveal(node)) { return; }
  var box = closest(node, '.scrollable');
  var tvCenter = platformIsTv() && window.OPENTV_DESKTOP;
  while (box) {
    var er = node.getBoundingClientRect();
    var br = box.getBoundingClientRect();
    if (tvCenter && box.classList.contains('detail-bottom')) {
      /* TVs, details screen: it never scrolls up or down; its lower part
         shows one section at a time (tvDetailSectionMove). */
      if (box.scrollTop) { box.scrollTop = 0; }
    } else if (tvCenter && box.scrollHeight > box.clientHeight + 1) {
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
/* TVs: the section's name next to the logo at the top ("OpenTV | Películas").
   While the remote moves through the menu it shows the icon in focus, so
   the menu itself stays icons only; back in the page it shows the section
   on screen again. Only the text of one span changes. */
var tvSectionEl = null;
function syncTvSectionLabel(node) {
  if (!platformIsTv() || !window.OPENTV_DESKTOP) { return; }
  if (!tvSectionEl) {
    var brand = document.querySelector('#screen-home .home-port-credit');
    if (!brand) { return; }
    tvSectionEl = el('span', 'tv-section');
    brand.appendChild(tvSectionEl);
  }
  var tabEl = node && closest(node, '.home-tabs') ? closest(node, '.tab-item') : null;
  if (!tabEl && tabEls[state.tab]) { tabEl = tabEls[state.tab]; }
  var titleEl = tabEl ? tabEl.querySelector('.tab-title') : null;
  var label = titleEl ? titleEl.textContent : '';
  if (tvSectionEl.textContent !== label) { tvSectionEl.textContent = label; }
  tvSectionEl.classList.toggle('is-browsing', !!(node && closest(node, '.home-tabs')));
}

function syncHomeRail(node) {
  syncTvSectionLabel(node);
  /* The tab rail expands while it holds focus and collapses to icons as soon
     as the content takes focus (observed on the running app). */
  var rail = $('home-tabs');
  if (rail && node && state.screen === 'home') {
    var inRail = closest(node, '.home-tabs');
    /* Desktop: the rail always shows icon + label; the pages make room for
       it (desktop/theme.css) instead of the rail covering them. */
    var keepOpen = !!window.OPENTV_DESKTOP;
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
var focusRingVisible = !window.OPENTV_DESKTOP || platformIsTv();

function setFocusRingVisible(on) {
  on = !!on;
  if (on === focusRingVisible) { return; }
  focusRingVisible = on;
  document.body.classList.toggle('is-keyboard-nav', on);
  if (state.focus) { state.focus.classList.toggle('is-focused', on); }
}

function installFocusRingMode() {
  if (!window.OPENTV_DESKTOP || platformIsTv()) {
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
  /* "¿Quién está viendo?" or the profile editor on screen: nothing behind
     it takes the focus (screens/profiles-ui.js). */
  var overlay = profileOverlayRoot();
  if (overlay && !overlay.contains(node)) {
    if (!state.focus || !overlay.contains(state.focus)) {
      var inside = firstIn(overlay);
      if (inside && inside !== node) { setFocus(inside, true); }
    }
    return;
  }
  if (state.focus === node) {
    if (!silent) { reveal(node); }
    return;
  }
  if (state.focus) {
    state.focus.classList.remove('is-focused');
    /* (TVs: the zoom is instant now, without a layer of its own while it
       shrinks back; see "Foco" in 10-teles.css.) */
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
  if (tvDetailSectionMove(dir)) { return; }
  if (detailBackToButtons(dir)) { return; }
  if (detailButtonsRowMove(dir)) { return; }
  if (playerMenuMove(dir)) { return; }

  var inPage = state.screen === 'home' && closest(state.focus, '.home-page');
  var inSidebar = state.screen === 'home' && closest(state.focus, '.home-tabs');

  /* TVs: down from the icons at the top (Buscar, Mi lista, perfil) goes to
     the top of the section on screen (the hero's Reproducir), not to the
     nearest poster on screen, which could be in any row, even one
     scrolled out of view (the focus seemed lost). */
  if (dir === 'down' && platformIsTv() && state.screen === 'home' && closest(state.focus, '.home-notify')) {
    var curPage = TABS[state.tab] ? pages[TABS[state.tab].page] : null;
    var top = curPage ? firstIn(curPage) : null;
    if (top) { setFocus(top); return; }
  }
  /* (Not on TV en vivo: preview, channel list and controls sit side by side
     there, so moves across them must stay free.) */
  var tvRowNav = !!inPage && platformIsTv() && !!window.OPENTV_DESKTOP && inPage !== pages[0];

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

  if (window.OPENTV_DESKTOP && !platformIsTv() && dir === 'up' && inPage) {
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    return;
  }
  /* Leftmost limit reached in page content: now focus sidebar tab (the TV
     menu on the left). */
  if (dir === 'left' && inPage && (!window.OPENTV_DESKTOP || platformIsTv())) {
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

/* Can `c` be a target from the current focus at all (menu / page rules)? */
function focusCandidateAllowed(c, inPage, inSidebar) {
  if (c === state.focus) { return false; }
  /* Don't let sidebar tabs intercept left navigation while inside page content */
  if (inPage && closest(c, '.home-tabs')) { return false; }
  /* Desktop: from the page, up goes to the tab bar, not the icons. */
  if (inPage && window.OPENTV_DESKTOP && !platformIsTv() && closest(c, '.home-notify')) { return false; }
  /* Don't let page content intercept navigation while inside sidebar tabs */
  if (inSidebar && !closest(c, '.home-tabs')) { return false; }
  return true;
}

/* TVs: the remote moves only to what is really in that direction.
   Up/down: the nearest line above/below (the elements level with the
   nearest one), and on it the one most in line horizontally.
   Left/right: only the same line (elements level with the focus), the
   nearest one on that side. Never diagonally to another line. */
var TV_NAV_REGIONS = '.settings-right, .settings-menu, .live-side, .live-bar3a, .search-keyboard, ' +
  '.search-hot, .search-results, .lg-cats, .lg-grid, .tvk-panel, .detail-bottom, .season-popup, .live-cat-menu';
/* Blocks that sit side by side with another (menu and panel, keyboard and
   results…): up/down never leave them diagonally. */
var TV_NAV_COLUMNS = '.settings-right, .settings-menu, .live-side, .search-keyboard, .search-hot, ' +
  '.search-results, .lg-cats, .lg-grid, .tvk-panel';
function pickTvFocusTarget(list, dir, fr, fx, inPage, inSidebar) {
  var TOL = 3;
  var cands = [];
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!focusCandidateAllowed(c, inPage, inSidebar)) { continue; }
    var r = c._visRect || c.getBoundingClientRect();
    var ok;
    if (dir === 'up') { ok = r.bottom <= fr.top + TOL; }
    else if (dir === 'down') { ok = r.top >= fr.bottom - TOL; }
    else {
      ok = r.bottom > fr.top + TOL && r.top < fr.bottom - TOL &&
        (dir === 'left' ? r.right <= fr.left + TOL : r.left >= fr.right - TOL);
    }
    if (ok) { cands.push({ c: c, r: r }); }
  }
  if (!cands.length) { return null; }
  var best = null, bestKey = 1e9, bestTie = 1e9;
  if (dir === 'left' || dir === 'right') {
    for (var h = 0; h < cands.length; h++) {
      var rh = cands[h].r;
      var gap = dir === 'left' ? fr.left - rh.right : rh.left - fr.right;
      var tie = Math.abs((rh.top + rh.bottom) / 2 - (fr.top + fr.bottom) / 2);
      if (gap < bestKey - 0.5 || (Math.abs(gap - bestKey) <= 0.5 && tie < bestTie)) { bestKey = gap; bestTie = tie; best = cands[h].c; }
    }
    return best;
  }
  /* First the block the focus is in (Ajustes' panel or menu, the channel
     column, the keyboard, the results, the lower part of a title's page…):
     in Ajustes, down from a tab went to the menu on the left, a little
     lower. Only when nothing is there in that direction, the whole screen. */
  var region = closest(state.focus, TV_NAV_REGIONS);
  var pool = cands;
  if (region) {
    var inside = [];
    for (var q = 0; q < cands.length; q++) { if (region.contains(cands[q].c)) { inside.push(cands[q]); } }
    if (inside.length) { pool = inside; }
    else if (region.matches && region.matches(TV_NAV_COLUMNS)) {
      /* Leaving a column that has another one beside it: only straight up
         or down (the end of Ajustes' panel jumped diagonally to the menu on
         the left). Other blocks (the lower part of a title's page) go on
         to the nearest line, like the buttons above the seasons. */
      var column = [];
      for (var w = 0; w < cands.length; w++) {
        var rw = cands[w].r;
        if (rw.right > fr.left + TOL && rw.left < fr.right - TOL) { column.push(cands[w]); }
      }
      if (!column.length) { return null; }
      pool = column;
    }
  }
  /* The nearest line in that direction: the nearest element, and every
     element level with it. */
  var near = null, nearGap = 1e9;
  for (var n = 0; n < pool.length; n++) {
    var rn = pool[n].r;
    var g = dir === 'up' ? fr.top - rn.bottom : rn.top - fr.bottom;
    if (g < nearGap) { nearGap = g; near = rn; }
  }
  for (var k = 0; k < pool.length; k++) {
    var rk = pool[k].r;
    if (!(rk.bottom > near.top + TOL && rk.top < near.bottom - TOL)) { continue; }
    /* Most in line: overlapping the focus horizontally first, then the
       nearest centre. */
    var overlapX = rk.right > fr.left + TOL && rk.left < fr.right - TOL;
    var dist = Math.abs((rk.left + rk.right) / 2 - fx) + (overlapX ? 0 : 10000);
    if (dist < bestKey) { bestKey = dist; best = pool[k].c; }
  }
  return best;
}

/* Spatial navigation: the best candidate of `list` in direction `dir`. */
function pickFocusTarget(list, dir, fr, fx, fy, inPage, inSidebar, tvRowNav) {
  if (platformIsTv()) { return pickTvFocusTarget(list, dir, fr, fx, inPage, inSidebar); }
  var best = null;
  var bestScore = 1e9;
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (!focusCandidateAllowed(c, inPage, inSidebar)) { continue; }

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
