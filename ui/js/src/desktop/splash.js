/* desktop/splash.js — Pantalla de arranque: la tele de OpenTV animada mientras se prepara el inicio.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Covers the window from the very first frame and fades out once the home
   screen is built (at least a short moment, so it never just flickers). */
var SPLASH_MIN_MS = 1100;
var SPLASH_MAX_MS = 8000;

function showBootSplash() {
  if (!window.XUPER_DESKTOP || $('boot-splash')) { return; }
  var started = Date.now();
  var splash = el('div', 'boot-splash');
  splash.id = 'boot-splash';
  var logo = el('div', 'bs-logo');
  splash.appendChild(logo);
  splash.appendChild(el('div', 'bs-name', 'OpenTV'));
  splash.appendChild(el('div', 'bs-sub', 'Preparando tu catálogo…'));
  document.body.appendChild(splash);
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
