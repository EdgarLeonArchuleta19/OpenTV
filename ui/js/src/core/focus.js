/* core/focus.js — Motor de foco: visibilidad, enfoque, scroll al foco y navegación espacial con flechas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------ focus core */
function isVisible(node) {
  if (!node || !node.getBoundingClientRect) { return false; }
  if (node.disabled || node.getAttribute('aria-disabled') === 'true') { return false; }
  if (node.offsetParent === null) { return false; }
  var r = node.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) { return false; }
  if (historyDrawerOpen) { return !!closest(node, '.history-drawer'); }
  if (dialogAddonsOpen) { return !!closest(node, '#dialog-addons'); }
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
  var nodes = document.querySelectorAll('.focusable');
  var out = [];
  for (var i = 0; i < nodes.length; i++) {
    if (isVisible(nodes[i])) { out.push(nodes[i]); }
  }
  return out;
}

function reveal(node) {
  var box = closest(node, '.scrollable');
  while (box) {
    var er = node.getBoundingClientRect();
    var br = box.getBoundingClientRect();
    if (er.top < br.top) {
      box.scrollTop -= (br.top - er.top) + 12;
    } else if (er.bottom > br.bottom) {
      box.scrollTop += (er.bottom - br.bottom) + 12;
    }
    if (box.scrollWidth > box.clientWidth + 1) {
      if (er.left < br.left) {
        box.scrollLeft -= (br.left - er.left) + 12;
      } else if (er.right > br.right) {
        box.scrollLeft += (er.right - br.right) + 12;
      }
    }
    box = closest(box.parentNode, '.scrollable');
  }
}

/* Desktop: the focus ring (white frame + zoom) is shown only while the
   keyboard is being used, like Windows does. With the mouse, the current
   element is still tracked, just not highlighted. The TV always shows it. */
var focusRingVisible = !window.XUPER_DESKTOP;

function setFocusRingVisible(on) {
  on = !!on;
  if (on === focusRingVisible) { return; }
  focusRingVisible = on;
  document.body.classList.toggle('is-keyboard-nav', on);
  if (state.focus) { state.focus.classList.toggle('is-focused', on); }
}

function installFocusRingMode() {
  if (!window.XUPER_DESKTOP) { return; }
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
  if (state.focus) { state.focus.classList.remove('is-focused'); }
  state.focus = node;
  if (focusRingVisible) { node.classList.add('is-focused'); }
  if (node._onFocus) { node._onFocus(); }
  renderPlaySettingRowFocus();
  /* The tab rail expands while it holds focus and collapses to icons as soon
     as the content takes focus (observed on the running app). */
  var rail = $('home-tabs');
  if (rail && state.screen === 'home') {
    var inRail = closest(node, '.home-tabs');
    /* Desktop: the rail always shows icon + label; the pages make room for
       it (desktop/theme.css) instead of the rail covering them. */
    var keepOpen = !!window.XUPER_DESKTOP;
    rail.classList.toggle('is-expanded', keepOpen || !!inRail);
    rail.classList.toggle('is-collapsed', !keepOpen && !inRail);
    var railBg = document.querySelector('.home-sidebar-bg');
    if (railBg) { railBg.classList.toggle('is-on', !keepOpen && !!inRail); }
    var homeScreen = $('screen-home');
    if (homeScreen) { homeScreen.classList.toggle('is-rail-open', !keepOpen && !!inRail); }
  }
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
  if (!state.focus) {
    var f = focusables();
    if (f.length) { setFocus(f[0]); }
    return;
  }
  if (state.focus._onMove && state.focus._onMove(dir)) { return; }

  var inPage = state.screen === 'home' && closest(state.focus, '.home-page');
  var inSidebar = state.screen === 'home' && closest(state.focus, '.home-tabs');

  var list = focusables();
  var fr = state.focus.getBoundingClientRect();
  var fx = fr.left + fr.width / 2;
  var fy = fr.top + fr.height / 2;
  var best = null;
  var bestScore = 1e9;

  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c === state.focus) { continue; }
    /* Don't let sidebar tabs intercept left navigation while inside page content */
    if (inPage && closest(c, '.home-tabs')) { continue; }
    /* Don't let page content intercept navigation while inside sidebar tabs */
    if (inSidebar && !closest(c, '.home-tabs')) { continue; }

    var r = c.getBoundingClientRect();
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
    } else if (dir === 'right') {
      if (dx < 4) { continue; }
      primary = Math.max(0, r.left - fr.right);
      secondary = Math.abs(dy);
      overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
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

  if (best) {
    setFocus(best);
    return;
  }

  /* Leftmost limit reached in page content: now focus sidebar tab */
  if (dir === 'left' && inPage) {
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
  }
}
