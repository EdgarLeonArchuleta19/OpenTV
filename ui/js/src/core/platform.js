/* core/platform.js — Acceso a la plataforma (ver ui/js/platform.js).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* window.XUPER_DESKTOP means "the new interface" and is on everywhere.
   What only some devices can do (a window of its own, a mouse, the
   system volume...) is asked here instead. */
function platformName() {
  return window.OPENTV_PLATFORM ? window.OPENTV_PLATFORM.name : 'browser';
}
function platformHas(cap) {
  return !!(window.OPENTV_PLATFORM && window.OPENTV_PLATFORM.has(cap));
}
function platformIsTv() {
  return !!(window.OPENTV_PLATFORM && window.OPENTV_PLATFORM.tv);
}
