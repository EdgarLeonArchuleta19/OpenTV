/* core/config.js — Configuración estática: canales, pestañas del inicio y menú de ajustes.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Live TV is portal-driven.  Do not draw fictitious rows while the local
   service starts: they looked like real channels until the user left and
   returned to the TV tab. */
var CHANNELS = [];

/* Tab order and labels observed on the running app (WSA, 1920x1080).
   The APK builds this list from its backend, so the icon artwork is not a
   drawable in the APK; these glyphs are reconstructions of the observed
   shapes (documented in DIFERENCIAS_PENDIENTES.md). */
var TAB_ICONS = {
  tv: '<svg viewBox="0 0 33 33"><rect x="3.5" y="7" width="26" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M11 24.5v3h11v-3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
  thumb: '<svg viewBox="0 0 33 33"><path d="M12 15.5V28H7.6A2.6 2.6 0 0 1 5 25.4v-7.3a2.6 2.6 0 0 1 2.6-2.6H12z" fill="currentColor"/><path d="M14 15.6l4.3-9.2a2.2 2.2 0 0 1 4 1.6V13h5.6a2.9 2.9 0 0 1 2.8 3.6l-2 9A3.4 3.4 0 0 1 25.4 28H14z" fill="currentColor"/></svg>',
  film: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16.5" cy="16.5" r="2.4" fill="currentColor"/><circle cx="16.5" cy="9.5" r="2.1" fill="currentColor"/><circle cx="16.5" cy="23.5" r="2.1" fill="currentColor"/><circle cx="9.5" cy="16.5" r="2.1" fill="currentColor"/><circle cx="23.5" cy="16.5" r="2.1" fill="currentColor"/></svg>',
  strip: '<svg viewBox="0 0 33 33"><rect x="4" y="7" width="25" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9 7v19M24 7v19" stroke="currentColor" stroke-width="1.8"/><rect x="5.6" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="21.4" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="21.4" width="2.4" height="2.6" fill="currentColor"/></svg>',
  kids: '<svg viewBox="0 0 33 33"><circle cx="8.6" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="24.4" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="16.5" cy="18" r="9.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="13" cy="17" r="1.5" fill="currentColor"/><circle cx="20" cy="17" r="1.5" fill="currentColor"/><ellipse cx="16.5" cy="21.6" rx="2.4" ry="1.7" fill="currentColor"/></svg>',
  anime: '<svg viewBox="0 0 33 33"><circle cx="8.5" cy="9" r="4.5" fill="currentColor"/><circle cx="24.5" cy="9" r="4.5" fill="currentColor"/><path d="M16.5 9c5.8 0 10.5 4.6 10.5 10.3 0 5.7-4.7 9.7-10.5 9.7S6 25 6 19.3C6 13.6 10.7 9 16.5 9z" fill="currentColor"/><circle cx="12.5" cy="18" r="1.6" fill="#0b0b0b"/><circle cx="20.5" cy="18" r="1.6" fill="#0b0b0b"/><ellipse cx="16.5" cy="23" rx="3" ry="2" fill="#0b0b0b"/></svg>',
  compass: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M22 11l-3.2 7.8L11 22l3.2-7.8z" fill="currentColor"/></svg>',
  novel: '<svg viewBox="0 0 33 33"><path d="M5 6.5h9.5c2.2 0 3.7 1 4.5 2.3.8-1.3 2.3-2.3 4.5-2.3H28v20h-5.5c-2.1 0-3.4.6-4.5 1.8-1.1-1.2-2.4-1.8-4.5-1.8H5z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M18 9v19" stroke="currentColor" stroke-width="2.2"/></svg>',
  history: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="17" r="10.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16.5 10.5V17l5 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M8 7v6h6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>'
};

var TABS = [
  { label: 'TV', page: 0, icon: 'tv' },
  { label: 'DESTACADOS', page: 1, icon: 'thumb' },
  { label: 'PELICULA', page: 2, icon: 'film' },
  { label: 'SERIES', page: 3, icon: 'strip' },
  { label: 'KIDS', page: 4, icon: 'kids' },
  { label: 'ANIME', page: 5, icon: 'anime' },
  { label: 'NOVELAS', page: 6, icon: 'novel' },
  { label: 'EXPLORAR', page: 7, icon: 'compass' },
  { label: 'HISTORIAL', page: -1, icon: 'history', action: 'history' }
];
/* Desktop: Novelas and Explorar are dropped, and history has its own button
   (and lives in Mi lista), so the rail only lists the main catalogues. */
if (window.XUPER_DESKTOP) {
  TABS = TABS.filter(function (t) { return t.icon !== 'novel' && t.icon !== 'compass' && t.action !== 'history'; });
  /* Top bar labels, like the big streaming apps. */
  var DESKTOP_TAB_LABELS = { 'TV': 'TV en vivo', 'DESTACADOS': 'Inicio', 'PELICULA': 'Películas', 'SERIES': 'Series', 'KIDS': 'Kids', 'ANIME': 'Anime' };
  TABS.forEach(function (t) { if (DESKTOP_TAB_LABELS[t.label]) { t.label = DESKTOP_TAB_LABELS[t.label]; } });
  /* A kids profile only sees Kids (no TV, no Inicio or Anime, which also
     carry titles for adults). */
  if (isKidsProfile()) { TABS = TABS.filter(function (t) { return t.page === 4; }); }
}

var SETTINGS_ITEMS = [
  { id: 'profile', label: 'Mi cuenta' },
  { id: 'history', label: 'Mi lista' },
  { id: 'share', label: 'Compartir APP' },
  { id: 'parent', label: 'Bloqueo' },
  { id: 'playback', label: 'Configuración global' },
  { id: 'sources', label: 'Fuentes' },
  { id: 'netdiag', label: 'Diagnóstico' },
  { id: 'feedback', label: 'Ayuda y Feedback' },
  { id: 'about', label: 'Sobre nosotros' }
];

var SETTINGS_MENU_ICONS = {
  profile: '<svg viewBox="0 0 32 32"><circle cx="16" cy="10" r="5"/><path d="M6 27c.7-6 4.3-9 10-9s9.3 3 10 9"/></svg>',
  history: '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="9" height="9"/><rect x="19" y="4" width="9" height="9"/><rect x="4" y="19" width="9" height="9"/><rect x="19" y="19" width="9" height="9"/></svg>',
  share: '<svg viewBox="0 0 32 32"><circle cx="8" cy="16" r="3"/><circle cx="24" cy="7" r="3"/><circle cx="24" cy="25" r="3"/><path d="M10.6 14.5l10.8-6M10.6 17.5l10.8 6"/></svg>',
  parent: '<svg viewBox="0 0 32 32"><rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V10a5 5 0 0 1 10 0v4"/><path d="M16 19v4"/></svg>',
  playback: '<svg viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="3"/><path d="M13 11l8 5-8 5z"/></svg>',
  sources: '<svg viewBox="0 0 32 32"><path d="M16 4l12 6-12 6L4 10l12-6z"/><path d="M4 16l12 6 12-6"/><path d="M4 22l12 6 12-6"/></svg>',
  netdiag: '<svg viewBox="0 0 32 32"><path d="M3 13a19 19 0 0 1 26 0"/><path d="M8 18a12 12 0 0 1 16 0"/><path d="M13 23a6 6 0 0 1 6 0"/><circle cx="16" cy="27.5" r="1.2"/></svg>',
  feedback: '<svg viewBox="0 0 32 32"><path d="M6 4h15l5 5v19H6z"/><path d="M20 4v6h6M10 16h12M10 21h8"/></svg>',
  about: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/><path d="M16 14v8M16 10h.1"/></svg>'
};

/* Desktop: short labels that fit the menu and line icons like the rest of the app. */
if (window.XUPER_DESKTOP) {
  var DESKTOP_SETTINGS_LABELS = { share: 'Compartir', playback: 'Reproducción', sources: 'Fuentes', feedback: 'Ayuda', about: 'Acerca de' };
  /* The PIN lock was never available on Windows: no menu entry for it. */
  SETTINGS_ITEMS = SETTINGS_ITEMS.filter(function (it) { return it.id !== 'parent'; });
  SETTINGS_ITEMS.forEach(function (it) { if (DESKTOP_SETTINGS_LABELS[it.id]) { it.label = DESKTOP_SETTINGS_LABELS[it.id]; } });
  SETTINGS_MENU_ICONS = {
    profile: UI_ICONS.user, history: UI_ICONS.mylist, share: UI_ICONS.share, parent: UI_ICONS.lock,
    playback: UI_ICONS.settings, sources: UI_ICONS.addons, netdiag: UI_ICONS.wifi, feedback: UI_ICONS.help, about: UI_ICONS.info
  };
}
