/* desktop/window.js — Pantalla completa de Windows, clic/doble clic y cierre de paneles del reproductor.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Mouse gestures on the video (desktop):
     - one click: the usual action (pause/play), after a short wait so a
       double click does not pause and resume the video;
     - double click anywhere: Windows full screen on/off;
     - press and hold on the left/right third (VOD only): fast rewind /
       forward. A counter grows while held and ONE seek is made on release
       (each seek restarts the stream in Modo fluido).
   ------------------------------------------------------------------ */
var DOUBLE_CLICK_MS = 260;
var HOLD_START_MS = 400;

var _desktopFullscreen = null;
if (window.desktop) {
  if (typeof window.desktop.onFullscreenChanged === 'function') {
    window.desktop.onFullscreenChanged(function (isFull) {
      _desktopFullscreen = !!isFull;
      var fsBtn = $('vod-fullscreen');
      if (fsBtn) { fsBtn.textContent = _desktopFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'; }
    });
  }
  if (typeof window.desktop.fullscreen === 'function') {
    try {
      var q = window.desktop.fullscreen('query');
      if (q && typeof q.then === 'function') {
        q.then(function (isFull) { _desktopFullscreen = !!isFull; }).catch(function () {});
      }
    } catch (eFs) {}
  }
}
function isWindowFullscreen() {
  if (_desktopFullscreen !== null) { return _desktopFullscreen; }
  return Math.abs(window.outerWidth - screen.width) < 3 && Math.abs(window.outerHeight - screen.height) < 3;
}
function setWindowFullscreen(on) {
  if (!window.desktop || !window.desktop.fullscreen) { return; }
  _desktopFullscreen = !!on;
  window.desktop.fullscreen(!!on);
}

function formatSeekAmount(sec) {
  sec = Math.round(Math.abs(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  return m ? (m + ':' + (s < 10 ? '0' : '') + s) : (s + ' s');
}

/* Click / double click on an element, with the single action delayed. */
function bindClickGestures(node, single, double) {
  var timer = null;
  node.addEventListener('click', function (event) {
    if (node._suppressClick) { node._suppressClick = false; event.stopPropagation(); return; }
    event.stopPropagation();
    if (closePlayerPanels()) { return; }
    if (state.focus !== node && isVisible(node)) { setFocus(node, true); }
    if (timer) {
      clearTimeout(timer);
      timer = null;
      double(event);
      return;
    }
    timer = setTimeout(function () { timer = null; single(event); }, DOUBLE_CLICK_MS);
  }, true);
}

/* Closes the episodes or settings panel if one is open. A click outside
   a panel only closes it: it never pauses or opens anything else. */
function closePlayerPanels() {
  if (state.episodeBrowserOpen) { closeEpisodeBrowser(); return true; }
  if (playSettingViewOpen) { closePlaySettingView(); return true; }
  return false;
}

function panelCloseButton(title) {
  var b = el('div', 'panel-close focusable');
  b.title = title;
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  b._activate = closePlayerPanels;
  return b;
}

function installPanelDismiss() {
  var view = $('player-playsetting-view');
  var scroll = $('psv-scroll');
  if (view && !view._dismiss) {
    view._dismiss = true;
    /* The settings layer covers the whole video; only its lower sheet is
       content. A click on the rest closes it. */
    view.addEventListener('click', function (event) {
      if (scroll && scroll.contains(event.target)) { return; }
      event.stopPropagation();
      closePlaySettingView();
    });
    if (scroll) { scroll.appendChild(panelCloseButton('Cerrar ajustes (Esc)')); }
  }
  var eps = $('player-episodes');
  if (eps && !eps._dismiss) {
    eps._dismiss = true;
    eps.appendChild(panelCloseButton('Cerrar episodios (Esc)'));
  }
}
