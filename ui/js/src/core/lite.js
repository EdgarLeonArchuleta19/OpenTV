/* core/lite.js — Modo ligero: menos efectos para equipos modestos (PC, TV, Fire TV).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* "Modo ligero" turns off the costly effects (background blur, the slow
   zoom of the big image, entrance animations, the enlarged card on hover)
   so menus stay fluid on modest hardware. Off by default on the PC, where
   it is chosen in Mi cuenta → Apariencia; it is shared by all profiles. */
var LITE_KEY = 'opentv_lite_mode_v1';

function liteMode() {
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(LITE_KEY) || 'null'); } catch (eRead) { saved = null; }
  if (saved === true || saved === false) { return saved; }
  return false;
}

function applyLiteMode() {
  if (document.body) { document.body.classList.toggle('is-lite', liteMode()); }
}

function setLiteMode(on) {
  try { localStorage.setItem(LITE_KEY, JSON.stringify(!!on)); } catch (eSave) { /* storage off */ }
  applyLiteMode();
}
