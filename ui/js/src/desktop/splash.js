/* desktop/splash.js — Pantalla de arranque: el nombre de OpenTV mientras se prepara el inicio (sin logo grande).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Covers the window from the very first frame and fades out once the home
   screen is built (at least a short moment, so it never just flickers). */
var SPLASH_MIN_MS = 1100;
var SPLASH_MAX_MS = 8000;

function showBootSplash() {
  /* index.html already has it from the first frame; built here only if not. */
  var splash = $('boot-splash');
  if (!window.XUPER_DESKTOP) {
    if (splash && splash.parentNode) { splash.parentNode.removeChild(splash); }
    return;
  }
  if (splash && splash._running) { return; }
  var started = Date.now();
  if (!splash) {
    splash = el('div', 'boot-splash');
    splash.id = 'boot-splash';
    splash.appendChild(el('div', 'bs-name', 'OpenTV'));
    splash.appendChild(el('div', 'bs-sub', 'Preparando tu catálogo…'));
    document.body.appendChild(splash);
  }
  splash._running = true;
  function done() {
    if (!splash.parentNode) { return; }
    splash.classList.add('is-leaving');
    setTimeout(function () { if (splash.parentNode) { splash.parentNode.removeChild(splash); } }, 520);
  }
  (function wait() {
    var ready = homeBuilt && state.screen !== 'welcome';
    var elapsed = Date.now() - started;
    if ((ready && elapsed >= SPLASH_MIN_MS) || elapsed >= SPLASH_MAX_MS) { done(); return; }
    setTimeout(wait, 120);
  })();
}
