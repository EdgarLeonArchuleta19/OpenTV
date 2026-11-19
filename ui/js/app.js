/* =============================================================================
   OpenTV — interfaz (Windows, Android, Android TV y Fire TV)
   ARCHIVO GENERADO por scripts/build-app.cjs: no lo edites a mano.
   El código fuente está en ui/js/src/ (orden en ui/js/src/modules.json).
   ============================================================================= */
(function () {
  'use strict';

  /* ---- core/utils.js --------------------------------------------------------- */
  /* core/utils.js — Utilidades DOM y de texto: el(), $(), clear(), abs(), closest(), norm()…
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------------ utils */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
  function abs(n, x, y, w, h) {
    n.style.position = 'absolute';
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    if (w !== undefined) { n.style.width = w + 'px'; }
    if (h !== undefined) { n.style.height = h + 'px'; }
    return n;
  }
  function closest(node, sel) {
    /* Native Element.closest (Chromium 41+, so every TV we target): the focus
       engine calls this thousands of times per key press. */
    if (node && node.nodeType !== 1) { node = node.parentNode; }
    if (node && node.nodeType === 1 && node.closest) { return node.closest(sel); }
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) { return node; }
      node = node.parentNode;
    }
    return null;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function norm(s) {
    s = String(s).toLowerCase();
    if (s.normalize) {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return s;
  }

  /* norm() of an item's title/alias, kept on the item. Search and its
     suggestions read every catalogue title on each letter; NFD over thousands
     of titles is slow on a Fire TV. Not enumerable, so it never ends up in a
     saved catalogue. */
  function itemNorm(item, field) {
    if (!item) { return ''; }
    var src = item[field] ? String(item[field]) : '';
    var cache = item.__norm;
    if (!cache) {
      cache = {};
      try { Object.defineProperty(item, '__norm', { value: cache, enumerable: false, writable: true }); }
      catch (eDefine) { return src ? norm(src) : ''; }
    }
    if (cache[field + '$'] !== src) { cache[field + '$'] = src; cache[field] = src ? norm(src) : ''; }
    return cache[field];
  }

  /* ---- core/platform.js ------------------------------------------------------ */
  /* core/platform.js — Acceso a la plataforma (ver ui/js/platform.js).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* window.OPENTV_DESKTOP means "the new interface" and is on everywhere.
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

  /* ---- core/profiles.js ------------------------------------------------------ */
  /* core/profiles.js — Perfiles locales (como en Netflix): lista, perfil activo y avatares.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Everything stays on this computer. Each profile keeps its own history,
     Mi lista, searches, TV favourites/recents, preferences and private
     setting: those storage keys get the profile id appended ("key@p3"). The
     first profile ("main") keeps the original keys, so the data that existed
     before profiles is simply that profile's. The active profile is chosen
     before the rest of the app loads (the app reloads to switch). */
  var PROFILES_KEY = 'opentv_profiles_v1';
  var ACTIVE_PROFILE_SESSION = 'opentv_active_profile';
  var PROFILES_MAX = 6;
  var PROFILE_SCOPED_KEYS = [
    'opentv_local_profile_v1', 'opentv_global_playback_v1', 'opentv_recent_searches_v1',
    'opentv_live_saved_v1', 'opentv_catalog_density_v1'
  ];

  function readProfiles() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null'); } catch (eRead) { data = null; }
    if (!data || !data.list || !data.list.length) {
      data = { list: [{ id: 'main', name: 'Mi usuario', avatar: 0, kids: false, createdAt: Date.now() }], last: 'main', created: false };
    }
    return data;
  }

  var profilesData = readProfiles();
  var activeProfileId = (function () {
    var chosen = null;
    try { chosen = sessionStorage.getItem(ACTIVE_PROFILE_SESSION); } catch (eSession) { chosen = null; }
    var want = chosen || profilesData.last || 'main';
    for (var i = 0; i < profilesData.list.length; i++) { if (profilesData.list[i].id === want) { return want; } }
    return profilesData.list[0].id;
  })();
  /* True when this start-up already went through the profile picker. */
  var profileChosenThisSession = (function () {
    try { return !!sessionStorage.getItem(ACTIVE_PROFILE_SESSION); } catch (eSession) { return false; }
  })();

  function activeProfile() {
    for (var i = 0; i < profilesData.list.length; i++) {
      if (profilesData.list[i].id === activeProfileId) { return profilesData.list[i]; }
    }
    return profilesData.list[0];
  }
  function isKidsProfile() { return !!(window.OPENTV_DESKTOP && activeProfile().kids); }

  function profileKey(key) {
    if (!window.OPENTV_DESKTOP || activeProfileId === 'main' || PROFILE_SCOPED_KEYS.indexOf(key) === -1) { return key; }
    return key + '@' + activeProfileId;
  }

  function saveProfiles() {
    try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesData)); } catch (eSave) { /* storage full */ }
    if (typeof scheduleProfilesBackup === 'function') { scheduleProfilesBackup(); }
  }

  /* Switches profile: remember the choice for this session and reload, so
     every module starts with that profile's data. */
  function switchToProfile(id) {
    profilesData.last = id;
    saveProfiles();
    try { sessionStorage.setItem(ACTIVE_PROFILE_SESSION, id); } catch (eSession) { /* private mode */ }
    if (id === activeProfileId) { return false; }
    location.reload();
    return true;
  }

  /* ------------------------------------------------------------- tabs */
  /* Where the app starts and where Esc on the home screen goes: Inicio on
     desktop (Kids for a kids profile), TV on the TV set. */
  function homeTabIndex() {
    if (!window.OPENTV_DESKTOP) { return 0; }
    var want = isKidsProfile() ? 4 : 1;
    for (var i = 0; i < TABS.length; i++) { if (TABS[i].page === want) { return i; } }
    return 0;
  }
  function onTvTab() { var t = TABS[state.tab]; return !!t && t.page === 0; }

  /* ----------------------------------------------------------- avatars */
  /* Drawn avatars: a coloured tile and a simple face. New ones go at the end
     (profiles keep their avatar by its index). */
  var AVATARS = [
    { a: '#3a7bff', b: '#8a4dff', face: 'smile' },
    { a: '#ff5f6d', b: '#ffc371', face: 'cat' },
    { a: '#11998e', b: '#38ef7d', face: 'robot' },
    { a: '#f7b733', b: '#fc4a1a', face: 'star' },
    { a: '#ff6fd8', b: '#3813c2', face: 'bunny' },
    { a: '#00c6ff', b: '#0072ff', face: 'alien' },
    { a: '#232526', b: '#5b5e62', face: 'tv' },
    { a: '#ff9a44', b: '#fc6076', face: 'fox' },
    { a: '#7f53ac', b: '#647dee', face: 'ghost' },
    { a: '#e52d27', b: '#b31217', face: 'love' },
    { a: '#141e30', b: '#3a6186', face: 'planet' },
    { a: '#a8e063', b: '#56ab2f', face: 'frog' },
    { a: '#8e5a2b', b: '#c48a4a', face: 'bear' },
    { a: '#3e3e46', b: '#8a8a96', face: 'panda' },
    { a: '#b06ab3', b: '#4568dc', face: 'owl' },
    { a: '#1e3c72', b: '#2a5298', face: 'penguin' },
    { a: '#56ab2f', b: '#1d976c', face: 'dino' },
    { a: '#f12711', b: '#f5af19', face: 'cool' },
    { a: '#ec008c', b: '#fc6767', face: 'wink' },
    { a: '#0f2027', b: '#2c5364', face: 'ninja' },
    { a: '#8e0e00', b: '#1f1c18', face: 'pirate' },
    { a: '#f7971e', b: '#ffd200', face: 'crown' },
    { a: '#e53935', b: '#e35d5b', face: 'popcorn' },
    { a: '#7b4397', b: '#dc2430', face: 'monster' }
  ];

  var avatarSvgSeq = 0;
  function avatarSvg(index) {
    var av = AVATARS[(index >>> 0) % AVATARS.length];
    /* A unique gradient id per drawing: copies of one id clash. */
    var g = 'av' + index + '-' + (++avatarSvgSeq);
    var eyes = '<circle cx="36" cy="44" r="6" fill="#fff"/><circle cx="64" cy="44" r="6" fill="#fff"/>';
    var mouth = '<path d="M36 64c8 8 20 8 28 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
    var extra = '';
    switch (av.face) {
      case 'cat': extra = '<path d="M20 30 26 8l14 14M80 30 74 8 60 22" fill="#fff" opacity=".9"/>'; break;
      case 'robot':
        eyes = '<rect x="28" y="38" width="14" height="12" rx="3" fill="#fff"/><rect x="58" y="38" width="14" height="12" rx="3" fill="#fff"/>';
        mouth = '<rect x="34" y="62" width="32" height="7" rx="3.5" fill="#fff"/>';
        extra = '<path d="M50 22V10" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="9" r="4" fill="#fff"/>'; break;
      case 'star': extra = '<path d="M50 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="#fff" opacity=".95"/>'; break;
      case 'bunny': extra = '<rect x="30" y="2" width="11" height="28" rx="5.5" fill="#fff" opacity=".9"/><rect x="59" y="2" width="11" height="28" rx="5.5" fill="#fff" opacity=".9"/>'; break;
      case 'alien':
        eyes = '<ellipse cx="34" cy="46" rx="8" ry="10" fill="#fff"/><ellipse cx="66" cy="46" rx="8" ry="10" fill="#fff"/><circle cx="50" cy="30" r="5" fill="#fff"/>';
        mouth = '<path d="M42 68h16" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
      case 'tv':
        extra = '<path d="M38 12 50 22 62 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="18" y="24" width="64" height="52" rx="10" fill="none" stroke="#fff" stroke-width="4"/>';
        eyes = '<circle cx="38" cy="46" r="5" fill="#fff"/><circle cx="62" cy="46" r="5" fill="#fff"/>';
        mouth = '<path d="M40 60c6 5 14 5 20 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
      case 'fox': extra = '<path d="M16 34 22 6l22 18M84 34 78 6 56 24" fill="#fff" opacity=".85"/><path d="M44 58l6 6 6-6z" fill="#fff"/>'; mouth = ''; break;
      case 'ghost':
        extra = '<path d="M22 88V42a28 28 0 0 1 56 0v46l-9-7-10 7-9-7-10 7-9-7z" fill="#fff" opacity=".22"/>';
        eyes = '<ellipse cx="38" cy="44" rx="6" ry="8" fill="#fff"/><ellipse cx="62" cy="44" rx="6" ry="8" fill="#fff"/>';
        mouth = '<ellipse cx="50" cy="64" rx="6" ry="7" fill="#fff"/>'; break;
      case 'love':
        eyes = '<path d="M36 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z" fill="#fff"/><path d="M64 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z" fill="#fff"/>'; break;
      case 'planet': extra = '<ellipse cx="50" cy="50" rx="44" ry="12" fill="none" stroke="#fff" stroke-width="3" opacity=".5" transform="rotate(-18 50 50)"/><circle cx="80" cy="18" r="3" fill="#fff"/><circle cx="18" cy="80" r="2" fill="#fff"/>'; break;
      case 'frog': eyes = '<circle cx="34" cy="34" r="10" fill="#fff"/><circle cx="66" cy="34" r="10" fill="#fff"/><circle cx="34" cy="34" r="4" fill="#123"/><circle cx="66" cy="34" r="4" fill="#123"/>'; mouth = '<path d="M28 62c12 10 32 10 44 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
      case 'bear':
        extra = '<circle cx="22" cy="20" r="11" fill="#fff" opacity=".85"/><circle cx="78" cy="20" r="11" fill="#fff" opacity=".85"/><ellipse cx="50" cy="62" rx="15" ry="11" fill="#fff" opacity=".3"/><ellipse cx="50" cy="57" rx="5" ry="4" fill="#fff"/>';
        mouth = '<path d="M43 66c4 4 10 4 14 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
      case 'panda':
        extra = '<circle cx="20" cy="18" r="11" fill="#111" opacity=".6"/><circle cx="80" cy="18" r="11" fill="#111" opacity=".6"/><ellipse cx="34" cy="46" rx="11" ry="13" fill="#111" opacity=".55" transform="rotate(-20 34 46)"/><ellipse cx="66" cy="46" rx="11" ry="13" fill="#111" opacity=".55" transform="rotate(20 66 46)"/>';
        eyes = '<circle cx="35" cy="46" r="4.5" fill="#fff"/><circle cx="65" cy="46" r="4.5" fill="#fff"/>';
        mouth = '<path d="M44 64c3 4 9 4 12 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><ellipse cx="50" cy="58" rx="5" ry="3.5" fill="#fff"/>'; break;
      case 'owl':
        extra = '<path d="M18 22 30 30M82 22 70 30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
        eyes = '<circle cx="34" cy="46" r="13" fill="#fff"/><circle cx="66" cy="46" r="13" fill="#fff"/><circle cx="34" cy="46" r="5" fill="#222"/><circle cx="66" cy="46" r="5" fill="#222"/>';
        mouth = '<path d="M44 62l6 9 6-9z" fill="#ffd34d"/>'; break;
      case 'penguin':
        extra = '<ellipse cx="50" cy="60" rx="28" ry="32" fill="#fff" opacity=".92"/>';
        eyes = '<circle cx="40" cy="46" r="5" fill="#1e3c72"/><circle cx="60" cy="46" r="5" fill="#1e3c72"/>';
        mouth = '<path d="M42 56h16l-8 9z" fill="#ffb02e"/>'; break;
      case 'dino':
        extra = '<path d="M30 14l6-10 6 10M46 10l6-10 6 10M62 14l6-10 6 10" fill="#fff" opacity=".85"/>';
        eyes = '<circle cx="34" cy="42" r="6" fill="#fff"/><circle cx="66" cy="42" r="6" fill="#fff"/>';
        mouth = '<path d="M28 62h44" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M38 62v6M50 62v6M62 62v6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
      case 'cool':
        eyes = '<path d="M20 38h60" stroke="#111" stroke-width="5" stroke-linecap="round"/><rect x="22" y="38" width="24" height="14" rx="6" fill="#111"/><rect x="54" y="38" width="24" height="14" rx="6" fill="#111"/>';
        mouth = '<path d="M38 66c8 6 18 4 26-4" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
      case 'wink':
        eyes = '<circle cx="36" cy="44" r="6" fill="#fff"/><path d="M57 45c3-4 11-4 14 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
        mouth = '<path d="M34 62c10 10 24 10 32 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M58 66c2 6 8 8 10 2" fill="#ff8fb1"/>'; break;
      case 'ninja':
        extra = '<rect x="10" y="32" width="80" height="26" rx="6" fill="#111" opacity=".75"/><path d="M84 40l12-6-6 12" fill="#e52d27"/>';
        eyes = '<path d="M28 46l14 2M58 48l14-2" stroke="#fff" stroke-width="6" stroke-linecap="round"/>';
        mouth = ''; break;
      case 'pirate':
        extra = '<path d="M14 30c10-22 62-22 72 0z" fill="#111" opacity=".8"/><circle cx="50" cy="20" r="4" fill="#fff"/><path d="M20 36 80 50" stroke="#111" stroke-width="3"/>';
        eyes = '<circle cx="36" cy="46" r="6" fill="#fff"/><ellipse cx="64" cy="47" rx="9" ry="8" fill="#111"/>';
        mouth = '<path d="M38 66c8 4 18 4 24-2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
      case 'crown':
        extra = '<path d="M24 26 30 6l12 12 8-14 8 14 12-12 6 20z" fill="#fff" opacity=".95"/>'; break;
      case 'popcorn':
        extra = '<path d="M28 44h44l-6 46H34z" fill="#fff"/><path d="M38 44l2 46M50 44v46M62 44l-2 46" stroke="#e53935" stroke-width="4"/><circle cx="34" cy="38" r="9" fill="#fff6d5"/><circle cx="50" cy="32" r="10" fill="#fff6d5"/><circle cx="66" cy="38" r="9" fill="#fff6d5"/>';
        eyes = '<circle cx="42" cy="60" r="3.5" fill="#e53935"/><circle cx="58" cy="60" r="3.5" fill="#e53935"/>';
        mouth = '<path d="M44 70c3 3 9 3 12 0" fill="none" stroke="#e53935" stroke-width="3.5" stroke-linecap="round"/>'; break;
      case 'monster':
        extra = '<path d="M26 22 18 6M74 22 82 6" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
        eyes = '<circle cx="50" cy="42" r="14" fill="#fff"/><circle cx="50" cy="42" r="6" fill="#222"/>';
        mouth = '<path d="M30 66h40" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M36 66l4 8 4-8M56 66l4 8 4-8" fill="#fff"/>'; break;
    }
    return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + av.a + '"/><stop offset="1" stop-color="' + av.b + '"/></linearGradient></defs>' +
      '<rect width="100" height="100" rx="18" fill="url(#' + g + ')"/>' + extra + eyes + mouth + '</svg>';
  }

  /* ---- core/icons.js --------------------------------------------------------- */
  /* core/icons.js — Iconos de línea de la interfaz de escritorio y botones de icono con descripción.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* One stroke style for every desktop control (24px grid, currentColor). */
  function uiSvg(body, filled) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="' + (filled ? 'currentColor' : 'none') +
      '" stroke="' + (filled ? 'none' : 'currentColor') +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }

  var UI_ICONS = {
    back: uiSvg('<path d="M15 18l-6-6 6-6"/>'),
    history: uiSvg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
    mylist: uiSvg('<path d="M6 3.5h12v17l-6-4-6 4z"/><path d="M12 7.5v5M9.5 10h5"/>'),
    search: uiSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    user: uiSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
    play: uiSvg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z"/>', true),
    pause: uiSvg('<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>', true),
    rewind: uiSvg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M10 10.2v5.3M13.4 10.2h1.3a1.2 1.2 0 0 1 1.2 1.2v2.9a1.2 1.2 0 0 1-1.2 1.2h-1.3a1.2 1.2 0 0 1-1.2-1.2v-2.9a1.2 1.2 0 0 1 1.2-1.2z" stroke-width="1.6"/>'),
    forward: uiSvg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M8.6 10.2v5.3M12 10.2h1.3a1.2 1.2 0 0 1 1.2 1.2v2.9a1.2 1.2 0 0 1-1.2 1.2H12a1.2 1.2 0 0 1-1.2-1.2v-2.9a1.2 1.2 0 0 1 1.2-1.2z" stroke-width="1.6"/>'),
    settings: uiSvg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    episodes: uiSvg('<path d="M3 6h12M3 12h8M3 18h12"/><path d="M16 10.5l5 3-5 3z"/>'),
    fullscreen: uiSvg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    exitFullscreen: uiSvg('<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>'),
    pip: uiSvg('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/>'),
    prev: uiSvg('<path d="M6 5v14"/><path d="M18 6.2v11.6a.7.7 0 0 1-1.1.6L9 12.6a.7.7 0 0 1 0-1.2l7.9-5.8a.7.7 0 0 1 1.1.6z"/>'),
    next: uiSvg('<path d="M18 5v14"/><path d="M6 6.2v11.6a.7.7 0 0 0 1.1.6l7.9-5.8a.7.7 0 0 0 0-1.2L7.1 5.6A.7.7 0 0 0 6 6.2z"/>'),
    star: uiSvg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>'),
    aspect: uiSvg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 9v-1h3M17.5 15v1h-3"/>'),
    retry: uiSvg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    lock: uiSvg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    diagnostics: uiSvg('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
    channels: uiSvg('<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/>'),
    quality: uiSvg('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M7 9.5v5M10 9.5v5M7 12h3M13.5 9.5v5h1.6a2.5 2.5 0 0 0 0-5z"/>'),
    close: uiSvg('<path d="M6 6l12 12M18 6 6 18"/>'),
    share: uiSvg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>'),
    help: uiSvg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 1c0 1.8-2.5 2.2-2.5 4"/><path d="M12 17.5h.01"/>'),
    info: uiSvg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
    wifi: uiSvg('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><path d="M12 19.5h.01"/>'),
    keyboard: uiSvg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8"/>'),
    check: uiSvg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    expand: uiSvg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
    folder: uiSvg('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>'),
    speed: uiSvg('<path d="M12 14.5l4.5-4.5"/><path d="M3.6 18.5a9.5 9.5 0 1 1 16.8 0"/><circle cx="12" cy="14.5" r="1.2"/>'),
    pin: uiSvg('<path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><path d="M12 14v7"/><path d="M8 3h8"/>'),
    addons: uiSvg('<path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/>'),
    chevronUp: uiSvg('<path d="M18 15l-6-6-6 6"/>'),
    chevronDown: uiSvg('<path d="M6 9l6 6 6-6"/>')
  };

  /* Turns a text button into an icon button. The text becomes its tooltip
     (data-tip, see desktop/tooltip.js) and accessible name. */
  function iconizeButton(btn, icon, tip) {
    if (!btn || !icon) { return btn; }
    var text = tip || btn.getAttribute('aria-label') || btn.textContent;
    btn.innerHTML = icon;
    btn.classList.add('is-icon-btn');
    btn._iconized = true;
    setButtonText(btn, text);
    return btn;
  }

  /* Updates a button's label: the visible text, or the tooltip and accessible
     name when the button shows an icon. Optionally swaps the icon too. */
  function setButtonText(btn, text, icon) {
    if (!btn) { return; }
    if (btn._iconized) {
      if (icon) { btn.innerHTML = icon; }
      btn.setAttribute('data-tip', text);
      btn.setAttribute('aria-label', text);
      btn.removeAttribute('title');
    } else {
      btn.textContent = text;
    }
  }

  /* ---- core/loader.js -------------------------------------------------------- */
  /* core/loader.js — Indicadores de carga: la barra fina de arriba mientras hay pedidos en curso y el indicador de una pantalla que espera datos.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------- top bar */
  /* A thin bar across the top of the window while addon or portal requests
     are pending, on every screen. It shows up only after NET_SHOW_DELAY (quick
     answers never flash it) and stays at least NET_MIN_VISIBLE once shown, so
     it never blinks. Only a transform animates (cheap on a Fire TV), and only
     while something is loading. It lives on <body>, outside the scaled
     canvas, so it is the same on PC, TVs and phones. */
  var netPending = 0;
  var netBar = null;
  var netShowTimer = null;
  var netHideTimer = null;
  var netShownAt = 0;
  var NET_SHOW_DELAY = 300;
  var NET_MIN_VISIBLE = 450;

  function netBarElement() {
    if (!netBar && document.body) {
      netBar = el('div', 'net-bar');
      netBar.setAttribute('aria-hidden', 'true');
      netBar.appendChild(el('div', 'net-bar-run'));
      document.body.appendChild(netBar);
    }
    return netBar;
  }

  function netBegin() {
    netPending++;
    if (netPending !== 1) { return; }
    /* Still on screen and about to hide: it just stays. */
    if (netHideTimer) { clearTimeout(netHideTimer); netHideTimer = null; return; }
    if (netShowTimer) { return; }
    netShowTimer = setTimeout(function () {
      netShowTimer = null;
      if (netPending <= 0) { return; }
      /* Never over a video being watched (the player shows its own
         "Cargando vídeo…"). */
      if (typeof state !== 'undefined' && state.screen === 'player') { return; }
      var bar = netBarElement();
      if (!bar) { return; }
      bar.classList.add('is-on');
      netShownAt = Date.now();
    }, NET_SHOW_DELAY);
  }

  function netEnd() {
    if (netPending > 0) { netPending--; }
    if (netPending > 0) { return; }
    if (netShowTimer) { clearTimeout(netShowTimer); netShowTimer = null; return; }
    if (!netBar || !netBar.classList.contains('is-on') || netHideTimer) { return; }
    var wait = Math.max(0, NET_MIN_VISIBLE - (Date.now() - netShownAt));
    netHideTimer = setTimeout(function () {
      netHideTimer = null;
      if (netPending === 0 && netBar) { netBar.classList.remove('is-on'); }
    }, wait);
  }

  /* Wraps a request's callback: the bar counts the request until the
     callback runs (once, even if it is called again). */
  function trackedCallback(done) {
    netBegin();
    var ended = false;
    return function () {
      if (!ended) { ended = true; netEnd(); }
      return done.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------- screen loader */
  /* What a screen (or a part of one) shows while its data has not arrived:
     three dots breathing in turn and, optionally, one line of text. It fades
     in after a short moment, so content that is already there a split second
     later never flashes it. Replace it with the content when it is ready (the
     animation stops with the element). `cls` adds a size: 'is-small' for
     inline places such as an episode list. */
  function makeLoader(text, cls) {
    var box = el('div', 'ot-loader' + (cls ? ' ' + cls : ''));
    box.setAttribute('role', 'status');
    var dots = el('div', 'ot-loader-dots');
    for (var i = 0; i < 3; i++) { dots.appendChild(el('span')); }
    box.appendChild(dots);
    if (text) { box.appendChild(el('div', 'ot-loader-text', text)); }
    return box;
  }

  /* ---- core/tv-keyboard.js --------------------------------------------------- */
  /* core/tv-keyboard.js — Teclado en pantalla para la tele: letras, números, espacio y borrar, que se recorren con el control (buscador y guía de canales).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* TVs only. The system keyboard of a Fire TV covers the whole screen and
     hides what is being searched; this one sits next to the results, which
     change while the viewer types. Keys are plain focusable elements (the
     usual spatial navigation moves through them); nothing animates. */
  var TVK_ROWS = [
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    ['h', 'i', 'j', 'k', 'l', 'm', 'n'],
    ['ñ', 'o', 'p', 'q', 'r', 's', 't'],
    ['u', 'v', 'w', 'x', 'y', 'z', '\''],
    ['1', '2', '3', '4', '5', '6', '7'],
    ['8', '9', '0', '.', '-', ':', '&']
  ];
  var TVK_MAX = 60;
  var TVK_BACKSPACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="m16 9-5 6M11 9l5 6"/></svg>';

  /* opts: placeholder, value, onChange(text), doneLabel + onDone(text)
     (the white button in the bar), cls (extra class for its size).
     Returns { el, first, set(text), get() }. */
  function makeTvKeyboard(opts) {
    opts = opts || {};
    var value = String(opts.value || '');
    var box = el('div', 'tvk' + (opts.cls ? ' ' + opts.cls : ''));
    /* The bar: what is typed and, with doneLabel, the white Buscar button
       next to it (as on the desktop search bar). Up from the keys reaches it. */
    var bar = el('div', 'tvk-bar');
    var display = el('div', 'tvk-display');
    var text = el('span', 'tvk-text');
    display.appendChild(text);
    bar.appendChild(display);
    if (opts.doneLabel) {
      var go = el('div', 'tvk-go focusable');
      go.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      go.appendChild(el('span', '', opts.doneLabel));
      go._activate = function () { if (opts.onDone) { opts.onDone(value); } };
      bar.appendChild(go);
    }
    box.appendChild(bar);
    var grid = el('div', 'tvk-grid');

    function show() {
      text.textContent = value || opts.placeholder || '';
      display.classList.toggle('is-empty', !value);
    }
    function set(v, quiet) {
      value = String(v || '').slice(0, TVK_MAX);
      show();
      if (!quiet && opts.onChange) { opts.onChange(value); }
    }
    function key(label, cls, fn) {
      var k = el('div', 'tvk-key focusable' + (cls ? ' ' + cls : ''), label);
      k._activate = fn;
      grid.appendChild(k);
      return k;
    }
    for (var r = 0; r < TVK_ROWS.length; r++) {
      for (var c = 0; c < TVK_ROWS[r].length; c++) {
        key(TVK_ROWS[r][c], '', (function (ch) {
          return function () { set(value + ch); };
        })(TVK_ROWS[r][c]));
      }
    }
    key('Espacio', 'is-wide3', function () {
      if (value && value.charAt(value.length - 1) !== ' ') { set(value + ' '); }
    });
    var del = key('', 'is-wide2 is-del', function () { if (value) { set(value.slice(0, -1)); } });
    del.innerHTML = TVK_BACKSPACE + '<span>Borrar</span>';
    key('Limpiar', 'is-wide2', function () { if (value) { set(''); } });
    box.appendChild(grid);
    show();
    return {
      el: box,
      first: grid.firstChild,
      set: function (v) { set(v, true); },
      get: function () { return value; }
    };
  }

  /* ---------------------------------------------- keyboard over a window */
  /* A panel with the keyboard over part of a window (the channel guide):
     `cover` is the part it hides, whose controls stop taking the focus
     while it is open (core/focus.js isVisible). Back closes it
     (tvKeyboardBack, from handleKey). */
  var tvKbPanel = null;

  function openTvKeyboardPanel(host, opts) {
    closeTvKeyboardPanel(true);
    var panel = el('div', 'tvk-panel');
    if (opts.title) { panel.appendChild(el('div', 'tvk-title', opts.title)); }
    var kb = makeTvKeyboard({
      placeholder: opts.placeholder, value: opts.value, cls: opts.cls,
      onChange: opts.onChange,
      doneLabel: opts.doneLabel,
      onDone: function (v) { closeTvKeyboardPanel(true); if (opts.onDone) { opts.onDone(v); } }
    });
    panel.appendChild(kb.el);
    host.appendChild(panel);
    if (opts.cover) { opts.cover.classList.add('tvk-covered'); }
    if (opts.hostClass) { host.classList.add(opts.hostClass); }
    tvKbPanel = { panel: panel, host: host, opts: opts, returnFocus: state.focus };
    setFocus(kb.first);
    return kb;
  }

  /* `quiet`: no focus change (the caller decides where it goes). */
  function closeTvKeyboardPanel(quiet) {
    if (!tvKbPanel) { return false; }
    var p = tvKbPanel;
    tvKbPanel = null;
    if (p.panel.parentNode) { p.panel.parentNode.removeChild(p.panel); }
    if (p.opts.cover) { p.opts.cover.classList.remove('tvk-covered'); }
    if (p.opts.hostClass) { p.host.classList.remove(p.opts.hostClass); }
    if (!quiet && p.returnFocus && p.returnFocus.isConnected) { setFocus(p.returnFocus, true); }
    return true;
  }

  /* Back with the panel open: close it (true when it did). */
  function tvKeyboardBack() {
    return closeTvKeyboardPanel(false);
  }

  /* ---- data/demo-catalog.js -------------------------------------------------- */
  /* data/demo-catalog.js — El catálogo de películas y series en memoria (VOD).
     Empieza vacío y lo llenan los addons del usuario (services/vod-api.js).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var VOD = [];

  /* ---- services/vod-api.js --------------------------------------------------- */
  /* services/vod-api.js — Cliente de la API VOD: normalización de títulos, temporadas y peticiones HTTP.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------- VOD API
     XMLHttpRequest is used deliberately: it works on the oldest TV
     WebViews, where fetch/async functions are not a safe baseline. */
  var vodApi = window.OPENTV_API || {};
  /* Desktop harness override: ?service=http://127.0.0.1:8910 */
  var devServiceParam = /[?&]service=([^&]+)/.exec(window.location.search || '');
  if (devServiceParam) { vodApi.devServiceUrl = decodeURIComponent(devServiceParam[1]); }
  var vodApiState = { loading: false, source: 'demo', error: null };
  var portalState = { refreshing: false, lastSync: 0, roots: 0, error: null };
  var PORTAL_ROOTS = ['featured', 'movies', 'series', 'anime', 'kids', 'free'];

  function apiArray(payload) {
    if (Object.prototype.toString.call(payload) === '[object Array]') { return payload; }
    if (!payload) { return []; }
    var keys = ['items', 'movies', 'results', 'recommendList', 'movieList',
                'totalMovieList', 'programList', 'data'];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.toString.call(payload[keys[i]]) === '[object Array]') {
        return payload[keys[i]];
      }
      if (payload[keys[i]] && typeof payload[keys[i]] === 'object') {
        var nested = apiArray(payload[keys[i]]);
        if (nested.length) { return nested; }
      }
    }
    return [];
  }

  function apiError(payload) {
    if (!payload || typeof payload !== 'object') { return ''; }
    var code = payload.returnCode || payload.code || payload.errorCode || '';
    var message = payload.errorMessage || payload.message || payload.msg || '';
    if (!code && !message) { return ''; }
    return (code ? String(code) + ': ' : '') + (message ? String(message) : 'La API rechazó la petición');
  }

  function apiUrl(kind) {
    var direct = vodApi[kind + 'Url'];
    if (direct) { return String(direct); }
    var base = String(vodApi.baseUrl || '').replace(/\/$/, '');
    var path = String(vodApi[kind + 'Path'] || '');
    return base && path ? base + (path.charAt(0) === '/' ? path : '/' + path) : '';
  }

  function apiImage(value) {
    if (!value) { return ''; }
    value = String(value);
    if (/^https?:\/\//i.test(value) || value.indexOf('data:') === 0) { return value; }
    if (!vodApi.imageBaseUrl) { return value; }
    return String(vodApi.imageBaseUrl).replace(/\/$/, '') + '/' + value.replace(/^\//, '');
  }

  function apiText(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  function isSeriesItem(item) {
    if (!item) { return false; }
    return item.type === 'teleplay' || item.type === 'series' || item.kind === 'serie' ||
           (item.category && item.category.indexOf('serie') !== -1) ||
           (item.episodes && item.episodes.length > 0) ||
           (item.seasons && item.seasons.length > 0) ||
           (item.volumeCount && parseInt(item.volumeCount, 10) > 1);
  }

  function normalizeVod(raw, index) {
    raw = raw || {};
    var genres = raw.genres || raw.genre || [];
    if (typeof genres === 'string') { genres = genres.split(','); }
    if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = []; }
    var names = [];
    for (var i = 0; i < genres.length; i++) {
      names.push(typeof genres[i] === 'string' ? genres[i] : (genres[i].name || ''));
    }
    var runtime = raw.duration || raw.runtimeSeconds || '';
    if (!durationToSeconds(runtime) && raw.runtimeMinutes) runtime = Number(raw.runtimeMinutes) * 60;
    if (!durationToSeconds(runtime) && raw.runtime) runtime = typeof raw.runtime === 'number' ? raw.runtime * 60 : raw.runtime;
    var type = apiText(raw.type || raw.programType, '');
    var isSeries = type === 'teleplay' || type === 'series' || norm(apiText(raw.kind || '', '')) === 'serie' ||
                   norm(apiText(raw.category || '', '')).indexOf('serie') !== -1 ||
                   (raw.episodes && raw.episodes.length > 0) ||
                   (raw.seasons && raw.seasons.length > 0) ||
                   (raw.volumeCount && parseInt(raw.volumeCount, 10) > 1) ||
                   (raw.volumnCount && parseInt(raw.volumnCount, 10) > 1);
    return {
      id: apiText(raw.id || raw.vodId || raw.programId || raw.program_id || raw.tmdb_id, 'api-' + index),
      title: apiText(raw.title || raw.name || raw.programName || raw.programTitle || raw.original_title, 'Sin título'),
      category: norm(apiText(raw.category || raw.section || raw.collection || raw.homeSection, '')),
      score: apiText(raw.score || raw.vote_average || raw.rating || raw.movieRate || raw.programScore, '—'),
      year: apiText(raw.year || raw.release_year || raw.programYear || (raw.releaseDate || raw.releaseTime || raw.release_date || '').slice(0, 4), '—'),
      duration: apiText(runtime, '—'),
      genres: names.length ? names : ['Sin clasificar'],
      director: apiText(raw.director, '—'),
      actors: apiText(raw.actors || raw.actorDisplay || raw.cast, '—'),
      synopsis: apiText(raw.synopsis || raw.overview || raw.description || raw.programUpdateContent, 'Sin sinopsis disponible.'),
      kind: isSeries ? 'serie' : apiText(raw.kind || raw.media_type, 'película'),
      poster: apiImage(raw.posterUrl || raw.poster_url || raw.poster || raw.poster_path || raw.image || raw.imageUrl || raw.cover || raw.coverUrl || raw.programPoster || raw.programImage),
      landscape: apiImage(raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage),
      backdrop: apiImage(raw.backdropUrl || raw.backdrop_url || raw.backdrop || raw.backdrop_path),
      streamUrl: raw.streamUrl || raw.stream_url || '',
      /* Records marked as coming from the old portal (history only). */
      type: type || (isSeries ? 'teleplay' : 'movie'),
      row: apiText(raw.row, ''),
      /* Every home shelf the title is on (the TOP rankings included). */
      _rows: raw._rows && raw._rows.length ? raw._rows.slice() : (raw.rows && raw.rows.length ? raw.rows.slice() : []),
      alias: apiText(raw.alias, ''),
      country: apiText(raw.country || raw.originalCountry, ''),
      releaseDate: apiText(raw.releaseDate || raw.releaseTime, ''),
      tagline: apiText(raw.tagline || raw.viewPoint, ''),
      volumeCount: parseInt(raw.volumeCount || raw.volumnCount, 10) || 0,
      updateCount: parseInt(raw.updateCount, 10) || 0,
      episodes: raw.episodes || [],
      seasons: raw.seasons || [],
      moreAudio: raw.moreAudio !== undefined ? raw.moreAudio : 0,
      moreSubtitle: raw.moreSubtitle !== undefined ? raw.moreSubtitle : 0,
      _stremio: raw._stremio === true,
      _stremioBase: raw._stremioBase || '',
      _stremioType: raw._stremioType || '',
      _portal: raw._stremio ? false : (raw.portal === true || raw._portal === true || (vodApi && vodApi.mode === 'portal' && String(raw.id || '').length > 10))
    };
  }

  function apiRequest(url, done, options) {
    options = options || {};
    done = trackedCallback(done);   /* the loading bar at the top (core/loader.js) */
    var xhr = new XMLHttpRequest();
    var finished = false;
    var timeout = parseInt(vodApi.timeoutMs, 10) || 10000;
    function finish(error, payload) {
      if (finished) { return; }
      finished = true;
      done(error, payload);
    }
    xhr.open(options.method || 'GET', url, true);
    xhr.timeout = timeout;
    var headers = vodApi.headers || {};
    for (var name in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, name)) { xhr.setRequestHeader(name, headers[name]); }
    }
    if (options.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status < 200 || xhr.status >= 300) { finish('HTTP ' + xhr.status); return; }
      try { finish(null, JSON.parse(xhr.responseText)); }
      catch (err) { finish('La API no devolvió JSON válido'); }
    };
    xhr.onerror = function () { finish('Error de red o CORS'); };
    xhr.ontimeout = function () { finish('Tiempo de espera agotado'); };
    try { xhr.send(options.body === undefined ? null : JSON.stringify(options.body)); }
    catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
  }

  /* Some portal catalogues publish every season as a separate series card
     ("The Walking Dead T1", "The Walking Dead T2", ...).  Treat only an
     explicit trailing season marker as a grouping signal; ordinary titles
     such as spin-offs are left untouched. */
  function catalogSeasonMarker(item) {
    if (!item || !isSeriesItem(item)) { return null; }
    var title = String(item.title || item.alias || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var match = /^(.*?)(?:\s*[-–:|]?\s*(?:temporada|season)\s*(\d+)|\s*[-–:|]?\s*[st]\s*0?(\d+))\s*$/i.exec(title);
    if (!match || !match[1]) { return null; }
    var number = parseInt(match[2] || match[3], 10);
    if (!number || number > 99) { return null; }
    return { title: match[1].replace(/\s+$/, ''), number: number };
  }

  function groupCatalogSeasons(items) {
    var groups = {}, out = [];
    for (var i = 0; i < items.length; i++) {
      var marker = catalogSeasonMarker(items[i]);
      if (!marker) { out.push(items[i]); continue; }
      var key = norm(marker.title);
      if (!groups[key]) { groups[key] = { title: marker.title, items: [] }; }
      groups[key].items.push({ item: items[i], number: marker.number });
    }
    for (var key in groups) {
      if (!groups.hasOwnProperty(key)) { continue; }
      var group = groups[key];
      if (group.items.length < 2) {
        out.push(group.items[0].item);
        continue;
      }
      group.items.sort(function (a, b) { return a.number - b.number; });
      var main = group.items[0].item;
      var allCats = {};
      main._catalogSeasons = [];
      main._seriesGroup = true;
      main._seriesTitle = group.title;
      main.title = group.title;
      main.alias = group.title;
      main.seasons = [];
      for (var s = 0; s < group.items.length; s++) {
        var part = group.items[s];
        var cats = String(part.item.category || '').split(',');
        for (var c = 0; c < cats.length; c++) { if (cats[c]) { allCats[cats[c]] = true; } }
        var season = { id: part.item.id, number: part.number, title: group.title };
        main._catalogSeasons.push(season);
        main.seasons.push(season);
      }
      main.category = Object.keys(allCats).join(',');
      out.push(main);
    }
    return out;
  }

  function replaceVod(records, source, portal) {
    if (!records.length) { return false; }
    var previous = {};
    for (var p = 0; p < VOD.length; p++) { previous[String(VOD[p].id)] = VOD[p]; }
    VOD.splice(0, VOD.length);
    var normalizedItems = [];
    for (var i = 0; i < records.length; i++) {
      var item = normalizeVod(records[i], i + 1);
      keepKidsSafe(item);
      if (portal && records[i].portal !== false) { item._portal = true; }
      /* Keep the addon fields (Stremio mode: _stremioId, _stremioBase…). */
      for (var key in records[i]) {
        if (Object.prototype.hasOwnProperty.call(records[i], key) && /^_(stremio|plain)/.test(key) && item[key] === undefined) {
          item[key] = records[i][key];
        }
      }
      var old = previous[String(item.id)];
      if (old) {
        /* Keep what the detail/player already learned about this title. */
        if (old.episodes) { item.episodes = old.episodes; }
        if (old.seasons) { item.seasons = old.seasons; }
        if (old._detailsLoaded) { item._detailsLoaded = true; }
        if (!item.streamUrl && old.streamUrl) { item.streamUrl = old.streamUrl; }
      }
      normalizedItems.push(item);
    }
    var catalogItems = groupCatalogSeasons(normalizedItems);
    for (var n = 0; n < catalogItems.length; n++) {
      VOD.push(catalogItems[n]);
    }
    if (state.detail) {
      var foundDetail = false;
      for (var d = 0; d < VOD.length; d++) {
        if (String(VOD[d].id) === String(state.detail.id)) {
          state.detail = VOD[d];
          foundDetail = true;
          break;
        }
      }
      if (!foundDetail) { state.detail = VOD[0]; }
    }
    vodApiState.source = source;
    vodApiState.error = null;
    refreshVodViews();
    return true;
  }

  /* A real catalog may not have every home section. Prefer the declared
     category, then fall back to positional demo slices so the reconstructed
     layouts always have content to show. */
  function vodFor(category, count, fallbackStart) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1) { out.push(VOD[i]); }
      }
    }
    out = withCovers(out);
    if (!out.length) { out = VOD.slice(fallbackStart, fallbackStart + count); }
    if (!out.length) { out = VOD.slice(0, count); }
    /* Fill short sections with other catalog entries so the sample never shows
       one poster repeated across a whole mosaic. A real backend normally sends
       enough items per section; this only affects the bundled demo catalog. */
    if (out.length < count && VOD.length) {
      var seen = {};
      for (i = 0; i < out.length; i++) { seen[String(out[i].id)] = true; }
      var cursor = 0;
      while (out.length < count && cursor < VOD.length * 2) {
        var cand = VOD[cursor % VOD.length];
        cursor++;
        if (!seen[String(cand.id)]) {
          out.push(cand);
          seen[String(cand.id)] = true;
        }
      }
    }
    return out;
  }

  function refreshVodViews() {
    if (homeBuilt && window.OPENTV_DESKTOP && pages.length) {
      markCatalogPagesStale();
      if (historyDrawerOpen) { renderHistoryDrawer(); }
      if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
      return;
    }
    if (homeBuilt) {
      var rail = $('home-tabs');
      var railWasExpanded = !!(rail && rail.classList.contains('is-expanded') && !rail.classList.contains('is-collapsed'));
      var focusWasTab = !!(state.focus && state.focus._tab !== undefined);
      var focusWasNotify = !!(state.focus && closest(state.focus, '#home-notify'));
      var hadContentFocus = !!(state.focus && closest(state.focus, '.home-page'));
      pages = [];
      tabEls = [];
      buildHome();
      selectTab(state.tab, false);
      if (state.screen === 'home') {
        if (focusWasTab && tabEls[state.tab]) { setFocus(tabEls[state.tab], true); }
        else if (focusWasNotify) {
          var n = firstIn($('home-notify'));
          if (n) { setFocus(n, true); }
        } else if (hadContentFocus) {
          var page = pages[TABS[state.tab].page];
          var f = page ? firstIn(page) : null;
          if (f) { setFocus(f, true); }
        }
        if (railWasExpanded && rail) {
          /* The reference keeps the full labels on the first paint even while
             the content holds focus; preserve that across a catalog refresh. */
          rail.classList.add('is-expanded');
          rail.classList.remove('is-collapsed');
          var railBg = document.querySelector('.home-sidebar-bg');
          if (railBg && !window.OPENTV_DESKTOP) { railBg.classList.add('is-on'); }
        }
      }
    }
    if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
    if (state.detail) { buildDetail(state.detail); }
  }

  /* ------------------------------------------- Addons
     Películas y series salen solo de los addons del usuario (compatibles con
     Stremio: manifest.json / catalog / meta / stream). Vienen instalados
     Cinemeta y OpenSubtitles, como en Stremio; los de fuentes los agrega cada
     usuario. TV en vivo no depende de esto: tiene sus propias listas M3U.
     (The automatic catalog and its 'auto' mode were removed: `mode` is always
     'external', kept so saved configs and older checks read the same.) */
  var VOD_SOURCES_STORAGE_KEY = 'opentv_vod_sources_v1';

  function getVodSourcesConfig() {
    var cfg = { mode: 'external', addons: [] };
    try {
      var raw = localStorage.getItem(VOD_SOURCES_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') {
        if (Object.prototype.toString.call(parsed.addons) === '[object Array]') {
          for (var i = 0; i < parsed.addons.length; i++) {
            var ad = parsed.addons[i];
            /* Dropped from old configs: the built-in sample addon and the
               preinstalled WatchHub (it only linked to other apps). */
            if (ad && ad.url && !/^builtin:\/\//i.test(ad.url) && ad.id !== 'default_watchhub') { cfg.addons.push(ad); }
          }
        }
      }
    } catch (e) {}
    seedDefaultVodAddons(cfg);
    return cfg;
  }

  /* The addons that come with the app (as Stremio's own); they cannot be
     removed (seedDefaultVodAddons).
     (Stremio's "Local Files" lives in Stremio's own local server, so it cannot
     be part of OpenTV.) */
  var VOD_DEFAULTS_KEY = 'opentv_vod_defaults_v1';
  var DEFAULT_VOD_ADDONS = [
    { id: 'default_cinemeta', name: 'Cinemeta', url: 'https://v3-cinemeta.strem.io/manifest.json' },
    { id: 'default_opensubtitles', name: 'OpenSubtitles v3', url: 'https://opensubtitles-v3.strem.io/manifest.json' }
  ];

  /* Anime: the community's Kitsu catalog (Japanese anime as it is: airing,
     popular, best rated, with its own search). A catalog only, no sources;
     one of the app's own addons, right after Cinemeta. */
  var VOD_ANIME_KEY = 'opentv_vod_anime_v1';
  var DEFAULT_ANIME_ADDON = { id: 'default_kitsu', name: 'Anime Kitsu', url: 'https://anime-kitsu.strem.fun/manifest.json' };

  /* The three that come with the app (Cinemeta, Anime Kitsu, OpenSubtitles)
     cannot be removed: they are always in the list (one missing, also from
     an install where the viewer had removed it, is put back at the end;
     Kitsu right after Cinemeta). They give the catalog and subtitles only. */
  function builtinVodAddons() {
    return DEFAULT_VOD_ADDONS.slice(0, 1).concat([DEFAULT_ANIME_ADDON], DEFAULT_VOD_ADDONS.slice(1));
  }

  function isBuiltinVodAddon(ad) {
    var base = ad && ad.url ? stremioBaseFromUrl(ad.url) : '';
    if (!base) { return false; }
    var list = builtinVodAddons();
    for (var i = 0; i < list.length; i++) { if (stremioBaseFromUrl(list[i].url) === base) { return true; } }
    return false;
  }

  /* Recommended addons ("Recomendados" in Ajustes → Addons): Torrentio and
     TorrentsDB. None is preinstalled: the viewer adds them from here.
     TorrentsDB works without debrid. */
  var RECOMMENDED_VOD_ADDONS = [
    { name: 'Torrentio', url: 'https://torrentio.strem.fun/manifest.json', desc: 'Fuentes para reproducir películas y series, en varios idiomas y calidades' },
    { name: 'TorrentsDB', url: 'https://torrentsdb.com/manifest.json', desc: 'Fuentes torrent sin debrid, con proveedores y estrenos en varios idiomas' }
  ];

  function isVodAddonInstalled(url) {
    var base = stremioBaseFromUrl(url);
    var addons = getVodSourcesConfig().addons;
    for (var i = 0; i < addons.length; i++) { if (stremioBaseFromUrl(addons[i].url) === base) { return true; } }
    return false;
  }

  function seedDefaultVodAddons(cfg) {
    /* (Kept so the stored flags still mean "the defaults were handed out".) */
    try {
      if (!localStorage.getItem(VOD_DEFAULTS_KEY)) { localStorage.setItem(VOD_DEFAULTS_KEY, '1'); }
      if (!localStorage.getItem(VOD_ANIME_KEY)) { localStorage.setItem(VOD_ANIME_KEY, '1'); }
    } catch (e) { /* ignore */ }
    var have = {};
    for (var i = 0; i < cfg.addons.length; i++) { have[stremioBaseFromUrl(cfg.addons[i].url)] = true; }
    var list = builtinVodAddons();
    var changed = false;
    for (var d = 0; d < list.length; d++) {
      var def = list[d];
      if (have[stremioBaseFromUrl(def.url)]) { continue; }
      var rec = { id: def.id, name: def.name, url: def.url, baseUrl: stremioBaseFromUrl(def.url), kind: 'stremio' };
      /* Kitsu goes after Cinemeta, so the rows keep Cinemeta first. */
      var at = cfg.addons.length;
      if (def === DEFAULT_ANIME_ADDON) {
        for (var c = 0; c < cfg.addons.length; c++) { if (/v3-cinemeta\.strem\.io/.test(cfg.addons[c].url || '')) { at = c + 1; } }
      }
      cfg.addons.splice(at, 0, rec);
      changed = true;
    }
    if (changed) { saveVodSourcesConfig(cfg); }
  }

  /* Always on: addons are the only source of movies and series. */
  function stremioModeOn() {
    return true;
  }
  function saveVodSourcesConfig(cfg) {
    try {
      localStorage.setItem(VOD_SOURCES_STORAGE_KEY, JSON.stringify({
        mode: 'external',
        addons: (cfg && cfg.addons) || []
      }));
    } catch (e) {}
  }

  function normalizeStremioManifestUrl(url) {
    var clean = String(url || '').trim().replace(/^stremio:\/\//i, 'https://');
    if (!clean) { return ''; }
    if (!/^https?:\/\//i.test(clean)) { clean = 'https://' + clean; }
    return clean;
  }

  function stremioBaseFromUrl(url) {
    var clean = normalizeStremioManifestUrl(url);
    return clean.replace(/\/manifest\.json(\?.*)?$/i, '').replace(/\/$/, '');
  }

  /* Addon requests carry no custom headers: those would force a CORS
     preflight, and Stremio addons only promise plain GET with CORS. */
  function addonRequest(url, done, timeoutMs) {
    done = trackedCallback(done);   /* the loading bar at the top (core/loader.js) */
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(error, payload) {
      if (finished) { return; }
      finished = true;
      done(error, payload);
    }
    try {
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs || 15000;
    } catch (eOpen) { return finish('Enlace no válido'); }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status < 200 || xhr.status >= 300) { finish('HTTP ' + xhr.status); return; }
      try { finish(null, JSON.parse(xhr.responseText)); }
      catch (err) { finish('El addon no devolvió JSON válido'); }
    };
    xhr.onerror = function () { finish('No se pudo conectar con el addon'); };
    xhr.ontimeout = function () { finish('El addon tardó demasiado en responder'); };
    try { xhr.send(null); } catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
  }

  /* ---- What an addon offers (from its manifest) ---- */
  function stremioResources(manifest) {
    var out = [];
    var list = (manifest && manifest.resources) || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (typeof r === 'string') { out.push({ name: r }); }
      else if (r && r.name) { out.push({ name: r.name, types: r.types, idPrefixes: r.idPrefixes }); }
    }
    return out;
  }

  function catalogExtras(cat) {
    var names = [], required = [];
    var extra = (cat && cat.extra) || [];
    for (var i = 0; i < extra.length; i++) {
      if (!extra[i] || !extra[i].name) { continue; }
      names.push(extra[i].name);
      if (extra[i].isRequired) { required.push(extra[i].name); }
    }
    var supported = (cat && cat.extraSupported) || [];
    for (var s = 0; s < supported.length; s++) { if (names.indexOf(supported[s]) === -1) { names.push(supported[s]); } }
    var req = (cat && cat.extraRequired) || [];
    for (var q = 0; q < req.length; q++) { if (required.indexOf(req[q]) === -1) { required.push(req[q]); } }
    return { names: names, required: required };
  }

  /* The parts of a manifest kept with the installed addon. */
  function stremioAddonInfo(manifest, url) {
    var catalogs = [];
    var list = (manifest && manifest.catalogs) || [];
    for (var i = 0; i < list.length; i++) {
      var cat = list[i];
      /* ("anime": Kitsu's lists, movies and series mixed, for the Anime section.) */
      if (!cat || !cat.id || (cat.type !== 'movie' && cat.type !== 'series' && cat.type !== 'anime')) { continue; }
      var ex = catalogExtras(cat);
      /* The genres the catalog can be filtered by (Cinemeta: Animation, Family…):
         Kids and Anime ask for those lists (fetchAddonCatalogs). */
      var genres = [];
      for (var e = 0; e < (cat.extra || []).length; e++) {
        if (cat.extra[e] && cat.extra[e].name === 'genre' && cat.extra[e].options) { genres = cat.extra[e].options.slice(0, 60); }
      }
      if (!genres.length && cat.genres) { genres = cat.genres.slice(0, 60); }
      catalogs.push({ type: cat.type, id: cat.id, name: cat.name || '',
        home: !ex.required.length, search: ex.names.indexOf('search') !== -1, genres: genres });
    }
    return {
      manifestV: 3,
      url: url,
      baseUrl: stremioBaseFromUrl(url),
      kind: 'stremio',
      name: (manifest && manifest.name) || 'Addon',
      desc: (manifest && manifest.description) || '',
      logo: (manifest && manifest.logo) || '',
      configurable: !!(manifest && manifest.behaviorHints && (manifest.behaviorHints.configurable || manifest.behaviorHints.configurationRequired)),
      types: (manifest && manifest.types) || [],
      idPrefixes: (manifest && manifest.idPrefixes) || null,
      resources: stremioResources(manifest),
      catalogs: catalogs
    };
  }

  /* Does this addon answer `resource` for that type and id? */
  /* Something to play with: an addon that gives sources (Cinemeta and
     OpenSubtitles, the preinstalled ones, give none). Without one, titles
     show their information only. */
  function hasSourceAddons() {
    var addons = getVodSourcesConfig().addons;
    for (var i = 0; i < addons.length; i++) { if (addonSupports(addons[i], 'stream')) { return true; } }
    return false;
  }

  function addonSupports(ad, resource, type, id) {
    var res = ad && ad.resources;
    if (!res || !res.length) { return false; }
    for (var i = 0; i < res.length; i++) {
      if (res[i].name !== resource) { continue; }
      var types = res[i].types || ad.types || [];
      if (types.length && type && types.indexOf(type) === -1) { return false; }
      var prefixes = res[i].idPrefixes || ad.idPrefixes;
      if (prefixes && prefixes.length && id) {
        for (var p = 0; p < prefixes.length; p++) { if (String(id).indexOf(prefixes[p]) === 0) { return true; } }
        return false;
      }
      return true;
    }
    return false;
  }

  /* Addon ids in the app are 'stremio:<id>' so they never mix with the
     integrated catalog (history, Mi lista); _stremioId is the addon's own. */
  /* An installed addon has anime lists (Kitsu): then Anime shows only those,
     and the other catalogs' "Anime" genre stays in Películas / Series. */
  var animeCatalogInstalled = (function () {
    /* (From the saved list at start; each catalog sync updates it.) */
    try {
      var saved = JSON.parse(localStorage.getItem(VOD_SOURCES_STORAGE_KEY) || 'null');
      return !!(saved && saved.addons && hasAnimeCatalog(saved.addons));
    } catch (e) { return false; }
  })();
  function hasAnimeCatalog(addons) {
    for (var i = 0; i < addons.length; i++) {
      for (var c = 0; c < (addons[i].catalogs || []).length; c++) {
        if (addons[i].catalogs[c].type === 'anime' && addons[i].catalogs[c].home) { return true; }
      }
    }
    return false;
  }

  /* `anime`: the title comes from an anime list (it only goes to Anime). */
  function stremioMetaToVodRecord(meta, baseUrl, rowName, anime) {
    if (!meta || !meta.id) { return null; }
    var isSeries = meta.type === 'series' || meta.type === 'tv' || (meta.type === 'anime' && !/movie/i.test(String(meta.subtype || '')));
    var genres = meta.genres || meta.genre || [];
    if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = [String(genres)]; }
    var catParts = anime ? ['anime'] : ['destacado', isSeries ? 'serie' : 'pelicula'];
    for (var g = 0; g < genres.length && !anime; g++) {
      var gn = norm(String(genres[g] || ''));
      /* "Anime" is Japanese animation. "Animation" alone is neither Anime
         (it was: cartoons ended up there) nor Kids (it also has adult shows):
         only "Family" goes to Kids, what a kids profile sees. */
      if (gn === 'anime' && !animeCatalogInstalled) { catParts.push('anime'); }
      if (gn.indexOf('family') !== -1 || gn.indexOf('kids') !== -1 || gn.indexOf('infantil') !== -1) { catParts.push('infantil'); }
    }
    return {
      _animeCat: !!anime,
      id: 'stremio:' + meta.id,
      title: String(meta.name || meta.title || 'Sin título'),
      category: catParts.join(','),
      row: rowName || '',
      _rows: rowName ? [rowName] : [],
      score: String(meta.imdbRating || meta.rating || '—'),
      year: String(meta.releaseInfo || meta.year || '—').slice(0, 4),
      duration: meta.runtime || '—',
      genres: genres.length ? genres : [],
      director: Object.prototype.toString.call(meta.director) === '[object Array]' ? meta.director.join(', ') : (meta.director || '—'),
      actors: Object.prototype.toString.call(meta.cast) === '[object Array]' ? meta.cast.join(', ') : (meta.cast || '—'),
      synopsis: meta.description || meta.overview || '',
      kind: isSeries ? 'serie' : 'película',
      type: isSeries ? 'teleplay' : 'movie',
      poster: meta.poster || '',
      landscape: meta.background || meta.poster || '',
      backdrop: meta.background || meta.poster || '',
      logo: meta.logo || '',
      portal: false,
      _portal: false,
      _stremio: true,
      _stremioId: String(meta.id),
      _stremioBase: baseUrl || '',
      _stremioType: isSeries ? 'series' : 'movie'
    };
  }

  function catalogUrl(base, cat, extra) {
    return base + '/catalog/' + encodeURIComponent(cat.type) + '/' + encodeURIComponent(cat.id) +
      (extra ? '/' + extra : '') + '.json';
  }

  /* Row names: "Popular · Películas"; with several addons that would repeat,
     the addon's name is added. */
  var ANIME_ROW_NAMES = {
    'kitsu-anime-trending': 'Tendencias del anime',
    'kitsu-anime-airing': 'En emisión',
    'kitsu-anime-popular': 'Los más populares',
    'kitsu-anime-rating': 'Mejor valorados'
  };

  var stremioRowOrder = {}, stremioRowSeq = 0;

  function stremioRowName(ad, cat, taken) {
    var kind = cat.type === 'series' ? 'Series' : 'Películas';
    var name = cat.type === 'anime' ? (ANIME_ROW_NAMES[cat.id] || ((cat.name || 'Anime') + ' · Anime'))
      : (cat.name ? (cat.name + ' · ' + kind) : kind);
    if (taken[name]) { name += ' (' + ad.name + ')'; }
    taken[name] = true;
    /* The rows follow the addons' order (portalRowsFor), not the order in
       which titles happen to show up first. */
    if (!(name in stremioRowOrder)) { stremioRowOrder[name] = stremioRowSeq++; }
    return name;
  }

  var STREMIO_HOME_CATALOGS = 12;   /* rows per addon */
  var STREMIO_CATALOG_PAGES = 2;    /* two pages per row (usually 100 titles or more) */

  /* Kids and Anime: the lists a catalog gives filtered by these genres (the
     popular lists barely have them). Titles get their section from their own
     genres (stremioMetaToVodRecord): Family / Animation → Kids, Anime → Anime. */
  var STREMIO_SECTION_GENRES = [['Family', 'Familia'], ['Animation', 'Animación'], ['Anime', 'Anime']];

  function fetchAddonCatalogs(ad, taken, done) {
    var cats = [];
    for (var i = 0; i < (ad.catalogs || []).length && cats.length < STREMIO_HOME_CATALOGS; i++) {
      if (ad.catalogs[i].home) { cats.push({ cat: ad.catalogs[i], extra: '' }); }
    }
    /* One genre list per type (movie, series), from the first catalog that
     offers that genre. */
    var done2 = {};
    for (var c = 0; c < (ad.catalogs || []).length; c++) {
      var cg = ad.catalogs[c];
      if (!cg.home || !cg.genres || !cg.genres.length || cg.type === 'anime') { continue; }
      STREMIO_SECTION_GENRES.forEach(function (g) {
        var key = cg.type + ':' + g[0];
        if (done2[key] || cg.genres.indexOf(g[0]) === -1) { return; }
        /* With an anime catalog installed, Anime shows that one instead. */
        if (g[0] === 'Anime' && animeCatalogInstalled) { return; }
        done2[key] = true;
        cats.push({ cat: { type: cg.type, id: cg.id, name: g[1] }, extra: 'genre=' + encodeURIComponent(g[0]), one: true });
      });
    }
    /* Each list keeps its own bucket: the rows come out in the addon's order,
       not in the order the answers happen to arrive. */
    var buckets = cats.map(function () { return []; });
    var pending = cats.length;
    if (!pending) { return done([]); }
    cats.forEach(function (job, jobIndex) {
      var cat = job.cat;
      var rowName = stremioRowName(ad, cat, taken);
      var got = 0;
      function page(n) {
        var extra = [job.extra, n ? 'skip=' + got : ''].filter(function (x) { return x; }).join('&');
        addonRequest(catalogUrl(ad.baseUrl, cat, extra), function (err, payload) {
          var metas = (!err && payload && payload.metas) ? payload.metas : [];
          for (var m = 0; m < metas.length; m++) {
            var rec = stremioMetaToVodRecord(metas[m], ad.baseUrl, rowName, cat.type === 'anime');
            if (rec) { buckets[jobIndex].push(rec); }
          }
          got += metas.length;
          if (metas.length && !job.one && n + 1 < STREMIO_CATALOG_PAGES) { return page(n + 1); }
          if (--pending === 0) { done([].concat.apply([], buckets)); }
        });
      }
      page(0);
    });
  }

  /* Reads a manifest (or the user's own JSON / M3U catalogue). */
  function inspectVodAddon(url, done) {
    if (/\.m3u8?(\?.*)?$/i.test(url)) { return done(null, { url: url, baseUrl: '', kind: 'm3u', name: 'Lista M3U', resources: [], catalogs: [] }); }
    var manifestUrl = /\/manifest\.json(\?.*)?$/i.test(url) ? url : (stremioBaseFromUrl(url) + '/manifest.json');
    addonRequest(manifestUrl, function (err, manifest) {
      if (!err && manifest && (manifest.id || manifest.name) && (manifest.resources || manifest.catalogs)) {
        return done(null, stremioAddonInfo(manifest, manifestUrl));
      }
      addonRequest(url, function (jErr, jPayload) {
        if (jErr || !jPayload || !(jPayload.metas || apiArray(jPayload).length)) {
          return done(err || jErr || 'No es un addon compatible (manifest.json) ni un catálogo válido');
        }
        done(null, { url: url, baseUrl: stremioBaseFromUrl(url), kind: 'json', name: 'Catálogo JSON', resources: [], catalogs: [] });
      });
    });
  }

  /* Titles of a user's plain JSON or M3U catalogue. */
  function fetchPlainCatalog(ad, done) {
    if (ad.kind === 'm3u') {
      portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
        var items = [];
        var list = (!err && payload && payload.channels) || [];
        for (var i = 0; i < list.length; i++) {
          var ch = list[i];
          var row = ch.group || ad.name || 'Catálogo M3U';
          items.push({ id: 'm3uvod-' + (ch.id || (i + 1)), title: ch.name || ('Vídeo ' + (i + 1)),
            category: 'destacado,pelicula', row: row, _rows: [row], poster: ch.logo || '', landscape: ch.logo || '',
            backdrop: ch.logo || '', streamUrl: ch.streamUrl || '', kind: 'película', type: 'movie',
            portal: false, _portal: false, _stremio: true, _plain: true });
        }
        done(items);
      });
      return;
    }
    addonRequest(ad.url, function (err, payload) {
      var arr = (!err && payload) ? (payload.metas || apiArray(payload)) : [];
      var out = [];
      for (var k = 0; k < arr.length; k++) {
        var rec = arr[k] && arr[k].id && arr[k].type ? stremioMetaToVodRecord(arr[k], ad.baseUrl, ad.name) : null;
        if (rec) { if (arr[k].streamUrl) { rec.streamUrl = arr[k].streamUrl; } out.push(rec); }
      }
      done(out);
    });
  }

  function installVodAddon(addonInput, done) {
    done = done || function () {};
    var url = normalizeStremioManifestUrl(addonInput && addonInput.url);
    if (!url) { return done('Pega la URL de un addon (https://…/manifest.json)'); }
    inspectVodAddon(url, function (err, info) {
      if (err) { return done(err); }
      var cfg = getVodSourcesConfig();
      var replaced = false;
      for (var i = 0; i < cfg.addons.length; i++) {
        if (cfg.addons[i].url === info.url || cfg.addons[i].url === url) {
          info.id = cfg.addons[i].id;
          cfg.addons[i] = info;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        info.id = 'vod_addon_' + Date.now();
        cfg.addons.push(info);
      }
      saveVodSourcesConfig(cfg);
      syncExternalVodCatalogs(function (sErr, count) { done(null, count, info); });
    });
  }

  /* Old installs kept only the URL: read their manifests again once. */
  function refreshAddonManifests(cfg, done) {
    var stale = [];
    for (var i = 0; i < cfg.addons.length; i++) {
      /* Also read once more when saved by an older build (no genre lists). */
      if ((!cfg.addons[i].resources || cfg.addons[i].manifestV !== 3) &&cfg.addons[i].kind !== 'm3u' && cfg.addons[i].kind !== 'json') { stale.push(i); }
    }
    if (!stale.length) { return done(); }
    var left = stale.length;
    stale.forEach(function (idx) {
      inspectVodAddon(cfg.addons[idx].url, function (err, info) {
        if (!err && info) { info.id = cfg.addons[idx].id; cfg.addons[idx] = info; }
        if (--left === 0) { saveVodSourcesConfig(cfg); done(); }
      });
    });
  }

  /* The whole catalog comes from the user's addons. Without any addon the
     catalog is emptied (the home then says how to add one). */
  function syncExternalVodCatalogs(done) {
    done = done || function () {};
    var cfg = getVodSourcesConfig();
    if (!cfg.addons.length) { animeCatalogInstalled = false; replaceVod([], 'stremio-external', false); return done(null, 0); }
    refreshAddonManifests(cfg, function () {
      animeCatalogInstalled = hasAnimeCatalog(cfg.addons);
      stremioRowOrder = {};
      stremioRowSeq = 0;
      var byId = {}, all = [], taken = {};
      var left = cfg.addons.length;
      function collect(items) {
        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          var prev = byId[it.id];
          if (!prev) { byId[it.id] = it; all.push(it); continue; }
          /* The same title in two rows: keep one record, in both rows. */
          for (var r = 0; r < it._rows.length; r++) {
            if (prev._rows.indexOf(it._rows[r]) === -1) { prev._rows.push(it._rows[r]); }
          }
        }
      }
      function finished() {
        if (--left > 0) { return; }
        if (all.length) { replaceVod(all, 'stremio-external', false); }
        done(null, all.length);
      }
      /* Addons are read in parallel; rows keep the order of the list. */
      var results = [];
      cfg.addons.forEach(function (ad, idx) {
        function store(items) {
          results[idx] = items;
          if (left === 1) { for (var k = 0; k < results.length; k++) { collect(results[k] || []); } }
          finished();
        }
        if (ad.kind === 'm3u' || ad.kind === 'json') { fetchPlainCatalog(ad, store); }
        else { fetchAddonCatalogs(ad, taken, store); }
      });
    });
  }


  /* Search in the addons that offer it (catalogs with the "search" extra).
     done(list) once every addon answered; `each(list, pending)`, when given,
     gets the list so far after every answer, so the fast addons show first. */
  function searchStremioAddons(query, done, each, noAnime) {
    var cfg = getVodSourcesConfig();
    var jobs = [];
    for (var i = 0; i < cfg.addons.length; i++) {
      var ad = cfg.addons[i];
      for (var c = 0; c < (ad.catalogs || []).length; c++) {
        /* (noAnime: TMDB's trends, which never come from an anime list.) */
        if (ad.catalogs[c].search && !(noAnime && ad.catalogs[c].type === 'anime')) { jobs.push({ ad: ad, cat: ad.catalogs[c] }); }
      }
    }
    if (!jobs.length) { if (each) { each([], 0); } return done([]); }
    var results = [], left = jobs.length;
    function merged() {
      var out = [];
      for (var r = 0; r < results.length; r++) { out = out.concat(results[r] || []); }
      return rankSearchResults(query, out);
    }
    jobs.forEach(function (job, idx) {
      addonRequest(catalogUrl(job.ad.baseUrl, job.cat, 'search=' + encodeURIComponent(query)), function (err, payload) {
        var metas = (!err && payload && payload.metas) ? payload.metas : [];
        var recs = [];
        for (var m = 0; m < metas.length; m++) {
          var rec = stremioMetaToVodRecord(metas[m], job.ad.baseUrl, '', job.cat.type === 'anime');
          if (rec) { rec._searchOrder = m; recs.push(rec); }
        }
        results[idx] = recs;
        left--;
        if (each) { each(merged(), left); }
        if (left === 0) { done(merged()); }
      }, 12000);
    });
  }

  /* ---- Search order ----
     The addons answer in their own order (all the movies, then all the
     series). One list instead, best match first: the same title, then titles
     that start with the words, then whole words, then the rest; the addon's
     own order breaks ties. The same title from two addons (Cinemeta's and
     Kitsu's "Naruto") is shown once, the anime list's one. */
  function searchNorm(text) {
    return norm(String(text || '')).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function searchMatchScore(q, item) {
    var best = 0;
    var names = [item.title, item.alias, item._esTitle];
    for (var i = 0; i < names.length; i++) {
      var t = names[i] ? searchNorm(names[i]) : '';
      if (!t) { continue; }
      var s = 0;
      var tc = t.replace(/ /g, ''), qc = q.replace(/ /g, '');
      if (t === q) { s = 100; }
      /* "Intensa-Mente" for "intensamente": the same without spaces. */
      else if (tc === qc) { s = 95; }
      else if (qc.length >= 4 && tc.indexOf(qc) === 0) { s = 75; }
      else if (t.indexOf(q + ' ') === 0 || (t.indexOf(q) === 0 && q.length >= 4)) { s = 80; }
      else if ((' ' + t + ' ').indexOf(' ' + q + ' ') !== -1) { s = 65; }
      else if ((' ' + t).indexOf(' ' + q) !== -1) { s = 55; }
      else if (t.indexOf(q) !== -1) { s = 40; }
      else {
        var words = q.split(' '), hits = 0;
        for (var w = 0; w < words.length; w++) { if (words[w] && (' ' + t).indexOf(' ' + words[w]) !== -1) { hits++; } }
        s = words.length ? Math.round(30 * hits / words.length) : 0;
      }
      if (s > best) { best = s; }
    }
    return best;
  }

  function rankSearchResults(query, list) {
    var q = searchNorm(query);
    var seen = {}, byTitle = {}, rows = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || seen[it.id]) { continue; }
      seen[it.id] = true;
      var name = searchNorm(it.title);
      var key = name + '|' + String(it.year || '').slice(0, 4) + '|' + (isSeriesItem(it) ? 's' : 'm');
      /* (Also one record twice in an addon: same title, same poster.) */
      var keyArt = it.poster ? name + '|' + it.poster : '';
      var prev = byTitle[key] || (keyArt && byTitle[keyArt]);
      if (prev) {
        if (it._animeCat && !prev.item._animeCat) { prev.item = it; }
        continue;
      }
      var row = { item: it, at: rows.length };
      byTitle[key] = row;
      if (keyArt) { byTitle[keyArt] = row; }
      rows.push(row);
    }
    for (var r = 0; r < rows.length; r++) {
      var item = rows[r].item;
      /* No poster: usually an unknown or broken record, after the rest. */
      rows[r].score = searchMatchScore(q, item) + (item._searchBoost || 0) - Math.min(10, (item._searchOrder || 0) / 3) -
        (item.poster ? 0 : 25);
    }
    rows.sort(function (a, b) { return (b.score - a.score) || (a.at - b.at); });
    return rows.map(function (x) { return x.item; });
  }

  /* Titles in Spanish: Cinemeta only knows the English ones ("El padrino" →
     nothing). TMDB says the original title, which is then searched in the
     addons. done(list) with what it found (may be empty); never fails. */
  var SEARCH_TMDB_TITLES = 3;
  var SEARCH_TMDB_BOOST = 12;   /* above an exact title nobody knows */

  /* Latin letters only (the addons' titles): not "進撃の巨人". */
  function latinTitle(text) {
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) { if (s.charCodeAt(i) > 0x24f) { return false; } }
    return s.length > 0;
  }

  /* A result that is that TMDB title: its original title (or the Spanish
     one) and the same year, same kind. */
  function tmdbTitleIn(t, list) {
    var orig = titleKey(t.original), es = titleKey(t.title);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (!v || !!isSeriesItem(v) !== (t.kind === 'tv')) { continue; }
      var vt = titleKey(v.title);
      if (vt !== orig && vt !== es) { continue; }
      var y = String(v.year || '').match(/\d{4}/);
      if (t.year && y && Math.abs(parseInt(y[0], 10) - parseInt(t.year, 10)) <= 1) { return v; }
    }
    return null;
  }

  function searchByTranslatedTitle(query, have, done) {
    var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
    if (!api || norm(query).length < 3) { return done([]); }
    api('search:' + query).then(function (answer) {
      var hits = (answer && answer.items) || [];
      var q = searchNorm(query);
      var picked = [];
      for (var i = 0; i < hits.length && picked.length < SEARCH_TMDB_TITLES; i++) {
        var t = hits[i];
        /* Only the titles that are what was typed, in Spanish. */
        if (!t.title || searchMatchScore(q, { title: t.title }) < 55) { continue; }
        picked.push(t);
      }
      var out = [], jobs = [];
      picked.forEach(function (t, n) {
        var boost = SEARCH_TMDB_BOOST - n * 2;
        /* Already found (the plain search gave it): it goes up, named in
           Spanish too. Else its original title is searched. */
        var known = tmdbTitleIn(t, have);
        if (known) { known._esTitle = t.title; known._searchBoost = boost; return; }
        if (!t.original || titleKey(t.original) === titleKey(t.title) || !latinTitle(t.original)) { return; }
        jobs.push({ t: t, boost: boost });
      });
      if (!jobs.length) { return done(out); }
      var left = jobs.length;
      jobs.forEach(function (job) {
        searchStremioAddons(job.t.original, function (found) {
          var hit = tmdbTitleIn(job.t, found);
          if (hit) {
            hit._esTitle = job.t.title;
            hit._searchBoost = job.boost;
            out.push(hit);
          }
          if (--left === 0) { done(out); }
        });
      });
    }).catch(function () { done([]); });
  }

  function searchTitles(query, update) {
    var addonList = [], extra = [], addonsDone = false, extraDone = false;
    function emit() {
      update(rankSearchResults(query, extra.concat(addonList)), addonsDone && extraDone);
    }
    searchStremioAddons(query, function (list) {
      addonList = list;
      addonsDone = true;
      /* The translated titles are looked up once the plain search is in,
         so a title already found is not searched again. */
      searchByTranslatedTitle(query, addonList, function (found) {
        extra = found;
        extraDone = true;
        emit();
      });
      if (!extraDone) { emit(); }
    }, function (list, pending) {
      if (!pending) { return; }
      addonList = list;
      emit();
    });
  }

  /* Details (synopsis, seasons, episodes) from the first addon with "meta"
     for this title: the one it came from first. */
  function loadStremioMeta(item, done) {
    done = done || function () {};
    if (!item || !item._stremio || item._plain) { return done(item); }
    var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
    var sid = item._stremioId || String(item.id).replace(/^stremio:/, '');
    var cfg = getVodSourcesConfig();
    var bases = [];
    for (var i = 0; i < cfg.addons.length; i++) {
      if (addonSupports(cfg.addons[i], 'meta', type, sid)) {
        if (cfg.addons[i].baseUrl === item._stremioBase) { bases.unshift(cfg.addons[i].baseUrl); }
        else { bases.push(cfg.addons[i].baseUrl); }
      }
    }
    item._detailLoading = true;
    var idx = 0;
    function next() {
      if (idx >= bases.length) {
        item._detailLoading = false;
        item._detailsLoaded = true;
        if (isSeriesItem(item) && !(item.episodes && item.episodes.length)) {
          item._detailError = 'Ninguno de tus addons da los capítulos de esta serie';
        }
        if (state.detail === item && state.screen === 'detail') { buildDetail(item); }
        return done(item);
      }
      var base = bases[idx++];
      addonRequest(base + '/meta/' + encodeURIComponent(type) + '/' + encodeURIComponent(sid) + '.json', function (err, payload) {
        var meta = (!err && payload && payload.meta) ? payload.meta : null;
        if (!meta) { return next(); }
        applyStremioMeta(item, meta);
        item._detailLoading = false;
        item._detailsLoaded = true;
        if (state.detail === item && state.screen === 'detail') { buildDetail(item); }
        done(item);
      });
    }
    next();
  }

  function applyStremioMeta(item, meta) {
    if (meta.description) {
      /* Catalogue in Spanish (home/catalog-lang.js): the addon's English
         description is kept as the original, the Spanish one stays shown. */
      if (item._en && item._esShown) { item._en.synopsis = meta.description; }
      else { item.synopsis = meta.description; }
    }
    if (meta.runtime) { item.duration = meta.runtime; }
    if (meta.imdbRating) { item.score = String(meta.imdbRating); }
    if (meta.genres && meta.genres.length) { item.genres = meta.genres; }
    if (meta.background) { item.backdrop = meta.background; item.landscape = meta.background; }
    if (meta.cast && meta.cast.length) { item.actors = meta.cast.join(', '); }
    if (meta.director && meta.director.length) { item.director = [].concat(meta.director).join(', '); }
    if (!(meta.videos && meta.videos.length && isSeriesItem(item))) { return; }
    var seasonsMap = {}, seasonsList = [];
    for (var v = 0; v < meta.videos.length; v++) {
      var vid = meta.videos[v];
      var sNum = parseInt(vid.season, 10);
      if (!sNum || sNum < 1) { continue; }   /* season 0: extras */
      if (!seasonsMap[sNum]) {
        seasonsMap[sNum] = { id: item.id + ':S' + sNum, number: sNum, title: 'Temporada ' + sNum, _episodes: [] };
        seasonsList.push(seasonsMap[sNum]);
      }
      var epNum = parseInt(vid.episode || vid.number, 10) || (seasonsMap[sNum]._episodes.length + 1);
      seasonsMap[sNum]._episodes.push({
        id: vid.id || (item._stremioId + ':' + sNum + ':' + epNum),
        number: epNum,
        seriesNumber: epNum,
        title: vid.name || vid.title || ('Capítulo ' + epNum),
        synopsis: vid.overview || vid.description || '',
        thumb: vid.thumbnail || item.backdrop || item.poster || '',
        released: vid.released || ''
      });
    }
    seasonsList.sort(function (a, b) { return a.number - b.number; });
    for (var s = 0; s < seasonsList.length; s++) {
      seasonsList[s]._episodes.sort(function (a, b) { return a.number - b.number; });
      seasonsList[s].episodes = seasonsList[s]._episodes;
    }
    if (seasonsList.length) {
      item.seasons = seasonsList;
      item.episodes = seasonsList[0]._episodes;
      state.detailSeason = 0;
      state.detailEpisode = item.episodes[0] || null;
    }
  }

  /* "Seguir viendo" in Stremio mode: a title watched from a search or a row
     that is no longer in the catalog is rebuilt from its history record. */
  var stremioHistoryItems = {};
  function stremioItemFromHistory(r) {
    var key = String(r.id);
    if (stremioHistoryItems[key]) { return stremioHistoryItems[key]; }
    var item = stremioMetaToVodRecord({
      id: key.replace(/^stremio:/, ''), type: r.series ? 'series' : 'movie',
      name: r.title, poster: r.poster, background: r.landscape
    }, r.stremioBase || '', '');
    stremioHistoryItems[key] = item;
    return item;
  }

  /* ---- services/portal.js ---------------------------------------------------- */
  /* services/portal.js — Servicio local (IPC en escritorio / HTTP en Android):
     llamadas, errores y la carga del catálogo de los addons.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------ local service
     portalServiceCall reaches the bundled service: IPC in Electron
     (window.desktop.service), HTTP on 127.0.0.1 on Android (devServiceUrl). */
  function hasDesktopService() {
    return !!(window.desktop && typeof window.desktop.service === 'function');
  }

  function queryString(params) {
  var parts = [];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.join('&');
  }

  function describeServiceError(text) {
  return String(text == null ? '' : text);
  }

  var lastVodAttempt = { phase: 'sin intento', status: 'sin datos', error: '' };
  /* An error shown on screen must never expose a playable URL, signed query,
     token or request header: only a short, readable reason. */
  function reportSafeText(value) {
    var text = String(value == null ? '' : value);
    text = text.replace(/https?:\/\/[^\s"']+/ig, '[URL OCULTA]');
    text = text.replace(/(token|signature|authorization|cookie|key)=?[^\s,&]*/ig, '$1=[OCULTO]');
    text = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
    return text.slice(0, 150);
  }
  function vodFailure(phase, message) {
  var safe = reportSafeText(String(message || 'El servicio no devolvió los datos necesarios'));
  lastVodAttempt = { phase: phase, status: 'error', error: safe };
  state.streamError = 'No se pudo cargar ' + phase + ': ' + safe;
  setPlayerStatus(state.streamError);
  }
  document.addEventListener('opentv:playback-timeout', function () {
  if (state.playerMode === 'vod' && (state.screen === 'detail' || state.screen === 'player')) {
    vodFailure(lastVodAttempt.phase, 'La carga no terminó dentro de 30 segundos');
  }
  });

  function portalServiceCall(method, params, done, customTimeout) {
  var settled = false;
  var timeoutMs = customTimeout || parseInt(vodApi.timeoutMs, 10) || 20000;
  var callTimer = null;
  function finish(error, payload) {
    if (settled) { return; }
    settled = true;
    if (callTimer) { clearTimeout(callTimer); callTimer = null; }
    done(error ? describeServiceError(error) : error, payload);
  }
  callTimer = setTimeout(function () {
    finish('El servicio de la TV no respondió en ' + Math.round(timeoutMs / 1000) + ' s. Cierra y vuelve a abrir la aplicación de Windows.', null);
  }, timeoutMs + 1000);
  if (hasDesktopService()) {
    try {
      window.desktop.service(method, params || {}).then(function (payload) {
        if (!payload || payload.returnValue === false) {
          finish((payload && payload.errorText) || 'Error del servicio OpenTV', null);
        } else {
          finish(null, payload);
        }
      }, function () {
        finish('No se pudo contactar con el servicio local de Windows', null);
      });
      return true;
    } catch (e) {
      if (!vodApi.devServiceUrl) {
        finish('Error comunicando con el servicio: ' + (e.message || e), null);
        return false;
      }
    }
  }
  /* Android (and the browser harness): the same methods over plain HTTP. */
  if (vodApi.devServiceUrl) {
    apiRequest(String(vodApi.devServiceUrl).replace(/\/$/, '') + '/' + method + '?' + queryString(params || {}),
      function (error, payload) { finish(error, payload); }, null);
    return true;
  }
  finish('El servicio OpenTV no está disponible', null);
  return false;
  }

  /* The portal's kids section also carries mature anime (Tokyo Ghoul,
     Beastars...). Those titles keep their other sections but leave Kids. */
  var KIDS_BLOCKED_GENRES = /crime|crimen|thriller|suspense|erotic|adult|war\b|guerra|gore/;
  var KIDS_BLOCKED_TITLES = /tokyo ghoul|beastars|attack on titan|shingeki|death note|chainsaw|jujutsu|berserk|devilman|parasyte|kiseijuu|hellsing|elfen lied|kimetsu|demon slayer|hunter x hunter|akame|goblin slayer|psycho.?pass|vinland|banana fish|terror in resonance/;
  function notForKids(item) {
    var genres = item.genres || [];
    if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = [String(genres)]; }
    return KIDS_BLOCKED_GENRES.test(norm(genres.join(' '))) || KIDS_BLOCKED_TITLES.test(norm(item.title || ''));
  }
  function keepKidsSafe(item) {
    if (!item || String(item.category || '').indexOf('infantil') === -1 || !notForKids(item)) { return; }
    item.category = String(item.category).split(',').filter(function (c) { return c !== 'infantil'; }).join(',');
  }

  /* Movies and series: the viewer's addons. If none answers, the home says so. */
  function loadVodCatalog() {
    if (!vodApi.enabled) { return; }
    vodApiState.loading = true;
    syncExternalVodCatalogs(function (err, count) {
      vodApiState.loading = false;
      vodApiState.error = count ? null : (getVodSourcesConfig().addons.length ? 'Tus addons no respondieron' : 'Agrega un addon con catálogo');
    });
  }

  /* PC: the addons' catalogs are read again every 20 minutes so new titles
     appear without restarting. It waits until the viewer is not in the middle
     of browsing the home page, because a refresh rebuilds it. */
  var CATALOG_REFRESH_MS = 20 * 60 * 1000;
  var lastUserActivity = Date.now();
  var lastCatalogSync = Date.now();
  function startCatalogAutoRefresh() {
    if (!window.OPENTV_DESKTOP || vodApi.refresh === false) { return; }
    ['pointermove', 'keydown', 'wheel'].forEach(function (type) {
      document.addEventListener(type, function () { lastUserActivity = Date.now(); }, { passive: true, capture: true });
    });
    setInterval(function () {
      if (vodApiState.loading || Date.now() - lastCatalogSync < CATALOG_REFRESH_MS) { return; }
      var browsingHome = state.screen === 'home' && Date.now() - lastUserActivity < 60000;
      if (browsingHome) { return; }
      lastCatalogSync = Date.now();
      syncExternalVodCatalogs(function () {});
    }, 60000);
  }

  /* A title's full details: the addon's meta (episodes, cast…). Anything else
     already carries what it has. */
  function loadVodDetail(item, done) {
    done = done || function () {};
    if (!item) { return done(null); }
    if (item._detailsLoaded) { return done(item); }
    if (item._stremio) { return loadStremioMeta(item, done); }
    item._detailsLoaded = true;
    done(item);
  }

  /* ---- core/config.js -------------------------------------------------------- */
  /* core/config.js — Configuración estática: canales, pestañas del inicio y menú de ajustes.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Live TV comes only from the viewer's own M3U lists (live/channels.js).
     CHANNELS holds the channels of the category on screen. Do not draw
     fictitious rows while the lists load: they looked like real channels. */
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
  if (window.OPENTV_DESKTOP) {
    TABS = TABS.filter(function (t) { return t.icon !== 'novel' && t.icon !== 'compass' && t.action !== 'history'; });
    /* Top bar labels, like the big streaming apps. */
    var DESKTOP_TAB_LABELS = { 'TV': 'TV en vivo', 'DESTACADOS': 'Inicio', 'PELICULA': 'Películas', 'SERIES': 'Series', 'KIDS': 'Kids', 'ANIME': 'Anime' };
    TABS.forEach(function (t) { if (DESKTOP_TAB_LABELS[t.label]) { t.label = DESKTOP_TAB_LABELS[t.label]; } });
    /* A kids profile only sees Kids (no TV, no Inicio or Anime, which also
       carry titles for adults). */
    if (isKidsProfile()) { TABS = TABS.filter(function (t) { return t.page === 4; }); }
    /* TVs (Android TV, Fire TV): the same sections in a menu on the left;
       search, Mi lista and the account stay at the top
       right. Line icons in the style of the rest of the app. */
    if (platformIsTv()) {
      var TV_RAIL_ICONS = {
        tv: uiSvg('<rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M8 21h8"/>'),
        thumb: uiSvg('<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-6h4v6"/>'),
        film: uiSvg('<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M3 8h4.5M3 12h4.5M3 16h4.5M16.5 8H21M16.5 12H21M16.5 16H21"/>'),
        strip: uiSvg('<rect x="2.5" y="6.5" width="19" height="13" rx="2"/><path d="M8 2.5l4 4 4-4"/>'),
        kids: uiSvg('<circle cx="12" cy="13" r="7.5"/><circle cx="6" cy="5.5" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><path d="M9.5 15.5c1.4 1.3 3.6 1.3 5 0"/><path d="M9.5 11h.01M14.5 11h.01"/>'),
        anime: uiSvg('<path d="M12 3l2.4 5.6 6.1.6-4.6 4 1.4 6-5.3-3.2L6.7 19.2l1.4-6-4.6-4 6.1-.6z"/>')
      };
      TABS.forEach(function (t) { t.svg = TV_RAIL_ICONS[t.icon]; });
    }
  }

  var SETTINGS_ITEMS = [
    { id: 'profile', label: 'Mi cuenta' },
    { id: 'history', label: 'Mi lista' },
    { id: 'parent', label: 'Bloqueo' },
    { id: 'playback', label: 'Ajustes' },
    { id: 'sources', label: 'Addons' },
    { id: 'downloads', label: 'Descargas' },
    { id: 'feedback', label: 'Ayuda y Feedback' },
    { id: 'about', label: 'Sobre nosotros' }
  ];

  var SETTINGS_MENU_ICONS = {
    profile: '<svg viewBox="0 0 32 32"><circle cx="16" cy="10" r="5"/><path d="M6 27c.7-6 4.3-9 10-9s9.3 3 10 9"/></svg>',
    history: '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="9" height="9"/><rect x="19" y="4" width="9" height="9"/><rect x="4" y="19" width="9" height="9"/><rect x="19" y="19" width="9" height="9"/></svg>',
    parent: '<svg viewBox="0 0 32 32"><rect x="7" y="14" width="18" height="14" rx="2"/><path d="M11 14V10a5 5 0 0 1 10 0v4"/><path d="M16 19v4"/></svg>',
    playback: '<svg viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="3"/><path d="M13 11l8 5-8 5z"/></svg>',
    sources: '<svg viewBox="0 0 32 32"><path d="M16 4l12 6-12 6L4 10l12-6z"/><path d="M4 16l12 6 12-6"/><path d="M4 22l12 6 12-6"/></svg>',
    downloads: '<svg viewBox="0 0 32 32"><path d="M16 5v15"/><path d="M10 14l6 6 6-6"/><path d="M6 26h20"/></svg>',
    feedback: '<svg viewBox="0 0 32 32"><path d="M6 4h15l5 5v19H6z"/><path d="M20 4v6h6M10 16h12M10 21h8"/></svg>',
    about: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="12"/><path d="M16 14v8M16 10h.1"/></svg>'
  };

  /* Desktop: short labels that fit the menu and line icons like the rest of the app. */
  if (window.OPENTV_DESKTOP) {
    var DESKTOP_SETTINGS_LABELS = { playback: 'Ajustes', feedback: 'Ayuda', about: 'Acerca de' };
    /* The PIN lock was never available on Windows: no menu entry for it. */
    SETTINGS_ITEMS = SETTINGS_ITEMS.filter(function (it) { return it.id !== 'parent'; });
    SETTINGS_ITEMS.forEach(function (it) { if (DESKTOP_SETTINGS_LABELS[it.id]) { it.label = DESKTOP_SETTINGS_LABELS[it.id]; } });
    SETTINGS_MENU_ICONS = {
      profile: UI_ICONS.user, history: UI_ICONS.mylist, parent: UI_ICONS.lock,
      playback: UI_ICONS.settings, sources: UI_ICONS.addons, feedback: UI_ICONS.help, about: UI_ICONS.info,
      downloads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>'
    };
  }
  /* Descargas: only where the service can save files. Asked when Ajustes is
     built (Android confirms it after start-up). */
  function settingsItemsForDevice() {
    return SETTINGS_ITEMS.filter(function (it) { return it.id !== 'downloads' || platformHas('downloads'); });
  }

  /* ---- core/state.js --------------------------------------------------------- */
  /* core/state.js — Estado global de la app, perfil local (favoritos) y referencias a nodos del DOM.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ---------------------------------------------------------------- state */
  var state = {
    screen: 'welcome',
    tab: 0,
    channel: 0,
    focus: null,
    detail: null,
    detailReturn: null,
    detailRange: 0,
    detailSeason: 0,
    detailNeedsRebuild: false,
    playerReturn: null,
    playerMode: 'live',
    playerItem: null,
    playerEpisode: null,
    playerSeasonIndex: 0,
    episodeBrowserOpen: false,
    categoryPickerOpen: false,
    browserSeason: 0,
    streamError: '',
    streamMode: 'normal',
    trackIndex: 0,
    channelsOpen: false,
    infobar: true,
    infoTimer: null,
    searchQuery: '',
    searchNumeric: false,
    searchSeq: 0,
    searchFocus: null,
    playback: {
      streamMode: 'normal',
      screen: 1,   /* Formato de pantalla: Original (0 Llenar, 1 Original, 2 16:9, 3 4:3) */
      audio: 0,
      subLang: 0,
      size: 0,
      style: 0,
      subtitle: true
    },
    crOn: false,
    favs: {}
  };

  /* Desktop: the app opens on Inicio (the TV stays one tab away). */
  state.tab = homeTabIndex();

  /* A profile belongs to this TV only: no registration, credentials or
     network account is required.  It intentionally stays small because TV
     sticks have limited persistent storage. */
  var LOCAL_PROFILE_KEY = 'opentv_local_profile_v1';
  var LOCAL_PLAYBACK_KEY = 'opentv_global_playback_v1';
  var localProfile = { id: '', createdAt: 0, history: [] };

  function safeLocalRead(key, fallback) {
    try {
      var raw = localStorage.getItem(profileKey(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch (eRead) { return fallback; }
  }

  function safeLocalWrite(key, value) {
    try { localStorage.setItem(profileKey(key), JSON.stringify(value)); } catch (eWrite) { /* storage unavailable */ }
    if (window.OPENTV_DESKTOP && typeof scheduleProfilesBackup === 'function') { scheduleProfilesBackup(); }
  }

  function loadLocalProfile() {
    var savedPlayback = safeLocalRead(LOCAL_PLAYBACK_KEY, null);
    if (savedPlayback) {
      for (var pKey in state.playback) {
        if (state.playback.hasOwnProperty(pKey) && savedPlayback[pKey] !== undefined) {
          state.playback[pKey] = savedPlayback[pKey];
        }
      }
    }
    /* Desktop: Directo is the default. Older profiles saved Fluido globally;
       reset that once. Later choices in Ajustes are kept as usual. */
    if (window.OPENTV_DESKTOP && !safeLocalRead('opentv_direct_default_v1', false)) {
      state.playback.streamMode = 'normal';
      safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
      safeLocalWrite('opentv_direct_default_v1', true);
    }
    /* The default screen format is now Original (the film as it was made).
       Profiles still on the old default (Llenar pantalla) move to it once;
       a later choice in Ajustes is kept. */
    if (!safeLocalRead('opentv_aspect_original_v1', false)) {
      if (Number(state.playback.screen) === 0) { state.playback.screen = 1; }
      safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
      safeLocalWrite('opentv_aspect_original_v1', true);
    }
    var savedProfile = safeLocalRead(LOCAL_PROFILE_KEY, null);
    if (savedProfile && savedProfile.id) {
      localProfile = savedProfile;
      if (!localProfile.history || !localProfile.history.length) { localProfile.history = []; }
    } else {
      localProfile.id = 'TV-' + String(Date.now()).slice(-8);
      localProfile.createdAt = Date.now();
      safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    }
    if (!localProfile.favs) { localProfile.favs = {}; }
    state.favs = localProfile.favs;
    if (!localProfile.mylist) { localProfile.mylist = {}; }
    state.mylist = localProfile.mylist;
  }

  /* Mi lista (para ver después) and Mis favoritos keep a small copy of the
     title, so they still show when it is not in the loaded catalog (a search
     result, another catalog mode). Old favourites saved only `true`. */
  function itemSnapshot(item) {
    return {
      id: String(item.id),
      title: item.title || item.name || '',
      poster: item.poster || item.cover || '',
      series: !!isSeriesItem(item),
      stremio: !!item._stremio,
      stremioBase: item._stremioBase || '',
      at: Date.now()
    };
  }

  function inMyList(item) {
    return !!(item && item.id && state.mylist && state.mylist[String(item.id)]);
  }

  function toggleMyList(item) {
    if (!item || !item.id) { return false; }
    var key = String(item.id);
    var on = !state.mylist[key];
    if (on) { state.mylist[key] = itemSnapshot(item); }
    else { delete state.mylist[key]; }
    localProfile.mylist = state.mylist;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    return on;
  }

  function saveGlobalPlayback() {
    safeLocalWrite(LOCAL_PLAYBACK_KEY, state.playback);
  }

  function toggleFavorite(item) {
    if (!item || !item.id) { return false; }
    var key = String(item.id);
    var on = !state.favs[key];
    /* TV channels ('live:…') keep the plain flag the guide expects. */
    if (on) { state.favs[key] = key.indexOf('live:') === 0 ? true : itemSnapshot(item); }
    else { delete state.favs[key]; }
    localProfile.favs = state.favs;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    return on;
  }

  loadLocalProfile();

  var homeBuilt = false;
  var pagesEl, pages = [], tabEls = [], notifyEl;
  var liveRows = [], liveInfoText, liveMain, liveFocus, liveList;
  var detailLeft, detailPlayer, detailButtons, detailBottom;
  var searchKeyboard, searchHot, searchResults, searchEmpty, searchHotGrid,
      searchResultGrid, searchInput, searchNav, searchKeys = [];
  var settingsMenu, settingsRight, settingsPanels = {}, settingsItems = [];
  var historyViewTab = 'history';
  var playerStage, playerInfo, playerChannels, playerVideo, playerFrame, playerStatus, nextEpisodeLoading, playerChannelRows = {};
  /* Live category picker (all portal columns in one grid). */
  var categoryPicker = null, pcatGrid = null, pcatSub = null;
  /* Key of the category list currently painted in the rail, so switching a
     category only updates classes instead of rebuilding (and detaching) the
     focused pill. */
  var renderedCategoryKey = '';
  /* Low-memory TV sticks cannot keep a full 500–1000-row channel category in
     memory.  The side panel therefore owns only this small moving window. */
  var LIVE_PANEL_WINDOW = 48;
  var playerVodInfo, vodInfobarPoster, vodInfobarTitle, vodTimeCurrent, vodTimeTotal, vodSeekbar, vodSeekProgress, vodSeekBuffered, vodSeekThumb, playerOsdIcon;
  var vodScrubbing = false, vodScrubTime = 0;
  var welcomeTimer = null;

  /* ---- core/lite.js ---------------------------------------------------------- */
  /* core/lite.js — Modo ligero: menos efectos para equipos modestos (PC, TV, Fire TV).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* "Modo ligero" turns off the costly effects (background blur, the slow
     zoom of the big image, entrance animations, the enlarged card on hover)
     so menus stay fluid on modest hardware. On by default on TVs, off on the
     PC; Mi cuenta → Apariencia changes it. Shared by all profiles. */
  var LITE_KEY = 'opentv_lite_mode_v1';

  function liteMode() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LITE_KEY) || 'null'); } catch (eRead) { saved = null; }
    if (saved === true || saved === false) { return saved; }
    /* Android TV and Fire TV start light; the PC starts full. */
    return platformIsTv();
  }

  function applyLiteMode() {
    if (document.body) { document.body.classList.toggle('is-lite', liteMode()); }
  }

  function setLiteMode(on) {
    try { localStorage.setItem(LITE_KEY, JSON.stringify(!!on)); } catch (eSave) { /* storage off */ }
    applyLiteMode();
  }

  /* ---- core/focus.js --------------------------------------------------------- */
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

  /* ---- core/navigation.js ---------------------------------------------------- */
  /* core/navigation.js — Cambio de pantalla, "Volver" y manejador global de teclado / mando (handleKey).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ---------------------------------------------------------------- screen */
  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('is-active');
    }
    var target = $('screen-' + name);
    if (target) { target.classList.add('is-active'); }
    var previousScreen = state.screen;
    state.screen = name;
    if (window.OPENTV_DESKTOP && name !== 'player') { leaveLiveFullscreen(); }
    if (window.OPENTV_DESKTOP) { updateTitleBarSection(); if (name !== 'player' && updateStatus.state === 'ready') { showUpdateNotice(); } }
    if (historyDrawerOpen) { closeHistoryDrawer(true); }
    if (window.OPENTV_DESKTOP) {
      if (name === 'home') {
        /* Back from the full-screen TV player: keep the same video playing
           in the home preview instead of reloading the channel. */
        if (liveHandoff && liveHandoff.type === 'preview') { returnPreviewHome(); }
        if (previousScreen !== 'home') { refreshContinueRows(); if (TABS[state.tab]) { showHeroForPage(TABS[state.tab].page); } }
        if (TABS[state.tab] && TABS[state.tab].page > 0) { ensurePageBuilt(TABS[state.tab].page); }
        else if (previousScreen === 'player' && !borrowPlayerIntoHome() && state.playerMode === 'live' &&
                 !(liveHandoff && liveHandoff.type === 'player') && !keepFloatingVideo()) {
          /* The channel had not started yet (or was buffering), so it could not
             move into the home preview. Stop it: otherwise it kept playing,
             unseen, with sound, next to the preview. */
          liveChannelSeq++;
          if (liveChannelDebounceTimer) { clearTimeout(liveChannelDebounceTimer); liveChannelDebounceTimer = null; }
          stopPlayerVideo();
        }
      } else if (name !== 'player') {
        /* The home preview must not keep playing (with sound) behind other screens. */
        stopLivePreview();
      }
    }
    if (name !== 'player' && state.episodeBrowserOpen) { closeEpisodeBrowser(true); }
    if (name !== 'player' && state.categoryPickerOpen) { closeCategoryPicker(true); }
    if (name !== 'player' && name !== 'detail') {
      if (dialogPlaySettingsOpen) { closePlaySettingsDialog(); }
      if (playSettingViewOpen) { closePlaySettingView(); }
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      /* PiP keeps playing while browsing; a TV channel handed to the home
         preview keeps playing there. */
      if (!keepFloatingVideo() && !(liveHandoff && liveHandoff.type === 'player')) {
        stopPlayerVideo();
        stremioTorrentRelease();   /* frees the torrent's download (Stremio mode) */
      }
      /* Really leaving the player: drop the subtitle cues as well. */
      subtitleSeq++;
      activeSubtitleCues = [];
      if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
    }
    if (name === 'home' && state.focus) { syncHomeRail(state.focus); }
    schedulePosterMemoryPass();
  }

  var lastBackTime = 0;
  function back() {
    var now = Date.now();
    if (now - lastBackTime < 250) { return; }
    lastBackTime = now;
    if (historyDrawerOpen) { closeHistoryDrawer(); return; }
    if (sourcePickerOpen) { closeSourcePicker(); return; }
    if (typeof liveCatMenuOpen === 'function' && liveCatMenuOpen()) { closeLiveCatMenu(true); return; }
    /* The remote's Back (Fire TV, Android TV) closes the channel guide; it
       used to move the focus to the menu behind it, leaving the guide open. */
    if (liveGuideOpen) { closeLiveGuide(); return; }
    /* The audio/subtitle dialog can now open from the details screen too. */
    if (dialogPlaySettingsOpen) {
      closePlaySettingsDialog();
      return;
    }
    if (state.screen === 'player') {
      if (vodScrubbing) {
        leaveVodScrub(false);
        /* (TVs: Back during a glide cancels it and still leaves.) */
        if (!(platformIsTv() && window.OPENTV_DESKTOP)) { return; }
      }
      if (state.categoryPickerOpen) {
        lastBackTime = Date.now();
        closeCategoryPicker();
        return;
      }
      if (state.episodeBrowserOpen) {
        lastBackTime = Date.now();
        closeEpisodeBrowser();
        return;
      }
      if (playSettingViewOpen) {
        closePlaySettingView();
        return;
      }
      if (state.channelsOpen) {
        closeChannelPanel();
      } else if (platformIsTv() && window.OPENTV_DESKTOP) {
        /* TVs: Back leaves the player at once (hiding the controls first made
           it take several presses, as they come back with any key). */
        restorePlayerReturn();
      } else if (state.infobar) {
        hideInfobar();
      } else if (state.vodInfobarVisible) {
        hideVodInfobar();
      } else {
        restorePlayerReturn();
      }
      return;
    }
    if (state.screen === 'detail') {
      if (typeof closeSeasonPopup === 'function' && seasonPopup) {
        closeSeasonPopup();
        var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
        if (sBtn) { setFocus(sBtn); }
        return;
      }
      var scr = $('screen-detail');
      if (scr && scr.classList.contains('is-synopsis-open')) {
        toggleSynopsis();
        return;
      }
      if (!keepFloatingVideo()) { stopPlayerVideo(); }  /* PiP keeps playing while browsing */
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      var ret = state.detailReturn;
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
      return;
    }
    if (state.screen === 'search') {
      /* TVs: Back from the results goes up to the search field first (a long
         way with the arrows), then leaves. */
      if (platformIsTv() && window.OPENTV_DESKTOP && searchInput && state.focus && state.focus !== searchInput &&
          (closest(state.focus, '.search-results') || closest(state.focus, '.search-hot'))) {
        if (searchResults) { searchResults.scrollTop = 0; searchResults._tvTop = 0; }
        /* (Back to the on-screen keyboard, core/tv-keyboard.js.) */
        setFocus(searchTvKb ? searchTvKb.first : searchInput);
        return;
      }
      clearSearchState();
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'settings') {
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'home') {
      /* TVs: Back from the content returns to the menu on the left first. */
      if (platformIsTv() && window.OPENTV_DESKTOP && state.focus && !closest(state.focus, '.home-tabs') && tabEls[state.tab]) {
        setFocus(tabEls[state.tab]);
        return;
      }
      /* Back on the home screen goes to the first section first (Inicio on
         desktop, TV on the TV set). */
      if (state.tab !== homeTabIndex()) {
        selectTab(homeTabIndex(), true);
        if (tabEls[homeTabIndex()]) { setFocus(tabEls[homeTabIndex()]); }
        return;
      }
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.exitApp();   /* Android / Fire TV */
      }
    }
  }

  function activate() {
    if (!state.focus) { return; }
    if (state.focus.disabled || state.focus.getAttribute('aria-disabled') === 'true') { return; }
    if (state.focus._activate) { state.focus._activate(); }
  }

  function handleKey(e) {
    if (window.OPENTV_DESKTOP && e.target && closest(e.target, '.desktop-native-control') &&
        (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32)) { return; }
    /* Let real desktop text fields keep their caret, selection, paste and
       Backspace behaviour instead of treating them as TV remote commands. */
    if (window.OPENTV_DESKTOP && e.target &&
        (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    var k = e.keyCode || e.which;
    var key = e.key || '';
    var handled = true;

    /* Back buttons */
    var isBack = (k === 27 || k === 8 || key === 'Back' || key === 'GoBack' || key === 'Escape');
    if (isBack) {
      /* "¿Quién está viendo?" / the profile editor (screens/profiles-ui.js),
         or the on-screen keyboard over the channel guide (core/tv-keyboard.js). */
      if (profileOverlayBack() || tvKeyboardBack()) {
        lastBackTime = Date.now();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (sourcePickerOpen) {
        lastBackTime = Date.now();
        closeSourcePicker();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (state.categoryPickerOpen) {
        closeCategoryPicker();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (state.episodeBrowserOpen) {
        closeEpisodeBrowser();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (dialogAddonsOpen) {
        lastBackTime = Date.now();
        closeAddonsDialog();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (dialogPlaySettingsOpen) {
        /* A keyup can follow this keydown.  Mark it consumed, otherwise
           that second event sees the dialog closed and exits the detail page. */
        lastBackTime = Date.now();
        closePlaySettingsDialog();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (playSettingViewOpen) {
        lastBackTime = Date.now();
        closePlaySettingView();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      back();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }

    /* Live category picker: a full-screen grid owns the d-pad while open. */
    if (state.categoryPickerOpen) {
      if (k === 37) { moveFocus('left'); }
      else if (k === 38) { moveFocus('up'); }
      else if (k === 39) { moveFocus('right'); }
      else if (k === 40) { moveFocus('down'); }
      else if (k === 13 || k === 32) { activate(); }
      else { handled = false; }
      if (handled && e.preventDefault) { e.preventDefault(); }
      return;
    }

    /* Season/episode browser: it owns the d-pad while open. */
    if (state.episodeBrowserOpen) {
      var inSeasons = closest(state.focus, '#pe-seasons');
      var inEpisodes = closest(state.focus, '#pe-episodes');
      if (k === 37) {
        if (inEpisodes && peSeasonsCol && peSeasonsCol.style.display !== 'none') {
          var selSeason = peSeasons ? (peSeasons.children[state.browserSeason] || firstIn(peSeasons)) : null;
          if (selSeason) { setFocus(selSeason); }
        }
      } else if (k === 39) {
        if (inSeasons) {
          var curEp = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
          if (curEp) { setFocus(curEp); }
        }
      } else if (k === 38) {
        moveFocus('up');
      } else if (k === 40) {
        moveFocus('down');
      } else if (k === 13 || k === 32) {
        activate();
      } else {
        handled = false;
      }
      if (handled && e.preventDefault) { e.preventDefault(); }
      return;
    }

    /* Media Play / Pause / Seek keys on Android TV / Fire TV remotes */
    var isPlay = (k === 415 || key === 'MediaPlay' || key === 'Play');
    var isPause = (k === 19 || key === 'MediaPause' || key === 'Pause');
    var isPlayPause = (k === 10252 || key === 'MediaPlayPause');
    var isFwd = (k === 417 || key === 'MediaFastForward' || key === 'FastForward');
    var isRwd = (k === 412 || key === 'MediaRewind' || key === 'Rewind');
    var isStop = (k === 413 || key === 'MediaStop' || key === 'Stop');

    if (window.OPENTV_DESKTOP && !e.ctrlKey && !e.altKey && !e.metaKey && state.screen !== 'search') {
      if (k === 70 || key === 'f' || key === 'F') {
        if (window.desktop && window.desktop.fullscreen) { window.desktop.fullscreen(); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if ((k === 77 || key === 'm' || key === 'M') && state.screen === 'home' && onTvTab() && liveMuteBtn) {
        liveMuteBtn._activate();
        showLiveVolumeToast();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if ((k === 77 || key === 'm' || key === 'M') && playerVideo && window.OPENTV_DESKTOP && state.screen === 'player') {
        togglePlayerMute();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if ((k === 77 || key === 'm' || key === 'M') && playerVideo) {
        playerVideo.muted = !playerVideo.muted;
        setPlayerStatus(playerVideo.muted ? 'Audio silenciado (M)' : '');
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
    }

    if (state.screen === 'player') {
      if (isPlay) {
        if (playerVideo && playerVideo.paused) {
          resumePlayerPlayback();
          showOsdIcon('none');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPause) {
        if (playerVideo && !playerVideo.paused) {
          try { playerVideo.pause(); } catch (ePause) {}
          showOsdIcon('pause');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPlayPause) {
        togglePlayerPlayPause();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isFwd) {
        playerSeek(15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isRwd) {
        playerSeek(-15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isStop) {
        back();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
    }

    /* Menu / ContextMenu button to open in-player settings */
    var isMenu = (k === 457 || k === 93 || k === 467 || key === 'Menu' || key === 'ContextMenu');
    if (state.screen === 'player' && state.playerMode === 'vod' && isMenu) {
      if (dialogPlaySettingsOpen) {
        closePlaySettingsDialog();
      } else if (playSettingViewOpen) {
        closePlaySettingView();
      } else {
        openPlaySettingView();
      }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }

    if (state.screen === 'player' && (k === 37 || k === 38 || k === 39 || k === 40)) {
      if (dialogPlaySettingsOpen) {
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (playSettingViewOpen) {
        schedulePlaySettingHide();
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (state.playerMode === 'vod') {
        /* TVs: left/right glide through the film (hold to go faster). */
        if (platformIsTv() && (k === 37 || k === 39)) {
          tvSeekKey(k === 39 ? 1 : -1);
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (state.focus === vodSeekbar && vodScrubbing) {
          if (k === 37) { moveVodScrub(-1); if (e.preventDefault) { e.preventDefault(); } return; }
          if (k === 39) { moveVodScrub(1); if (e.preventDefault) { e.preventDefault(); } return; }
          if (k === 38 || k === 40) { leaveVodScrub(false); if (e.preventDefault) { e.preventDefault(); } return; }
        }
        if (k === 37) { playerSeek(-10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 39) { playerSeek(10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 40) {
          openPlaySettingView();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 38) {
          /* TVs: up only shows the controls (left/right already move through
             the film). */
          if (platformIsTv()) { showVodInfobar(); } else { enterVodScrub(); }
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
      } else {
        /* Some remote events arrive after the panel has painted but
           before its boolean state is restored.  Focus inside the visible
           panel is the authoritative signal, so Up never zaps from channel 1
           to the last channel while the channel list is on screen. */
        var channelPanelHasFocus = state.focus && closest(state.focus, '.player-channels');
        if (state.channelsOpen || channelPanelHasFocus) {
          /* The category rail is a real focus area, not a channel row.  It
             must receive the arrows first; otherwise Right was interpreted as
             "close panel" and Down reused the currently playing channel. */
          var focusIsCategory = state.focus && state.focus.classList &&
            state.focus.classList.contains('pc-cat-pill');
          if (focusIsCategory) {
            if (k === 37) { moveFocus('left'); }
            else if (k === 38) { moveFocus('up'); }
            else if (k === 39) { moveFocus('right'); }
            else if (k === 40) { moveFocus('down'); }
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 38) {
            var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
            if (curIdx === 0) {
              var selCat = playerChannels ? (playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill')) : null;
              if (selCat) { setFocus(selCat); }
            } else {
              var prev = curIdx - 1;
              focusPlayerChannel(prev);
            }
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 40) {
            var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
            var next = Math.min(CHANNELS.length - 1, curIdx + 1);
            focusPlayerChannel(next);
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          /* TVs open the list with → (it sits on the right), so ← closes it. */
          if (k === (platformIsTv() ? 37 : 39)) { closeChannelPanel(); if (e.preventDefault) { e.preventDefault(); } return; }
        } else if (platformIsTv() && window.OPENTV_DESKTOP) {
          /* TVs, the remote in the live player (shown on the banner):
             ↑ next channel · ↓ previous · → channel list · ← last channel. */
          if (k === 38 || k === 40) {
            var step = k === 38 ? 1 : -1;
            var n = CHANNELS.length;
            if (n) { setChannel((state.channel + step + n) % n, false); }
            showInfobar();
          } else if (k === 39) {
            hideInfobar();
            openChannelPanel();
          } else if (k === 37) {
            recallLastChannel();
          }
          if (e.preventDefault) { e.preventDefault(); }
          return;
        } else {
          if (k === 38) {
            if (state.channel > 0) { setChannel(state.channel - 1, false); }
            else if (CHANNELS.length) { setChannel(CHANNELS.length - 1, false); }
            showInfobar();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 40) {
            if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1, false); }
            else if (CHANNELS.length) { setChannel(0, false); }
            showInfobar();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (k === 37) {
            openChannelPanel();
            if (e.preventDefault) { e.preventDefault(); }
            return;
          }
          if (state.infobar) { scheduleInfoHide(); } else { showInfobar(); }
        }
      }
    }

    if (k === 37) { moveFocus('left'); }
    else if (k === 38) { moveFocus('up'); }
    else if (k === 39) { moveFocus('right'); }
    else if (k === 40) { moveFocus('down'); }
    else if (k === 13 || k === 32) {
      if (state.episodeBrowserOpen) {
        activate();
        return;
      }
      if (dialogPlaySettingsOpen) {
        activate();
      } else if (playSettingViewOpen) {
        schedulePlaySettingHide();
        activate();
      } else if (state.screen === 'player' && state.playerMode === 'vod' &&
                 state.focus === vodSeekbar && vodScrubbing) {
        /* OK belongs to the focused timeline, not to Play/Pause. */
        leaveVodScrub(true);
      } else if (state.screen === 'player' && state.streamError && playerVideo && playerVideo.src &&
                 !closest(state.focus, '.player-channels')) {
        /* OK retries the failed stream, but only from the video surface: with
           the channel panel open it must activate the focused row/pill, or a
           dead channel made every category unfilterable. */
        resumePlayerPlayback();
        state.streamError = '';
        setPlayerStatus('');
      } else if (state.screen === 'player' && state.playerMode === 'vod') {
        togglePlayerPlayPause();
      } else {
        activate();
      }
    }
    else { handled = false; }
    if (handled && e.preventDefault) { e.preventDefault(); }
  }

  /* ---- screens/welcome.js ---------------------------------------------------- */
  /* screens/welcome.js — Pantalla de bienvenida.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ================================================================ WELCOME */
  function startWelcome() {
    var img = $('welcome-loading-img');
    var frame = 1;
    welcomeTimer = setInterval(function () {
      frame++;
      if (frame > (window.OPENTV_DESKTOP ? 9 : 16)) { finishWelcome(); return; }
      img.src = 'assets/original/welcome/img_welcome_loading' + frame + '.png';
    }, 250);
  }

  function finishWelcome() {
    if (welcomeTimer) { clearInterval(welcomeTimer); welcomeTimer = null; }
    if (!homeBuilt) { buildHome(); }
    showScreen('home');
    /* Desktop opens on Inicio (also where Ctrl+H goes); the TV opens on TV. */
    var startTab = homeTabIndex();
    selectTab(startTab, false);
    if (TABS[startTab] && TABS[startTab].page === 0) { setFocus(liveFocus); }
    else {
      var first = pages[TABS[startTab].page] ? firstIn(pages[TABS[startTab].page]) : null;
      setFocus(first || tabEls[startTab], true);
    }
    /* The first launch shows the full tab labels even though the video holds
       focus; the rail collapses on the first focus change. */
    var rail = $('home-tabs');
    if (rail) { rail.classList.add('is-expanded'); rail.classList.remove('is-collapsed'); }
    /* First launch: the short guide (later, Ajustes → Ayuda). */
    maybeShowFirstRunGuide();
    if (!window.OPENTV_DESKTOP) {
      var railBg = document.querySelector('.home-sidebar-bg');
      if (railBg) { railBg.classList.add('is-on'); }
      var homeScreen = $('screen-home');
      if (homeScreen) { homeScreen.classList.add('is-rail-open'); }
    }
  }

  /* ---- screens/home.js ------------------------------------------------------- */
  /* screens/home.js — Inicio: construcción de páginas, rail de pestañas, barra superior y reloj.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* =================================================================== HOME */
  var pageDefs = [buildLivePage, buildFeaturedPage, buildMoviesPage, buildSeriesPage,
                  buildKidsPage, buildAnimePage, buildNovelsPage, buildExplorePage];
  var pagesBuilt = {};

  var pageBuiltAt = {};
  var catalogStaleAt = 0;

  function ensurePageBuilt(idx) {
    var rebuilt = false, hadFocus = false, focusId = null, keepScroll = 0;
    if (pagesBuilt[idx] && (pageBuiltAt[idx] || 0) < catalogStaleAt && idx > 0) {
      /* Built with an older catalog (or with covers that turned out broken,
         or before this week's trends arrived). */
      hadFocus = !!(state.focus && pages[idx].contains(state.focus));
      focusId = hadFocus && state.focus._item ? String(state.focus._item.id) : null;
      keepScroll = pages[idx].scrollTop;
      clear(pages[idx]);
      pages[idx].scrollTop = 0;
      pages[idx]._tvLine = null;
      pagesBuilt[idx] = false;
      rebuilt = true;
    }
    if (pagesBuilt[idx] || !pages[idx] || !pageDefs[idx]) { return; }
    pagesBuilt[idx] = true;
    pageBuiltAt[idx] = catalogStaleAt || Date.now();
    pageDefs[idx](pages[idx]);
    /* The remote was on this page: keep it on the same title (or on the first
       element) instead of on a node that no longer exists. */
    if (rebuilt && hadFocus) {
      var again = null;
      if (focusId !== null) {
        var tiles = pages[idx].querySelectorAll('.focusable');
        for (var i = 0; i < tiles.length && !again; i++) {
          if (tiles[i]._item && String(tiles[i]._item.id) === focusId && isVisible(tiles[i])) { again = tiles[i]; }
        }
      }
      if (!again) { pages[idx].scrollTop = keepScroll; }
      setFocus(again || firstIn(pages[idx]) || tabEls[state.tab]);
    }
  }

  /* Desktop: a new catalog (or a broken cover) refreshes the VOD pages. */
  function markCatalogPagesStale() {
    catalogStaleAt = Math.max(Date.now() + 1, catalogStaleAt + 1);
    var current = TABS[state.tab] ? TABS[state.tab].page : 0;
    /* TVs: a refresh in the background (every 20 min) rebuilt the section on
       screen in front of the viewer, a short flash like a reload. After the
       first minute (when the real catalogue replaces the saved one) it is
       redrawn the next time the section is opened instead. */
    var onScreen = state.screen === 'home' && pagesBuilt[current];
    if (platformIsTv() && onScreen && window.performance && performance.now() > 60000) { return; }
    if (current > 0 && pages[current]) {
      ensurePageBuilt(current);
      if (window.OPENTV_DESKTOP && state.screen === 'home') { showHeroForPage(current); }
    }
  }

  function buildHome() {
    homeBuilt = true;
    pagesEl = $('home-pages');
    notifyEl = $('home-notify');
    clear(pagesEl);
    pages = [];
    pagesBuilt = {};

    /* Create placeholder wrappers for each tab, but build DOM only on demand */
    for (var i = 0; i < pageDefs.length; i++) {
      var page = el('div', 'home-page scrollable');
      if (window.OPENTV_DESKTOP) {
        /* Top bar: solid once the page scrolls (pages without a hero too). */
        page.addEventListener('scroll', function () {
          if (this.classList.contains('is-current')) { document.body.classList.toggle('is-home-scrolled', this.scrollTop > 140); }
        }, { passive: true });
      }
      if (i === 0) { page.classList.add('is-current'); }
      pagesEl.appendChild(page);
      pages.push(page);
    }

    var initialTab = (TABS[state.tab] && TABS[state.tab].page >= 0) ? TABS[state.tab].page : 0;
    ensurePageBuilt(initialTab);

    buildTabs();
    buildNotify();
  }

  function buildTabs() {
    var host = $('home-tabs');
    clear(host);
    host.classList.add('scrollable');
    host.classList.add('is-expanded');
    tabEls = [];
    /* TVs: a vertical menu on the left. Moving through it
       only previews the section once the remote rests on it, so holding the
       arrow does not build every page on the way. */
    var railTv = platformIsTv();
    var railTimer = null;
    function railPreview(idx) {
      if (railTimer) { clearTimeout(railTimer); }
      railTimer = setTimeout(function () {
        railTimer = null;
        if (state.focus === tabEls[idx] && state.screen === 'home') { selectTab(idx, false); }
      }, 280);
    }
    function railMoveTo(idx) {
      if (!tabEls[idx]) { return; }
      setFocus(tabEls[idx]);
      if (railTv) { railPreview(idx); } else { selectTab(idx, false); }
    }
    function enterTab(idx) {
      if (railTimer) { clearTimeout(railTimer); railTimer = null; }
      if (TABS[idx].action) {
        runTabAction(TABS[idx].action);
        return;
      }
      selectTab(idx, false);
      if (TABS[idx].page === 0) {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        else if (liveRows.length) { setFocus(liveRows[0]); }
        else if (liveFocus) { setFocus(liveFocus); }
      } else if (TABS[idx].page >= 0) {
        /* Back into the same section (from the menu): where the viewer was,
           the page as it was; the first element only for a section just
           opened (selectTab forgets the place when the section changes). */
        var pg = pages[TABS[idx].page];
        var last = pg && pg._lastFocus;
        if (last && last.isConnected && pg.contains(last) && isVisible(last)) { setFocus(last); return; }
        var f = firstIn(pg);
        if (f) { setFocus(f); }
      }
    }
    for (var i = 0; i < TABS.length; i++) {
      var item = el('div', 'tab-item focusable');
      item.appendChild(el('div', 'tab-pill'));
      var icon = el('div', 'tab-icon');
      icon.innerHTML = TABS[i].svg || TAB_ICONS[TABS[i].icon] || '';
      item.appendChild(icon);
      var title = el('div', 'tab-title', TABS[i].label);
      item.appendChild(title);
      item._tab = i;
      item._activate = (function (idx) {
        return function () { enterTab(idx); };
      })(i);
      item._onMove = (function (idx) {
        return function (dir) {
          if (railTv) {
            if (dir === 'up') { railMoveTo(idx - 1); return true; }
            if (dir === 'down') { railMoveTo(idx + 1); return true; }
            if (dir === 'left') { return true; }
            if (dir === 'right') { enterTab(idx); return true; }
            return false;
          }
          /* Desktop: the tabs are a horizontal bar at the top (left/right
             change tab, down goes into the page). */
          if (window.OPENTV_DESKTOP) {
            if (dir === 'up') { return true; }
            if (dir === 'down') { dir = 'right'; }
            else if (dir === 'left') {
              if (idx > 0 && tabEls[idx - 1]) { setFocus(tabEls[idx - 1]); selectTab(idx - 1, false); }
              return true;
            } else if (dir === 'right') {
              if (idx < tabEls.length - 1 && tabEls[idx + 1]) { setFocus(tabEls[idx + 1]); selectTab(idx + 1, false); }
              return true;
            }
          }
          if (dir === 'up') {
            if (idx > 0 && tabEls[idx - 1]) {
              setFocus(tabEls[idx - 1]);
              selectTab(idx - 1, false);
            }
            return true;
          }
          if (dir === 'down') {
            if (idx < tabEls.length - 1 && tabEls[idx + 1]) {
              setFocus(tabEls[idx + 1]);
              selectTab(idx + 1, false);
            }
            return true;
          }
          if (dir === 'left') {
            return true;
          }
          if (dir === 'right') {
            if (TABS[idx].action === 'history') {
              historyViewTab = 'history';
              openSettings();
              showSettingsPanel(1, true);
              return true;
            }
            selectTab(idx, false);
            if (idx === 0) {
              var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
              if (row) { setFocus(row); }
              else if (liveRows.length) { setFocus(liveRows[0]); }
              else if (liveFocus) { setFocus(liveFocus); }
            } else if (TABS[idx].page >= 0) {
              var page = pages[TABS[idx].page];
              var f = firstIn(page);
              if (f) { setFocus(f); }
            }
            return true;
          }
          return false;
        };
      })(i);
      host.appendChild(item);
      tabEls.push(item);
    }
  }

  /* Rail entries that open a screen instead of a section (HISTORIAL on the
     old TV layout). */
  function runTabAction(action) {
    if (action === 'history') {
      historyViewTab = 'history';
      openSettings();
      showSettingsPanel(1, true);
    }
  }

  function buildNotify() {
    clear(notifyEl);
    /* Keep the compact controls used in the home screen: search, filter and
       profile.  The record shortcut and message bell are intentionally not
       shown here; history lives under Mi lista. */
    var defs = [
      { cls: 'search', icon: 'assets/original/home/icon_notify_search.png', small: true },
      { cls: 'filter', icon: 'assets/original/search/icon_category_filter_n.png', small: true },
      { cls: 'personal', icon: 'assets/original/home/icon_notify_personal.png', small: true }
    ];
    if (window.OPENTV_DESKTOP) {
      defs = [
        { cls: 'search' + (isKidsProfile() ? ' is-hidden-kids' : ''), svg: UI_ICONS.search, tip: 'Buscar (Ctrl+F)', small: true, run: function () { openSearch(); } },
        { cls: 'mylist', svg: UI_ICONS.mylist, tip: 'Mi lista', small: true,
          run: function () { openSettings(); showSettingsPanel(1, true); } },
        { cls: 'personal', svg: UI_ICONS.user, tip: 'Mi cuenta y ajustes', small: true, run: function () { openSettings(); } }
      ];
    }
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var item = el('div', 'notify-item focusable ' + d.cls + (d.small ? ' is-small' : ''));
      var nn = el('div', 'n-normal');
      if (d.svg) {
        nn.innerHTML = d.svg;
        nn.classList.add('is-svg');
        item.setAttribute('data-tip', d.tip);
        item.setAttribute('aria-label', d.tip);
        item._activate = d.run;
        item.appendChild(nn);
        notifyEl.appendChild(item);
        continue;
      }
      nn.style.backgroundImage = 'url(' + d.icon + ')';
      item.appendChild(nn);
      if (d.cls === 'personal') {
        item._activate = function () { openSettings(); };
      } else if (d.cls === 'search') {
        item._activate = function () { openSearch(); };
      } else {
        item.setAttribute('aria-disabled', 'true');
        item.title = 'Filtros no disponibles en esta versión. Usa la búsqueda por título.';
      }
      notifyEl.appendChild(item);
    }
    var div = el('div', 'notify-divider');
    notifyEl.appendChild(div);
    var wifi = el('div', 'notify-wifi');
    wifi.innerHTML = '<svg viewBox="0 0 30 22"><path d="M15 19.5a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z" fill="currentColor"/><path d="M8.4 12.2a9.6 9.6 0 0 1 13.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.2 7.6a15.6 15.6 0 0 1 21.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    notifyEl.appendChild(wifi);
    var time = el('div', 'notify-time');
    time.id = 'notify-time';
    notifyEl.appendChild(time);
    updateClock();
    scheduleClockTick();
    /* Back from another app or from standby: the right time at once. */
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { updateClock(); } });
    if (window.OPENTV_DESKTOP) { refreshProfileChrome(); }
  }

  /* The clock changes right when the device's minute does (it ran on a
     30-second timer from the app's start, up to half a minute behind the
     Fire TV's own clock). */
  function scheduleClockTick() {
    var now = new Date();
    var wait = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(function () { updateClock(); scheduleClockTick(); }, wait);
  }

  function updateClock() {
    var t = $('notify-time');
    if (!t) { return; }
    var d = new Date();
    var h = d.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) { h = 12; }
    var m = d.getMinutes();
    t.textContent = h + ':' + pad2(m) + ' ' + ap;
  }

  function selectTab(index, focusContent) {
    var def = TABS[index];
    /* Action rows are opened with OK/Right. Merely moving through the rail
       must not throw the user out of Home before they confirm the choice. */
    if (!def || def.action) { return; }
    var prevPage = TABS[state.tab] ? TABS[state.tab].page : def.page;
    state.tab = index;
    if (window.OPENTV_DESKTOP) { updateTitleBarSection(); }
    for (var i = 0; i < tabEls.length; i++) {
      tabEls[i].classList.toggle('is-selected', i === index);
    }
    syncTvSectionLabel(state.focus);
    if (def.page >= 0) {
      ensurePageBuilt(def.page);
      if (window.OPENTV_DESKTOP) { showHeroForPage(def.page); }
    }
    if (def.page === 0) {
      scheduleLivePreview(CHANNELS[state.channel]);
    } else {
      stopLivePreview();
    }
    /* A different section: the place kept in the one left is forgotten (it
       opens again at its start, like now). */
    if (def.page !== prevPage && pages[prevPage]) { pages[prevPage]._lastFocus = null; }
    for (var p = 0; p < pages.length; p++) {
      pages[p].classList.remove('is-entering', 'from-left', 'from-right');
      pages[p].classList.toggle('is-current', p === def.page);
      /* Desktop: a section opened from the tab bar starts at its top (once it
         is displayed: a hidden page ignores scrollTop). */
      if (window.OPENTV_DESKTOP && p === def.page && def.page !== prevPage && def.page > 0) { pages[p].scrollTop = 0; pages[p]._tvLine = null; }
    }
    /* Same slide direction as the ViewPager; the page itself is the only
       visible layer, which keeps its raster sharp on TVs. */
    if (def.page !== prevPage && pages[def.page]) {
      var pg = pages[def.page];
      pg.classList.add('is-entering', def.page > prevPage ? 'from-right' : 'from-left');
      setTimeout(function () {
        pg.classList.remove('is-entering', 'from-left', 'from-right');
        /* Posters that were off screen during the slide load now. */
        schedulePosterMemoryPass();
      }, window.OPENTV_DESKTOP ? 400 : 320);
    }
    if (focusContent) {
      if (def.page === 0) {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        else if (liveRows.length) { setFocus(liveRows[0]); }
        else if (liveFocus) { setFocus(liveFocus); }
      } else {
        var f = firstIn(pages[def.page]);
        if (f) { setFocus(f); }
      }
    }
    schedulePosterMemoryPass();
  }

  /* ---- home/posters.js ------------------------------------------------------- */
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
  /* PC (Electron) does the same in its main process (platforms/electron/
     sized-images.cjs, opentv-img://): episode pictures came from 825 px to
     4K and the big ones, shrunk by the page, looked rough next to the rest. */
  var nativeImageSizer = /OpenTVImg\/\d/.test(navigator.userAgent || '') ? 'https://opentv-img.local/i'
    : (window.desktop && typeof window.desktop.imageSizer === 'string' ? window.desktop.imageSizer : '');
  function sizedImageUrl(url, w) {
    if (!nativeImageSizer || !url || !w || !/^https?:\/\//i.test(url)) { return url; }
    var px = Math.round(w * (window.innerWidth || 1920) / 1920 * (window.devicePixelRatio || 1));
    /* (A few sizes only, so a resized window does not fill the cache.) */
    px = Math.min(3840, Math.ceil(px / 40) * 40);
    return nativeImageSizer + '?w=' + px + '&u=' + encodeURIComponent(url);
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
      if (window.OPENTV_DESKTOP) { return; }
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
    var sel = window.OPENTV_DESKTOP ? 'img[data-poster-src]:not([src])' : 'img[data-poster-src]';
    /* TVs: only the posters of the page on screen, and rows far from the
       scroll position are skipped by their written position (measuring
       hundreds of catalogue posters after every key press cost ~18 ms). */
    var tvPage = null;
    if (platformIsTv() && window.OPENTV_DESKTOP && state.screen === 'home') {
      tvPage = document.querySelector('.home-page.is-current');
    }
    if (tvPage) {
      refreshTvPagePosters(tvPage, sel);
      return;
    }
    var imgs = document.querySelectorAll(sel);
    var viewW = window.innerWidth || 1920;
    var viewH = window.innerHeight || 1080;
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var tile = closest(img, '.poster, .bento, .continue-card');
      var r = tile && tile.getBoundingClientRect ? tile.getBoundingClientRect() : null;
      var marginY = window.OPENTV_DESKTOP ? viewH : 420;
      var marginX = window.OPENTV_DESKTOP ? viewW / 2 : 320;
      var near = posterBelongsToVisiblePage(img) && r &&
        r.bottom > -marginY && r.top < viewH + marginY && r.right > -marginX && r.left < viewW + marginX;
      if (near) {
        if (!img.getAttribute('src')) {
          img.style.display = '';
          img.src = tileImageUrl(img);
        }
      } else if (img.getAttribute('src') && !window.OPENTV_DESKTOP) {
        /* (TV only: a PC has memory to spare, and reloading on the way back
           left posters blank while they downloaded again.) */
        /* Removing the source gives Starfish a chance to release the decoded
           texture instead of keeping whole catalog pages resident in RAM. */
        img.removeAttribute('src');
        try { img.src = ''; } catch (eRelease) { /* ignore */ }
      }
    }
  }

  /* TVs, home page on screen: which posters get their image comes from the
     positions written on the rows and cells (top/left, the row's slide in
     strip._tvX) and one read of the page's scroll. Measuring every tile with
     getBoundingClientRect cost ~40 ms after each key press on a Fire TV.
     Same margins as the measured version (half a screen sideways, a whole
     screen up/down), so posters are usually ready before the focus gets
     there. Loaded posters are kept, as before. All in canvas pixels. */
  var TV_POSTER_LOAD_X = 960, TV_POSTER_LOAD_Y = 1080;
  function refreshTvPagePosters(page, sel) {
    var top0 = page.scrollTop;
    var viewH = page._tvClientH || page.clientHeight || 1080;
    var lines = page.children;
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l];
      var lineTop = parseFloat(line.style.top);
      var lineH = parseFloat(line.style.height) || 0;
      if (isNaN(lineTop)) { continue; }
      /* Distance from the line to the visible band (0 when on screen). */
      var gapY = lineTop + lineH < top0 ? top0 - (lineTop + lineH)
        : (lineTop > top0 + viewH ? lineTop - (top0 + viewH) : 0);
      if (gapY > TV_POSTER_LOAD_Y) { continue; }
      var strip = line.querySelector('.d-row-strip');
      var stripX = strip ? (strip._tvX || 0) : 0;
      var stripW = strip ? (strip._tvClientW || parseFloat(strip.style.width) || 1920) : 1920;
      var imgs = line.querySelectorAll(sel);
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var gapX = 0;
        if (strip) {
          var cell = childOf(img, strip);
          var cellLeft = cell ? parseFloat(cell.style.left) : NaN;
          var cellW = cell ? (parseFloat(cell.style.width) || 0) : 0;
          if (!isNaN(cellLeft)) {
            var x = cellLeft - stripX;
            gapX = x + cellW < 0 ? -(x + cellW) : (x > stripW ? x - stripW : 0);
          }
        }
        if (gapX <= TV_POSTER_LOAD_X && !img.getAttribute('src')) {
          img.style.display = '';
          img.src = tileImageUrl(img);
        }
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
    if (!window.OPENTV_DESKTOP || !item || item.id === undefined) { return; }
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
    if (!window.OPENTV_DESKTOP || !list) { return list; }
    var out = [];
    for (var i = 0; i < list.length; i++) { if (hasUsableCover(list[i])) { out.push(list[i]); } }
    return out.length ? out : list;
  }
  /* OpenTV generic cover: dark card, logo and the title. */
  function applyGenericCover(tile, item) {
    if (!window.OPENTV_DESKTOP || !tile || tile._generic) { return; }
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
    if (window.OPENTV_DESKTOP && tries < 2) {
      img._posterRetries = tries + 1;
      setTimeout(function () {
        var src = img.getAttribute('data-poster-src');
        if (!src || !img.isConnected) { return; }
        img.removeAttribute('src');
        /* First retry with the picture itself: a failure of the resizer must
           not mark a good cover as broken. */
        img.src = tries === 0 && nativeImageSizer ? src : tileImageUrl(img);
      }, 1500 * (tries + 1));
      return;
    }
    var tile = img.parentNode;
    if (window.OPENTV_DESKTOP && tile && tile.classList) {
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
    if (window.OPENTV_DESKTOP && !item.poster) { applyGenericCover(p, item); }
    if (window.OPENTV_DESKTOP && item.title) { p.appendChild(el('div', 'p-hover', item.title)); }
    p._activate = function () { openDetail(item); };
    schedulePosterMemoryPass();
    return p;
  }

  /* ---- home/live-page.js ----------------------------------------------------- */
  /* home/live-page.js — Página TV del inicio (vista previa del canal y lista).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* PC: a channel list's up/down arrows sat over the first and last rows
     even with nothing more to scroll that way. Each one hides at its end. */
  function bindScrollArrows(list, up, down) {
    var pending = false;
    function sync() {
      pending = false;
      var max = list.scrollHeight - list.clientHeight;
      var upOff = list.scrollTop <= 2, downOff = max <= 2 || list.scrollTop >= max - 2;
      /* (A hidden arrow is not a keyboard stop either.) */
      up.classList.toggle('is-off', upOff); up.classList.toggle('focusable', !upOff);
      down.classList.toggle('is-off', downOff); down.classList.toggle('focusable', !downOff);
    }
    function later() {
      if (pending) { return; }
      pending = true;
      (window.requestAnimationFrame || setTimeout)(sync);
    }
    list.addEventListener('scroll', later, { passive: true });
    if (window.MutationObserver) { new MutationObserver(later).observe(list, { childList: true }); }
    window.addEventListener('resize', later);
    later();
  }

  /* PC and TV (design "3A"): the channel list on the left (search, category chips,
     channels), the video in a 16:9 card on the right and, under it, the
     channel's name and the controls, so nothing covers the picture. */
  var liveUnder = null;

  function liveSideLayout() { return !!window.OPENTV_DESKTOP; }

  /* The channel's name on the preview and, on PC, the line under the video. */
  function setLiveInfoText(text) {
    if (liveInfoText) { liveInfoText.textContent = text || ''; }
    syncLiveUnder();
  }

  function syncLiveUnder() {
    if (!liveUnder) { return; }
    var ch = CHANNELS[state.channel];
    var logo = liveUnder._logo, name = liveUnder._name, meta = liveUnder._meta;
    clear(logo);
    if (!ch) {
      name.textContent = '';
      meta.textContent = '';
      liveUnder.classList.add('is-empty');
      return;
    }
    liveUnder.classList.remove('is-empty');
    if (ch.logo) {
      var img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.src = ch.logo;
      img.onerror = function () { clear(logo); logo.textContent = String(ch.name || '?').charAt(0).toUpperCase(); };
      logo.appendChild(img);
    } else {
      logo.textContent = String(ch.name || '?').charAt(0).toUpperCase();
    }
    name.textContent = ch.name || '';
    meta.textContent = 'Canal ' + (state.channel + 1) + '  ·  ' + liveChannelGroups(ch).join(', ');
  }

  /* ------------------------------------------------------------- home live */
  function buildLivePage(page) {
    var pcLayout = liveSideLayout();
    if (pcLayout) { page.classList.add('live-3a'); }
    liveMain = el('div', 'live-main');
    livePreviewVideo = document.createElement('video');
    livePreviewVideo.className = 'live-preview-video';
    livePreviewVideo.preload = 'auto';
    livePreviewVideo.muted = true;
    livePreviewVideo.volume = 0;
    livePreviewVideo.setAttribute('muted', 'muted');
    livePreviewVideo.setAttribute('playsinline', '');
    livePreviewVideo.setAttribute('webkit-playsinline', '');
    liveMain.appendChild(livePreviewVideo);
    liveMain.appendChild(el('div', 'live-frame'));
    liveMain.appendChild(el('div', 'live-logo'));
    livePreviewStatus = el('div', 'live-preview-status');
    liveMain.appendChild(livePreviewStatus);
    if (pcLayout) { liveMain.appendChild(el('span', 'live-badge', 'EN VIVO')); }
    page.appendChild(liveMain);

    var info = el('div', 'live-info');
    liveInfoText = el('div', 'live-channel');
    /* mTvChannel is layout_toLeftOf mIvFullScreen (alignParentRight), so the
       channel name is right-aligned, not left-aligned. */
    liveInfoText.style.right = '112.5px';
    info.appendChild(liveInfoText);
    var full = el('div', 'live-fullscreen focusable');
    full._activate = function () { openPlayer('live'); };
    info.appendChild(full);
    liveMain.appendChild(info);

    var up = el('div', 'live-arrow-up focusable');
    var down = el('div', 'live-arrow-down focusable');
    up.title = 'Desplazar canales hacia arriba';
    down.title = 'Desplazar canales hacia abajo';
    if (window.OPENTV_DESKTOP) {
      up.innerHTML = UI_ICONS.chevronUp;
      down.innerHTML = UI_ICONS.chevronDown;
      up._activate = function () {
        if (liveList) { liveList.scrollBy({ top: -360, behavior: 'smooth' }); }
      };
      down._activate = function () {
        if (liveList) { liveList.scrollBy({ top: 360, behavior: 'smooth' }); }
      };
    } else {
      up._activate = function () { setChannel(state.channel - 1, true); };
      down._activate = function () { setChannel(state.channel + 1, true); };
    }
    page.appendChild(up);
    page.appendChild(down);

    /* PC: one column on the left (search, category chips, channels). */
    var side = page;
    if (pcLayout) {
      side = el('div', 'live-side');
      page.appendChild(side);
    }
    if (window.OPENTV_DESKTOP) {
      side.appendChild(createChannelSearchBox('is-home', 'Buscar canal'));
    }
    /* PC: the category chips above the list (TVs have them under the video). */
    if (pcLayout) {
      liveDockCats = el('div', 'live-dock-cats live-side-cats');
      side.appendChild(liveDockCats);
      liveUnder = el('div', 'live-under');
      liveUnder._logo = el('div', 'live-under-logo');
      var text = el('div', 'live-under-text');
      liveUnder._name = el('div', 'live-under-name');
      liveUnder._meta = el('div', 'live-under-meta');
      text.appendChild(liveUnder._name);
      text.appendChild(liveUnder._meta);
      liveUnder.appendChild(liveUnder._logo);
      liveUnder.appendChild(text);
    }

    liveList = el('div', 'live-list scrollable');
    side.appendChild(liveList);
    if (window.OPENTV_DESKTOP) { bindScrollArrows(liveList, up, down); }
    renderLiveRows(false);
    loadLiveChannels();

    liveFocus = el('div', 'live-focus focusable');
    liveFocus._onMove = function (dir) {
      /* TVs: down goes to the controls under the preview and up to the icons
         at the top (the channel list on the right changes channel). */
      if (platformIsTv() && window.OPENTV_DESKTOP) {
        if (dir === 'down') {
          var dockBtn = liveDock && (liveDock.querySelector('.live-dock-btn.is-play') || firstIn(liveDock));
          if (dockBtn && isVisible(dockBtn)) { setFocus(dockBtn); }
          return true;
        }
        if (dir === 'up') { focusHomeTopIcons(); return true; }
      }
      if (dir === 'up') {
        if (state.channel > 0) { setChannel(state.channel - 1); }
        return true;
      }
      if (dir === 'down') {
        if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1); }
        return true;
      }
      /* Design "3A": the list is on the left of the video. */
      if (dir === (pcLayout ? 'left' : 'right')) {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        else if (liveRows.length) { setFocus(liveRows[0]); }
        else {
          /* No channels: the "Agregar lista M3U" button of the empty list. */
          var add = liveList && liveList.querySelector('.focusable');
          if (add) { setFocus(add); }
        }
        return true;
      }
      if (dir === 'left' || dir === 'right') {
        if (!pcLayout && tabEls[0]) { setFocus(tabEls[0]); }
        return true;
      }
      return false;
    };
    liveFocus._activate = function () { openPlayer('live'); };
    page.appendChild(liveFocus);
    if (window.OPENTV_DESKTOP) {
      buildLiveDock(page);
      installLivePreviewGestures(liveFocus);
    }
    /* PC: under the video, one line: the channel on the left, the controls
       on the right. */
    if (pcLayout && liveDock) {
      var bar = el('div', 'live-bar3a');
      bar.appendChild(liveUnder);
      bar.appendChild(liveDock);
      page.appendChild(bar);
    }
    syncLiveUnder();
  }

  /* ---- home/live-dock.js ----------------------------------------------------- */
  /* home/live-dock.js — Barra de controles de la TV del inicio: volumen, favoritos y países/temas.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------------
     Desktop: sound for the home TV preview, a control bar and category
     chips under the video (the TV app kept this preview muted).
     ------------------------------------------------------------------ */
  var liveDock = null, liveDockCats = null, liveMuteBtn = null, liveVolLabel = null, liveFavBtn = null;
  var liveAudio = { muted: false, volume: 0.8 };

  var LIVE_DOCK_ICONS = {
    prev: UI_ICONS.prev,
    next: UI_ICONS.next,
    sound: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
    soundLow: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'),
    mute: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>',
    star: UI_ICONS.star,
    full: UI_ICONS.fullscreen,
    guide: uiSvg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>')
  };
  var liveVolRange = null;
  var liveVolToast = null;
  var liveVolToastTimer = null;

  function loadLiveAudio() {
    var saved = safeLocalRead('opentv_live_audio_v1', null);
    if (saved) {
      liveAudio.muted = !!saved.muted;
      if (typeof saved.volume === 'number') { liveAudio.volume = Math.max(0, Math.min(1, saved.volume)); }
    }
  }
  /* Desktop: when the system volume is available the TV slider and mute
     button act on Windows itself (the taskbar speaker), and the videos play at
     full level so the slider means the real loudness. */
  var systemVolumeOn = false;
  var systemVolumeTimer = null;
  var systemVolumePending = null;
  function systemVolumeApi() {
    return window.OPENTV_DESKTOP && window.desktop && window.desktop.systemVolume ? window.desktop.systemVolume : null;
  }
  function syncFromSystemVolume() {
    var api = systemVolumeApi();
    if (!api || systemVolumePending !== null) { return; }
    api('get').then(function (r) {
      if (!r || r.error || typeof r.volume !== 'number' || systemVolumePending !== null) { return; }
      systemVolumeOn = true;
      if (Math.abs(r.volume - liveAudio.volume) > 0.004 || r.muted !== liveAudio.muted) {
        liveAudio.volume = r.volume;
        liveAudio.muted = r.muted;
        applyLiveAudio(false);
      }
    }).catch(function () {});
  }
  function pushSystemVolume() {
    var api = systemVolumeApi();
    if (!api || !systemVolumeOn) { return; }
    systemVolumePending = { volume: liveAudio.volume, muted: liveAudio.muted };
    if (systemVolumeTimer) { return; }
    systemVolumeTimer = setTimeout(function () {
      systemVolumeTimer = null;
      var want = systemVolumePending;
      api('set', want.volume).then(function () { return api('mute', want.muted); }).then(function () {
        if (systemVolumePending === want) { systemVolumePending = null; }
        else { systemVolumePending = null; pushSystemVolume(); }
      }).catch(function () { systemVolumePending = null; });
    }, 60);
  }
  function startSystemVolumeSync() {
    if (!systemVolumeApi()) { return; }
    syncFromSystemVolume();
    /* Follow changes made with the keyboard volume keys or the taskbar. */
    setInterval(function () {
      if (((state.screen === 'home' && onTvTab()) || state.screen === 'player') && document.hasFocus()) { syncFromSystemVolume(); }
    }, 2500);
  }

  function applyLiveAudio(save) {
    if (systemVolumeOn) {
      if (livePreviewVideo) { livePreviewVideo.muted = false; livePreviewVideo.volume = 1; livePreviewVideo.removeAttribute('muted'); }
      if (playerVideo) { playerVideo.volume = 1; if (liveHandoff && liveHandoff.type === 'player') { playerVideo.muted = false; } }
    } else if (livePreviewVideo) {
      livePreviewVideo.muted = liveAudio.muted;
      livePreviewVideo.volume = liveAudio.volume;
      if (liveAudio.muted) { livePreviewVideo.setAttribute('muted', 'muted'); } else { livePreviewVideo.removeAttribute('muted'); }
    }
    if (playerVideo && !systemVolumeOn) {
      playerVideo.volume = liveAudio.volume;
      /* While the player's video stands in for the home preview it follows the
         preview's mute button. */
      if (liveHandoff && liveHandoff.type === 'player') { playerVideo.muted = liveAudio.muted; }
    }
    var off = liveAudio.muted || liveAudio.volume === 0;
    var pct = Math.round(liveAudio.volume * 100);
    if (liveMuteBtn) {
      var muteSvg = off ? LIVE_DOCK_ICONS.mute : (liveAudio.volume < 0.5 ? LIVE_DOCK_ICONS.soundLow : LIVE_DOCK_ICONS.sound);
      var muteIco = liveMuteBtn.querySelector('.live-dock-ico');
      if (muteIco) { muteIco.innerHTML = muteSvg; }
      else { liveMuteBtn.innerHTML = '<i class="live-dock-ico">' + muteSvg + '</i>'; }
      liveMuteBtn.setAttribute('data-tip', off ? 'Activar sonido (M)' : 'Silenciar (M)');
      liveMuteBtn.classList.toggle('is-off', off);
    }
    if (liveVolLabel) { liveVolLabel.textContent = off ? 'Sin sonido' : pct + '%'; }
    if (liveVolRange) {
      var shown = off ? 0 : pct;
      if (String(liveVolRange.value) !== String(shown)) { liveVolRange.value = shown; }
      liveVolRange.style.setProperty('--vol', shown + '%');
    }
    if (save) {
      if (systemVolumeOn) { pushSystemVolume(); }
      else { safeLocalWrite('opentv_live_audio_v1', liveAudio); }
    }
    if (window.OPENTV_DESKTOP) { applyPlayerAudio(); }
  }
  function changeLiveVolume(delta) {
    liveAudio.volume = Math.max(0, Math.min(1, Math.round((liveAudio.volume + delta) * 20) / 20));
    if (delta > 0) { liveAudio.muted = false; }
    applyLiveAudio(true);
    showLiveVolumeToast();
  }

  /* Small "volume" pill over the preview while it changes. */
  function showLiveVolumeToast() {
    var host = state.screen === 'player' ? playerStage : liveMain;
    if (!window.OPENTV_DESKTOP || !host) { return; }
    if (!liveVolToast || liveVolToast.parentNode !== host) {
      if (liveVolToast && liveVolToast.parentNode) { liveVolToast.parentNode.removeChild(liveVolToast); }
      liveVolToast = el('div', 'live-vol-toast');
      host.appendChild(liveVolToast);
    }
    var off = liveAudio.muted || liveAudio.volume === 0;
    var pct = off ? 0 : Math.round(liveAudio.volume * 100);
    liveVolToast.innerHTML = (off ? LIVE_DOCK_ICONS.mute : LIVE_DOCK_ICONS.sound) +
      '<i><b style="width:' + pct + '%"></b></i><span>' + (off ? 'Sin sonido' : pct + '%') + '</span>';
    liveVolToast.classList.add('is-visible');
    if (liveVolToastTimer) { clearTimeout(liveVolToastTimer); }
    liveVolToastTimer = setTimeout(function () { liveVolToast.classList.remove('is-visible'); }, 1100);
  }

  /* A TV favourite is kept by the channel's link (stable when the lists change). */
  function liveFavKey(ch) { return 'live:' + (ch.streamUrl || ch.channelCode || ch.id || ch.name); }
  function syncLiveFavButton() {
    if (!liveFavBtn) { return; }
    var ch = CHANNELS[state.channel];
    var on = !!(ch && (ch.fav || state.favs[liveFavKey(ch)]));
    liveFavBtn.classList.toggle('is-selected', on);
    liveFavBtn.querySelector('span').textContent = on ? 'En favoritos' : 'Favorito';
    liveFavBtn.setAttribute('data-tip', on ? 'Quitar de favoritos' : 'Guardar canal en favoritos');
  }

  function dockButton(cls, icon, label, title, run) {
    var b = el('div', 'live-dock-btn focusable ' + cls);
    var ico = el('i', 'live-dock-ico');
    ico.innerHTML = icon;
    b.appendChild(ico);
    if (label) { b.appendChild(el('span', null, label)); }
    if (title) { b.setAttribute('data-tip', title); b.setAttribute('aria-label', title); }
    b._activate = run;
    /* TVs: up goes back to the preview above; nothing below the bar. */
    if (platformIsTv() && window.OPENTV_DESKTOP) {
      b._onMove = function (dir) {
        if (dir === 'up' && liveFocus) { setFocus(liveFocus); return true; }
        if (dir === 'down') { return true; }
        return false;
      };
    }
    return b;
  }

  function buildLiveDock(page) {
    loadLiveAudio();
    liveDock = el('div', 'live-dock');
    var dockBar = el('div', 'live-dock-bar');
    /* Desktop: three groups — sound and tools, the channel buttons with
       pause in the middle, and favourites / guide / full screen. */
    var dockLeft = dockBar, dockCenter = dockBar, dockRight = dockBar;
    if (window.OPENTV_DESKTOP) {
      dockLeft = el('div', 'ldb-group is-left');
      dockCenter = el('div', 'ldb-group is-center');
      dockRight = el('div', 'ldb-group is-right');
      dockBar.appendChild(dockLeft);
      dockBar.appendChild(dockCenter);
      dockBar.appendChild(dockRight);
    }
    var bar = dockCenter;
    bar.appendChild(dockButton('is-zap', LIVE_DOCK_ICONS.prev, 'Anterior', 'Canal anterior', function () { setChannel(state.channel - 1, true); }));
    if (window.OPENTV_DESKTOP) { bar.appendChild(makeLiveDockPlayButton()); }
    bar.appendChild(dockButton('is-zap', LIVE_DOCK_ICONS.next, 'Siguiente', 'Canal siguiente', function () { setChannel(state.channel + 1, true); }));
    if (!window.OPENTV_DESKTOP) { bar.appendChild(el('i', 'live-dock-sep')); }
    bar = dockLeft;
    liveMuteBtn = dockButton('is-icon is-mute', LIVE_DOCK_ICONS.sound, '', 'Silenciar', function () {
      if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
      else { liveAudio.muted = !liveAudio.muted; }
      applyLiveAudio(true);
    });
    bar.appendChild(liveMuteBtn);
    /* Volume: a slider (drag, click or mouse wheel) and its value. */
    var volWrap = el('div', 'live-dock-volume');
    liveVolRange = document.createElement('input');
    liveVolRange.type = 'range';
    liveVolRange.min = '0';
    liveVolRange.max = '100';
    liveVolRange.step = '1';
    liveVolRange.className = 'live-vol-range';
    liveVolRange.setAttribute('aria-label', 'Volumen');
    liveVolRange.addEventListener('input', function () {
      liveAudio.volume = Math.max(0, Math.min(1, liveVolRange.value / 100));
      liveAudio.muted = liveAudio.volume === 0;
      applyLiveAudio(false);
      if (systemVolumeOn) { pushSystemVolume(); }
    });
    liveVolRange.addEventListener('change', function () { applyLiveAudio(true); });
    liveVolRange.addEventListener('wheel', function (event) {
      event.preventDefault();
      changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });
    volWrap.appendChild(liveVolRange);
    liveVolLabel = el('span', 'live-dock-vol', '80%');
    volWrap.appendChild(liveVolLabel);
    bar.appendChild(volWrap);
    if (window.OPENTV_DESKTOP) { bar.appendChild(el('i', 'live-dock-sep')); appendLiveDockTools(bar); }
    else { bar.appendChild(el('i', 'live-dock-sep')); }
    bar = dockRight;
    liveFavBtn = dockButton('is-fav', LIVE_DOCK_ICONS.star, 'Favorito', 'Guardar canal en favoritos', function () {
      var ch = CHANNELS[state.channel];
      if (!ch) { return; }
      toggleLiveFavorite(ch);
      if (liveGuideOpen) { renderLiveGuideGrid(); }
    });
    bar.appendChild(liveFavBtn);
    if (window.OPENTV_DESKTOP) {
      bar.appendChild(dockButton('is-guide', LIVE_DOCK_ICONS.guide, 'Guía', 'Guía de canales (G)', openLiveGuide));
    }
    bar.appendChild(dockButton('is-full', LIVE_DOCK_ICONS.full, 'Pantalla completa', 'Ver en pantalla completa', function () { openPlayer('live'); }));
    liveDock.appendChild(dockBar);

    /* Desktop: the categories live in the Guía (ordered by country and
       topic); the chip row under the preview is only on the TV. */
    if (!window.OPENTV_DESKTOP) {
      liveDockCats = el('div', 'live-dock-cats scrollable');
      liveDockCats.setAttribute('data-wheel-x', '');
      liveDock.appendChild(liveDockCats);
    }
    page.appendChild(liveDock);
    /* Mouse wheel over the preview changes the volume. */
    if (liveMain && !liveMain._wheelVolume) {
      liveMain._wheelVolume = true;
      liveMain.addEventListener('wheel', function (event) {
        if (event.ctrlKey) { return; }
        event.preventDefault();
        changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
      }, { passive: false });
    }
    renderLiveDockCats();
    applyLiveAudio(false);
    syncLiveFavButton();
    if (volWrap) { volWrap.setAttribute('data-tip', systemVolumeApi() ? 'Volumen de Windows' : 'Volumen'); }
    if (!liveDock._systemSync) { liveDock._systemSync = true; startSystemVolumeSync(); }
  }

  /* PC and TV (design "3A"): the categories in one drop-down in the app's
     style (lists bring 30 or more; chips covered the channels). A button
     with the current one; it opens a panel with every category, a check on
     the chosen one, scrolling when long. Mouse, keyboard and remote. */
  var liveCatMenu = null;

  function liveCatMenuOpen() { return !!(liveCatMenu && liveCatMenu.parentNode); }

  function closeLiveCatMenu(refocus) {
    if (!liveCatMenuOpen()) { return; }
    liveCatMenu.parentNode.removeChild(liveCatMenu);
    liveCatMenu = null;
    var btn = liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
    if (btn) {
      btn.classList.remove('is-open');
      if (refocus) { setFocus(btn); }
    }
  }

  function liveCatChoices() {
    var out = [{ cat: LIVE_ALL_CATEGORY, text: 'Todas las categorías' }];
    var saved = liveSaved();
    if (saved.favs.length) { out.push({ cat: LIVE_SAVED_CATS.favs, text: 'Favoritos' }); }
    if (saved.recent.length) { out.push({ cat: LIVE_SAVED_CATS.recent, text: 'Recientes' }); }
    for (var i = 0; i < liveCategories.length; i++) {
      if (liveCategories[i].id !== LIVE_ALL_CATEGORY.id) { out.push({ cat: liveCategories[i], text: liveCategories[i].name }); }
    }
    return out;
  }

  function sameLiveCategory(a, b) { return a === b || !!(a && b && a.id === b.id); }

  function openLiveCatMenu(btn) {
    closeLiveCatMenu(false);
    liveCatMenu = el('div', 'live-cat-menu scrollable');
    liveCatMenu.setAttribute('role', 'listbox');
    var current = null;
    liveCatChoices().forEach(function (c) {
      var on = sameLiveCategory(currentLiveCategory, c.cat);
      var item = el('div', 'live-cat-item focusable' + (on ? ' is-selected' : ''));
      item.setAttribute('role', 'option');
      item.appendChild(el('span', 'live-cat-name', c.text));
      var check = el('i', 'live-cat-check');
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
      item.appendChild(check);
      item._activate = function () {
        closeLiveCatMenu(false);
        if (!on) { switchLiveCategory(c.cat); renderLiveDockCats(); }
        var again = liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
        if (again) { setFocus(again); }
      };
      /* The list stays the remote's whole world while it is open. */
      item._onMove = function (dir) { return dir === 'left' || dir === 'right'; };
      if (on) { current = item; }
      liveCatMenu.appendChild(item);
    });
    btn.classList.add('is-open');
    /* Last in the column, right under the button: over the channel list. */
    var column = liveDockCats.parentNode || liveDockCats;
    liveCatMenu.style.top = (liveDockCats.offsetTop + btn.offsetHeight + 8) + 'px';
    column.appendChild(liveCatMenu);
    var first = current || liveCatMenu.firstChild;
    if (first) {
      setFocus(first, true);
      liveCatMenu.scrollTop = Math.max(0, first.offsetTop - 120);
    }
  }

  function renderLiveCatSelect() {
    closeLiveCatMenu(false);
    clear(liveDockCats);
    var label = 'Cargando categorías…';
    if (liveCategoriesLoaded) {
      var choices = liveCatChoices();
      label = choices[0].text;
      for (var i = 0; i < choices.length; i++) { if (sameLiveCategory(currentLiveCategory, choices[i].cat)) { label = choices[i].text; } }
    }
    var btn = el('div', 'live-cat-btn focusable');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.appendChild(el('span', 'live-cat-label', label));
    var chev = el('i', 'live-cat-chev');
    chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    btn.appendChild(chev);
    btn._activate = function () {
      if (!liveCategoriesLoaded) { return; }
      if (liveCatMenuOpen()) { closeLiveCatMenu(true); } else { openLiveCatMenu(btn); }
    };
    liveDockCats.appendChild(btn);
  }

  /* A click anywhere else closes it. */
  document.addEventListener('pointerdown', function (event) {
    if (!liveCatMenuOpen()) { return; }
    var t = event.target;
    if (liveDockCats && t && (liveDockCats.contains(t) || liveCatMenu.contains(t))) { return; }
    closeLiveCatMenu(false);
  }, true);

  function renderLiveDockCats() {
    if (!liveDockCats) { return; }
    if (typeof liveSideLayout === 'function' && liveSideLayout()) { renderLiveCatSelect(); return; }
    clear(liveDockCats);
    if (!liveCategoriesLoaded) {
      liveDockCats.appendChild(el('span', 'live-dock-label', 'Cargando categorías…'));
      return;
    }
    var topics = [];
    for (var i = 0; i < liveCategories.length; i++) {
      if (liveCategories[i].id !== LIVE_ALL_CATEGORY.id) { topics.push(liveCategories[i]); }
    }
    function chip(cat, text) {
      var selected = currentLiveCategory === cat ||
        (currentLiveCategory && cat && currentLiveCategory.id === cat.id);
      var b = el('div', 'live-chip focusable' + (selected ? ' is-selected' : ''), text || cat.name);
      b._activate = function () {
        switchLiveCategory(cat);
        renderLiveDockCats();
      };
      liveDockCats.appendChild(b);
    }
    chip(LIVE_ALL_CATEGORY, 'Todos');
    if (window.OPENTV_DESKTOP) {
      var saved = liveSaved();
      if (saved.favs.length) { chip(LIVE_SAVED_CATS.favs, '★ Favoritos'); }
      if (saved.recent.length) { chip(LIVE_SAVED_CATS.recent, 'Recientes'); }
    }
    if (topics.length) {
      liveDockCats.appendChild(el('span', 'live-dock-label', 'Categorías'));
      for (var t = 0; t < topics.length; t++) { chip(topics[t]); }
    }
  }

  /* ---- home/live-dock-tools.js ----------------------------------------------- */
  /* home/live-dock-tools.js — Escritorio: los botones del reproductor de TV también en la vista previa.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Pausa, reintentar, calidad, ventana flotante y diagnóstico act
     on the video shown in the home preview (its own element, or the player's
     while it is lent to the home). */
  var liveDockPlayBtn = null;

  function liveHomeVideo() {
    return liveHandoff && liveHandoff.type === 'player' ? playerVideo : livePreviewVideo;
  }

  function showLiveDockToast(icon, text) {
    if (!liveMain) { return; }
    if (!liveVolToast || liveVolToast.parentNode !== liveMain) {
      if (liveVolToast && liveVolToast.parentNode) { liveVolToast.parentNode.removeChild(liveVolToast); }
      liveVolToast = el('div', 'live-vol-toast');
      liveMain.appendChild(liveVolToast);
    }
    /* The text can carry a channel name from an addon: never as HTML. */
    liveVolToast.innerHTML = icon;
    liveVolToast.appendChild(el('span', null, text));
    liveVolToast.classList.add('is-visible');
    if (liveVolToastTimer) { clearTimeout(liveVolToastTimer); }
    liveVolToastTimer = setTimeout(function () { liveVolToast.classList.remove('is-visible'); }, 1400);
  }

  function toggleLivePreviewPlay() {
    var v = liveHomeVideo();
    if (!v || !(v.currentSrc || v.getAttribute('src'))) {
      var ch = CHANNELS[state.channel];
      if (ch) { startLivePreview(ch); }
      return;
    }
    if (v.paused) {
      var p = v.play();
      if (p && p.catch) { p.catch(function () {}); }
    } else {
      v.pause();
    }
    syncLiveDockPlay();
  }

  function syncLiveDockPlay() {
    if (!liveDockPlayBtn) { return; }
    var v = liveHomeVideo();
    var paused = !!(v && v.paused && (v.currentSrc || v.getAttribute('src')));
    if (liveDockPlayBtn._paused === paused) { return; }
    liveDockPlayBtn._paused = paused;
    liveDockPlayBtn.querySelector('.live-dock-ico').innerHTML = paused ? UI_ICONS.play : UI_ICONS.pause;
    var tip = paused ? 'Reproducir' : 'Pausa';
    liveDockPlayBtn.setAttribute('data-tip', tip);
    liveDockPlayBtn.setAttribute('aria-label', tip);
    if (liveMain) { liveMain.classList.toggle('is-preview-paused', paused); }
    if (liveMain && !liveMain._pauseMark) {
      /* Big play mark in the middle of the paused picture; a click resumes. */
      var mark = el('div', 'live-paused-mark');
      mark.innerHTML = UI_ICONS.play;
      mark.addEventListener('click', function (event) { event.stopPropagation(); toggleLivePreviewPlay(); });
      liveMain.appendChild(mark);
      liveMain._pauseMark = mark;
    }
  }

  function retryLivePreview() {
    var ch = CHANNELS[state.channel];
    if (!ch) { return; }
    stopLivePreview();
    startLivePreview(ch);
    showLiveDockToast(UI_ICONS.retry, 'Reconectando ' + (ch.name || 'canal') + '…');
  }

  /* Automática → highest → … → lowest → Automática. */
  function cycleLivePreviewQuality() {
    if (liveHandoff && liveHandoff.type === 'player') {
      var api = hlsQualityApi();
      if (api && api.levels().length > 1) {
        cycleHlsQuality();
        var cur = api.current() || {};
        showLiveDockToast(UI_ICONS.quality, 'Calidad: ' + (cur.auto ? 'Automática' : hlsQualityLabel(cur.height)));
        return;
      }
    }
    var hls = livePreviewHls;
    var levels = hls && hls.levels ? hls.levels : [];
    if (levels.length < 2) {
      var h = livePreviewVideo && livePreviewVideo.videoHeight;
      showLiveDockToast(UI_ICONS.quality, 'Esta señal tiene una sola calidad' + (h ? ' (' + hlsQualityLabel(h) + ')' : ''));
      return;
    }
    var order = [-1];
    var byHeight = levels.map(function (l, i) { return { i: i, h: l.height || 0 }; })
      .sort(function (a, b) { return b.h - a.h; });
    byHeight.forEach(function (l) { order.push(l.i); });
    var at = hls.autoLevelEnabled ? 0 : order.indexOf(hls.currentLevel);
    var next = order[(at + 1) % order.length];
    hls.currentLevel = next;
    showLiveDockToast(UI_ICONS.quality, 'Calidad: ' + (next < 0 ? 'Automática' : hlsQualityLabel(levels[next].height || 0)));
  }

  function toggleLivePreviewPip() {
    if (!document.pictureInPictureEnabled) { return; }
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(function () {}); return; }
    var v = liveHomeVideo();
    if (!v || !(v.currentSrc || v.getAttribute('src'))) {
      showLiveDockToast(UI_ICONS.pip, 'Elige un canal para abrir la ventana flotante');
      return;
    }
    v.requestPictureInPicture().catch(function () {});
  }

  /* Icon-only buttons placed after the volume. */
  function appendLiveDockTools(bar) {
    bar.appendChild(dockButton('is-tool', UI_ICONS.retry, '', 'Reintentar señal', retryLivePreview));
    bar.appendChild(dockButton('is-tool', UI_ICONS.quality, '', 'Calidad', cycleLivePreviewQuality));
    if (platformHas('pip')) { bar.appendChild(dockButton('is-tool', UI_ICONS.pip, '', 'Ventana flotante', toggleLivePreviewPip)); }
  }

  function makeLiveDockPlayButton() {
    liveDockPlayBtn = dockButton('is-play', UI_ICONS.pause, '', 'Pausa', toggleLivePreviewPlay);
    liveDockPlayBtn._paused = false;
    if (!document._dockPlayHooks) {
      /* Media events do not bubble; capture sees those of every video. */
      document._dockPlayHooks = true;
      ['play', 'pause', 'emptied', 'playing'].forEach(function (name) {
        document.addEventListener(name, syncLiveDockPlay, true);
      });
    }
    return liveDockPlayBtn;
  }

  /* ---- live/channels.js ------------------------------------------------------ */
  /* live/channels.js — TV en vivo: listas M3U, categorías, carga de canales y vista previa compartida con el reproductor.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* --- Live TV Categories & Addons (M3U / IPTV) --- */
  var PRESET_ADDONS = [
    /* Free ad-supported (FAST) channels from Pluto TV, Plex, Samsung TV Plus,
       Tubi and Roku, as M3U lists rebuilt every day by
       github.com/BuddyChewChew/app-m3u-generator (from i.mjh.nz data).
       First, so "Buscar" shows them at the top. */
    { id: 'pluto_mx', name: 'Pluto TV México', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_mx.m3u', desc: '200+ canales gratis: películas, series, anime, deportes e infantil' },
    { id: 'pluto_ar', name: 'Pluto TV Argentina', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_ar.m3u', desc: '190+ canales gratis de películas y series en español' },
    { id: 'plex_mx', name: 'Plex México', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plex_mx.m3u', desc: '270+ canales gratis de películas, series y documentales' },
    { id: 'samsung_es', name: 'Samsung TV Plus España', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/samsungtvplus_es.m3u', desc: '180+ canales gratis: cine, series, documentales y música' },
    { id: 'pluto_es', name: 'Pluto TV España', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_es.m3u', desc: '150+ canales gratis: cine, series, policiacas e infantil' },
    { id: 'pluto_us', name: 'Pluto TV Estados Unidos', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_us.m3u', desc: 'Con una sección En Español; el resto en inglés' },
    { id: 'tubi_us', name: 'Tubi (EE. UU.)', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/tubi_all.m3u', desc: 'Canales en vivo de Tubi, en inglés: reality, comedia y deportes' },
    { id: 'roku_us', name: 'The Roku Channel (EE. UU.)', url: 'https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/roku_all.m3u', desc: 'Canales en inglés: series, deportes y noticias' },
    /* Free-to-air channels from iptv-org. */
    {
      id: 'es_tdt',
      name: 'España - Canales Nacionales y TDT',
      url: 'https://iptv-org.github.io/iptv/countries/es.m3u',
      desc: '320+ canales: La 1, La 2, Antena 3, Telecinco, laSexta, autonómicas'
    },
    {
      id: 'latam_spa',
      name: 'Latinoamérica y Deportes (Hispano)',
      url: 'https://iptv-org.github.io/iptv/languages/spa.m3u',
      desc: 'Canales en español de Colombia, México, Argentina, Chile y Perú'
    },
    {
      id: 'sports_iptv',
      name: 'Deportes Internacionales',
      url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
      desc: 'Transmisiones deportivas y canales de competiciones'
    },
    {
      id: 'movies_iptv',
      name: 'Cine y Series 24/7',
      url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
      desc: 'Cine clásico, cine de acción y canales continuos de series'
    },
    /* More free lists from iptv-org, found with "Buscar" in Ajustes → Addons → TV en vivo. */
    { id: 'mx', name: 'México', url: 'https://iptv-org.github.io/iptv/countries/mx.m3u', desc: 'Canales abiertos y locales de México' },
    { id: 'ar', name: 'Argentina', url: 'https://iptv-org.github.io/iptv/countries/ar.m3u', desc: 'Canales abiertos y locales de Argentina' },
    { id: 'co', name: 'Colombia', url: 'https://iptv-org.github.io/iptv/countries/co.m3u', desc: 'Canales abiertos y locales de Colombia' },
    { id: 'cl', name: 'Chile', url: 'https://iptv-org.github.io/iptv/countries/cl.m3u', desc: 'Canales abiertos y locales de Chile' },
    { id: 'pe', name: 'Perú', url: 'https://iptv-org.github.io/iptv/countries/pe.m3u', desc: 'Canales abiertos y locales de Perú' },
    { id: 've', name: 'Venezuela', url: 'https://iptv-org.github.io/iptv/countries/ve.m3u', desc: 'Canales abiertos y locales de Venezuela' },
    { id: 'ec', name: 'Ecuador', url: 'https://iptv-org.github.io/iptv/countries/ec.m3u', desc: 'Canales abiertos y locales de Ecuador' },
    { id: 'us', name: 'Estados Unidos', url: 'https://iptv-org.github.io/iptv/countries/us.m3u', desc: 'Canales de EE. UU., muchos en inglés' },
    { id: 'news', name: 'Noticias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', desc: 'Canales de noticias de todo el mundo' },
    { id: 'kids', name: 'Infantil', url: 'https://iptv-org.github.io/iptv/categories/kids.m3u', desc: 'Dibujos y programas para niños' },
    { id: 'animation', name: 'Animación', url: 'https://iptv-org.github.io/iptv/categories/animation.m3u', desc: 'Canales de dibujos y anime' },
    { id: 'music', name: 'Música', url: 'https://iptv-org.github.io/iptv/categories/music.m3u', desc: 'Videoclips y radios con imagen' },
    { id: 'documentary', name: 'Documentales', url: 'https://iptv-org.github.io/iptv/categories/documentary.m3u', desc: 'Naturaleza, historia y ciencia' },
    { id: 'comedy', name: 'Comedia', url: 'https://iptv-org.github.io/iptv/categories/comedy.m3u', desc: 'Series y programas de humor' }
  ];

  function getSavedAddons() {
    try {
      var raw = localStorage.getItem('opentv_m3u_addons');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) { return parsed; }
      }
    } catch (e) {}
    /* Default seed: España TDT so user has working external addon out of the box */
    var initial = PRESET_ADDONS.filter(function (p) { return p.id === 'es_tdt'; });
    try { localStorage.setItem('opentv_m3u_addons', JSON.stringify(initial)); } catch (e2) {}
    return initial;
  }

  function saveSavedAddons(list) {
    try { localStorage.setItem('opentv_m3u_addons', JSON.stringify(list || [])); } catch (e) {}
  }

  var liveCategories = [];
  var currentLiveCategory = null;
  var liveCategoriesLoaded = false;
  var liveChannelsLoaded = false;
  var liveChannelsLoading = false;
  /* Home only keeps one muted live preview alive.  This warms the channel
     without creating a second full player or playing sound in the menu. */
  var livePreviewVideo = null;
  var livePreviewStatus = null;
  var livePreviewSeq = 0;
  var livePreviewTimer = null;
  var livePreviewChannel = '';
  var dialogAddonsOpen = false;

  /* ------------------------------------------------------------------
     Desktop: the home TV preview and the full-screen TV player hand the same
     playing <video> to each other, so "Pantalla completa" and "Volver" do not
     reload the channel (the TV app used two separate players).
       type 'preview': the home preview element is shown inside the player;
       type 'player' : the player element is shown in the home preview.
     ------------------------------------------------------------------ */
  var liveHandoff = null;
  var livePreviewHls = null;
  /* M3U channels are known by their link: their channelCode ('m3u_N') is only
     the position in one list and repeats between lists. */
  function liveChannelKey(ch) { return ch ? (ch.streamUrl || ch.channelCode || '') : ''; }

  function borrowPreviewIntoPlayer() {
    if (!window.OPENTV_DESKTOP || !livePreviewVideo || !playerStage || !liveMain || liveHandoff) { return false; }
    var ch = CHANNELS[state.channel];
    if (!liveMain.classList.contains('is-preview-playing') || !livePreviewChannel ||
        livePreviewChannel !== liveChannelKey(ch) || livePreviewVideo.paused) { return false; }
    if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
    playerStage.insertBefore(livePreviewVideo, playerVideo.nextSibling);
    livePreviewVideo.classList.add('is-handoff');
    if (playerFrame) { playerFrame.style.display = 'none'; }
    liveHandoff = { type: 'preview', key: livePreviewChannel };
    return true;
  }

  function returnPreviewHome() {
    if (!liveHandoff || liveHandoff.type !== 'preview') { return; }
    liveHandoff = null;
    livePreviewVideo.classList.remove('is-handoff');
    liveMain.insertBefore(livePreviewVideo, liveMain.firstChild);
  }

  function playerIsPlayingLive() {
    return state.playerMode === 'live' && playerVideo && !!playerVideo.currentSrc &&
      !playerVideo.paused && playerVideo.readyState >= 2;
  }

  function borrowPlayerIntoHome() {
    if (!window.OPENTV_DESKTOP || !liveMain || liveHandoff || !playerIsPlayingLive()) { return false; }
    stopLivePreview();
    liveMain.insertBefore(playerVideo, liveMain.firstChild);
    playerVideo.classList.add('is-handoff-home');
    playerVideo.muted = liveAudio.muted;
    livePreviewChannel = liveChannelKey(CHANNELS[state.channel]);
    liveMain.classList.remove('is-preview-loading');
    liveMain.classList.add('is-preview-playing');
    liveHandoff = { type: 'player', key: livePreviewChannel };
    return true;
  }

  /* Puts the player element back on the player stage; stops it unless the
     same channel is about to be shown full screen. */
  function returnPlayerToStage(keepPlaying) {
    if (!liveHandoff || liveHandoff.type !== 'player') { return; }
    liveHandoff = null;
    playerVideo.classList.remove('is-handoff-home');
    playerVideo.muted = false;
    var anchor = playerStage.querySelector('.player-frame');
    playerStage.insertBefore(playerVideo, anchor ? anchor.nextSibling : playerStage.firstChild);
    if (liveMain) { liveMain.classList.remove('is-preview-playing'); }
    livePreviewChannel = '';
    if (!keepPlaying) { stopPlayerVideo(); }
  }

  function stopLivePreview() {
    if (liveHandoff && liveHandoff.type === 'preview') { returnPreviewHome(); }
    if (liveHandoff && liveHandoff.type === 'player') { returnPlayerToStage(false); }
    livePreviewSeq++;
    livePreviewChannel = '';
    if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
    if (liveMain) { liveMain.classList.remove('is-preview-playing', 'is-preview-loading'); }
    if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    if (!livePreviewVideo) { return; }
    if (livePreviewHls) { try { livePreviewHls.destroy(); } catch (eDestroy) { /* ignore */ } livePreviewHls = null; }
    try { livePreviewVideo.pause(); } catch (ePause) { /* ignore */ }
    livePreviewVideo.removeAttribute('src');
    try { livePreviewVideo.src = ''; livePreviewVideo.load(); } catch (eClear) { /* ignore */ }
  }

  function startLivePreview(ch) {
    if (!livePreviewVideo || !ch || !ch.streamUrl) { return; }
    /* A preview belongs only to the TV tab on the home screen. */
    if (state.screen !== 'home' || !onTvTab()) { return; }
    /* The full-screen player is already showing this channel here. */
    if (liveHandoff && liveHandoff.type === 'player') {
      if (liveHandoff.key === liveChannelKey(ch)) { return; }
      returnPlayerToStage(false);
    }
    var key = liveChannelKey(ch);
    if (key === livePreviewChannel && liveMain &&
        (liveMain.classList.contains('is-preview-loading') || liveMain.classList.contains('is-preview-playing'))) {
      return;
    }
    stopLivePreview();
    livePreviewChannel = key;
    noteLivePlaying(ch);
    var mySeq = ++livePreviewSeq;
    liveMain.classList.add('is-preview-loading');
    if (livePreviewStatus) { livePreviewStatus.textContent = 'Cargando ' + (ch.name || 'canal') + '…'; }
    /* An M3U channel plays its own link (no service round trip). */
    var url = ch.streamUrl;
    (function () {
      /* Playing: the "Cargando…" label goes. Android's native player sends
         loadeddata only for the first channel on this element, so playing and
         canplay clear it too (it stayed over the picture). */
      livePreviewVideo.onloadeddata = livePreviewVideo.onplaying = livePreviewVideo.oncanplay = function () {
        if (mySeq !== livePreviewSeq) { return; }
        liveMain.classList.remove('is-preview-loading');
        liveMain.classList.add('is-preview-playing');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
      };
      livePreviewVideo.onerror = function () {
        if (mySeq !== livePreviewSeq) { return; }
        liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
        if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
      };
      /* Desktop: play HLS with hls.js, like the full-screen player. Chromium's
         own HLS support rejects some channels (ECDF: error 4). */
      if (window.OPENTV_DESKTOP && !platformHas('native-player') && window.Hls && window.Hls.isSupported() && /\.m3u8(?:\?|$)/i.test(url)) {
        try {
          var hls = new window.Hls({ enableWorker: true, maxBufferLength: 20, backBufferLength: 10 });
          livePreviewHls = hls;
          hls.on(window.Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(url); });
          hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
            if (mySeq !== livePreviewSeq) { return; }
            var pp = livePreviewVideo.play();
            if (pp && pp.catch) { pp.catch(function () {}); }
          });
          hls.on(window.Hls.Events.ERROR, function (_, data) {
            if (!data || !data.fatal || mySeq !== livePreviewSeq) { return; }
            liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
            if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
          });
          hls.attachMedia(livePreviewVideo);
          return;
        } catch (eHls) { livePreviewHls = null; /* fall back to the native player */ }
      }
      try {
        livePreviewVideo.src = url;
        livePreviewVideo.load();
        var promise = livePreviewVideo.play();
        if (promise && promise.catch) { promise.catch(function () {}); }
      } catch (ePlay) { liveMain.classList.remove('is-preview-loading'); }
    })();
  }

  function scheduleLivePreview(ch) {
    if (livePreviewTimer) { clearTimeout(livePreviewTimer); }
    livePreviewTimer = setTimeout(function () {
      livePreviewTimer = null;
      startLivePreview(ch || CHANNELS[state.channel]);
    }, 220);
  }

  /* ------------------------------------------------------------------
     Loading. Every saved M3U list is downloaded once (service fetchM3u),
     merged into liveAllChannels and split into categories by group-title.
     Choosing a category only filters that list in memory (no network), so
     the 1 GB Fire TV does no extra work when the viewer changes category.
     ------------------------------------------------------------------ */
  var LIVE_ALL_CATEGORY = { id: 'm3u:all', name: 'Todos', isAddon: true };
  var liveAllChannels = [];
  /* '' (not loaded yet), 'none' (no lists saved), 'failed' (no list could be
     read), 'ok' (at least one list answered). */
  var liveListsStatus = '';
  var liveListsLoadedKey = null;
  var liveListsSeq = 0;
  var liveListsWaiting = [];
  currentLiveCategory = LIVE_ALL_CATEGORY;

  /* group-title values of the free iptv-org lists come in English. */
  var LIVE_GROUP_NAMES = {
    animation: 'Animación', auto: 'Motor', business: 'Negocios', classic: 'Clásicos', comedy: 'Comedia',
    cooking: 'Cocina', culture: 'Cultura', documentary: 'Documentales', education: 'Educación',
    entertainment: 'Entretenimiento', family: 'Familia', general: 'General', kids: 'Infantil',
    legislative: 'Legislativo', lifestyle: 'Estilo de vida', movies: 'Cine', music: 'Música', news: 'Noticias',
    outdoor: 'Aire libre', relax: 'Relax', religious: 'Religión', science: 'Ciencia', series: 'Series',
    shop: 'Compras', sports: 'Deportes', travel: 'Viajes', weather: 'Clima', public: 'Públicos',
    undefined: 'Otros', other: 'Otros', others: 'Otros', addon: 'Otros'
  };

  function liveListsKey(addons) {
    var key = '';
    for (var i = 0; i < addons.length; i++) { key += (addons[i] && addons[i].url) + '\n'; }
    return key;
  }

  function liveChannelGroups(ch) {
    var parts = String((ch && ch.group) || '').split(';');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var g = parts[i].replace(/^\s+|\s+$/g, '');
      var known = LIVE_GROUP_NAMES[g.toLowerCase()];
      if (known) { g = known; }
      if (g && out.indexOf(g) === -1) { out.push(g); }
    }
    if (!out.length) { out.push('Otros'); }
    return out;
  }

  /* Favourites are kept by the channel's link; the old saved list (and its
     links) still marks the channels saved by earlier versions. */
  function liveFavoriteUrls() {
    var set = {};
    var favs = liveSaved().favs;
    for (var i = 0; i < favs.length; i++) { if (favs[i] && favs[i].streamUrl) { set[favs[i].streamUrl] = true; } }
    return set;
  }

  /* Merges the answers of every list (in the order the lists were added):
     repeated links and adult groups are left out. */
  function mergeLiveLists(results) {
    var seen = {};
    var favUrls = liveFavoriteUrls();
    var out = [];
    for (var r = 0; r < results.length; r++) {
      var list = results[r] || [];
      for (var c = 0; c < list.length; c++) {
        var ch = list[c];
        if (!ch || !ch.streamUrl || seen[ch.streamUrl]) { continue; }
        var groups = liveChannelGroups(ch);
        var adult = false;
        for (var g = 0; g < groups.length; g++) { if (isAdultCategory({ name: groups[g] })) { adult = true; break; } }
        if (adult) { continue; }
        seen[ch.streamUrl] = true;
        ch._groups = groups;
        ch.index = out.length + 1;
        if (!ch.now) { ch.now = 'En vivo'; }
        ch.fav = !!(favUrls[ch.streamUrl] || state.favs[liveFavKey(ch)]);
        out.push(ch);
      }
    }
    return out;
  }

  function buildLiveCategories(channels) {
    var byName = {};
    var cats = [];
    for (var i = 0; i < channels.length; i++) {
      var groups = channels[i]._groups || liveChannelGroups(channels[i]);
      for (var g = 0; g < groups.length; g++) {
        var cat = byName[groups[g]];
        if (!cat) {
          cat = { id: 'm3u:' + groups[g], name: groups[g], isAddon: true, channels: [] };
          byName[groups[g]] = cat;
          cats.push(cat);
        }
        cat.channels.push(channels[i]);
      }
    }
    cats.sort(function (a, b) {
      if (a.name === 'Otros') { return 1; }
      if (b.name === 'Otros') { return -1; }
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    /* One group holding every channel adds nothing next to Todos. */
    if (cats.length === 1 && cats[0].channels.length === channels.length) { cats = []; }
    return [LIVE_ALL_CATEGORY].concat(cats);
  }

  function liveCategoryChannels(cat) {
    if (!cat || cat.id === LIVE_ALL_CATEGORY.id) { return liveAllChannels; }
    for (var i = 0; i < liveCategories.length; i++) {
      if (liveCategories[i].id === cat.id) { return liveCategories[i].channels || []; }
    }
    return [];
  }

  /* The text shown where the channels go when there are none. */
  function liveEmptyMessage() {
    if (currentLiveCategory && currentLiveCategory.isSaved === 'favs') {
      return platformIsTv()
        ? 'Aún no tienes canales favoritos. Usa el botón Favorito debajo de la vista previa de TV en vivo.'
        : 'Aún no tienes canales favoritos. Usa la estrella para guardar uno.';
    }
    if (currentLiveCategory && currentLiveCategory.isSaved === 'recent') { return 'Aquí aparecerán los últimos canales que veas.'; }
    if (liveChannelsPending()) { return 'Cargando canales…'; }
    if (liveListsStatus === 'none') {
      return 'Aún no tienes listas de TV en vivo. Agrega una lista M3U en Ajustes → Addons → TV en vivo.';
    }
    if (liveListsStatus === 'failed') {
      return 'No se pudieron cargar tus listas de TV en vivo. Revisa tu conexión o agrega otra lista M3U en Ajustes → Addons → TV en vivo.';
    }
    if (!liveAllChannels.length) {
      return 'Tus listas no tienen canales. Agrega otra lista M3U en Ajustes → Addons → TV en vivo.';
    }
    return 'No hay canales en esta categoría.';
  }

  /* True while the channel lists are still being read (and none is in yet). */
  function liveChannelsPending() {
    return !liveChannelsLoaded || (liveChannelsLoading && !liveAllChannels.length);
  }

  /* True when the viewer needs to add (or fix) a list to see any channel. */
  function liveNeedsLists() {
    return liveChannelsLoaded && !liveChannelsLoading && !liveAllChannels.length;
  }

  /* "Agregar lista M3U": opens Ajustes → Addons, where the TV lists are. */
  function makeLiveListsButton() {
    var b = el('div', 'fx-btn live-add-lists focusable', 'Agregar lista M3U');
    b.style.display = 'inline-flex';
    b.style.marginTop = '24px';
    b._activate = function () {
      if (state.screen === 'player') { restorePlayerReturn(); }
      openSettingsAt('sources');
    };
    return b;
  }

  /* Shows one category of the loaded lists as the channel list. */
  function showLiveCategory(cat, keepIndex) {
    var keep = livePlayingToKeep();
    var list = liveCategoryChannels(cat);
    var previous = state.channel;
    CHANNELS.splice(0, CHANNELS.length);
    for (var i = 0; i < list.length; i++) { CHANNELS.push(list[i]); }
    state.channel = keepIndex && previous > 0 && previous < CHANNELS.length ? previous : 0;
    var kept = keep && CHANNELS.length ? keepLivePlayingChannel(keep) : false;
    renderLiveRows(false);
    renderPlayerChannels();
    setLiveInfoText(CHANNELS[state.channel] ? CHANNELS[state.channel].name : '');
    syncLiveFavButton();
    if (!CHANNELS[state.channel]) { return; }
    if (state.screen === 'player' && state.playerMode === 'live') {
      updatePlayer();
      if (!kept) { startLiveChannel(CHANNELS[state.channel], true); }
    } else {
      scheduleLivePreview(CHANNELS[state.channel]);
    }
  }

  function switchLiveCategory(cat, done) {
    if (!cat) { return; }
    if (isAdultCategory(cat)) { return; }
    currentLiveCategory = cat;
    renderPlayerCategories();
    if (cat.isSaved) { loadSavedChannels(cat.isSaved, done); return; }
    /* The lists changed in Ajustes meanwhile: read them again first. */
    if (liveListsLoadedKey !== null && liveListsLoadedKey !== liveListsKey(getSavedAddons())) {
      reloadLiveLists(done);
      return;
    }
    if (!liveChannelsLoaded) { loadLiveChannels(done); return; }
    showLiveCategory(cat, false);
    if (done) { done(); }
  }

  /* Loads the viewer's lists once (boot, the TV page, the phone layout). Later
     calls only redraw, unless the saved lists changed since. */
  function loadLiveChannels(done) {
    if (typeof done !== 'function') { done = null; }
    if (liveChannelsLoading) { if (done) { liveListsWaiting.push(done); } return; }
    if (liveChannelsLoaded && liveListsLoadedKey === liveListsKey(getSavedAddons())) {
      if (done) { done(); }
      return;
    }
    reloadLiveLists(done);
  }

  /* Reads every saved list again (a list was added or removed, "Actualizar"). */
  function loadAddonChannels(done) { reloadLiveLists(done); }

  function reloadLiveLists(done) {
    if (typeof done === 'function') { liveListsWaiting.push(done); }
    var addons = getSavedAddons();
    var seq = ++liveListsSeq;
    liveListsLoadedKey = liveListsKey(addons);
    liveChannelsLoading = true;
    if (!addons.length) { finishLiveLists(seq, [], 'none'); return; }
    if (!CHANNELS.length) { renderLiveRows(false); renderPlayerChannels(); }
    if (state.screen === 'player' && state.playerMode === 'live' && !CHANNELS.length) { setPlayerStatus('Cargando canales…'); }
    var results = [];
    var pending = addons.length;
    var answered = 0;
    for (var a = 0; a < addons.length; a++) {
      (function (idx, ad) {
        portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
          if (seq !== liveListsSeq) { return; }
          var chs = !err && payload && payload.channels ? payload.channels : [];
          if (chs.length) { answered++; }
          results[idx] = chs;
          pending--;
          if (pending > 0) { return; }
          /* Merging thousands of channels runs once, after the last answer. */
          finishLiveLists(seq, mergeLiveLists(results), answered ? 'ok' : 'failed');
        });
      })(a, addons[a]);
    }
  }

  /* Tests (window.__opentv.live.use): shows the given channels as if they came
     from the viewer's lists, without the network. */
  function useLiveChannels(list) {
    var seq = ++liveListsSeq;
    liveListsLoadedKey = liveListsKey(getSavedAddons());
    liveChannelsLoading = true;
    finishLiveLists(seq, mergeLiveLists([list || []]), list && list.length ? 'ok' : 'none');
  }

  function finishLiveLists(seq, channels, status) {
    if (seq !== liveListsSeq) { return; }
    var firstLoad = !liveChannelsLoaded;
    liveAllChannels = channels;
    liveListsStatus = status;
    liveCategories = buildLiveCategories(channels);
    liveCategoriesLoaded = true;
    liveChannelsLoading = false;
    liveChannelsLoaded = true;
    if (state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(''); }
    /* Stay on the same category if the new lists still have it. */
    var cur = currentLiveCategory;
    if (!cur || !cur.isSaved) {
      var found = LIVE_ALL_CATEGORY;
      for (var i = 0; cur && i < liveCategories.length; i++) {
        if (liveCategories[i].id === cur.id) { found = liveCategories[i]; break; }
      }
      currentLiveCategory = found;
      showLiveCategory(found, firstLoad);
      if (!CHANNELS.length && state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(liveEmptyMessage()); }
    }
    renderPlayerCategories();
    renderLiveDockCats();
    if (liveGuideOpen) { renderLiveGuideCats(); renderLiveGuideGrid(); }
    var waiting = liveListsWaiting;
    liveListsWaiting = [];
    for (var w = 0; w < waiting.length; w++) { waiting[w](); }
  }

  function renderLiveRows(favOnly) {
    if (!liveList) { return; }
    /* The remote was on a channel of the list: it stays on that channel's new
       row (the list is redrawn when the channels refresh). */
    var focusedChannel = state.focus && liveList.contains(state.focus) ? state.focus._channel : undefined;
    renderLiveRowsNow(favOnly);
    if (focusedChannel !== undefined && !liveList.contains(state.focus)) {
      var again = liveRows.filter(function (r) { return r._channel === focusedChannel; })[0] || liveRows[0];
      if (again) { setFocus(again, true); }
    }
  }

  function renderLiveRowsNow(favOnly) {
    var keepScroll = window.OPENTV_DESKTOP ? liveList.scrollTop : 0;
    clear(liveList);
    if (keepScroll) { setTimeout(function () { liveList.scrollTop = keepScroll; }, 0); }
    liveRows = [];
    if (!CHANNELS.length) {
      var saved = currentLiveCategory && currentLiveCategory.isSaved;
      if (liveChannelsPending() && !saved) {
        liveList.appendChild(makeLoader('Cargando canales…', 'is-list'));
        setLiveInfoText('');
        return;
      }
      var listStatus = el('div', 'live-list-status', liveEmptyMessage());
      /* No lists (or none could be read): a way to add one. */
      if (liveNeedsLists() && !saved) {
        listStatus.appendChild(document.createElement('br'));
        listStatus.appendChild(makeLiveListsButton());
      }
      liveList.appendChild(listStatus);
      setLiveInfoText('');
      return;
    }
    /* Desktop: the list can hold 1000+ channels. Drawing them all made every
       return to the home screen recompute ~7,500 elements (a visible stall),
       so rows are added in batches as the list scrolls (or as the current
       channel moves further down). */
    liveRowsFavOnly = !!favOnly;
    var hasQuery = !!(liveChannelQuery && norm(liveChannelQuery));
    var limit = (window.OPENTV_DESKTOP && !favOnly && !hasQuery)
      ? Math.min(CHANNELS.length, Math.max(LIVE_ROWS_BATCH, state.channel + (platformIsTv() ? 12 : 25)))
      : CHANNELS.length;
    appendLiveRows(limit);
    if (hasQuery && !liveRows.length) {
      liveList.appendChild(el('div', 'live-list-status', 'Sin canales para «' + liveChannelQuery.trim() + '»'));
    }
    if (CHANNELS[state.channel] && liveInfoText) {
      setLiveInfoText(CHANNELS[state.channel].name);
    }
    if (!hasQuery) { scrollLiveList(); }
    if (liveGuideOpen) { renderLiveGuideGrid(); }
  }

  /* TVs show bigger rows (about seven at a time): a smaller first batch makes
     TV en vivo quicker to open; more are added as the remote goes down. */
  var LIVE_ROWS_BATCH = (typeof platformIsTv === 'function' && platformIsTv()) ? 24 : 60;
  var liveRowsFavOnly = false;
  var liveRowsShown = 0;
  var liveChannelQuery = '';

  function channelMatchesQuery(ch, index, query) {
    if (!query) { return true; }
    var q = norm(query);
    if (!q) { return true; }
    var name = norm((ch && ch.name) || '');
    var num = String((ch && ch.index) || (index + 1));
    var code = norm((ch && ch.channelCode) || '');
    return name.indexOf(q) !== -1 || num.indexOf(q) !== -1 || code.indexOf(q) !== -1;
  }

  function setLiveChannelQuery(val, sourceInput) {
    liveChannelQuery = String(val || '');
    var inputs = document.querySelectorAll('.csb-input');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i] !== sourceInput && inputs[i].value !== liveChannelQuery) {
        inputs[i].value = liveChannelQuery;
      }
      if (inputs[i].parentNode) {
        inputs[i].parentNode.classList.toggle('has-text', !!liveChannelQuery);
      }
    }
    renderLiveRows(liveRowsFavOnly);
    if (playerChannels) { renderPlayerChannels(state.channel); }
  }

  function createChannelSearchBox(cls, placeholder) {
    var wrap = el('div', 'channel-search-box ' + (cls || ''));
    var ico = el('i', 'csb-icon');
    ico.innerHTML = UI_ICONS.search;
    var inp = document.createElement('input');
    inp.type = 'search';
    inp.className = 'csb-input';
    inp.placeholder = placeholder || 'Buscar canal…';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.value = liveChannelQuery || '';
    var clr = el('button', 'csb-clear');
    clr.type = 'button';
    clr.innerHTML = UI_ICONS.close;
    clr.setAttribute('data-tip', 'Limpiar búsqueda');
    clr.setAttribute('aria-label', 'Limpiar búsqueda');
    wrap.classList.toggle('has-text', !!inp.value);
    inp.addEventListener('input', function () {
      setLiveChannelQuery(inp.value, inp);
    });
    inp.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (inp.value) {
          setLiveChannelQuery('', null);
        } else {
          inp.blur();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        inp.blur();
        if (cls === 'is-player' && playerChannels) {
          var firstPc = playerChannels.querySelector('.pc-row');
          if (firstPc) { setFocus(firstPc); }
        } else if (liveRows && liveRows.length) {
          setFocus(liveRows[0]);
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        if (cls === 'is-player' && playerChannels) {
          var firstMatch = playerChannels.querySelector('.pc-row');
          if (firstMatch && firstMatch._activate) { firstMatch._activate(); }
        } else if (liveRows && liveRows.length && liveRows[0]._activate) {
          setChannel(liveRows[0]._channel, true);
        }
        return;
      }
      event.stopPropagation();
    });
    clr.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setLiveChannelQuery('', null);
      inp.focus();
    });
    wrap.appendChild(ico);
    wrap.appendChild(inp);
    wrap.appendChild(clr);
    /* TVs, TV en vivo: the box is one focusable control; OK opens the
       on-screen keyboard (core/tv-keyboard.js) over the channel column, not
       the system keyboard. The list is filtered with its Buscar key. */
    if (cls === 'is-home' && platformIsTv()) {
      inp.readOnly = true;
      inp.tabIndex = -1;
      wrap.classList.add('focusable');
      wrap._activate = function () { openLiveSearchKeyboard(wrap); };
    }
    return wrap;
  }

  function openLiveSearchKeyboard(box) {
    var side = closest(box, '.live-side');
    var page = side && side.parentNode;
    if (!page) { return; }
    openTvKeyboardPanel(page, {
      placeholder: 'Nombre del canal',
      value: liveChannelQuery,
      cls: 'is-live',
      cover: side,
      doneLabel: 'Buscar',
      onDone: function (v) {
        setLiveChannelQuery(v, null);
        if (liveRows && liveRows.length) { setFocus(liveRows[0]); }
        else { setFocus(box); }
      }
    });
  }

  /* Renders channel rows up to (not including) index `upTo`. */
  function appendLiveRows(upTo) {
    if (!liveList) { return; }
    if (window.OPENTV_DESKTOP && !liveList._lazyRows) {
      liveList._lazyRows = true;
      liveList.addEventListener('scroll', function () {
        if (liveRowsShown < CHANNELS.length && liveList.scrollTop + liveList.clientHeight > liveList.scrollHeight - 700) {
          appendLiveRows(liveRowsShown + LIVE_ROWS_BATCH);
        }
      }, { passive: true });
    }
    if (!liveRows.length) { liveRowsShown = 0; }
    var frag = document.createDocumentFragment();
    for (var i = liveRowsShown; i < Math.min(upTo, CHANNELS.length); i++) {
      if (liveRowsFavOnly && !CHANNELS[i].fav) { continue; }
      if (liveChannelQuery && !channelMatchesQuery(CHANNELS[i], i, liveChannelQuery)) { continue; }
      var row = makeLiveRow(i);
      frag.appendChild(row);
      liveRows.push(row);
    }
    liveRowsShown = Math.max(liveRowsShown, Math.min(upTo, CHANNELS.length));
    liveList.appendChild(frag);
  }

  function ensureLiveRowsUpTo(index) {
    if (window.OPENTV_DESKTOP && liveRowsShown < CHANNELS.length && index >= liveRowsShown - 5) {
      appendLiveRows(Math.min(CHANNELS.length, index + LIVE_ROWS_BATCH));
    }
  }

  function makeLiveRow(i) {
    var row = el('div', 'live-row focusable');
    row._channel = i;
    var icon = el('div', 'row-icon');
    if (CHANNELS[i].logo) {
      icon.style.backgroundImage = 'url(' + CHANNELS[i].logo + ')';
      icon.style.backgroundSize = 'contain';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundPosition = 'center';
    }
    var play = el('div', 'row-play');
    var name = el('div', 'row-name', CHANNELS[i].name);
    /* PC: number, logo, then the name with its category under it. */
    if (typeof liveSideLayout === 'function' && liveSideLayout()) {
      row.appendChild(el('div', 'row-num', String(i + 1)));
      row.appendChild(icon);
      var rowText = el('div', 'row-text');
      rowText.appendChild(name);
      rowText.appendChild(el('div', 'row-sub', liveChannelGroups(CHANNELS[i]).join(', ')));
      row.appendChild(rowText);
    } else {
      row.appendChild(icon);
      row.appendChild(play);
      row.appendChild(name);
    }
    if (i === state.channel) { row.classList.add('is-current'); }
    if (CHANNELS[i]._keptPlaying) { row.classList.add('is-kept'); row.title = 'En reproducción (de otra categoría)'; }
    row._activate = (function (idx) {
      return function () {
        if (window.OPENTV_DESKTOP) {
          /* Desktop: a click only switches the home preview. Enter on the
             channel already playing (keyboard) opens it big. */
          if (idx === state.channel) { if (focusRingVisible) { openPlayer('live'); } return; }
          setChannel(idx, true);
          return;
        }
        setChannel(idx, true); openPlayer('live');
      };
    })(i);
    if (window.OPENTV_DESKTOP) {
      (function (idx, r) {
        r.addEventListener('dblclick', function () { setChannel(idx, true); openPlayer('live'); });
        var open = el('button', 'row-open');
        open.type = 'button';
        open.innerHTML = UI_ICONS.fullscreen;
        open.setAttribute('data-tip', 'Ver en pantalla grande');
        open.setAttribute('aria-label', 'Ver ' + (CHANNELS[idx].name || 'canal') + ' en pantalla grande');
        open.addEventListener('click', function (event) {
          event.stopPropagation();
          setChannel(idx, true);
          openPlayer('live');
        });
        r.appendChild(open);
        r.setAttribute('data-tip', 'Clic: ver aquí · Doble clic: pantalla grande');
      })(i, row);
    }
    row._onMove = (function (rowIdx) {
      return function (dir) {
        /* Design "3A": the video is on the right of the list; on a TV, left
           goes to the menu. */
        var side = typeof liveSideLayout === 'function' && liveSideLayout();
        if (dir === (side ? 'right' : 'left')) {
          if (liveFocus) { setFocus(liveFocus); }
          else if (tabEls[0]) { setFocus(tabEls[0]); }
          return true;
        }
        if (side && dir === 'left') {
          if (platformIsTv() && tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
          return true;
        }
        if (dir === 'up') {
          var catBtn = side && liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
          if (rowIdx > 0 && liveRows[rowIdx - 1]) {
            setFocus(liveRows[rowIdx - 1]);
          } else if (catBtn) {
            setFocus(catBtn);
          } else {
            /* From the first channel: up to Buscar, Mi lista and the profile. */
            focusHomeTopIcons();
          }
          return true;
        }
        if (dir === 'down') {
          if (rowIdx >= liveRows.length - 2) { ensureLiveRowsUpTo(liveRows[rowIdx]._channel + 1); }
          if (rowIdx < liveRows.length - 1 && liveRows[rowIdx + 1]) {
            setFocus(liveRows[rowIdx + 1]);
          }
          return true;
        }
        return false;
      };
    })(liveRows.length);
    return row;
  }

  /* The round icons at the top of the home screen (Buscar first). */
  function focusHomeTopIcons() {
    var bar = $('home-notify');
    if (!bar) { return false; }
    var first = bar.querySelector('.notify-item.search') || firstIn(bar);
    if (first && isVisible(first)) { setFocus(first); return true; }
    return false;
  }

  function scrollLiveList() {
    ensureLiveRowsUpTo(state.channel);
    if (!liveRows.length) { return; }
    var visible = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
    if (!visible) { return; }
    var idx = liveRows.indexOf(visible);
    var top = idx * 120;
    var max = Math.max(0, liveList.scrollHeight - liveList.clientHeight);
    var target = liveList.scrollTop;
    if (top < target) { target = top; }
    if (top + 100.5 > target + liveList.clientHeight) {
      target = top + 100.5 - liveList.clientHeight;
    }
    liveList.scrollTop = Math.max(0, Math.min(max, target));
  }

  function setChannel(index, immediate) {
    /* Arrow keys before the list has loaded must not leave channel -1. */
    if (!CHANNELS.length) { return; }
    if (index < 0) { index = 0; }
    if (index > CHANNELS.length - 1) { index = CHANNELS.length - 1; }
    state.channel = index;
    for (var i = 0; i < liveRows.length; i++) {
      liveRows[i].classList.toggle('is-current', liveRows[i]._channel === index);
    }
    if (CHANNELS[index] && liveInfoText) {
      setLiveInfoText(CHANNELS[index].name);
    }
    scrollLiveList();
    syncLiveFavButton();
    if (window.OPENTV_DESKTOP && CHANNELS[index]) { rememberLiveChannel(CHANNELS[index]); updateTitleBarSection(); }
    if (state.screen === 'player') {
      updatePlayerChannel();
      if (state.playerMode === 'live') {
        startLiveChannel(CHANNELS[index], !!immediate);
      }
    } else if (state.screen === 'home' && onTvTab()) {
      scheduleLivePreview(CHANNELS[index]);
    }
  }

  /* ---- live/addons-dialog.js ------------------------------------------------- */
  /* live/addons-dialog.js — "Buscar listas de TV": las listas M3U recomendadas
     (PRESET_ADDONS), con un buscador. Se abre con el botón Buscar de Ajustes →
     Addons y desde el panel de canales del reproductor. El mismo diálogo muestra
     los addons recomendados (botón Recomendados de Películas y series).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var addonsDialogReturn = null;
  /* 'm3u': TV lists (PRESET_ADDONS). 'vod': recommended movie and series
     addons (RECOMMENDED_VOD_ADDONS), from Ajustes → Addons → Recomendados. */
  var addonsDialogMode = 'm3u';

  function openAddonsDialog(mode) {
    var dlg = $('dialog-addons');
    if (!dlg) { return; }
    addonsDialogMode = mode === 'vod' ? 'vod' : 'm3u';
    var title = dlg.querySelector('.da-title');
    if (title) { title.textContent = addonsDialogMode === 'vod' ? 'Addons recomendados' : 'Buscar listas de TV'; }
    dialogAddonsOpen = true;
    addonsDialogReturn = state.focus;
    dlg.classList.add('is-active');
    var search = $('da-search');
    if (search) {
      search.placeholder = addonsDialogMode === 'vod' ? 'Buscar (Torrentio, TorrentsDB…)' : 'País, idioma o tema (México, noticias, infantil…)';
    }
    if (search && !search._bound) {
      search._bound = true;
      search.addEventListener('input', function () { renderAddonsDialog(); });
      search.addEventListener('keydown', function (ev) {
        if (ev.keyCode === 27) { ev.preventDefault(); closeAddonsDialog(); return; }
        ev.stopPropagation();
      });
    }
    if (search) { search.value = ''; }
    renderAddonsDialog();
    var first = dlg.querySelector('.da-preset-item.focusable') || search;
    if (first) { setFocus(first); }
  }

  function closeAddonsDialog() {
    dialogAddonsOpen = false;
    var dlg = $('dialog-addons');
    if (!dlg) { return; }
    dlg.classList.remove('is-active');
    if (state.channelsOpen) {
      var btn = playerChannels ? playerChannels.querySelector('#pc-btn-addons') : null;
      if (btn) { setFocus(btn); }
      else { setFocus(playerStage); }
      return;
    }
    /* From Ajustes → Addons → TV en vivo: show the lists just added there. */
    if (state.screen === 'settings' && typeof settingsIndexOf === 'function') {
      showSettingsPanel(settingsIndexOf('sources'), false);
      var again = settingsRight && settingsRight.querySelector(addonsDialogMode === 'vod' ? '.fx-btn.is-recommend' : '.fx-btn.is-search');
      if (again) { setFocus(again); return; }
    }
    if (addonsDialogReturn && isVisible(addonsDialogReturn)) { setFocus(addonsDialogReturn); }
  }

  function renderAddonsDialog() {
    var box = $('da-presets-list');
    if (!box) { return; }
    var q = norm(($('da-search') || {}).value || '');
    if (addonsDialogMode === 'vod') { renderVodAddonsDialog(box, q); return; }
    var saved = {};
    getSavedAddons().forEach(function (ad) { saved[ad.url] = true; });
    clear(box);
    var shown = 0;
    PRESET_ADDONS.forEach(function (preset) {
      if (q && norm(preset.name + ' ' + preset.desc).indexOf(q) === -1) { return; }
      shown++;
      var on = !!saved[preset.url];
      var item = el('div', 'da-preset-item focusable' + (on ? ' is-installed' : ''));
      var info = el('div', 'da-preset-info');
      info.appendChild(el('div', 'da-preset-name', preset.name));
      info.appendChild(el('div', 'da-preset-desc', preset.desc));
      item.appendChild(info);
      var tag = el('span', 'da-preset-tag', on ? '✔ Agregada' : '+ Agregar');
      item.appendChild(tag);
      item._activate = function () {
        if (on || item._busy) { return; }
        item._busy = true;
        tag.textContent = 'Agregando…';
        installAddon(preset, function (err, count) {
          item._busy = false;
          if (err) {
            tag.textContent = 'No cargó';
            setTimeout(function () { tag.textContent = '+ Agregar'; }, 2500);
            return;
          }
          on = true;
          item.classList.add('is-installed');
          tag.textContent = '✔ ' + count + ' canales';
          /* TV en vivo shows the new list's channels at once. */
          loadAddonChannels();
        });
      };
      box.appendChild(item);
    });
    if (!shown) { box.appendChild(el('div', 'da-empty', 'No hay listas con ese nombre.')); }
    var exitBtn = $('da-btn-exit');
    if (exitBtn) { exitBtn._activate = function () { closeAddonsDialog(); }; }
  }

  /* Recommended movie and series addons: sources, aggregator and a catalog. */
  function renderVodAddonsDialog(box, q) {
    clear(box);
    var shown = 0;
    RECOMMENDED_VOD_ADDONS.forEach(function (rec) {
      if (q && norm(rec.name + ' ' + rec.desc).indexOf(q) === -1) { return; }
      shown++;
      var on = isVodAddonInstalled(rec.url);
      var item = el('div', 'da-preset-item focusable' + (on ? ' is-installed' : ''));
      var info = el('div', 'da-preset-info');
      info.appendChild(el('div', 'da-preset-name', rec.name));
      info.appendChild(el('div', 'da-preset-desc', rec.desc));
      item.appendChild(info);
      var tag = el('span', 'da-preset-tag', on ? '✔ Agregado' : '+ Agregar');
      item.appendChild(tag);
      item._activate = function () {
        if (on || item._busy) { return; }
        item._busy = true;
        tag.textContent = 'Agregando…';
        installVodAddon({ url: rec.url }, function (err) {
          item._busy = false;
          if (err) {
            tag.textContent = 'No cargó';
            setTimeout(function () { tag.textContent = '+ Agregar'; }, 2500);
            return;
          }
          on = true;
          item.classList.add('is-installed');
          tag.textContent = '✔ Agregado';
        });
      };
      box.appendChild(item);
    });
    if (!shown) { box.appendChild(el('div', 'da-empty', 'No hay addons con ese nombre.')); }
    var exitBtn = $('da-btn-exit');
    if (exitBtn) { exitBtn._activate = function () { closeAddonsDialog(); }; }
  }

  function installAddon(addon, done) {
    portalServiceCall('fetchM3u', { url: addon.url }, function (err, payload) {
      if (err || !payload || !payload.channels || !payload.channels.length) {
        if (done) { done(err || 'No se encontraron canales en la lista'); }
        return;
      }
      var saved = getSavedAddons();
      /* Check duplicate */
      var exists = false;
      for (var s = 0; s < saved.length; s++) {
        if (saved[s].url === addon.url) {
          saved[s].count = payload.channels.length;
          exists = true;
          break;
        }
      }
      if (!exists) {
        saved.push({
          id: addon.id || ('addon_' + Date.now()),
          name: addon.name || 'Lista M3U',
          url: addon.url,
          count: payload.channels.length
        });
      }
      saveSavedAddons(saved);
      if (done) { done(null, payload.channels.length); }
    });
  }

  /* ---- live/guide.js --------------------------------------------------------- */
  /* live/guide.js — Escritorio: guía de canales (cuadrícula con buscador), favoritos y recientes.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The M3U lists bring no programme schedule (EPG), only the channels, so the
     guide lists channels: by the lists' categories (group-title), with a name
     filter, the favourites and the channels watched last. Favourites and
     recents are kept with their link, so they play from any category. */
  var LIVE_SAVED_KEY = 'opentv_live_saved_v1';
  var LIVE_RECENT_MAX = 24;
  var LIVE_SAVED_CATS = {
    favs: { id: 'saved:favs', name: 'Favoritos', isSaved: 'favs' },
    recent: { id: 'saved:recent', name: 'Recientes', isSaved: 'recent' }
  };

  function liveSaved() {
    var s = safeLocalRead(LIVE_SAVED_KEY, null);
    if (!s || typeof s !== 'object') { s = {}; }
    if (Object.prototype.toString.call(s.favs) !== '[object Array]') { s.favs = []; }
    if (Object.prototype.toString.call(s.recent) !== '[object Array]') { s.recent = []; }
    return s;
  }

  function savedChannelCopy(ch) {
    var out = { channelCode: ch.channelCode || '', name: ch.name || 'Canal', logo: ch.logo || '', uhd: !!ch.uhd };
    if (ch.streamUrl) { out.streamUrl = ch.streamUrl; }
    return out;
  }

  function sameChannel(a, b) {
    return !!(a && b) && liveChannelKey(a) !== '' && liveChannelKey(a) === liveChannelKey(b);
  }

  function rememberLiveChannel(ch) {
    if (!window.OPENTV_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
    var s = liveSaved();
    s.recent = s.recent.filter(function (x) { return !sameChannel(x, ch); });
    s.recent.unshift(savedChannelCopy(ch));
    s.recent = s.recent.slice(0, LIVE_RECENT_MAX);
    safeLocalWrite(LIVE_SAVED_KEY, s);
  }

  function syncSavedFavorite(ch, on) {
    if (!window.OPENTV_DESKTOP || !ch || !liveChannelKey(ch)) { return; }
    var s = liveSaved();
    s.favs = s.favs.filter(function (x) { return !sameChannel(x, ch); });
    if (on) { s.favs.unshift(savedChannelCopy(ch)); }
    safeLocalWrite(LIVE_SAVED_KEY, s);
  }

  function toggleLiveFavorite(ch) {
    if (!ch) { return false; }
    var key = liveFavKey(ch);
    var on = !(ch.fav || state.favs[key]);
    if (!!state.favs[key] !== on) { toggleFavorite({ id: key }); }
    /* Earlier versions saved M3U favourites as 'live:m3u_N' (the position in
       a list): drop that key when the channel stops being a favourite. */
    var legacy = ch.channelCode ? 'live:' + ch.channelCode : '';
    if (!on && legacy && legacy !== key && state.favs[legacy]) { toggleFavorite({ id: legacy }); }
    ch.fav = on;
    syncSavedFavorite(ch, ch.fav);
    syncLiveFavButton();
    return ch.fav;
  }

  /* Shows the saved list as the current channel list. */
  function loadSavedChannels(kind, done) {
    var keepPlaying = livePlayingToKeep();
    var list = liveSaved()[kind] || [];
    CHANNELS.splice(0, CHANNELS.length);
    var favUrls = liveFavoriteUrls();
    for (var i = 0; i < list.length; i++) {
      /* Channels saved from the old portal have no link and cannot play. */
      if (!list[i] || !list[i].streamUrl) { continue; }
      var ch = savedChannelCopy(list[i]);
      ch.index = CHANNELS.length + 1;
      ch.now = 'En vivo';
      ch.fav = !!(favUrls[ch.streamUrl] || state.favs[liveFavKey(ch)]);
      CHANNELS.push(ch);
    }
    state.channel = 0;
    if (keepPlaying && CHANNELS.length) { keepLivePlayingChannel(keepPlaying); }
    renderLiveRows(false);
    renderPlayerChannels();
    if (CHANNELS[state.channel]) {
      setLiveInfoText(CHANNELS[state.channel].name);
      if (state.screen === 'player' && state.playerMode === 'live') { updatePlayer(); if (!keepPlaying) { startLiveChannel(CHANNELS[0], true); } }
      else { scheduleLivePreview(CHANNELS[state.channel]); }
    }
    syncLiveFavButton();
    if (done) { done(); }
  }

  /* ------------------------------------------------------------------ guide */
  var liveGuideOpen = false;
  var liveGuide = null, liveGuideCats = null, liveGuideGrid = null, liveGuideCount = null, liveGuideSearch = null;
  var liveGuideReturnFocus = null;

  function buildLiveGuide() {
    liveGuide = el('div', 'live-guide');
    liveGuide.setAttribute('data-no-gesture', '');
    var panel = el('div', 'lg-panel');
    var head = el('div', 'lg-head');
    var titles = el('div', 'lg-titles');
    titles.appendChild(el('div', 'lg-title', 'Guía de canales'));
    liveGuideCount = el('div', 'lg-count', '');
    titles.appendChild(liveGuideCount);
    head.appendChild(titles);
    liveGuideSearch = document.createElement('input');
    liveGuideSearch.type = 'search';
    liveGuideSearch.className = 'lg-search focusable';
    liveGuideSearch.placeholder = 'Buscar canal';
    liveGuideSearch.setAttribute('aria-label', 'Buscar canal');
    liveGuideSearch.autocomplete = 'off';
    liveGuideSearch.addEventListener('input', renderLiveGuideGrid);
    liveGuideSearch.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLiveGuide(); return; }
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.keyCode === 13) {
        event.preventDefault();
        guideSearchToResults();
      } else if (platformIsTv() && /^Arrow(Up|Left|Right)$/.test(event.key)) {
        /* TV, keyboard closed: the remote's arrows leave the field like any
           other control (the page key handler ignores text fields). */
        event.preventDefault();
        liveGuideSearch.blur();
        moveFocus(event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowLeft' ? 'left' : 'right');
      }
      event.stopPropagation();
    });
    /* TV: the system keyboard's "Listo" may only close it (no Enter). */
    liveGuideSearch.addEventListener('change', function () {
      if (platformIsTv()) { guideSearchToResults(); }
    });
    liveGuideSearch._activate = function () {
      /* TVs: the on-screen keyboard (core/tv-keyboard.js) over the category
         column; the channels on the right are filtered while typing. */
      if (platformIsTv()) { openGuideKeyboard(panel); return; }
      liveGuideSearch.focus();
    };
    head.appendChild(liveGuideSearch);
    var close = el('button', 'lg-close focusable');
    close.type = 'button';
    close.innerHTML = UI_ICONS.close;
    close.setAttribute('data-tip', 'Cerrar (Esc)');
    close._activate = closeLiveGuide;
    head.appendChild(close);
    panel.appendChild(head);

    var body = el('div', 'lg-body');
    liveGuideCats = el('div', 'lg-cats scrollable');
    body.appendChild(liveGuideCats);
    liveGuideGrid = el('div', 'lg-grid scrollable');
    liveGuideGrid.addEventListener('scroll', guideNeedMore, { passive: true });
    body.appendChild(liveGuideGrid);
    panel.appendChild(body);
    liveGuide.appendChild(panel);
    liveGuide.addEventListener('click', function (event) {
      if (event.target === liveGuide) { closeLiveGuide(); }
    });
    ($('screen-home') || document.body).appendChild(liveGuide);
  }

  /* The guide's on-screen keyboard (TVs). Typing only edits the text; the
     channels are filtered once, with the Buscar key (a batch of cards per
     letter kept a Fire TV busy). */
  function openGuideKeyboard(panel) {
    openTvKeyboardPanel(panel, {
      title: 'Buscar canal',
      placeholder: 'Nombre del canal',
      value: liveGuideSearch.value,
      cls: 'is-guide',
      cover: liveGuideCats,
      hostClass: 'is-typing',
      doneLabel: 'Buscar',
      /* (Back closes it without changing the search.) */
      onDone: function (v) {
        liveGuideSearch.value = v;
        renderLiveGuideGrid();
        guideSearchToResults();
      }
    });
  }

  function openLiveGuide() {
    if (!window.OPENTV_DESKTOP) { return; }
    if (!liveGuide || !liveGuide.isConnected) { buildLiveGuide(); }
    liveGuideOpen = true;
    liveGuideReturnFocus = state.focus;
    liveGuideSearch.value = '';
    renderLiveGuideCats();
    renderLiveGuideGrid();
    liveGuide.classList.add('is-open');
    document.body.classList.add('has-live-guide');
    var current = liveGuideGrid.querySelector('.lg-card.is-current') || liveGuideGrid.querySelector('.lg-card');
    if (current) {
      setFocus(current, true);
      setTimeout(function () { reveal(current); }, 0);
    }
  }

  function closeLiveGuide() {
    if (!liveGuideOpen) { return; }
    liveGuideOpen = false;
    closeTvKeyboardPanel(true);
    if (liveGuide) { liveGuide.classList.remove('is-open'); }
    document.body.classList.remove('has-live-guide');
    if (liveGuideSearch) { liveGuideSearch.blur(); }
    var back = liveGuideReturnFocus && liveGuideReturnFocus.isConnected ? liveGuideReturnFocus : liveFocus;
    if (back) { setFocus(back, true); }
  }

  function guideCategories() {
    var groups = [{ title: '', items: [] }, { title: 'Categorías', items: [] }];
    groups[0].items.push({ cat: LIVE_ALL_CATEGORY, label: 'Todos' });
    for (var i = 0; i < liveCategories.length; i++) {
      var c = liveCategories[i];
      if (c.id !== LIVE_ALL_CATEGORY.id) { groups[1].items.push({ cat: c, label: c.name }); }
    }
    groups[0].items.push({ cat: LIVE_SAVED_CATS.favs, label: 'Favoritos', icon: UI_ICONS.star });
    groups[0].items.push({ cat: LIVE_SAVED_CATS.recent, label: 'Recientes', icon: UI_ICONS.history });
    return groups;
  }

  function renderLiveGuideCats() {
    if (!liveGuideCats) { return; }
    clear(liveGuideCats);
    guideCategories().forEach(function (g) {
      if (!g.items.length) { return; }
      if (g.title) { liveGuideCats.appendChild(el('div', 'lg-cat-label', g.title)); }
      g.items.forEach(function (it) {
        var selected = currentLiveCategory && (currentLiveCategory === it.cat || currentLiveCategory.id === it.cat.id);
        var b = el('div', 'lg-cat focusable' + (selected ? ' is-selected' : ''));
        if (it.icon) { b.innerHTML = it.icon; }
        b.appendChild(el('span', '', it.label));
        b._catId = it.cat.id || it.label;
        b._activate = function () {
          liveGuideSearch.value = '';
          switchLiveCategory(it.cat, function () { renderLiveGuideGrid(); });
          renderLiveGuideCats();
          renderLiveDockCats();
          renderLiveGuideGrid();
          /* The list was rebuilt: focus the new button of this category, not
             the old one (detached, the next arrow would leave the guide). */
          focusGuideCategory(b._catId);
        };
        liveGuideCats.appendChild(b);
      });
    });
  }

  /* From the guide's search field to the first channel found. */
  function guideSearchToResults() {
    if (!liveGuideOpen) { return; }
    var first = liveGuideGrid.querySelector('.lg-card');
    liveGuideSearch.blur();
    if (first) { setFocusRingVisible(true); setFocus(first); }
    /* Nothing found: back on the search field (the keyboard's panel that had
       the focus is gone), to try another name. */
    else { setFocus(liveGuideSearch); }
  }

  function focusGuideCategory(catId) {
    var cats = liveGuideCats ? liveGuideCats.querySelectorAll('.lg-cat') : [];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i]._catId === catId) { setFocus(cats[i], true); return; }
    }
    if (cats[0]) { setFocus(cats[0], true); }
  }

  /* Somewhere to put the focus back inside the open guide (a rebuilt card or
     category, a key that tried to leave it). */
  function guideFocusFallback() {
    if (!liveGuide) { return null; }
    return liveGuide.querySelector('.lg-card.is-focused') || liveGuide.querySelector('.lg-cat.is-selected') ||
      liveGuideGrid.querySelector('.lg-card.is-current') || liveGuideGrid.querySelector('.lg-card') || liveGuide.querySelector('.focusable');
  }

  var GUIDE_BATCH = 36;
  var guideIndexes = [];   /* CHANNELS indexes shown in the grid (search applied) */
  var guideShown = 0;      /* how many of them have a card */

  function appendGuideCards(upTo) {
    var end = Math.min(upTo, guideIndexes.length);
    if (end <= guideShown) { return; }
    var frag = document.createDocumentFragment();
    for (var i = guideShown; i < end; i++) {
      var card = makeGuideCard(CHANNELS[guideIndexes[i]], guideIndexes[i]);
      card._guidePos = i;
      frag.appendChild(card);
    }
    guideShown = end;
    liveGuideGrid.appendChild(frag);
  }

  /* Near the end of what is drawn (scrolling, or the remote going down). */
  function guideNeedMore() {
    if (!liveGuideGrid || guideShown >= guideIndexes.length) { return; }
    if (liveGuideGrid.scrollTop + liveGuideGrid.clientHeight > liveGuideGrid.scrollHeight - 600) {
      appendGuideCards(guideShown + GUIDE_BATCH);
    }
  }

  function renderLiveGuideGrid() {
    if (!liveGuideOpen || !liveGuideGrid) { return; }
    var keep = liveGuideGrid.scrollTop;
    var focusedKey = state.focus && state.focus._guideKey;
    clear(liveGuideGrid);
    var q = norm(String(liveGuideSearch.value || '').trim());
    /* The channels that match; their cards are drawn in batches (a category
       can hold 760 channels, about 7,000 elements at once on a Fire TV). */
    guideIndexes = [];
    var want = GUIDE_BATCH;
    for (var i = 0; i < CHANNELS.length; i++) {
      var ch = CHANNELS[i];
      if (q && itemNorm(ch, 'name').indexOf(q) === -1) { continue; }
      /* Far enough to include the channel playing and the focused card. */
      if (i === state.channel || (focusedKey && liveChannelKey(ch) === focusedKey)) { want = Math.max(want, guideIndexes.length + 13); }
      guideIndexes.push(i);
    }
    guideShown = 0;
    appendGuideCards(want);
    var shown = guideIndexes.length;
    if (!shown) {
      var msg = q ? 'Ningún canal coincide con «' + liveGuideSearch.value.trim() + '»'
        : currentLiveCategory && currentLiveCategory.isSaved === 'favs' && !platformIsTv()
          ? 'Aún no tienes canales favoritos. Pasa el ratón por un canal y toca la estrella.'
        : liveEmptyMessage();
      var empty = el('div', 'lg-empty', msg);
      if (!CHANNELS.length && liveChannelsLoading) { empty.insertBefore(el('i', 'tv-loader'), empty.firstChild); }
      if (!q && liveNeedsLists() && !(currentLiveCategory && currentLiveCategory.isSaved)) {
        empty.appendChild(document.createElement('br'));
        var addBtn = makeLiveListsButton();
        var baseActivate = addBtn._activate;
        addBtn._activate = function () { closeLiveGuide(); baseActivate(); };
        empty.appendChild(addBtn);
      }
      liveGuideGrid.appendChild(empty);
    }
    var name = currentLiveCategory ? currentLiveCategory.name : 'Todos';
    liveGuideCount.textContent = name + ' · ' + (q ? shown + ' de ' + CHANNELS.length : CHANNELS.length) + (CHANNELS.length === 1 && !q ? ' canal' : ' canales') +
      (liveChannelsLoading ? ' · cargando…' : '');
    liveGuideGrid.scrollTop = keep;
    if (focusedKey) {
      var again = liveGuideGrid.querySelector('[data-key="' + String(focusedKey).replace(/"/g, '') + '"]');
      if (again) { setFocus(again, true); }
    }
  }

  function makeGuideCard(ch, idx) {
    var card = el('div', 'lg-card focusable' + (idx === state.channel ? ' is-current' : ''));
    card._guideKey = liveChannelKey(ch) || ('i' + idx);
    card.setAttribute('data-key', String(card._guideKey).replace(/"/g, ''));
    var logo = el('div', 'lg-logo');
    if (ch.logo) { logo.style.backgroundImage = 'url("' + String(ch.logo).replace(/"/g, '%22') + '")'; }
    else { logo.appendChild(el('span', 'lg-initial', String(ch.name || '?').charAt(0).toUpperCase())); }
    card.appendChild(logo);
    var info = el('div', 'lg-info');
    info.appendChild(el('div', 'lg-name', ch.name || 'Canal'));
    var meta = el('div', 'lg-meta');
    meta.appendChild(el('span', 'lg-live', idx === state.channel ? 'Viendo ahora' : 'En vivo'));
    if (ch.uhd) { meta.appendChild(el('span', 'lg-badge', '4K')); }
    info.appendChild(meta);
    card.appendChild(info);

    var fav = el('button', 'lg-fav' + (ch.fav ? ' is-on' : ''));
    fav.type = 'button';
    fav.innerHTML = UI_ICONS.star;
    fav.setAttribute('data-tip', ch.fav ? 'Quitar de favoritos' : 'Añadir a favoritos');
    fav.addEventListener('click', function (event) {
      event.stopPropagation();
      var on = toggleLiveFavorite(ch);
      fav.classList.toggle('is-on', on);
      fav.setAttribute('data-tip', on ? 'Quitar de favoritos' : 'Añadir a favoritos');
    });
    card.appendChild(fav);
    var big = el('button', 'lg-open');
    big.type = 'button';
    big.innerHTML = UI_ICONS.fullscreen;
    big.setAttribute('data-tip', 'Ver en pantalla grande');
    big.addEventListener('click', function (event) {
      event.stopPropagation();
      closeLiveGuide();
      setChannel(idx, true);
      openPlayer('live');
    });
    card.appendChild(big);

    /* Up from the first row goes to the search field (it went to the
       category list, the nearest by distance). */
    card._onMove = function (dir) {
      var first = liveGuideGrid.querySelector('.lg-card');
      if (dir === 'up' && first && card.offsetTop <= first.offsetTop + 2) { setFocus(liveGuideSearch); return true; }
      /* Down near the last drawn row: draw the next batch first. */
      if (dir === 'down' && card._guidePos >= guideShown - 6) { appendGuideCards(guideShown + GUIDE_BATCH); }
      return false;
    };
    card._activate = function () {
      closeLiveGuide();
      if (idx !== state.channel) { setChannel(idx, true); }
      else if (focusRingVisible) { openPlayer('live'); }
    };
    card.addEventListener('dblclick', function () { closeLiveGuide(); setChannel(idx, true); openPlayer('live'); });
    return card;
  }

  function installLiveGuide() {
    if (!window.OPENTV_DESKTOP) { return; }
    document.addEventListener('keydown', function (event) {
      if (!liveGuideOpen) {
        /* G opens the guide from the TV tab. */
        if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.altKey && state.screen === 'home' && onTvTab() &&
            !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) {
          event.preventDefault();
          openLiveGuide();
        }
        return;
      }
      if (event.key === 'Escape' || event.key === 'Backspace') {
        if (document.activeElement === liveGuideSearch && event.key === 'Backspace') { return; }
        event.preventDefault();
        event.stopPropagation();
        closeLiveGuide();
      }
    }, true);
  }

  /* ---- live/adult-filter.js -------------------------------------------------- */
  /* live/adult-filter.js — Las categorías para adultos (+18) de las listas M3U no se muestran nunca.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* M3U lists can carry adult ("18+", "XXX") groups. OpenTV never lists them
     or their channels, on any platform, and never opens them. */
  function isAdultCategory(cat) {
    if (!cat) { return false; }
    var name = String(cat.name || '');
    return /18\s*\+|\+\s*18|adult|xxx/i.test(name);
  }

  /* Settings and PIN left by older versions (the private section is gone). */
  function forgetPrivateContent() {
    try {
      var keys = ['opentv_private_v1', 'opentv_private_block_v1'];
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && /^opentv_private_(v1|block_v1)(@|$)/.test(k)) { keys.push(k); }
      }
      for (var j = 0; j < keys.length; j++) { localStorage.removeItem(keys[j]); }
    } catch (eForget) { /* storage off */ }
  }

  /* ---- home/catalog-pages.js ------------------------------------------------- */
  /* home/catalog-pages.js — Páginas de catálogo del inicio: mosaicos, cuadrículas, Destacados, Películas, Series, Kids, etc.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ---------------------------------------------------------- home posters */
  /* Bento mosaic measured on the running app (WSA, 1920x1080):
       mRecommend01 831x534 @ 192,212   mRecommend02 831x534 @ 1029,212
       mRecommend03..06 413x222 @ y 752, x 192/609/1028/1446
       pagination dots around 843,723 (screen) -> page coords subtract 173.5.
     The page grid is identical for DESTACADOS, PELICULA, SERIES and ANIME. */
  var BENTO_GAP = 9;
  var BENTO = {
    bigW: 831, bigH: 534, bigY: 38.5,
    smallW: 413, smallH: 222, smallY: 578.5,
    bigX: [192, 1029],
    smallX: [192, 609, 1028, 1446]
  };

  function makeBento(item, x, y, w, h, opts) {
    opts = opts || {};
    var t = el('div', 'bento focusable');
    /* Desktop: a little air between the large tiles. */
    var gap = window.OPENTV_DESKTOP ? BENTO_GAP : 0;
    abs(t, x + gap, y + gap, w - gap * 2, h - gap * 2);
    var art = item ? (item.landscape || item.poster) : '';
    if (art) {
      var img = el('img', 'bento-img');
      img.decoding = 'async';
      img.setAttribute('data-poster-src', art);
      img.onerror = posterImageError;
      img.onload = posterImageLoaded;
      t.appendChild(img);
    }
    if (opts.shade) { t.appendChild(el('div', 'bento-shade')); }
    if (opts.title && item) { t.appendChild(el('div', 'bento-title', item.title)); }
    if (opts.badge) { t.appendChild(el('div', 'bento-badge', opts.badge)); }
    t._item = item;
    if (item) { t._activate = function () { openDetail(item); }; }
    if (window.OPENTV_DESKTOP && item && !art) { applyGenericCover(t, item); }
    schedulePosterMemoryPass();
    return t;
  }

  function bentoDots(x, y, count, active) {
    var d = el('div', 'bento-dots');
    abs(d, x, y, 21 + Math.max(0, count - 1) * 40, 11);
    for (var i = 0; i < count; i++) {
      d.appendChild(el('span', 'bento-dot' + (i === active ? ' is-active' : '')));
    }
    return d;
  }

  function bentoPage(page, items, opts) {
    opts = opts || {};
    var source = items.length ? items : VOD;
    if (!source.length) { return; }
    var i;
    for (i = 0; i < 2; i++) {
      page.appendChild(makeBento(source[i % source.length], BENTO.bigX[i], BENTO.bigY,
                                 BENTO.bigW, BENTO.bigH,
                                 { shade: opts.shade !== false, title: opts.titles }));
    }
    for (i = 0; i < 4; i++) {
      page.appendChild(makeBento(source[(i + 2) % source.length], BENTO.smallX[i], BENTO.smallY,
                                 BENTO.smallW, BENTO.smallH, {}));
    }
    if (opts.dots) {
      var dots = bentoDots(848, 535.5, opts.dots, 0);
      page.appendChild(dots);
      if (window.OPENTV_DESKTOP && opts.titles && source.length > 1) {
        /* The rotation must not repeat the titles already on the other tiles:
           use the first title plus the ones after the six tiles when the
           section has them. */
        var spin = source.length > 6 ? [source[0]].concat(source.slice(6)) : source;
        registerBannerCarousel(page, page.querySelector('.bento'), dots, spin.slice(0, Math.min(opts.dots, spin.length)));
      }
    }
  }

  /* Desktop banner carousel. Every few seconds the big banner shows the next
     title (and its dot lights up). It pauses while the pointer is on it or it
     has focus, and only runs on the visible home page. Dots can be clicked. */
  var bannerCarousels = [];
  var bannerTimer = null;
  var BANNER_INTERVAL_MS = 6500;
  var bannerKeyAt = 0;
  var bannerPointerAt = 0;
  if (window.OPENTV_DESKTOP) {
    document.addEventListener('keydown', function () { bannerKeyAt = Date.now(); }, true);
    document.addEventListener('pointermove', function () { bannerPointerAt = Date.now(); }, { capture: true, passive: true });
  }

  function registerBannerCarousel(page, hero, dots, items) {
    if (!hero || items.length < 2) { return; }
    var c = { page: page, hero: hero, dots: dots, items: items, index: 0 };
    bannerCarousels = bannerCarousels.filter(function (x) { return x.hero.isConnected; });
    bannerCarousels.push(c);
    var spans = dots.querySelectorAll('.bento-dot');
    for (var i = 0; i < spans.length; i++) {
      (function (k) {
        spans[k].setAttribute('data-tip', items[k] ? items[k].title : '');
        spans[k].addEventListener('click', function (event) {
          event.stopPropagation();
          showBannerSlide(c, k);
        });
      })(i);
    }
    if (!bannerTimer) { bannerTimer = setInterval(advanceBanners, BANNER_INTERVAL_MS); }
  }

  function advanceBanners() {
    for (var i = 0; i < bannerCarousels.length; i++) {
      var c = bannerCarousels[i];
      if (!c.hero.isConnected || state.screen !== 'home' || !c.page.classList.contains('is-current')) { continue; }
      /* Paused while the pointer moves over it, or while the keyboard is on it. The
         first banner gets focus by itself when a tab opens, so focus alone must
         not stop it. */
      var keyboardOnHero = state.focus === c.hero && Date.now() - bannerKeyAt < 15000;
      var pointerOnHero = Date.now() - bannerPointerAt < 4000 && (c.hero.matches(':hover') || c.dots.matches(':hover'));
      if (keyboardOnHero || pointerOnHero) { continue; }
      showBannerSlide(c, (c.index + 1) % c.items.length);
    }
  }

  function showBannerSlide(c, k) {
    if (k === c.index || !c.items[k]) { return; }
    var item = c.items[k];
    c.index = k;
    var spans = c.dots.querySelectorAll('.bento-dot');
    for (var i = 0; i < spans.length; i++) { spans[i].classList.toggle('is-active', i === k); }
    var hero = c.hero;
    hero.classList.add('is-sliding');
    setTimeout(function () {
      var art = item.landscape || item.poster;
      var img = hero.querySelector('.bento-img');
      if (art) {
        if (!img) { img = el('img', 'bento-img'); img.onerror = posterImageError; img.onload = posterImageLoaded; hero.insertBefore(img, hero.firstChild); }
        img.style.display = '';
        img._posterRetries = 0;
        img.setAttribute('data-poster-src', art);
        img.src = art;
      }
      var title = hero.querySelector('.bento-title');
      if (title) { title.textContent = item.title; }
      hero._item = item;
      hero._activate = function () { openDetail(item); };
      hero.classList.remove('is-sliding');
    }, 260);
  }

  /* DESTACADOS / PELICULA: the observed 831x534 crops already contain the
     real title bar and pagination dots drawn by the APK, so the port must not
     paint a second copy over them. Portal artwork is plain 16:9 art, so the
     title and dots have to be drawn. */
  function allVodFor(category) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        /* (Titles of an anime list only live in Anime, not in Series.) */
        if (VOD[i]._animeCat && category !== 'anime') { continue; }
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1 || (VOD[i].kind && norm(VOD[i].kind).indexOf(category) !== -1)) {
          out.push(VOD[i]);
        }
      }
    }
    return withCovers(out.length ? out : (!category || category === 'destacado' ? VOD : []));
  }

  function appendCatalogGrid(page, items, startY, titleText) {
    if (!items || !items.length) { return; }
    var y = startY || 860;
    var sub = el('div', 'kids-subtitle', titleText || 'Catálogo');
    abs(sub, 192, y, 1249, 40);
    page.appendChild(sub);
    y += 50;

    var compact = window.OPENTV_DESKTOP && catalogCompact();
    var colW = compact ? 236 : 276;
    var colH = compact ? 340 : 390;
    var maxCols = compact ? 7 : 6;
    var posterW = compact ? 214 : 250, posterH = compact ? 308 : 360;
    /* TVs: the same six columns as the rows, inside the screen margins. */
    if (platformIsTv()) { colW = ROW_STEP; colH = ROW_POSTER_H + 34; maxCols = 6; posterW = ROW_POSTER_W; posterH = ROW_POSTER_H; }
    var cursor = 0;
    var more = null;
    if (window.OPENTV_DESKTOP) {
      more = el('button', 'desktop-more focusable');
      more.type = 'button';
      more._activate = appendBatch;
      page.appendChild(more);
      page.addEventListener('scroll', function () {
        if (cursor < items.length && page.scrollTop + page.clientHeight >= page.scrollHeight - 250) appendBatch();
      }, { passive: true });
    }
    function appendBatch() {
      var limit = Math.min(items.length, cursor + 60);
      for (; cursor < limit; cursor++) {
        var col = cursor % maxCols;
        var row = Math.floor(cursor / maxCols);
        page.appendChild(makePoster(items[cursor], 192 + col * colW, y + row * colH, posterW, posterH, { gold: true }));
      }
      if (more) {
        abs(more, 192, y + Math.ceil(cursor / maxCols) * colH + 15, 1600, 74);
        more.textContent = cursor < items.length ? 'Ver más · ' + cursor + ' de ' + items.length : 'Has visto los ' + items.length + ' títulos';
        more.disabled = cursor >= items.length;
      }
      schedulePosterMemoryPass();
    }
    appendBatch();
  }

  function buildFeaturedPage(page) {
    var all = allVodFor('destacado');
    if (window.OPENTV_DESKTOP) { buildDesktopSection(page, all, { continueFilter: '', top10: 'destacado', trendKey: 'inicio', rows: 'destacado', gridTitle: 'Títulos destacados' }); return; }
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, window.OPENTV_DESKTOP ? all : items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    if (window.OPENTV_DESKTOP) {
      /* Desktop: "Seguir viendo", then one row per portal shelf. */
      var y = appendContinueRow(page, 830, '');
      var rows = portalRowsFor('destacado', 4);
      for (var r = 0; r < rows.length; r++) { y = appendPosterRow(page, y, rows[r].title, rows[r].items); }
      if (rows.length) { return; }
      if (rest.length) { appendCatalogGrid(page, rest, y + 30, 'Títulos destacados'); }
      return;
    }
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Títulos destacados');
    }
  }

  function buildMoviesPage(page) {
    var all = allVodFor('pelicula');
    if (window.OPENTV_DESKTOP) { buildDesktopSection(page, all, { continueFilter: 'movie', trending: 'movie', trendKey: 'movie', rows: 'pelicula', grid: true, gridTitle: 'Todas las películas' }); return; }
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, window.OPENTV_DESKTOP ? all : items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    var gridY = window.OPENTV_DESKTOP ? appendContinueRow(page, 830, 'movie') + (page._continueCount ? 10 : 30) : 860;
    if (rest.length) {
      appendCatalogGrid(page, rest, gridY, 'Más películas');
    }
  }

  function buildSeriesPage(page) {
    var all = allVodFor('serie');
    if (window.OPENTV_DESKTOP) { buildDesktopSection(page, all, { continueFilter: 'series', trending: 'series', trendKey: 'series', rows: 'serie', grid: true, gridTitle: 'Todas las series' }); return; }
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, window.OPENTV_DESKTOP ? all : items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    var gridY = window.OPENTV_DESKTOP ? appendContinueRow(page, 830, 'series') + (page._continueCount ? 10 : 30) : 860;
    if (rest.length) {
      appendCatalogGrid(page, rest, gridY, 'Más series');
    }
  }

  function buildAnimePage(page) {
    var all = allVodFor('anime');
    if (window.OPENTV_DESKTOP) { buildDesktopSection(page, all, { rows: 'anime', trendKey: 'anime', grid: true, gridTitle: 'Todo el anime' }); return; }
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, window.OPENTV_DESKTOP ? all : items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Anime y animación');
    }
  }

  function novelCatalogItems() {
    var out = [];
    for (var i = 0; i < VOD.length; i++) {
      var item = VOD[i];
      var text = norm([
        item.row || '', item.category || '', item.kind || '', item.title || '', item.alias || '',
        item.genres && item.genres.join ? item.genres.join(' ') : (item.genres || '')
      ].join(' '));
      if (text.indexOf('novela') !== -1 || text.indexOf('telenovela') !== -1) {
        out.push(item);
      }
    }
    return out;
  }

  function buildNovelsPage(page) {
    /* The portal already includes its novela rows in the loaded home roots.
       Filter those exact records only: no synthetic catalog and no secondary
       query that could return a different host/list.

       Keep the six featured tiles above, but do not remove those titles from
       the catalogue below.  The portal currently delivers ten items in its
       official "Telenovelas" row; slicing at six made "Más novelas" look as
       if the category only had four titles. */
    var all = novelCatalogItems();
    if (!all.length) {
      var empty = el('div', 'catalog-empty', 'No se encontraron novelas en el catálogo actual.');
      abs(empty, 192, 170, 1500, 80);
      page.appendChild(empty);
    } else {
      var items = all.slice(0, 6);
      var real = !!(items[0] && items[0]._portal);
      bentoPage(page, window.OPENTV_DESKTOP ? all : items, { titles: real, dots: real ? 3 : 2, shade: real });
      appendCatalogGrid(page, all, 860, 'Más novelas');
    }
  }

  /* KIDS: hero 831x534 + 2x2 grid 413x222 on the right, a subtitle line and a
     horizontal poster row (7 columns, last one clipped by the screen edge). */
  function buildKidsPage(page) {
    if (window.OPENTV_DESKTOP) {
      buildDesktopSection(page, allVodFor('infantil'), { rows: 'infantil', trendKey: 'kids', grid: true, gridTitle: 'Todo para niños' });
      return;
    }
    var source = vodFor('infantil', 12, 0);
    if (!source.length) { source = VOD; }
    var real = !!(source[0] && source[0]._portal);
    page.appendChild(makeBento(source[0], 192, 38.5, 831, 534, { shade: true, title: real }));
    var cells = [
      [1029, 38.5], [1446, 38.5], [1029, 269.5], [1446, 269.5]
    ];
    for (var i = 0; i < cells.length; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], cells[i][0], cells[i][1],
                                 413, 222, {}));
    }
    page.appendChild(bentoDots(833, 468.5, 4, 0));
    if (source[0]) {
      var sub = el('div', 'kids-subtitle', source[0].tagline || source[0].title);
      abs(sub, 192, 526.5, 1249, 40);
      page.appendChild(sub);
    }
    var row = el('div', 'poster-row');
    abs(row, 192, 578.5, 1920, 310);
    for (var k = 0; k < 7; k++) {
      var it = source[k % source.length];
      if (!it) { break; }
      row.appendChild(makePoster(it, k * 266, 0, 266, 310, { gold: true }));
    }
    page.appendChild(row);
  }

  /* EXPLORAR: hero 1249x703 + three stacked 413x226 tiles on the right,
     provider row label and logo strip underneath. */
  function buildExplorePage(page) {
    var source = VOD.length ? VOD : [];
    page.appendChild(makeBento(source[0], 192, 38.5, 1249, 703, { shade: true }));
    for (var i = 0; i < 3; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], 1446, 38.5 + i * 231,
                                 413, 226, { badge: i === 2 ? 'Adult' : '' }));
    }
    page.appendChild(el('div', 'explore-row-title', 'Netflix'));
    var strip = el('div', 'explore-strip');
    abs(strip, 192, 811.5, 1920, 130);
    for (var k = 0; k < 8; k++) {
      var cell = el('div', 'explore-logo');
      abs(cell, k * 272, 0, 260, 120);
      strip.appendChild(cell);
    }
    page.appendChild(strip);
  }

  /* Desktop section: big hero, "Seguir viendo", Top 10, the portal shelves
     and the full catalogue grid. Falls back to the tile mosaic when no title
     of the section has wide artwork. */
  function buildDesktopSection(page, all, opts) {
    if (!all || !all.length) {
      var idxEmpty = pages.indexOf(page);
      if (idxEmpty >= 0) { delete heroPages[idxEmpty]; }
      /* (The page is rebuilt when the catalogue arrives.) */
      if (vodApiState.loading) {
        /* Loading: the loader in the middle of the section, replaced by
           the rows as soon as they arrive. */
        var wait = makeLoader('Cargando los títulos de tus addons…', 'is-page');
        abs(wait, 192, 0, 1560, 760);
        page.appendChild(wait);
        return;
      }
      var empty = el('div', 'catalog-empty', getVodSourcesConfig().addons.length
        ? 'Tus addons no tienen títulos de esta sección.'
        : 'Agrega un addon con catálogo en Ajustes → Addons para ver películas y series.');
      abs(empty, 192, 170, 1500, 80);
      page.appendChild(empty);
      return;
    }
    /* The top of every section shows what is popular now on TMDB for it
       (then the portal's titles if there are not enough yet). */
    var featured = all;
    if (opts.trendKey) {
      var trends = sectionTrendItems(opts.trendKey);
      if (trends.length >= 2) {
        var inTrends = {};
        for (var tr = 0; tr < trends.length; tr++) { inTrends[trends[tr].id] = true; }
        featured = trends.concat(all.filter(function (v) { return !inTrends[v.id]; }));
      }
    }
    var y;
    if (platformIsTv()) {
      /* TVs: not the desktop hero (a full-screen layer, too heavy for a
         Fire TV) but a light banner inside the page (home/rows.js). */
      var idxTv = pages.indexOf(page);
      if (idxTv >= 0) { delete heroPages[idxTv]; }
      y = appendTvHero(page, featured);
    } else {
      y = buildHero(page, featured);
    }
    if (!y) {
      var real = !!(all[0] && (all[0]._portal || all[0]._stremio));
      bentoPage(page, all, { titles: real, dots: real ? Math.min(4, all.length) : 0, shade: real });
      y = 830;
    }
    if (opts.continueFilter !== undefined) { y = appendContinueRow(page, y, opts.continueFilter); }
    /* (TVs: the cards on top already are the trends; no second row of them.) */
    if (platformIsTv()) { /* nothing */ }
    else if (opts.top10) { y = appendTrendingRows(page, y); }
    else if (opts.trending) { y = appendTrendingRows(page, y, opts.trending); }
    var shelves = opts.rows ? portalRowsFor(opts.rows, 4) : [];
    if (opts.top10) {
      var regular = [];
      for (var t = 0; t < shelves.length; t++) {
        if (/top\s*1[05]|clasificad/i.test(shelves[t].title)) {
          var isSeries = shelves[t].items.length && isSeriesItem(shelves[t].items[0]);
          y = appendTop10Row(page, y, isSeries ? 'Top 10 series hoy' : 'Top 10 películas hoy', fillTop10(shelves[t].items, !!isSeries, all));
        } else {
          regular.push(shelves[t]);
        }
      }
      shelves = regular;
    }
    for (var r = 0; r < shelves.length; r++) { y = appendPosterRow(page, y, shelves[r].title, shelves[r].items); }
    /* Sections end with the whole catalogue; Inicio only when it has no shelves. */
    if (opts.grid || !shelves.length || !opts.rows) { appendCatalogGrid(page, all, y + 20, opts.gridTitle || 'Catálogo'); }
  }

  /* Always ten when the catalogue has them: the portal's ranking first, then
     this week's TMDB trends, then other titles of the section (same kind).
     Only titles currently available in the active VOD catalogue are included. */
  function fillTop10(ranked, series, section) {
    var out = [], seen = {};
    function add(list) {
      for (var i = 0; i < list.length && out.length < 10; i++) {
        var raw = list[i];
        var v = raw && vodById(raw.id);
        if (!v || seen[v.id] || !!isSeriesItem(v) !== series || !hasUsableCover(v)) { continue; }
        seen[v.id] = true;
        out.push(v);
      }
    }
    add(ranked);
    for (var t = 0; t < trendingRows.length && out.length < 10; t++) { add(trendingRows[t].items || []); }
    add(section || []);
    add(VOD);
    return out;
  }

  /* ---- home/rows.js ---------------------------------------------------------- */
  /* home/rows.js — Filas horizontales del escritorio: "Seguir viendo" y las filas del portal en Destacados.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Rows live on the 1920x1080 page canvas like everything else (absolute
     positions), and each one scrolls sideways inside its own strip: with the
     arrow buttons, a trackpad, Shift + wheel or the keyboard focus. */
  var ROW_X = 192;
  var ROW_W = 1656;
  var ROW_PAD = 18;                 /* room for the hover zoom inside the strip */
  var ROW_TITLE_H = 54;
  var ROW_POSTER_W, ROW_POSTER_H, ROW_STEP, ROW_HEIGHT;
  var CONTINUE_W, CONTINUE_H, CONTINUE_STEP, CONTINUE_ROW_HEIGHT;

  /* Catalogue density (Mi cuenta → Apariencia): "compact" shows smaller
     posters, so more titles fit in each row and grid line. */
  var CATALOG_DENSITY_KEY = 'opentv_catalog_density_v1';
  function catalogCompact() {
    return !!window.OPENTV_DESKTOP && safeLocalRead(CATALOG_DENSITY_KEY, 'normal') === 'compact';
  }
  function applyCatalogDensity() {
    var compact = catalogCompact();
    ROW_POSTER_W = compact ? 200 : 250;
    ROW_POSTER_H = compact ? 288 : 360;
    ROW_STEP = ROW_POSTER_W + (compact ? 22 : 26);
    ROW_HEIGHT = ROW_TITLE_H + ROW_POSTER_H + ROW_PAD * 2 + 26;
    CONTINUE_W = compact ? 336 : 400;
    CONTINUE_H = compact ? 189 : 225;
    CONTINUE_STEP = CONTINUE_W + 24;
    CONTINUE_ROW_HEIGHT = ROW_TITLE_H + CONTINUE_H + 64 + ROW_PAD * 2 + 20;
    /* TVs: a fixed size, a bit bigger than on a PC so posters read well from
       the sofa (five and a half on screen, four "Seguir viendo" cards) and a
       margin on the right; fewer images to load and draw. */
    if (platformIsTv()) {
      ROW_W = 1560;   /* 240..1800 on screen: 120 px of margin on the right */
      ROW_POSTER_W = 262;
      ROW_POSTER_H = 378;
      ROW_STEP = 288;
      ROW_HEIGHT = ROW_TITLE_H + ROW_POSTER_H + ROW_PAD * 2 + 26;
      CONTINUE_W = 372;
      CONTINUE_H = 209;
      CONTINUE_STEP = 396;
      CONTINUE_ROW_HEIGHT = ROW_TITLE_H + CONTINUE_H + 64 + ROW_PAD * 2 + 20;
    }
    if (document.body) { document.body.classList.toggle('is-catalog-compact', compact); }
  }
  applyCatalogDensity();

  function setCatalogDensity(compact) {
    safeLocalWrite(CATALOG_DENSITY_KEY, compact ? 'compact' : 'normal');
    applyCatalogDensity();
    /* Every catalogue page is rebuilt with the new size next time it shows. */
    catalogStaleAt = Date.now() + 1;
  }

  function makeRowShell(page, y, height, titleText, extraClass) {
    var host = el('div', 'd-row' + (extraClass ? ' ' + extraClass : ''));
    abs(host, ROW_X, y, ROW_W, height);
    var head = el('div', 'd-row-head');
    head.appendChild(el('div', 'd-row-title', titleText));
    host.appendChild(head);
    var strip = el('div', 'd-row-strip scrollable');
    abs(strip, -ROW_PAD, ROW_TITLE_H - ROW_PAD, ROW_W + ROW_PAD * 2, height - ROW_TITLE_H + ROW_PAD);
    host.appendChild(strip);

    var prev = el('button', 'd-row-arrow is-prev');
    prev.type = 'button';
    prev.innerHTML = UI_ICONS.prev;
    prev.setAttribute('aria-label', 'Anterior');
    var next = el('button', 'd-row-arrow is-next');
    next.type = 'button';
    next.innerHTML = UI_ICONS.next;
    next.setAttribute('aria-label', 'Siguiente');
    function step(dir) {
      var by = Math.max(ROW_STEP, Math.floor(strip.clientWidth * 0.8 / ROW_STEP) * ROW_STEP);
      try { strip.scrollBy({ left: dir * by, behavior: 'smooth' }); }
      catch (eScroll) { strip.scrollLeft += dir * by; }
    }
    prev.addEventListener('click', function (event) { event.stopPropagation(); step(-1); });
    next.addEventListener('click', function (event) { event.stopPropagation(); step(1); });
    host.appendChild(prev);
    host.appendChild(next);
    /* TVs have no pointer arrows: while a row glides only the posters coming
       into view are loaded (measuring the row and toggling classes on every
       frame of the smooth scroll was the main cost on the Fire TV). */
    var tvRows = platformIsTv();
    function syncArrows() {
      if (tvRows) { schedulePosterMemoryPass(); return; }
      var max = strip.scrollWidth - strip.clientWidth;
      host.classList.toggle('at-start', strip.scrollLeft <= 4);
      host.classList.toggle('at-end', strip.scrollLeft >= max - 4);
      schedulePosterMemoryPass();
    }
    strip.addEventListener('scroll', syncArrows, { passive: true });
    /* Measured while the page was hidden the row looked empty, so the arrows
       stayed off until a first scroll: measure again when the pointer comes. */
    host.addEventListener('mouseenter', syncArrows);
    /* A vertical wheel keeps scrolling the page; a sideways swipe or
       Shift + wheel moves the row. */
    strip.addEventListener('wheel', function (event) {
      var dx = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!dx) { return; }
      event.preventDefault();
      event.stopPropagation();
      strip.scrollLeft += dx;
    }, { passive: false });
    host._strip = strip;
    host._sync = syncArrows;
    page.appendChild(host);
    setTimeout(syncArrows, 0);
    return host;
  }

  /* "Netflix Movie" -> "Películas de Netflix"; other portal names stay. */
  function rowDisplayName(name) {
    /* Stremio rows already read well ("Popular · Series"). */
    if (/ · /.test(name)) { return name; }
    var m = /^(.+?)\s+Movies?$/i.exec(name);
    if (m) { return 'Películas de ' + m[1]; }
    m = /^(.+?)\s+Series$/i.exec(name);
    if (m && !/^tv$/i.test(m[1])) { return 'Series de ' + m[1]; }
    return name;
  }

  /* Titles of one home section grouped by the portal row they came in, in
     the portal's own order. Rows with too few titles are folded away. */
  function portalRowsFor(category, minItems) {
    var order = [], groups = {};
    var list = withCovers(VOD);
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var cats = norm(item.category || '').split(',');
      if (cats.indexOf(category) === -1) { continue; }
      var shelves = item._rows && item._rows.length ? item._rows : (item.row ? [item.row] : []);
      for (var s = 0; s < shelves.length; s++) {
        if (!groups[shelves[s]]) { groups[shelves[s]] = []; order.push(shelves[s]); }
        groups[shelves[s]].push(item);
      }
    }
    /* Addon rows keep the addon's order (stremioRowOrder); others stay where
       they first appeared. */
    var known = typeof stremioRowOrder === 'object' ? stremioRowOrder : {};
    var firstAt = {};
    for (var f = 0; f < order.length; f++) { firstAt[order[f]] = f; }
    order.sort(function (a, b) {
      var ka = a in known ? known[a] : 100000 + firstAt[a];
      var kb = b in known ? known[b] : 100000 + firstAt[b];
      return ka - kb;
    });
    var out = [];
    for (var r = 0; r < order.length; r++) {
      if (groups[order[r]].length >= (minItems || 4)) {
        out.push({ title: rowDisplayName(order[r]), items: groups[order[r]] });
      }
    }
    return out;
  }

  function appendPosterRow(page, y, titleText, items) {
    return appendPosterRowSized(page, y, titleText, items, ROW_POSTER_W, ROW_POSTER_H, 'is-posters');
  }

  function appendPosterRowSized(page, y, titleText, items, w, h, extraClass) {
    var step = w + (w < 200 ? 20 : 26);
    var height = ROW_TITLE_H + h + ROW_PAD * 2 + 26;
    var host = makeRowShell(page, y, height, titleText, extraClass);
    for (var i = 0; i < items.length; i++) {
      host._strip.appendChild(makePoster(items[i], ROW_PAD + i * step, ROW_PAD, w, h, { gold: true }));
    }
    var tail = el('div', 'd-row-tail');
    abs(tail, ROW_PAD + items.length * step, 0, ROW_PAD, 1);
    host._strip.appendChild(tail);
    return y + height;
  }

  /* ------------------------------------------------------- TV: light hero */
  /* TVs: the desktop hero's look (big picture fading into the page, title,
     details, synopsis, Reproducir / Más información / Mi lista) built so a
     Fire TV can carry it. What made the desktop hero (home/hero.js) heavy is
     left out:
     - the picture is an element inside the page, not a full-screen layer
       behind the rows (that layer gave every row its own layer too)
     - one picture at the size it is shown (the app's image sizer), no slow
       zoom, no cross-fade: the next picture is decoded first and swapped in
       one go; no blurred buttons
     - it turns by itself only while the remote has been still for a while,
       the section is on screen and scrolled to the top, and never while the
       focus is on its buttons (the viewer may be reading it).
     The buttons sit in a .hero-info block, which TV navigation already moves
     through like a row (core/focus.js): left from Reproducir goes to the menu,
     down to the first row. */
  var TVH_ART_H = 660;             /* page height of the picture */
  var TVH_ART_W = 1500;            /* its width, from the right edge */
  var TVH_ROWS_Y = 650;            /* where the rows start (over the fade) */
  var TVH_MAX = 8;
  var TVH_ROTATE_MS = 9000;
  var TVH_IDLE_MS = 6000;          /* remote untouched this long before turning */
  var tvHeroes = [];
  var tvHeroTimer = null;
  var tvHeroKeyAt = 0;
  var tvHeroKeysWatched = false;

  function tvHeroArt(item) { return item._trendArt || heroArt(item) || ''; }
  /* A title's wide picture, or its poster when it has none (details screen). */
  function tvCardArt(item) { return tvHeroArt(item) || item.poster || ''; }

  function tvHeroImageUrl(item) { return sizedImageUrl(tvHeroArt(item), TVH_ART_W); }

  /* Writes the texts, the Mi lista state and the dashes for the title shown. */
  function renderTvHeroText(hero) {
    var item = hero._items[hero._index];
    hero._item = item;
    hero._kicker.textContent = isSeriesItem(item) ? 'Serie' : 'Película';
    var len = String(item.title || '').length;
    hero._title.className = 'hero-title' + (len > 52 ? ' is-xlong' : len > 30 ? ' is-long' : '');
    hero._title.textContent = item.title || '';
    hero._meta.textContent = itemMetaLine(item) || '';
    var syn = String(item.synopsis || '');
    hero._syn.textContent = syn && !/^sin sinopsis/i.test(syn) ? syn : itemGenres(item, 3).join('  •  ');
    var on = inMyList(item);
    hero._fav.classList.toggle('is-on', on);
    hero._fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
    var dots = hero._dots.children;
    for (var d = 0; d < dots.length; d++) { dots[d].className = 'hero-dot' + (d === hero._index ? ' is-active' : ''); }
  }

  /* Shows title number `index`: the picture is loaded and decoded before
     the swap (a Fire TV showed an empty frame otherwise), then text and
     picture change together. The next one is fetched in the background so
     the following turn is ready. */
  function showTvHero(hero, index) {
    var n = hero._items.length;
    index = (index % n + n) % n;
    var item = hero._items[index];
    var url = tvHeroImageUrl(item);
    var seq = ++hero._seq;
    var pre = new Image();
    var apply = function () {
      if (seq !== hero._seq || !hero._info.isConnected) { return; }
      hero._index = index;
      hero._img.src = url;
      renderTvHeroText(hero);
      var after = hero._items[(index + 1) % n];
      if (after !== item) { (new Image()).src = tvHeroImageUrl(after); }
    };
    pre.onload = function () { if (pre.decode) { pre.decode().then(apply, apply); } else { apply(); } };
    pre.onerror = apply;
    pre.src = url;
  }

  function makeTvHeroButton(cls, html, label) {
    var b = el('div', 'hero-btn focusable' + (cls ? ' ' + cls : ''));
    b.innerHTML = html + (label ? '<span>' + label + '</span>' : '');
    return b;
  }

  /* Lays the hero at the top of the page. Returns the y where the rows
     start, or 0 when the section has no titles with wide art. */
  function appendTvHero(page, all) {
    var items = [];
    for (var i = 0; i < all.length && items.length < TVH_MAX; i++) {
      if (tvHeroArt(all[i]) && hasUsableCover(all[i])) { items.push(all[i]); }
    }
    if (!items.length) { return 0; }
    var hero = { _items: items, _index: 0, _seq: 0, _page: page };

    /* The picture, on the right, fading into the page on the left and at
       the bottom (one shade element). Not focusable: navigation skips it. */
    var art = el('div', 'tvh-art');
    art.style.top = '0px';
    var img = el('img', 'tvh-img');
    img.alt = '';
    img.decoding = 'async';
    art.appendChild(img);
    art.appendChild(el('div', 'tvh-shade'));
    page.appendChild(art);
    hero._img = img;

    /* Text and buttons, as on desktop. */
    var info = el('div', 'hero-info tvh-info');
    abs(info, ROW_X, 40, 1060, 560);
    hero._kicker = el('div', 'hero-kicker');
    hero._title = el('div', 'hero-title');
    hero._meta = el('div', 'hero-meta');
    hero._syn = el('div', 'hero-synopsis');
    info.appendChild(hero._kicker);
    info.appendChild(hero._title);
    info.appendChild(hero._meta);
    info.appendChild(hero._syn);
    var row = el('div', 'hero-buttons');
    var play = makeTvHeroButton('is-primary', UI_ICONS.play, 'Reproducir');
    play._activate = function () { playTitleNow(hero._item); };
    var more = makeTvHeroButton('', UI_ICONS.info, 'Más información');
    more._activate = function () { openDetail(hero._item); };
    var fav = makeTvHeroButton('is-round', UI_ICONS.mylist, '');
    fav._activate = function () {
      var on = toggleMyList(hero._item);
      fav.classList.toggle('is-on', on);
      fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
    };
    hero._fav = fav;
    row.appendChild(play);
    row.appendChild(more);
    row.appendChild(fav);
    info.appendChild(row);
    page.appendChild(info);
    hero._info = info;

    /* Dashes: which title is showing. */
    hero._dots = el('div', 'hero-dots tvh-dots');
    abs(hero._dots, ROW_X + ROW_W - 360, 600, 360, 20);
    for (var d = 0; d < items.length && items.length > 1; d++) { hero._dots.appendChild(el('i', 'hero-dot')); }
    page.appendChild(hero._dots);

    /* First title: picture and text at once, no waiting for a decode. */
    img.src = tvHeroImageUrl(items[0]);
    renderTvHeroText(hero);
    /* Spanish texts (home/catalog-lang.js) as they arrive. */
    items.forEach(function (it) {
      localizeItem(it, function (changed) {
        if (changed && hero._item === it && hero._info.isConnected) { renderTvHeroText(hero); }
      });
    });
    if (items.length > 1) { (new Image()).src = tvHeroImageUrl(items[1]); }

    tvHeroes.push(hero);
    if (!tvHeroKeysWatched) {
      tvHeroKeysWatched = true;
      document.addEventListener('keydown', function () { tvHeroKeyAt = Date.now(); }, true);
    }
    if (!tvHeroTimer) { tvHeroTimer = setInterval(rotateTvHeroes, TVH_ROTATE_MS); }
    return TVH_ROWS_Y;
  }

  function rotateTvHeroes() {
    tvHeroes = tvHeroes.filter(function (h) { return h._info.isConnected; });
    if (state.screen !== 'home' || document.hidden) { return; }
    if (Date.now() - tvHeroKeyAt < TVH_IDLE_MS) { return; }
    tvHeroes.forEach(function (hero) {
      if (hero._items.length < 2) { return; }
      if (state.focus && hero._info.contains(state.focus)) { return; }
      if (!hero._page.classList.contains('is-current') || hero._page.scrollTop > 200) { return; }
      showTvHero(hero, hero._index + 1);
    });
  }

  /* ------------------------------------------------------------ Seguir viendo */
  /* Titles started and not finished, newest first. `filter` is 'movie',
     'series' or empty for both. Finished movies (95 %+) drop out; a series
     stays so the next episode is one click away. Only titles present in the
     currently active VOD catalogue are shown. */
  function continueRecords(filter) {
    var out = [];
    var list = localProfile.history || [];
    for (var i = 0; i < list.length && out.length < 20; i++) {
      var r = list[i];
      if (!r || !r.id || r.hideContinue || (r.position || 0) < 5) { continue; }
      if (!vodForHistoryRecord(r)) { continue; }
      if (filter === 'movie' && r.series) { continue; }
      if (filter === 'series' && !r.series) { continue; }
      if (!r.series && r.duration && r.position / r.duration > 0.95) { continue; }
      out.push(r);
    }
    return out;
  }

  function vodById(id) {
    for (var i = 0; i < VOD.length; i++) {
      if (String(VOD[i].id) === String(id)) { return VOD[i]; }
    }
    return null;
  }

  function vodForHistoryRecord(r) {
    if (!r || !r.id) { return null; }
    var direct = vodById(r.id);
    if (direct) { return direct; }
    for (var v = 0; v < VOD.length; v++) {
      var seasons = VOD[v]._catalogSeasons || [];
      for (var s = 0; s < seasons.length; s++) {
        if (String(seasons[s].id) === String(r.id) || (r.seasonId && String(seasons[s].id) === String(r.seasonId))) {
          return VOD[v];
        }
      }
    }
    /* Titles found by search are not in the home catalog (VOD): keep them in
       "Seguir viendo", each with the catalog of the current mode only. */
    var fromAddon = !!r.stremio || String(r.id).indexOf('stremio:') === 0;
    /* (typeof: the unit tests load this module without services/vod-api.js.) */
    if (typeof stremioModeOn === 'function' && stremioModeOn()) { return fromAddon ? stremioItemFromHistory(r) : null; }
    return fromAddon ? null : r;
  }

  function continueSubtitle(r) {
    var parts = [];
    if (r.series && r.episodeNumber) { parts.push('Episodio ' + r.episodeNumber); }
    if (r.duration) {
      var left = Math.max(0, r.duration - r.position);
      if (left / r.duration < 0.05) { parts.push('Terminado'); }
      else { parts.push(left >= 3600 ? 'Quedan ' + Math.floor(left / 3600) + ' h ' + Math.round((left % 3600) / 60) + ' min'
                                     : 'Quedan ' + Math.max(1, Math.round(left / 60)) + ' min'); }
    }
    return parts.join(' · ');
  }

  function makeContinueCard(r, x, y) {
    var item = vodForHistoryRecord(r);
    var card = el('div', 'continue-card focusable');
    abs(card, x, y, CONTINUE_W, CONTINUE_H + 64);
    card.style.setProperty('--cc-w', CONTINUE_W + 'px');
    card.style.setProperty('--cc-h', CONTINUE_H + 'px');
    var frame = el('div', 'cc-frame');
    var art = (item && (item.landscape || item.backdrop || item.poster)) || r.poster;
    if (art) {
      var img = el('img', 'cc-img');
      img.decoding = 'async';
      img.setAttribute('data-poster-src', art);
      img.onload = posterImageLoaded;
      img.onerror = function () { img.style.display = 'none'; frame.classList.add('is-generic'); };
      frame.appendChild(img);
    } else {
      frame.classList.add('is-generic');
    }
    frame.appendChild(el('div', 'cc-shade'));
    var play = el('div', 'cc-play');
    play.innerHTML = UI_ICONS.play;
    frame.appendChild(play);
    var bar = el('div', 'cc-progress');
    var fill = el('i');
    var pct = r.duration ? Math.min(100, Math.max(2, Math.round(r.position / r.duration * 100))) : 0;
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    if (pct) { frame.appendChild(bar); }
    card.appendChild(frame);
    card.appendChild(el('div', 'cc-title', r.title || (item && item.title) || 'Contenido'));
    card.appendChild(el('div', 'cc-sub', continueSubtitle(r)));

    var remove = el('button', 'cc-remove');
    remove.type = 'button';
    remove.innerHTML = UI_ICONS.close;
    remove.setAttribute('data-tip', 'Quitar de Seguir viendo');
    remove.addEventListener('click', function (event) {
      event.stopPropagation();
      /* Forgotten entirely (position, chosen source, subtitles), not hidden. */
      forgetWatchedTitle(r.id);
    });
    frame.appendChild(remove);

    card._activate = function () { openHistoryRecord(r); };
    return card;
  }

  var continueRowHosts = [];

  /* Adds the row when there is something to continue and returns the y where
     the next block starts. The slot is remembered so the row can be refreshed
     in place after watching something. */
  function appendContinueRow(page, y, filter) {
    var records = continueRecords(filter);
    page._continueFilter = filter;
    page._continueCount = records.length;
    if (!records.length) { return y; }
    var host = makeRowShell(page, y, CONTINUE_ROW_HEIGHT, 'Seguir viendo', 'is-continue');
    host._filter = filter;
    fillContinueRow(host, records);
    continueRowHosts.push(host);
    return y + CONTINUE_ROW_HEIGHT;
  }

  function fillContinueRow(host, records) {
    var strip = host._strip;
    clear(strip);
    for (var i = 0; i < records.length; i++) {
      strip.appendChild(makeContinueCard(records[i], ROW_PAD + i * CONTINUE_STEP, ROW_PAD));
    }
    var tail = el('div', 'd-row-tail');
    abs(tail, ROW_PAD + records.length * CONTINUE_STEP, 0, ROW_PAD, 1);
    strip.appendChild(tail);
    if (host._sync) { setTimeout(host._sync, 0); }
    schedulePosterMemoryPass();
  }

  /* After the player (or a removal): update rows in place. When a row has to
     appear or disappear, the page layout changes, so that page is rebuilt the
     next time it is shown. */
  function refreshContinueRows() {
    if (!window.OPENTV_DESKTOP || !pages) { return; }
    var alive = [];
    for (var h = 0; h < continueRowHosts.length; h++) {
      if (continueRowHosts[h].parentNode) { alive.push(continueRowHosts[h]); }
    }
    continueRowHosts = alive;
    var stale = false;
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      if (!page || page._continueFilter === undefined || !pagesBuilt[p]) { continue; }
      var records = continueRecords(page._continueFilter);
      if ((records.length > 0) !== (page._continueCount > 0)) { stale = true; continue; }
      page._continueCount = records.length;
      for (var k = 0; k < continueRowHosts.length; k++) {
        if (continueRowHosts[k].parentNode === page && records.length) { fillContinueRow(continueRowHosts[k], records); }
      }
    }
    if (stale) {
      catalogStaleAt = Date.now();
      var current = TABS[state.tab] ? TABS[state.tab].page : 0;
      if (current > 0 && pages[current]) {
        var keep = pages[current].scrollTop;
        ensurePageBuilt(current);
        pages[current].scrollTop = keep;
      }
    }
  }

  /* ------------------------------------------------------------------ Top 10 */
  /* Big outlined rank number behind each poster, like the streaming apps. The
     ranking comes from the portal's own "TOP 15" shelves. */
  var TOP10_STEP = 410;
  function appendTop10Row(page, y, titleText, items) {
    if (!items || !items.length) { return y; }
    var height = ROW_TITLE_H + 360 + ROW_PAD * 2 + 26;
    var host = makeRowShell(page, y, height, titleText, 'is-top10');
    for (var i = 0; i < items.length; i++) {
      var cell = el('div', 'top10-cell');
      abs(cell, ROW_PAD + i * TOP10_STEP, ROW_PAD, TOP10_STEP - 20, 360);
      var num = el('div', 'top10-num', String(i + 1));
      cell.appendChild(num);
      cell.appendChild(makePoster(items[i], 140, 0, 250, 360, { gold: true }));
      host._strip.appendChild(cell);
    }
    var tail = el('div', 'd-row-tail');
    abs(tail, ROW_PAD + items.length * TOP10_STEP, 0, ROW_PAD, 1);
    host._strip.appendChild(tail);
    return y + height;
  }

  /* ---- home/hero.js ---------------------------------------------------------- */
  /* home/hero.js — Escritorio: portada grande de cada sección (imagen a todo el ancho, título y botones).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The artwork is one layer behind the whole home screen (under the
     transparent top bar, edge to edge) and moves up with the page's scroll.
     The text and buttons live inside the page, so keyboard focus and scroll
     work as for any other tile. It rotates through a few titles. */
  var HERO_INTERVAL_MS = 9000;
  var HERO_MAX = 6;
  var HERO_TEXT_H = 640;           /* page height used by the hero block */
  var heroLayer = null;
  var heroPages = {};              /* page index -> { items, index, info } */
  var heroTimer = null;
  var heroShownPage = -1;
  var heroHoverAt = 0;

  var GENRE_ES = {
    'action': 'Acción', 'adventure': 'Aventura', 'animation': 'Animación', 'cartoon': 'Animación', 'comedy': 'Comedia',
    'crime': 'Crimen', 'documentary': 'Documental', 'drama': 'Drama', 'family': 'Familia', 'fantasy': 'Fantasía',
    'history': 'Historia', 'horror': 'Terror', 'music': 'Música', 'musical': 'Musical', 'mystery': 'Misterio',
    'romance': 'Romance', 'sci-fi': 'Ciencia ficción', 'science fiction': 'Ciencia ficción', 'sport': 'Deporte',
    'thriller': 'Suspenso', 'war': 'Bélica', 'western': 'Western', 'biography': 'Biografía', 'reality-tv': 'Reality',
    'anime': 'Anime', 'short': 'Corto', 'tv movie': 'Película de TV', 'game show': 'Concurso', 'news': 'Noticias',
    'kids': 'Infantil', 'reality': 'Reality', 'talk-show': 'Entrevistas', 'soap': 'Telenovela', 'suspense': 'Suspenso',
    'sci-fi & fantasy': 'Ciencia ficción', 'action & adventure': 'Acción', 'war & politics': 'Bélica', 'film-noir': 'Cine negro'
  };
  function genreName(g) {
    var k = String(g || '').trim().toLowerCase();
    return GENRE_ES[k] || String(g || '').trim();
  }

  /* The catalog writes countries in English or without accents. */
  var COUNTRY_ES = {
    'mexico': 'México', 'usa': 'Estados Unidos', 'us': 'Estados Unidos', 'united states': 'Estados Unidos',
    'united states of america': 'Estados Unidos', 'uk': 'Reino Unido', 'united kingdom': 'Reino Unido',
    'spain': 'España', 'espana': 'España', 'japan': 'Japón', 'japon': 'Japón', 'china': 'China',
    'south korea': 'Corea del Sur', 'korea': 'Corea del Sur', 'france': 'Francia', 'germany': 'Alemania',
    'italy': 'Italia', 'canada': 'Canadá', 'brazil': 'Brasil', 'argentina': 'Argentina', 'colombia': 'Colombia',
    'peru': 'Perú', 'chile': 'Chile', 'india': 'India', 'australia': 'Australia', 'turkey': 'Turquía',
    'russia': 'Rusia', 'thailand': 'Tailandia', 'taiwan': 'Taiwán', 'hong kong': 'Hong Kong'
  };
  function countryName(c) {
    var parts = String(c || '').split(/\s*[,/]\s*/), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var es = COUNTRY_ES[norm(parts[i]).trim()] || parts[i];
      if (out.indexOf(es) === -1) { out.push(es); }
    }
    return out.join(', ');
  }

  function heroArt(item) { return item ? (item.backdrop || item.landscape || item._trendArt || '') : ''; }

  function itemMetaLine(item) {
    var bits = [];
    var score = parseFloat(item.score);
    if (score > 0) { bits.push('★ ' + score.toFixed(1)); }
    var year = String(item.year || item.releaseDate || '').match(/\d{4}/);
    if (year) { bits.push(year[0]); }
    bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
    var secs = durationToSeconds(item.duration);
    if (!isSeriesItem(item) && secs > 600) {
      var h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
      bits.push(h ? h + ' h ' + (m ? m + ' min' : '') : m + ' min');
    }
    return bits.join('   ·   ');
  }

  function itemGenres(item, max) {
    var out = [];
    var list = item.genres || [];
    for (var i = 0; i < list.length && out.length < (max || 3); i++) {
      var g = genreName(list[i]);
      if (g && !/^sin clasificar$/i.test(g) && !/^\d+$/.test(g) && out.indexOf(g) === -1) { out.push(g); }
    }
    return out;
  }

  /* Play right away: open the title (it loads its episodes / streams) and go
     full screen as soon as it is ready. */
  function playTitleNow(item) {
    if (!item) { return; }
    openDetail(item);
    loadVodDetail(item, function (loaded) {
      if (loaded && state.screen === 'detail' && state.detail === item) {
        expandToFullscreen(item, state.detailEpisode);
      }
    });
  }

  function ensureHeroLayer() {
    if (heroLayer && heroLayer.isConnected) { return heroLayer; }
    var home = $('screen-home');
    heroLayer = el('div', 'home-hero');
    heroLayer.appendChild(el('img', 'hh-img is-a'));
    heroLayer.appendChild(el('img', 'hh-img is-b'));
    heroLayer.appendChild(el('div', 'hh-shade'));
    var imgs = heroLayer.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) { imgs[i].alt = ''; imgs[i].decoding = 'async'; }
    home.insertBefore(heroLayer, $('home-pages'));
    return heroLayer;
  }

  function setHeroArt(art) {
    var layer = ensureHeroLayer();
    var a = layer.querySelector('.is-a'), b = layer.querySelector('.is-b');
    var shown = a.classList.contains('is-shown') ? a : (b.classList.contains('is-shown') ? b : null);
    if (shown && shown.getAttribute('src') === art) { return; }
    var next = shown === a ? b : a;
    /* A big picture that takes a while (or never comes): the previous one
       fades out instead of staying under another title (Anime showed Inicio's
       picture under its own first title). */
    if (heroArtTimer) { clearTimeout(heroArtTimer); heroArtTimer = null; }
    function dropShown() {
      if (shown && shown !== next) { shown.classList.remove('is-shown'); }
    }
    next.onload = function () {
      if (heroArtTimer) { clearTimeout(heroArtTimer); heroArtTimer = null; }
      next.classList.add('is-shown');
      dropShown();
    };
    next.onerror = function () {
      if (heroArtTimer) { clearTimeout(heroArtTimer); heroArtTimer = null; }
      next.classList.remove('is-shown');
      dropShown();
    };
    next.src = art;
    if (!next.complete) { heroArtTimer = setTimeout(function () { heroArtTimer = null; dropShown(); }, 250); }
  }
  var heroArtTimer = null;

  /* Builds the hero block at the top of `page`. Returns the y where the rest
     of the page starts, or 0 when the section has no artwork to show. */
  function buildHero(page, source) {
    var idx = pages.indexOf(page);
    if (idx >= 0) { delete heroPages[idx]; }
    var items = [];
    for (var i = 0; i < source.length && items.length < HERO_MAX; i++) {
      if (heroArt(source[i]) && hasUsableCover(source[i])) { items.push(source[i]); }
    }
    if (!items.length) {
      if (page.classList.contains('is-current') && idx >= 0) { showHeroForPage(idx); }
      return 0;
    }
    var info = el('div', 'hero-info');
    abs(info, 192, 70, 1180, 530);
    info.addEventListener('pointermove', function () { heroHoverAt = Date.now(); });
    page.appendChild(info);
    var dots = el('div', 'hero-dots');
    abs(dots, 1500, 560, 340, 20);
    page.appendChild(dots);
    heroPages[idx] = { items: items, index: 0, info: info, dots: dots, page: page };
    renderHeroInfo(heroPages[idx]);
    /* Spanish texts (home/catalog-lang.js) as they arrive. */
    items.forEach(function (it) {
      localizeItem(it, function (changed) {
        var h = heroPages[idx];
        if (changed && h && h.items[h.index] === it && h.info.isConnected) { renderHeroInfo(h); }
      });
    });
    if (!page._heroScroll) {
      page._heroScroll = true;
      page.addEventListener('scroll', function () {
        if (!page.classList.contains('is-current')) { return; }
        syncHeroScroll(page);
      }, { passive: true });
    }
    if (!heroTimer) { heroTimer = setInterval(rotateHero, HERO_INTERVAL_MS); }
    if (page.classList.contains('is-current')) { showHeroForPage(idx); }
    return HERO_TEXT_H;
  }

  function renderHeroInfo(h) {
    var item = h.items[h.index];
    var info = h.info;
    info.classList.add('is-swapping');
    setTimeout(function () {
      clear(info);
      info.appendChild(el('div', 'hero-kicker', isSeriesItem(item) ? 'Serie' : 'Película'));
      /* Long titles get a smaller size instead of being cut. */
      var len = String(item.title || '').length;
      info.appendChild(el('div', 'hero-title' + (len > 80 ? ' is-xxlong' : len > 52 ? ' is-xlong' : len > 30 ? ' is-long' : ''), item.title));
      info.appendChild(el('div', 'hero-meta', itemMetaLine(item)));
      var genres = itemGenres(item, 3);
      if (genres.length) { info.appendChild(el('div', 'hero-genres', genres.join('  •  '))); }
      var syn = String(item.synopsis || '');
      if (syn && !/^sin sinopsis/i.test(syn)) { info.appendChild(el('div', 'hero-synopsis', syn)); }
      var row = el('div', 'hero-buttons');
      var play = el('div', 'hero-btn is-primary focusable');
      play.innerHTML = UI_ICONS.play + '<span>Reproducir</span>';
      play._activate = function () { playTitleNow(item); };
      var more = el('div', 'hero-btn focusable');
      more.innerHTML = UI_ICONS.info + '<span>Más información</span>';
      more._activate = function () { openDetail(item); };
      var fav = el('div', 'hero-btn is-round focusable' + (inMyList(item) ? ' is-on' : ''));
      fav.innerHTML = inMyList(item) ? UI_ICONS.check : UI_ICONS.mylist;
      fav.setAttribute('data-tip', inMyList(item) ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
      fav._activate = function () {
        var on = toggleMyList(item);
        fav.classList.toggle('is-on', on);
        fav.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
        fav.setAttribute('data-tip', on ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
      };
      row.appendChild(play);
      row.appendChild(more);
      row.appendChild(fav);
      info.appendChild(row);
      info.classList.remove('is-swapping');
    }, info.childNodes.length ? 220 : 0);
    clear(h.dots);
    for (var d = 0; d < h.items.length; d++) {
      (function (k) {
        var dot = el('i', 'hero-dot' + (k === h.index ? ' is-active' : ''));
        dot.addEventListener('click', function () { h.index = k; renderHeroInfo(h); showHeroForPage(pages.indexOf(h.page)); });
        h.dots.appendChild(dot);
      })(d);
    }
    if (heroShownPage === pages.indexOf(h.page)) { setHeroArt(heroArt(item)); }
  }

  function rotateHero() {
    var h = heroPages[heroShownPage];
    if (!h || state.screen !== 'home' || document.hidden || h.items.length < 2) { return; }
    if (Date.now() - heroHoverAt < 5000) { return; }
    if (state.focus && closest(state.focus, '.hero-info') && focusRingVisible) { return; }
    if (h.page.scrollTop > 500) { return; }
    h.index = (h.index + 1) % h.items.length;
    renderHeroInfo(h);
  }

  /* Called when the home page changes (or the home screen shows again). */
  function showHeroForPage(idx) {
    if (!window.OPENTV_DESKTOP) { return; }
    var h = heroPages[idx];
    var layer = ensureHeroLayer();
    heroShownPage = h && h.info.isConnected ? idx : -1;
    layer.classList.toggle('is-visible', heroShownPage >= 0);
    if (heroShownPage >= 0) {
      setHeroArt(heroArt(h.items[h.index]));
      syncHeroScroll(h.page);
    } else {
      document.body.classList.toggle('is-home-scrolled', !!(pages[idx] && pages[idx].scrollTop > 140));
    }
  }

  function syncHeroScroll(page) {
    var y = page.scrollTop;
    if (heroLayer && heroShownPage === pages.indexOf(page)) {
      heroLayer.style.transform = 'translateY(' + (-y) + 'px)';
    }
    document.body.classList.toggle('is-home-scrolled', y > 140);
  }

  /* ---- home/trending.js ------------------------------------------------------ */
  /* home/trending.js — Escritorio: "Tendencias de la semana" de TMDB, solo con títulos de nuestro catálogo.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* TMDB says what is popular this week; each title is looked up in the
     catalogue (first the loaded one, then the portal search) and only the
     ones that can actually be played make it into the row, in TMDB's order.
     The result is kept for a few hours so the home screen shows it at once. */
  var TRENDING_KEY = 'opentv_trending_v3';
  var TRENDING_TTL_MS = 6 * 60 * 60 * 1000;
  var TRENDING_MAX = 14;
  var TRENDING_SEARCHES = 20;   /* portal searches per list for the titles not loaded yet */
  /* `row: true` lists are also rows of their own on the PC (Inicio, Películas,
     Series); the others only feed the top of Kids and Anime. */
  var TRENDING_LISTS = [
    { list: 'movie-week', title: 'Tendencias de la semana · Películas', series: false, row: true },
    { list: 'tv-week', title: 'Tendencias de la semana · Series', series: true, row: true },
    { list: 'kids-movie', title: 'Kids · Películas', series: false, searches: 6 },
    { list: 'kids-tv', title: 'Kids · Series', series: true, searches: 6 },
    { list: 'anime-tv', title: 'Anime', series: true, searches: 6 }
  ];
  /* Which lists feed the top of each section (mixed in turns). */
  var TREND_SECTIONS = {
    inicio: ['movie-week', 'tv-week'],
    movie: ['movie-week'],
    series: ['tv-week'],
    kids: ['kids-movie', 'kids-tv'],
    anime: ['anime-tv']
  };
  var trendingRows = [];
  var trendingLoading = false;

  /* Each catalog mode (PC) keeps its own trends: in the Stremio mode they are
     looked up among the addons' titles, never the integrated catalog's. */
  function trendingCacheKey() {
    return TRENDING_KEY + (typeof stremioModeOn === 'function' && stremioModeOn() ? ':stremio' : '');
  }

  /* A trend shown only with the catalog of the mode it belongs to. */
  function trendFitsMode(item) {
    return !item || typeof libraryModeMatches !== 'function' || libraryModeMatches(item.id, item._stremio);
  }

  /* The catalog mode changed: the other mode's saved trends now, fresh ones
     once its catalog is loaded. */
  function resetTrendingForMode() {
    var saved = trendingRowsFromCache();
    trendingRows = saved ? saved.rows : [];
    refreshTrendingPage();
    setTimeout(loadTrending, 1500);
  }

  /* Electron asks its main process; TVs and Android ask the service (method
     "tmdb"), which keeps the key. Both answer { items } or { error }. */
  function tmdbApi() {
    if (!window.OPENTV_DESKTOP) { return null; }
    if (window.desktop && window.desktop.tmdb) { return window.desktop.tmdb; }
    return function (list) {
      return new Promise(function (resolve) {
        portalServiceCall('tmdb', { list: list }, function (error, payload) {
          resolve(error || !payload ? { error: error || 'Sin respuesta' } : payload);
        }, 15000);
      });
    };
  }

  /* The top of a section (the PC hero, the TV cards): what is popular now on
     TMDB for it ('inicio' mixes movies and series), only titles our catalogue
     can play, the lists taking turns. */
  function sectionTrendItems(key) {
    /* An anime catalog (Kitsu) brings its own trends, first in its rows. */
    if (key === 'anime' && animeCatalogInstalled) { return []; }
    var want = TREND_SECTIONS[key] || [];
    var lists = [];
    for (var t = 0; t < trendingRows.length; t++) {
      var tr = trendingRows[t];
      if (tr && tr.items && tr.items.length && want.indexOf(tr.list) !== -1) { lists.push(tr.items); }
    }
    var out = [], seen = {};
    for (var i = 0; i < TRENDING_MAX; i++) {
      for (var l = 0; l < lists.length; l++) {
        var item = lists[l][i];
        if (item && !seen[item.id] && hasUsableCover(item) && trendFitsMode(item)) { seen[item.id] = true; out.push(item); }
      }
    }
    return out;
  }

  /* "Spider-Man: Un nuevo día (2026) T2" -> "spider-man un nuevo dia" */
  function titleKey(s) {
    return norm(String(s || ''))
      .replace(/\(\d{4}\)/g, ' ')
      .replace(/\s+(t|temporada|season|s)\s*\d+\s*$/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function catalogMatch(t, pool) {
    var local = titleKey(t.title), original = titleKey(t.original);
    var best = null;
    for (var i = 0; i < pool.length; i++) {
      var v = pool[i];
      if (!v || !hasUsableCover(v)) { continue; }
      if (!!isSeriesItem(v) !== (t.kind === 'tv')) { continue; }
      var vt = titleKey(v.title), va = titleKey(v.alias);
      /* A catalogue title with an extra qualifier in brackets is a different
         film ("La odisea (The Asylum)"): only its own exact title counts. */
      if (/\([^)]*[a-z][^)]*\)/i.test(String(v.title || ''))) { va = ''; }
      var yearMatch = String(v.year || v.releaseDate || '').match(/\d{4}/);
      var sameYear = !!(t.year && yearMatch && Math.abs(parseInt(yearMatch[0], 10) - parseInt(t.year, 10)) <= 1);
      var unknownYear = !t.year || !yearMatch;
      /* The Spanish title is enough when the year agrees (or is unknown); a
         match on the original title alone also needs the same year, or
         look-alike films ("La odisea (The Asylum)") slip in. */
      if (local && local.length >= 2 && (local === vt || local === va)) {
        if (sameYear) { return v; }
        if (unknownYear) { best = best || v; }
      } else if (original && original.length >= 2 && (original === vt || original === va) && sameYear) {
        return v;
      }
    }
    return best;
  }

  /* A trend that is not in the loaded rows: searched in the addons. */
  function searchAddonsFor(t, done) {
    searchStremioAddons(t.title, function (found) { done(found && found.length ? catalogMatch(t, found) : null); }, null, true);
  }

  /* Keeps the matched titles for a TMDB list, in TMDB order. */
  function matchTrending(def, tmdbItems, done) {
    var out = new Array(tmdbItems.length);
    var missing = [];
    /* TMDB's backdrop (780 px wide) is kept with the title: the TV cards use
       it, lighter than the portal's full-size art. */
    function keep(idx, hit) {
      if (tmdbItems[idx].backdrop && !hit._trendArt) { hit._trendArt = tmdbItems[idx].backdrop; }
      out[idx] = hit;
    }
    /* Nothing that is not out yet (the service drops it too; this covers an
       answer it kept in its cache from before). Local date, as TMDB's. */
    var now = new Date();
    var today = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    tmdbItems = tmdbItems.filter(function (t) { return !t.date || t.date <= today; });
    out = new Array(tmdbItems.length);
    for (var i = 0; i < tmdbItems.length; i++) {
      var hit = catalogMatch(tmdbItems[i], VOD);
      if (hit) { keep(i, hit); } else { missing.push(i); }
    }
    var searches = def.searches || TRENDING_SEARCHES;
    var pending = Math.min(missing.length, searches);
    function finish() {
      var items = [], seen = {};
      for (var j = 0; j < out.length && items.length < TRENDING_MAX; j++) {
        if (out[j] && !seen[out[j].id]) { seen[out[j].id] = true; items.push(out[j]); }
      }
      done({ title: def.title, list: def.list, items: items });
    }
    if (!pending) { finish(); return; }
    missing.slice(0, searches).forEach(function (idx) {
      searchAddonsFor(tmdbItems[idx], function (hit) {
        if (hit) { keep(idx, hit); }
        if (--pending === 0) { finish(); }
      });
    });
  }

  function trendingRowsFromCache() {
    var saved = safeLocalRead(trendingCacheKey(), null);
    /* (v2: trends without films that are not out yet; older saved ones go.) */
    if (!saved || !saved.rows || saved.v !== 2 || Date.now() - (saved.at || 0) > TRENDING_TTL_MS * 4) { return null; }
    return saved;
  }

  /* Called on start-up and every few hours (desktop only). */
  function loadTrending() {
    var api = tmdbApi();
    if (!api || trendingLoading) { return; }
    var cached = trendingRowsFromCache();
    if (cached) {
      var hadNone = !trendingRows.length;
      trendingRows = cached.rows;
      /* Inicio was built without trends: show the saved ones now. */
      if (hadNone) { refreshTrendingPage(); }
      if (Date.now() - cached.at < TRENDING_TTL_MS) { return; }
    }
    trendingLoading = true;
    var results = [];
    var left = TRENDING_LISTS.length;
    TRENDING_LISTS.forEach(function (def, n) {
      /* (No addon searches for TMDB's anime when Kitsu gives Anime's top.) */
      if (def.list === 'anime-tv' && animeCatalogInstalled) { setTimeout(function () { step(n, null); }, 0); return; }
      api(def.list).then(function (answer) {
        if (!answer || !answer.items || !answer.items.length) { step(n, null); return; }
        matchTrending(def, answer.items, function (row) { step(n, row); });
      }).catch(function () { step(n, null); });
    });
    function step(n, row) {
      results[n] = row && row.items.length >= 4 ? row : null;
      if (--left > 0) { return; }
      trendingLoading = false;
      var rows = results.filter(function (r) { return !!r; });
      if (!rows.length) { return; }
      trendingRows = rows;
      safeLocalWrite(trendingCacheKey(), { v: 2, at: Date.now(), rows: rows });
      refreshTrendingPage();
    }
  }

  /* New rows: rebuild Inicio now if the viewer is not in the middle of it,
     otherwise the next time it is shown. */
  function refreshTrendingPage() {
    catalogStaleAt = Date.now() + 1;
    var tab = TABS[state.tab];
    var page = tab ? pages[tab.page] : null;
    /* (Every catalogue section has trends at its top now, not only Inicio.) */
    if (tab && tab.page > 0 && page && state.screen === 'home' && page.scrollTop < 80) {
      ensurePageBuilt(tab.page);
      showHeroForPage(tab.page);
    }
  }

  /* kind: 'movie' / 'series' shows only that row (Películas, Series pages).
     Only titles currently available in the active VOD catalogue are shown. */
  function appendTrendingRows(page, y, kind) {
    for (var i = 0; i < trendingRows.length; i++) {
      var row = trendingRows[i];
      if (!row || !row.items || !row.items.length) { continue; }
      if (row.list && row.list !== 'movie-week' && row.list !== 'tv-week') { continue; }
      if (kind && row.items[0] && (!!isSeriesItem(row.items[0])) !== (kind === 'series')) { continue; }
      var avail = [];
      for (var j = 0; j < row.items.length; j++) {
        /* Titles found with the portal search are not in the loaded catalogue
           but can be played all the same (only 4 of 14 were shown before). */
        var found = row.items[j] && (vodById(row.items[j].id) || row.items[j]);
        if (found && hasUsableCover(found) && trendFitsMode(found)) { avail.push(found); }
      }
      if (avail.length >= 4) {
        y = appendPosterRow(page, y, kind ? 'Tendencias de la semana' : row.title, avail);
      }
    }
    return y;
  }

  function installTrending() {
    if (!tmdbApi()) { return; }
    /* The saved trends are there before the first page is built, so Inicio
       opens with them instead of being rebuilt a few seconds later. */
    var saved = trendingRowsFromCache();
    if (saved) { trendingRows = saved.rows; }
    /* The catalogue must be there to match against: wait for it a little. */
    setTimeout(loadTrending, 6000);
    setInterval(loadTrending, TRENDING_TTL_MS);
  }

  /* ---- home/catalog-lang.js -------------------------------------------------- */
  /* home/catalog-lang.js — Idioma del catálogo: en español (por defecto) el título, la sinopsis y los episodios de los títulos de los addons se toman de TMDB.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The catalogue still comes from the addons (Cinemeta answers in English);
     only what is shown is translated, through the service's TMDB lookups
     ("es:<imdb id>", "es-season:<tmdb id>:<season>", service/tmdb.js and
     Tmdb.java). Titles without an IMDb id (Kitsu's anime) stay as they are.
     The English texts are kept (item._en): the search still finds a title by
     its English name, and switching to Inglés reloads the app with them. */
  var CATALOG_LANG_KEY = 'opentv_catalog_lang_v1';
  var CATALOG_ES_CACHE_KEY = 'opentv_catalog_es_v1';
  var CATALOG_ES_CACHE_MAX = 600;
  var catalogEsCache = null;
  var catalogEsSaveTimer = null;
  var catalogEsWaiting = {};

  function catalogLang() { return safeLocalRead(CATALOG_LANG_KEY, 'es') === 'en' ? 'en' : 'es'; }

  function setCatalogLang(lang) {
    var next = lang === 'en' ? 'en' : 'es';
    if (next === catalogLang()) { return; }
    safeLocalWrite(CATALOG_LANG_KEY, next);
    /* Every screen shows the other texts at once: start again. */
    setTimeout(function () { location.reload(); }, 150);
  }

  function itemImdbId(item) {
    var id = String((item && item._stremioId) || '');
    return /^tt\d{5,10}$/.test(id) ? id : '';
  }

  /* imdb id -> { t: title, o: overview, id: tmdb id, k: 'movie'|'tv', at }.
     One cache for every profile (texts, not choices), on its own key. */
  function catalogEsStore() {
    if (catalogEsCache) { return catalogEsCache; }
    catalogEsCache = {};
    try {
      var raw = localStorage.getItem(CATALOG_ES_CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') { catalogEsCache = parsed; }
    } catch (eRead) { /* storage off */ }
    return catalogEsCache;
  }

  function saveCatalogEsSoon() {
    if (catalogEsSaveTimer) { return; }
    catalogEsSaveTimer = setTimeout(function () {
      catalogEsSaveTimer = null;
      var store = catalogEsStore();
      var keys = Object.keys(store);
      if (keys.length > CATALOG_ES_CACHE_MAX) {
        keys.sort(function (a, b) { return (store[a].at || 0) - (store[b].at || 0); });
        for (var i = 0; i < keys.length - CATALOG_ES_CACHE_MAX; i++) { delete store[keys[i]]; }
      }
      try { localStorage.setItem(CATALOG_ES_CACHE_KEY, JSON.stringify(store)); } catch (eSave) { /* full */ }
    }, 1500);
  }

  function applyEsTexts(item, es) {
    if (!item._en) { item._en = { title: item.title, synopsis: item.synopsis, alias: item.alias }; }
    if (es.t) {
      item.title = es.t;
      /* The English name stays searchable. */
      if (!item.alias || item.alias === item._en.title) { item.alias = item._en.title; }
    }
    if (es.o) { item.synopsis = es.o; item._esShown = true; }
    item._esTmdb = es.id || 0;
    item._esKind = es.k || '';
  }

  /* Gives `item` its Spanish texts: from the cache at once, else from TMDB.
     done(changed) runs once they are in (changed false when nothing to do). */
  function localizeItem(item, done) {
    done = done || function () {};
    if (!item || catalogLang() !== 'es') { done(false); return; }
    if (item._esDone) { done(false); return; }
    var imdb = itemImdbId(item);
    if (!imdb) { item._esDone = true; done(false); return; }
    var hit = catalogEsStore()[imdb];
    if (hit) { applyEsTexts(item, hit); item._esDone = true; done(true); return; }
    var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
    if (!api) { done(false); return; }
    /* One request per title, however many places ask for it. */
    if (catalogEsWaiting[imdb]) { catalogEsWaiting[imdb].push({ item: item, done: done }); return; }
    catalogEsWaiting[imdb] = [{ item: item, done: done }];
    api('es:' + imdb).then(function (out) {
      var waiting = catalogEsWaiting[imdb] || [];
      delete catalogEsWaiting[imdb];
      var found = out && !out.error && out.item;
      var es = found ? { t: found.title || '', o: found.overview || '', id: found.tmdbId, k: found.kind, at: Date.now() } : null;
      /* Not on TMDB: remembered too, so it is not asked again. */
      if (out && !out.error) {
        catalogEsStore()[imdb] = es || { t: '', o: '', id: 0, k: '', at: Date.now() };
        saveCatalogEsSoon();
      }
      waiting.forEach(function (w) {
        if (es) { applyEsTexts(w.item, es); }
        w.item._esDone = !!(out && !out.error);
        w.done(!!es);
      });
    });
  }

  /* The episodes of one season of a series in Spanish (names and summaries),
     once its Spanish texts are known. done(changed). */
  function localizeSeason(item, seasonNumber, episodes, done) {
    done = done || function () {};
    if (!item || catalogLang() !== 'es' || !episodes || !episodes.length || !seasonNumber) { done(false); return; }
    localizeItem(item, function () {
      var tmdbId = item._esTmdb;
      if (!tmdbId || item._esKind !== 'tv') { done(false); return; }
      var key = tmdbId + ':' + seasonNumber;
      if (episodes._esKey === key) { done(false); return; }
      var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
      if (!api) { done(false); return; }
      api('es-season:' + key).then(function (out) {
        var list = out && !out.error && out.episodes;
        if (!list || !list.length) { done(false); return; }
        var byNumber = {};
        for (var i = 0; i < list.length; i++) { byNumber[list[i].number] = list[i]; }
        var changed = false;
        for (var e = 0; e < episodes.length; e++) {
          var ep = episodes[e];
          var n = ep.number !== undefined && ep.number !== null ? ep.number : e + 1;
          var es = byNumber[n];
          if (!es) { continue; }
          if (!ep._en) { ep._en = { title: ep.title, synopsis: ep.synopsis }; }
          /* TMDB says "Episodio 5" when it has no Spanish name: keep the
             addon's one then. */
          if (es.title && !/^(episodio|episode)\s*\d+$/i.test(es.title)) { ep.title = es.title; changed = true; }
          if (es.overview) { ep.synopsis = es.overview; changed = true; }
        }
        episodes._esKey = key;
        done(changed);
      });
    });
  }

  /* Anime from Kitsu: its episode pictures are uploaded by people and come in
     every size and quality (825 px to heavily compressed 4K). When the series
     is found on TMDB with certainty, its own pictures (and, in Spanish, the
     episode names) are used instead:
     - a TV series first aired the same year as Kitsu's entry (Kitsu lists
       each season apart: "Attack on Titan" 2017 is the 2nd season, not found
       here, so nothing changes), and
     - whose first season has exactly as many episodes.
     Anything else keeps Kitsu's pictures. done(changed). */
  function animeEpisodeStills(item, episodes, done) {
    done = done || function () {};
    var id = String((item && item._stremioId) || '');
    if (!/^kitsu:/.test(id) || !episodes || !episodes.length || episodes._stillsKey) { done(false); return; }
    var api = typeof tmdbApi === 'function' ? tmdbApi() : null;
    var year = String((item && item.year) || '').slice(0, 4);
    if (!api || !/^\d{4}$/.test(year)) { done(false); return; }
    episodes._stillsKey = 'pending';
    var name = (item._en && item._en.title) || item.title || '';
    api('search:' + name).then(function (out) {
      var list = (out && !out.error && out.items) || [];
      var show = null;
      for (var i = 0; i < list.length && !show; i++) {
        if (list[i].kind === 'tv' && String(list[i].year) === year) { show = list[i]; }
      }
      if (!show) { episodes._stillsKey = 'none'; done(false); return; }
      api('es-season:' + show.tmdbId + ':1').then(function (s) {
        var eps = (s && !s.error && s.episodes) || [];
        if (eps.length !== episodes.length) { episodes._stillsKey = 'none'; done(false); return; }
        var byNumber = {};
        for (var k = 0; k < eps.length; k++) { byNumber[eps[k].number] = eps[k]; }
        var changed = false;
        var spanish = catalogLang() === 'es';
        for (var e = 0; e < episodes.length; e++) {
          var ep = episodes[e];
          var n = ep.number !== undefined && ep.number !== null ? ep.number : e + 1;
          var match = byNumber[n];
          if (!match) { continue; }
          if (match.still) { ep._kitsuThumb = ep.thumb; ep.thumb = match.still; changed = true; }
          if (spanish) {
            if (!ep._en) { ep._en = { title: ep.title, synopsis: ep.synopsis }; }
            if (match.title && !/^(episodio|episode)\s*\d+$/i.test(match.title)) { ep.title = match.title; changed = true; }
            if (match.overview) { ep.synopsis = match.overview; changed = true; }
          }
        }
        episodes._stillsKey = String(show.tmdbId);
        done(changed);
      });
    });
  }

  /* ---- screens/detail.js ----------------------------------------------------- */
  /* screens/detail.js — Ficha de un título: datos, botones, temporadas, episodios y recomendaciones.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ============================================================ VOD DETAIL */
  /* Back from the player: bring the resume button ("Reanudar · 25:10") up to
     date. Returns true when the buttons had to be rebuilt (never now). */
  function refreshDetailResume(item) {
    if (!window.OPENTV_DESKTOP || !item || !detailButtons) { return false; }
    var label = resumeLabelFor(item) || 'Reproducir';
    var span = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span');
    if (span && span.textContent !== label) { span.textContent = label; }
    syncStartOverButton(item);
    return false;
  }

  /* "Ver desde el principio" shows only when Reproducir would resume. */
  function syncStartOverButton(item) {
    var btn = detailButtons && detailButtons.querySelector('.detail-btn[data-kind="restart"]');
    if (!btn) { return; }
    var show = canStartOver(item, isSeriesItem(item) ? state.detailEpisode : null);
    btn.style.display = show ? '' : 'none';
    /* The focus never stays on a button that just went away. */
    if (!show && state.focus === btn) {
      var play = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"]');
      if (play) { setFocus(play); }
    }
  }

  /* PC and TV: the details screen shows the title's picture, faded into the
     page behind the text, not a small playing preview (it searched sources
     and loaded a video just to look at a title). Reproducir goes full screen. */
  function detailShowsArt() {
    return !!window.OPENTV_DESKTOP;
  }

  function openDetail(item) {
    /* (A stale card or an empty catalog: nothing to open.) */
    if (!item) { return; }
    /* A video floating in the PiP window keeps playing (and keeps its own
       player state) while the viewer browses other titles. */
    var floating = keepFloatingVideo() && state.playerItem !== item;
    if (!floating) { stopPlayerVideo(); }
    state.detail = item;
    state.streamError = '';
    if (!floating) {
      state.playerMode = 'vod';
      state.playerItem = item;
      state.playerEpisode = null;
    }
    lastVodAttempt = { phase: 'ficha y capítulos', status: 'cargando', error: '' };
    state.detailReturn = { screen: state.screen, focus: state.focus };
    state.detailRange = 0;
    state.detailSeason = 0;
    state.detailEpisode = null;

    if (item.seasons && item.seasons.length) {
      for (var s = 0; s < item.seasons.length; s++) {
        if (item.seasons[s].id === item.id) {
          state.detailSeason = s;
          break;
        }
      }
    }
    if (item.episodes && item.episodes.length) {
      state.detailEpisode = item.episodes[0];
    }
    resetResumePlan();
    preferHistoryEpisode(item);
    if (window.OPENTV_DESKTOP && pendingHistoryRecord && item.seasons && item.seasons.length > 1) {
      var wantedSid = String(pendingHistoryRecord.seasonId || pendingHistoryRecord.id || '');
      for (var hs = 0; hs < item.seasons.length; hs++) {
        if (String(item.seasons[hs].id) === wantedSid) {
          state.detailSeason = hs;
          state.playerSeasonIndex = hs;
          if (item.seasons[hs]._episodes && item.seasons[hs]._episodes.length) {
            item.episodes = item.seasons[hs]._episodes;
            item.seasonId = item.seasons[hs].id;
          }
          break;
        }
      }
    }
    applyPendingHistoryEpisode(item);

    /* New title: forget the previous audio/subtitle/rendition choice and ask
       the portal for this one's real tracks (cached for the dialog/panel). */
    if (!floating) {
      resetMediaSelection();
      restoreSmoothMode(item);
    }
    ensureMediaInfo(item);

    /* Spanish texts (home/catalog-lang.js): from the cache before drawing;
       when they come from TMDB a moment later, they are put in place. */
    localizeItem(item, function (changed) {
      if (!changed || state.detail !== item || !detailLeft || !detailLeft.isConnected) { return; }
      var tNode = detailLeft.querySelector('.detail-title');
      if (tNode) { tNode.textContent = item.title; }
      var sNode = detailLeft.querySelector('.detail-synopsis .text');
      if (sNode) { sNode.textContent = item.synopsis; }
    });

    buildDetail(item);
    showScreen('detail');

    /* Mostrar reproductor en recuadro mini */
    if (!playerStage) { buildPlayer(); }
    var scrPlayer = $('screen-player');
    /* (PC and TVs: no small player on the details screen, only the picture.) */
    var scrDetailPage = $('screen-detail');
    if (scrDetailPage) {
      /* (TVs: the whole screen scrolls as one page, core/focus.js reveal.) */
      scrDetailPage.scrollTop = 0;
      scrDetailPage._tvTop = 0;
    }
    if (scrPlayer && !detailShowsArt()) {
      scrPlayer.classList.add('is-mini');
      scrPlayer.classList.add('is-active');
      /* The title's picture while the preview loads (or when there is none:
         no trailer, addon titles) instead of an empty black box. */
      if (playerVideo && (!document.pictureInPictureElement || state.playerItem === item)) {
        var stillArt = heroArt(item) || item.poster || '';
        if (stillArt) { playerVideo.poster = sizedImageUrl(stillArt, 1280); }
        else { playerVideo.removeAttribute('poster'); }
      }
    }

    var f = detailButtons ? detailButtons.querySelector('.focusable') : null;
    if (f) { setFocus(f); }

    if (item._detailsLoaded) {
      /* "Seguir viendo" on another season: its episodes came with the title. */
      var recSeason = window.OPENTV_DESKTOP && pendingHistoryRecord && item.seasons && item.seasons[state.detailSeason];
      if (recSeason && recSeason._episodes && recSeason._episodes.length &&
          String(recSeason.id) !== String(item.seasonId || item.id)) {
        item.episodes = recSeason._episodes;
        item.seasonId = recSeason.id;
        applyPendingHistoryEpisode(item);
        buildDetail(item);
      }
      if (autoPreviewAllowed(item)) { startPlayerVideo(item, state.detailEpisode); }
    } else {
      if (autoPreviewAllowed(item)) { setPlayerStatus('Preparando la reproducción…'); }
      loadVodDetail(item, function (loaded) {
        if (loaded && state.screen === 'detail' && state.detail === loaded) {
          applyPendingHistoryEpisode(loaded);
          buildDetail(loaded);
          if (autoPreviewAllowed(loaded)) { startPlayerVideo(loaded, state.detailEpisode); }
        }
      });
    }
  }

  function toggleSynopsis() {
    var screen = $('screen-detail');
    if (!screen) { return; }
    var open = !screen.classList.contains('is-synopsis-open');
    screen.classList.toggle('is-synopsis-open', open);
    if (window.OPENTV_DESKTOP) {
      var backdrop = screen.querySelector('.synopsis-backdrop');
      if (!backdrop) {
        backdrop = el('div', 'synopsis-backdrop');
        backdrop.addEventListener('click', function (event) {
          event.stopPropagation();
          if (screen.classList.contains('is-synopsis-open')) { toggleSynopsis(); }
        });
        screen.appendChild(backdrop);
      }
    }
    var more = document.querySelector('.detail-more');
    if (more) {
      more.textContent = window.OPENTV_DESKTOP ? (open ? '✕  Cerrar' : 'Leer más') : (open ? 'Menos' : 'Más');
    }
  }

  /* Line icons for the desktop detail buttons (currentColor, 24px grid). */
  var DESKTOP_DETAIL_ICONS = {
    fullscreen: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
    language: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h3M13 11h4M7 15h6M15 15h2"/></svg>',
    favorite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"/></svg>',
    mylist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"/></svg>',
    mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    source: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 12h16M4 17h9"/><path d="m17 4 3 3-3 3"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>'
  };

  function buildDetail(item) {
    detailLeft = $('detail-left');
    detailPlayer = $('detail-player');
    detailButtons = $('detail-buttons');
    detailBottom = $('detail-bottom');
    clear(detailLeft); clear(detailButtons); clear(detailBottom);

    /* left column: 806px at 80/50 */
    var tw = el('div', 'detail-titlewrap');
    /* Long titles (anime: "… Season 2 - Arise from the Shadow") get a
       smaller size and every line shows; fitDetailLeft shrinks more if needed. */
    var titleLen = String(item.title || '').length;
    tw.appendChild(el('div', 'detail-title' + (titleLen > 70 ? ' is-xlong' : titleLen > 40 ? ' is-long' : ''), item.title));
    /* No rating from the addon: no empty "★ —" badge. */
    if (item.score && !/^[\s—–-]*$/.test(String(item.score))) { tw.appendChild(el('div', 'detail-score', item.score)); }
    detailLeft.appendChild(tw);

    var metaText;
    if (item.country || item.releaseDate || item.tagline) {
      /* mTextTimeType: "country | release date | viewpoint" (reference). */
      var bits = [];
      if (item.country) { bits.push(countryName(item.country)); }
      if (item.releaseDate) { bits.push(item.releaseDate); }
      if (item.tagline) { bits.push(item.tagline); }
      metaText = bits.join(' | ');
    } else {
      var parts = [];
      if (item.year && item.year !== '—') { parts.push(item.year); }
      if (item.duration && item.duration !== '—') { parts.push(item.duration); }
      parts.push('HD');
      metaText = parts.join('  ·  ');
    }
    /* PC: a tighter top. Year · length · HD go on the genres' line, and
       Dirección / Reparto on one line (below). */
    var pcPage = !!window.OPENTV_DESKTOP && !platformIsTv();
    if (!pcPage) { detailLeft.appendChild(el('div', 'detail-meta', metaText)); }

    /* mTextUpdate: gold "T10 - E73", series only. The season comes from the
       alias ("... S10") or the season list; the count is the episode total. */
    if (isSeriesItem(item)) {
      var seasonNo = 0;
      var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (sm) { seasonNo = parseInt(sm[1], 10) || 0; }
      if (!seasonNo && item.seasons && item.seasons.length) {
        var curSeason = item.seasons[state.detailSeason] || item.seasons[0];
        seasonNo = (curSeason && curSeason.number) || 1;
      }
      if (!seasonNo) { seasonNo = 1; }
      var epTotal = item.updateCount || item.volumeCount || (item.episodes ? item.episodes.length : 0);
      if (epTotal) {
        detailLeft.appendChild(el('div', 'detail-update', 'T' + seasonNo + ' - E' + epTotal));
      }
    }

    var genres = el('div', 'detail-genres');
    genres.appendChild(el('span', 'label', 'Género : '));
    /* Informational metadata must not take D-pad focus on the detail page.
       Names in Spanish, without repeats (Animation and Cartoon are one). */
    var genreList = itemGenres(item, 6);
    if (!genreList.length) { genreList = ['Sin clasificar']; }
    for (var g = 0; g < genreList.length; g++) {
      genres.appendChild(el('div', 'chip', genreList[g]));
    }
    if (pcPage) {
      genres.classList.add('has-meta');
      genres.insertBefore(el('span', 'detail-meta is-inline', metaText), genres.firstChild);
    }
    detailLeft.appendChild(genres);

    var desk = !!window.OPENTV_DESKTOP;
    function emptyValue(v) { return !v || /^[\s—–\-]*$/.test(String(v)); }

    if (pcPage && !(emptyValue(item.director) && emptyValue(item.actors))) {
      var credits = el('div', 'detail-row is-credits');
      if (!emptyValue(item.director)) {
        credits.appendChild(el('span', 'row-label', 'Dirección'));
        credits.appendChild(el('span', 'val', item.director));
      }
      if (!emptyValue(item.actors)) {
        if (!emptyValue(item.director)) { credits.appendChild(el('span', 'row-sep', '·')); }
        credits.appendChild(el('span', 'row-label', 'Reparto'));
        credits.appendChild(el('span', 'val', String(item.actors).replace(/\s*,\s*/g, ', ')));
      }
      detailLeft.appendChild(credits);
    }
    var dir = el('div', 'detail-row');
    if (desk) { dir.appendChild(el('span', 'row-label', 'Dirección')); }
    else { dir.appendChild(document.createTextNode('Director : ')); }
    var dirV = el('span', 'val', item.director);
    dir.appendChild(dirV);
    if (!(desk && emptyValue(item.director)) && !pcPage) { detailLeft.appendChild(dir); }

    var act = el('div', 'detail-row');
    if (desk) { act.appendChild(el('span', 'row-label', 'Reparto')); }
    else { act.appendChild(document.createTextNode('Actors : ')); }
    var actV = el('span', 'val', desk ? String(item.actors || '').replace(/\s*,\s*/g, ', ') : item.actors);
    act.appendChild(actV);
    if (!(desk && emptyValue(item.actors)) && !pcPage) { detailLeft.appendChild(act); }

    var syn = el('div', 'detail-synopsis');
    syn.appendChild(el('span', 'label', desk ? 'Sinopsis' : 'Sinopsis : '));
    syn.appendChild(el('div', 'text', item.synopsis));
    /* mTextIntroduction + tvMore: the APK expands the 2-line preview in place.
       Here the expanded block overlays the button row (documented). */
    var more = el('div', 'detail-more focusable', desk ? 'Leer más' : 'Más');
    more._activate = toggleSynopsis;
    syn.appendChild(more);
    detailLeft.appendChild(syn);
    if (desk) { fitDetailLeft(syn); }

    /* player window 765x430 at right 80 / top 50. */
    clear(detailPlayer);
    detailPlayer.classList.toggle('is-art', detailShowsArt());
    if (detailShowsArt()) {
      /* TVs: the title's picture instead of a playing preview (a second video
         next to the buttons came out black on the Fire TV and slowed the whole
         screen down). Reproducir opens the full-screen player. */
      detailPlayer.classList.remove('focusable');
      var tvArt = tvCardArt(item);
      if (tvArt) {
        var artImg = el('img', 'detail-tv-art');
        artImg.decoding = 'async';
        artImg.src = sizedImageUrl(tvArt, 1280);   /* backdrop behind the text (desktop/tw/input.css) */
        detailPlayer.appendChild(artImg);
      }
    } else {
      detailPlayer.classList.add('focusable');
      detailPlayer._activate = function () { expandToFullscreen(item, state.detailEpisode); };
      detailPlayer._onMove = function () { return false; };
      /* Addon titles play no preview here (it could start a torrent just by
         opening the page): their picture instead, with a play mark, until the
         title is playing in this box. */
      var playingHere = state.playerItem === item && playerVideo && playerVideo.currentSrc;
      var pcArt = !autoPreviewAllowed(item) && !playingHere ? (heroArt(item) || item.poster) : '';
      if (pcArt) {
        var pic = el('div', 'detail-pc-art');
        pic.style.backgroundImage = 'url("' + String(sizedImageUrl(pcArt, 1280)).replace(/"/g, '%22') + '")';
        var mark = el('i', 'detail-pc-play');
        mark.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
        pic.appendChild(mark);
        detailPlayer.appendChild(pic);
        /* Once a video plays in this box, the picture steps aside. */
        if (playerVideo) {
          var dropArt = function () {
            playerVideo.removeEventListener('playing', dropArt);
            if (pic.parentNode) { pic.parentNode.removeChild(pic); }
          };
          playerVideo.addEventListener('playing', dropArt);
        }
      }
    }

    /* buttons 276x68, gap 30 */
    var btnDefs = [
      { icon: 'icon_detail_fullscreen.png', label: 'Pantalla completa', kind: 'fullscreen' },
      { icon: 'icon_detail_subtitle_audio.png', label: 'Idioma', kind: 'language' },
      { icon: 'icon_detail_favorite.png', label: 'Favorito', kind: 'favorite' }
    ];
    /* Desktop: notifications are not implemented, so the button is left out. */
    if (isSeriesItem(item) && !desk) {
      btnDefs.push({ icon: 'icon_detail_subscribe.png', label: 'Notificaciones', kind: 'subscribe' });
    }
    if (desk) {
      /* Two groups, one big button. Watching: Reproducir (with Cambiar
         fuente joined to it) and Idioma y subtítulos. Then, after a line, the
         viewer's own: Favorito, Mi lista, Descargar. Icons show their name
         as a tooltip, and on a TV / keyboard when they have the focus. */
      btnDefs = [
        { label: resumeLabelFor(item) || 'Reproducir', kind: 'fullscreen' }
      ];
      var canChooseSource = item._stremio && !item._plain && !item._downloadId;
      if (canChooseSource) { btnDefs.push({ label: 'Cambiar fuente', kind: 'source', iconOnly: true, attached: true }); }
      /* Hidden by syncStartOverButton while there is nothing to resume. */
      btnDefs.push({ label: 'Ver desde el principio', kind: 'restart', iconOnly: true });
      btnDefs.push({ label: 'Idioma y subtítulos', kind: 'language', iconOnly: true });
      btnDefs.push({ label: state.favs[String(item.id)] ? 'Quitar de favoritos' : 'Añadir a favoritos', kind: 'favorite', iconOnly: true, group: true });
      btnDefs.push({ label: inMyList(item) ? 'Quitar de Mi lista' : 'Añadir a Mi lista', kind: 'mylist', iconOnly: true });
      if (canChooseSource) {
        /* PC: save the movie or the selected episode to watch without internet. */
        if (platformHas('downloads')) {
          var dl = downloadFor(item, isSeriesItem(item) ? state.detailEpisode : null);
          btnDefs.push({ label: dl && dl.status === 'done' ? 'Descargado' : (dl && dl.status !== 'error' && dl.status !== 'missing' ? 'Descargando…' : 'Descargar'),
            kind: 'download', iconOnly: true });
        }
      }
    }
    /* No addon with sources: information only, and where to add one. */
    var canPlay = !item._stremio || item._downloadId || hasSourceAddons() || !!downloadedFileFor(item, state.detailEpisode);
    if (!canPlay) {
      btnDefs = btnDefs.filter(function (d) { return d.kind === 'favorite' || d.kind === 'mylist'; });
      var noSrc = el('div', 'detail-nosrc');
      noSrc.appendChild(el('span', 'detail-nosrc-text', 'Para reproducir, agrega un addon de fuentes.'));
      var goAddons = el('div', 'detail-btn focusable detail-nosrc-btn');
      goAddons.appendChild(el('span', null, 'Ir a Addons'));
      goAddons._activate = function () { openSettingsAt('sources'); };
      noSrc.appendChild(goAddons);
      detailButtons.appendChild(noSrc);
    }
    for (var b = 0; b < btnDefs.length; b++) {
      /* The line between "watch" and "mine". */
      if (btnDefs[b].group && b > 0) { detailButtons.appendChild(el('i', 'detail-btn-sep')); }
      var btn = el('div', 'detail-btn focusable');
      if (btnDefs[b].attached) { btn.classList.add('is-attached'); }
      if (btnDefs[b + 1] && btnDefs[b + 1].attached) { btn.classList.add('has-attached'); }
      btn.setAttribute('data-kind', btnDefs[b].kind);
      if (desk && DESKTOP_DETAIL_ICONS[btnDefs[b].kind]) {
        var svgWrap = el('i', 'detail-btn-icon');
        svgWrap.innerHTML = DESKTOP_DETAIL_ICONS[btnDefs[b].kind];
        btn.appendChild(svgWrap);
      } else {
        var ico = el('img');
        ico.src = 'assets/original/vod/' + btnDefs[b].icon;
        ico.alt = '';
        btn.appendChild(ico);
      }
      btn.appendChild(el('span', null, btnDefs[b].label));
      btn._kind = btnDefs[b].kind;
      if (btnDefs[b].iconOnly) {
        /* Only the icon shows; the label is the tooltip and what a screen reader says. */
        btn.classList.add('is-icon-only');
        btn.setAttribute('data-tip', btnDefs[b].label);
        btn.setAttribute('aria-label', btnDefs[b].label);
      }
      if ((btnDefs[b].kind === 'favorite' && state.favs[String(item.id)]) ||
          (btnDefs[b].kind === 'mylist' && inMyList(item))) {
        btn.classList.add('is-selected');
        if (!desk) { btn.querySelector('span').textContent = 'En favoritos'; }
      }
      if (window.OPENTV_DESKTOP && btnDefs[b].kind === 'subscribe') {
        btn.setAttribute('aria-disabled', 'true');
        btn.title = 'Las notificaciones del servicio no están disponibles';
      }
      btn._activate = (function (kind, it) {
        return function () {
          if (kind === 'fullscreen') { resumeFromStartKey = ''; expandToFullscreen(it, state.detailEpisode); }
          else if (kind === 'restart') { startOverTitle(it, isSeriesItem(it) ? state.detailEpisode : null); }
          else if (kind === 'language') { openPlaySettingsDialog(it); }
          else if (kind === 'source') { changeStremioSource(it, state.detailEpisode); }
          else if (kind === 'download') { startTitleDownload(it, state.detailEpisode); }
          else if (kind === 'favorite' || kind === 'mylist') {
            var enabled = kind === 'favorite' ? toggleFavorite(it) : toggleMyList(it);
            this.classList.toggle('is-selected', enabled);
            var label = this.querySelector('span');
            var text = kind === 'favorite'
              ? (desk ? (enabled ? 'Quitar de favoritos' : 'Añadir a favoritos') : (enabled ? 'En favoritos' : 'Favorito'))
              : (enabled ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
            if (label) { label.textContent = text; }
            if (this.classList.contains('is-icon-only')) {
              this.setAttribute('data-tip', text);
              this.setAttribute('aria-label', text);
            }
          } else if (kind === 'subscribe') {
            var img = this.querySelector('img');
            var on = img.src.indexOf('subscribed') === -1;
            img.src = 'assets/original/vod/icon_detail_' + (on ? 'subscribed' : 'subscribe') + '.png';
          }
        };
      })(btnDefs[b].kind, item);
      detailButtons.appendChild(btn);
    }
    syncStartOverButton(item);
    var modeBtn = el('div', 'detail-btn focusable');
    modeBtn.setAttribute('data-kind', 'mode');
    if (desk) {
      var modeSvg = el('i', 'detail-btn-icon');
      modeSvg.innerHTML = DESKTOP_DETAIL_ICONS.mode;
      modeBtn.appendChild(modeSvg);
    } else {
      var modeIcon = el('img');
      modeIcon.src = 'assets/original/vod/icon_detail_quality.png';
      modeIcon.alt = '';
      modeBtn.appendChild(modeIcon);
    }
    function modeText() {
      if (desk) { return 'Modo fluido'; }
      return state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No';
    }
    var modeLabel = el('span', null, modeText());
    modeBtn.appendChild(modeLabel);
    if (desk) {
      modeBtn.appendChild(el('i', 'detail-switch'));
      modeBtn.title = 'Convierte el vídeo para mayor compatibilidad (usa más CPU)';
    }
    modeBtn.classList.toggle('is-on', state.streamMode === 'smooth');
    modeBtn._activate = function () {
      setSmoothMode(item, state.streamMode !== 'smooth');
      modeLabel.textContent = modeText();
      modeBtn.classList.toggle('is-on', state.streamMode === 'smooth');
      if (window.OPENTV_DESKTOP && state.playerItem === item && playerVideo && playerVideo.currentSrc) restartCurrentPlayback();
    };
    /* Desktop: compatibility is automatic (see tryCompatFallback); the manual
       choice lives in the player settings, not next to Play. */
    if (!desk && canPlay) { detailButtons.appendChild(modeBtn); }

    renderDetailBottom(item);
    /* Rebuilt once the full details arrive: the remote must not stay on the
       buttons that were just replaced (nothing looked focused). */
    if (state.screen === 'detail' && (!state.focus || !document.documentElement.contains(state.focus))) {
      var firstBtn = detailButtons.querySelector('.focusable');
      if (firstBtn) { setFocus(firstBtn, true); }
    }
  }

  /* Episode ranges: only very long series are split ("1-100", "101-200"…),
     so a season of 25 is one row (it was cut at 20 for no reason); a
     1,000-episode anime still does not draw every card at once. */
  var DETAIL_RANGE_SIZE = 100;
  function detailRanges(count) {
    var out = [];
    for (var s = 0; s < count; s += DETAIL_RANGE_SIZE) {
      out.push({ start: s, end: Math.min(count, s + DETAIL_RANGE_SIZE) });
    }
    return out;
  }

  function detailSeasonLabel(item) {
    var n = 0;
    if (item.seasons && item.seasons.length > 0) {
      var cur = item.seasons[state.detailSeason] || item.seasons[0];
      n = cur && cur.number ? cur.number : state.detailSeason + 1;
    }
    if (!n) {
      var m = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (m) { n = parseInt(m[1], 10) || 0; }
    }
    return 'Temporada ' + (n || 1);
  }

  function selectDetailRange(index, item) {
    state.detailRange = index;
    buildDetail(item);
    var f = detailBottom.querySelector('.detail-range.is-selected');
    if (f) { setFocus(f); }
  }

  var seasonPopup = null;
  function closeSeasonPopup() {
    if (seasonPopup && seasonPopup.parentNode) {
      seasonPopup.parentNode.removeChild(seasonPopup);
      seasonPopup = null;
    }
    var arrow = detailBottom ? detailBottom.querySelector('.season-arrow') : null;
    if (arrow) { arrow.classList.remove('is-open'); }
  }

  function toggleSeasonPopup(anchorBtn, item) {
    if (seasonPopup) {
      closeSeasonPopup();
      return;
    }
    if (!item.seasons || item.seasons.length < 2) { return; }

    var arrow = anchorBtn.querySelector('.season-arrow');
    if (arrow) { arrow.classList.add('is-open'); }

    seasonPopup = el('div', 'season-popup');
    if (window.OPENTV_DESKTOP) {
      /* Flow layout: open right under the season button. */
      /* Many seasons (Anatomía según Grey has 22): a compact grid of numbers
         so they all fit without scrolling. */
      var gridMode = item.seasons.length > 6;
      if (gridMode) { seasonPopup.classList.add('is-grid'); }
      abs(seasonPopup, anchorBtn.offsetLeft, anchorBtn.offsetTop + anchorBtn.offsetHeight + 8,
        gridMode ? Math.min(6, item.seasons.length) * 62 + 28 : Math.max(260, anchorBtn.offsetWidth));
      seasonPopup.style.maxHeight = gridMode ? 'none' : '360px';
    } else {
      abs(seasonPopup, 80, 100, 280, Math.min(320, item.seasons.length * 54));
    }

    for (var s = 0; s < item.seasons.length; s++) {
      (function (sIndex) {
        var sData = item.seasons[sIndex];
        var isSelected = sIndex === state.detailSeason;
        var pItem = el('div', 'season-popup-item focusable' + (isSelected ? ' is-selected' : ''));
        var sText = 'Temporada ' + (sData.number || (sIndex + 1));
        var compact = window.OPENTV_DESKTOP && item.seasons.length > 6;
        pItem.appendChild(el('span', 'season-item-text', compact ? String(sData.number || (sIndex + 1)) : sText));
        if (compact) { pItem.title = sText; }

        var check = el('img', 'season-item-check');
        check.src = 'assets/original/vod/icon_nation_selected.png';
        check.alt = '';
        pItem.appendChild(check);

        pItem._activate = function () {
          closeSeasonPopup();
          if (state.detailSeason !== sIndex) {
            state.detailSeason = sIndex;
            state.detailRange = 0;
            state.detailEpisode = null;
            /* The addon gave every season's episodes with the title. */
            var targetSeason = item.seasons[sIndex];
            if (targetSeason) {
              item.episodes = targetSeason._episodes || [];
              item.seasonId = targetSeason.id;
              state.detailEpisode = item.episodes[0] || null;
              buildDetail(item);
              /* Changing season only shows its episodes. (It used to start
                 the first one: with addons that searched a torrent and played
                 it without the viewer asking.) */
              if (state.detailEpisode && autoPreviewAllowed(item)) { startPlayerVideo(item, state.detailEpisode); }
              var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
              if (sBtn) { setFocus(sBtn); }
            }
          } else {
            var sBtn2 = detailBottom ? detailBottom.querySelector('.detail-season') : null;
            if (sBtn2) { setFocus(sBtn2); }
          }
        };

        seasonPopup.appendChild(pItem);
      })(s);
    }

    detailBottom.appendChild(seasonPopup);
    var focusedChild = seasonPopup.children[state.detailSeason] || seasonPopup.children[0];
    /* Desktop: focus without scrolling the page. Revealing the current
       season pushed the whole "Episodios" section out of view. */
    if (focusedChild) { setFocus(focusedChild, !!window.OPENTV_DESKTOP); }
  }

  /* Desktop layout: one scrollable column (episodes, then related titles)
     laid out by CSS instead of fixed TV coordinates. */
  function renderDetailBottomDesktop(item) {
    var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
    var ranges = detailRanges(episodes.length);
    if (state.detailRange >= ranges.length) { state.detailRange = 0; }
    detailBottom.classList.add('dd-flow');
    /* PC: the whole page scrolls (the top too), not only this part. TVs keep
       their own scrolling list under the buttons. */
    var pageScroll = !platformIsTv();
    detailBottom.classList.toggle('scrollable', !pageScroll);
    var detailScreen = $('screen-detail');
    if (detailScreen) {
      detailScreen.classList.toggle('scrollable', pageScroll);
      detailScreen.classList.toggle('is-page-scroll', pageScroll);
    }

    if (isSeriesItem(item)) {
      var epSection = el('section', 'dd-section');
      var head = el('div', 'dd-head');
      var tvDetail = platformIsTv();
      /* TVs: the season button says enough (no "Episodios" title or count). */
      if (!tvDetail) { head.appendChild(el('h2', 'dd-title', 'Episodios')); }
      /* TVs: "Viendo" only on the episode really in the history, not on the
         first one of a series never watched. */
      var watchedRec = tvDetail ? historyRecordFor(item) : null;
      var watchedEp = watchedRec && watchedRec.episodeId ? String(watchedRec.episodeId) : '';

      var seasonBtn = el('div', 'detail-season focusable');
      seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
      var multi = item.seasons && item.seasons.length > 1;
      if (multi) {
        var arrow = el('i', 'season-arrow');
        arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
        seasonBtn.appendChild(arrow);
      } else {
        seasonBtn.classList.add('is-single');
      }
      seasonBtn._activate = function () {
        if (!multi) { return; }
        toggleSeasonPopup(seasonBtn, item);
      };
      head.appendChild(seasonBtn);
      if (episodes.length && !tvDetail) {
        head.appendChild(el('span', 'dd-count', episodes.length + (episodes.length === 1 ? ' episodio' : ' episodios')));
      }
      epSection.appendChild(head);

      if (episodes.length > DETAIL_RANGE_SIZE) {
        var rangeRow = el('div', 'detail-ranges dd-ranges');
        for (var i = 0; i < ranges.length; i++) {
          (function (idx) {
            var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                         (ranges[idx].start + 1) + '–' + ranges[idx].end);
            tab._activate = function () { selectDetailRange(idx, item); };
            rangeRow.appendChild(tab);
          })(i);
        }
        epSection.appendChild(rangeRow);
      }

      if (episodes.length) {
        var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
        /* Addon series with a picture per episode (Cinemeta has them): cards
           with the picture, the title and two lines of summary. */
        var cards = !!item._stremio && episodes.some(function (x) { return x.thumb && x.thumb !== item.backdrop && x.thumb !== item.poster; });
        /* One sideways row, with arrows like "Recomendaciones". */
        var grid = el('div', 'detail-episodes dd-grid dd-ep-row scrollable' + (cards ? ' has-cards' : ''));
        for (var e = current.start; e < current.end; e++) {
          (function (ep, index) {
            var isPlaying = tvDetail ? (!!watchedEp && String(ep.id) === watchedEp)
              : (state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep));
            var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
            tile._epIndex = index;
            var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(index + 1);
            var title = episodeDisplayTitle(item, ep, index);
            var play = el('i', 'ep-play');
            play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
            if (cards) {
              var thumb = el('div', 'ep-thumb');
              if (ep.thumb) { thumb.style.backgroundImage = 'url("' + String(sizedImageUrl(ep.thumb, 480)).replace(/"/g, '%22') + '")'; }
              thumb.appendChild(play);
              tile.appendChild(thumb);
              var cardText = el('span', 'ep-info');
              cardText.appendChild(el('span', 'ep-title', numText + '. ' + (title !== 'Episodio ' + numText ? title : 'Capítulo ' + numText)));
              var cdur = episodeDurationLabel(ep);
              if (cdur) { cardText.appendChild(el('span', 'ep-meta', cdur)); }
              if (ep.synopsis) { cardText.appendChild(el('span', 'ep-syn', ep.synopsis)); }
              cardText.appendChild(el('span', 'ep-now', 'Viendo'));
              tile.appendChild(cardText);
              tile.title = 'Capítulo ' + numText + (title ? ' · ' + title : '');
              tile._ep = ep;
              tile._activate = function () { selectDetailEpisode(item, ep); };
              grid.appendChild(tile);
              return;
            }
            tile.appendChild(el('span', 'ep-num', numText));
            var info = el('span', 'ep-info');
            /* "Episodio 7" only repeats the big number: leave it out. */
            if (title !== 'Episodio ' + numText) {
              info.appendChild(el('span', 'ep-title', title));
            } else {
              tile.classList.add('is-generic');
            }
            var dur = episodeDurationLabel(ep);
            var metaBits = [];
            if (dur) { metaBits.push(dur); }
            var lang = episodeLangTag(ep);
            if (lang) { metaBits.push(lang); }
            info.appendChild(el('span', 'ep-meta', metaBits.join(' · ')));
            info.appendChild(el('span', 'ep-now', 'Viendo'));
            tile.appendChild(info);
            tile.appendChild(play);
            tile.title = 'Episodio ' + numText + (title && title !== 'Episodio ' + numText ? ' · ' + title : '');
            tile._ep = ep;
            tile._activate = function () { playEpisode(item, ep); };
            grid.appendChild(tile);
          })(episodes[e], e);
        }
        /* The season's episodes in Spanish (home/catalog-lang.js), written
           into the cards already drawn when they arrive. */
        var seasonNow = item.seasons && item.seasons[state.detailSeason];
        var seasonNo = seasonNow ? (seasonNow.number || state.detailSeason + 1) : 1;
        localizeSeason(item, seasonNo, episodes, function (changed) {
          if (changed && grid.isConnected) { refreshEpisodeTiles(item, grid); }
        });
        /* Kitsu's anime: TMDB's pictures when the series matches for sure. */
        animeEpisodeStills(item, episodes, function (changed) {
          if (changed && grid.isConnected) { refreshEpisodeTiles(item, grid); }
        });
        var epWrap = el('div', 'dd-related-wrap dd-ep-wrap');
        epWrap.appendChild(grid);
        addDetailRowArrows(epWrap, grid, 'Capítulos anteriores', 'Más capítulos');
        epSection.appendChild(epWrap);
        /* The episode being watched in view (row opened at its place). */
        setTimeout(function () {
          var now = grid.querySelector('.detail-episode.is-playing');
          if (now && now.offsetLeft > grid.clientWidth - now.offsetWidth) { grid.scrollLeft = now.offsetLeft - 40; }
        }, 0);
      } else {
        epSection.appendChild(makeLoader('Cargando episodios…', 'is-small'));
      }
      detailBottom.appendChild(epSection);
    }

    var relSection = el('section', 'dd-section');
    relSection.appendChild(el('h2', 'dd-title detail-related', 'Recomendaciones'));
    /* A sideways row of up to 30 similar titles (same kind, shared genres),
       with arrows; the wheel keeps scrolling the page. */
    var relWrap = el('div', 'dd-related-wrap');
    var rel = el('div', 'detail-grid dd-related scrollable');
    var related = relatedTitles(item, 30);
    for (var r = 0; r < related.length; r++) {
      var cell = el('div', 'cell');
      /* (No name under it: as on the home rows; the hover card says it.) */
      cell.appendChild(makePoster(related[r], 0, 0, 190, 279, { gold: true }));
      rel.appendChild(cell);
    }
    relWrap.appendChild(rel);
    addDetailRowArrows(relWrap, rel, 'Anteriores', 'Más títulos');
    relSection.appendChild(relWrap);
    detailBottom.appendChild(relSection);
    /* TVs, a series: the screen stays still and the lower part shows one
       section at a time, the episodes first (core/focus.js
       tvDetailSectionMove swaps them for Recomendaciones and back). */
    var sectioned = platformIsTv() && isSeriesItem(item) && detailBottom.querySelectorAll('.dd-section').length > 1;
    detailBottom.classList.toggle('tv-sections', sectioned);
    detailBottom.classList.toggle('show-ep', sectioned);
    detailBottom.classList.remove('show-rel');
    detailBottom._lastEp = null;
  }

  /* New names and summaries (catalogue language) into the episode cards. */
  function refreshEpisodeTiles(item, grid) {
    var tiles = grid.querySelectorAll('.detail-episode');
    var cards = grid.classList.contains('has-cards');
    for (var i = 0; i < tiles.length; i++) {
      var ep = tiles[i]._ep;
      if (!ep) { continue; }
      var idx = tiles[i]._epIndex || 0;
      var num = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(idx + 1);
      var name = episodeDisplayTitle(item, ep, idx);
      var tNode = tiles[i].querySelector('.ep-title');
      if (tNode) { tNode.textContent = cards ? num + '. ' + (name !== 'Episodio ' + num ? name : 'Capítulo ' + num) : name; }
      var sNode = tiles[i].querySelector('.ep-syn');
      if (sNode && ep.synopsis) { sNode.textContent = ep.synopsis; }
      var thumb = tiles[i].querySelector('.ep-thumb');
      if (thumb && ep.thumb) { thumb.style.backgroundImage = 'url("' + String(sizedImageUrl(ep.thumb, 480)).replace(/"/g, '%22') + '")'; }
    }
  }

  /* PC: clicking an episode on the details screen picks it: Reproducir now
     plays it, and its sources are looked up meanwhile (kept for a while, so
     "Elegir fuente" opens with them at once). Nothing opens. TVs: OK on an
     episode plays it, as before (one press with the remote). */
  var detailEpisodeLookup = 0;
  function selectDetailEpisode(item, ep) {
    if (platformIsTv()) { playEpisode(item, ep); return; }
    state.detailEpisode = ep;
    syncDetailEpisodeHighlight(item);
    var season = item.seasons && item.seasons[state.detailSeason];
    var code = (season && season.number ? 'T' + season.number + ':' : '') + 'E' + (ep.number || '');
    var resume = resumeLabelFor(item);
    var playSpan = detailButtons ? detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span') : null;
    if (playSpan) { playSpan.textContent = resume && resume.indexOf(code) !== -1 ? resume : 'Reproducir ' + code; }
    syncStartOverButton(item);
    var status = detailButtons ? detailButtons.querySelector('.detail-ep-status') : null;
    if (!item._stremio || item._plain || !hasSourceAddons()) {
      if (status) { status.textContent = ''; }
      return;
    }
    if (!status) {
      status = el('span', 'detail-ep-status');
      status.setAttribute('aria-live', 'polite');
      detailButtons.appendChild(status);
    }
    var mine = ++detailEpisodeLookup;
    var name = 'Capítulo ' + (ep.number || '');
    status.textContent = 'Buscando fuentes del ' + name.toLowerCase() + '…';
    status.className = 'detail-ep-status is-busy';
    fetchStremioStreams(item, ep, function (groups, pending) {
      if (mine !== detailEpisodeLookup || pending) { return; }
      var count = 0;
      groups.forEach(function (g) { count += g.sources.length; });
      status.className = 'detail-ep-status' + (count ? ' is-ready' : ' is-none');
      status.textContent = count ? (name + ' · ' + count + (count === 1 ? ' fuente lista' : ' fuentes listas')) : ('Sin fuentes para el ' + name.toLowerCase());
    });
  }

  /* The two arrows of a sideways row (episodes, "Recomendaciones"): one
     page of the row per click; hidden at each end. */
  function addDetailRowArrows(wrap, strip, prevLabel, nextLabel) {
    ['prev', 'next'].forEach(function (dir) {
      var arrow = el('button', 'dd-rel-arrow is-' + dir);
      arrow.type = 'button';
      arrow.innerHTML = dir === 'prev' ? UI_ICONS.prev : UI_ICONS.next;
      arrow.setAttribute('aria-label', dir === 'prev' ? prevLabel : nextLabel);
      arrow.addEventListener('click', function (event) {
        event.stopPropagation();
        var by = Math.max(300, strip.clientWidth * 0.8) * (dir === 'prev' ? -1 : 1);
        try { strip.scrollBy({ left: by, behavior: 'smooth' }); } catch (eScroll) { strip.scrollLeft += by; }
      });
      wrap.appendChild(arrow);
    });
    function syncArrows() {
      wrap.classList.toggle('at-start', strip.scrollLeft <= 4);
      wrap.classList.toggle('at-end', strip.scrollLeft >= strip.scrollWidth - strip.clientWidth - 4);
      schedulePosterMemoryPass();
    }
    strip.addEventListener('scroll', syncArrows, { passive: true });
    wrap.addEventListener('mouseenter', syncArrows);
    setTimeout(syncArrows, 0);
  }

  function renderDetailBottom(item) {
    if (window.OPENTV_DESKTOP) { return renderDetailBottomDesktop(item); }
    var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
    var hasEpisodes = episodes.length > 0;
    var ranges = detailRanges(episodes.length);
    if (state.detailRange >= ranges.length) { state.detailRange = 0; }

    /* Season dropdown button (flChoose / llSeanson) */
    if (isSeriesItem(item)) {
      var seasonBtn = el('div', 'detail-season focusable');
      abs(seasonBtn, 80, 42, 280, 53);
      seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
      var arrow = el('img', 'season-arrow');
      arrow.src = 'assets/original/vod/ic_down_icon.png';
      arrow.alt = '▼';
      seasonBtn.appendChild(arrow);
      seasonBtn._activate = function () {
        if (!item.seasons || item.seasons.length < 2) { return; }
        toggleSeasonPopup(seasonBtn, item);
      };
      detailBottom.appendChild(seasonBtn);
    }

    /* Range tabs (1-20, 21-40...) */
    if (hasEpisodes && episodes.length > DETAIL_RANGE_SIZE) {
      var rangeRow = el('div', 'detail-ranges');
      abs(rangeRow, 398, 51, 1522, 46);
      for (var i = 0; i < ranges.length; i++) {
        (function (idx) {
          var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                       (ranges[idx].start + 1) + '-' + ranges[idx].end);
          abs(tab, idx * 160, 0, 150, 46);
          tab._activate = function () { selectDetailRange(idx, item); };
          rangeRow.appendChild(tab);
        })(i);
      }
      detailBottom.appendChild(rangeRow);
    }

    /* Episode grid */
    if (hasEpisodes) {
      var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
      var row = el('div', 'detail-episodes scrollable');
      abs(row, 80, 149, 1840, 65);
      for (var e = current.start; e < current.end; e++) {
        (function (ep, index) {
          var isPlaying = state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep);
          var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
          abs(tile, index * 160, 0, 150, 65);
          var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(e + 1);
          tile.appendChild(el('span', 'ep-num', numText));
          tile._ep = ep;
          tile._activate = function () {
            playEpisode(item, ep);
          };
          row.appendChild(tile);
        })(episodes[e], e - current.start);
      }
      detailBottom.appendChild(row);
    }

    /* mTextRelated + mGridRelated. The series layout pushes them below the
       episode selector, so the poster row is clipped by the screen edge. */
    var relatedTop = hasEpisodes ? 240 : 25;
    var gridTop = hasEpisodes ? 290 : 91;
    var heading = el('div', 'detail-related', 'Recomendaciones');
    abs(heading, 80, relatedTop, 400, 44);
    detailBottom.appendChild(heading);

    var grid = el('div', 'detail-grid scrollable');
    abs(grid, 80, gridTop, 1750, hasEpisodes ? 180 : 380);
    var seed = parseInt(item.id, 10);
    if (isNaN(seed)) {
      seed = 0;
      for (var s = 0; s < VOD.length; s++) { if (VOD[s] === item) { seed = s; break; } }
    }
    var start = (seed * 3) % Math.max(1, VOD.length - 6);
    for (var r = 0; r < 8; r++) {
      var rel = VOD[(start + r) % VOD.length];
      if (!rel) { continue; }
      var cell = el('div', 'cell');
      cell.appendChild(makePoster(rel, 0, 0, 210, 308, { gold: true }));
      cell.appendChild(el('div', 'd-name', rel.title));
      grid.appendChild(cell);
    }
    detailBottom.appendChild(grid);
  }

  /* Desktop: a two-line title leaves less room above the buttons. Give up
     whole synopsis lines (3 → 2 → 1), then the credits, so nothing is cut in
     half and "Leer más" stays visible. */
  function fitDetailLeft(syn) {
    var text = syn.querySelector('.text');
    var title = detailLeft.querySelector('.detail-title');
    function overflowing() { return detailLeft.scrollHeight > detailLeft.clientHeight + 1; }
    function fit() {
      if (!detailLeft.clientHeight || !text) { return; }
      text.style.webkitLineClamp = '';
      if (title) { title.style.fontSize = ''; }
      var rows = detailLeft.querySelectorAll('.detail-row');
      for (var r = 0; r < rows.length; r++) { rows[r].style.display = ''; }
      /* The whole title always shows: first the synopsis gives up lines, then
         Dirección / Reparto go, and only then the title gets smaller. */
      for (var lines = 2; overflowing() && lines >= 1; lines--) { text.style.webkitLineClamp = String(lines); }
      for (var k = 0; overflowing() && k < rows.length; k++) { rows[k].style.display = 'none'; }
      if (title) {
        var size = parseFloat(window.getComputedStyle(title).fontSize) || 52;
        var cut = function () { return title.scrollHeight > title.clientHeight + 2; };
        while ((overflowing() || cut()) && size > 32) { size -= 3; title.style.fontSize = size + 'px'; }
      }
    }
    setTimeout(fit, 0);
    /* Once more when the page has settled (fonts, entrance animation): the
       first pass can measure too early and leave the title too small. */
    setTimeout(function () { if (detailLeft && detailLeft.contains(syn)) { fit(); } }, 450);
  }

  /* Similar titles: same kind first, then shared genres, then the same
     home section; the catalogue order breaks ties. */
  function relatedTitles(item, max) {
    var genres = {};
    (item.genres || []).forEach(function (g) { genres[norm(g)] = true; });
    var cats = String(item.category || '').split(',');
    var series = !!isSeriesItem(item);
    var scored = [];
    for (var i = 0; i < VOD.length; i++) {
      var v = VOD[i];
      if (!v || v === item || String(v.id) === String(item.id) || !hasUsableCover(v)) { continue; }
      var score = (!!isSeriesItem(v) === series) ? 3 : 0;
      (v.genres || []).forEach(function (g) { if (genres[norm(g)]) { score += 2; } });
      var vc = String(v.category || '').split(',');
      for (var c = 0; c < vc.length; c++) { if (vc[c] && cats.indexOf(vc[c]) !== -1) { score += 1; break; } }
      scored.push({ v: v, s: score, i: i });
    }
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var out = [], seen = {};
    for (var k = 0; k < scored.length && out.length < max; k++) {
      var key = norm(scored[k].v.title);
      if (seen[key]) { continue; }
      seen[key] = true;
      out.push(scored[k].v);
    }
    return out;
  }

  /* ---- screens/search.js ----------------------------------------------------- */
  /* screens/search.js — Búsqueda: campo, teclado de TV, populares y búsqueda en los addons.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ================================================================ SEARCH */
  /* "Populares": the first titles of the addons' catalogs (their first rows
     are their popular lists). */
  function hotSearches() {
    return VOD.slice(0, 12);
  }

  function buildSearch() {
    searchKeyboard = $('search-keyboard');
    searchHot = $('search-hot');
    searchResults = $('search-results');
    searchEmpty = $('search-empty');
    searchHotGrid = $('search-hot-grid');
    searchResultGrid = $('search-result-grid');
    searchNav = $('search-nav');
    /* Rebuilt when the catalogue reloads: the key in focus is focused again. */
    var tvKeyIndex = -1;
    if (searchTvKb && state.focus && searchKeyboard.contains(state.focus)) {
      tvKeyIndex = Array.prototype.indexOf.call(searchKeyboard.querySelectorAll('.tvk-key'), state.focus);
    }
    clear(searchKeyboard); clear(searchHotGrid); clear(searchResultGrid);
    /* Result rows can extend beyond the first screen.  Mark their viewport as
       scrollable so reveal() follows D-pad focus down through every result. */
    if (searchResults) { searchResults.classList.add('scrollable'); }
    if (window.OPENTV_DESKTOP && searchHot) { searchHot.classList.add('scrollable'); }
    if (window.OPENTV_DESKTOP && searchResults && !searchStateBox) {
      /* Centered state (Buscando… / error) and a small line under the counter. */
      searchStateBox = el('div', 'search-state');
      searchResults.appendChild(searchStateBox);
      searchInlineState = el('div', 'search-inline-state');
      searchResults.appendChild(searchInlineState);
    }

    /* --- keyboard panel (layout_search_keybord_full_uni) --- */
    searchInput = el(window.OPENTV_DESKTOP ? 'input' : 'div', 'kb-edit focusable');
    if (window.OPENTV_DESKTOP) {
      searchInput.type = 'search';
      searchInput.id = 'desktop-search-input';
      searchInput.placeholder = 'Buscar películas o series';
      searchInput.setAttribute('aria-label', 'Buscar películas o series');
      searchInput.autocomplete = 'off';
      /* The system keyboard (Fire TV, Android TV) shows "Buscar" on its action key. */
      searchInput.setAttribute('enterkeyhint', 'search');
      /* Typing only edits the query. The server is asked once, on Enter or
         the Buscar button, instead of on every letter. Emptying the box
         (or its ✕) goes back to the popular titles. */
      searchInput.addEventListener('input', function (event) {
        if (event.isComposing) return;
        state.searchQuery = searchInput.value;
        if (!state.searchQuery.trim()) { clearSearchState(); renderPopularSearch(); }
        updateSearchSuggest();
      });
      searchInput.addEventListener('focus', updateSearchSuggest);
      searchInput.addEventListener('blur', function () { setTimeout(hideSearchSuggest, 120); });
      searchInput.addEventListener('compositionend', function () { state.searchQuery = searchInput.value; });
      searchInput.addEventListener('keydown', function (event) {
        if (event.isComposing) return;
        /* TV: the remote already left the field but the WebView kept it as
           the page's focus; its keys belong to the app's navigation. */
        if (platformIsTv() && state.focus !== searchInput) {
          event.preventDefault();
          event.stopPropagation();
          handleKey({ keyCode: event.keyCode, key: event.key, target: document.body, preventDefault: function () {}, stopPropagation: function () {} });
          return;
        }
        if (searchSuggestKey(event)) { event.stopPropagation(); return; }
        if (event.key === 'Enter' || event.keyCode === 13) {
          event.preventDefault();
          state.searchQuery = searchInput.value;
          if (platformIsTv()) { submitTvSearch(); return; }
          runSearch();
        }
        if (event.key === 'Escape') { searchInput.blur(); back(); }
        /* TV: the remote's up/down leave the field (to the results, the
           Buscar button…) like any other control. */
        /* (Moved here: on the Fire TV blur() does not release the field, and
           the global handler ignores keys aimed at a text field, so the
           arrow did nothing.) */
        if (platformIsTv() && (event.keyCode === 38 || event.keyCode === 40)) {
          event.preventDefault();
          event.stopPropagation();
          searchInput.blur();
          moveFocus(event.keyCode === 40 ? 'down' : 'up');
          return;
        }
        event.stopPropagation();
      });
      /* TV: the system keyboard's "Siguiente" / "Listo" may only close the
         keyboard (no Enter): searching then too. */
      searchInput.addEventListener('change', function () {
        if (!platformIsTv()) { return; }
        state.searchQuery = searchInput.value;
        if (norm(state.searchQuery.trim()) !== tvSearchedQuery) { submitTvSearch(); }
      });
      searchInput._activate = function () { searchInput.focus(); };
    } else {
      searchInput._activate = function () { /* TV keyboard field */ };
    }
    searchKeyboard.appendChild(searchInput);

    var actions = el('div', 'kb-actions');
    var actionDefs = [
      { cls: 'switch', w: 100.5 },
      { cls: 'clear', w: 100.5 },
      { cls: 'del', w: 100.5 },
      { cls: 'go', w: 120 }
    ];
    for (var a = 0; a < actionDefs.length; a++) {
      var act = el('div', 'kb-action focusable ' + actionDefs[a].cls);
      act.style.width = actionDefs[a].w + 'px';
      if (actionDefs[a].cls === 'go') {
        if (window.OPENTV_DESKTOP) {
          act.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Buscar</span>';
        } else {
          act.textContent = 'Busca';
        }
      } else {
        act.appendChild(el('div', 'ico'));
      }
      act._kind = actionDefs[a].cls;
      act._activate = (function (kind) {
        return function () {
          if (kind === 'switch') { toggleSearchNumeric(); }
          else if (kind === 'clear') { setSearchQuery(''); }
          else if (kind === 'del') { setSearchQuery(state.searchQuery.slice(0, -1)); }
          else {
            if (window.OPENTV_DESKTOP && searchInput) { state.searchQuery = searchInput.value; }
            runSearch();
          }
        };
      })(actionDefs[a].cls);
      actions.appendChild(act);
    }
    searchKeyboard.appendChild(actions);

    /* TVs: the on-screen keyboard on the left (core/tv-keyboard.js) instead
       of the text field, which opened the system keyboard over everything.
       The results on the right follow what is typed. */
    if (tvSearchKeyboardOn()) {
      searchKeyboard.classList.add('has-tvk');
      searchKeyboard.appendChild(el('div', 'tvk-title', 'Buscar'));
      searchTvKb = makeTvKeyboard({
        placeholder: 'Película, serie o actor',
        value: state.searchQuery,
        cls: 'is-search',
        onChange: onTvSearchTyped,
        doneLabel: 'Buscar',
        onDone: function () { if (String(state.searchQuery || '').trim()) { submitTvSearch(); } }
      });
      searchKeyboard.appendChild(searchTvKb.el);
      if (tvKeyIndex >= 0) {
        var again = searchTvKb.el.querySelectorAll('.tvk-key')[tvKeyIndex];
        if (again) { setFocus(again, true); }
      }
    }

    searchKeys = [];
    var rows = [
      ['A', 'Á', 'B', 'C', 'D', 'E', 'É'],
      ['F', 'G', 'H', 'I', 'Í', 'J', 'K'],
      ['L', 'M', 'N', 'Ñ', 'O', 'Ó', 'P'],
      ['Q', 'R', 'S', 'T', 'U', 'Ú', 'Ü'],
      ['V', 'W', 'X', 'Y', 'Z', ' ']
    ];
    for (var r = 0; r < rows.length; r++) {
      var row = el('div', 'kb-row');
      row.style.top = (264 + r * 88.5) + 'px';
      for (var c = 0; c < rows[r].length; c++) {
        var key = el('div', 'kb-key focusable' + (rows[r][c] === ' ' ? ' space' : ''),
          rows[r][c] === ' ' ? '' : rows[r][c]);
        key._char = rows[r][c];
        key._activate = (function (ch) {
          return function () { setSearchQuery(state.searchQuery + ch); };
        })(rows[r][c]);
        row.appendChild(key);
        searchKeys.push(key);
      }
      searchKeyboard.appendChild(row);
    }

    /* --- hot search grid (observed "Búsqueda popular", 10 portrait cells) --- */
    renderPopularSearch();

    searchResults.classList.remove('is-active');
    searchEmpty.classList.remove('is-active');
    searchHot.classList.remove('is-hidden');
    updateSearchInput();
  }

  /* ------------------------------------------------- TV on-screen keyboard */
  var searchTvKb = null;

  function tvSearchKeyboardOn() { return platformIsTv() && !!window.OPENTV_DESKTOP; }

  /* Typing only edits the text: the addons are asked once, with the Buscar
     key (searching on every letter kept a Fire TV busy). Emptying it goes
     back to the popular titles. */
  function onTvSearchTyped(text) {
    state.searchQuery = text;
    if (!text.trim()) { clearSearchState(); renderPopularSearch(); }
  }

  /* TV, the system keyboard's action key: search, close the keyboard and move
     to the first result as soon as there is one (renderDesktopSearchList). */
  var tvSearchedQuery = '';
  var tvFocusResults = false;
  function submitTvSearch() {
    tvSearchedQuery = norm(String(state.searchQuery || '').trim());
    tvFocusResults = !!tvSearchedQuery;
    try { searchInput.blur(); } catch (eBlur) { /* ignore */ }
    runSearch();
  }

  function makeSearchCell(item, index) {
    var cell = el('div', 'search-cell');
    abs(cell, (index % 5) * 246, Math.floor(index / 5) * 437, 246, 437);
    cell.appendChild(makePoster(item, 0, 0, 222, 329, { gold: true }));
    cell.appendChild(el('div', 's-name', item.title));
    return cell;
  }

  function openSearch() {
    if (isKidsProfile()) { return; }   /* no search in a kids profile */
    if (!searchKeyboard) { buildSearch(); }
    showScreen('search');
    if (!state.searchQuery) { renderPopularSearch(); }
    if (searchTvKb) { setFocus(searchTvKb.first); return; }
    setFocus(searchInput);
    if (window.OPENTV_DESKTOP) searchInput.focus();
  }

  function popularSearchItems() {
    var featured = allVodFor('destacado');
    var out = featured && featured.length ? featured.slice(0, 10) : [];
    if (!out.length) { out = hotSearches(); }
    if (!out.length) { out = VOD.slice(0, 10); }
    return out;
  }

  function renderPopularSearch() {
    if (!searchHotGrid || state.searchQuery) { return; }
    clear(searchHotGrid);
    renderRecentSearches();
    var hotItems = popularSearchItems();
    for (var h = 0; h < hotItems.length; h++) {
      searchHotGrid.appendChild(makeSearchCell(hotItems[h], h));
    }
    schedulePosterMemoryPass();
  }

  function updateSearchInput() {
    if (!searchInput) { return; }
    if (searchTvKb && searchTvKb.get() !== (state.searchQuery || '')) { searchTvKb.set(state.searchQuery || ''); }
    if (window.OPENTV_DESKTOP && searchInput.tagName === 'INPUT') {
      if (searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;
      return;
    }
    if (state.searchQuery) {
      searchInput.textContent = state.searchQuery;
      searchInput.classList.remove('is-placeholder');
    } else {
      searchInput.textContent = 'Buscar películas, series, directores y actores.';
      searchInput.classList.add('is-placeholder');
    }
  }

  function setSearchQuery(q) {
    state.searchQuery = q;
    updateSearchInput();
    runSearch();
  }

  function clearSearchState() {
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    state.searchQuery = '';
    updateSearchInput();
    if (searchResultGrid) { clear(searchResultGrid); }
    state.searchMatches = [];
    state.searchPage = 0;
    if (searchNav) { searchNav.textContent = ''; }
    if (searchResults) { searchResults.classList.remove('is-active'); }
    if (searchEmpty) { searchEmpty.classList.remove('is-active'); }
    if (searchHot) { searchHot.classList.remove('is-hidden'); }
    state.searchSeq++;
    state.searchStatus = 'done';
    state.searchRemote = null;
    if (searchRequestTimeout) { clearTimeout(searchRequestTimeout); searchRequestTimeout = null; }
    updateSearchStateUi();
  }

  function runSearch() {
    var rawQ = state.searchQuery || '';
    var q = norm(rawQ.trim());
    if (!q) {
      clearSearchState();
      return;
    }
    /* Instant local matches (0ms response) */
    var localMatches = [];
    for (var i = 0; i < VOD.length; i++) {
      var tNorm = itemNorm(VOD[i], 'title');
      var aNorm = itemNorm(VOD[i], 'alias');
      if (tNorm.indexOf(q) !== -1 || (aNorm && aNorm.indexOf(q) !== -1)) {
        localMatches.push(VOD[i]);
      }
    }
    if (window.OPENTV_DESKTOP) { runDesktopSearch(rawQ, localMatches); return; }
    renderSearchResults(localMatches);

    /* Debounced search in the addons that can search (350 ms). */
    if (state.searchTimer) { clearTimeout(state.searchTimer); }
    if (q.length >= 2) {
      var seq = ++state.searchSeq;
      state.searchTimer = setTimeout(function () {
        searchTitles(rawQ.trim(), function (found) {
          if (seq !== state.searchSeq || !found.length) { return; }
          renderSearchResults(rankSearchResults(rawQ.trim(), localMatches.concat(found)));
        });
      }, 350);
    }
  }

  /* ---- screens/search-desktop.js --------------------------------------------- */
  /* screens/search-desktop.js — Búsqueda en escritorio: estados, vista cuadrícula/lista y carga continua.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------------
     Desktop search states. The local catalogue only holds what the app has
     loaded, so 0 local matches does not mean 0 results: say "Buscando…"
     until the server answers, and only then "No hay resultados". While
     typing, keep the previous results on screen instead of blanking them.
     ------------------------------------------------------------------ */
  var searchStateBox = null, searchInlineState = null;
  var searchRequestTimeout = null;

  function runDesktopSearch(rawQ, localMatches) {
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    if (searchRequestTimeout) { clearTimeout(searchRequestTimeout); searchRequestTimeout = null; }
    var seq = ++state.searchSeq;
    var query = rawQ.trim();
    rememberRecentSearch(query);
    hideSearchSuggest();
    var addonSearch = norm(query).length >= 2;
    state.searchRemote = null;
    if (addonSearch) {
      /* The addons that can search answer (catalogs with the "search" extra). */
      state.searchStatus = 'searching';
      renderSearchResults(localMatches);
      state.searchTimer = setTimeout(function () {
        state.searchTimer = null;
        /* Results show as each addon answers, best match first (the loaded
           titles that match go into the same order). */
        searchTitles(query, function (found, finished) {
          if (seq !== state.searchSeq) { return; }
          state.searchStatus = finished ? 'done' : 'searching';
          renderSearchResults(rankSearchResults(query, localMatches.concat(found)));
        });
      }, 350);
      return;
    }
    state.searchStatus = 'done';
    renderSearchResults(localMatches);
  }

  function retrySearch() {
    runSearch();
  }

  /* ------------------------------------------------------------------
     Desktop results: one scrolling page (no "Siguiente"), grid or list
     view, 2-line titles, and the next server pages load on their own when
     the viewer scrolls near the end.
     ------------------------------------------------------------------ */
  var SEARCH_REMOTE_PAGE = 50;
  var SEARCH_VIEW_KEY = 'opentv_search_view_v1';
  var srWrap = null, srCount = null, srBody = null, srMore = null, srToggle = null;

  function getSearchView() {
    var v = safeLocalRead(SEARCH_VIEW_KEY, 'grid');
    return v === 'list' ? 'list' : 'grid';
  }

  function setSearchView(mode) {
    safeLocalWrite(SEARCH_VIEW_KEY, mode);
    var keep = searchResults ? searchResults.scrollTop : 0;
    renderDesktopSearchList();
    if (searchResults) { searchResults.scrollTop = mode === 'list' ? 0 : keep; }
  }

  function ensureDesktopSearchLayout() {
    if (srWrap) { return; }
    srWrap = el('div', 'sr-wrap');
    var head = el('div', 'sr-head');
    srCount = el('div', 'sr-count');
    head.appendChild(srCount);
    srToggle = el('div', 'sr-toggle');
    [
      { mode: 'grid', label: 'Cuadrícula', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>' },
      { mode: 'list', label: 'Lista', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="5" height="6" rx="1.5"/><rect x="10" y="5" width="11" height="2" rx="1"/><rect x="10" y="8" width="7" height="1.6" rx=".8"/><rect x="3" y="14" width="5" height="6" rx="1.5"/><rect x="10" y="15" width="11" height="2" rx="1"/><rect x="10" y="18" width="7" height="1.6" rx=".8"/></svg>' }
    ].forEach(function (v) {
      var b = el('div', 'sr-view focusable');
      b._mode = v.mode;
      b.title = 'Vista de ' + v.label.toLowerCase();
      b.innerHTML = v.icon + '<span>' + v.label + '</span>';
      b._activate = function () { setSearchView(v.mode); setFocus(b, true); };
      srToggle.appendChild(b);
    });
    head.appendChild(srToggle);
    srWrap.appendChild(head);
    if (searchInlineState) { srWrap.appendChild(searchInlineState); }
    srBody = el('div', 'sr-body');
    srWrap.appendChild(srBody);
    srMore = el('div', 'sr-more');
    srWrap.appendChild(srMore);
    searchResults.appendChild(srWrap);
    searchResults.addEventListener('scroll', maybeLoadMoreSearch);
  }

  function makeDesktopSearchCard(item) {
    var card = el('div', 'sr-card focusable');
    var art = el('div', 'sr-art');
    if (item.poster) {
      var img = document.createElement('img');
      img.className = 'sr-poster';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = item.poster;
      img.onerror = function () {
        if (window.OPENTV_DESKTOP) { markCoverBroken(item); applyGenericCover(art, item); }
        else { this.style.visibility = 'hidden'; }
      };
      art.appendChild(img);
    } else if (window.OPENTV_DESKTOP) {
      applyGenericCover(art, item);
    }
    card.appendChild(art);
    var info = el('div', 'sr-info');
    info.appendChild(el('div', 'sr-title', item.title || 'Sin título'));
    var bits = [];
    var year = String(item.year || item.releaseDate || '').match(/\d{4}/);
    if (year) { bits.push(year[0]); }
    bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
    info.appendChild(el('div', 'sr-meta', bits.join(' · ')));
    if (item.genres && item.genres.length && itemGenres(item, 3).length) {
      info.appendChild(el('div', 'sr-genres', itemGenres(item, 3).join(', ')));
    }
    /* The search answer carries no synopsis; skip the "Sin sinopsis" filler. */
    if (item.synopsis && !/^[\s—–\-]*$/.test(String(item.synopsis)) && !/^sin sinopsis/i.test(String(item.synopsis).trim())) {
      info.appendChild(el('div', 'sr-desc', String(item.synopsis)));
    }
    card.appendChild(info);
    card.title = item.title || '';
    card._item = item;
    card._activate = function () {
      if (item && item.title) {
        rememberRecentSearch(item.title);
        renderRecentSearches();
      }
      openDetail(item);
    };
    return card;
  }

  function appendSearchCards(list, offset) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < list.length; i++) {
      var raw = list[i];
      frag.appendChild(makeDesktopSearchCard(raw && raw._stremio ? raw : normalizeVod(raw, offset + i + 1)));
    }
    srBody.appendChild(frag);
  }

  function updateSearchCount() {
    if (!srCount) { return; }
    var shown = (state.searchMatches || []).length;
    srCount.textContent = shown === 1 ? '1 resultado' : (shown + ' resultados');
  }

  /* (The addons answer one page: there is nothing more to load.) */
  function updateSearchMore() {
    if (srMore) { clear(srMore); srMore.className = 'sr-more'; }
  }

  function maybeLoadMoreSearch() {}

  function renderDesktopSearchList() {
    ensureDesktopSearchLayout();
    var matches = state.searchMatches || [];
    var view = getSearchView();
    searchHot.classList.add('is-hidden');
    searchResults.classList.add('is-active');
    /* Each addon's answer re-renders the cards: a remote on one of them keeps
       its place instead of losing the focus (TV). Read before the cards are
       removed (after, the focused card was already detached and the focus
       was lost when the second addon answered). */
    var focusedIndex = -1;
    if (state.focus && state.focus.parentNode === srBody) {
      focusedIndex = Array.prototype.indexOf.call(srBody.children, state.focus);
    }
    clear(searchResultGrid);
    if (searchNav) { searchNav.textContent = ''; }
    clear(srBody);
    srBody.className = 'sr-body is-' + view;
    var views = srToggle.children;
    for (var v = 0; v < views.length; v++) { views[v].classList.toggle('is-selected', views[v]._mode === view); }
    if (!matches.length) {
      searchEmpty.classList.add('is-active');
      srWrap.hidden = true;
      updateSearchStateUi();
      return;
    }
    searchEmpty.classList.remove('is-active');
    srWrap.hidden = false;
    appendSearchCards(matches, 0);
    updateSearchCount();
    updateSearchStateUi();
    updateSearchMore();
    if (state.screen !== 'search') { return; }
    if (focusedIndex >= 0) {
      setFocus(srBody.children[Math.min(focusedIndex, srBody.children.length - 1)]);
    } else if (typeof tvFocusResults !== 'undefined' && tvFocusResults) {
      /* TV, after the keyboard's "Buscar": straight to the first result. */
      tvFocusResults = false;
      setFocus(srBody.children[0]);
    }
  }

  function updateSearchStateUi() {
    if (!searchStateBox || !searchInlineState) { return; }
    var count = (state.searchMatches || []).length;
    var status = state.searchStatus || 'done';
    clear(searchStateBox);
    clear(searchInlineState);
    searchStateBox.className = 'search-state';
    searchInlineState.className = 'search-inline-state';
    if (!count && status === 'searching') {
      searchEmpty.classList.remove('is-active');
      searchStateBox.classList.add('is-active');
      searchStateBox.appendChild(el('div', 'search-spinner'));
      searchStateBox.appendChild(el('div', 'search-state-title', 'Buscando…'));
      searchStateBox.appendChild(el('div', 'search-state-hint', 'Buscando en tus addons'));
      return;
    }
    if (!count && status === 'error') {
      searchEmpty.classList.remove('is-active');
      searchStateBox.classList.add('is-active');
      searchStateBox.appendChild(el('div', 'search-state-title', 'No se pudo completar la búsqueda'));
      searchStateBox.appendChild(el('div', 'search-state-hint', 'Tus addons no respondieron. Revisa la conexión e inténtalo otra vez.'));
      var retry = el('div', 'search-retry focusable', 'Reintentar');
      retry._activate = retrySearch;
      searchStateBox.appendChild(retry);
      return;
    }
    if (count && status === 'searching') {
      searchInlineState.classList.add('is-active');
      searchInlineState.appendChild(el('i', 'search-spinner is-small'));
      searchInlineState.appendChild(document.createTextNode('Buscando en tus addons…'));
      return;
    }
    if (count && status === 'error') {
      searchInlineState.classList.add('is-active', 'is-error');
      searchInlineState.appendChild(document.createTextNode('Algún addon no respondió. '));
      var retry2 = el('span', 'search-retry-link focusable', 'Reintentar');
      retry2._activate = retrySearch;
      searchInlineState.appendChild(retry2);
    }
  }

  var SEARCH_PAGE_SIZE = 10;

  /* TVs: at most this many results ("spi" matched 445). More cards only cost
     memory and make the way back up long; the count asks for a longer word. */
  var SEARCH_TV_MAX = 100;
  function searchCapped() { return platformIsTv() && window.OPENTV_DESKTOP; }

  function renderSearchResults(matches) {
    /* A short query can match hundreds of portal titles.  A 1 GB TV stick runs
       out of media/UI memory if every poster is inserted at once, so retain the
       complete result list in JS but render one 2-row page at a time. */
    matches = matches || [];
    if (searchCapped() && matches.length > SEARCH_TV_MAX) { matches = matches.slice(0, SEARCH_TV_MAX); }
    state.searchMatches = matches;
    state.searchPage = 0;
    renderSearchResultPage(0, -1);
  }

  function renderSearchResultPage(requestedPage, focusIndex) {
    if (window.OPENTV_DESKTOP) { renderDesktopSearchList(); return; }
    var matches = state.searchMatches || [];
    searchHot.classList.add('is-hidden');
    searchResults.classList.add('is-active');
    clear(searchResultGrid);
    if (matches.length === 0) {
      searchEmpty.classList.add('is-active');
      if (searchNav) { searchNav.textContent = ''; }
      updateSearchStateUi();
      return;
    }
    searchEmpty.classList.remove('is-active');
    updateSearchStateUi();
    var pageCount = Math.ceil(matches.length / SEARCH_PAGE_SIZE);
    var page = Math.max(0, Math.min(pageCount - 1, requestedPage || 0));
    state.searchPage = page;
    var start = page * SEARCH_PAGE_SIZE;
    var end = Math.min(matches.length, start + SEARCH_PAGE_SIZE);
    if (searchNav) {
      searchNav.textContent = 'Resultados ' + (start + 1) + '-' + end + ' de ' + matches.length +
        (pageCount > 1 ? '  ·  Página ' + (page + 1) + '/' + pageCount : '');
      if (window.OPENTV_DESKTOP && pageCount > 1) {
        function pageButton(label, next, disabled) {
          var button = el('button', 'desktop-search-page focusable', label);
          button.type = 'button';
          button.disabled = disabled;
          button._activate = function () {
            if (button.disabled) return;
            searchResults.scrollTop = 0;
            renderSearchResultPage(next, 0);
          };
          searchNav.appendChild(button);
        }
        pageButton('Anterior', page - 1, page === 0);
        pageButton('Siguiente', page + 1, page + 1 === pageCount);
      }
    }
    for (var m = start; m < end; m++) {
      var localIndex = m - start;
      var cell = makeSearchCell(normalizeVod(matches[m], m + 1), localIndex);
      var poster = cell.querySelector('.poster');
      if (poster) {
        (function (indexOnPage, column) {
          poster._onMove = function (dir) {
            if (dir === 'down' && indexOnPage >= 5 && end < matches.length) {
              renderSearchResultPage(page + 1, column);
              return true;
            }
            if (dir === 'up' && indexOnPage < 5 && start > 0) {
              renderSearchResultPage(page - 1, 5 + column);
              return true;
            }
            return false;
          };
        })(localIndex, localIndex % 5);
      }
      searchResultGrid.appendChild(cell);
    }
    searchResultGrid.style.height = '874px';
    if (focusIndex >= 0) {
      var requested = searchResultGrid.querySelectorAll('.poster.focusable')[focusIndex];
      if (!requested) { requested = firstIn(searchResultGrid); }
      if (requested) { setFocus(requested); }
    } else if (state.screen === 'search' && (closest(state.focus, '.search-hot') || closest(state.focus, '.search-results'))) {
      var f = firstIn(searchResultGrid);
      if (f) { setFocus(f); }
    }
  }

  function toggleSearchNumeric() {
    state.searchNumeric = !state.searchNumeric;
    var sw = searchKeyboard.querySelector('.kb-action.switch .ico');
    if (sw) {
      sw.style.backgroundImage = 'url(assets/original/search/' +
        (state.searchNumeric ? 'ic_vod_search_abc.png' : 'ic_vod_search_123.png') + ')';
    }
    var rows = searchKeyboard.querySelectorAll('.kb-row:not(.kb-row-num)');
    if (!state.searchNumeric) {
      for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('hidden'); }
      searchKeys.forEach(function (k) { k.classList.remove('hidden'); });
      var old = searchKeyboard.querySelectorAll('.kb-row-num');
      for (var o = 0; o < old.length; o++) { old[o].classList.add('hidden'); }
      return;
    }
    for (var r = 0; r < rows.length; r++) { rows[r].classList.add('hidden'); }
    if (!searchKeyboard.querySelector('.kb-row-num')) {
      var digits = [['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '0', ' ']];
      for (var d = 0; d < digits.length; d++) {
        var row = el('div', 'kb-row kb-row-num');
        row.style.top = (264 + d * 88.5) + 'px';
        for (var c = 0; c < digits[d].length; c++) {
          var key = el('div', 'kb-key focusable' + (digits[d][c] === ' ' ? ' space' : ''),
            digits[d][c] === ' ' ? '' : digits[d][c]);
          key._activate = (function (ch) {
            return function () { setSearchQuery(state.searchQuery + ch); };
          })(digits[d][c]);
          row.appendChild(key);
        }
        searchKeyboard.appendChild(row);
      }
    }
    var numRows = searchKeyboard.querySelectorAll('.kb-row-num');
    for (var n = 0; n < numRows.length; n++) { numRows[n].classList.remove('hidden'); }
  }

  /* ---- screens/search-suggest.js --------------------------------------------- */
  /* screens/search-suggest.js — Escritorio: sugerencias mientras se escribe y búsquedas recientes.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Suggestions come only from the catalogue already loaded in the app, so
     typing never sends anything to the server. The portal is asked once, on
     Enter or "Buscar", as before. */
  var RECENT_SEARCH_KEY = 'opentv_recent_searches_v1';
  var RECENT_SEARCH_MAX = 8;
  var SUGGEST_MAX = 7;
  var searchSuggestBox = null;
  var searchSuggestItems = [];
  var searchSuggestIndex = -1;
  var searchRecentBox = null;

  function recentSearches() {
    var list = safeLocalRead(RECENT_SEARCH_KEY, []);
    return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
  }

  function rememberRecentSearch(query) {
    var q = String(query || '').replace(/\s+/g, ' ').trim();
    if (norm(q).length < 2) { return; }
    var list = recentSearches().filter(function (x) { return norm(x) !== norm(q); });
    list.unshift(q);
    safeLocalWrite(RECENT_SEARCH_KEY, list.slice(0, RECENT_SEARCH_MAX));
  }

  function forgetRecentSearch(query) {
    safeLocalWrite(RECENT_SEARCH_KEY, recentSearches().filter(function (x) { return x !== query; }));
    renderRecentSearches();
  }

  function searchFor(query) {
    state.searchQuery = query;
    updateSearchInput();
    hideSearchSuggest();
    runSearch();
  }

  /* "Búsquedas recientes" chips above the popular titles. */
  function renderRecentSearches() {
    if (!window.OPENTV_DESKTOP || !searchHot) { return; }
    if (!searchRecentBox || searchRecentBox.parentNode !== searchHot) {
      searchRecentBox = el('div', 'search-recent');
      searchHot.insertBefore(searchRecentBox, searchHot.firstChild);
    }
    clear(searchRecentBox);
    var list = recentSearches();
    searchRecentBox.hidden = !list.length;
    if (!list.length) { return; }
    var head = el('div', 'sr-recent-head');
    head.appendChild(el('div', 'sr-recent-title', 'Búsquedas recientes'));
    var wipe = el('button', 'sr-recent-clear focusable', 'Borrar todo');
    wipe.type = 'button';
    wipe._activate = function () { safeLocalWrite(RECENT_SEARCH_KEY, []); renderRecentSearches(); setFocus(searchTvKb ? searchTvKb.first : searchInput, true); };
    head.appendChild(wipe);
    searchRecentBox.appendChild(head);
    var chips = el('div', 'sr-recent-chips');
    list.forEach(function (q) {
      var chip = el('div', 'sr-chip focusable');
      chip.innerHTML = UI_ICONS.history;
      chip.appendChild(el('span', 'sr-chip-text', q));
      var x = el('button', 'sr-chip-x');
      x.type = 'button';
      x.innerHTML = UI_ICONS.close;
      x.setAttribute('data-tip', 'Quitar');
      x.addEventListener('click', function (event) { event.stopPropagation(); forgetRecentSearch(q); });
      chip.appendChild(x);
      chip._activate = function () { searchFor(q); };
      chips.appendChild(chip);
    });
    searchRecentBox.appendChild(chips);
  }

  /* Best local matches: title start, then a word start, then anywhere. */
  function localSuggestions(raw) {
    var q = norm(String(raw || '').trim());
    if (q.length < 2) { return []; }
    var buckets = [[], [], []];
    var seen = {};
    var pool = VOD.slice();
    var srcCfg = typeof getVodSourcesConfig === 'function' ? getVodSourcesConfig() : { mode: 'auto' };
    if (srcCfg.mode !== 'external' && localProfile && localProfile.history) {
      for (var h = 0; h < localProfile.history.length; h++) {
        var hr = localProfile.history[h];
        if (hr && hr.id && hr.title && !hr.stremio && String(hr.id).indexOf('stremio:') !== 0) {
          var histItem = normalizeVod({
            id: hr.id,
            title: hr.title,
            poster: hr.poster,
            landscape: hr.landscape,
            type: hr.series ? 'teleplay' : 'movie',
            portal: true
          }, 0);
          histItem._portal = true;
          pool.push(histItem);
        }
      }
    }
    for (var i = 0; i < pool.length; i++) {
      var item = pool[i];
      var t = itemNorm(item, 'title');
      var a = itemNorm(item, 'alias');
      var key = t + '|' + (isSeriesItem(item) ? 's' : 'm');
      if (seen[key]) { continue; }
      var rank = -1;
      if (t.indexOf(q) === 0 || (a && a.indexOf(q) === 0)) { rank = 0; }
      else if (t.indexOf(' ' + q) !== -1 || (a && a.indexOf(' ' + q) !== -1)) { rank = 1; }
      else if (t.indexOf(q) !== -1 || (a && a.indexOf(q) !== -1)) { rank = 2; }
      if (rank < 0) { continue; }
      seen[key] = true;
      buckets[rank].push(item);
    }
    return buckets[0].concat(buckets[1], buckets[2]).slice(0, SUGGEST_MAX);
  }

  function ensureSearchSuggestBox() {
    /* The search screen is rebuilt when a new catalogue arrives. */
    if (searchSuggestBox && searchSuggestBox.parentNode === searchKeyboard) { return searchSuggestBox; }
    searchSuggestBox = el('div', 'search-suggest');
    /* Keep the field focused while choosing with the mouse. */
    searchSuggestBox.addEventListener('mousedown', function (event) { event.preventDefault(); });
    searchKeyboard.appendChild(searchSuggestBox);
    return searchSuggestBox;
  }

  function suggestRow(cls, iconHtml, title, meta, run) {
    var row = el('div', 'ss-item ' + cls);
    var ico = el('div', 'ss-ico');
    ico.innerHTML = iconHtml;
    row.appendChild(ico);
    var text = el('div', 'ss-text');
    text.appendChild(el('div', 'ss-title', title));
    if (meta) { text.appendChild(el('div', 'ss-meta', meta)); }
    row.appendChild(text);
    row._run = run;
    row.addEventListener('click', function () { run(); });
    row.addEventListener('mousemove', function () {
      var idx = searchSuggestItems.indexOf(row);
      if (idx !== searchSuggestIndex) { highlightSuggest(idx); }
    });
    return row;
  }

  function updateSearchSuggest() {
    if (!window.OPENTV_DESKTOP || !searchInput) { return; }
    /* TV: the system keyboard covers the suggestions; skip the work. */
    if (platformIsTv()) { return; }
    var raw = searchInput.value;
    var q = String(raw || '').trim();
    var box = ensureSearchSuggestBox();
    clear(box);
    searchSuggestItems = [];
    searchSuggestIndex = -1;
    var rows = [];
    if (!q) {
      /* Empty field: offer the recent searches. */
      recentSearches().slice(0, 6).forEach(function (r) {
        rows.push(suggestRow('is-recent', UI_ICONS.history, r, '', function () { searchFor(r); }));
      });
    } else if (norm(q).length >= 2) {
      rows.push(suggestRow('is-query', UI_ICONS.search, 'Buscar «' + q + '»', 'En todo el catálogo', function () { searchFor(q); }));
      localSuggestions(q).forEach(function (item) {
        var bits = [];
        var year = String(item.year || '').match(/\d{4}/);
        bits.push(isSeriesItem(item) ? 'Serie' : 'Película');
        if (year) { bits.push(year[0]); }
        var thumb = item.poster ? '<img alt="" src="' + String(item.poster).replace(/"/g, '&quot;') + '">' : UI_ICONS.play;
        var row = suggestRow('is-title', thumb, item.title, bits.join(' · '), function () {
          rememberRecentSearch(item.title);
          hideSearchSuggest();
          openDetail(item);
        });
        var img = row.querySelector('img');
        if (img) { img.onerror = function () { img.parentNode.innerHTML = UI_ICONS.play; }; }
        rows.push(row);
      });
    }
    if (!rows.length) { hideSearchSuggest(); return; }
    if (!q) { box.appendChild(el('div', 'ss-head', 'Búsquedas recientes')); }
    rows.forEach(function (r) { box.appendChild(r); searchSuggestItems.push(r); });
    box.classList.add('is-open');
  }

  function highlightSuggest(idx) {
    searchSuggestIndex = idx;
    for (var i = 0; i < searchSuggestItems.length; i++) {
      searchSuggestItems[i].classList.toggle('is-active', i === idx);
    }
  }

  function hideSearchSuggest() {
    if (searchSuggestBox) { searchSuggestBox.classList.remove('is-open'); }
    searchSuggestIndex = -1;
  }

  /* Arrow keys / Enter / Esc while the list is open. Returns true when the
     key was used. */
  function searchSuggestKey(event) {
    if (!searchSuggestBox || !searchSuggestBox.classList.contains('is-open') || !searchSuggestItems.length) { return false; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightSuggest((searchSuggestIndex + 1) % searchSuggestItems.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightSuggest(searchSuggestIndex <= 0 ? searchSuggestItems.length - 1 : searchSuggestIndex - 1);
      return true;
    }
    if (event.key === 'Enter' && searchSuggestIndex >= 0) {
      event.preventDefault();
      searchSuggestItems[searchSuggestIndex]._run();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      hideSearchSuggest();
      return true;
    }
    return false;
  }

  /* ---- screens/settings.js --------------------------------------------------- */
  /* screens/settings.js — Ajustes: menú, panel de reproducción y opciones.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ============================================================== SETTINGS */
  var settingsFocusTimer = null;
  function buildSettings() {
    settingsMenu = $('settings-menu');
    settingsRight = $('settings-right');
    clear(settingsMenu); clear(settingsRight);
    /* Only the entries this device has (Descargas…). */
    SETTINGS_ITEMS = settingsItemsForDevice();

    settingsItems = [];
    for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
      var item = el('div', 'settings-item focusable');
      item.innerHTML = '<span class="settings-icon">' + (SETTINGS_MENU_ICONS[SETTINGS_ITEMS[i].id] || '') + '</span>' +
        '<span class="settings-label">' + SETTINGS_ITEMS[i].label + '</span>';
      item._index = i;
      item._activate = (function (idx) {
        return function () { showSettingsPanel(idx, true); };
      })(i);
      /* TVs: resting on a menu entry shows its panel (no OK needed), like TV
         apps; holding the arrow does not build every panel on the way. */
      if (platformIsTv()) {
        item._onFocus = (function (idx) {
          return function () {
            if (settingsFocusTimer) { clearTimeout(settingsFocusTimer); }
            settingsFocusTimer = setTimeout(function () {
              settingsFocusTimer = null;
              if (state.screen === 'settings' && state.focus === settingsItems[idx]) { showSettingsPanel(idx, false); }
            }, 220);
          };
        })(i);
      }
      item._onMove = function (dir) {
        if (dir === 'right') {
          var f = firstIn(settingsRight.querySelector('.settings-panel.is-active'));
          if (f) { setFocus(f); }
          return true;
        }
        return false;
      };
      settingsMenu.appendChild(item);
      settingsItems.push(item);
    }

    settingsPanels = {};
    settingsPanels.profile = buildProfilePanel();
    settingsPanels.history = buildHistoryPanel();
    /* Ajustes: Apariencia, Reproducción and Preferencias de addons. */
    settingsPanels.playback = window.OPENTV_DESKTOP ? buildSettingsHubPanel() : buildPlaybackPanel();
    settingsPanels.sources = buildSourcesPanel();
    if (platformHas('downloads')) { settingsPanels.downloads = buildDownloadsPanel(); }
    settingsPanels.parent = buildParentPanel();
    settingsPanels.feedback = buildFeedbackPanel();
    settingsPanels.about = buildAboutPanel();

    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) { settingsRight.appendChild(settingsPanels[k]); }
    }
  }

  function openSettings() {
    if (!settingsMenu) { buildSettings(); }
    showScreen('settings');
    showSettingsPanel(0, false);
    setFocus(settingsItems[0]);
  }

  /* Opens Ajustes on one panel ('downloads', 'sources'…). */
  function openSettingsAt(id) {
    /* Phone: its own Addons screen (the canvas is hidden there). */
    if (typeof isPhone === 'function' && isPhone() && id === 'sources') {
      mobileOpen('addons');
      return;
    }
    openSettings();
    for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
      if (SETTINGS_ITEMS[i].id === id) { showSettingsPanel(i, true); setFocus(settingsItems[i]); return; }
    }
  }

  function showSettingsPanel(index, focus) {
    var activeId = (SETTINGS_ITEMS[index] && SETTINGS_ITEMS[index].id) || 'profile';
    var settingsScreen = $('screen-settings');
    if (settingsScreen) { settingsScreen.classList.toggle('is-history-view', activeId === 'history'); }
    if (activeId === 'profile' && settingsPanels.profile && settingsRight) {
      var refreshedProfile = buildProfilePanel();
      settingsRight.replaceChild(refreshedProfile, settingsPanels.profile);
      settingsPanels.profile = refreshedProfile;
    } else if (activeId === 'history' && settingsPanels.history && settingsRight) {
      var refreshedHistory = buildHistoryPanel();
      settingsRight.replaceChild(refreshedHistory, settingsPanels.history);
      settingsPanels.history = refreshedHistory;
    } else if (activeId === 'sources' && settingsPanels.sources && settingsRight) {
      var refreshedSources = buildSourcesPanel();
      settingsRight.replaceChild(refreshedSources, settingsPanels.sources);
      settingsPanels.sources = refreshedSources;
    }
    /* Descargas keeps itself up to date only while it is the panel shown. */
    if (settingsPanels.downloads) { setDownloadsPanelLive(activeId === 'downloads'); }
    for (var i = 0; i < settingsItems.length; i++) {
      settingsItems[i].classList.toggle('is-selected', i === index);
    }
    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) {
        settingsPanels[k].classList.toggle('is-active', k === activeId);
      }
    }
    if (focus) {
      var f = firstIn(settingsPanels[activeId]);
      /* Panels such as "Sobre nosotros" have no focusable control. In that
         case keep the focus on the selected menu entry instead of leaving a
         different, unrelated entry highlighted. */
      setFocus(f || settingsItems[index]);
    }
  }

  function panelBase(title) {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title', title));
    return p;
  }

  function buildPlaybackPanel() {
    var p = panelBase('Configuración global de reproducción');
    p.appendChild(el('div', 'sp-hr'));

    p.appendChild(el('div', 'sp-global-note', 'Estas preferencias se aplican automáticamente a todas las películas y series nuevas.'));
    addOptionRow(p, 198, window.OPENTV_DESKTOP ? 'Calidad' : 'Reproductor',
      window.OPENTV_DESKTOP ? ['Automática', 'Compatibilidad máxima'] : ['Normal (directo)', 'Modo fluido'],
      'streamMode', state.playback.streamMode === 'smooth' ? 1 : 0);
    addOptionRow(p, 307, 'Formato de pantalla', ['Llenar pantalla', 'Original', '16:9', '4:3'],
      'screen', state.playback.screen);
    addOptionRow(p, 416, 'Audio preferido', ['Español', 'Portugués', 'Inglés'],
      'audio', state.playback.audio);

    p.appendChild(abs(el('div', 'sp-hr'), 0, 535, 1498, 1));
    p.appendChild(el('div', 'sp-subtitle-h', 'Subtítulos'));
    var sw = el('div', 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off'));
    sw._activate = function () {
      state.playback.subtitle = !state.playback.subtitle;
      sw.className = 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off');
      saveGlobalPlayback();
      setFocus(sw);
    };
    p.appendChild(sw);

    addOptionRow(p, 680, 'Idioma', ['Español', 'Portugués', 'Inglés'],
      'subLang', state.playback.subLang);
    addOptionRow(p, 793, 'Tamaño', ['Normal', 'Grande', 'Pequeño'],
      'size', state.playback.size);
    addStyleRow(p, 906);
    return p;
  }

  function addOptionRow(panel, top, label, options, group, selected) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', label));
    for (var i = 0; i < options.length; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === selected ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      opt.appendChild(el('span', null, options[i]));
      opt._group = group;
      opt._index = i;
      opt._activate = function () {
        if (this._group === 'streamMode') {
          state.playback.streamMode = this._index === 1 ? 'smooth' : 'normal';
          /* A deliberate global choice supersedes temporary per-title
             overrides from this session. */
          smoothModeByTitle = {};
          clearCompatTitles();
          if (state.playerItem) { restoreSmoothMode(state.playerItem); }
        } else {
          state.playback[this._group] = this._index;
        }
        applyGlobalPlaybackPreferences();
        saveGlobalPlayback();
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === this._group) {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function addStyleRow(panel, top) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', 'Estilo'));
    var colors = ['#ffffff', '#f6e33f', '#ffffff'];
    for (var i = 0; i < 3; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === state.playback.style ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      var aa = el('span', null, 'Aa');
      aa.style.color = colors[i];
      if (i === 2) {
        aa.style.background = '#000000';
        aa.style.display = 'inline-block';
        aa.style.width = '94px';
        aa.style.height = '50px';
        aa.style.lineHeight = '50px';
        aa.style.fontSize = '28px';
      }
      opt.appendChild(aa);
      opt._group = 'style';
      opt._index = i;
      opt._activate = function () {
        state.playback.style = this._index;
        applyGlobalPlaybackPreferences();
        saveGlobalPlayback();
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === 'style') {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function buildProfilePanel() {
    if (window.OPENTV_DESKTOP) { return buildDesktopProfilePanel(); }
    var p = el('div', 'settings-panel account-panel');
    var avatar = el('div', 'account-avatar');
    avatar.innerHTML = SETTINGS_MENU_ICONS.profile;
    p.appendChild(avatar);
    p.appendChild(el('div', 'account-number', localProfile.id));
    p.appendChild(el('div', 'account-type', 'Perfil local de este televisor'));
    var summary = el('div', 'account-card');
    summary.appendChild(el('div', 'account-card-title', 'Tu cuenta está lista'));
    summary.appendChild(el('div', 'account-card-text', 'Las preferencias, el historial y el capítulo que estabas viendo se guardan automáticamente en este TV.'));
    p.appendChild(summary);
    var goHistory = el('div', 'account-history-btn focusable', 'Ver mi lista');
    goHistory._activate = function () { showSettingsPanel(1, true); };
    p.appendChild(goHistory);
    var privacy = el('div', 'account-card account-card-small');
    privacy.appendChild(el('div', 'account-card-title', 'Sin registro ni contraseña'));
    privacy.appendChild(el('div', 'account-card-text', 'Este perfil no envía tus datos a ningún servidor.'));
    p.appendChild(privacy);
    return p;
  }

  function timeAgo(ts) {
    if (!ts) { return ''; }
    var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) { return 'Hace un momento'; }
    if (mins < 60) { return 'Hace ' + mins + ' min'; }
    var hours = Math.round(mins / 60);
    if (hours < 24) { return 'Hace ' + hours + ' h'; }
    var days = Math.round(hours / 24);
    if (days === 1) { return 'Ayer'; }
    if (days < 30) { return 'Hace ' + days + ' días'; }
    return new Date(ts).toLocaleDateString('es');
  }

  /* ---- screens/account.js ---------------------------------------------------- */
  /* screens/account.js — Página "Mi cuenta" del escritorio: perfil local, resumen y accesos directos.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function settingsIndexOf(id) {
    for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
      if (SETTINGS_ITEMS[i].id === id) { return i; }
    }
    return 0;
  }

  function buildDesktopProfilePanel() {
    var p = el('div', 'settings-panel account-panel acc-desktop scrollable');

    var head = el('div', 'acc-head');
    var me = activeProfile();
    var avatar = el('div', 'acc-avatar is-profile');
    avatar.innerHTML = avatarSvg(me.avatar);
    var who = el('div', 'acc-who');
    var nameRow = el('div', 'acc-name', me.name);
    who.appendChild(nameRow);
    who.appendChild(el('div', 'acc-id', (me.kids ? 'Perfil infantil · ' : '') + 'Guardado solo en este equipo'));
    head.appendChild(avatar);
    head.appendChild(who);
    var headActions = el('div', 'acc-head-actions');
    [['Cambiar de perfil', function () { showProfilePicker(false); }],
     ['Editar perfil', function () { openProfileEditor(activeProfile()); }],
     ['Administrar perfiles', function () { showProfilePicker(true); }]].forEach(function (b) {
      var btn = el('div', 'acc-seg-btn focusable', b[0]);
      btn._activate = b[1];
      headActions.appendChild(btn);
    });
    head.appendChild(headActions);
    p.appendChild(head);

    /* Counted with the catalog of the current mode (automatic or Stremio),
       the same as the tabs of Mi lista. */
    var titles = libraryRecords('mylist').length;
    var favTitles = libraryRecords('favs').length;
    var watched = (localProfile.history || []).filter(function (r) {
      return r && r.id && libraryModeMatches(r.id, r.stremio);
    }).length;
    var stats = el('div', 'acc-stats');
    [[titles, titles === 1 ? 'Título en Mi lista' : 'Títulos en Mi lista'],
     [favTitles, favTitles === 1 ? 'Favorito' : 'Favoritos'],
     [watched, watched === 1 ? 'Visto recientemente' : 'Vistos recientemente']].forEach(function (s) {
      var tile = el('div', 'acc-stat');
      tile.appendChild(el('div', 'acc-stat-num', String(s[0])));
      tile.appendChild(el('div', 'acc-stat-label', s[1]));
      stats.appendChild(tile);
    });
    p.appendChild(stats);

    p.appendChild(el('div', 'acc-section', 'Accesos rápidos'));
    var actions = el('div', 'acc-actions');
    [
      { icon: UI_ICONS.mylist, title: 'Mi lista', text: 'Películas y series que guardaste', run: function () { showSettingsPanel(settingsIndexOf('history'), true); } },
      { icon: UI_ICONS.history, title: 'Historial', text: 'Sigue donde lo dejaste', run: function () { openHistoryView(); } },
      { icon: UI_ICONS.settings, title: 'Ajustes', text: 'Apariencia, reproducción y preferencias', run: function () { showSettingsPanel(settingsIndexOf('playback'), true); } }
    ].forEach(function (a) {
      var card = el('div', 'acc-action focusable');
      var ic = el('div', 'acc-action-icon');
      ic.innerHTML = a.icon;
      var tx = el('div', 'acc-action-text');
      tx.appendChild(el('div', 'acc-action-title', a.title));
      tx.appendChild(el('div', 'acc-action-sub', a.text));
      var chevron = el('div', 'acc-action-chevron');
      chevron.innerHTML = UI_ICONS.back;
      card.appendChild(ic);
      card.appendChild(tx);
      card.appendChild(chevron);
      card._activate = a.run;
      actions.appendChild(card);
    });
    p.appendChild(actions);

    /* (How your data is kept is told in Acerca de.) */
    return p;
  }

  /* Ajustes → Addons: los addons de películas y series y las listas M3U de TV
     en vivo. Diseño corto: listas y un campo para agregar. */
  function buildSourcesPanel() {
    var page = desktopSettingsPage('sd-sources scrollable', 'Addons', '');
    page.body.appendChild(buildContentSourcesSection());
    return page.panel;
  }

  /* What an installed addon offers, as short chips. */
  function addonOffers(ad) {
    if (ad.kind === 'm3u') { return 'Lista M3U'; }
    if (ad.kind === 'json') { return 'Catálogo'; }
    var names = { catalog: 'Catálogo', stream: 'Fuentes', subtitles: 'Subtítulos' };
    var out = [];
    var res = ad.resources || [];
    for (var i = 0; i < res.length; i++) {
      var label = names[res[i].name];
      if (label && out.indexOf(label) === -1) { out.push(label); }
    }
    return out.join(' · ');
  }

  function addonHas(ad, name) {
    if (ad.kind === 'm3u' || ad.kind === 'json') { return name === 'catalog'; }
    var res = ad.resources || [];
    for (var i = 0; i < res.length; i++) { if (res[i].name === name) { return true; } }
    return false;
  }

  var FX_ICONS = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  function fxIconButton(icon, tip, run, danger) {
    var b = el('div', 'fx-icon focusable' + (danger ? ' is-danger' : ''));
    b.innerHTML = icon;
    b.setAttribute('data-tip', tip);
    b.setAttribute('aria-label', tip);
    b._activate = run;
    return b;
  }

  /* Section title + optional right-side note. */
  function fxSection(title) {
    var sec = el('section', 'fx-section');
    sec.appendChild(el('h3', 'fx-title', title));
    return sec;
  }

  /* Text field + button; Enter adds too. */
  function fxAddRow(placeholder, label, run) {
    var row = el('div', 'fx-add');
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'fx-input focusable';
    input.placeholder = placeholder;
    input.spellcheck = false;
    var btn = el('div', 'fx-btn focusable', label);
    btn._activate = function () { run(input, btn); };
    input.addEventListener('keydown', function (ev) {
      ev.stopPropagation();
      if (ev.keyCode === 13) { ev.preventDefault(); btn._activate(); }
    });
    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  function fxRow(iconUrl, name, meta, actions) {
    var row = el('div', 'fx-row');
    var logo = el('div', 'fx-logo');
    if (iconUrl) {
      var img = document.createElement('img');
      img.alt = '';
      img.src = iconUrl;
      img.onerror = function () { logo.textContent = (name || '?').charAt(0).toUpperCase(); this.remove(); };
      logo.appendChild(img);
    } else {
      logo.textContent = (name || '?').charAt(0).toUpperCase();
    }
    row.appendChild(logo);
    var text = el('div', 'fx-text');
    text.appendChild(el('div', 'fx-name', name));
    if (meta) { text.appendChild(el('div', 'fx-meta', meta)); }
    row.appendChild(text);
    actions.forEach(function (a) { row.appendChild(a); });
    return row;
  }

  function buildContentSourcesSection() {
    var wrap = el('div', 'fx-wrap');
    if (platformHas('addons')) {
      wrap.appendChild(buildMoviesSourcesSection());
    }
    wrap.appendChild(buildLiveSourcesSection());
    return wrap;
  }

  /* Películas y series: the viewer's addons (catalog, sources, subtitles). */
  function buildMoviesSourcesSection() {
    var sec = fxSection('Películas y series');
    var intro = el('div', 'fx-meta', 'Los addons dan el catálogo, las fuentes para reproducir y los subtítulos.');
    var list = el('div', 'fx-list');
    var warn = el('div', 'fx-warn', '');
    var msg = el('div', 'fx-msg', '');

    function say(text, kind) { msg.textContent = text || ''; msg.className = 'fx-msg' + (kind ? ' is-' + kind : ''); }

    function paint() { renderAddons(getVodSourcesConfig()); }

    function renderAddons(cfg) {
      clear(list);
      cfg.addons.forEach(function (ad, idx) {
        var actions = [];
        if (ad.configurable && ad.baseUrl && window.desktop && window.desktop.openAddonConfig) {
          actions.push(fxIconButton(FX_ICONS.gear, 'Configurar en el navegador', function () {
            window.desktop.openAddonConfig(ad.baseUrl + '/configure');
            say('Al terminar, pega aquí la URL nueva que te dé el addon.', '');
          }));
        }
        if (idx > 0) {
          actions.push(fxIconButton(FX_ICONS.up, 'Subir (sus filas y fuentes salen antes)', function () {
            var c = getVodSourcesConfig();
            c.addons.splice(idx - 1, 0, c.addons.splice(idx, 1)[0]);
            saveVodSourcesConfig(c);
            paint();
            syncExternalVodCatalogs(function () {});
          }));
        }
        /* The app's own three (catalog and subtitles) stay: no Quitar. */
        if (isBuiltinVodAddon(ad)) {
          var tag = el('span', 'fx-tag', 'Incluido');
          tag.setAttribute('data-tip', 'Viene con la app y no se puede quitar');
          actions.push(tag);
        } else {
          actions.push(fxIconButton(FX_ICONS.remove, 'Quitar', function () {
            var c = getVodSourcesConfig();
            c.addons.splice(idx, 1);
            saveVodSourcesConfig(c);
            paint();
            syncExternalVodCatalogs(function () {});
          }, true));
        }
        list.appendChild(fxRow(ad.logo, ad.name || 'Addon', addonOffers(ad), actions));
      });
      /* What is missing, in one short line. */
      var hasCatalog = cfg.addons.some(function (ad) { return addonHas(ad, 'catalog'); });
      var hasStream = cfg.addons.some(function (ad) { return addonHas(ad, 'stream'); });
      warn.textContent = !hasCatalog ? 'Sin addon de catálogo: no hay películas ni series.'
        : (!hasStream ? 'Sin addon de fuentes: puedes ver la información, pero no reproducir.' : '');
      warn.hidden = !warn.textContent;
    }

    var add = fxAddRow('URL del addon (…/manifest.json)', 'Agregar', function (input, btn) {
      var url = (input.value || '').trim();
      if (!url) { return say('Pega la URL de un addon (compatible con Stremio).', 'err'); }
      btn.textContent = 'Agregando…';
      installVodAddon({ url: url }, function (err, count, info) {
        btn.textContent = 'Agregar';
        if (err) { return say('No se pudo agregar: ' + err, 'err'); }
        input.value = '';
        say('✔ ' + info.name + (count ? ' · ' + count + ' títulos' : ''), 'ok');
        paint();
      });
    });

    /* Recomendados: movie and series addons (live/addons-dialog.js). */
    var recommend = el('div', 'fx-btn is-ghost is-recommend focusable', 'Recomendados');
    recommend.setAttribute('data-tip', 'Addons de películas y series recomendados');
    recommend._activate = function () { openAddonsDialog('vod'); };
    add.appendChild(recommend);

    sec.appendChild(intro);
    sec.appendChild(list);
    sec.appendChild(warn);
    sec.appendChild(add);
    sec.appendChild(msg);
    paint();
    /* Addons saved with only their URL (the preinstalled ones): read their
       manifests once for the logo and what they offer. */
    refreshAddonManifests(getVodSourcesConfig(), function () { if (sec.isConnected) { paint(); } });
    return sec;
  }

  /* TV en vivo: the user's M3U lists. */
  function buildLiveSourcesSection() {
    var sec = fxSection('TV en vivo');
    var list = el('div', 'fx-list');
    var msg = el('div', 'fx-msg', '');
    function say(text, kind) { msg.textContent = text || ''; msg.className = 'fx-msg' + (kind ? ' is-' + kind : ''); }

    function render() {
      clear(list);
      getSavedAddons().forEach(function (ad, idx) {
        list.appendChild(fxRow('', ad.name || 'Lista M3U', ad.count ? ad.count + ' canales' : '', [
          fxIconButton(FX_ICONS.remove, 'Quitar', function () {
            var current = getSavedAddons();
            current.splice(idx, 1);
            saveSavedAddons(current);
            render();
            if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
          }, true)
        ]));
      });
    }

    var add = fxAddRow('URL de una lista .m3u', 'Agregar', function (input, btn) {
      var url = (input.value || '').trim();
      if (!/^https?:\/\//i.test(url)) { return say('La URL debe empezar con http:// o https://', 'err'); }
      btn.textContent = 'Agregando…';
      installAddon({ id: 'custom_' + Date.now(), name: 'Lista M3U', url: url }, function (err, count) {
        btn.textContent = 'Agregar';
        if (err) { return say('No se pudo cargar: ' + err, 'err'); }
        input.value = '';
        say('✔ ' + count + ' canales', 'ok');
        render();
        if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
      });
    });

    /* Buscar: the preloaded free lists (live/addons-dialog.js). */
    var search = el('div', 'fx-btn is-ghost is-search focusable', 'Buscar');
    search.setAttribute('data-tip', 'Listas de TV recomendadas');
    search._activate = function () { openAddonsDialog(); };
    add.appendChild(search);

    sec.appendChild(list);
    sec.appendChild(add);
    sec.appendChild(msg);
    render();
    return sec;
  }

  /* ---- screens/profiles-ui.js ------------------------------------------------ */
  /* screens/profiles-ui.js — Escritorio: "¿Quién está viendo?", editor de perfiles y copia de seguridad.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* With two or more profiles the app opens on the picker; choosing one goes
     to Inicio. Profiles are created and edited here or from Mi cuenta. */
  var profilePicker = null;
  var profilePickerOpen = false;
  var profileEditing = false;

  /* The profile window on screen (the editor over the picker), or null.
     While one is open the focus cannot go to anything behind it (core/focus.js
     setFocus): at start-up the home screen used to take the focus from the
     picker, and the remote then moved the hidden menu behind it. */
  function profileOverlayRoot() {
    if (profileEditor && profileEditor.classList.contains('is-open')) { return profileEditor; }
    if (profilePickerOpen && profilePicker) { return profilePicker; }
    return null;
  }

  /* Back while a profile window is open: the editor closes, "Administrar
     perfiles" goes back to choosing, and the picker continues with the
     profile in use. True when it was handled. Called from the keyboard
     listener (installProfiles) and from handleKey (the TV remote's Back comes
     through the Capacitor App plugin, not as a key event). */
  function profileOverlayBack() {
    if (profileEditor && profileEditor.classList.contains('is-open')) {
      if (profileEditor._close) { profileEditor._close(); }
      return true;
    }
    if (!profilePickerOpen) { return false; }
    if (profileEditing) {
      profileEditing = false;
      profilePicker.classList.remove('is-editing');
      renderProfilePicker();
    } else {
      chooseProfile(activeProfileId);
    }
    return true;
  }

  function profileTile(p, onClick) {
    var tile = el('div', 'pp-tile focusable');
    var av = el('div', 'pp-avatar');
    av.innerHTML = avatarSvg(p.avatar);
    if (p.kids) { av.appendChild(el('span', 'pp-kids', 'Kids')); }
    var edit = el('div', 'pp-edit');
    edit.innerHTML = uiSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>');
    av.appendChild(edit);
    tile.appendChild(av);
    tile.appendChild(el('div', 'pp-name', p.name));
    tile._activate = onClick;
    tile.addEventListener('click', function (event) { event.stopPropagation(); onClick(); });
    return tile;
  }

  function renderProfilePicker() {
    clear(profilePicker);
    var box = el('div', 'pp-box');
    box.appendChild(el('div', 'pp-title', profileEditing ? 'Administrar perfiles' : '¿Quién está viendo?'));
    var grid = el('div', 'pp-grid');
    profilesData.list.forEach(function (p) {
      grid.appendChild(profileTile(p, function () {
        if (profileEditing) { openProfileEditor(p); return; }
        chooseProfile(p.id);
      }));
    });
    if (profilesData.list.length < PROFILES_MAX) {
      var add = el('div', 'pp-tile is-add focusable');
      var plus = el('div', 'pp-avatar');
      plus.innerHTML = uiSvg('<path d="M12 5v14M5 12h14"/>');
      add.appendChild(plus);
      add.appendChild(el('div', 'pp-name', 'Añadir perfil'));
      add._activate = function () { openProfileEditor(null); };
      add.addEventListener('click', function (event) { event.stopPropagation(); add._activate(); });
      grid.appendChild(add);
    }
    box.appendChild(grid);
    var manage = el('button', 'pp-manage focusable' + (profileEditing ? ' is-on' : ''), profileEditing ? 'Listo' : 'Administrar perfiles');
    manage.type = 'button';
    manage._activate = function () { profileEditing = !profileEditing; profilePicker.classList.toggle('is-editing', profileEditing); renderProfilePicker(); };
    manage.addEventListener('click', function (event) { event.stopPropagation(); manage._activate(); });
    box.appendChild(manage);
    profilePicker.appendChild(box);
    var first = grid.querySelector('.pp-tile');
    if (first) { setFocus(first, true); }
  }

  function showProfilePicker(editing) {
    /* (Phones have their own "¿Quién está viendo?", mobile/mobile-app.js.) */
    if (!window.OPENTV_DESKTOP || isPhone()) { return; }
    if (!profilePicker) {
      profilePicker = el('div', 'profile-picker');
      profilePicker.setAttribute('data-no-gesture', '');
      document.body.appendChild(profilePicker);
    }
    profileEditing = !!editing;
    profilePicker.classList.toggle('is-editing', profileEditing);
    profilePickerOpen = true;
    renderProfilePicker();
    profilePicker.classList.add('is-open');
  }

  function hideProfilePicker() {
    profilePickerOpen = false;
    if (profilePicker) { profilePicker.classList.remove('is-open'); }
    var start = homeTabIndex();
    if (state.screen === 'home' && pages[TABS[start] ? TABS[start].page : 1]) {
      var f = firstIn(pages[TABS[start].page]);
      if (f) { setFocus(f, true); }
    }
  }

  function chooseProfile(id) {
    if (switchToProfile(id)) { return; }   /* reloads with that profile */
    hideProfilePicker();
  }

  /* ------------------------------------------------------------ editor */
  var profileEditor = null;
  function openProfileEditor(p) {
    var isNew = !p;
    var draft = p ? { name: p.name, avatar: p.avatar, kids: !!p.kids } : { name: '', avatar: profilesData.list.length % AVATARS.length, kids: false };
    if (!profileEditor) {
      profileEditor = el('div', 'profile-editor');
      profileEditor.setAttribute('data-no-gesture', '');
      document.body.appendChild(profileEditor);
    }
    clear(profileEditor);
    /* (scrollable: on a TV the card is taller than the screen, and the focus
       moved by the remote is scrolled into view like in any other list.) */
    var card = el('div', 'pe2-card scrollable');
    card.appendChild(el('div', 'pe2-title', isNew ? 'Añadir perfil' : 'Editar perfil'));
    var top = el('div', 'pe2-top');
    var preview = el('div', 'pe2-preview');
    preview.innerHTML = avatarSvg(draft.avatar);
    top.appendChild(preview);
    var name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 20;
    name.className = 'pe2-name focusable';
    name.placeholder = 'Nombre';
    name.value = draft.name;
    /* Remote: OK on the field opens the keyboard; up/down leave it. */
    name._activate = function () { name.focus(); };
    name.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); save(); }
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        name.blur();
        setFocus(name, true);
        moveFocus(event.key === 'ArrowDown' ? 'down' : 'up');
      }
      event.stopPropagation();
    });
    top.appendChild(name);
    card.appendChild(top);

    card.appendChild(el('div', 'pe2-label', 'Elige un avatar'));
    var grid = el('div', 'pe2-avatars');
    AVATARS.forEach(function (a, i) {
      var b = el('button', 'pe2-av focusable' + (i === draft.avatar ? ' is-selected' : ''));
      b.type = 'button';
      b.innerHTML = avatarSvg(i);
      b.addEventListener('click', function () {
        draft.avatar = i;
        preview.innerHTML = avatarSvg(i);
        var all = grid.querySelectorAll('.pe2-av');
        for (var k = 0; k < all.length; k++) { all[k].classList.toggle('is-selected', all[k] === b); }
      });
      b._activate = function () { b.click(); };
      grid.appendChild(b);
    });
    card.appendChild(grid);

    var kids = el('label', 'pe2-kids focusable');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = draft.kids;
    box.tabIndex = -1;
    kids.appendChild(box);
    kids._activate = function () { box.checked = !box.checked; };
    var kt = el('span');
    kt.appendChild(el('b', null, 'Perfil infantil'));
    kt.appendChild(el('small', null, 'Solo la sección Kids: sin TV en vivo, buscador ni contenido para adultos.'));
    kids.appendChild(kt);
    card.appendChild(kids);

    var msg = el('div', 'pe2-msg', '');
    card.appendChild(msg);
    var actions = el('div', 'pe2-actions');
    /* Buttons reachable with the remote too (focusable + _activate). */
    var ok = el('button', 'pe2-btn is-primary focusable', 'Guardar');
    ok.type = 'button';
    ok.addEventListener('click', save);
    ok._activate = save;
    var cancel = el('button', 'pe2-btn focusable', 'Cancelar');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    cancel._activate = close;
    actions.appendChild(ok);
    actions.appendChild(cancel);
    if (!isNew && profilesData.list.length > 1) {
      var del = el('button', 'pe2-btn is-danger focusable', 'Eliminar perfil');
      del.type = 'button';
      var armed = false;
      del.addEventListener('click', function () {
        if (!armed) { armed = true; del.textContent = '¿Seguro? Se borrará su historial y Mi lista'; return; }
        deleteProfile(p.id);
        close();
      });
      del._activate = function () { del.click(); };
      actions.appendChild(del);
    }
    card.appendChild(actions);
    profileEditor.appendChild(card);
    profileEditor.classList.add('is-open');
    profileEditor._close = close;
    var returnFocus = state.focus;
    /* TVs: the remote's focus starts on the name (OK opens the keyboard);
       opening the keyboard by itself covered the whole screen. */
    if (platformIsTv()) { setFocus(name, true); }
    else { setTimeout(function () { name.focus(); }, 50); }

    function save() {
      var n = String(name.value || '').replace(/\s+/g, ' ').trim();
      if (!n) { msg.textContent = 'Escribe un nombre.'; name.focus(); return; }
      for (var i = 0; i < profilesData.list.length; i++) {
        if (profilesData.list[i] !== p && profilesData.list[i].name.toLowerCase() === n.toLowerCase()) { msg.textContent = 'Ya hay un perfil con ese nombre.'; return; }
      }
      if (isNew) {
        profilesData.list.push({ id: 'p' + Date.now().toString(36), name: n, avatar: draft.avatar, kids: box.checked, createdAt: Date.now() });
      } else {
        p.name = n; p.avatar = draft.avatar; p.kids = box.checked;
      }
      profilesData.created = true;
      saveProfiles();
      close();
      if (profilePickerOpen) { renderProfilePicker(); }
      refreshProfileChrome();
      /* Changing "infantil" on the profile in use needs the app to reload. */
      if (!isNew && p.id === activeProfileId) { setTimeout(function () { location.reload(); }, 150); }
    }
    function close() {
      /* The hidden name field kept the browser's focus and swallowed every
         key afterwards (the picker could not be moved with the remote). */
      if (document.activeElement === name) { name.blur(); }
      profileEditor.classList.remove('is-open');
      if (profilePickerOpen) { renderProfilePicker(); }
      else if (returnFocus && returnFocus.isConnected) { setFocus(returnFocus, true); }
    }
  }

  function deleteProfile(id) {
    if (profilesData.list.length < 2) { return; }
    profilesData.list = profilesData.list.filter(function (x) { return x.id !== id; });
    if (id !== 'main') {
      PROFILE_SCOPED_KEYS.forEach(function (k) { try { localStorage.removeItem(k + '@' + id); } catch (eDel) { /* gone */ } });
    }
    if (profilesData.last === id) { profilesData.last = profilesData.list[0].id; }
    saveProfiles();
    if (id === activeProfileId) { switchToProfile(profilesData.list[0].id); }
  }

  /* Avatar on the top bar instead of the generic user icon. */
  function refreshProfileChrome() {
    var btn = document.querySelector('.home-notify .notify-item.personal');
    if (!btn) { return; }
    var p = activeProfile();
    var n = btn.querySelector('.n-normal');
    if (n) { n.innerHTML = avatarSvg(p.avatar); n.classList.add('is-avatar'); }
    btn.setAttribute('data-tip', p.name + ' · Mi cuenta y perfiles');
  }

  /* --------------------------------------------------------------- backup */
  var profilesBackupTimer = null;
  function profilesBackupApi() {
    return window.OPENTV_DESKTOP && window.desktop && window.desktop.backup ? window.desktop.backup : null;
  }
  function collectProfilesBackup() {
    var data = { kind: 'opentv-profiles', version: 1, savedAt: Date.now(), profiles: profilesData, values: {} };
    profilesData.list.forEach(function (p) {
      PROFILE_SCOPED_KEYS.forEach(function (k) {
        var key = p.id === 'main' ? k : k + '@' + p.id;
        var raw = null;
        try { raw = localStorage.getItem(key); } catch (eRead) { raw = null; }
        if (raw !== null) { data.values[key] = raw; }
      });
    });
    return data;
  }
  function scheduleProfilesBackup() {
    var api = profilesBackupApi();
    if (!api || profilesBackupTimer) { return; }
    profilesBackupTimer = setTimeout(function () {
      profilesBackupTimer = null;
      api.write(collectProfilesBackup()).catch(function () {});
    }, 4000);
  }

  /* A fresh install (no profiles, no history) with a backup from before:
     offer to bring it back. */
  function offerProfilesRestore(done) {
    var api = profilesBackupApi();
    var fresh = !localStorage.getItem(PROFILES_KEY) && !((localProfile.history || []).length) && !Object.keys(state.favs || {}).length;
    if (!api || !fresh) { done(false); return; }
    api.read().then(function (data) {
      if (!data || !data.profiles || !data.profiles.list || !data.values) { done(false); return; }
      var names = data.profiles.list.map(function (p) { return p.name; }).join(', ');
      var box = el('div', 'profile-restore');
      var card = el('div', 'pr-card');
      card.appendChild(el('div', 'pr-title', 'Encontramos tus perfiles'));
      card.appendChild(el('div', 'pr-text', 'Hay una copia de una instalación anterior de OpenTV con ' +
        data.profiles.list.length + (data.profiles.list.length === 1 ? ' perfil' : ' perfiles') + ' (' + names + '), con su historial y Mi lista. ¿Quieres restaurarla?'));
      var row = el('div', 'pe2-actions');
      var yes = el('button', 'pe2-btn is-primary', 'Restaurar');
      yes.type = 'button';
      var no = el('button', 'pe2-btn', 'Empezar de cero');
      no.type = 'button';
      yes.addEventListener('click', function () {
        try {
          Object.keys(data.values).forEach(function (k) {
            var key = window.opentvStorageKey ? window.opentvStorageKey(k) : k;
            localStorage.setItem(key, data.values[k]);
          });
          localStorage.setItem(PROFILES_KEY, JSON.stringify(data.profiles));
        } catch (eRestore) { /* storage full */ }
        location.reload();
      });
      no.addEventListener('click', function () { box.remove(); done(false); });
      row.appendChild(yes);
      row.appendChild(no);
      card.appendChild(row);
      box.appendChild(card);
      document.body.appendChild(box);
      done(true);
    }).catch(function () { done(false); });
  }

  /* Start-up: restore offer on a fresh install, then the picker when there
     are several profiles (once per app start). */
  function installProfiles() {
    if (!window.OPENTV_DESKTOP) { return; }
    refreshProfileChrome();
    document.addEventListener('keydown', function (event) {
      /* Back on a TV remote arrives as Escape, GoBack or Back (core/navigation.js);
         Backspace only outside a text field. */
      var inField = event.target && event.target.tagName === 'INPUT';
      var isBack = event.key === 'Escape' || event.key === 'GoBack' || event.key === 'Back' ||
        event.keyCode === 27 || (event.keyCode === 8 && !inField);
      /* (The editor's name field handles its own Escape.) */
      if (!isBack || inField) { return; }
      if (profileOverlayBack()) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    offerProfilesRestore(function (shown) {
      if (shown) { return; }
      if (profilesData.list.length > 1 && !profileChosenThisSession) { showProfilePicker(false); }
      scheduleProfilesBackup();
    });
  }

  /* ---- screens/history.js ---------------------------------------------------- */
  /* screens/history.js — Mi lista: Historial (lo que dejaste a medias), Mi lista
     (para ver después) y Mis favoritos; página en Ajustes y panel lateral (Ctrl+J).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var LIBRARY_TABS = [
    { id: 'history', label: 'Historial' },
    { id: 'mylist', label: 'Mi lista' },
    { id: 'favs', label: 'Mis favoritos' }
  ];

  var LIBRARY_EMPTY = {
    history: 'No tienes nada sin terminar. Lo que empieces a ver aparecerá aquí para seguir donde lo dejaste.',
    mylist: 'Tu lista está vacía. Pulsa el icono de Mi lista en una película o serie para guardarla y verla después.',
    favs: 'Todavía no tienes favoritos. Pulsa el corazón en una película o serie para guardarla aquí.'
  };

  /* Titles from addons (Stremio, PC) show only in that mode, the rest only in
     the automatic one: the same rule as "Seguir viendo". */
  function libraryModeMatches(id, stremio) {
    var fromAddon = !!stremio || String(id).indexOf('stremio:') === 0;
    var manual = typeof stremioModeOn === 'function' && stremioModeOn();
    return manual ? fromAddon : !fromAddon;
  }

  function historyStarted(id) {
    var list = localProfile.history || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id) && (list[i].position || 0) >= 5) { return true; }
    }
    return false;
  }

  /* What each tab lists, as history-like records (newest first):
     - history: started and not finished (a series stays until it is dropped);
     - mylist:  saved to watch later and not started yet (once started it is
                under Historial);
     - favs:    favourites (TV channels have their own list in the guide). */
  function libraryRecords(tab) {
    if (tab === 'history') {
      return (localProfile.history || []).filter(function (r) {
        if (!r || !r.id || r.hideContinue || (r.position || 0) < 5) { return false; }
        if (!r.series && r.duration && r.position / r.duration > 0.95) { return false; }
        return !!vodForHistoryRecord(r);
      });
    }
    var store = (tab === 'mylist' ? state.mylist : state.favs) || {};
    var out = [];
    for (var id in store) {
      if (!Object.prototype.hasOwnProperty.call(store, id) || !store[id] || id.indexOf('live:') === 0) { continue; }
      var snap = typeof store[id] === 'object' ? store[id] : null;
      var item = vodById(id);
      if (!item && !snap) { continue; }
      var stremio = snap ? !!snap.stremio : !!item._stremio;
      if (!libraryModeMatches(id, stremio)) { continue; }
      if (tab === 'mylist' && historyStarted(id)) { continue; }
      out.push({
        id: id,
        title: (item && item.title) || (snap && snap.title) || 'Contenido',
        poster: (item && (item.poster || item.cover)) || (snap && snap.poster) || '',
        series: item ? !!isSeriesItem(item) : !!(snap && snap.series),
        stremio: stremio,
        stremioBase: (snap && snap.stremioBase) || (item && item._stremioBase) || '',
        at: (snap && snap.at) || 0,
        saved: tab
      });
    }
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }

  /* The title behind a record, to open its details (the phone layout opens
     its own page; openHistoryRecord does the same for the other layouts). */
  function libraryItem(record) {
    var item = vodById(record.id);
    if (item) { return item; }
    if (record.stremio || String(record.id).indexOf('stremio:') === 0) { return stremioItemFromHistory(record); }
    if (record.position) { return vodForHistoryRecord(record) || null; }
    var recovered = normalizeVod({ id: record.id, title: record.title, poster: record.poster,
      type: record.series ? 'teleplay' : 'movie', portal: true }, 0);
    recovered._portal = true;
    return recovered;
  }

  /* Taking a title out of Seguir viendo / Historial forgets it completely, as
     if it had never been watched: where it was left (and the episode), the
     source and addon chosen for it and its episodes (Modo Addons), and the
     subtitles and audio details kept for this session. Mi lista and
     favourites stay. */
  function forgetWatchedTitle(id) {
    var key = String(id);
    localProfile.history = (localProfile.history || []).filter(function (h) { return String(h.id) !== key; });
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    /* Sources picked in Modo Addons: the movie's, or every episode's
       ('tt123:1:4' for the series 'tt123'). */
    var raw = key.replace(/^stremio:/, '');
    try {
      var picks = JSON.parse(localStorage.getItem(STREMIO_PICKS_KEY) || '{}') || {};
      var changed = false;
      for (var p in picks) {
        if (Object.prototype.hasOwnProperty.call(picks, p) && (p === raw || p.indexOf(raw + ':') === 0)) { delete picks[p]; changed = true; }
      }
      if (changed) { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); }
    } catch (ePicks) { /* storage off */ }
    /* This session's copies (the loaded title and its episodes). */
    var item = typeof vodById === 'function' ? vodById(key) : null;
    var targets = item ? [item].concat(item.episodes || []) : [];
    for (var t = 0; t < targets.length; t++) {
      var x = targets[t];
      if (!x) { continue; }
      x._stremioSource = null;
      x._stremioNoCopy = false;
      x._stremioRelayCopy = false;
      if (x._stremio || item._stremio) { x.subtitles = []; }
      if (x.id !== undefined) { delete mediaInfoCache[String(x.id)]; }
    }
    if (item) { delete mediaInfoCache[mediaInfoKey(item)]; delete smoothModeByTitle[smoothModeKey(item)]; }
    if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
  }

  /* "Borrar historial": every title forgotten the same way, and every source
     chosen in Modo Addons with them. */
  function forgetAllWatched() {
    var ids = (localProfile.history || []).map(function (h) { return h.id; });
    for (var i = 0; i < ids.length; i++) { forgetWatchedTitle(ids[i]); }
    localProfile.history = [];
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    try { localStorage.removeItem(STREMIO_PICKS_KEY); } catch (eAll) { /* storage off */ }
    if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
  }

  function removeLibraryRecord(tab, record) {
    if (tab === 'history') {
      forgetWatchedTitle(record.id);
      return;
    } else if (tab === 'mylist') {
      delete state.mylist[record.id];
      localProfile.mylist = state.mylist;
    } else {
      delete state.favs[record.id];
      localProfile.favs = state.favs;
    }
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  }

  function historyRecordLine(record) {
    var pos = Math.max(0, record.position || 0);
    var dur = Math.max(0, record.duration || 0);
    var pct = dur > 0 ? Math.min(100, Math.round(pos / dur * 100)) : 0;
    var left = dur > pos ? Math.max(1, Math.round((dur - pos) / 60)) : 0;
    var line = record.series
      ? ('Ep. ' + (record.episodeNumber || '?') + (left ? ' · quedan ' + left + ' min' : ''))
      : (left ? ('Quedan ' + left + ' min') : (pos ? ('Vas por ' + Math.max(1, Math.round(pos / 60)) + ' min') : ''));
    if (pct >= 95) { line = record.series ? ('Ep. ' + (record.episodeNumber || '?') + ' · terminado') : 'Terminada'; }
    return { line: line, pct: pct };
  }

  var REMOVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';

  /* ------------------------------------------------------------------
     Desktop: the same three tabs as a panel sliding in from the left (Ctrl+J),
     over the current screen; closing it returns exactly where the viewer was.
     ------------------------------------------------------------------ */
  var historyDrawerOpen = false;
  var historyDrawer = null, historyDrawerList = null, historyDrawerBackdrop = null;
  var historyDrawerTab = 'history';
  var historyDrawerReturnFocus = null;

  function buildHistoryDrawer() {
    historyDrawerBackdrop = el('div', 'history-drawer-backdrop');
    historyDrawerBackdrop.addEventListener('click', function (event) {
      event.stopPropagation();
      closeHistoryDrawer();
    });
    historyDrawer = el('aside', 'history-drawer');
    historyDrawer.setAttribute('role', 'dialog');
    historyDrawer.setAttribute('aria-label', 'Mi lista');
    var head = el('div', 'hd-head');
    var tabs = el('div', 'hd-tabs');
    LIBRARY_TABS.forEach(function (t) {
      var tab = el('div', 'hd-tab focusable', t.label);
      tab._hdTab = t.id;
      tab._activate = function () { historyDrawerTab = t.id; renderHistoryDrawer(); setFocus(tab); };
      tabs.appendChild(tab);
    });
    head.appendChild(tabs);
    var close = el('div', 'hd-close focusable');
    close.title = 'Cerrar (Esc)';
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close._activate = closeHistoryDrawer;
    head.appendChild(close);
    historyDrawer.appendChild(head);
    historyDrawerList = el('div', 'hd-list scrollable');
    historyDrawer.appendChild(historyDrawerList);
    document.body.appendChild(historyDrawerBackdrop);
    document.body.appendChild(historyDrawer);
  }

  function renderHistoryDrawer() {
    if (!historyDrawer) { return; }
    var tabs = historyDrawer.querySelectorAll('.hd-tab');
    for (var t = 0; t < tabs.length; t++) { tabs[t].classList.toggle('is-selected', tabs[t]._hdTab === historyDrawerTab); }
    clear(historyDrawerList);
    var tab = historyDrawerTab;
    var records = libraryRecords(tab);
    if (!records.length) { historyDrawerList.appendChild(el('div', 'hd-empty', LIBRARY_EMPTY[tab])); }
    records.slice(0, 30).forEach(function (record) {
      var row = el('div', 'hd-item focusable');
      var img = document.createElement('img');
      img.className = 'hd-poster';
      img.alt = '';
      img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      row.appendChild(img);
      var info = el('div', 'hd-info');
      info.appendChild(el('div', 'hd-title', record.title || 'Contenido'));
      if (tab === 'history') {
        var r = historyRecordLine(record);
        if (r.line) { info.appendChild(el('div', 'hd-sub', r.line)); }
        var bar = el('div', 'hd-bar');
        var fill = el('i');
        fill.style.width = r.pct + '%';
        bar.appendChild(fill);
        info.appendChild(bar);
        info.appendChild(el('div', 'hd-when', timeAgo(record.updatedAt)));
      } else {
        info.appendChild(el('div', 'hd-sub', record.series ? 'Serie' : 'Película'));
      }
      row.appendChild(info);
      var remove = el('div', 'hd-remove');
      remove.title = tab === 'history' ? 'Quitar del historial' : (tab === 'mylist' ? 'Quitar de Mi lista' : 'Quitar de favoritos');
      remove.innerHTML = REMOVE_SVG;
      remove.addEventListener('click', function (event) {
        event.stopPropagation();
        removeLibraryRecord(tab, record);
        renderHistoryDrawer();
      });
      row.appendChild(remove);
      row.title = (tab === 'history' ? 'Seguir viendo ' : 'Abrir ') + (record.title || '');
      row._activate = function () {
        closeHistoryDrawer(true);
        openHistoryRecord(record);
      };
      historyDrawerList.appendChild(row);
    });
    var foot = el('div', 'hd-foot');
    if (tab === 'history' && records.length) {
      var clearAll = el('div', 'hd-link focusable is-danger', 'Borrar historial');
      clearAll._activate = function () {
        if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
        forgetAllWatched();
        renderHistoryDrawer();
      };
      foot.appendChild(clearAll);
    }
    var all = el('div', 'hd-link focusable', 'Ver en pantalla completa');
    all._activate = function () {
      closeHistoryDrawer(true);
      historyViewTab = tab;
      openHistoryPage();
    };
    foot.appendChild(all);
    historyDrawerList.appendChild(foot);
  }

  function openHistoryDrawer() {
    if (state.screen === 'player' || state.screen === 'welcome') { return; }
    if (!historyDrawer) { buildHistoryDrawer(); }
    historyDrawerReturnFocus = state.focus;
    historyDrawerOpen = true;
    renderHistoryDrawer();
    historyDrawerList.scrollTop = 0;
    document.body.classList.add('is-history-drawer-open');
    var first = historyDrawerList.querySelector('.hd-item') || historyDrawer.querySelector('.hd-tab');
    if (first) { setFocus(first, true); }
  }

  function closeHistoryDrawer(navigating) {
    if (!historyDrawerOpen) { return; }
    historyDrawerOpen = false;
    document.body.classList.remove('is-history-drawer-open');
    if (!navigating && historyDrawerReturnFocus && isVisible(historyDrawerReturnFocus)) {
      setFocus(historyDrawerReturnFocus, true);
    }
    historyDrawerReturnFocus = null;
  }

  /* The "Historial" button and Ctrl+J open the side panel. */
  function openHistoryView() {
    if (window.OPENTV_DESKTOP) {
      if (historyDrawerOpen) { closeHistoryDrawer(); } else { openHistoryDrawer(); }
      return;
    }
    historyViewTab = 'history';
    openHistoryPage();
  }

  /* Full page (Ajustes → Mi lista). Callers choose historyViewTab. */
  function openHistoryPage() {
    if (state.screen === 'player') { return; }
    if (state.screen === 'welcome') { finishWelcome(); }
    if (state.screen === 'detail') {
      /* Same cleanup as leaving the detail page: stop its preview video. */
      if (seasonPopup) { closeSeasonPopup(); }
      var scr = $('screen-detail');
      if (scr) { scr.classList.remove('is-synopsis-open'); }
      if (!keepFloatingVideo()) { stopPlayerVideo(); }  /* PiP keeps playing while browsing */
      var scrPlayer = $('screen-player');
      if (scrPlayer) { scrPlayer.classList.remove('is-mini'); scrPlayer.classList.remove('is-active'); }
    }
    openSettings();
    showSettingsPanel(1, true);
  }

  /* Ajustes → Mi lista: three tabs and a grid of posters, four per row. */
  function buildHistoryPanel() {
    var p = el('div', 'settings-panel history-panel is-library');
    var tabs = el('div', 'history-tabs');
    if (!LIBRARY_EMPTY[historyViewTab]) { historyViewTab = 'history'; }
    var tabId = historyViewTab;
    LIBRARY_TABS.forEach(function (tab) {
      var tabEl = el('div', 'history-tab focusable' + (tabId === tab.id ? ' is-selected' : ''), tab.label);
      tabEl._activate = function () {
        historyViewTab = tab.id;
        showSettingsPanel(1, true);
        var again = settingsRight && settingsRight.querySelector('.history-tab.is-selected');
        if (again) { setFocus(again); }
      };
      tabs.appendChild(tabEl);
    });
    p.appendChild(tabs);
    p.appendChild(el('div', 'history-rule'));

    var records = libraryRecords(tabId);
    var total = el('div', 'history-total', tabId === 'history' ? 'Sin terminar · ' : (tabId === 'mylist' ? 'Para ver después · ' : 'Favoritos · '));
    total.appendChild(el('span', null, String(records.length)));
    if (tabId === 'history' && records.length) {
      var clearBtn = el('div', 'history-clear focusable', 'Borrar historial');
      clearBtn._activate = function () {
        if (!window.confirm('¿Borrar todo el historial de reproducción de este equipo?')) { return; }
        forgetAllWatched();
        showSettingsPanel(1, true);
      };
      total.appendChild(clearBtn);
    }
    p.appendChild(total);

    var grid = el('div', 'history-grid library-grid scrollable');
    if (!records.length) {
      grid.appendChild(el('div', 'history-grid-empty', LIBRARY_EMPTY[tabId]));
    }
    records.slice(0, 120).forEach(function (record) {
      var card = el('div', 'history-card library-card focusable');
      var art = el('div', 'library-art');
      var img = document.createElement('img');
      img.className = 'history-poster';
      img.alt = '';
      img.loading = 'lazy';
      img.src = record.poster || 'assets/original/common/bg_placehoder_vertical.png';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      art.appendChild(img);
      var sub = record.series ? 'Serie' : 'Película';
      if (tabId === 'history') {
        var r = historyRecordLine(record);
        sub = r.line || sub;
        var bar = el('div', 'history-bar library-bar');
        var fill = el('i');
        fill.style.width = Math.max(2, r.pct) + '%';
        bar.appendChild(fill);
        art.appendChild(bar);
      }
      var playIco = el('i', 'history-play');
      playIco.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
      art.appendChild(playIco);
      /* PC: remove with the mouse (on TVs the details page's toggles do it). */
      if (platformHas('mouse')) {
        var remove = el('button', 'library-remove desktop-native-control');
        remove.type = 'button';
        remove.title = tabId === 'history' ? 'Quitar del historial' : (tabId === 'mylist' ? 'Quitar de Mi lista' : 'Quitar de favoritos');
        remove.innerHTML = REMOVE_SVG;
        remove.addEventListener('click', function (event) {
          event.stopPropagation();
          removeLibraryRecord(tabId, record);
          showSettingsPanel(1, true);
        });
        art.appendChild(remove);
      }
      card.appendChild(art);
      card.appendChild(el('div', 'history-card-title', record.title || 'Contenido'));
      card.appendChild(el('div', 'history-sub', sub));
      card.title = (tabId === 'history' ? 'Seguir viendo ' : 'Abrir ') + (record.title || '');
      card._activate = function () { openHistoryRecord(record); };
      grid.appendChild(card);
    });
    p.appendChild(grid);
    return p;
  }

  /* ---- screens/settings-panels.js -------------------------------------------- */
  /* screens/settings-panels.js — Paneles de Ajustes: control parental, ayuda, actualización y acerca de.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function buildParentPanel() {
    /* (Desktop has no PIN lock and no menu entry for this panel.) */
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'pl-title', 'Configuraciones del Control Parental'));
    p.appendChild(el('div', 'pl-tip', window.OPENTV_DESKTOP ? 'Control parental no disponible en esta versión. No se aplica ningún bloqueo por PIN.' : 'Ingrese la contraseña de cuatro dígitos e ingrese viendo el programa de bloqueo.'));
    p.appendChild(el('div', 'pl-label', 'Contraseña inicial:'));
    var boxes = el('div', 'pl-boxes');
    for (var i = 0; i < 4; i++) {
      var b = el('div', 'pl-box focusable');
      if (window.OPENTV_DESKTOP) b.setAttribute('aria-disabled', 'true');
      b._activate = function () { /* numeric capture not reconstructed */ };
      boxes.appendChild(b);
      if (i < 3) { boxes.appendChild(el('div', 'pl-sep')); }
    }
    p.appendChild(boxes);
    p.appendChild(el('div', 'pl-note', ''));
    var ok = el('div', 'pl-ok focusable', 'OK');
    if (window.OPENTV_DESKTOP) ok.setAttribute('aria-disabled', 'true');
    ok._activate = function () { /* password validation not reconstructed */ };
    p.appendChild(ok);
    return p;
  }

  function buildFeedbackPanel() {
    if (window.OPENTV_DESKTOP) { return buildDesktopFeedbackPanel(); }
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'fb-title', 'Ayuda y Feedback'));
    p.appendChild(el('div', 'fb-hr'));
    p.appendChild(el('div', 'fb-contact',
      'Si tiene alguna duda, puede ponerse en contacto con nosotros a través de los siguientes medios:'));
    p.appendChild(el('div', 'fb-qr-note', 'Escanee el código QR para enviar sugerencias o comentarios.'));
    var qr = el('div', 'fb-qr');
    p.appendChild(qr);
    return p;
  }

  function buildAboutPanel() {
    if (window.OPENTV_DESKTOP) { return buildDesktopAboutPanel(); }
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title plain', 'Sobre nosotros'));
    p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));
    p.appendChild(el('div', 'sp-about-body',
      'OpenTV se dedica a ofrecer a los usuarios una amplia variedad de recursos de alta calidad. ' +
      'Aquí encontrarás miles de películas, series, animes y canales en vivo, todo reunido en un solo lugar. ' +
      'Brindamos una experiencia estable, diversa y siempre actualizada, además de contenidos gratuitos para disfrutar.'));
    var port = el('div', 'sp-about-port');
    port.appendChild(el('div', null, 'OpenTV Desktop · Windows x64'));
    port.appendChild(el('div', 'sp-about-mod', 'Desarrollado por TECHPOINT Software™'));
    p.appendChild(port);
    return p;
  }

  /* ---- screens/settings-desktop.js ------------------------------------------- */
  /* screens/settings-desktop.js — Paneles de Ajustes del escritorio: Compartir, Ayuda y Acerca de.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* One layout for every desktop settings page: a header (title + short
     description) and a column of cards. */
  function desktopSettingsPage(cls, title) {
    /* Only the title: what each option does is in its ⓘ, not under the title. */
    var p = el('div', 'settings-panel sd-page ' + (cls || ''));
    var head = el('div', 'sd-head');
    head.appendChild(el('div', 'sd-title', title));
    p.appendChild(head);
    var body = el('div', 'sd-body');
    p.appendChild(body);
    return { panel: p, body: body };
  }

  function desktopSettingsCard(icon, title, text) {
    var card = el('div', 'sd-card');
    if (icon) {
      var ic = el('div', 'sd-card-icon');
      ic.innerHTML = icon;
      card.appendChild(ic);
    }
    var tx = el('div', 'sd-card-text');
    tx.appendChild(el('div', 'sd-card-title', title));
    if (text) { tx.appendChild(el('div', 'sd-card-sub', text)); }
    card.appendChild(tx);
    return card;
  }

  function desktopSettingsButton(label, icon, run, primary) {
    var b = el('div', 'sd-btn focusable' + (primary ? ' is-primary' : ''));
    if (icon) { var i = el('span', 'sd-btn-icon'); i.innerHTML = icon; b.appendChild(i); }
    b.appendChild(el('span', null, label));
    b._activate = run;
    return b;
  }

  /* Ayuda on TVs: the remote instead of keyboard shortcuts. */
  var TV_REMOTE_KEYS = [
    ['OK', 'Abrir, elegir o pausar'],
    ['Atrás', 'Volver; en el inicio, al menú de la izquierda'],
    ['▲ ▼', 'TV en vivo: canal siguiente / anterior'],
    ['▶', 'TV en vivo: lista de canales'],
    ['◀', 'TV en vivo: último canal visto'],
    ['◀ ▶', 'Películas: atrasar / adelantar (mantén para ir más rápido)'],
    ['▼', 'Películas: audio, subtítulos y más']
  ];

  var DESKTOP_SHORTCUTS = [
    ['Espacio', 'Reproducir o pausar'],
    ['← / →', 'Retroceder o adelantar 10 s'],
    ['↓', 'Ajustes del reproductor'],
    ['Rueda del ratón', 'Volumen (sobre el vídeo)'],
    ['M', 'Silenciar'],
    ['F o F11', 'Pantalla completa'],
    ['Esc', 'Salir de pantalla completa o volver'],
    ['Alt + ←', 'Volver'],
    ['Ctrl + P', 'Ventana flotante'],
    ['G', 'Guía de canales (en TV)'],
    ['↑ / ↓', 'Canal anterior / siguiente (en TV)'],
    ['Ctrl + F', 'Buscar'],
    ['Ctrl + H', 'Inicio'],
    ['Ctrl + J', 'Historial'],
    ['Ctrl + ,', 'Ajustes'],
    ['F1', 'Esta ayuda y los atajos'],
    ['Ctrl + R o F5', 'Recargar la app']
  ];

  function buildDesktopFeedbackPanel() {
    /* Keyboard shortcuts only where there is a keyboard (the PC app); TVs get
       what each key of the remote does instead. */
    var hasKeyboard = platformHas('window');
    var page = desktopSettingsPage('sd-help sd-plain', 'Ayuda', hasKeyboard ? 'Qué hacer si algo no funciona y los atajos de teclado.'
      : 'Qué hacer si algo no funciona y cómo se usa el control remoto.');
    /* The first-launch guide, any time. */
    var guide = desktopSettingsCard(UI_ICONS.info, 'Guía de inicio', 'Cómo agregar addons para reproducir, listas de TV en vivo y elegir la mejor fuente.');
    guide.appendChild(desktopSettingsButton('Ver la guía', UI_ICONS.info, openGuide));
    page.body.appendChild(guide);
    if (window.desktop && window.desktop.openLogs) {
      var logs = desktopSettingsCard(UI_ICONS.info, 'Registro de errores',
        'La app anota en un archivo los errores y cierres inesperados (no se envía nada). Si algo falla, abre la carpeta y adjunta opentv.log al reportarlo.');
      logs.appendChild(desktopSettingsButton('Abrir carpeta del registro', UI_ICONS.folder, function () { window.desktop.openLogs(); }));
      page.body.appendChild(logs);
    }
    page.body.appendChild(desktopSettingsCard(UI_ICONS.settings, 'Si un vídeo se corta o no tiene sonido',
      'La app cambia sola al modo compatible. También puedes elegir "Compatibilidad máxima" en Ajustes del reproductor (flecha abajo).'));

    var keys = el('div', 'sd-card sd-keys');
    var kh = el('div', 'sd-keys-head');
    var ki = el('div', 'sd-card-icon');
    ki.innerHTML = hasKeyboard ? UI_ICONS.keyboard : UI_ICONS.channels;
    kh.appendChild(ki);
    kh.appendChild(el('div', 'sd-card-title', hasKeyboard ? 'Atajos de teclado' : 'Control remoto'));
    keys.appendChild(kh);
    var grid = el('div', 'sd-keys-grid');
    (hasKeyboard ? DESKTOP_SHORTCUTS : TV_REMOTE_KEYS).forEach(function (k) {
      var row = el('div', 'sd-key-row');
      row.appendChild(el('kbd', null, k[0]));
      row.appendChild(el('span', null, k[1]));
      grid.appendChild(row);
    });
    keys.appendChild(grid);
    page.body.appendChild(keys);
    return page.panel;
  }

  /* What this device is, for the version line ("Versión 1.1.0 · Windows x64"). */
  function aboutPlatformLabel(arch) {
    var n = platformName();
    if (n === 'electron') { return 'Windows ' + (arch || 'x64'); }
    if (n === 'android') { return platformIsTv() ? 'Android TV / Fire TV' : 'Android'; }
    return '';
  }

  /* Acerca de: who made it, the version, updates (PC), how your data is kept
     and, at the bottom, the credits. */
  function buildDesktopAboutPanel() {
    var page = desktopSettingsPage('sd-about sd-plain', 'Acerca de', null);
    var hero = el('div', 'sd-about-hero');
    var logo = el('img', 'sd-about-logo');
    logo.src = 'images/logo.svg';
    logo.alt = '';
    hero.appendChild(logo);
    var who = el('div', 'sd-about-who');
    who.appendChild(el('div', 'sd-about-name', 'OpenTV'));
    var platform = aboutPlatformLabel();
    var ver = el('div', 'sd-about-ver', 'Versión 1.1.0' + (platform ? ' · ' + platform : ''));
    who.appendChild(ver);
    who.appendChild(el('div', 'sd-about-tag', 'Películas, series y TV en vivo en un solo lugar.'));
    hero.appendChild(who);
    page.body.appendChild(hero);
    if (window.desktop && window.desktop.info) {
      window.desktop.info().then(function (info) {
        if (info && info.version) { ver.textContent = 'Versión ' + info.version + ' · ' + aboutPlatformLabel(info.arch); }
      }).catch(function () {});
    }
    if (updatesApi()) { page.body.appendChild(buildUpdateCard()); }
    else if (androidUpdatesOn()) { page.body.appendChild(buildAndroidUpdateCard()); }
    page.body.appendChild(desktopSettingsCard(UI_ICONS.lock, 'Sin cuentas ni contraseñas',
      'Tu lista, el historial y tus preferencias se guardan solo en este equipo; no se envían a ningún servidor.'));

    var credits = el('div', 'sd-credits');
    credits.appendChild(el('div', 'sd-credits-by', 'Hecho por TECHPOINT Software™'));
    credits.appendChild(el('div', 'sd-credits-line', '© 2026 TECHPOINT Software™ · Todos los derechos reservados'));
    /* What this version really uses (the Android one has no Electron,
       FFmpeg or torrent-stream). */
    credits.appendChild(el('div', 'sd-credits-line', platformHas('window')
      ? 'Usa Electron, HLS.js, FFmpeg y torrent-stream (código abierto; licencias en la carpeta «licenses»).'
      : (platformHas('native-player') ? 'Usa Capacitor y ExoPlayer (código abierto).'
        : (platformHas('hls-js') ? 'Usa HLS.js (código abierto).' : 'Hecho con software de código abierto.'))));
    credits.appendChild(el('div', 'sd-credits-line',
      'Tendencias con datos de TMDB. Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.'));
    page.body.appendChild(credits);
    return page.panel;
  }

  /* ---- screens/settings-hub.js ----------------------------------------------- */
  /* screens/settings-hub.js — Ajustes: una pestaña con tres subpestañas
     (Apariencia, Reproducción, Preferencias de addons). Grupos con título y
     filas anchas: el nombre a la izquierda (con ⓘ: la explicación al pasar el
     ratón) y las opciones a la derecha.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var SETTINGS_HUB_TABS = [
    { id: 'look', label: 'Apariencia' },
    { id: 'play', label: 'Reproducción' },
    { id: 'addons', label: 'Preferencias de addons' }
  ];
  var settingsHubTab = 'look';
  var SET_INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5h.01"/></svg>';

  /* ⓘ with the explanation as a tooltip (desktop/tooltip.js shows data-tip). */
  function settingsInfo(hint) {
    var i = el('span', 'set-info');
    i.innerHTML = SET_INFO_SVG;
    i.setAttribute('data-tip', hint);
    i.setAttribute('aria-label', hint);
    return i;
  }

  /* A titled block of rows. */
  function settingsGroup(parent, title) {
    var g = el('section', 'set-group');
    g.appendChild(el('h3', 'set-group-title', title));
    parent.appendChild(g);
    return g;
  }

  /* One row: the name (and ⓘ) on the left, the choices on the right. */
  function hubRow(parent, label, hint, options, current, pick) {
    var r = el('div', 'set-row');
    var name = el('div', 'set-row-name');
    name.appendChild(el('span', null, label));
    if (hint) { name.appendChild(settingsInfo(hint)); }
    r.appendChild(name);
    var seg = el('div', 'set-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    options.forEach(function (text, i) {
      var c = el('div', 'set-seg-btn focusable' + (i === current ? ' is-on' : ''), text);
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', i === current ? 'true' : 'false');
      c._activate = function () {
        pick(i);
        var all = seg.querySelectorAll('.set-seg-btn');
        for (var k = 0; k < all.length; k++) {
          all[k].classList.toggle('is-on', all[k] === c);
          all[k].setAttribute('aria-checked', all[k] === c ? 'true' : 'false');
        }
      };
      seg.appendChild(c);
    });
    r.appendChild(seg);
    parent.appendChild(r);
    return r;
  }

  function buildAppearanceSettings() {
    var box = el('div', 'set-page');
    var home = settingsGroup(box, 'Inicio');
    hubRow(home, 'Tamaño de los pósteres', 'Compacto muestra más títulos en cada fila.', ['Normal', 'Compacto'],
      catalogCompact() ? 1 : 0, function (i) { setCatalogDensity(i === 1); });
    hubRow(home, 'Idioma del catálogo', 'Títulos, sinopsis y episodios de películas y series. En español se toman de TMDB; si un título no está traducido, queda en inglés.',
      ['Español', 'Inglés'], catalogLang() === 'en' ? 1 : 0, function (i) { setCatalogLang(i === 1 ? 'en' : 'es'); });
    var perf = settingsGroup(box, 'Rendimiento');
    hubRow(perf, 'Modo ligero', platformHas('mouse')
      ? 'Quita desenfoques, animaciones y la tarjeta grande al pasar el ratón. Úsalo si los menús van lentos.'
      : 'Quita desenfoques y animaciones. Úsalo si los menús van lentos.',
      ['Apagado', 'Encendido'], liteMode() ? 1 : 0, function (i) { setLiteMode(i === 1); });
    return box;
  }

  /* The global playback preferences (same values the old panel saved). */
  function buildPlaybackSettings() {
    var box = el('div', 'set-page');
    function save() { applyGlobalPlaybackPreferences(); saveGlobalPlayback(); }
    var video = settingsGroup(box, 'Vídeo');
    hubRow(video, 'Calidad', 'Compatibilidad máxima convierte el vídeo: más estable, pero usa más CPU.',
      ['Automática', 'Compatibilidad máxima'], state.playback.streamMode === 'smooth' ? 1 : 0, function (i) {
        state.playback.streamMode = i === 1 ? 'smooth' : 'normal';
        /* A deliberate global choice supersedes this session's per-title ones. */
        smoothModeByTitle = {};
        clearCompatTitles();
        if (state.playerItem) { restoreSmoothMode(state.playerItem); }
        save();
      });
    hubRow(video, 'Formato de pantalla', '', ['Llenar', 'Original', '16:9', '4:3'], state.playback.screen,
      function (i) { state.playback.screen = i; save(); });
    var audio = settingsGroup(box, 'Audio');
    hubRow(audio, 'Idioma preferido', 'Si el archivo trae varios idiomas, empieza en este.', ['Español', 'Portugués', 'Inglés'], state.playback.audio,
      function (i) { state.playback.audio = i; save(); });
    var subs = settingsGroup(box, 'Subtítulos');
    hubRow(subs, 'Mostrar', '', ['No', 'Sí'], state.playback.subtitle ? 1 : 0,
      function (i) { state.playback.subtitle = i === 1; save(); });
    hubRow(subs, 'Idioma', '', ['Español', 'Portugués', 'Inglés'], state.playback.subLang,
      function (i) { state.playback.subLang = i; save(); });
    hubRow(subs, 'Tamaño', '', ['Normal', 'Grande', 'Pequeño'], state.playback.size,
      function (i) { state.playback.size = i; save(); });
    hubRow(subs, 'Estilo', '', ['Blanco', 'Amarillo', 'Fondo negro'], Number(state.playback.style) || 0,
      function (i) { state.playback.style = i; save(); });
    return box;
  }

  function buildSettingsHubPanel() {
    var page = desktopSettingsPage('sd-hub scrollable', 'Ajustes', '');
    var tabs = el('div', 'sd-tabs');
    tabs.setAttribute('role', 'tablist');
    var body = el('div', 'sd-tab-body');
    function show(id) {
      settingsHubTab = id;
      var all = tabs.querySelectorAll('.sd-tab');
      for (var i = 0; i < all.length; i++) {
        var on = all[i]._tab === id;
        all[i].classList.toggle('is-on', on);
        all[i].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      clear(body);
      body.appendChild(id === 'play' ? buildPlaybackSettings()
        : (id === 'addons' ? buildSourcePrefsEditor(null) : buildAppearanceSettings()));
    }
    SETTINGS_HUB_TABS.forEach(function (t) {
      var b = el('div', 'sd-tab focusable', t.label);
      b.setAttribute('role', 'tab');
      b._tab = t.id;
      b._activate = function () { show(t.id); };
      tabs.appendChild(b);
    });
    page.body.appendChild(tabs);
    page.body.appendChild(body);
    show(settingsHubTab);
    return page.panel;
  }

  /* ---- screens/guide.js ------------------------------------------------------ */
  /* screens/guide.js — Guía de inicio: cuatro pasos cortos la primera vez que se
     abre la app (y siempre desde Ajustes → Ayuda). Usa la ventana de los paneles
     de fuentes (player/stremio-sources.js), así funciona con ratón y control.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var GUIDE_SEEN_KEY = 'opentv_guide_seen_v1';

  function guideSteps() {
    var steps = [
      { title: 'Bienvenido a OpenTV', text: 'Películas, series y TV en vivo en un solo lugar. El catálogo ya viene listo para explorar.' },
      { title: 'Para reproducir', text: 'Agrega un addon de fuentes en Ajustes → Addons. Pega la dirección que termina en manifest.json.',
        action: 'Ir a Addons', run: function () { openSettingsAt('sources'); } },
      { title: 'TV en vivo', text: 'Agrega tus listas M3U o IPTV en Ajustes → Addons → TV en vivo.' },
      { title: 'La mejor fuente, sola', text: 'OpenTV elige el idioma, la calidad y la fuente más estable. Cámbialo en Ajustes → Preferencias de addons.' }
    ];
    if (platformHas('downloads')) {
      steps[3].text += ' Y descarga para ver sin internet.';
    }
    return steps;
  }

  /* After the welcome screen, once per install. */
  function maybeShowFirstRunGuide() {
    var seen = false;
    try { seen = localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (e) { seen = true; }
    if (!seen) { setTimeout(function () { if (!sourcePickerOpen) { openGuide(); } }, 600); }
  }

  function openGuide() {
    try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (e) { /* ignore */ }
    if (sourcePickerOpen) { closeSourcePicker(); }
    sourcePickerOpen = true;
    sourcePickerReturn = state.focus;
    sourcePickerSeq++;
    var steps = guideSteps();
    var index = 0;
    var root = el('div', 'source-picker');
    root.id = 'dialog-guide';
    var panel = el('div', 'srcp-panel is-notice guide-panel');
    var head = el('div', 'srcp-head');
    var title = el('div', 'srcp-title', '');
    var count = el('div', 'srcp-sub', '');
    head.appendChild(title);
    head.appendChild(count);
    panel.appendChild(head);
    var body = el('div', 'srcp-body');
    var text = el('p', 'guide-text', '');
    var dots = el('div', 'guide-dots');
    body.appendChild(text);
    body.appendChild(dots);
    panel.appendChild(body);
    var foot = el('div', 'srcp-foot');
    var skip = el('div', 'acc-seg-btn focusable', 'Omitir');
    skip._activate = closeSourcePicker;
    var right = el('div', 'srcp-foot-actions');
    var back = el('div', 'acc-seg-btn focusable', 'Anterior');
    var extra = el('div', 'acc-seg-btn focusable', '');
    var next = el('div', 'acc-seg-btn focusable is-selected', '');
    back._activate = function () { if (index > 0) { index--; paint(); } };
    next._activate = function () { if (index < steps.length - 1) { index++; paint(); } else { closeSourcePicker(); } };
    extra._activate = function () { var run = steps[index].run; closeSourcePicker(); if (run) { run(); } };
    right.appendChild(back);
    right.appendChild(extra);
    right.appendChild(next);
    foot.appendChild(skip);
    foot.appendChild(right);
    panel.appendChild(foot);
    root.appendChild(panel);
    root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
    mountOverlay(root);
    sourcePickerNode = root;

    function paint() {
      var s = steps[index];
      title.textContent = s.title;
      count.textContent = 'Paso ' + (index + 1) + ' de ' + steps.length;
      text.textContent = s.text;
      clear(dots);
      for (var i = 0; i < steps.length; i++) { dots.appendChild(el('span', 'guide-dot' + (i === index ? ' is-on' : ''))); }
      back.hidden = index === 0;
      extra.hidden = !s.action;
      extra.textContent = s.action || '';
      next.textContent = index === steps.length - 1 ? 'Empezar' : 'Siguiente';
      setFocus(next);
    }
    paint();
  }

  /* ---- screens/app-update.js ------------------------------------------------- */
  /* screens/app-update.js — Actualizaciones en Android: el servicio busca la
     última versión en GitHub, baja el APK y abre el instalador del sistema
     (appUpdate en el servicio Java). En PC lo hace desktop/updates.js.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var UPDATE_SKIP_KEY = 'opentv_update_skip_v1';
  var androidUpdate = { info: null, timer: null };

  function androidUpdatesOn() { return platformName() === 'android'; }

  /* At start: a short notice when there is a version the viewer did not skip. */
  function checkAndroidUpdateOnStart() {
    if (!androidUpdatesOn()) { return; }
    portalServiceCall('appUpdate', { action: 'check' }, function (err, info) {
      if (err || !info || !info.available) { return; }
      androidUpdate.info = info;
      var skipped = '';
      try { skipped = localStorage.getItem(UPDATE_SKIP_KEY) || ''; } catch (e) { skipped = ''; }
      if (skipped === info.latest) { return; }
      /* Never over a window that is already open (the guide, a source). */
      setTimeout(function () {
        if (sourcePickerOpen || state.screen === 'player') { return; }
        showShortNotice('Hay una versión nueva', 'OpenTV ' + info.latest + ' está lista para instalar' +
          (info.size ? ' (' + formatBytes(info.size) + ')' : '') + '.', 'Actualizar', function () {
            openSettingsAt('about');
            startAndroidUpdate(null);
          });
        try { localStorage.setItem(UPDATE_SKIP_KEY, info.latest); } catch (e) { /* ignore */ }
      }, 4000);
    }, 20000);
  }

  /* Download, then the system installer. paint(text, buttonLabel) shows the step. */
  function startAndroidUpdate(paint) {
    paint = paint || function () {};
    portalServiceCall('appUpdate', { action: 'download' }, function (err) {
      if (err) { paint('No se pudo descargar: ' + err, 'Reintentar'); return; }
      if (androidUpdate.timer) { clearInterval(androidUpdate.timer); }
      androidUpdate.timer = setInterval(function () {
        portalServiceCall('appUpdate', { action: 'status' }, function (sErr, st) {
          if (sErr || !st) { return; }
          if (st.state === 'downloading') {
            var pct = st.total ? Math.floor(st.bytes * 100 / st.total) : 0;
            paint('Descargando… ' + pct + ' %', '');
            return;
          }
          clearInterval(androidUpdate.timer);
          androidUpdate.timer = null;
          if (st.state === 'error') { paint('No se pudo descargar: ' + (st.error || 'error'), 'Reintentar'); return; }
          if (st.state === 'ready') { installAndroidUpdate(paint); }
        });
      }, 1000);
    });
  }

  function installAndroidUpdate(paint) {
    portalServiceCall('appUpdate', { action: 'install' }, function (err, res) {
      if (err) { paint(err, 'Reintentar'); return; }
      if (res && res.state === 'needs-permission') {
        paint(res.errorText || 'Permite que OpenTV instale apps (se abrió la pantalla del sistema) y vuelve a tocar Instalar.', 'Instalar');
        return;
      }
      paint('Sigue los pasos del instalador.', 'Instalar');
    });
  }

  /* Acerca de (Android): the same plain section as on PC. */
  function buildAndroidUpdateCard() {
    var card = desktopSettingsCard(UI_ICONS.retry, 'Actualizaciones', 'Busca la última versión de OpenTV.');
    var sub = card.querySelector('.sd-card-sub');
    var btn = desktopSettingsButton('Buscar actualizaciones', UI_ICONS.retry, null);
    var label = btn.querySelector('span:last-child');
    function paint(text, button) {
      if (sub) { sub.textContent = text; }
      btn.hidden = !button;
      if (button && label) { label.textContent = button; }
    }
    btn._activate = function () {
      var info = androidUpdate.info;
      if (info && info.available && label && /Actualizar|Reintentar/.test(label.textContent)) { return startAndroidUpdate(paint); }
      if (label && label.textContent === 'Instalar') { return installAndroidUpdate(paint); }
      paint('Buscando…', '');
      portalServiceCall('appUpdate', { action: 'check' }, function (err, res) {
        if (err || !res) { paint(err || 'No se pudo buscar actualizaciones.', 'Buscar actualizaciones'); return; }
        androidUpdate.info = res;
        if (!res.available) { paint('Tienes la última versión (' + (res.current || '') + ').', 'Buscar actualizaciones'); return; }
        paint('Versión ' + res.latest + ' disponible' + (res.size ? ' · ' + formatBytes(res.size) : '') + '.', 'Actualizar');
      }, 20000);
    };
    card.appendChild(btn);
    /* A download already running (from the start-up notice): show it. */
    if (androidUpdate.timer) { paint('Descargando…', ''); }
    return card;
  }

  /* ---- player/infobar.js ----------------------------------------------------- */
  /* player/infobar.js — Reproductor: tiempos, barra de progreso VOD, iconos OSD y barras de información.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ================================================================ PLAYER */
  /* The player controller hides itself after a few seconds without input.
     The constant is not exposed in the decoded resources; 5000 ms is used
     until it can be measured on the running app (WSA/Android TV). */
  var INFO_HIDE_MS = 5000;
  var osdHideTimer = null;

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function durationToSeconds(value) {
    if (typeof value === 'number') {
      return isFinite(value) && value > 0 ? (value > 100000 ? value / 1000 : value) : 0;
    }
    if (typeof value !== 'string') return 0;
    var raw = value.trim().toLowerCase().replace(/,/g, '.');
    if (!raw || /^(?:n\/a|none|null|undefined|unknown|infinity|—|-)$/.test(raw)) return 0;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return durationToSeconds(Number(raw));
    var clock = /^(\d+):(\d{1,2}(?:\.\d+)?)(?::(\d{1,2}(?:\.\d+)?))?$/.exec(raw);
    if (clock) {
      var first = Number(clock[1]), middle = Number(clock[2]);
      if (middle >= 60 || (clock[3] != null && Number(clock[3]) >= 60)) return 0;
      return clock[3] == null ? first * 60 + middle : first * 3600 + middle * 60 + Number(clock[3]);
    }
    var total = 0, found = false;
    var unit = /(\d+(?:\.\d+)?)\s*(horas?|hours?|hrs?|h|minutos?|minutes?|mins?|min|m|segundos?|seconds?|secs?|sec|seg|s)(?![a-z])/g;
    var match;
    while ((match = unit.exec(raw))) {
      var label = match[2];
      var multiplier = label.charAt(0) === 'h' ? 3600 : label.charAt(0) === 'm' ? 60 : 1;
      total += Number(match[1]) * multiplier;
      found = true;
    }
    return found && isFinite(total) && total > 0 ? total : 0;
  }

  var vodProgressInterval = null;
  function startVodProgressTicker() {
    stopVodProgressTicker();
    vodProgressInterval = setInterval(function () {
      if (state.screen === 'player' && state.playerMode === 'vod' && playerVideo && !playerVideo.paused) {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var totalDur = vodPlaybackDuration();
        updateVodProgress(cur, totalDur);
        updateSubtitleDisplay(cur);
        rememberWatchProgress(cur, totalDur);
      }
    }, 500);
  }
  function stopVodProgressTicker() {
    if (vodProgressInterval) {
      clearInterval(vodProgressInterval);
      vodProgressInterval = null;
    }
  }

  function updateVodProgress(current, duration) {
    if (!vodTimeCurrent || !vodTimeTotal || !vodSeekProgress) { return; }
    if (vodScrubbing) { current = vodScrubTime; }
    var knownDuration = window.OPENTV_DESKTOP ? vodPlaybackDuration() : durationToSeconds(duration);
    if (!knownDuration && !window.OPENTV_DESKTOP && state.playerEpisode && state.playerEpisode.duration) {
      knownDuration = durationToSeconds(state.playerEpisode.duration);
    }
    if (!knownDuration && !window.OPENTV_DESKTOP && state.playerItem && state.playerItem.duration) {
      knownDuration = durationToSeconds(state.playerItem.duration);
    }
    if (!knownDuration && !window.OPENTV_DESKTOP && playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) {
      knownDuration = playerVideo.duration;
    }
    if (!knownDuration && !window.OPENTV_DESKTOP && activeSubtitleCues && activeSubtitleCues.length) {
      var lastCue = activeSubtitleCues[activeSubtitleCues.length - 1];
      if (lastCue && lastCue.end > 0) {
        knownDuration = Math.round(lastCue.end + 60);
      }
    }

    current = Number(current) || 0;
    vodTimeCurrent.textContent = formatTime(current);

    var durationNote = $('vod-duration-note');
    if (durationNote) {
      var durationTarget = state.playerEpisode || state.playerItem;
      durationNote.hidden = !!knownDuration;
      durationNote.textContent = durationTarget && durationTarget._durationPending ?
        'Obteniendo duración… Puedes usar −10 s y +10 s.' : 'Duración no disponible. Puedes usar −10 s y +10 s.';
    }
    if (window.OPENTV_DESKTOP && !knownDuration) {
      vodTimeTotal.textContent = '--:--:--';
      vodSeekProgress.style.width = '0%';
      if (vodSeekThumb) vodSeekThumb.style.left = '0%';
      if (vodSeekBuffered) vodSeekBuffered.style.width = '0%';
      if (vodSeekbar) {
        vodSeekbar.setAttribute('aria-valuemax', '0');
        vodSeekbar.setAttribute('aria-valuenow', String(Math.floor(current)));
        vodSeekbar.setAttribute('aria-valuetext', formatTime(current) + '; duración no disponible');
      }
      return;
    }
    if (!knownDuration || knownDuration <= 0) {
      var isSeries = isSeriesItem(state.playerItem);
      knownDuration = isSeries ? 2700 : 6300;
      if (current > knownDuration) {
        knownDuration = Math.round(current * 1.15);
      }
    }

    vodTimeTotal.textContent = formatTime(knownDuration);
    var pct = Math.min(100, Math.max(0, (current / knownDuration) * 100));
    vodSeekProgress.style.width = pct.toFixed(2) + '%';
    if (window.OPENTV_DESKTOP && vodSeekbar) {
      vodSeekbar.setAttribute('aria-valuemax', String(Math.floor(vodPlaybackDuration())));
      vodSeekbar.setAttribute('aria-valuenow', String(Math.floor(current)));
      vodSeekbar.setAttribute('aria-valuetext', formatTime(current) + ' de ' + formatTime(knownDuration));
    }
    if (vodSeekThumb) {
      vodSeekThumb.style.left = pct.toFixed(2) + '%';
    }
    if (playerVideo && playerVideo.buffered && playerVideo.buffered.length > 0) {
      try {
        var bufEnd = playerVideo.buffered.end(playerVideo.buffered.length - 1);
        if (relayBaseUrl) { bufEnd += relayStartOffset; }
        var bufPct = Math.min(100, Math.max(0, (bufEnd / knownDuration) * 100));
        if (vodSeekBuffered) { vodSeekBuffered.style.width = bufPct.toFixed(2) + '%'; }
      } catch (eB) { /* ignore */ }
    }
  }


  function showOsdIcon(type) {
    if (!playerOsdIcon) { playerOsdIcon = $('player-osd-icon'); }
    if (!playerOsdIcon) { return; }
    if (osdHideTimer) { clearTimeout(osdHideTimer); osdHideTimer = null; }
    if (window.OPENTV_DESKTOP) {
      var osdIcons = { pause: UI_ICONS.pause, forward: UI_ICONS.forward, backward: UI_ICONS.rewind };
      if (!osdIcons[type]) { playerOsdIcon.classList.remove('is-active'); return; }
      playerOsdIcon.style.backgroundImage = 'none';
      playerOsdIcon.innerHTML = osdIcons[type];
      playerOsdIcon.className = 'player-osd-icon is-svg is-' + type;
      /* Force the pop animation to restart on every press. */
      void playerOsdIcon.offsetWidth;
      playerOsdIcon.classList.add('is-active');
      if (type !== 'pause') {
        osdHideTimer = setTimeout(function () { playerOsdIcon.classList.remove('is-active'); }, 700);
      }
      return;
    }
    if (type === 'pause') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_pause.png)';
      playerOsdIcon.classList.add('is-active');
    } else if (type === 'forward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_forward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else if (type === 'backward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_backward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else {
      playerOsdIcon.classList.remove('is-active');
    }
  }

  function togglePlayerPlayPause() {
    if (window.OPENTV_DESKTOP && state.playerMode === 'live' && state.screen === 'player') { toggleLivePlayPause(); return; }
    if (!playerVideo) { return; }
    if (playerVideo.paused) {
      resumePlayerPlayback();
      showOsdIcon('none');
      showInfobar();
    } else {
      try {
        playerVideo.pause();
      } catch (eP2) {}
      showOsdIcon('pause');
      showInfobar();
    }
  }

  function scheduleInfoHide() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); }
    state.infoTimer = setTimeout(function () {
      state.infoTimer = null;
      if (state.screen !== 'player' || state.channelsOpen) { return; }
      if (window.OPENTV_DESKTOP && (vodScrubbing || (playerVodInfo && playerVodInfo.matches(':hover')) || (playerInfo && playerInfo.matches(':hover')))) { scheduleInfoHide(); return; }
      hideInfobar();
    }, INFO_HIDE_MS);
  }

  function showInfobar() {
    state.infobar = true;
    if (state.playerMode === 'vod') {
      if (playerVodInfo) { playerVodInfo.classList.add('is-active'); }
      if (playerInfo) { playerInfo.classList.remove('is-active'); }
    } else {
      if (playerInfo) { playerInfo.classList.add('is-active'); }
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
    }
    scheduleInfoHide();
  }

  function hideInfobar() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
    state.infobar = false;
    if (playerInfo) { playerInfo.classList.remove('is-active'); }
    if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
  }

  function showVodInfobar() {
    showInfobar();
  }

  function hideVodInfobar() {
    hideInfobar();
  }

  /* ---- player/media-state.js ------------------------------------------------- */
  /* player/media-state.js — Reproductor: estado de audio/subtítulos/formato, preferencias globales, progreso visto y subtítulos SRT.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* --- PlaySettingView (Bottom Drawer) & SelectSubTitleAndAudioDialog Controller --- */
  var playSettingView = null;
  var dialogPlaySettings = null;
  var psvSecSelection = null;
  var psvEpisodesRow = null;
  var psvBtnConfig = null;
  var psvBtnP1 = null;
  var psvBtnP2 = null;
  var psvSecAudio = null;
  var psvSecQuality = null;
  var psvQualityRow = null;
  var psvSecAspect = null;
  var psvSecPlayer = null;
  var psvAspectRow = null;

  /* Season/episode browser (in-player). */
  var psvBtnEpisodes = null;
  var episodeBrowser = null;
  var peTitle = null, peSub = null, peSeasons = null, peSeasonsCol = null,
      peEpisodes = null, peSeasonLabel = null;

  var dpsAudioOptions = null;
  var dpsSubSwitch = null;
  var dpsRowLang = null;
  var dpsRowSize = null;
  var dpsRowStyle = null;
  var dpsRowSync = null;
  var dpsLangOptions = null;
  var dpsSizeOptions = null;
  var dpsStyleOptions = null;
  var dpsSyncOptions = null;
  var dpsBtnExit = null;
  var playerSubtitles = null;

  var playSettingViewOpen = false;
  var dialogPlaySettingsOpen = false;
  var playSettingTimer = null;
  var vodCurrentAudioTrack = 0;
  /* Once the user picks a language we stop auto-selecting the preferred one. */
  var vodAudioChosen = false;
  /* Older Starfish builds can report MEDIA_ERR_SRC_NOT_SUPPORTED while they
     apply a native audio PID.  It is not a failed movie and must never turn
     Normal (Directo) into Modo Fluido. */
  var audioTrackSwitchUntil = 0;
  var vodCurrentSubtitle = null;
  var vodSubActive = false;
  /* True once the user flips the switch or picks a language; from then on the
     default (Spanish when available) no longer overrides the choice. */
  var vodSubChosen = false;
  var subtitleSeq = 0;
  var vodSubSize = 'normal';
  var vodSubStyle = 'white';
  var vodSubOffset = 0;
  var playerCurrentAspect = 'contain';
  var lastHistorySaveAt = 0;

  function globalAspectValue() {
    var i = state.playback.screen === undefined ? 1 : Number(state.playback.screen);
    return ['cover', 'contain', '16-9', '4-3'][i] || 'contain';
  }

  function globalSubtitleSize() {
    return ['normal', 'big', 'small'][Number(state.playback.size) || 0] || 'normal';
  }

  function globalSubtitleStyle() {
    return ['white', 'yellow', 'black'][Number(state.playback.style) || 0] || 'white';
  }

  function applyGlobalPlaybackPreferences() {
    vodSubSize = globalSubtitleSize();
    vodSubStyle = globalSubtitleStyle();
    if (!vodSubChosen) { vodSubActive = !!state.playback.subtitle; }
    setPlayerAspect(globalAspectValue());
    applySubtitleStyles();
  }

  function preferredLanguageCode() {
    return ['es', 'pt', 'en'][Number(state.playback.audio) || 0] || 'es';
  }

  function preferredSubtitleCode() {
    return ['es', 'pt', 'en'][Number(state.playback.subLang) || 0] || 'es';
  }

  function languageMatchesPreference(label, code) {
    var value = String(label || code || '').toLowerCase();
    var wanted = code || 'es';
    if (wanted === 'es') {
      return /^(es|spa|esp|spn|lat|cast)|espa|latino|latin|castell/i.test(value);
    }
    if (wanted === 'pt') { return /^(pt|por)|portu/.test(value); }
    if (wanted === 'en') { return /^(en|eng|ing)|ingl/.test(value); }
    return false;
  }

  function rememberWatchProgress(current, duration, force) {
    var item = state.playerItem;
    if (!item || !item.id || current < 3) { return; }
    if (window.OPENTV_DESKTOP && resumePending(item)) { return; }
    var episode = state.playerEpisode;
    if (window.OPENTV_DESKTOP && !resumeRestarted) {
      var existing = historyRecordFor(item);
      if (existing && (existing.position || 0) >= RESUME_MIN_S && current < RESUME_MIN_S) {
        var sameTarget = !isSeriesItem(item) ||
          (episode && String(existing.episodeId) === String(episode.id));
        if (sameTarget) { return; }
      }
    }
    var now = Date.now();
    if (!force && now - lastHistorySaveAt < 10000) { return; }
    lastHistorySaveAt = now;
    var key = String(item.id);
    var seasonIdx = typeof state.playerSeasonIndex === 'number' ? state.playerSeasonIndex : (state.detailSeason || 0);
    var curSeasonObj = (item.seasons && item.seasons[seasonIdx]) || null;
    var seasonId = (curSeasonObj && curSeasonObj.id) ? String(curSeasonObj.id) : (item.seasonId ? String(item.seasonId) : key);
    var knownDur = Math.floor(vodPlaybackDuration() || durationToSeconds(duration) || (existing && existing.duration) || 0);
    var record = {
      id: key,
      title: item.title || item.name || 'Contenido',
      poster: item.poster || item.cover || '',
      landscape: item.landscape || item.backdrop || '',
      series: !!isSeriesItem(item),
      portal: !!item._portal,
      stremio: !!item._stremio,
      stremioBase: item._stremioBase || '',
      seasonId: seasonId,
      seasonIndex: seasonIdx,
      seasonNumber: (curSeasonObj && curSeasonObj.number) || '',
      episodeId: episode && episode.id ? String(episode.id) : '',
      episodeNumber: episode ? (episode.number || episode.seriesNumber || '') : '',
      position: Math.floor(current),
      duration: knownDur,
      updatedAt: now
    };
    var next = [record];
    var old = localProfile.history || [];
    var itemTitleNorm = norm(record.title || '');
    var itemSeasons = item._catalogSeasons || item.seasons || [];
    for (var i = 0; i < old.length && next.length < 30; i++) {
      var oldRec = old[i];
      if (!oldRec) { continue; }
      if (String(oldRec.id) === key) { continue; }
      if (record.series && oldRec.series) {
        if (seasonId && (String(oldRec.id) === seasonId || String(oldRec.seasonId) === seasonId)) { continue; }
        var matchedSeason = false;
        for (var s = 0; s < itemSeasons.length; s++) {
          if (String(itemSeasons[s].id) === String(oldRec.id) ||
              (oldRec.seasonId && String(itemSeasons[s].id) === String(oldRec.seasonId))) {
            matchedSeason = true;
            break;
          }
        }
        /* (Same title in the other catalog — Stremio vs integrated — is another title.) */
        var sameCatalog = !!oldRec.stremio === !!record.stremio;
        if (matchedSeason || (sameCatalog && itemTitleNorm && norm(oldRec.title || '') === itemTitleNorm)) { continue; }
      }
      next.push(oldRec);
    }
    localProfile.history = next;
    safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
    if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
    if (state.screen === 'detail' && state.detail === item && detailButtons) {
      var mainPlayBtn = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span');
      var nextLabel = resumeLabelFor(item);
      if (mainPlayBtn && nextLabel) { mainPlayBtn.textContent = nextLabel; }
      syncStartOverButton(item);
    }
  }

  var pendingHistoryRecord = null;
  function applyPendingHistoryEpisode(item) {
    var record = pendingHistoryRecord || (window.OPENTV_DESKTOP ? historyRecordFor(item) : null);
    if (!record || !item || !record.episodeId || !item.episodes || !item.episodes.length) { return; }
    var matchedRecord = historyRecordFor(item);
    if (String(record.id) !== String(item.id) && matchedRecord !== record) { return; }
    if (item.seasons && item.seasons.length > 1) {
      var wantedSeasonId = String(record.seasonId || record.id || '');
      for (var s = 0; s < item.seasons.length; s++) {
        if (String(item.seasons[s].id) === wantedSeasonId) {
          state.detailSeason = s;
          state.playerSeasonIndex = s;
          break;
        }
      }
    }
    for (var i = 0; i < item.episodes.length; i++) {
      var ep = item.episodes[i];
      var idMatch = String(ep.id) === String(record.episodeId);
      var numMatch = !idMatch && record.episodeNumber &&
        String(ep.number || ep.seriesNumber || (i + 1)) === String(record.episodeNumber);
      if (idMatch || numMatch) {
        /* Desktop: a finished episode moves on to the next one. */
        var pickIndex = (window.OPENTV_DESKTOP && recordFinished(record) && item.episodes[i + 1]) ? (i + 1) : i;
        var pick = item.episodes[pickIndex];
        state.detailEpisode = pick;
        state.playerEpisode = pick;
        state.detailRange = Math.floor(pickIndex / 20);
        state.playerEpisodeRange = Math.floor(pickIndex / 20);
        return;
      }
    }
  }

  function openHistoryRecord(record) {
    if (!record) { return; }
    /* Stremio titles (PC manual mode) come back through their addon. */
    if (record.stremio || String(record.id).indexOf('stremio:') === 0) {
      var addonItem = vodById(record.id) || stremioItemFromHistory(record);
      pendingHistoryRecord = record.position ? record : null;
      openDetail(addonItem);
      return;
    }
    for (var i = 0; i < VOD.length; i++) {
      if (String(VOD[i].id) === String(record.id)) {
        pendingHistoryRecord = record;
        openDetail(VOD[i]);
        return;
      }
    }
    /* Catalog refreshes can group seasons or replace the visible root list.
       Recover by grouped season id/title, and finally recreate a portal item
       from the durable history record so its real id can still be resolved. */
    var wantedTitle = norm(record.title || '');
    for (var v = 0; v < VOD.length; v++) {
      var candidate = VOD[v];
      var seasons = candidate._catalogSeasons || [];
      var seasonMatch = false;
      for (var s = 0; s < seasons.length; s++) {
        if (String(seasons[s].id) === String(record.id)) { seasonMatch = true; break; }
      }
      if (seasonMatch || (wantedTitle && norm(candidate.title || '') === wantedTitle)) {
        pendingHistoryRecord = record;
        openDetail(candidate);
        return;
      }
    }
    var recovered = normalizeVod({
      id: record.id,
      title: record.title,
      poster: record.poster,
      type: record.series ? 'teleplay' : 'movie',
      portal: true
    }, 0);
    recovered._portal = true;
    pendingHistoryRecord = record;
    openDetail(recovered);
  }
  var activeSubtitleCues = [];
  /* Android: a text track inside the file shown by ExoPlayer (-1 = none) and
     the line it is showing now (player/stremio-sources.js). */
  var nativeSubIndex = -1;
  var nativeCueText = '';
  /* mediaInfo payloads keyed by episode/movie content id. */
  var mediaInfoCache = {};
  var mediaInfoPending = {};
  var dialogReturnFocus = null;

  function parseTimestamp(s) {
    if (!s) return 0;
    /* "00:01:02,500" (SRT), "00:01:02.500" or "01:02.500" (WebVTT), and
       "00:01:02.500 position:10%" (VTT cue settings after the time). */
    var p = String(s).trim().split(/\s+/)[0].replace(',', '.').split(':');
    if (p.length === 3) {
      return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    }
    if (p.length === 2) { return (parseFloat(p[0]) * 60) + parseFloat(p[1]); }
    return 0;
  }

  function escapeSubtitleText(text) {
    return String(text)
      .replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>');
  }

  function parseSRT(data) {
    var cues = [];
    if (!data) return cues;
    /* Blank lines with spaces also separate cues (common in downloaded SRTs). */
    var blocks = data.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n[ \t]*\n/);
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      if (lines.length >= 2) {
        var timeLine = (lines[0].indexOf('-->') !== -1) ? lines[0] : lines[1];
        var textLines = (lines[0].indexOf('-->') !== -1) ? lines.slice(1) : lines.slice(2);
        if (timeLine && timeLine.indexOf('-->') !== -1) {
          var m = timeLine.split('-->');
          var start = parseTimestamp(m[0].trim());
          var end = parseTimestamp(m[1].trim());
          /* Subtitle files come from the network: escape everything, then
             restore only the plain formatting tags SRT files use. */
          var txt = escapeSubtitleText(textLines.join('\n')).replace(/\n/g, '<br>').trim();
          if (txt) cues.push({ start: start, end: end, text: txt });
        }
      }
    }
    return cues;
  }

  var nativeSubTrack = null;

  function syncNativeSubtitleTrack() {
    if (!playerVideo || typeof VTTCue === 'undefined') { return; }
    try {
      if (!nativeSubTrack) {
        nativeSubTrack = playerVideo.addTextTrack('subtitles', 'Subtítulos', 'es');
      }
      while (nativeSubTrack.cues && nativeSubTrack.cues.length) {
        nativeSubTrack.removeCue(nativeSubTrack.cues[0]);
      }
      if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
        nativeSubTrack.mode = 'disabled';
        return;
      }
      var offset = vodSubOffset || 0;
      for (var i = 0; i < activeSubtitleCues.length; i++) {
        var c = activeSubtitleCues[i];
        var s = Math.max(0, c.start + offset);
        var e = Math.max(s + 0.2, c.end + offset);
        var plain = String(c.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
        nativeSubTrack.addCue(new VTTCue(s, e, plain));
      }
      var inPip = typeof document.pictureInPictureElement !== 'undefined' && document.pictureInPictureElement === playerVideo;
      nativeSubTrack.mode = inPip ? 'showing' : 'hidden';
    } catch (eTrack) { /* ignore */ }
  }

  function loadSubtitleTrack(sub, attempt) {
    /* The same track of the file already on: nothing to restart. */
    if (sub && embeddedSubtitleOn(sub)) { return; }
    /* Android: a text track of the file, shown through ExoPlayer. */
    var nat = sub && /^native:(\d+)$/.exec(sub.url || '');
    if (nat) {
      stopEmbeddedSubtitle();
      activeSubtitleCues = [];
      nativeSubIndex = Number(nat[1]);
      nativeCueText = '';
      if (window.__opentvNative && window.__opentvNative.selectText) { window.__opentvNative.selectText(nativeSubIndex); }
      return;
    }
    if (nativeSubIndex >= 0) {
      nativeSubIndex = -1;
      nativeCueText = '';
      if (window.__opentvNative && window.__opentvNative.selectText) { window.__opentvNative.selectText(-1); }
    }
    if (!attempt) { subtitleSeq++; }
    var mySeq = subtitleSeq;
    /* A subtitle track inside the file (player/stremio-sources.js). */
    if (sub && /^embedded:/.test(sub.url || '')) { startEmbeddedSubtitle(sub, mySeq); return; }
    stopEmbeddedSubtitle();
    /* A file the viewer imported: already in memory. */
    if (sub && sub.cues) {
      activeSubtitleCues = sub.cues;
      syncNativeSubtitleTrack();
      return;
    }
    if (!sub || !sub.url) {
      activeSubtitleCues = [];
      if (playerSubtitles) playerSubtitles.innerHTML = '';
      syncNativeSubtitleTrack();
      return;
    }
    /* A subtitle server that fails once (timeout, busy) is asked twice more. */
    function retry() {
      if (mySeq !== subtitleSeq || (attempt || 0) >= 2) { return; }
      setTimeout(function () { if (mySeq === subtitleSeq) { loadSubtitleTrack(sub, (attempt || 0) + 1); } }, 1500);
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', sub.url, true);
      xhr.timeout = 25000;
      xhr.onload = function () {
        if (mySeq !== subtitleSeq) { return; }
        var cues = (xhr.status >= 200 && xhr.status < 300) ? parseSRT(xhr.responseText) : [];
        if (!cues.length) { return retry(); }
        activeSubtitleCues = cues;
        syncNativeSubtitleTrack();
      };
      xhr.onerror = retry;
      xhr.ontimeout = retry;
      xhr.send();
    } catch (eSub) { /* ignore */ }
  }

  function applySubtitleStyles() {
    if (!playerSubtitles) return;
    playerSubtitles.classList.remove('size-small', 'size-normal', 'size-big');
    playerSubtitles.classList.add('size-' + vodSubSize);
    playerSubtitles.classList.remove('color-white', 'color-yellow', 'color-black');
    playerSubtitles.classList.add('color-' + vodSubStyle);
  }

  function updateSubtitleDisplay(currentSec) {
    if (!playerSubtitles) return;
    if (nativeSubTrack && playerVideo) {
      var inPip = typeof document.pictureInPictureElement !== 'undefined' && document.pictureInPictureElement === playerVideo;
      var targetMode = (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) ? 'disabled' : (inPip ? 'showing' : 'hidden');
      if (nativeSubTrack.mode !== targetMode) { nativeSubTrack.mode = targetMode; }
    }
    /* Android: the line ExoPlayer is showing from the file's own track. */
    if (nativeSubIndex >= 0) {
      var line = vodSubActive && nativeCueText ? '<span class="player-subtitles-text">' +
        escapeSubtitleText(nativeCueText).replace(/\n/g, '<br>') + '</span>' : '';
      if (playerSubtitles.innerHTML !== line) { playerSubtitles.innerHTML = line; }
      return;
    }
    if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
      if (playerSubtitles.innerHTML !== '') playerSubtitles.innerHTML = '';
      return;
    }
    var effectiveSec = currentSec - (vodSubOffset || 0);
    var cue = null;
    for (var i = 0; i < activeSubtitleCues.length; i++) {
      if (effectiveSec >= activeSubtitleCues[i].start && effectiveSec <= activeSubtitleCues[i].end) {
        cue = activeSubtitleCues[i];
        break;
      }
    }
    if (cue) {
      var html = '<span class="player-subtitles-text">' + cue.text + '</span>';
      if (playerSubtitles.innerHTML !== html) {
        playerSubtitles.innerHTML = html;
      }
    } else {
      if (playerSubtitles.innerHTML !== '') {
        playerSubtitles.innerHTML = '';
      }
    }
  }

  /* ---- Real portal audio/subtitle metadata -------------------------------
     PlaySettingView and the "Ajuste de reproducir" dialog read the same data
     the portal returns for startPlayVOD: the audio PID list and the subtitle
     file list.  It is fetched once per episode/movie and cached; playback
     still goes through resolve(). */
  function playSettingsItem() {
    if (state.screen === 'detail') { return state.detail || null; }
    return state.playerItem || state.detail || null;
  }

  /* ---- player/compat-mode.js ------------------------------------------------- */
  /* player/compat-mode.js — Modo compatible (FFmpeg): preferencia por título y memoria en este equipo.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* "Modo fluido" is a per-title preference: turning it on for one movie must
     not leak into the next one, while a series keeps it across its episodes
     (same series id). */
  var smoothModeByTitle = {};
  /* Stops an automatic Normal -> Fluido retry from looping if FFmpeg itself
     cannot open a particular title. Cleared when the viewer opens a title. */
  var autoSmoothFallbackKey = '';

  function smoothModeKey(item) {
    if (!item) { return ''; }
    /* A manual mode is a series preference while chapters are playing.  The
       previous key used the current episode id, so selecting Fluido in E1
       silently reverted to Normal in E2 and could leave its resolver waiting
       on an incompatible direct pipeline. */
    if (isSeriesItem(item)) {
      return 'series:' + (item.seriesContentId || item.seriesId || item.seasonId || item.id || '');
    }
    var ep = mediaInfoEpisode(item);
    return (ep && ep.id) ? ep.id : (item.id || '');
  }

  /* Titles that only play in compatibility mode are remembered on this PC,
     so the next time they open straight in that mode. */
  var COMPAT_STORE = 'opentv_compat_titles_v1';
  function loadCompatTitles() {
    try { return JSON.parse(localStorage.getItem(COMPAT_STORE) || '{}') || {}; } catch (eLoad) { return {}; }
  }
  function saveCompatTitle(key, on) {
    if (!key) { return; }
    var all = loadCompatTitles();
    if (on) { all[key] = Date.now(); } else { delete all[key]; }
    var keys = Object.keys(all);
    if (keys.length > 400) {
      keys.sort(function (a, b) { return all[a] - all[b]; });
      for (var i = 0; i < keys.length - 400; i++) { delete all[keys[i]]; }
    }
    try { localStorage.setItem(COMPAT_STORE, JSON.stringify(all)); } catch (eSave) { /* storage full or off */ }
  }
  function clearCompatTitles() {
    try {
      localStorage.removeItem(COMPAT_STORE);
      localStorage.removeItem('opentv_compat_audio_v1');   // compat-watchdog.js COMPAT_AUDIO_STORE
    } catch (eClear) { /* ignore */ }
  }
  function compatEpisodeKey(item) { return mediaInfoKey(item) || smoothModeKey(item); }

  function restoreSmoothMode(item) {
    var key = smoothModeKey(item);
    var saved = window.OPENTV_DESKTOP ? loadCompatTitles() : {};
    if (key && !smoothModeByTitle.hasOwnProperty(key) &&
        (saved.hasOwnProperty(key) || saved.hasOwnProperty(compatEpisodeKey(item)))) {
      state.streamMode = 'smooth';
    } else if (key && smoothModeByTitle.hasOwnProperty(key)) {
      state.streamMode = smoothModeByTitle[key] ? 'smooth' : 'normal';
    } else {
      state.streamMode = state.playback.streamMode === 'smooth' ? 'smooth' : 'normal';
    }
  }

  function setSmoothMode(item, on) {
    var key = smoothModeKey(item);
    state.streamMode = on ? 'smooth' : 'normal';
    if (key) { smoothModeByTitle[key] = !!on; }
    if (window.OPENTV_DESKTOP) {
      saveCompatTitle(key, on);
      if (!on) { saveCompatTitle(compatEpisodeKey(item), false); }
    }
  }

  /* ---- player/media-info.js -------------------------------------------------- */
  /* player/media-info.js — Metadatos reales de audio/subtítulos del portal y calidades.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Called when a different title is opened, never when zapping episodes. */
  function resetMediaSelection() {
    autoSmoothFallbackKey = '';
    vodCurrentAudioTrack = 0;
    vodAudioChosen = false;
    vodCurrentSubtitle = null;
    vodSubActive = false;
    vodSubChosen = false;
    vodSubOffset = 0;
    subtitleSeq++;
    state.trackIndex = 0;
    activeSubtitleCues = [];
    if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
  }

  function mediaInfoEpisode(item) {
    if (!item) { return null; }
    if (isSeriesItem(item)) {
      if (state.screen === 'player' && state.playerEpisode) { return state.playerEpisode; }
      if (state.detailEpisode) { return state.detailEpisode; }
      return (item.episodes && item.episodes[0]) || null;
    }
    return null;
  }

  function mediaInfoKey(item) {
    if (!item) { return ''; }
    var ep = mediaInfoEpisode(item);
    return (ep && ep.id) ? ep.id : (item.id || '');
  }

  function ensureMediaInfo(item, done) {
    done = done || function () {};
    if (!item) { return done(null); }
    var key = mediaInfoKey(item);
    if (!key) { return done(null); }
    if (mediaInfoCache[key]) {
      applySubtitleDefaults(mediaInfoCache[key]);
      return done(mediaInfoCache[key]);
    }
    /* Addon titles: nothing to ask beforehand; the audio tracks are read from
       the file and subtitles come from the addons when the video starts
       (player/stremio-sources.js). */
    return done({ audio: '', subtitles: item.subtitles || [], tracks: [] });
  }

  /* The index of the preferred language in a list of audio codes. */
  function preferredAudioIndex(rawAudio) {
    var parts = (rawAudio || '').split(/[,\/]/);
    var preferred = preferredLanguageCode();
    for (var i = 0; i < parts.length; i++) {
      if (languageMatchesPreference(parts[i].trim(), preferred)) { return i; }
    }
    return 0;
  }

  function audioLanguageList(info) {
    var out = [];
    /* Addon titles: the file's own tracks, read by the service (language,
       title such as "Latino", channels), already labelled. */
    if (info && info.audioTracks && info.audioTracks.length) {
      for (var t = 0; t < info.audioTracks.length; t++) {
        out.push({ index: info.audioTracks[t].index, code: info.audioTracks[t].code, label: info.audioTracks[t].label });
      }
      return out;
    }
    var parts = ((info && info.audio) || '').split(/[,\/]/);
    for (var i = 0; i < parts.length; i++) {
      var code = parts[i].trim();
      if (!code) { continue; }
      out.push({ index: i, code: code, label: formatAudioLang(code) });
    }
    return out;
  }

  function subtitleLanguageList(info) {
    var out = [];
    var subs = (info && info.subtitles) || [];
    for (var i = 0; i < subs.length; i++) {
      /* label: shown as is (the file's own tracks, an imported file). */
      out.push({ lang: subs[i].lang, url: subs[i].url, format: subs[i].format, label: subs[i].label || '',
        forced: !!subs[i].forced, cues: subs[i].cues || null });
    }
    /* The viewer's subtitle language first, keeping the order the list came in
       (the file's own tracks before or after the addons', per Preferencias). */
    var wanted = typeof preferredSubtitleCode === 'function' ? preferredSubtitleCode() : 'es';
    var ranked = out.map(function (s, idx) { return { s: s, idx: idx, p: languageMatchesPreference(s.lang, wanted) ? 0 : 1 }; });
    ranked.sort(function (a, b) { return a.p - b.p || a.idx - b.idx; });
    return ranked.map(function (r) { return r.s; });
  }

  /* The real app opens with subtitles ON and Spanish selected when the portal
     returns subtitle files. Keep the user's choice once they touch the switch
     or pick a language. */
  function applySubtitleDefaults(info) {
    var list = subtitleLanguageList(info);
    if (!vodSubChosen) {
      if (!state.playback.subtitle) {
        vodSubActive = false;
        vodCurrentSubtitle = null;
        loadSubtitleTrack(null);
        return;
      }
      if (!list.length) {
        vodSubActive = false;
        vodCurrentSubtitle = null;
        loadSubtitleTrack(null);
        return;
      }
      vodSubActive = true;
      vodCurrentSubtitle = list[0];
      for (var pref = 0; pref < list.length; pref++) {
        if (languageMatchesPreference(list[pref].lang, preferredSubtitleCode())) {
          vodCurrentSubtitle = list[pref];
          break;
        }
      }
      loadSubtitleTrack(vodCurrentSubtitle);
      return;
    }
    if (!vodSubActive) { return; }
    if (!list.length) {
      vodSubActive = false;
      vodCurrentSubtitle = null;
      loadSubtitleTrack(null);
      return;
    }
    /* New episode with the same preference: keep the language if the new
       episode ships it, otherwise fall back to the first file. */
    var stillThere = false;
    if (vodCurrentSubtitle) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === vodCurrentSubtitle.url) {
          vodCurrentSubtitle = list[i];
          stillThere = true;
          break;
        }
      }
    }
    if (!stillThere) {
      vodCurrentSubtitle = list[0];
      loadSubtitleTrack(vodCurrentSubtitle);
    }
  }

  /* ---- player/play-settings.js ----------------------------------------------- */
  /* player/play-settings.js — Menú de ajustes del reproductor (hoja inferior): audio, calidad, selección.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function schedulePlaySettingHide() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); }
    playSettingTimer = setTimeout(function () {
      closePlaySettingView();
    }, 8000);
  }

  function openPlaySettingView() {
    if (!playSettingView) { buildPlayer(); }
    if (!playSettingView) return;
    playSettingViewOpen = true;
    dialogPlaySettingsOpen = false;
    hideInfobar();

    renderPlaySettingView();
    playSettingView.classList.add('is-active');
    if (playerSubtitles) { playerSubtitles.classList.add('shift-up'); }

    /* Audio languages, subtitle files and renditions come from the portal;
       refresh the rows as soon as the service answers. */
    ensureMediaInfo(state.playerItem, function () {
      if (playSettingViewOpen) { renderPlaySettingView(); }
    });

    schedulePlaySettingHide();

    /* Seasons are selected in detail; this panel contains only chapters. */
    var item = state.playerItem;
    if (isSeriesItem(item) && psvEpisodesRow) {
      var chapter = psvEpisodesRow.querySelector('.psv-ep-btn');
      if (chapter) { setFocus(chapter); return; }
    }
    if (isSeriesItem(item) && psvBtnEpisodes) {
      setFocus(psvBtnEpisodes);
      return;
    }
    if (psvBtnConfig) { setFocus(psvBtnConfig); }
  }

  function closePlaySettingView() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    playSettingViewOpen = false;
    if (playSettingView) { playSettingView.classList.remove('is-active'); }
    if (playerSubtitles) { playerSubtitles.classList.remove('shift-up'); }
    if (state.screen === 'player' && !dialogPlaySettingsOpen) {
      setFocus(playerStage);
    }
  }

  function renderPlaySettingView() {
    /* Keep the d-pad where the user was: the rows rebuild their pills, so a
       plain re-render used to leave focus on a detached node (the OK press
       then did nothing and the panel closed by timeout). */
    var focusRow = state.focus ? closest(state.focus, '.psv-row') : null;
    var focusRowId = focusRow ? focusRow.id : '';
    var focusText = (focusRow && state.focus) ? state.focus.textContent : '';

    renderPlaySettingSelection();
    renderPlaySettingAudio();
    renderPlaySettingQuality();
    renderPlaySettingPlayerOptions();
    renderPlaySettingAspectOptions();
    renderPlaySettingRowFocus();

    if (!playSettingViewOpen || !focusRowId || !playSettingView) { return; }
    var rows = playSettingView.querySelectorAll('.psv-row');
    for (var r = 0; r < rows.length; r++) {
      if (rows[r].id !== focusRowId) { continue; }
      var btns = rows[r].querySelectorAll('.focusable');
      var match = null;
      for (var b = 0; b < btns.length; b++) {
        if (btns[b].textContent === focusText) { match = btns[b]; break; }
      }
      var target = match || firstIn(rows[r]);
      if (target) { setFocus(target, true); }
      break;
    }
  }

  function renderPlaySettingAudio() {
    if (!psvSecAudio) { return; }
    /* Always present: it is the entry point to "Ajuste de reproducir". */
    psvSecAudio.classList.remove('is-hidden');
  }

  /* Desktop "Calidad" row. Most portal episodes have a single version, so the
     row only appears when the current episode offers more than one height.
     The choice is a preferred height (e.g. 720) kept for later titles too;
     "Automática" lets the service pick the most compatible version. */
  var QUALITY_PREF_KEY = 'opentv_quality_pref_v1';
  function preferredQualityHeight() {
    return parseInt(safeLocalRead(QUALITY_PREF_KEY, 0), 10) || 0;
  }
  function trackLines(track) {
    var h = parseInt(track && track.height, 10) || 0;
    if (h) { return h; }
    var m = /(\d{3,4})\s*[pi]?/i.exec(String((track && track.quality) || ''));
    return m ? parseInt(m[1], 10) : 0;
  }
  function currentTrackInfo() {
    var item = state.playerItem;
    if (!item) { return null; }
    var ep = state.playerEpisode;
    return mediaInfoCache[(ep && ep.id) || ''] || mediaInfoCache[mediaInfoKey(item)] || null;
  }

  function renderPlaySettingQuality() {
    if (!window.OPENTV_DESKTOP || !psvSecQuality || !psvQualityRow) { return; }
    var info = currentTrackInfo();
    var heights = [];
    var tracks = (info && info.tracks) || [];
    for (var i = 0; i < tracks.length; i++) {
      var h = trackLines(tracks[i]);
      if (h && heights.indexOf(h) === -1) { heights.push(h); }
    }
    heights.sort(function (a, b) { return b - a; });
    clear(psvQualityRow);
    if (state.playerMode === 'vod' && heights.length < 2 && renderHlsQualityRow(psvQualityRow)) {
      psvSecQuality.classList.remove('is-hidden');
      return;
    }
    if (state.playerMode !== 'vod' || heights.length < 2) {
      psvSecQuality.classList.add('is-hidden');
      return;
    }
    psvSecQuality.classList.remove('is-hidden');
    var pref = preferredQualityHeight();
    var playing = trackLines(info.selected);
    var options = [{ h: 0, label: 'Automática' + (playing && !pref ? ' · ' + playing + 'p' : '') }];
    for (var k = 0; k < heights.length; k++) { options.push({ h: heights[k], label: heights[k] + 'p' }); }
    var selectedH = (pref && heights.indexOf(pref) !== -1) ? pref : 0;
    options.forEach(function (opt) {
      var b = el('button', 'psv-btn focusable' + (opt.h === selectedH ? ' is-selected' : ''));
      b.appendChild(el('span', 'psv-check', '✔'));
      b.appendChild(document.createTextNode(opt.label));
      b._activate = function () {
        if (opt.h === selectedH) { return; }
        safeLocalWrite(QUALITY_PREF_KEY, opt.h);
        renderPlaySettingQuality();
        restartCurrentPlayback();
      };
      psvQualityRow.appendChild(b);
    });
  }

  /* The APK turns the title of the row that holds focus white and 40px. */
  function renderPlaySettingRowFocus() {
    if (!playSettingView) { return; }
    var rows = playSettingView.querySelectorAll('.psv-row');
    for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('is-row-focused'); }
    var row = state.focus ? closest(state.focus, '.psv-row') : null;
    if (row) { row.classList.add('is-row-focused'); }
  }

  function renderPlaySettingSelection() {
    if (!psvSecSelection) return;
    var item = state.playerItem;
    if (!item || !isSeriesItem(item)) {
      psvSecSelection.style.display = 'none';
      return;
    }
    psvSecSelection.style.display = 'block';
    if (!psvEpisodesRow) return;

    clear(psvEpisodesRow);

    var seasons = seriesSeasons(item);
    var season = seasons[state.playerSeasonIndex] || seasons[0];
    var episodes = (season && season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
      ? item.episodes : ((season && season._episodes) || item.episodes || []);
    if (!episodes.length) {
      psvEpisodesRow.appendChild(el('div', 'psv-selection-empty', 'Temporadas y episodios'));
      return;
    }
    var currentIndex = 0;
    for (var c = 0; c < episodes.length; c++) {
      if (state.playerEpisode && (episodes[c].id === state.playerEpisode.id || episodes[c].number === state.playerEpisode.number)) { currentIndex = c; break; }
    }
    var ranges = detailRanges(episodes.length);
    if (state.playerEpisodeRange === undefined || state.playerEpisodeRange >= ranges.length) {
      state.playerEpisodeRange = Math.floor(currentIndex / 20);
    }
    var range = ranges[state.playerEpisodeRange] || ranges[0];
    /* reveal() only follows .scrollable containers.  Without this class the
       d-pad could focus episode 16+ outside the visible row, making a
       20-episode page look capped around fifteen entries. */
    var numberRow = el('div', 'psv-episode-numbers scrollable');
    for (var i = range.start; i < range.end; i++) {
      (function (ep, idx) {
        var epNo = String(ep.number !== undefined && ep.number !== null ? ep.number : idx + 1);
        /* Desktop keeps the number visible and marks the current one by style. */
        var label = (idx === currentIndex && !window.OPENTV_DESKTOP) ? '▶' : epNo;
        var btn = el('button', 'psv-ep-btn focusable' + (idx === currentIndex ? ' is-selected is-current' : ''), label);
        btn._activate = function () { chooseEpisode(ep); };
        numberRow.appendChild(btn);
      })(episodes[i], i);
    }
    psvEpisodesRow.appendChild(numberRow);
    var rangeRow = el('div', 'psv-episode-ranges scrollable');
    for (var r = 0; r < ranges.length; r++) {
      (function (idx, part) {
        var btn = el('button', 'psv-range-btn focusable' + (idx === state.playerEpisodeRange ? ' is-selected' : ''),
          (part.start + 1) + '-' + part.end);
        btn._activate = function () {
          state.playerEpisodeRange = idx;
          renderPlaySettingSelection();
          var first = psvEpisodesRow.querySelector('.psv-ep-btn');
          if (first) { setFocus(first); }
        };
        rangeRow.appendChild(btn);
      })(r, ranges[r]);
    }
    psvEpisodesRow.appendChild(rangeRow);
  }

  /* ---- player/quality.js ----------------------------------------------------- */
  /* player/quality.js — Calidad de imagen del stream HLS: fila del menú VOD y botón de calidad en la TV.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Many portal streams carry several resolutions inside one HLS playlist.
     desktop/player.js exposes them as window.__opentvHls; here they become
     choices: "Automática" (adapts to the connection) or a fixed height. The
     choice is remembered for later videos and channels. */
  function hlsQualityApi() {
    return window.OPENTV_DESKTOP && window.__opentvHls ? window.__opentvHls : null;
  }

  function hlsQualityLabel(height) {
    if (height >= 2000) { return '4K'; }
    return height + 'p';
  }

  /* Fills the VOD "Calidad" row from the stream levels. Returns false when the
     stream has a single resolution (the row stays hidden). */
  function renderHlsQualityRow(row) {
    var api = hlsQualityApi();
    var levels = api ? api.levels() : [];
    if (levels.length < 2) { return false; }
    var cur = api.current() || { auto: true, height: 0 };
    var options = [{ h: 0, label: 'Automática' + (cur.auto && cur.height ? ' · ' + hlsQualityLabel(cur.height) : '') }];
    levels.forEach(function (l) { options.push({ h: l.height, label: hlsQualityLabel(l.height) }); });
    var selected = cur.auto ? 0 : cur.height;
    options.forEach(function (opt) {
      var b = el('button', 'psv-btn focusable' + (opt.h === selected ? ' is-selected' : ''));
      b.appendChild(el('span', 'psv-check', '✔'));
      b.appendChild(document.createTextNode(opt.label));
      b._activate = function () {
        api.choose(opt.h);
        renderPlaySettingQuality();
        schedulePlaySettingHide();
      };
      row.appendChild(b);
    });
    return true;
  }

  /* Live TV: the quality button cycles Automática → highest → … → lowest. */
  function cycleHlsQuality(btn) {
    var api = hlsQualityApi();
    var levels = api ? api.levels() : [];
    if (levels.length < 2) { return; }
    var cur = api.current() || { auto: true };
    var order = [0].concat(levels.map(function (l) { return l.height; }));
    var at = cur.auto ? 0 : order.indexOf(cur.height);
    var next = order[(at + 1) % order.length];
    api.choose(next);
    setPlayerStatus('Calidad: ' + (next ? hlsQualityLabel(next) : 'Automática'));
    setTimeout(function () { if (/^Calidad:/.test((playerStatus && playerStatus.textContent) || '')) { setPlayerStatus(''); } }, 1600);
    updateLiveQualityButton();
  }

  function updateLiveQualityButton() {
    var btn = document.querySelector('.pi-quality-btn');
    if (!btn) { return; }
    var api = hlsQualityApi();
    var levels = api ? api.levels() : [];
    var cur = api ? api.current() : null;
    if (levels.length < 2 || state.playerMode !== 'live') {
      btn.setAttribute('aria-disabled', 'true');
      setButtonText(btn, cur && cur.height ? 'Calidad ' + hlsQualityLabel(cur.height) + ' (única disponible)' : 'Calidad automática');
      return;
    }
    btn.removeAttribute('aria-disabled');
    setButtonText(btn, 'Calidad: ' + (cur && !cur.auto ? hlsQualityLabel(cur.height)
      : 'Automática' + (cur && cur.height ? ' · ' + hlsQualityLabel(cur.height) : '')) + ' — clic para cambiar');
    btn.classList.toggle('is-selected', !!(cur && !cur.auto));
  }

  /* ---- Quality button + menu in the movie player bar ---- */
  /* Options from the portal versions of the title, or from the HLS stream. */
  function playerQualityOptions() {
    var out = [];
    if (state.playerMode !== 'vod') { return out; }
    var info = currentTrackInfo();
    var tracks = (info && info.tracks) || [];
    var heights = [];
    for (var i = 0; i < tracks.length; i++) {
      var h = trackLines(tracks[i]);
      if (h && heights.indexOf(h) === -1) { heights.push(h); }
    }
    heights.sort(function (a, b) { return b - a; });
    if (heights.length >= 2) {
      var pref = preferredQualityHeight();
      var playing = trackLines(info.selected);
      var sel = (pref && heights.indexOf(pref) !== -1) ? pref : 0;
      out.push({ label: 'Automática', note: playing && !pref ? hlsQualityLabel(playing) : '', selected: sel === 0, apply: function () {
        if (sel === 0) { return; } safeLocalWrite(QUALITY_PREF_KEY, 0); restartCurrentPlayback(); } });
      heights.forEach(function (hh) {
        out.push({ label: hlsQualityLabel(hh), selected: sel === hh, apply: function () {
          if (sel === hh) { return; } safeLocalWrite(QUALITY_PREF_KEY, hh); restartCurrentPlayback(); } });
      });
      return out;
    }
    var api = hlsQualityApi();
    var levels = api ? api.levels() : [];
    if (levels.length < 2) { return out; }
    var cur = api.current() || { auto: true, height: 0 };
    out.push({ label: 'Automática', note: cur.auto && cur.height ? hlsQualityLabel(cur.height) : '', selected: !!cur.auto,
      apply: function () { api.choose(0); } });
    levels.forEach(function (l) {
      out.push({ label: hlsQualityLabel(l.height), selected: !cur.auto && cur.height === l.height,
        apply: function () { api.choose(l.height); } });
    });
    return out;
  }

  function updateQualityButton() {
    var btn = $('vod-quality');
    if (!btn) { return; }
    var opts = playerQualityOptions();
    btn.hidden = opts.length < 2;
    var chosen = null;
    for (var i = 0; i < opts.length; i++) { if (opts[i].selected) { chosen = opts[i]; } }
    setButtonText(btn, 'Calidad: ' + (chosen ? chosen.label + (chosen.note ? ' · ' + chosen.note : '') : 'Automática'));
  }

  /* One pop-up menu above a player button (quality, speed…), in real pixels. */
  var playerMenu = null;
  var playerMenuFor = null;
  function closePlayerMenu() {
    if (playerMenu) { playerMenu.classList.remove('is-open'); }
    playerMenuFor = null;
  }
  function togglePlayerMenu(btn, title, opts, after) {
    if (playerMenu && playerMenu.classList.contains('is-open') && playerMenuFor === btn) { closePlayerMenu(); return; }
    if (!btn || opts.length < 2) { return; }
    if (!playerMenu) {
      playerMenu = el('div', 'quality-menu');
      document.body.appendChild(playerMenu);
      document.addEventListener('pointerdown', function (event) {
        if (playerMenu.classList.contains('is-open') && !playerMenu.contains(event.target) &&
            !(playerMenuFor && playerMenuFor.contains(event.target))) { closePlayerMenu(); }
      }, true);
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && playerMenu.classList.contains('is-open')) { event.stopPropagation(); event.preventDefault(); closePlayerMenu(); }
      }, true);
    }
    clear(playerMenu);
    playerMenu.appendChild(el('div', 'qm-title', title));
    opts.forEach(function (o) {
      var item = el('button', 'qm-item' + (o.selected ? ' is-selected' : ''));
      item.type = 'button';
      var check = el('span', 'qm-check');
      check.innerHTML = o.selected ? UI_ICONS.check : '';
      item.appendChild(check);
      item.appendChild(el('span', 'qm-label', o.label));
      if (o.note) { item.appendChild(el('span', 'qm-note', o.note)); }
      item.addEventListener('click', function (event) {
        event.stopPropagation();
        closePlayerMenu();
        o.apply();
        if (after) { setTimeout(after, 300); }
      });
      playerMenu.appendChild(item);
    });
    var r = btn.getBoundingClientRect();
    playerMenuFor = btn;
    playerMenu.classList.add('is-open');
    var mw = playerMenu.offsetWidth, mh = playerMenu.offsetHeight;
    playerMenu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, r.left + r.width / 2 - mw / 2))) + 'px';
    playerMenu.style.top = Math.round(Math.max(8, r.top - mh - 12)) + 'px';
  }

  function toggleQualityMenu(btn) {
    togglePlayerMenu(btn, 'Calidad', playerQualityOptions(), updateQualityButton);
  }

  /* ------------------------------------------------------------- speed */
  var PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var playbackRate = 1;
  var playbackRateItem = null;

  function applyPlaybackRate() {
    if (!playerVideo) { return; }
    /* A new title starts at normal speed; episodes of the same series keep it. */
    if (state.playerItem !== playbackRateItem) { playbackRate = 1; playbackRateItem = state.playerItem; }
    var want = state.playerMode === 'vod' ? playbackRate : 1;
    if (playerVideo.playbackRate !== want) { playerVideo.playbackRate = want; }
    updateSpeedButton();
  }

  function rateLabel(r) { return r === 1 ? 'Normal' : String(r).replace('.', ',') + '×'; }

  function updateSpeedButton() {
    var btn = $('vod-speed');
    if (!btn) { return; }
    setButtonText(btn, 'Velocidad: ' + rateLabel(playbackRate));
    btn.classList.toggle('is-selected', playbackRate !== 1);
    var badge = btn.querySelector('.speed-badge');
    if (!badge) { badge = el('span', 'speed-badge'); btn.appendChild(badge); }
    badge.textContent = playbackRate === 1 ? '' : String(playbackRate).replace('.', ',') + '×';
  }

  function toggleSpeedMenu(btn) {
    var opts = PLAYBACK_RATES.map(function (r) {
      return { label: rateLabel(r), selected: r === playbackRate, apply: function () {
        playbackRate = r;
        playbackRateItem = state.playerItem;
        applyPlaybackRate();
        setPlayerStatus(r === 1 ? '' : 'Velocidad ' + rateLabel(r));
        setTimeout(function () { if (/^Velocidad/.test((playerStatus && playerStatus.textContent) || '')) { setPlayerStatus(''); } }, 1200);
      } };
    });
    togglePlayerMenu(btn, 'Velocidad', opts);
  }

  function installQualityControls() {
    if (!window.OPENTV_DESKTOP) { return; }
    if (playerVideo) {
      playerVideo.addEventListener('loadedmetadata', applyPlaybackRate);
      playerVideo.addEventListener('playing', applyPlaybackRate);
    }
    document.addEventListener('opentv:hls-levels', function () {
      updateLiveQualityButton();
      updateQualityButton();
      if (playSettingViewOpen) { renderPlaySettingQuality(); }
    });
  }

  /* ---- player/volume.js ------------------------------------------------------ */
  /* player/volume.js — Escritorio: volumen en el reproductor y vista previa del tiempo sobre la barra.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The player shares the TV volume (liveAudio): one level for the whole app.
     When Windows volume control is available it moves the real system volume,
     exactly like the TV slider; otherwise it is the video's own volume. */
  var playerVolRange = null, playerMuteBtn = null, playerVolLabel = null;
  /* (Movies and TV en vivo each have one: all of them show the same level.) */
  var playerVolSets = [];

  function applyPlayerAudio() {
    if (!window.OPENTV_DESKTOP || !playerVideo || state.screen !== 'player') { return; }
    if (systemVolumeOn) {
      playerVideo.volume = 1;
      playerVideo.muted = false;
    } else {
      playerVideo.volume = liveAudio.volume;
      playerVideo.muted = liveAudio.muted;
    }
    syncPlayerVolumeUi();
  }

  function syncPlayerVolumeUi() {
    var off = liveAudio.muted || liveAudio.volume === 0;
    var pct = off ? 0 : Math.round(liveAudio.volume * 100);
    for (var i = 0; i < playerVolSets.length; i++) {
      var set = playerVolSets[i];
      if (String(set.range.value) !== String(pct)) { set.range.value = pct; }
      set.range.style.setProperty('--vol', pct + '%');
      if (set.label) { set.label.textContent = off ? 'Sin sonido' : pct + '%'; }
      if (set.mute) {
        set.mute.innerHTML = off ? LIVE_DOCK_ICONS.mute : (liveAudio.volume < 0.5 ? LIVE_DOCK_ICONS.soundLow : LIVE_DOCK_ICONS.sound);
        set.mute.setAttribute('data-tip', off ? 'Activar sonido (M)' : 'Silenciar (M)');
        set.mute.setAttribute('aria-label', off ? 'Activar sonido' : 'Silenciar');
        set.mute.classList.toggle('is-off', off);
      }
    }
  }

  function togglePlayerMute() {
    if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
    else { liveAudio.muted = !liveAudio.muted; }
    applyLiveAudio(true);
    showLiveVolumeToast();
  }

  /* Mute button + slider, next to Volver on the left of the bar. */
  function buildPlayerVolume(group) {
    var wrap = el('div', 'vod-volume');
    wrap.setAttribute('data-no-gesture', '');
    playerMuteBtn = el('button', 'vod-tip vod-mute focusable');
    playerMuteBtn.type = 'button';
    playerMuteBtn._activate = togglePlayerMute;
    wrap.appendChild(playerMuteBtn);
    playerVolRange = document.createElement('input');
    playerVolRange.type = 'range';
    playerVolRange.min = '0';
    playerVolRange.max = '100';
    playerVolRange.step = '1';
    playerVolRange.className = 'live-vol-range vod-vol-range';
    playerVolRange.setAttribute('aria-label', 'Volumen');
    playerVolRange.addEventListener('input', function () {
      liveAudio.volume = Math.max(0, Math.min(1, playerVolRange.value / 100));
      liveAudio.muted = liveAudio.volume === 0;
      applyLiveAudio(false);
      if (systemVolumeOn) { pushSystemVolume(); }
    });
    playerVolRange.addEventListener('change', function () { applyLiveAudio(true); });
    playerVolRange.addEventListener('keydown', function (event) {
      /* Arrow keys keep seeking the video; the slider only takes the mouse. */
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); }
    });
    wrap.appendChild(playerVolRange);
    playerVolLabel = el('span', 'vod-vol-label', '');
    wrap.appendChild(playerVolLabel);
    wrap.setAttribute('data-tip', systemVolumeApi() ? 'Volumen de Windows · rueda del ratón' : 'Volumen · rueda del ratón');
    group.appendChild(wrap);
    playerVolSets.push({ range: playerVolRange, mute: playerMuteBtn, label: playerVolLabel });
    syncPlayerVolumeUi();
  }

  /* Wheel over the picture changes the volume (Ctrl + wheel is left alone). */
  function installPlayerWheelVolume() {
    if (!window.OPENTV_DESKTOP || !playerStage || playerStage._wheelVolume) { return; }
    playerStage._wheelVolume = true;
    $('screen-player').addEventListener('wheel', function (event) {
      if (event.ctrlKey || state.screen !== 'player') { return; }
      if (playSettingViewOpen || dialogPlaySettingsOpen || state.episodeBrowserOpen || state.categoryPickerOpen || state.channelsOpen) { return; }
      if (event.target && event.target.closest && event.target.closest('.scrollable, .quality-menu, .pc-list, .player-channels')) { return; }
      event.preventDefault();
      changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });
  }

  /* Hovering the seek bar shows the time under the pointer. */
  function installSeekHoverPreview() {
    if (!window.OPENTV_DESKTOP || !vodSeekbar || vodSeekbar._hoverPreview) { return; }
    vodSeekbar._hoverPreview = true;
    var bubble = el('div', 'vod-seek-hover');
    var ghost = el('div', 'vod-seek-ghost');
    vodSeekbar.appendChild(ghost);
    vodSeekbar.appendChild(bubble);
    function show(event) {
      var duration = vodPlaybackDuration();
      if (!duration) { hide(); return; }
      var rect = vodSeekbar.getBoundingClientRect();
      var fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      var t = vodScrubbing ? vodScrubTime : fraction * duration;
      var delta = t - vodPlaybackPosition();
      bubble.innerHTML = '<b>' + formatTime(t) + '</b>' + (vodScrubbing || Math.abs(delta) < 5 ? ''
        : '<span>' + (delta > 0 ? '+' : '−') + formatTime(Math.abs(delta)).replace(/^00:/, '') + '</span>');
      /* Position in the bar's own (unscaled) units. */
      var scale = rect.width / (vodSeekbar.offsetWidth || rect.width);
      var x = (vodScrubbing ? (vodScrubTime / duration) * rect.width : fraction * rect.width) / scale;
      bubble.style.left = x + 'px';
      ghost.style.width = (fraction * 100) + '%';
      vodSeekbar.classList.add('is-hovering');
    }
    function hide() { vodSeekbar.classList.remove('is-hovering'); }
    vodSeekbar.addEventListener('pointermove', show);
    vodSeekbar.addEventListener('pointerenter', show);
    vodSeekbar.addEventListener('pointerleave', function () { if (!vodScrubbing) { hide(); } });
    vodSeekbar.addEventListener('pointerup', function () { setTimeout(hide, 600); });
  }

  function installPlayerVolume() {
    /* TVs: the remote changes the TV's own volume; the slider, the wheel and
       the seek preview on hover are mouse controls. */
    if (!window.OPENTV_DESKTOP || platformIsTv()) { return; }
    var left = document.querySelector('.vod-infobar-tips .vt-left');
    if (left && !left.querySelector('.vod-volume')) { buildPlayerVolume(left); }
    playerVideo.addEventListener('playing', applyPlayerAudio);
    installPlayerWheelVolume();
    installSeekHoverPreview();
  }

  /* ---- player/episodes.js ---------------------------------------------------- */
  /* player/episodes.js — Temporadas y episodios: navegador en el reproductor y paso al siguiente capítulo.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ================= Season/episode browser (in-player) =================
     Netflix-style list: season rail on the left, episode rows on the right.
     Episodes for other seasons are fetched once from the portal and cached on
     the season object.  The series id (item.id) is never overwritten, so the
     resolver keeps sending seriesContentId = the real series. */
  function seriesSeasons(item) {
    if (item && item.seasons && item.seasons.length) { return item.seasons; }
    return [{ id: item ? item.id : '', number: 1 }];
  }

  function seasonEpisodes(item, season, done) {
    done = done || function () {};
    if (!item || !season) { return done([]); }
    if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
      season._episodes = item.episodes;
      return done(item.episodes);
    }
    /* Addon series bring every season's episodes with the title. */
    done(season._episodes || []);
  }

  function episodeDisplayTitle(item, ep, index) {
    var num = (ep && ep.number !== undefined && ep.number !== null) ? ep.number : (index + 1);
    var raw = String((ep && (ep.title || ep.name)) || '').trim();
    var base = String((item && item.title) || '').trim()
      .replace(/[\s\-–_]*[TtSs]\d+$/, '');   /* "Serie T10" -> "Serie" */
    if (base && raw.indexOf(base) === 0) {
      raw = raw.substring(base.length);
    }
    /* Language tags like "(Español Latino)" are shown apart (episodeLangTag). */
    raw = raw.replace(/\s*[(\[][^)\]]{1,30}[)\]]\s*/g, ' ');
    raw = raw.replace(/^[\s\-–_:.]+/, '').replace(/\s{2,}/g, ' ').trim();
    /* Only a season/episode code left ("T1_06", "S01E06", "6")? Use a clean
       label instead of repeating the series name. */
    if (!raw || /^(?:[TtSs]?\d+[\s\-–_.:]*)+$/.test(raw)) {
      raw = 'Episodio ' + num;
    }
    return raw;
  }

  /* "(Español Latino) T1_23" -> "Latino"; empty when the title has no tag. */
  function episodeLangTag(ep) {
    var m = /[(\[]([^)\]]{1,30})[)\]]/.exec(String((ep && (ep.title || ep.name)) || ''));
    if (!m) { return ''; }
    var tag = m[1].trim();
    if (/latino/i.test(tag)) { return 'Latino'; }
    if (/castellano|españa/i.test(tag)) { return 'Castellano'; }
    if (/sub/i.test(tag)) { return 'Subtitulado'; }
    return tag;
  }

  function episodeDurationLabel(ep) {
    var raw = String((ep && ep.duration) || '').trim();
    /* The player may store the measured length as plain seconds ("1388.82"). */
    if (/^\d+(?:\.\d+)?$/.test(raw) && parseFloat(raw) >= 60) {
      var totalMin = Math.round(parseFloat(raw) / 60);
      var hh = Math.floor(totalMin / 60);
      return hh ? (hh + ' h ' + (totalMin % 60) + ' min') : (totalMin + ' min');
    }
    var m = /^(\d+):(\d+)(?::(\d+))?$/.exec(raw);
    if (!m) { return raw; }
    if (m[3]) {
      var h = parseInt(m[1], 10) || 0;
      var min = parseInt(m[2], 10) || 0;
      return h ? (h + ' h ' + min + ' min') : (min + ' min');
    }
    return (parseInt(m[1], 10) || 0) + ' min';
  }

  function openEpisodeBrowser() {
    var item = state.playerItem;
    if (!item || !isSeriesItem(item)) { return; }
    if (playSettingViewOpen) { closePlaySettingView(); }
    if (!episodeBrowser) { buildPlayer(); }
    if (!episodeBrowser) { return; }

    if ((!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
      setPlayerStatus('Cargando capítulos…');
      loadVodDetail(item, function () {
        if (state.screen !== 'player') { return; }
        if (!state.playerEpisode && item.episodes && item.episodes.length) {
          state.playerEpisode = item.episodes[0];
          state.detailEpisode = item.episodes[0];
        }
        openEpisodeBrowser();
      });
      return;
    }

    if (!state.playerEpisode && item.episodes && item.episodes.length) {
      state.playerEpisode = item.episodes[0];
      state.detailEpisode = item.episodes[0];
      state.playerSeasonIndex = state.detailSeason || 0;
    }

    state.episodeBrowserOpen = true;
    state.browserSeason = state.playerSeasonIndex || 0;
    episodeBrowser.classList.add('is-active');
    hideVodInfobar();
    renderEpisodeBrowser();

    var cur = peEpisodes ? peEpisodes.querySelector('.pe-ep.is-current') : null;
    var f = cur || (peEpisodes ? firstIn(peEpisodes) : null) ||
            (peSeasonsCol && peSeasonsCol.style.display !== 'none' ? firstIn(peSeasons) : null);
    if (f) { setFocus(f); }
  }

  function closeEpisodeBrowser(keepFocus) {
    if (!episodeBrowser || !state.episodeBrowserOpen) { return; }
    state.episodeBrowserOpen = false;
    episodeBrowser.classList.remove('is-active');
    if (!keepFocus && state.screen === 'player' && playerStage) { setFocus(playerStage); }
  }

  function renderEpisodeBrowser() {
    var item = state.playerItem;
    if (!item || !episodeBrowser) { return; }
    var seasons = seriesSeasons(item);
    if (state.browserSeason >= seasons.length) { state.browserSeason = 0; }
    if (state.browserSeason < 0) { state.browserSeason = 0; }
    var season = seasons[state.browserSeason];
    var playingSeason = seasons[state.playerSeasonIndex] || seasons[0];
    var ep = state.playerEpisode;

    if (peTitle) { peTitle.textContent = item.title || ''; }
    if (peSub) {
      if (ep) {
        var tag = [];
        if (playingSeason && playingSeason.number) { tag.push('T' + playingSeason.number); }
        if (ep.number) { tag.push('E' + ep.number); }
        peSub.textContent = 'Reproduciendo ' + tag.join(' ') + ' · ' + episodeDisplayTitle(item, ep);
      } else {
        peSub.textContent = 'Elige un episodio';
      }
    }
    if (peSeasonLabel) {
      peSeasonLabel.textContent = 'Episodios · Temporada ' + ((season && season.number) || (state.browserSeason + 1));
    }

    renderBrowserSeasons(item, seasons);
    renderBrowserEpisodes(item, season);
  }

  function renderBrowserSeasons(item, seasons) {
    if (!peSeasons || !peSeasonsCol) { return; }
    clear(peSeasons);
    peSeasonsCol.style.display = 'flex';
    for (var i = 0; i < seasons.length; i++) {
      (function (idx) {
        var s = seasons[idx];
        var b = el('div', 'pe-season focusable', 'Temporada ' + (s.number || (idx + 1)));
        if (idx === state.browserSeason) { b.classList.add('is-selected'); }
        /* Netflix behaviour: just moving the season rail already shows that
           season's episodes, so OK is only needed to jump into the list. */
        b._onFocus = function () {
          if (state.browserSeason !== idx) { selectBrowserSeason(idx, false); }
        };
        b._activate = function () { selectBrowserSeason(idx, true); };
        peSeasons.appendChild(b);
      })(i);
    }
  }

  function renderBrowserEpisodes(item, season) {
    if (!peEpisodes || !season) { return; }
    clear(peEpisodes);
    var cached = (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length)
      ? item.episodes : (season._episodes || []);

    if (!cached.length) {
      peEpisodes.appendChild(makeLoader('Cargando episodios…', 'is-small pe-loading'));
      seasonEpisodes(item, season, function (eps) {
        if (!state.episodeBrowserOpen) { return; }
        var now = seriesSeasons(item)[state.browserSeason];
        if (now !== season) { return; }
        renderBrowserEpisodes(item, season);
        /* Only re-anchor focus when the user is already inside the list; when
           they are browsing seasons the rail keeps the d-pad. */
        if (closest(state.focus, '#pe-episodes')) {
          var cur = peEpisodes.querySelector('.pe-ep.is-current');
          var f = cur || firstIn(peEpisodes);
          if (f) { setFocus(f); }
        }
      });
      return;
    }

    /* Keep the drawer within the small webOS 4 renderer budget.  A full
       season can contain dozens of poster images; decoding all of them while
       video is active can make the system kill the app for memory. */
    /* Desktop has no such memory limit and no artwork here: list them all. */
    var visibleEpisodes = window.OPENTV_DESKTOP ? cached.length : Math.min(cached.length, 24);
    for (var i = 0; i < visibleEpisodes; i++) {
      (function (ep, idx) {
        var row = el('div', 'pe-ep focusable');
        var num = (ep.number !== undefined && ep.number !== null) ? ep.number : (idx + 1);
        row.appendChild(el('div', 'pe-num', String(num)));

        var thumb = el('div', 'pe-thumb');
        /* Deliberately no <img> per episode: remote artwork is the dominant
           memory cost in this overlay on a 1 GB webOS 4 TV. */
        var playIcon = el('div', 'pe-thumb-play', '▶');
        thumb.appendChild(playIcon);
        row.appendChild(thumb);

        var info = el('div', 'pe-info');
        info.appendChild(el('div', 'pe-name', episodeDisplayTitle(item, ep, idx)));
        var bits = [];
        var dur = episodeDurationLabel(ep);
        if (dur) { bits.push(dur); }
        if (ep.quality) { bits.push(String(ep.quality).split(',')[0].toUpperCase()); }
        if (window.OPENTV_DESKTOP && episodeLangTag(ep)) { bits.push(episodeLangTag(ep)); }
        info.appendChild(el('div', 'pe-meta', bits.join('   ·   ')));
        if (ep.description) {
          info.appendChild(el('div', 'pe-desc', ep.description));
        }
        row.appendChild(info);

        /* Same id, or (without ids) same number in the season that is playing.
           Comparing only the number marked episode 1 of every season. */
        var pe = state.playerEpisode;
        var isPlaying = !!pe && (pe === ep || (pe.id && ep.id ? pe.id === ep.id :
          (pe.number !== undefined && pe.number === ep.number && state.browserSeason === state.playerSeasonIndex)));
        row.appendChild(el('div', 'pe-badge', '▶ REPRODUCIENDO'));
        if (isPlaying) {
          row.classList.add('is-current');
        }
        row._activate = function () { chooseEpisode(ep); };
        peEpisodes.appendChild(row);
      })(cached[i], i);
    }
    if (cached.length > visibleEpisodes) {
      peEpisodes.appendChild(el('div', 'pe-loading', 'Mostrando los primeros ' + visibleEpisodes + ' capítulos'));
    }
  }

  /* Repaints the rail's selection without rebuilding the nodes, so the
     focused season keeps the d-pad while the list on the right updates. */
  function updateBrowserSeasonSelection() {
    if (!peSeasons) { return; }
    var rows = peSeasons.children;
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('is-selected', i === state.browserSeason);
    }
  }

  function selectBrowserSeason(idx, moveFocus) {
    var item = state.playerItem;
    var seasons = seriesSeasons(item);
    if (!seasons[idx]) { return; }
    state.browserSeason = idx;
    updateBrowserSeasonSelection();
    if (peSeasonLabel) {
      peSeasonLabel.textContent = 'Episodios · Temporada ' + (seasons[idx].number || (idx + 1));
    }
    renderBrowserEpisodes(item, seasons[idx]);
    if (moveFocus) {
      var cur = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
      if (cur) { setFocus(cur); }
    }
  }

  function seasonIndexOfEpisode(item, ep) {
    var seasons = seriesSeasons(item);
    function has(list) {
      if (!list) { return false; }
      for (var e = 0; e < list.length; e++) {
        if (list[e] === ep || (ep.id && list[e] && list[e].id === ep.id)) { return true; }
      }
      return false;
    }
    /* The season shown in the episode browser is the most likely one. */
    var order = [];
    if (state.browserSeason !== undefined && state.browserSeason !== null) { order.push(state.browserSeason); }
    for (var i = 0; i < seasons.length; i++) { if (order.indexOf(i) === -1) { order.push(i); } }
    for (var k = 0; k < order.length; k++) {
      var s = seasons[order[k]];
      if (!s) { continue; }
      var list = (s.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) ? item.episodes : s._episodes;
      if (has(list)) { return order[k]; }
    }
    return -1;
  }

  function chooseEpisode(ep) {
    var item = state.playerItem;
    if (!item || !ep) { return; }
    var seasons = seriesSeasons(item);
    var prev = seasons[state.playerSeasonIndex];
    if (prev && prev.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) {
      prev._episodes = item.episodes;
    }
    /* Use the season the chosen episode belongs to. Taking the season that
       was playing sent "T6 episode 1" inside "T1", and the portal answered
       portal100008 (the programme does not exist). */
    var sIdx = seasonIndexOfEpisode(item, ep);
    if (sIdx < 0) {
      sIdx = state.episodeBrowserOpen ? (state.browserSeason || 0)
        : ((state.playerSeasonIndex !== undefined && state.playerSeasonIndex !== null) ? state.playerSeasonIndex : 0);
    }
    state.playerSeasonIndex = sIdx;
    var season = seasons[sIdx];
    if (season) {
      if (state.detailSeason !== sIdx) {
        state.detailSeason = sIdx;
        state.detailNeedsRebuild = true;
      }
      if (season.id) { item.seasonId = season.id; }
      if (season._episodes) { item.episodes = season._episodes; }
    }
    closeEpisodeBrowser();
    if (playSettingViewOpen) { closePlaySettingView(); }
    playEpisode(item, ep);
  }

  /* Single path for changing episode while watching: keeps the detail screen,
     the infobar and the resolver on the same episode. */
  function playEpisode(item, ep) {
    if (!item || !ep) { return; }
    /* From the details screen: that episode, full screen (choosing its
       source first when needed). The switch below only runs inside the
       player; here it left "Cambiando capítulo…" on screen for good. */
    if (state.screen !== 'player') {
      state.detailEpisode = ep;
      syncDetailEpisodeHighlight(item);
      expandToFullscreen(item, ep);
      return;
    }
    state.playerItem = item;
    state.playerEpisode = ep;
    state.detailEpisode = ep;
    state.playerSeasonIndex = state.detailSeason || 0;
    /* Drop the previous episode's subtitles right away; the new episode
       loads its own. They stayed on screen over a failed episode switch. */
    subtitleSeq++;
    activeSubtitleCues = [];
    if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
    if (playerStage && playerInfo) { updatePlayer(); }
    syncDetailEpisodeHighlight(item);
    /* Starfish retains the old UMS/video pipeline briefly after src is
       cleared.  Starting a new episode in the same turn can exceed the RAM
       budget of webOS 4, especially with the FFmpeg relay.  Release first,
       then create exactly one replacement pipeline. */
    if (state.episodeSwitchTimer) { clearTimeout(state.episodeSwitchTimer); }
    state.episodeSwitchSeq = (state.episodeSwitchSeq || 0) + 1;
    var switchSeq = state.episodeSwitchSeq;
    stopPlayerVideo();
    setPlayerStatus('Cambiando capítulo…');
    state.episodeSwitchTimer = setTimeout(function () {
      state.episodeSwitchTimer = null;
      if (switchSeq !== state.episodeSwitchSeq || state.screen !== 'player') { return; }
      startPlayerVideo(item, ep);
    }, 600);
  }

  function episodeListForCurrentSeason(item) {
    var seasons = seriesSeasons(item);
    var season = seasons[state.playerSeasonIndex] || seasons[0];
    if (!season) { return []; }
    if (season.id === (item.seasonId || item.id) && item.episodes && item.episodes.length) { return item.episodes; }
    return season._episodes || [];
  }

  function showNextEpisodeLoading(item) {
    if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
    if (!nextEpisodeLoading) { return; }
    var image = (item && (item.backdrop || item.landscape || item.poster)) || '';
    nextEpisodeLoading.style.backgroundImage = image ? 'url("' + String(image).replace(/"/g, '%22') + '")' : '';
    nextEpisodeLoading.classList.add('is-active');
  }

  function hideNextEpisodeLoading() {
    if (!nextEpisodeLoading) { nextEpisodeLoading = $('next-episode-loading'); }
    if (!nextEpisodeLoading) { return; }
    nextEpisodeLoading.classList.remove('is-active');
    nextEpisodeLoading.style.backgroundImage = '';
  }

  function advanceToNextEpisode() {
    var item = state.playerItem;
    if (!item || !isSeriesItem(item) || state.screen !== 'player') { return; }
    var episodes = episodeListForCurrentSeason(item);
    var current = state.playerEpisode;
    var index = -1;
    for (var i = 0; i < episodes.length; i++) {
      if (current && (episodes[i].id === current.id || episodes[i].number === current.number)) { index = i; break; }
    }
    if (index < 0) { return; }
    showNextEpisodeLoading(item);
    if (index + 1 < episodes.length) {
      playEpisode(item, episodes[index + 1]);
      return;
    }
    /* At the end of a season, fetch only the first chapter of the next one.
       The previous season's episode array stays cached, so this does not turn
       the compact player selector into a full all-season list. */
    var seasons = seriesSeasons(item);
    var nextSeasonIndex = (state.playerSeasonIndex || 0) + 1;
    var nextSeason = seasons[nextSeasonIndex];
    if (!nextSeason) { hideNextEpisodeLoading(); return; }
    var endedEpisode = current;
    seasonEpisodes(item, nextSeason, function (nextEpisodes) {
      if (state.playerItem !== item || state.playerEpisode !== endedEpisode || state.screen !== 'player') {
        return;
      }
      if (!nextEpisodes || !nextEpisodes.length) { hideNextEpisodeLoading(); return; }
      state.detailSeason = nextSeasonIndex;
      state.playerSeasonIndex = nextSeasonIndex;
      item.seasonId = nextSeason.id || item.seasonId;
      item.episodes = nextEpisodes;
      nextSeason._episodes = nextEpisodes;
      playEpisode(item, nextEpisodes[0]);
    });
  }

  function syncDetailEpisodeHighlight(item) {
    if (!detailBottom) { return; }
    /* TVs: only the episode in the history is marked "Viendo" (the first
       one of a series never watched was marked too). */
    var watched = platformIsTv() && item ? historyRecordFor(item) : null;
    var watchedId = watched && watched.episodeId ? String(watched.episodeId) : '';
    var tiles = detailBottom.querySelectorAll('.detail-episode');
    for (var i = 0; i < tiles.length; i++) {
      var on = platformIsTv()
        ? !!(tiles[i]._ep && watchedId && String(tiles[i]._ep.id) === watchedId)
        : !!(tiles[i]._ep && state.detailEpisode && tiles[i]._ep.id === state.detailEpisode.id);
      tiles[i].classList.toggle('is-playing', on);
    }
  }

  /* ---- player/next-episode.js ------------------------------------------------ */
  /* player/next-episode.js — Al terminar un episodio: cuenta atrás de 10 s con "Siguiente episodio" o "Salir".
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var NEXT_EPISODE_SECONDS = 10;
  var nextEpisodePrompt = null;
  var nextEpisodeTimer = null;
  var nextEpisodeTick = null;

  /* The episode after the current one: { episode, label } or null. */
  function upcomingEpisode(item) {
    var episodes = episodeListForCurrentSeason(item);
    var current = state.playerEpisode;
    for (var i = 0; i < episodes.length; i++) {
      if (current && (episodes[i].id === current.id || episodes[i].number === current.number)) {
        if (i + 1 < episodes.length) {
          var ep = episodes[i + 1];
          var num = (ep.number !== undefined && ep.number !== null) ? ep.number : i + 2;
          var title = episodeDisplayTitle(item, ep, i + 1);
          return { label: 'Episodio ' + num + (title && title !== 'Episodio ' + num ? ' · ' + title : '') };
        }
        break;
      }
    }
    var seasons = seriesSeasons(item);
    if (seasons[(state.playerSeasonIndex || 0) + 1]) { return { label: 'Primer episodio de la siguiente temporada' }; }
    return null;
  }

  function offerNextEpisode() {
    var item = state.playerItem;
    if (!item || !isSeriesItem(item) || state.screen !== 'player') { return; }
    var next = upcomingEpisode(item);
    if (!next) { return; }
    hideNextEpisodePrompt();
    showOsdIcon('none');
    if (!nextEpisodePrompt) {
      nextEpisodePrompt = el('div', 'next-episode-prompt');
      nextEpisodePrompt.setAttribute('data-no-gesture', '');
      nextEpisodePrompt.addEventListener('click', function (event) { event.stopPropagation(); });
      playerStage.appendChild(nextEpisodePrompt);
    }
    clear(nextEpisodePrompt);
    nextEpisodePrompt.appendChild(el('div', 'nep-kicker', 'Siguiente episodio'));
    nextEpisodePrompt.appendChild(el('div', 'nep-title', next.label));
    var bar = el('div', 'nep-bar');
    var fill = el('i', 'nep-fill');
    fill.style.animationDuration = NEXT_EPISODE_SECONDS + 's';
    bar.appendChild(fill);
    nextEpisodePrompt.appendChild(bar);
    var actions = el('div', 'nep-actions');
    var go = el('div', 'nep-btn is-primary focusable');
    go.innerHTML = UI_ICONS.play + '<span>Reproducir ahora · ' + NEXT_EPISODE_SECONDS + '</span>';
    var label = go.querySelector('span');
    go._activate = function () { hideNextEpisodePrompt(); advanceToNextEpisode(); };
    var exit = el('div', 'nep-btn focusable');
    exit.innerHTML = UI_ICONS.back + '<span>Salir</span>';
    exit._activate = function () { hideNextEpisodePrompt(); desktopBack(); };
    /* The card stops clicks from reaching the video, so the buttons handle
       their own clicks. */
    go.addEventListener('click', function () { go._activate(); });
    exit.addEventListener('click', function () { exit._activate(); });
    actions.appendChild(go);
    actions.appendChild(exit);
    nextEpisodePrompt.appendChild(actions);
    nextEpisodePrompt.classList.add('is-visible');
    setFocus(go, true);

    var left = NEXT_EPISODE_SECONDS;
    nextEpisodeTick = setInterval(function () {
      left--;
      if (label) { label.textContent = 'Reproducir ahora · ' + Math.max(0, left); }
      if (state.screen !== 'player' || state.playerItem !== item) { hideNextEpisodePrompt(); }
    }, 1000);
    nextEpisodeTimer = setTimeout(function () {
      hideNextEpisodePrompt();
      if (state.screen === 'player' && state.playerItem === item) { advanceToNextEpisode(); }
    }, NEXT_EPISODE_SECONDS * 1000);
    /* Seeking back or pressing play again means "keep watching this one". */
    playerVideo.addEventListener('play', hideNextEpisodePrompt, { once: true });
  }

  function hideNextEpisodePrompt() {
    if (nextEpisodeTimer) { clearTimeout(nextEpisodeTimer); nextEpisodeTimer = null; }
    if (nextEpisodeTick) { clearInterval(nextEpisodeTick); nextEpisodeTick = null; }
    if (nextEpisodePrompt) { nextEpisodePrompt.classList.remove('is-visible'); }
  }

  /* ---- player/resume.js ------------------------------------------------------ */
  /* player/resume.js — Seguir donde te quedaste (película o episodio), ver desde el principio y barra de avance continua.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The history already stores, per title, the episode and the second where
     playback stopped. Here it is used: opening a series selects that episode
     (or the next one if it was finished), and Reanudar starts at that second.
     "Ver desde el principio" (detail page) plays it from 0 instead: on a TV,
     seeking back an hour with the remote is no option. Every platform: on
     Android the native player gets the second as its start position. */
  var RESUME_MIN_S = 10;
  var resumePlan = null;
  var resumeRestarted = false;
  /* item|episode key that the next planResume must start from 0. */
  var resumeFromStartKey = '';

  function resumeKeyFor(item, episode) {
    return String(item.id) + '|' + (episode ? String(episode.id) : '');
  }

  /* Detail page: is there a second to resume at for what Reproducir plays? */
  function canStartOver(item, episode) {
    if (!item) { return false; }
    if (isSeriesItem(item)) { return !!episode && resumePositionFor(item, episode) > 0; }
    return resumePositionFor(item, null) > 0;
  }

  /* "Ver desde el principio": the same title or episode, from second 0. The
     saved position is overwritten as it plays (resumeRestarted). */
  function startOverTitle(item, episode) {
    resetResumePlan();
    resumeFromStartKey = resumeKeyFor(item, episode);
    /* A video left loaded on the detail page would be reused where it was. */
    if (playerVideo && playerVideo.src && state.playerItem === item) { stopPlayerVideo(); }
    expandToFullscreen(item, episode);
  }

  /* Accepts the title or its id. Grouped series may have been saved under a
     season id, so those and the title are tried too. */
  function historyRecordFor(itemOrId) {
    var list = localProfile.history || [];
    var item = itemOrId && typeof itemOrId === 'object' ? itemOrId : null;
    var id = String(item ? item.id : itemOrId);
    var seasonId = item && item.seasonId ? String(item.seasonId) : '';
    var i;
    for (i = 0; i < list.length; i++) {
      if (!list[i]) { continue; }
      var recId = String(list[i].id);
      var recSeasonId = list[i].seasonId ? String(list[i].seasonId) : '';
      if (recId === id || (seasonId && (recId === seasonId || recSeasonId === seasonId)) || (recSeasonId && recSeasonId === id)) {
        return list[i];
      }
    }
    if (!item) { return null; }
    var seasons = (item._catalogSeasons && item._catalogSeasons.length) ? item._catalogSeasons : (item.seasons || []);
    var title = norm(item.title || item.name || '');
    /* Matching by title/season only within the same catalog: a Stremio title
       never takes the position (or the source) of the integrated catalog's
       title of the same name, and the other way round. */
    var fromAddon = !!item._stremio || String(item.id).indexOf('stremio:') === 0;
    for (i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) { continue; }
      if ((!!r.stremio || String(r.id).indexOf('stremio:') === 0) !== fromAddon) { continue; }
      for (var s = 0; s < seasons.length; s++) {
        var sid = String(seasons[s].id);
        if (sid === String(r.id) || (r.seasonId && sid === String(r.seasonId))) { return r; }
      }
      if (title && r.title && norm(r.title) === title && !!r.series === !!isSeriesItem(item)) { return r; }
    }
    return null;
  }

  function recordFinished(r) {
    return !!(r && r.duration > 60 && (r.position / r.duration > 0.95 || r.duration - r.position < 45));
  }

  /* Second to resume at for this title/episode, or 0. */
  function resumePositionFor(item, episode) {
    if (!item) { return 0; }
    var r = historyRecordFor(item);
    if (!r || (r.position || 0) < RESUME_MIN_S || recordFinished(r)) { return 0; }
    if (r.series || isSeriesItem(item)) {
      if (!episode) { return 0; }
      var idMatch = r.episodeId && String(episode.id) === String(r.episodeId);
      var numMatch = !idMatch && r.episodeNumber &&
        String(episode.number || episode.seriesNumber || '') === String(r.episodeNumber) &&
        (!r.seasonId || !item.seasonId || String(r.seasonId) === String(item.seasonId));
      if (!idMatch && !numMatch) { return 0; }
    }
    return Math.floor(r.position);
  }

  /* Detail page: pick the episode the viewer was on (the next one when it
     was finished). */
  function preferHistoryEpisode(item) {
    if (!window.OPENTV_DESKTOP || !item) { return; }
    var r = historyRecordFor(item);
    if (r && r.episodeId) { pendingHistoryRecord = r; }
  }

  /* Called when a title starts playing (detail preview or full screen). */
  var resumePlannedKey = '';
  /* A new request to watch a title (detail page, play buttons, Seguir viendo)
     plans again even if it is the title that played last. */
  /* One retry loop at a time: video events also call applyResumePlan, and
     parallel loops used up the tries (and the hold) several times faster. */
  var resumeRetryTimer = null;
  function scheduleResumeRetry(ms) {
    if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); }
    resumeRetryTimer = setTimeout(function () { resumeRetryTimer = null; applyResumePlan(); }, ms);
  }
  function resetResumePlan() {
    if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null; }
    resumePlannedKey = '';
    resumePlan = null;
    resumeRestarted = false;
    resumeFromStartKey = '';
  }
  /* While a jump to the saved second is pending, the first seconds of the
     video must not overwrite that saved second. */
  function resumePending(item) {
    if (!resumePlan || !item) { return false; }
    var sameItem = resumePlan.item === item || String(resumePlan.itemId) === String(item.id);
    if (!sameItem) { return false; }
    if (vodPlaybackPosition() >= resumePlan.pos - 5) {
      resumePlan = null;
      return false;
    }
    return true;
  }
  function planResume(item, episode) {
    if (!window.OPENTV_DESKTOP || !item) { return; }
    var key = resumeKeyFor(item, episode);
    if (resumeFromStartKey) {
      var fromStart = resumeFromStartKey === key;
      resumeFromStartKey = '';
      if (fromStart) {
        if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null; }
        resumePlannedKey = key;
        resumePlan = null;
        resumeRestarted = true;
        return;
      }
    }
    /* Restarts of the same video (compatibility mode, retries) keep their own
       position if the resume plan was already satisfied. */
    if (key === resumePlannedKey && (!resumePlan || vodPlaybackPosition() >= resumePlan.pos - 5)) {
      return;
    }
    resumePlannedKey = key;
    resumeRestarted = false;
    if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null; }
    var pos = resumePositionFor(item, episode);
    resumePlan = pos ? {
      item: item,
      itemId: String(item.id),
      episodeId: episode ? String(episode.id) : '',
      pos: pos,
      tries: 0,
      held: false,
      notified: false
    } : null;
  }

  function notifyResumeToast(pos) {
    setPlayerStatus('Reanudando desde ' + formatTime(pos).replace(/^00:/, ''));
    setTimeout(function () {
      if (/^Reanudando/.test((playerStatus && playerStatus.textContent) || '')) {
        setPlayerStatus('');
      }
    }, 1800);
  }

  function applyResumePlan() {
    var plan = resumePlan;
    if (!plan || state.playerMode !== 'vod') { return; }
    if (state.playerItem !== plan.item && (!state.playerItem || String(state.playerItem.id) !== String(plan.itemId))) { return; }
    var ep = state.playerEpisode;
    if (plan.episodeId && (!ep || String(ep.id) !== plan.episodeId)) { resumePlan = null; return; }

    var currentPos = vodPlaybackPosition();
    /* A relay asked to start at plan.pos may really start a few seconds
       earlier (at the keyframe before it, see ffmpeg-relay.js): that is the
       resume point too, not a stream that started at 0. */
    if (currentPos >= plan.pos - 5 || (relayBaseUrl && relayRequestedStart >= plan.pos - 5)) {
      var wasHeld = plan.held;
      var wasNotified = plan.notified;
      var targetPos = plan.pos;
      resumePlan = null;
      if (wasHeld || playerVideo.paused) { setTimeout(resumePlayerPlayback, 100); }
      if (!wasNotified) { notifyResumeToast(targetPos); }
      return;
    }

    /* If we are on arelay stream that started at 0 instead of plan.pos, jump via ?start= */
    if (relayBaseUrl && relayRequestedStart < plan.pos - 5 && !relaySeekInFlight) {
      plan.notified = true;
      var relayTarget = Math.floor(plan.pos);
      var rUrl = relayBaseUrl + '?start=' + relayTarget + '&a=' + (vodCurrentAudioTrack || 0);
      notifyResumeToast(plan.pos);
      playUrl(rUrl);
      return;
    }

    /* If we are on a local proxy TS stream that cannot seek ahead without indexing
       the whole file, and the service provided a relayUrl, jump immediately via FFmpeg relay. */
    if (!relayBaseUrl && state.playerItem && state.playerItem._relayUrl &&
        /\/media\/[^/]+\/stream\.ts$/i.test(lastPlayingUrl || '')) {
      plan.notified = true;
      var fUrl = state.playerItem._relayUrl + '?start=' + Math.floor(plan.pos) + '&a=' + (vodCurrentAudioTrack || 0);
      notifyResumeToast(plan.pos);
      playUrl(fUrl);
      return;
    }

    var seekableEnd = 0;
    if (!relayBaseUrl && playerVideo.seekable && playerVideo.seekable.length) {
      seekableEnd = playerVideo.seekable.end(playerVideo.seekable.length - 1);
    }
    var knownDur = vodPlaybackDuration();
    var reachable = relayBaseUrl ? true : (seekableEnd >= plan.pos || (playerVideo.readyState >= 1 && isFinite(playerVideo.duration) && playerVideo.duration >= plan.pos));
    if ((knownDur > 0 && knownDur < plan.pos + 2 && !reachable) || !reachable) {
      plan.tries = (plan.tries || 0) + 1;
      if (!plan.held && plan.tries < 40 && !playerVideo.paused) {
        plan.held = true;
        try { playerVideo.pause(); } catch (ePause) { /* ignore */ }
        setPlayerStatus('Reanudando desde ' + formatTime(plan.pos).replace(/^00:/, '') + '…');
      }
      if (plan.tries === 40 && plan.held) { plan.held = false; setPlayerStatus(''); resumePlayerPlayback(); }
      if (plan.tries < 280) { scheduleResumeRetry(350); }
      else { resumePlan = null; }
      return;
    }

    try { playerVideo.currentTime = plan.pos; } catch (eSeek) { /* ignore */ }
    if (vodPlaybackPosition() >= plan.pos - 5) {
      var heldNow = plan.held;
      var posNow = plan.pos;
      resumePlan = null;
      if (heldNow || playerVideo.paused) { setTimeout(resumePlayerPlayback, 150); }
      notifyResumeToast(posNow);
    } else {
      plan.tries = (plan.tries || 0) + 1;
      if (plan.tries < 60) { scheduleResumeRetry(300); }
      else { resumePlan = null; }
    }
  }

  /* Text for the detail page's play button. */
  function resumeLabelFor(item) {
    var r = historyRecordFor(item);
    if (!r || (r.position || 0) < RESUME_MIN_S) { return ''; }
    if (r.series || isSeriesItem(item)) {
      var sPrefix = r.seasonNumber ? ('T' + r.seasonNumber + ':') : '';
      if (recordFinished(r)) {
        return r.episodeNumber ? ('Ver ' + sPrefix + 'E' + (parseInt(r.episodeNumber, 10) + 1)) : '';
      }
      return 'Reanudar' + (r.episodeNumber ? (' · ' + sPrefix + 'E' + r.episodeNumber) : '') + ' · ' + formatTime(r.position).replace(/^00:/, '');
    }
    if (recordFinished(r)) { return ''; }
    return 'Reanudar · ' + formatTime(r.position).replace(/^00:/, '');
  }

  /* ------------------------------------------------- smooth progress bar */
  /* timeupdate fires ~4 times a second, so the handle moved in jumps; while
     the controls are visible it follows the video every frame. */
  var smoothProgressFrame = 0;
  function smoothProgressTick() {
    smoothProgressFrame = 0;
    if (state.screen !== 'player' || state.playerMode !== 'vod' || !playerVideo || playerVideo.paused || vodScrubbing) { return; }
    var bar = $('player-vod-infobar');
    if (!bar || !bar.classList.contains('is-active')) { return; }
    var duration = vodPlaybackDuration();
    if (duration > 0 && vodSeekProgress) {
      var pct = Math.max(0, Math.min(100, vodPlaybackPosition() / duration * 100));
      vodSeekProgress.style.width = pct + '%';
      if (vodSeekThumb) { vodSeekThumb.style.left = pct + '%'; }
    }
    smoothProgressFrame = requestAnimationFrame(smoothProgressTick);
  }
  function kickSmoothProgress() {
    if (!smoothProgressFrame) { smoothProgressFrame = requestAnimationFrame(smoothProgressTick); }
  }

  function installResume() {
    if (!window.OPENTV_DESKTOP || !playerVideo || playerVideo._resumeHooks) { return; }
    playerVideo._resumeHooks = true;
    playerVideo.addEventListener('loadedmetadata', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
    playerVideo.addEventListener('canplay', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
    playerVideo.addEventListener('playing', function () { applyResumePlan(); kickSmoothProgress(); });
    playerVideo.addEventListener('timeupdate', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
    document.addEventListener('pointermove', kickSmoothProgress, { passive: true });
  }

  /* ---- player/settings-dialog.js --------------------------------------------- */
  /* player/settings-dialog.js — Diálogo de audio/subtítulos, formato de pantalla y cambio de pista.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function renderPlaySettingPlayerOptions() {
    /* 'normal' is the default direct path; only 'relay'/'smooth' means FFmpeg. */
    var isRelay = (state.streamMode === 'relay' || state.streamMode === 'smooth');
    if (psvBtnP1) {
      psvBtnP1.classList.toggle('is-selected', isRelay);
      var chk1 = psvBtnP1.querySelector('.psv-check');
      if (chk1) chk1.style.display = isRelay ? 'block' : 'none';
    }
    if (psvBtnP2) {
      psvBtnP2.classList.toggle('is-selected', !isRelay);
      var chk2 = psvBtnP2.querySelector('.psv-check');
      if (chk2) chk2.style.display = !isRelay ? 'block' : 'none';
    }
  }

  function renderPlaySettingAspectOptions() {
    if (!psvAspectRow) return;
    var btns = psvAspectRow.querySelectorAll('.psv-btn');
    for (var i = 0; i < btns.length; i++) {
      var asp = btns[i].getAttribute('data-aspect');
      var isSel = (asp === playerCurrentAspect);
      btns[i].classList.toggle('is-selected', isSel);
      var chk = btns[i].querySelector('.psv-check');
      if (chk) chk.style.display = isSel ? 'block' : 'none';
    }
  }

  function setPlayerAspect(aspect) {
    playerCurrentAspect = aspect || 'contain';
    if (playerVideo) {
      playerVideo.classList.remove('aspect-cover', 'aspect-contain', 'aspect-16-9', 'aspect-4-3');
      playerVideo.classList.add('aspect-' + playerCurrentAspect);
    }
    renderPlaySettingAspectOptions();
  }

  function openPlaySettingsDialog(fromItem) {
    if (!dialogPlaySettings) { buildPlayer(); }
    if (!dialogPlaySettings) return;
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    dialogPlaySettingsOpen = true;
    dialogReturnFocus = state.focus;

    var item = fromItem || playSettingsItem();
    if (state.screen === 'detail') { item = state.detail || item; }

    renderDialogAudio();
    renderDialogSubtitle();
    applySubtitleStyles();

    dialogPlaySettings.classList.add('is-active');

    ensureMediaInfo(item, function () {
      if (!dialogPlaySettingsOpen) { return; }
      renderDialogAudio();
      renderDialogSubtitle();
    });

    /* Focus first audio pill or switch */
    var firstFocus = (dpsAudioOptions && dpsAudioOptions.querySelector('.focusable')) || dpsSubSwitch || dpsBtnExit;
    if (firstFocus) { setFocus(firstFocus); }
  }

  function closePlaySettingsDialog() {
    dialogPlaySettingsOpen = false;
    if (dialogPlaySettings) { dialogPlaySettings.classList.remove('is-active'); }
    if (playSettingViewOpen) {
      if (psvBtnConfig) { setFocus(psvBtnConfig); }
      schedulePlaySettingHide();
    } else if (dialogReturnFocus && isVisible(dialogReturnFocus)) {
      setFocus(dialogReturnFocus);
    } else if (state.screen === 'player') {
      setFocus(playerStage);
    }
    dialogReturnFocus = null;
  }

  function renderDialogAudio() {
    if (!dpsAudioOptions) return;
    clear(dpsAudioOptions);

    var item = playSettingsItem();
    var info = mediaInfoCache[mediaInfoKey(item)];
    /* Addon titles: the track playing is the one the relay was asked for,
       never a guess from the language list. */
    if (info && !vodAudioChosen && !(item && item._stremio)) {
      vodCurrentAudioTrack = preferredAudioIndex(info.audio);
    }
    var tracks = audioLanguageList(info);
    if (!tracks.length) {
      /* Not known yet (the service reads an addon's file once it plays):
         never claim a language the file may not have. */
      tracks = [{ index: vodCurrentAudioTrack || 0, label: item && item._stremio ? 'Audio del archivo' : 'Español' }];
    }
    for (var t = 0; t < tracks.length; t++) {
      (function (track) {
        var btn = el('button', 'dps-btn focusable');
        btn.textContent = track.label;
        if (vodCurrentAudioTrack === track.index) { btn.classList.add('is-selected'); }
        btn._activate = function () {
          switchAudioTrack(track.index);
          renderDialogAudio();
          schedulePlaySettingHide();
        };
        dpsAudioOptions.appendChild(btn);
      })(tracks[t]);
    }
  }

  function renderDialogSubtitle() {
    var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
    var list = subtitleLanguageList(info);

    var subItem = playSettingsItem();
    var canImport = !!(subItem && subItem._stremio) && typeof importSubtitleFile === 'function';
    if (dpsSubSwitch) {
      /* Without subtitle files there is nothing to switch on (addon titles
         still show the row: the viewer can import a file). */
      var switchRow = dpsSubSwitch.parentNode;
      if (switchRow) { switchRow.classList.toggle('is-hidden', !list.length && !canImport); }
      dpsSubSwitch.classList.toggle('is-hidden', !list.length);
      var importBtn = $('dps-sub-import');
      if (canImport && switchRow && !importBtn) {
        importBtn = el('button', 'dps-btn focusable dps-import', 'Importar…');
        importBtn.id = 'dps-sub-import';
        importBtn.title = 'Usar un archivo .srt o .vtt de tu equipo';
        switchRow.appendChild(importBtn);
      }
      if (importBtn) {
        importBtn.classList.toggle('is-hidden', !canImport);
        importBtn._activate = function () {
          importSubtitleFile(function (err, sub) {
            if (err) { setPlayerStatus(err); return; }
            var info2 = stremioMediaInfo(subItem);
            info2._importedSubs = [sub].concat((info2._importedSubs || []).filter(function (s) { return s.label !== sub.label; }));
            composeStremioSubtitles(subItem, info2);
            vodCurrentSubtitle = sub;
            vodSubActive = true;
            vodSubChosen = true;
            loadSubtitleTrack(sub);
            renderDialogSubtitle();
          });
        };
      }
      dpsSubSwitch.classList.toggle('is-on', vodSubActive);
      var dotText = dpsSubSwitch.querySelector('.dps-switch-text');
      if (dotText) dotText.textContent = vodSubActive ? 'ON' : 'OFF';
    }

    if (dpsRowLang) dpsRowLang.classList.toggle('is-visible', vodSubActive && list.length > 0);
    if (dpsRowSize) dpsRowSize.classList.toggle('is-visible', vodSubActive && list.length > 0);
    if (dpsRowStyle) dpsRowStyle.classList.toggle('is-visible', vodSubActive && list.length > 0);
    if (dpsRowSync) dpsRowSync.classList.toggle('is-visible', vodSubActive && list.length > 0);

    if (!vodSubActive) return;

    /* Render languages */
    if (dpsLangOptions) {
      clear(dpsLangOptions);
      for (var s = 0; s < list.length; s++) {
        (function (sub) {
          var btn = el('button', 'dps-btn focusable');
          btn.textContent = sub.label || formatAudioLang(sub.lang || 'Sub');
          if (vodCurrentSubtitle && vodCurrentSubtitle.url === sub.url) {
            btn.classList.add('is-selected');
          }
          btn._activate = function () {
            vodCurrentSubtitle = sub;
            vodSubActive = true;
            vodSubChosen = true;
            loadSubtitleTrack(sub);
            renderDialogSubtitle();
            schedulePlaySettingHide();
          };
          dpsLangOptions.appendChild(btn);
        })(list[s]);
      }
    }

    /* Size buttons */
    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        var sz = sBtns[si].getAttribute('data-size');
        sBtns[si].classList.toggle('is-selected', sz === vodSubSize);
      }
    }

    /* Style buttons */
    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        var st = stBtns[sti].getAttribute('data-style');
        stBtns[sti].classList.toggle('is-selected', st === vodSubStyle);
      }
    }

    /* Sync buttons */
    if (dpsSyncOptions) {
      var resetBtn = $('dps-sync-reset');
      if (resetBtn) {
        var sign = vodSubOffset > 0 ? '+' : '';
        resetBtn.textContent = vodSubOffset === 0
          ? '0.0 s (Normal)'
          : (sign + vodSubOffset.toFixed(1) + ' s · Restablecer');
        resetBtn.classList.toggle('is-selected', vodSubOffset !== 0);
      }
    }
  }

  function formatAudioLang(code) {
    var full = (code || '').toLowerCase().trim();
    /* Latino and Castellano are different dubs: never show both as "Español".
       OpenSubtitles: 'spn' / 'ea' are its Latin American Spanish. */
    if (/^(es[-_](419|mx|la|us|ar|co|cl|pe|ve)|latino|lat|latam|spn|ea|spl)$/.test(full)) return 'Español (Latino)';
    if (/^(es[-_]es|castellano)$/.test(full)) return 'Español (Castellano)';
    var c = full.split(/[-_]/)[0];
    if (/^(spa|esp|es)$/.test(c)) return 'Español';
    if (/^(eng|ing|en)$/.test(c)) return 'Inglés';
    if (/^(jpn|jap|ja)$/.test(c)) return 'Japonés';
    if (/^(kor|cor|ko)$/.test(c)) return 'Coreano';
    if (/^(por|pt)$/.test(c)) return 'Portugués';
    if (/^(pob|pb)$/.test(c)) return 'Portugués (Brasil)';
    if (/^(fra|fre|fr|franc)$/.test(c)) return 'Francés';
    if (/^(ita|it)$/.test(c)) return 'Italiano';
    if (/^(deu|ger|de)$/.test(c)) return 'Alemán';
    if (/^(chi|zho|zh)$/.test(c)) return 'Chino';
    var names = { nld: 'Neerlandés', dut: 'Neerlandés', rus: 'Ruso', ara: 'Árabe', cze: 'Checo', ces: 'Checo',
      pol: 'Polaco', tur: 'Turco', swe: 'Sueco', nor: 'Noruego', fin: 'Finés', dan: 'Danés', ell: 'Griego',
      gre: 'Griego', ron: 'Rumano', rum: 'Rumano', hun: 'Húngaro', heb: 'Hebreo', srp: 'Serbio', hrv: 'Croata',
      bul: 'Búlgaro', ukr: 'Ucraniano', vie: 'Vietnamita', tha: 'Tailandés', ind: 'Indonesio', hin: 'Hindi', cat: 'Catalán',
      est: 'Estonio', slv: 'Esloveno', slk: 'Eslovaco', alb: 'Albanés', sqi: 'Albanés', per: 'Persa', fas: 'Persa',
      lit: 'Lituano', lav: 'Letón', mac: 'Macedonio', bos: 'Bosnio', may: 'Malayo', msa: 'Malayo', ice: 'Islandés', isl: 'Islandés' };
    if (names[c]) return names[c];
    return c ? (c.charAt(0).toUpperCase() + c.slice(1)) : 'Pista';
  }

  /* A direct MP4/TS source must stay direct when the viewer selects an audio
     language.  Some webOS media pipelines expose the native AudioTrackList;
     in that case the change is immediate and does not need FFmpeg.  Older
     sets expose no writable list, so we leave the existing source untouched
     instead of silently changing the player to Modo Fluido. */
  function selectNativeAudioTrack(trackIndex) {
    if (!playerVideo) { return false; }
    var tracks;
    try { tracks = playerVideo.audioTracks; } catch (eTracks) { return false; }
    if (!tracks || !tracks.length || !(trackIndex >= 0 && trackIndex < tracks.length)) {
      return false;
    }
    try {
      for (var i = 0; i < tracks.length; i++) {
        tracks[i].enabled = (i === trackIndex);
      }
      return true;
    } catch (eSelect) {
      return false;
    }
  }

  function switchAudioTrack(trackIndex) {
    /* On the detail screen the choice is only remembered for the next play. */
    if ((state.screen !== 'player' && !(window.OPENTV_DESKTOP && state.screen === 'detail' && playerVideo && playerVideo.currentSrc)) || !playerVideo) {
      vodCurrentAudioTrack = trackIndex;
      vodAudioChosen = true;
      return;
    }
    /* Normal (Directo) must never be converted to Fluido merely by opening
       the audio selector.  Use the native track list when webOS provides it.
       A TV without that API keeps its playing source and clearly tells the
       viewer that a remux is required for per-track selection. */
    /* An addon's MKV plays through the relay even in Directo: the relay can
       pick any track, so use it whenever it is the one playing. */
    if (state.streamMode !== 'relay' && state.streamMode !== 'smooth' && !relayBaseUrl) {
      if (selectNativeAudioTrack(trackIndex)) {
        vodCurrentAudioTrack = trackIndex;
        vodAudioChosen = true;
        audioTrackSwitchUntil = Date.now() + 5000;
        setPlayerStatus('Idioma cambiado');
      } else {
        setPlayerStatus('Para cambiar a esa pista de audio, elige Ajustes → Calidad → Compatibilidad máxima.');
      }
      return;
    }
    vodCurrentAudioTrack = trackIndex;
    vodAudioChosen = true;
    /* HTML5 cannot pick a PID inside a TS/MP4, so the FFmpeg relay maps it
       with -map 0:a:<n>. */
    if (relayBaseUrl) {
      var curSec = relayStartOffset + (playerVideo.currentTime || 0);
      playUrl(relayBaseUrl + '?start=' + Math.floor(curSec) + '&a=' + trackIndex);
      return;
    }
    restartCurrentPlayback();
  }

  function restartCurrentPlayback() {
    if (!playerVideo) return;
    var curSec = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
    if (window.OPENTV_DESKTOP && resumePlan && state.playerItem &&
        (resumePlan.item === state.playerItem || String(resumePlan.itemId) === String(state.playerItem.id)) &&
        resumePlan.pos > curSec) {
      curSec = resumePlan.pos;
    }
    var wasPaused = playerVideo.paused;
    var item = state.playerItem;
    stopPlayerVideo();
    setPlayerStatus('Cambiando reproductor…');
    resolvePlayerStream(item, function (url) {
      if (url) {
        if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
          var seekUrl = url + '?start=' + Math.floor(curSec);
          if (vodCurrentAudioTrack) { seekUrl += '&a=' + vodCurrentAudioTrack; }
          playUrl(seekUrl, { remainPaused: wasPaused });
        } else {
          playUrl(url, { startPosition: curSec, remainPaused: wasPaused });
        }
      } else if (!state.streamError) {
        setPlayerStatus('Sin fuente de reproducción');
      }
    });
  }

  /* ---- player/build.js ------------------------------------------------------- */
  /* player/build.js — Construcción del reproductor, selector de categorías y panel de canales.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function buildPlayer() {
    playerStage = $('player-stage');
    playerInfo = $('player-infobar');
    playerVodInfo = $('player-vod-infobar');
    playerChannels = $('player-channels');
    categoryPicker = $('player-categories');
    pcatGrid = $('pcat-grid');
    pcatSub = $('pcat-sub');
    playerVideo = $('player-video');
    playerStatus = $('player-status');
    nextEpisodeLoading = $('next-episode-loading');
    playerOsdIcon = $('player-osd-icon');
    playerFrame = playerStage ? playerStage.querySelector('.player-frame') : null;

    vodInfobarPoster = $('vod-infobar-poster');
    vodInfobarTitle = $('vod-infobar-title');
    vodTimeCurrent = $('vod-time-current');
    vodTimeTotal = $('vod-time-total');
    vodSeekbar = $('vod-seekbar');
    vodSeekProgress = $('vod-seek-progress');
    vodSeekBuffered = $('vod-seek-buffered');
    vodSeekThumb = $('vod-seek-thumb');

    if (vodSeekbar) {
      vodSeekbar.classList.add('focusable');
      vodSeekbar._activate = function () { leaveVodScrub(true); };
      vodSeekbar._onMove = function (dir) {
        if (dir === 'left') { moveVodScrub(-1); return true; }
        if (dir === 'right') { moveVodScrub(1); return true; }
        if (dir === 'down' || dir === 'up') { leaveVodScrub(false); return true; }
        return false;
      };
    }

    /* PlaySettingView elements */
    playSettingView = $('player-playsetting-view');
    psvSecSelection = $('psv-sec-selection');
    psvEpisodesRow = $('psv-episodes-row');
    psvBtnEpisodes = $('psv-btn-episodes');
    psvBtnConfig = $('psv-btn-config');
    psvBtnP1 = $('psv-btn-p1');
    psvBtnP2 = $('psv-btn-p2');
    psvSecAudio = $('psv-sec-audio');
    psvSecQuality = $('psv-sec-quality');
    psvQualityRow = $('psv-quality-row');
    psvSecAspect = $('psv-sec-aspect');
    psvSecPlayer = $('psv-sec-player');
    psvAspectRow = $('psv-aspect-row');

    /* Season/episode browser */
    episodeBrowser = $('player-episodes');
    peTitle = $('pe-title');
    peSub = $('pe-sub');
    peSeasons = $('pe-seasons');
    peSeasonsCol = $('pe-seasons-col');
    peEpisodes = $('pe-episodes');
    peSeasonLabel = $('pe-season-label');

    if (psvBtnEpisodes) {
      psvBtnEpisodes._activate = function () { openEpisodeBrowser(); };
    }


    if (psvBtnConfig) {
      psvBtnConfig._activate = function () {
        openPlaySettingsDialog();
      };
    }
    if (psvBtnP1) {
      psvBtnP1._activate = function () {
        /* Explicit user action must always recreate the source.  Never use
           the visual selection or a stale URL as a reason to skip it. */
        setSmoothMode(playSettingsItem(), true);
        renderPlaySettingPlayerOptions();
        schedulePlaySettingHide();
        restartCurrentPlayback();
      };
    }
    if (psvBtnP2) {
      psvBtnP2._activate = function () {
        setSmoothMode(playSettingsItem(), false);
        renderPlaySettingPlayerOptions();
        schedulePlaySettingHide();
        restartCurrentPlayback();
      };
    }
    if (psvAspectRow) {
      var aBtns = psvAspectRow.querySelectorAll('.psv-btn');
      for (var ai = 0; ai < aBtns.length; ai++) {
        (function (b) {
          b._activate = function () {
            var asp = b.getAttribute('data-aspect');
            setPlayerAspect(asp);
          };
        })(aBtns[ai]);
      }
    }

    /* Modal Dialog elements */
    dialogPlaySettings = $('dialog-playsettings');
    dpsAudioOptions = $('dps-audio-options');
    dpsSubSwitch = $('dps-sub-switch');
    dpsRowLang = $('dps-row-lang');
    dpsRowSize = $('dps-row-size');
    dpsRowStyle = $('dps-row-style');
    dpsRowSync = $('dps-row-sync');
    dpsLangOptions = $('dps-lang-options');
    dpsSizeOptions = $('dps-size-options');
    dpsStyleOptions = $('dps-style-options');
    dpsSyncOptions = $('dps-sync-options');
    dpsBtnExit = $('dps-btn-exit');
    playerSubtitles = $('player-subtitles');
    /* Desktop: subtitles go inside the video box, so the small player of the
       detail page shows them in it instead of across the whole window. */
    if (window.OPENTV_DESKTOP && playerSubtitles && playerStage && playerSubtitles.parentNode !== playerStage) {
      playerStage.appendChild(playerSubtitles);
    }

    if (dpsSubSwitch) {
      dpsSubSwitch._activate = function () {
        vodSubChosen = true;
        vodSubActive = !vodSubActive;
        if (!vodSubActive) {
          loadSubtitleTrack(null);
        } else {
          var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
          var subs = subtitleLanguageList(info);
          if (!vodCurrentSubtitle && subs.length) {
            vodCurrentSubtitle = subs[0];
          }
          if (vodCurrentSubtitle) {
            loadSubtitleTrack(vodCurrentSubtitle);
          }
        }
        renderDialogSubtitle();
        schedulePlaySettingHide();
      };
    }

    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        (function (b) {
          b._activate = function () {
            vodSubSize = b.getAttribute('data-size') || 'normal';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(sBtns[si]);
      }
    }

    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        (function (b) {
          b._activate = function () {
            vodSubStyle = b.getAttribute('data-style') || 'white';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(stBtns[sti]);
      }
    }

    if (dpsSyncOptions) {
      var syBtns = dpsSyncOptions.querySelectorAll('.dps-btn');
      for (var syi = 0; syi < syBtns.length; syi++) {
        (function (b) {
          b._activate = function () {
            var delta = parseFloat(b.getAttribute('data-sync') || '0');
            if (delta === 0) {
              vodSubOffset = 0;
            } else {
              vodSubOffset = Math.max(-15, Math.min(15, Math.round((vodSubOffset + delta) * 10) / 10));
            }
            updateSubtitleDisplay(vodPlaybackPosition());
            renderDialogSubtitle();
            var sign = vodSubOffset > 0 ? '+' : '';
            setPlayerStatus('Sincronía de subtítulos: ' + (vodSubOffset === 0 ? '0.0 s (Normal)' : (sign + vodSubOffset.toFixed(1) + ' s')));
            setTimeout(function () {
              if (/^Sincronía de subtítulos/.test((playerStatus && playerStatus.textContent) || '')) {
                setPlayerStatus('');
              }
            }, 1600);
          };
        })(syBtns[syi]);
      }
    }

    if (dpsBtnExit) {
      dpsBtnExit._activate = function () {
        closePlaySettingsDialog();
      };
    }

    applySubtitleStyles();
    applyGlobalPlaybackPreferences();

    clear(playerInfo); clear(playerChannels);

    playerStage.classList.add('focusable');
    playerStage._onMove = function (dir) {
      if (state.playerMode === 'vod') {
        if (dir === 'left') { playerSeek(-10); return true; }
        if (dir === 'right') { playerSeek(10); return true; }
        if (dir === 'down') {
          openPlaySettingView();
          return true;
        }
        if (dir === 'up') {
          enterVodScrub();
          return true;
        }
        return false;
      }
      if (dir === 'left') { openChannelPanel(); return true; }
      if (dir === 'right') { closeChannelPanel(); return true; }
      if (dir === 'up') { setChannel(state.channel - 1); return true; }
      if (dir === 'down') { setChannel(state.channel + 1); return true; }
      return false;
    };
    playerStage._activate = function () {
      if (window.OPENTV_DESKTOP && state.screen === 'detail') {
        expandToFullscreen(state.detail, state.detailEpisode);
        return;
      }
      if (state.playerMode === 'vod') {
        togglePlayerPlayPause();
        return;
      }
      /* TVs: OK shows the channel banner; with it on screen, pauses/resumes. */
      if (platformIsTv() && window.OPENTV_DESKTOP) {
        if (state.infobar) { toggleLivePlayPause(); } else { showInfobar(); }
        return;
      }
      if (state.infobar) { hideInfobar(); }
      else { showInfobar(); }
    };

    if (window.OPENTV_DESKTOP) bindDesktopPlayback();

    /* --- infobar (layout_live_infobar, 160dp = 240px) --- */
    playerInfo.appendChild(el('div', 'pi-logo'));
    playerInfo.appendChild(el('div', 'pi-index'));
    var nameRow = el('div', 'pi-namerow');
    var nm = el('div', 'pi-name');
    nameRow.appendChild(nm);
    var uhd = el('div', 'pi-uhd');
    uhd.style.left = '20px';
    nameRow.appendChild(uhd);
    playerInfo.appendChild(nameRow);
    playerInfo.appendChild(el('div', 'pi-date'));
    playerInfo.appendChild(el('div', 'pi-range'));
    playerInfo.appendChild(el('div', 'pi-now'));
    playerInfo.appendChild(el('div', 'pi-next'));
    var seek = el('div', 'pi-seek');
    seek.appendChild(el('div', 'bar'));
    playerInfo.appendChild(seek);
    playerInfo.appendChild(el('div', 'pi-menu', 'info'));
    playerInfo.appendChild(el('div', 'pi-quality', 'HD'));
    playerInfo.appendChild(el('div', 'pi-scale', 'Normal'));
    playerInfo.appendChild(el('div', 'pi-func', 'Selecion de función'));

    var actions = el('div', 'pi-actions');
    var actDefs = [
      { label: 'Pip', right: 446, w: 67, hidden: true },
      { label: 'HD', right: 389, w: 67 },
      { label: 'Anterior', right: 333, w: 67 },
      { label: 'Formato', right: 249, w: 120 },
      { label: 'Favorito', right: 219, w: 67 },
      { label: 'Reproductor 1', right: 151, w: 90 },
      { label: 'Bloquear', right: 107, w: 67 },
      { label: 'Feedback', right: 50, w: 67 }
    ];
    /* Desktop: no PIN lock (it never existed on Windows), so no dead button. */
    /* Formato is not used on Windows either (the picture always fits). */
    /* Play/pause is placed prominently in the exact center of the capsule. */
    if (window.OPENTV_DESKTOP) {
      actDefs = [
        { label: 'Canales', right: 0, w: 90 },
        { label: 'Anterior', right: 333, w: 67 },
        { label: 'Siguiente', right: 0, w: 67 },
        { label: 'Guía', right: 0, w: 67 },
        { label: 'Favorito', right: 219, w: 67 },
        { label: 'HD', right: 389, w: 67 },
        { label: 'Reproducir', right: 0, w: 67 },
        { label: 'Reproductor 1', right: 151, w: 90 },
        { label: 'Feedback', right: 50, w: 67 }
      ];
      if (platformHas('pip') && document.pictureInPictureEnabled) actDefs.push({ label: 'Ventana flotante', right: 0, w: 120 });
      if (platformHas('window')) actDefs.push({ label: 'Pantalla completa', right: 0, w: 120 });
    }
    for (var i = 0; i < actDefs.length; i++) {
      var d = actDefs[i];
      if (d.hidden || d.label === 'Feedback') { continue; }   /* (diagnostics removed) */
      var b = el('div', 'pi-act focusable', d.label);
      b.style.width = (d.w * 1.5) + 'px';
      b.style.left = (1920 - d.right * 1.5 - d.w * 1.5) + 'px';
      b._kind = d.label;
      if (window.OPENTV_DESKTOP) {
        if (d.label === 'HD' || d.label === 'Bloquear') {
          b.setAttribute('aria-disabled', 'true');
          b.title = d.label === 'HD' ? 'La calidad de esta señal es automática' : 'Bloqueo por PIN no disponible';
        }
        if (d.label === 'Reproductor 1') b.textContent = 'Reintentar';
        if (d.label === 'Feedback') b.textContent = 'Diagnóstico';
        var piIcons = { 'HD': UI_ICONS.quality, 'Anterior': UI_ICONS.prev, 'Formato': UI_ICONS.aspect,
          'Favorito': UI_ICONS.star, 'Reproductor 1': UI_ICONS.retry, 'Bloquear': UI_ICONS.lock,
          'Feedback': UI_ICONS.diagnostics, 'Canales': UI_ICONS.channels, 'Ventana flotante': UI_ICONS.pip,
          'Reproducir': UI_ICONS.pause, 'Pantalla completa': UI_ICONS.fullscreen,
          'Siguiente': LIVE_DOCK_ICONS.next, 'Guía': LIVE_DOCK_ICONS.guide };
        var piTips = { 'HD': 'Calidad automática', 'Anterior': 'Canal anterior', 'Formato': 'Formato de pantalla',
          'Favorito': 'Añadir a favoritos', 'Reproductor 1': 'Reintentar señal', 'Bloquear': 'Bloqueo (no disponible)',
          'Feedback': 'Diagnóstico de red', 'Canales': 'Lista de canales', 'Ventana flotante': 'Ventana flotante (Ctrl+P)',
          'Reproducir': 'Pausa (Espacio)', 'Pantalla completa': 'Pantalla completa (F)',
          'Siguiente': 'Canal siguiente', 'Guía': 'Guía de canales (G)' };
        iconizeButton(b, piIcons[d.label], piTips[d.label]);
        if (d.label === 'HD') { b.classList.add('pi-quality-btn'); }
        if (d.label === 'Reproducir') { b.classList.add('pi-play'); }
        if (d.label === 'Pantalla completa') { b.classList.add('pi-full'); }
      }
      b._activate = (function (label) {
        return function () {
          if (label === 'Anterior') { setChannel(state.channel - 1); }
          else if (label === 'Siguiente') { setChannel(state.channel + 1); }
          else if (label === 'Guía') { openLiveGuide(); }
          else if (label === 'Formato') {
            var sc = playerInfo.querySelector('.pi-scale');
            sc.textContent = sc.textContent === 'Normal' ? '16:9' : (sc.textContent === '16:9' ? '4:3' : 'Normal');
            if (window.OPENTV_DESKTOP) setPlayerAspect(sc.textContent === 'Normal' ? 'contain' : (sc.textContent === '16:9' ? '16-9' : '4-3'));
            layoutInfoTexts();
          } else if (label === 'Favorito') {
            var ch = CHANNELS[state.channel];
            if (ch) {
              toggleLiveFavorite(ch);
              this.classList.toggle('is-selected', ch.fav);
              setButtonText(this, ch.fav ? (this._iconized ? 'Quitar de favoritos' : 'En favoritos')
                : (this._iconized ? 'Añadir a favoritos' : 'Favorito'));
            }
          } else if (label === 'HD' && window.OPENTV_DESKTOP) { cycleHlsQuality(this); }
          else if (label === 'Canales') { openChannelPanel(); }
          else if (label === 'Reproducir') { toggleLivePlayPause(); }
          else if (label === 'Pantalla completa') { setWindowFullscreen(!isWindowFullscreen()); liveAutoFullscreen = false; }
          else if (label === 'Ventana flotante') { togglePictureInPicture(); }
          else if (label === 'Reproductor 1') { startLiveChannel(CHANNELS[state.channel], true); }
        };
      })(d.label);
      actions.appendChild(b);
    }
    playerInfo.appendChild(actions);
    /* PC: laid out like the movie player and the TV en vivo page. On top,
       the channel and "EN VIVO"; at the bottom the logo, name and category, a
       red "live" line, and the buttons in three groups: volume | previous,
       pause, next | favourite, guide, channels, quality, retry, PiP, full
       screen. */
    if (window.OPENTV_DESKTOP && !platformIsTv()) {
      playerInfo.classList.add('pi-v2');
      var top = el('div', 'pi-top');
      top.appendChild(el('span', 'pi-top-title'));
      top.appendChild(el('span', 'pi-live-badge', 'EN VIVO'));
      playerInfo.appendChild(top);
      nameRow.appendChild(el('div', 'pi-sub'));
      var liveLine = el('div', 'pi-liveline');
      liveLine.appendChild(el('i', 'pi-liveline-bar'));
      liveLine.appendChild(el('span', 'pi-liveline-text', 'En directo'));
      playerInfo.appendChild(liveLine);
      var gLeft = el('div', 'pi-group is-left');
      var gCenter = el('div', 'pi-group is-center');
      var gRight = el('div', 'pi-group is-right');
      buildPlayerVolume(gLeft);
      var byKind = {};
      var acts = actions.querySelectorAll('.pi-act');
      for (var ak = 0; ak < acts.length; ak++) { byKind[acts[ak]._kind] = acts[ak]; }
      ['Anterior', 'Reproducir', 'Siguiente'].forEach(function (k) { if (byKind[k]) { gCenter.appendChild(byKind[k]); } });
      ['Favorito', 'Guía', 'Canales', 'HD', 'Reproductor 1', 'Ventana flotante', 'Pantalla completa'].forEach(function (k) { if (byKind[k]) { gRight.appendChild(byKind[k]); } });
      actions.appendChild(gLeft);
      actions.appendChild(gCenter);
      actions.appendChild(gRight);
    }
    /* TVs: the live player shows a channel banner with what each key of the
       remote does instead of the buttons (navigation.js handles the keys). */
    if (window.OPENTV_DESKTOP && platformIsTv()) {
      var hints = el('div', 'pi-hints');
      [['▲', 'Canal siguiente'], ['▼', 'Canal anterior'], ['▶', 'Lista de canales'], ['◀', 'Último canal'], ['OK', 'Pausa']].forEach(function (h) {
        var chip = el('div', 'pi-hint');
        chip.appendChild(el('span', 'pi-key', h[0]));
        chip.appendChild(el('span', 'pi-hint-text', h[1]));
        hints.appendChild(chip);
      });
      playerInfo.appendChild(hints);
    }

    /* --- channel panel (frag_live_channel) with category bar and addons --- */
    var pcHeader = el('div', 'pc-header');
    pcHeader.appendChild(el('div', 'pc-title', 'Canales de TV'));
    if (window.OPENTV_DESKTOP) {
      /* Desktop: refresh the list and close the panel, like on a TV remote. */
      var tools = el('div', 'pc-tools');
      var refresh = el('button', 'pc-tool focusable');
      refresh.type = 'button';
      iconizeButton(refresh, UI_ICONS.retry, 'Actualizar canales');
      refresh._activate = function () { refreshLiveChannels(refresh); };
      refresh.addEventListener('click', function (event) { event.stopPropagation(); refresh._activate(); });
      var closeBtn = el('button', 'pc-tool focusable');
      closeBtn.type = 'button';
      iconizeButton(closeBtn, UI_ICONS.close, 'Cerrar (Esc)');
      closeBtn._activate = closeChannelPanel;
      closeBtn.addEventListener('click', function (event) { event.stopPropagation(); closeChannelPanel(); });
      tools.appendChild(refresh);
      tools.appendChild(closeBtn);
      pcHeader.appendChild(tools);
    }
    playerChannels.appendChild(pcHeader);

    var pcCategories = el('div', 'pc-categories scrollable');
    pcCategories.id = 'pc-categories';
    playerChannels.appendChild(pcCategories);

    if (window.OPENTV_DESKTOP) {
      playerChannels.appendChild(createChannelSearchBox('is-player', 'Buscar canal por nombre o número…'));
    }

    playerChannels.appendChild(el('div', 'pc-div'));
    var list = el('div', 'pc-list scrollable');
    if (window.OPENTV_DESKTOP) {
      var pcUp = el('button', 'pc-scroll-arrow is-up focusable');
      pcUp.type = 'button';
      pcUp.title = 'Desplazar canales hacia arriba';
      pcUp.innerHTML = UI_ICONS.chevronUp;
      pcUp._activate = function () {
        list.scrollBy({ top: -360, behavior: 'smooth' });
      };
      pcUp.addEventListener('click', function (ev) { ev.stopPropagation(); pcUp._activate(); });
      playerChannels.appendChild(pcUp);
    }
    playerChannels.appendChild(list);
    if (window.OPENTV_DESKTOP) {
      var pcDown = el('button', 'pc-scroll-arrow is-down focusable');
      pcDown.type = 'button';
      pcDown.title = 'Desplazar canales hacia abajo';
      pcDown.innerHTML = UI_ICONS.chevronDown;
      pcDown._activate = function () {
        list.scrollBy({ top: 360, behavior: 'smooth' });
      };
      pcDown.addEventListener('click', function (ev) { ev.stopPropagation(); pcDown._activate(); });
      playerChannels.appendChild(pcDown);
      bindScrollArrows(list, pcUp, pcDown);
    }
    renderPlayerCategories();
    renderPlayerChannels();

    var menu = el('div', 'pc-menu');
    menu.appendChild(el('div', 'ic'));
    menu.appendChild(el('div', 'l1', 'Presione [OK] para reproducir'));
    menu.appendChild(el('div', 'l2', '(Arriba: Categorías · OK: Filtrar)'));
    playerChannels.appendChild(menu);
  }

  function renderPlayerCategories() {
    if (!playerChannels) { return; }
    var bar = playerChannels.querySelector('.pc-categories');
    if (!bar) { return; }
    /* Todos, the categories of the viewer's M3U lists (group-title), then
       Favoritos and Recientes. */
    var cats = (liveCategories && liveCategories.length ? liveCategories : [LIVE_ALL_CATEGORY])
      .concat([LIVE_SAVED_CATS.favs, LIVE_SAVED_CATS.recent]);

    /* A list can bring dozens of categories. Rebuilding every pill on each
       filter detached the focused node mid-keypress, so the rail looked alive
       but the d-pad had nowhere to go ("no puedo navegar hacia las
       categorías"). The bar is rebuilt only when the category list itself
       changes; selecting a category just swaps the is-selected class. */
    var key = '';
    for (var kk = 0; kk < cats.length; kk++) { key += cats[kk].id + '|'; }
    var focusedCat = (state.focus && state.focus._cat) ? state.focus._cat : null;

    if (key !== renderedCategoryKey) {
      clear(bar);
      var pills = [];
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        var pill = el('button', 'pc-cat-pill focusable', cat.name);
        pill._cat = cat;
        pill._idx = i;
        pill._activate = (function (c) {
          return function () { switchLiveCategory(c); };
        })(cat);
        pill._onMove = (function (idx) {
          return function (dir) {
            if (dir === 'left') {
              if (idx > 0 && pills[idx - 1]) {
                setFocus(pills[idx - 1]);
                scrollPillIntoView(bar, pills[idx - 1]);
              }
              return true;
            }
            if (dir === 'right') {
              if (idx < pills.length - 1 && pills[idx + 1]) {
                setFocus(pills[idx + 1]);
                scrollPillIntoView(bar, pills[idx + 1]);
              } else {
                setFocus(playerStage);
              }
              return true;
            }
            if (dir === 'up') {
              /* Many categories do not fit in the rail, so Up opens the
                 full-screen category grid (the reference app's "all columns"). */
              openCategoryPicker();
              return true;
            }
            if (dir === 'down') {
              var promo = playerChannels.querySelector('.pc-row-addon-promo');
              if (promo) { setFocus(promo); return true; }
              if (CHANNELS.length) { focusPlayerChannel(state.channel); return true; }
            }
            return false;
          };
        })(i);
        bar.appendChild(pill);
        pills.push(pill);
      }
      bar._pills = pills;
      renderedCategoryKey = key;
    }

    var current = currentLiveCategory || cats[0];
    var now = bar._pills || [];
    for (var j = 0; j < now.length; j++) {
      var p = now[j];
      if (p._cat && current && p._cat.id === current.id) { p.classList.add('is-selected'); }
      else { p.classList.remove('is-selected'); }
    }

    /* Filtering must leave the d-pad on the rail, on the same pill. */
    if (focusedCat) {
      var same = null;
      for (var m = 0; m < now.length; m++) {
        if (now[m]._cat && now[m]._cat.id === focusedCat.id) { same = now[m]; break; }
      }
      if (same) {
        if (state.focus !== same) { setFocus(same); }
        scrollPillIntoView(bar, same);
      }
    }
  }

  function scrollSelectedCategoryPill() {
    if (!playerChannels) { return; }
    var bar = playerChannels.querySelector('.pc-categories');
    var pill = bar ? bar.querySelector('.pc-cat-pill.is-selected') : null;
    if (bar && pill) { scrollPillIntoView(bar, pill); }
  }

  /* Full-screen column picker.  The reference APK opens a separate "all
     columns" screen from the live home (mIvAllColumn); a list's categories
     may not fit in the 453dp in-player rail, so Up on the rail opens this grid. */
  function openCategoryPicker() {
    if (!categoryPicker) {
      categoryPicker = $('player-categories');
      pcatGrid = $('pcat-grid');
      pcatSub = $('pcat-sub');
    }
    if (!categoryPicker || !pcatGrid) { return; }
    state.categoryPickerOpen = true;
    categoryPicker.classList.add('is-active');
    hideInfobar();
    renderCategoryPicker();
    var cur = pcatGrid.querySelector('.pcat-tile.is-selected') || firstIn(pcatGrid);
    if (cur) { setFocus(cur); }
  }

  function closeCategoryPicker(keepFocus) {
    if (!categoryPicker || !state.categoryPickerOpen) { return; }
    state.categoryPickerOpen = false;
    categoryPicker.classList.remove('is-active');
    if (keepFocus) { return; }
    var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
    if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
    else if (state.screen === 'player' && playerStage) { setFocus(playerStage); }
  }

  function renderCategoryPicker() {
    if (!pcatGrid) { return; }
    var cats = liveCategoriesLoaded ? liveCategories.concat([LIVE_SAVED_CATS.favs, LIVE_SAVED_CATS.recent]) : [];
    clear(pcatGrid);
    if (pcatSub) {
      pcatSub.textContent = cats.length
        ? (cats.length + ' categorías · elige una para filtrar los canales')
        : 'Cargando categorías…';
    }
    for (var i = 0; i < cats.length; i++) {
      (function (cat) {
        var tile = el('div', 'pcat-tile focusable');
        tile.appendChild(el('div', 'pcat-name', cat.name));
        if (currentLiveCategory && currentLiveCategory.id === cat.id) { tile.classList.add('is-selected'); }
        tile._cat = cat;
        tile._activate = function () {
          switchLiveCategory(cat);
          closeCategoryPicker(true);
          var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
          if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
          else { closeChannelPanel(); }
        };
        pcatGrid.appendChild(tile);
      })(cats[i]);
    }
  }

  function scrollPillIntoView(bar, pill) {
    if (!bar || !pill) { return; }
    var pl = pill.offsetLeft;
    var pw = pill.offsetWidth;
    var bl = bar.scrollLeft;
    var bw = bar.clientWidth;
    if (pl < bl) { bar.scrollLeft = pl - 20; }
    else if (pl + pw > bl + bw) { bar.scrollLeft = pl + pw - bw + 20; }
  }

  function focusPlayerChannel(index) {
    if (!CHANNELS.length) { return; }
    index = Math.max(0, Math.min(CHANNELS.length - 1, Number(index) || 0));
    if (!playerChannelRows[index]) { renderPlayerChannels(index); }
    if (playerChannelRows[index]) { setFocus(playerChannelRows[index]); }
  }

  function renderPlayerChannels(anchorIndex) {
    if (!playerChannels) { return; }
    var list = playerChannels.querySelector('.pc-list');
    if (!list) { return; }
    clear(list);
    playerChannelRows = {};

    /* No lists (or none could be read): a row to add the recommended ones. */
    if (liveNeedsLists() && !(currentLiveCategory && currentLiveCategory.isSaved)) {
      var promo = el('div', 'pc-row-addon-promo focusable');
      promo.appendChild(el('div', 'promo-icon', '⚙️'));
      var promoInfo = el('div', 'promo-info');
      promoInfo.appendChild(el('div', 'promo-text', '➕ Agregar listas M3U'));
      promoInfo.appendChild(el('div', 'promo-sub', 'Instala listas recomendadas o agrega tu enlace en Ajustes → Addons → TV en vivo'));
      promo.appendChild(promoInfo);
      promo._activate = function () { openAddonsDialog(); };
      promo._onMove = function (dir) {
        if (dir === 'up') {
          var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
          if (selCat) { setFocus(selCat); }
          return true;
        }
        if (dir === 'down') {
          if (CHANNELS.length) { focusPlayerChannel(0); }
          return true;
        }
        if (dir === 'right') { setFocus(playerStage); return true; }
        return false;
      };
      list.appendChild(promo);
    }

    if (!CHANNELS.length) {
      var emptyRow = el('div', 'pc-empty-channels', liveEmptyMessage());
      emptyRow.style.padding = '30px';
      emptyRow.style.color = '#888';
      emptyRow.style.fontSize = '20px';
      list.appendChild(emptyRow);
      return;
    }

    var hasQuery = !!(window.OPENTV_DESKTOP && typeof liveChannelQuery === 'string' && norm(liveChannelQuery));
    var indicesToRender = [];
    if (hasQuery) {
      for (var qi = 0; qi < CHANNELS.length; qi++) {
        if (channelMatchesQuery(CHANNELS[qi], qi, liveChannelQuery)) {
          indicesToRender.push(qi);
          if (indicesToRender.length >= 120) { break; }
        }
      }
      if (!indicesToRender.length) {
        var noMatchRow = el('div', 'pc-empty-channels', 'Sin canales para «' + liveChannelQuery.trim() + '»');
        noMatchRow.style.padding = '30px';
        noMatchRow.style.color = '#888';
        noMatchRow.style.fontSize = '20px';
        list.appendChild(noMatchRow);
        return;
      }
    } else {
      anchorIndex = Number(anchorIndex);
      if (!isFinite(anchorIndex)) { anchorIndex = state.channel; }
      anchorIndex = Math.max(0, Math.min(CHANNELS.length - 1, anchorIndex || 0));
      var firstChannel = Math.max(0, anchorIndex - Math.floor(LIVE_PANEL_WINDOW / 2));
      var lastChannel = Math.min(CHANNELS.length, firstChannel + LIVE_PANEL_WINDOW);
      firstChannel = Math.max(0, lastChannel - LIVE_PANEL_WINDOW);
      for (var ci = firstChannel; ci < lastChannel; ci++) {
        indicesToRender.push(ci);
      }
    }

    for (var k = 0; k < indicesToRender.length; k++) {
      var c = indicesToRender[k];
      var row = el('div', 'pc-row focusable');
      row._channel = c;
      var ic = el('div', 'ic');
      if (CHANNELS[c].logo) {
        ic.style.backgroundImage = 'url(' + CHANNELS[c].logo + ')';
        ic.style.backgroundSize = 'contain';
        ic.style.backgroundRepeat = 'no-repeat';
        ic.style.backgroundPosition = 'center';
      }
      var num = el('div', 'num', pad2(CHANNELS[c].index || (c + 1)));
      var nm2 = el('div', 'nm', CHANNELS[c].name);
      var epg = el('div', 'epg', CHANNELS[c].now || 'En vivo');
      row.appendChild(ic); row.appendChild(num); row.appendChild(nm2); row.appendChild(epg);
      if (c === state.channel) { row.classList.add('is-current'); }
      row._activate = (function (idx) {
        return function () {
          setChannel(idx, true);
          closeChannelPanel();
          setFocus(playerStage);
        };
      })(c);
      row._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'right') { setFocus(playerStage); return true; }
          if (dir === 'up') {
            if (idx > 0) {
              focusPlayerChannel(idx - 1);
            } else if (idx === 0) {
              var promo = playerChannels.querySelector('.pc-row-addon-promo');
              if (promo) { setFocus(promo); }
              else {
                var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
                if (selCat) { setFocus(selCat); }
              }
            }
            return true;
          }
          if (dir === 'down') {
            if (idx < CHANNELS.length - 1) { focusPlayerChannel(idx + 1); }
            return true;
          }
          return false;
        };
      })(c);
      list.appendChild(row);
      playerChannelRows[c] = row;
    }
  }

  /* ---- player/playback.js ---------------------------------------------------- */
  /* player/playback.js — Reproducción: búsqueda (seek), estado, playUrl, resolución de streams y openPlayer.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var lastProxyOrigin = '';
  var lastPlayingUrl = '';
  /* Generation counter: incremented every time we start a new stream.
     Async resolve callbacks check this before calling playUrl() so that
     stale responses from previously-selected items are silently dropped. */
  var resolveSeq = 0;
  var relayBaseUrl = '';
  var relayStartOffset = 0;
  /* The ?start= asked of the relay. relayStartOffset is where the video really
     begins: when the relay copies the video it starts at the keyframe before
     that second (askRelayRealStart). */
  var relayRequestedStart = 0;

  function askRelayRealStart(base, asked) {
    var video = playerVideo;
    if (!video || !base || !(asked > 0)) { return; }
    var onMeta = function () {
      video.removeEventListener('loadedmetadata', onMeta);
      if (relayBaseUrl !== base || relayRequestedStart !== asked) { return; }
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', base + '?where=' + asked, true);
        xhr.timeout = 4000;
        xhr.onload = function () {
          if (relayBaseUrl !== base || relayRequestedStart !== asked) { return; }
          var real = NaN;
          try { real = Number(JSON.parse(xhr.responseText).start); } catch (eJson) { /* ignore */ }
          if (isFinite(real) && real >= 0 && Math.abs(asked - real) < 30) { relayStartOffset = real; }
        };
        xhr.send(null);
      } catch (eAsk) { /* keep the asked second */ }
    };
    video.addEventListener('loadedmetadata', onMeta);
  }
  /* A fragmented MP4 relay is a one-way HTTP stream.  Several older webOS
     players do not resume that socket after a long pause; opening its local
     URL again at the same offset is the reliable native resume operation. */
  var relayPaused = false;

  function resumePlayerPlayback() {
    if (!playerVideo) { return; }
    if (relayPaused && relayBaseUrl && state.playerMode === 'vod') {
      var base = relayBaseUrl;
      var position = Math.max(0, Math.floor(relayStartOffset + (playerVideo.currentTime || 0)));
      relayPaused = false;
      var resumeUrl = base + '?start=' + position;
      if (vodCurrentAudioTrack) { resumeUrl += '&a=' + vodCurrentAudioTrack; }
      setPlayerStatus('Reanudando vídeo…');
      playUrl(resumeUrl);
      return;
    }
    try {
      var p = playerVideo.play();
      if (p && p.catch) { p.catch(function () {}); }
    } catch (ePlay) { /* native player rejected resume */ }
  }

  /* Accumulated seek delta + timer for debouncing rapid seek keypresses.
     webOS Starfish fires a full setPreload/dispatchBufferingStart cycle
     for every currentTime assignment, so we batch rapid presses. */
  var seekPending = 0;
  var seekTimer = null;
  /* Starfish emits transient waiting/stalled events even when its HLS buffer
     recovers before a frame is missed.  Delay the visual notice so those
     micro-events do not flash "Cargando vídeo" over a healthy channel. */
  var bufferingNoticeTimer = null;
  function clearBufferingNotice() {
    if (bufferingNoticeTimer) {
      clearTimeout(bufferingNoticeTimer);
      bufferingNoticeTimer = null;
    }
  }
  function scheduleBufferingNotice(text) {
    if (bufferingNoticeTimer || state.streamError) { return; }
    bufferingNoticeTimer = setTimeout(function () {
      bufferingNoticeTimer = null;
      if (!state.streamError && playerVideo && !playerVideo.paused && playerVideo.readyState < 3) {
        setPlayerStatus(text);
      }
    }, 700);
  }
  /* Fragmented-MP4 seeks restart the native video pipeline on webOS 4.  Do
     not start a second one until that pipeline has acknowledged the first. */
  var relaySeekInFlight = false;
  var relaySeekWatchdog = null;
  function releaseRelaySeek() {
    relaySeekInFlight = false;
    if (relaySeekWatchdog) { clearTimeout(relaySeekWatchdog); relaySeekWatchdog = null; }
  }
  function flushSeek() {
    seekTimer = null;
    if (!playerVideo || !seekPending) { seekPending = 0; return; }
    if (relayBaseUrl) {
      if (relaySeekInFlight) { seekPending = 0; return; }
      relaySeekInFlight = true;
      var curSec = relayStartOffset + (playerVideo.currentTime || 0);
      var target = Math.max(0, curSec + seekPending);
      seekPending = 0;
      var totalDur = vodPlaybackDuration();
      if (totalDur > 0 && target > totalDur - 2) { target = Math.max(0, totalDur - 2); }
      var keepPaused = playerVideo.paused;
      var seekUrl = relayBaseUrl + '?start=' + Math.floor(target) + '&a=' + (vodCurrentAudioTrack || 0);
      /* Forward: the relay must land past here, even if the keyframe before
         the target is not (see ffmpeg-relay.js probeKeyframe). */
      if (target > curSec + 1) { seekUrl += '&from=' + Math.floor(curSec); }
      /* A failed upstream request must not leave controls locked forever. */
      relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
      playUrl(seekUrl, { remainPaused: keepPaused });
      return;
    }
    var t = (playerVideo.currentTime || 0) + seekPending;
    seekPending = 0;
    var dur = vodPlaybackDuration();
    if (t < 0) { t = 0; }
    if (dur > 0 && t > dur - 1) { t = dur - 1; }
    if (window.OPENTV_DESKTOP && state.playerMode === 'vod' && state.playerItem && state.playerItem._relayUrl &&
        /\/media\/[^/]+\/stream\.ts$/i.test(lastPlayingUrl || '')) {
      var seekEnd = (playerVideo.seekable && playerVideo.seekable.length) ? playerVideo.seekable.end(playerVideo.seekable.length - 1) : 0;
      if (t > seekEnd + 10) {
        if (relaySeekInFlight) { return; }
        relaySeekInFlight = true;
        var keepPausedTs = playerVideo.paused;
        var relaySeekUrl = state.playerItem._relayUrl + '?start=' + Math.floor(t) + '&a=' + (vodCurrentAudioTrack || 0);
        relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
        playUrl(relaySeekUrl, { remainPaused: keepPausedTs });
        return;
      }
    }
    try { playerVideo.currentTime = t; } catch (eSeek) { /* ignore */ }
  }
  function playerSeek(delta) {
    if (!playerVideo) { return; }
    seekPending += delta;
    if (seekTimer) { clearTimeout(seekTimer); }
    seekTimer = setTimeout(flushSeek, window.OPENTV_DESKTOP ? 150 : 800);
    showInfobar();
    /* OSD feedback while seeking */
    showOsdIcon(delta > 0 ? 'forward' : 'backward');
    setTimeout(function () { showOsdIcon('none'); }, 600);
  }

  function vodPlaybackPosition() {
    if (!playerVideo) { return 0; }
    return relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
  }

  function vodPlaybackDuration() {
    var target = state.playerEpisode || state.playerItem;
    var verified = durationToSeconds(target && target._sourceDuration);
    var metadata = durationToSeconds(target && target.duration);
    var timeline = playerVideo && playerVideo._opentvTimeline;
    var completeHls = timeline && timeline.kind === 'hls' && timeline.complete ? durationToSeconds(timeline.duration) : 0;
    // Native MediaSource.duration may only describe the HLS fragments indexed
    // so far. It is never a title total until the manifest is complete.
    if (verified) return verified;
    if (timeline && timeline.kind === 'native' && timeline.complete && playerVideo.readyState >= 1 && isFinite(playerVideo.duration) && playerVideo.duration > 0) return playerVideo.duration;
    if (metadata) return metadata;
    if (completeHls) return completeHls;
    if (relayBaseUrl || (timeline && timeline.kind !== 'native')) return 0;
    return playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0 ? playerVideo.duration : 0;
  }

  function requestVideoDuration(item, episode, payload) {
    var target = episode || item;
    if (!payload.durationId) return;
    if (target._durationProbe === payload.durationId) return;
    target._durationProbe = payload.durationId;
    target._durationPending = true;
    portalServiceCall('mediaDuration', { durationId: payload.durationId }, function (error, answer) {
      if (target._durationProbe !== payload.durationId) return;
      target._durationPending = false;
      var duration = !error && answer && answer.returnValue !== false ? durationToSeconds(answer.duration) : 0;
      /* The same probe lists the file's audio tracks (language and title). */
      if (!error && answer && ((answer.audio && answer.audio.length) || (answer.subtitles && answer.subtitles.length))) {
        onSourceTracks(item, episode, answer);
      }
      if (duration) {
        if (answer.verified) target._sourceDuration = duration;
        if (answer.verified || !durationToSeconds(target.duration)) target.duration = duration;
      }
      if ((state.playerEpisode || state.playerItem) === target) {
        updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
        document.dispatchEvent(new CustomEvent('opentv:duration'));
      }
    }, 10000);
  }

  function leaveVodScrub(apply) {
    if (!vodScrubbing) { return; }
    var target = vodScrubTime;
    var before = vodPlaybackPosition();
    vodScrubbing = false;
    if (vodSeekbar) { vodSeekbar.classList.remove('is-scrubbing'); }
    if (apply && Math.abs(target - before) >= 1) { playerSeek(target - before); }
    updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
    setFocus(playerStage);
    scheduleInfoHide();
  }

  function enterVodScrub() {
    var duration = vodPlaybackDuration();
    if (!vodSeekbar || !duration) { showInfobar(); return; }
    vodScrubTime = Math.max(0, Math.min(duration - 1, vodPlaybackPosition()));
    vodScrubbing = true;
    vodSeekbar.classList.add('is-scrubbing');
    showInfobar();
    if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
    updateVodProgress(vodScrubTime, duration);
    setFocus(vodSeekbar);
  }

  function moveVodScrub(direction) {
    var duration = vodPlaybackDuration();
    if (!vodScrubbing || !duration) { return; }
    var step = Math.max(60, Math.min(300, Math.round(duration * 0.05)));
    vodScrubTime = Math.max(0, Math.min(duration - 1, vodScrubTime + (direction * step)));
    updateVodProgress(vodScrubTime, duration);
  }

  /* TVs: holding left/right glides through the film like native TV players.
     The bar moves at once (nothing loads meanwhile) and goes faster the
     longer the key is held; the video jumps once, when the key is let go. A
     single press still moves 10 s. */
  var tvSeekHold = { start: 0, last: 0, timer: null, bound: false };
  function tvSeekCommit() {
    if (tvSeekHold.timer) { clearTimeout(tvSeekHold.timer); tvSeekHold.timer = null; }
    tvSeekHold.last = 0;
    leaveVodScrub(true);
  }
  function tvSeekKey(dir) {
    if (!tvSeekHold.bound) {
      tvSeekHold.bound = true;
      document.addEventListener('keyup', function (e) {
        var k = e.keyCode || e.which;
        if ((k === 37 || k === 39) && vodScrubbing && tvSeekHold.last) { tvSeekCommit(); }
      }, true);
    }
    var duration = vodPlaybackDuration();
    var now = Date.now();
    if (!vodScrubbing) {
      enterVodScrub();
      tvSeekHold.start = now;
      tvSeekHold.last = 0;
    }
    if (!vodScrubbing || !duration) { playerSeek(dir * 10); return; }
    /* A new press after a pause starts slow again. */
    if (tvSeekHold.last && now - tvSeekHold.last > 450) { tvSeekHold.start = now; tvSeekHold.last = 0; }
    var delta = 10;
    if (tvSeekHold.last) {
      var held = now - tvSeekHold.start;
      var rate = held < 1200 ? 20 : held < 3000 ? 60 : held < 6000 ? 150 : 300;   /* seconds of film per second held */
      delta = rate * Math.min(250, now - tvSeekHold.last) / 1000;
    }
    tvSeekHold.last = now;
    vodScrubTime = Math.max(0, Math.min(duration - 1, vodScrubTime + dir * delta));
    updateVodProgress(vodScrubTime, duration);
    if (tvSeekHold.timer) { clearTimeout(tvSeekHold.timer); }
    /* (Also applied if the remote never sends the key up.) */
    tvSeekHold.timer = setTimeout(tvSeekCommit, 700);
  }

  function stopPlayerVideo() {
    if (vodSeekbar && vodSeekbar._cancelDesktopScrub) vodSeekbar._cancelDesktopScrub();
    if (state.playerMode === 'vod' && playerVideo) {
      var stopPosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var stopDuration = vodPlaybackDuration();
      rememberWatchProgress(stopPosition, stopDuration, true);
    }
    state.streamError = '';
    clearBufferingNotice();
    setPlayerStatus('');
    showOsdIcon('none');
    stopVodProgressTicker();
    /* Keep the settings panel/dialog open across an audio/quality restart;
       back() and screen changes close them. Keep the loaded cues too: an
       audio/quality switch replaces the source but not the subtitles, and
       showScreen() clears them when the player is really left. */
    /* Cancel any pending seek */
    if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; seekPending = 0; }
    releaseRelaySeek();
    relayPaused = false;
    relayBaseUrl = '';
    relayStartOffset = 0;
    relayRequestedStart = 0;
    /* Increment generation so any in-flight resolve() callback is ignored */
    resolveSeq++;
    var proxyToAbort = lastProxyOrigin;
    if (!proxyToAbort && lastPlayingUrl && lastPlayingUrl.indexOf('127.0.0.1') !== -1) {
      var m = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(lastPlayingUrl);
      if (m) { proxyToAbort = m[1]; }
    }
    if (proxyToAbort) {
      try {
        var abortXhr = new XMLHttpRequest();
        abortXhr.open('GET', proxyToAbort + '/media/abort', true);
        abortXhr.send();
      } catch (eAbort) { /* ignore */ }
    }
    try {
      portalServiceCall('abortMedia', {}, function () {});
    } catch (eSvc) { /* ignore */ }
    lastPlayingUrl = '';
    lastProxyOrigin = '';
    if (!playerVideo) { return; }
    /* Detach the old Starfish pipeline callbacks before clearing its source.
       Otherwise an asynchronous error from the previous episode can invoke
       the new episode's handler and briefly paint a misleading código 4. */
    playerVideo.onerror = null;
    playerVideo.onwaiting = null;
    playerVideo.onstalled = null;
    playerVideo.onloadeddata = null;
    playerVideo.oncanplay = null;
    playerVideo.onloadedmetadata = null;
    playerVideo.ondurationchange = null;
    playerVideo.onplaying = null;
    playerVideo.onended = null;
    playerVideo.ontimeupdate = null;
    playerVideo.onpause = null;
    playerVideo.onplay = null;
    try { playerVideo.pause(); } catch (e) { /* ignore */ }
    try { playerVideo.currentTime = 0; } catch (e) { /* ignore */ }
    playerVideo.removeAttribute('src');
    try { playerVideo.src = ''; } catch (e) { /* ignore */ }
    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    if (window.OPENTV_DESKTOP && typeof playerVideo._opentvResetTimeline === 'function') playerVideo._opentvResetTimeline();
    /* NOTE: do NOT call playerVideo.load() here.
       A bare load() with no <source> briefly creates a WebMediaPlayerUMS
       pipeline in Starfish (AID=N) that gets destroyed milliseconds later
       when the real load() arrives, wasting one ACB slot and ~70ms. */
    playerVideo.classList.remove('is-active');
    if (playerFrame) { playerFrame.style.display = 'block'; }
  }

  function setPlayerStatus(text) {
    if (window.OPENTV_DESKTOP) {
      document.dispatchEvent(new CustomEvent('opentv:player-status', { detail: {
        text: text || '', error: !!state.streamError, mode: state.playerMode,
        loading: /^(Preparando|Cargando|Conectando|Reintentando|Reanudando|Cambiando|Ajustando)/i.test(text || '')
      } }));
    }
    if (!playerStatus) { playerStatus = $('player-status'); }
    if (!playerStatus) { return; }
    if (text) {
      playerStatus.textContent = text;
      playerStatus.classList.add('is-active');
    } else {
      playerStatus.textContent = '';
      playerStatus.classList.remove('is-active');
    }
  }

  function playUrl(url, playOptions) {
    if (!playerVideo || !url) { return; }
    playOptions = playOptions || {};
    var useNativeHlsFallback = !!playOptions.nativeHls;
    if (window.OPENTV_DESKTOP && state.playerMode === 'vod' && !/[?&]start=\d+/.test(url)) {
      var planMatches = resumePlan && state.playerItem &&
        (resumePlan.item === state.playerItem || String(resumePlan.itemId) === String(state.playerItem.id)) &&
        (!resumePlan.episodeId || (state.playerEpisode && String(state.playerEpisode.id) === String(resumePlan.episodeId)));
      var targetStart = (playOptions.startPosition > 0) ? Math.floor(playOptions.startPosition)
                      : (planMatches && resumePlan.pos >= RESUME_MIN_S ? Math.floor(resumePlan.pos) : 0);
      if (targetStart >= RESUME_MIN_S) {
        if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
          url = url.split('?')[0] + '?start=' + targetStart + '&a=' + (vodCurrentAudioTrack || 0);
          playOptions.startPosition = 0;
        } else if (/\/media\/[^/]+\/stream\.ts$/i.test(url) && state.playerItem && state.playerItem._relayUrl) {
          url = state.playerItem._relayUrl + '?start=' + targetStart + '&a=' + (vodCurrentAudioTrack || 0);
          playOptions.startPosition = 0;
        } else {
          playOptions.startPosition = targetStart;
          playerVideo._opentvStartPos = targetStart;
        }
      }
    }
    stopPlayerVideo();
    relayPaused = false;
    lastPlayingUrl = url;
    var mOrigin = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(url);
    if (mOrigin) { lastProxyOrigin = mOrigin[1]; }
    if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
      relayBaseUrl = url.split('?')[0];
      var mStart = /[?&]start=(\d+)/.exec(url);
      relayStartOffset = mStart ? parseInt(mStart[1], 10) : 0;
      relayRequestedStart = relayStartOffset;
      askRelayRealStart(relayBaseUrl, relayRequestedStart);
    } else {
      relayBaseUrl = '';
      relayStartOffset = 0;
      relayRequestedStart = 0;
    }
    setPlayerStatus('Conectando con el vídeo…');
    state.streamError = '';
    compatWatchBegin();

    /* The markup defaults to auto too, but set it again because Starfish can
       retain the previous resource's preload mode after source replacement. */
    try { playerVideo.preload = 'auto'; } catch (ePreload) { /* ignore */ }

    var rawMime = (state.playerItem && state.playerItem.streamMime) || '';
    var isHls = (url.indexOf('.m3u8') !== -1) || (rawMime.indexOf('mpegurl') !== -1) || !!(state.playerItem && state.playerItem.isHls);
    var mime = isHls ? 'application/vnd.apple.mpegurl' : ((url.indexOf('.mp4') !== -1 || rawMime.indexOf('mp4') !== -1) ? 'video/mp4' : 'video/mp2t');

    playerVideo.onerror = function () {
      hideNextEpisodeLoading();
      releaseRelaySeek();
      var code = playerVideo.error && playerVideo.error.code;
      /* Some newer webOS releases reject Starfish's legacy mediaOption
         parameter for every HLS channel and report MEDIA_ERR_SRC_NOT_SUPPORTED
         (4). Retry only live HLS once with the standard HTML5 HLS source.
         VOD and the FFmpeg Modo Fluido path are intentionally untouched. */
      if (code === 4 && state.playerMode === 'live' && isHls && !useNativeHlsFallback) {
        var failedChannelSeq = liveChannelSeq;
        setPlayerStatus('Reintentando la señal…');
        setTimeout(function () {
          if (state.playerMode === 'live' && liveChannelSeq === failedChannelSeq) {
            playUrl(url, { nativeHls: true });
          }
        }, 0);
        return;
      }
      /* A manual language change on the direct pipeline must preserve Normal
         mode.  Do not mistake the transient native-track error for an
         unsupported stream and silently restart through the FFmpeg relay. */
      if (code === 4 && state.playerMode === 'vod' && state.streamMode === 'normal' &&
          audioTrackSwitchUntil && Date.now() < audioTrackSwitchUntil) {
        audioTrackSwitchUntil = 0;
        state.streamError = 'No fue posible cambiar el idioma en reproducción Normal';
        setPlayerStatus(state.streamError);
        return;
      }
      /* Some portal VOD files are rejected by a TV's direct TS pipeline even
         though the same HEVC/AAC content plays when remuxed as fragmented MP4.
         Retry once through the protected Modo Fluido route, never in a loop.
         The retry belongs to this episode only: remembering it for the whole
         series opened every following episode in Modo Fluido even after the
         viewer picked Normal. */
      if (code === 4 && tryCompatFallback('error')) { return; }
      if (code && stremioRetryTranscode()) { return; }
      state.streamError = 'No se pudo abrir el stream (código ' + (code || 'error') + ')';
      playerVideo.classList.remove('is-active');
      if (playerFrame) { playerFrame.style.display = 'block'; }
      setPlayerStatus(state.streamError);
    };
    function clearStatus() {
      clearBufferingNotice();
      setPlayerStatus('');
    }
    /* Desktop: while the video should run but has no frames yet, say so.
       A silent frozen picture looked paused and invited a click that
       really paused it. */
    function clearStatusWhenRunning() {
      if (window.OPENTV_DESKTOP && !playerVideo.paused && playerVideo.readyState < 3) {
        if (!state.streamError) { setPlayerStatus('Cargando vídeo…'); }
        return;
      }
      clearStatus();
    }
    /* Directo builds its segment list progressively and HLS.js joins it at
       the newest segment, so an early seek lands short of the target (for
       example 8 s instead of 30 s). Retry until that point is available. */
    var pendingStart = 0;
    var pendingStartTimer = null;
    var pendingSrc = url;
    function stopPendingStart() {
      pendingStart = 0;
      if (pendingStartTimer) { clearInterval(pendingStartTimer); pendingStartTimer = null; }
    }
    function tryPendingStart() {
      if (!pendingStart || !playerVideo) { return stopPendingStart(); }
      var srcNow = playerVideo.currentSrc || '';
      if (srcNow.indexOf('blob:') !== 0 && srcNow !== pendingSrc && srcNow.indexOf(pendingSrc) === -1) { return stopPendingStart(); }
      if (Math.abs((playerVideo.currentTime || 0) - pendingStart) < 3) { return stopPendingStart(); }
      var s = playerVideo.seekable;
      var end = (s && s.length) ? s.end(s.length - 1) : 0;
      if (end >= pendingStart + 1) {
        try { playerVideo.currentTime = pendingStart; } catch (eSeek) { /* retry next tick */ return; }
        stopPendingStart();
      }
    }
    playerVideo.onloadeddata = clearStatusWhenRunning;
    playerVideo.oncanplay = function () { releaseRelaySeek(); clearStatusWhenRunning(); };
    playerVideo.onloadedmetadata = function () {
      if (playOptions.startPosition > 0) {
        var target = playOptions.startPosition;
        try { playerVideo.currentTime = target; } catch (eStart) { /* not seekable yet */ }
        playOptions.startPosition = 0;
        if (window.OPENTV_DESKTOP && !relayBaseUrl) {
          stopPendingStart();
          pendingStart = target;
          pendingStartTimer = setInterval(tryPendingStart, 500);
          setTimeout(stopPendingStart, 60000);
        }
      }
      clearStatusWhenRunning();
      /* Prefer Spanish on the direct path as well.  Android chooses this PID
         internally; on webOS it is exposed only when the native AudioTrackList
         becomes available with the loaded media metadata. */
      if (state.playerMode === 'vod' && state.streamMode === 'normal') {
        var audioInfo = (state.playerItem && state.playerItem.streamAudioInfo);
        var nativeTrack = vodAudioChosen ? vodCurrentAudioTrack : preferredAudioIndex(audioInfo);
        if (selectNativeAudioTrack(nativeTrack)) {
          vodCurrentAudioTrack = nativeTrack;
        }
      }
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? relayStartOffset : (playerVideo.currentTime || 0);
        var totalDur = vodPlaybackDuration();
        updateVodProgress(cur, totalDur);
      }
    };
    playerVideo.ondurationchange = function () {
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var totalDur = vodPlaybackDuration();
        updateVodProgress(cur, totalDur);
      }
    };
    playerVideo.onplaying = function () {
      hideNextEpisodeLoading();
      clearStatus();
    };
    playerVideo.onended = function () {
      if (state.playerMode !== 'vod') { return; }
      if (window.OPENTV_DESKTOP) { offerNextEpisode(); } else { advanceToNextEpisode(); }
    };
    playerVideo.ontimeupdate = function () {
      if (playerVideo.currentTime > 0) { clearStatusWhenRunning(); }
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var totalDur = vodPlaybackDuration();
        updateVodProgress(cur, totalDur);
        updateSubtitleDisplay(cur);
        rememberWatchProgress(cur, totalDur);
      }
    };
    playerVideo.onpause = function () {
      stopVodProgressTicker();
      if (state.playerMode === 'vod') {
        var pausePosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
        var pauseDuration = vodPlaybackDuration();
        rememberWatchProgress(pausePosition, pauseDuration, true);
        showOsdIcon('pause');
        if (relayBaseUrl) { relayPaused = true; }
      }
    };
    playerVideo.onplay = function () {
      if (state.playerMode === 'vod') {
        showOsdIcon('none');
        startVodProgressTicker();
      }
    };
    playerVideo.onwaiting = function () {
      scheduleBufferingNotice('Cargando vídeo…');
    };
    playerVideo.onstalled = function () {
      scheduleBufferingNotice('Conectando…');
    };

    var transportOptions = {
      mediaTransportType: isHls ? 'HLS' : 'URI',
      option: {
        transmission: {
          playTime: { start: 0 }
        }
      }
    };
    var mediaOption = encodeURI(JSON.stringify(transportOptions));
    var typeStr = useNativeHlsFallback ? mime : (mime + ';mediaOption=' + mediaOption);

    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    playerVideo.removeAttribute('src');
    /* Newer webOS uses the MIME type and rejects the old custom property.
       Older sets retain the existing path above as their first attempt. */
    if (!useNativeHlsFallback) {
      try { playerVideo.mediaOption = transportOptions; } catch (eOpt) {}
    } else {
      try { playerVideo.mediaOption = null; } catch (eClearOpt) {}
    }

    var srcNode = document.createElement('source');
    srcNode.setAttribute('src', url);
    srcNode.setAttribute('type', typeStr);
    if (isHls) {
      /* LG's HLS pipeline reads mediaOption from the source element. Setting
         video.src afterwards replaces that source and silently drops HLS mode
         on recent webOS releases, resulting in MEDIA_ERR_SRC_NOT_SUPPORTED. */
      try { playerVideo.load(); } catch (eHlsReset) { /* ignore */ }
    }
    playerVideo.appendChild(srcNode);

    if (!isHls) {
      /* Starfish on webOS 3–6 does not reliably start a non-HLS <source>
         alone.  Keep the source node (for mediaOption) AND assign src, also
         for the local Fluent relay.  This is the proven 1.6.15 behaviour and
         prevents the player from staying forever at “Conectando…”. */
      try { playerVideo.src = url; } catch (eSrc) {}
    }
    try { playerVideo.currentTime = 0; } catch (eCt) {}

    playerVideo.classList.add('is-active');
    if (playerFrame) { playerFrame.style.display = 'none'; }
    try {
      playerVideo.load();
      if (playOptions.remainPaused) { playerVideo.pause(); return; }
      var p = playerVideo.play();
      if (p && p.catch) {
        p.catch(function () {
          if (playerVideo.error) { return; }
          state.streamError = 'Pulsa OK para iniciar la reproducción';
          setPlayerStatus(state.streamError);
        });
      }
    } catch (e2) {
      state.streamError = 'Pulsa OK para iniciar la reproducción';
      setPlayerStatus(state.streamError);
    }
  }

  /* The playable URL of a title (async: the addon source may need the
     service first). Callers check resolveSeq to drop a late answer. */
  function resolvePlayerStream(item, done) {
    /* Addon titles: the source the viewer chose (player/stremio-sources.js). */
    if (item && item._stremio) { return resolveStremioPlayback(item, done); }
    /* Anything else carries its own link. */
    var ep = state.playerEpisode;
    done((ep && ep.streamUrl) || (item && item.streamUrl) || '');
  }

  function startPlayerVideo(item, episode) {
    if (!playerVideo) { return; }
    if (episode) {
      state.playerEpisode = episode;
      state.playerSeasonIndex = state.detailSeason || 0;
    }
    if (item) { state.playerItem = item; }
    try { document.dispatchEvent(new CustomEvent('opentv:player-item')); } catch (eEv) { /* old webOS */ }
    if (window.OPENTV_DESKTOP) { installResume(); planResume(state.playerItem, state.playerEpisode); }
    var it = item || state.playerItem;
    if (it) { restoreSmoothMode(it); }
    stopPlayerVideo();
    if (!it) { return; }
    /* PC: the title's still until the first frame (not the previous title's). */
    if (window.OPENTV_DESKTOP && !platformIsTv()) {
      var still = heroArt(it) || it.poster || '';
      if (still) { playerVideo.poster = sizedImageUrl(still, 1280); } else { playerVideo.removeAttribute('poster'); }
    }
    vodAudioChosen = false;
    vodCurrentAudioTrack = 0;
    if (it._stremio) {
      resolvePlayerStream(it, function (url) {
        if (url) { playUrl(url); }
        else if (!state.streamError) { setPlayerStatus('Sin fuente de reproducción'); }
      });
      return;
    }
    var directUrl = (episode && episode.streamUrl) || it.streamUrl || '';
    if (!directUrl) { return; }
    playUrl(directUrl);
  }

  function expandToFullscreen(item, episode) {
    /* Stremio mode: first the viewer picks the source (or the saved one is used). */
    if (stremioNeedsPick(item, episode)) { return; }
    if (!playerStage) { buildPlayer(); }
    /* The detail screen already owns a mini player.  Moving that exact stream
       to fullscreen must not resolve it again, otherwise direct and relay
       VOD both restart from zero. */
    var sameEpisode = !episode || !state.playerEpisode ||
      state.playerEpisode === episode || state.playerEpisode.id === episode.id;
    var keepCurrentVideo = state.screen === 'detail' && playerVideo &&
      !!playerVideo.src && state.playerItem === item && sameEpisode;
    state.playerMode = 'vod';
    if (item && state.playerItem !== item) { resetMediaSelection(); }
    if (item) { state.playerItem = item; }
    if (episode) { state.playerEpisode = episode; }
    try { document.dispatchEvent(new CustomEvent('opentv:player-item')); } catch (eEv) { /* old webOS */ }
    if (item) { restoreSmoothMode(item); }
    state.playerReturn = { screen: 'detail', focus: state.focus };

    var scrPlayer = $('screen-player');
    var scrDetail = $('screen-detail');
    if (scrPlayer) {
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.add('is-active');
    }
    if (scrDetail) {
      scrDetail.classList.remove('is-active');
    }
    state.screen = 'player';
    playerStage.classList.add('is-vod');
    updatePlayer();
    setFocus(playerStage);
    showVodInfobar();

    if (!keepCurrentVideo) {
      startPlayerVideo(state.playerItem, state.playerEpisode);
    }
  }

  function openPlayer(mode, item, episode) {
    if (mode === 'vod' && state.screen === 'detail') {
      expandToFullscreen(item, episode);
      return;
    }
    if (!playerStage) { buildPlayer(); }
    /* Desktop TV: real full screen, like a TV (left again with the player). */
    if (window.OPENTV_DESKTOP && mode === 'live') { installLiveControls(); enterLiveFullscreen(); }
    /* Desktop: reuse the video that is already playing this channel. */
    var handedOver = false;
    if (mode === 'live' && liveHandoff && liveHandoff.type === 'player') {
      if (liveHandoff.key === liveChannelKey(CHANNELS[state.channel])) {
        returnPlayerToStage(true);
        handedOver = true;
      } else {
        returnPlayerToStage(false);
      }
    } else if (mode === 'live') {
      handedOver = borrowPreviewIntoPlayer();
    }
    if (mode === 'live' && !handedOver) { stopLivePreview(); }
    state.playerMode = mode;
    if (item && state.playerItem !== item) { resetMediaSelection(); }
    state.playerItem = item || null;
    state.playerEpisode = episode || null;
    if (mode === 'vod' && item) { restoreSmoothMode(item); }
    state.playerReturn = { screen: state.screen, focus: state.focus };
    state.channelsOpen = false;
    playerInfo.classList.remove('is-active');
    playerChannels.classList.remove('is-active');
    playerStage.classList.toggle('is-vod', mode === 'vod');
    updatePlayer();
    showScreen('player');
    setFocus(playerStage);
    updatePlayer();                 /* re-measure now that the screen is visible */
    if (mode === 'vod') {
      showVodInfobar();
      startPlayerVideo(state.playerItem, state.playerEpisode);
    } else {
      showInfobar();
      if (handedOver) { setPlayerStatus(''); }
      else { startLiveChannel(CHANNELS[state.channel]); }
    }
  }

  /* ---- player/source-rank.js ------------------------------------------------- */
  /* player/source-rank.js — Modo Addons (solo PC): qué es cada fuente (idiomas,
     calidad, CAM, códec, sitio), las preferencias de fuentes del usuario (como
     la página "configure" de Torrentio, pero aplicadas por OpenTV a todos los
     addons) y la elección de la mejor fuente para este usuario y su internet.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var SOURCE_PREFS_KEY = 'opentv_source_prefs_v1';
  var NET_SPEED_KEY = 'opentv_net_speed_v1';

  /* Languages a source can be tagged with, in the order the chips show them. */
  var SOURCE_LANG_LABELS = {
    latino: 'Latino', castellano: 'Castellano', es: 'Español', en: 'Inglés', pt: 'Portugués',
    fr: 'Francés', it: 'Italiano', de: 'Alemán', ru: 'Ruso', ja: 'Japonés', ko: 'Coreano', multi: 'Multi'
  };
  /* The languages the viewer can put first (Ajustes → Preferencias de addons). */
  var SOURCE_PREF_LANGS = ['latino', 'castellano', 'en', 'pt'];

  /* Flags as the addons write them (Torrentio: 🇲🇽 = latino, 🇪🇸 = España). */
  var SOURCE_FLAGS = [
    ['🇲🇽', 'latino'], ['🇦🇷', 'latino'], ['🇨🇴', 'latino'], ['🇨🇱', 'latino'], ['🇵🇪', 'latino'], ['🇻🇪', 'latino'],
    ['🇪🇸', 'castellano'], ['🇬🇧', 'en'], ['🇺🇸', 'en'], ['🇵🇹', 'pt'], ['🇧🇷', 'pt'], ['🇫🇷', 'fr'],
    ['🇮🇹', 'it'], ['🇩🇪', 'de'], ['🇷🇺', 'ru'], ['🇯🇵', 'ja'], ['🇰🇷', 'ko'], ['🌎', 'multi'], ['🌐', 'multi'], ['🌍', 'multi']
  ];

  /* "Subtítulos en español" is not Spanish audio. */
  var SUBS_ES_RE = /\b(vose|v\.o\.s\.e|subtitulad[oa]s?|subs?[\s._-]*(esp|spa|español|espanol|latino|lat|es))\b/gi;
  var LATINO_RE = /\b(latino|latina|latam|lat|latinoamerican[oa]|espa[ñn]ol[\s._-]*latino|dual[\s._-]*lat(ino)?)\b/i;
  var CASTELLANO_RE = /\b(castellano|castilian|es[-_]es|espa[ñn]ol[\s._-]*(de[\s._-]*)?espa[ñn]a)\b/i;
  var SPANISH_RE = /\b(spanish|espa[ñn]ol|esp|spa)\b/i;
  var ENGLISH_RE = /\b(english|eng|ingl[eé]s)\b/i;
  var MULTI_RE = /\b(multi([\s._-]?(audio|lang|language|sub))?|dual([\s._-]?audio)?)\b/i;
  var CAM_RE = /\b((hd)?cam(rip)?|hd-?ts|telesync|tele-?cine|hd-?tc|(dvd|bd)?scr(eener)?|pre-?dvd)\b/i;

  /* What a source is, from what the addon wrote about it (name, title, file). */
  function sourceTags(name, title, filename) {
    var raw = String(name || '') + '\n' + String(title || '') + '\n' + String(filename || '');
    var text = raw.replace(/[\[\]()]/g, ' ');
    var subsEs = false;
    var audioText = text.replace(SUBS_ES_RE, function () { subsEs = true; return ' '; });
    var langs = [];
    function add(l) { if (langs.indexOf(l) === -1) { langs.push(l); } }
    for (var i = 0; i < SOURCE_FLAGS.length; i++) {
      if (raw.indexOf(SOURCE_FLAGS[i][0]) !== -1) { add(SOURCE_FLAGS[i][1]); }
    }
    if (LATINO_RE.test(audioText)) { add('latino'); }
    if (CASTELLANO_RE.test(audioText)) { add('castellano'); }
    if (langs.indexOf('latino') === -1 && langs.indexOf('castellano') === -1 && SPANISH_RE.test(audioText)) { add('es'); }
    if (ENGLISH_RE.test(audioText)) { add('en'); }
    if (/\b(portugu[eê]s|portuguese|dublado)\b/i.test(audioText)) { add('pt'); }
    if (/\b(french|fran[cç]ais|vff|truefrench)\b/i.test(audioText)) { add('fr'); }
    if (/\b(italian|ita)\b/i.test(audioText)) { add('it'); }
    if (/\b(german|deutsch|ger)\b/i.test(audioText)) { add('de'); }
    if (/\b(russian|rus)\b/i.test(audioText)) { add('ru'); }
    var multi = MULTI_RE.test(audioText) || langs.indexOf('multi') !== -1;
    if (multi && langs.indexOf('multi') === -1) { add('multi'); }
    /* "Dual" and multi-audio releases keep the original (almost always English) track. */
    if (multi && langs.indexOf('en') === -1) { add('en'); }
    var only = langs.filter(function (l) { return l !== 'multi'; });
    var hdr = /\b(hdr(10)?\+?|dv|dovi|dolby[\s._-]?vision)\b/i.test(text);
    /* Torrentio and most scrapers: "⚙️ ThePirateBay" after the size. */
    var site = /⚙️?\s*([^\n👤💾⚙]+)/.exec(String(title || ''));
    return {
      langs: only,
      /* Nothing said about the language: the original audio (usually English). */
      original: !only.length,
      multi: multi,
      subsEs: subsEs,
      cam: CAM_RE.test(text) || /(^|[\s.\-])TS($|[\s.\-])/.test(raw.replace(/\.ts$/i, '')),
      hevc: /\b(x\.?265|h\.?265|hevc)\b/i.test(text),
      tenBit: /\b10[\s._-]?bits?\b/i.test(text),
      hdr: hdr,
      remux: /\bremux\b/i.test(text),
      /* Audio and video codecs some devices cannot decode (Fire TV: DTS, TrueHD). */
      audioDts: /\bdts([\s._-]?(hd|ma|x|es))*\b/i.test(text),
      audioTrueHd: /\btrue[\s._-]?hd\b/i.test(text),
      audioEac3: /\b(e-?ac-?3|ddp|dd\+)([\s._-]?[257]\.[01])?\b/i.test(text),
      av1: /\bav1\b/i.test(text),
      threeD: /\b(3d|h-?sbs|half-?sbs|h-?ou)\b/i.test(text),
      mp4: /\.(mp4|m4v)\b/i.test(String(filename || '') + ' ' + String(title || '')),
      provider: site ? site[1].trim().slice(0, 40) : ''
    };
  }

  function sourceHasLang(src, lang) {
    if (lang === 'en') { return src.langs.indexOf('en') !== -1 || src.original; }
    return src.langs.indexOf(lang) !== -1;
  }

  /* "Latino · Inglés", "Subs ES", "CAM"… for the source list. */
  function sourceLangText(src) {
    var out = [];
    src.langs.forEach(function (l) { if (SOURCE_LANG_LABELS[l]) { out.push(SOURCE_LANG_LABELS[l]); } });
    if (src.multi && out.length < 2) { out.push('Multi'); }
    if (src.subsEs) { out.push('Subs ES'); }
    return out.join(' · ');
  }

  /* ------------------------------------------------ preferences */
  function defaultSourcePrefs() {
    var audio = typeof preferredLanguageCode === 'function' ? preferredLanguageCode() : 'es';
    return {
      langs: audio === 'en' ? ['en'] : (audio === 'pt' ? ['pt'] : ['latino', 'castellano']),
      quality: 'auto',        /* auto (by the connection) | 4K | 1080p | 720p | SD */
      exclude: [],            /* 4K 1080p 720p SD CAM unknown */
      minSeeds: 0,
      maxMovieGB: 0,
      maxEpisodeGB: 0,
      perQuality: 0,          /* at most N per quality and addon (0 = all) */
      hiddenProviders: [],
      providers: [],          /* sites seen, to offer them in the editor */
      autoPlay: true,
      subsFrom: 'file'        /* file | addons | fileOnly | addonsOnly: where subtitles come from first */
    };
  }

  function loadSourcePrefs() {
    var p = defaultSourcePrefs();
    try {
      var s = JSON.parse(localStorage.getItem(SOURCE_PREFS_KEY) || 'null');
      if (s && typeof s === 'object') {
        if (Object.prototype.toString.call(s.langs) === '[object Array]') {
          p.langs = s.langs.filter(function (l) { return SOURCE_PREF_LANGS.indexOf(l) !== -1; });
        }
        if (/^(auto|4K|1080p|720p|SD)$/.test(s.quality)) { p.quality = s.quality; }
        if (Object.prototype.toString.call(s.exclude) === '[object Array]') {
          p.exclude = s.exclude.filter(function (q) { return /^(4K|1080p|720p|SD|CAM|unknown)$/.test(q); });
        }
        ['minSeeds', 'maxMovieGB', 'maxEpisodeGB', 'perQuality'].forEach(function (k) {
          var n = Number(s[k]);
          if (n >= 0 && n < 10000) { p[k] = n; }
        });
        ['hiddenProviders', 'providers'].forEach(function (k) {
          if (Object.prototype.toString.call(s[k]) === '[object Array]') {
            p[k] = s[k].filter(function (x) { return typeof x === 'string' && x; }).slice(0, 60);
          }
        });
        if (typeof s.autoPlay === 'boolean') { p.autoPlay = s.autoPlay; }
        if (/^(file|addons|fileOnly|addonsOnly)$/.test(s.subsFrom)) { p.subsFrom = s.subsFrom; }
      }
    } catch (e) { /* defaults */ }
    return p;
  }

  function saveSourcePrefs(p) {
    try { localStorage.setItem(SOURCE_PREFS_KEY, JSON.stringify(p)); } catch (e) { /* full */ }
  }

  /* Sites seen in the results, so the editor can offer to hide them. */
  function noteSourceProviders(list) {
    var p = loadSourcePrefs();
    var changed = false;
    list.forEach(function (s) {
      if (s.provider && p.providers.indexOf(s.provider) === -1) { p.providers.push(s.provider); changed = true; }
    });
    if (changed) { p.providers = p.providers.slice(-60); saveSourcePrefs(p); }
  }

  /* Why a source is hidden by the preferences ('' = it is shown). */
  function sourcePrefsBlock(src, prefs, isEpisode) {
    var q = src.cam ? 'CAM' : (src.quality || 'unknown');
    if (prefs.exclude.indexOf(q) !== -1) { return 'calidad'; }
    if (src.kind === 'torrent' && prefs.minSeeds > 0 && src.seeds !== null && src.seeds < prefs.minSeeds) { return 'semillas'; }
    var maxGB = isEpisode ? prefs.maxEpisodeGB : prefs.maxMovieGB;
    if (maxGB > 0 && src.sizeBytes > maxGB * 1073741824) { return 'tamaño'; }
    if (src.provider && prefs.hiddenProviders.indexOf(src.provider) !== -1) { return 'sitio'; }
    return '';
  }

  /* ------------------------------------------------ the connection */
  /* Mbps the viewer's internet is known to reach (0 = not known yet): the
     fastest real download seen (torrents, downloads). Chromium's own estimate
     (navigator.connection) is not used: with little traffic it said ~1 Mbps on
     a fast line, which would have picked SD sources. */
  function knownNetSpeed() {
    try {
      var s = JSON.parse(localStorage.getItem(NET_SPEED_KEY) || 'null');
      /* A peak older than two weeks may be another network. */
      if (s && s.mbps > 0 && Date.now() - (s.at || 0) < 14 * 86400000) { return Number(s.mbps) || 0; }
    } catch (e) { /* none */ }
    return 0;
  }

  /* bytesPerSec measured on a real download (only ever raises the peak). */
  function noteNetSpeed(bytesPerSec) {
    var mbps = (Number(bytesPerSec) || 0) * 8 / 1000000;
    if (!(mbps > 0.2)) { return; }
    try {
      var s = JSON.parse(localStorage.getItem(NET_SPEED_KEY) || 'null') || {};
      var old = (s.mbps > 0 && Date.now() - (s.at || 0) < 14 * 86400000) ? Number(s.mbps) : 0;
      if (mbps > old) { localStorage.setItem(NET_SPEED_KEY, JSON.stringify({ mbps: Math.round(mbps * 10) / 10, at: Date.now() })); }
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------ this device */
  /* Android: what the device decodes and shows, and its free space (the
     service's ping). null on PC: there the relay converts any audio and
     Chromium decodes HEVC, so nothing is ruled out. */
  var deviceProfile = null;
  function setDeviceProfile(media, storage) {
    deviceProfile = { media: media || null, storage: storage || null };
  }

  /* How bad a source is for this device: 0 = fine. A file whose audio or
     video the device cannot decode would play silent or not at all. */
  function sourceDevicePenalty(src, isTorrent) {
    var d = deviceProfile;
    if (!d) { return 0; }
    var p = 0, m = d.media;
    if (m) {
      if (src.audioDts && m.dts === false) { p += 2500; }
      if (src.audioTrueHd && m.truehd === false) { p += 2500; }
      if (src.audioEac3 && m.eac3 === false) { p += 1500; }
      if (src.hevc && m.hevc === false) { p += 3000; }
      else if (src.hevc && src.tenBit && m.hevc10 === false) { p += 2000; }
      if (src.av1 && m.av1 === false) { p += 3000; }
      if (src.quality === '4K' && m.uhd === false) { p += 900; }
      if (src.hdr && m.hdr === false) { p += 500; }
    }
    /* A torrent bigger than the free space: it cannot be watched to the end. */
    var free = d.storage && d.storage.free;
    if (isTorrent && free > 0 && src.sizeBytes > free * 0.9) { p += 2000; }
    return p;
  }

  /* "Sin sonido en este aparato (DTS)": why the device avoids a source. */
  function sourceDeviceNote(src) {
    var d = deviceProfile, m = d && d.media;
    if (!d) { return ''; }
    if (m && ((src.audioDts && m.dts === false) || (src.audioTrueHd && m.truehd === false))) { return 'Audio no compatible con este aparato'; }
    if (m && ((src.hevc && m.hevc === false) || (src.av1 && m.av1 === false))) { return 'Vídeo no compatible con este aparato'; }
    var free = d.storage && d.storage.free;
    if (src.kind === 'torrent' && free > 0 && src.sizeBytes > free * 0.9) { return 'No cabe en este aparato'; }
    return '';
  }

  var SOURCE_Q_RANK = { '4K': 4, '1080p': 3, '720p': 2, 'SD': 1 };

  /* Full HD unless the connection is known to be slower. */
  function sourceTargetQuality(prefs, mbps) {
    if (prefs.quality !== 'auto') { return prefs.quality; }
    if (!mbps || mbps >= 8) { return '1080p'; }
    if (mbps >= 3.5) { return '720p'; }
    return 'SD';
  }

  /* ------------------------------------------------ the score */
  /* ctx: { prefs, mbps, duration (s), episode }. Higher is better. Language
     first, then a playable quality for this connection, then a healthy
     torrent, then files that play without heavy conversion. A CAM only wins
     when everything else is CAM too (new releases). */
  function scoreSource(src, ctx) {
    var prefs = ctx.prefs;
    var score = 0;
    var n = prefs.langs.length;
    var langScore = 0;
    for (var i = 0; i < n; i++) {
      var l = prefs.langs[i];
      var w = (n - i) * 1000;
      if (src.langs.indexOf(l) !== -1) { langScore = Math.max(langScore, w); }
      else if (l === 'en' && src.original) { langScore = Math.max(langScore, w - 250); }
      else if ((l === 'latino' || l === 'castellano') && src.langs.indexOf('es') !== -1) { langScore = Math.max(langScore, w - 500); }
    }
    score += langScore;
    /* Dubbed into a language the viewer did not ask for. */
    if (n && !langScore && src.langs.length && !src.multi) { score -= 400; }

    var target = SOURCE_Q_RANK[sourceTargetQuality(prefs, ctx.mbps)];
    var rank = SOURCE_Q_RANK[src.quality] || 1.5;
    score += rank === target ? 600 : (rank < target ? 600 - 220 * (target - rank) : 600 - 150 * (rank - target));
    if (src.cam) { score -= 6000; }

    var secs = ctx.duration > 0 ? ctx.duration : (ctx.episode ? 2700 : 6600);
    var mbpsNeeded = src.sizeBytes ? src.sizeBytes * 8 / secs / 1000000 : 0;
    if (ctx.mbps > 0 && mbpsNeeded > ctx.mbps * 0.85) { score -= 300 + Math.min(500, 100 * mbpsNeeded / ctx.mbps); }
    if (mbpsNeeded > 30 || src.remux) { score -= 250; }
    if (src.quality === '1080p' && mbpsNeeded > 0 && mbpsNeeded < 1) { score -= 120; }

    if (src.kind === 'torrent') {
      if (src.seeds !== null) {
        score += src.seeds < 3 ? -350 : Math.min(260, 90 * Math.log(src.seeds + 1) / Math.LN10);
      }
    } else {
      score += 200;   /* starts at once, no peers needed */
    }
    if (src.hevc) { score -= 80; }
    if (src.tenBit) { score -= 60; }
    if (src.hdr) { score -= 140; }
    if (src.threeD) { score -= 500; }
    if (src.mp4) { score += 30; }
    /* Android: what this device cannot decode, show or store. */
    score -= sourceDevicePenalty(src, src.kind === 'torrent');
    /* The addon's own order breaks ties. */
    return score - (src._i || 0) * 0.5;
  }

  function sourceRankContext(item, episode) {
    var target = episode || item || {};
    return {
      prefs: loadSourcePrefs(),
      mbps: knownNetSpeed(),
      duration: typeof durationToSeconds === 'function' ? durationToSeconds(target.duration || (item && item.duration)) : 0,
      episode: !!episode
    };
  }

  /* The best of `list` for ctx, among the ones the preferences show (or among
     all of them when the preferences hide every source). */
  function bestSource(list, ctx) {
    var best = null, bestScore = -Infinity, shown = 0;
    for (var pass = 0; pass < 2 && !best; pass++) {
      for (var i = 0; i < list.length; i++) {
        if (pass === 0 && sourcePrefsBlock(list[i], ctx.prefs, ctx.episode)) { continue; }
        shown++;
        var s = scoreSource(list[i], ctx);
        if (s > bestScore) { bestScore = s; best = list[i]; }
      }
      if (pass === 0 && shown) { break; }
    }
    return best;
  }

  /* "Latino · Full HD · 85 semillas · 2,1 GB": why it was chosen. */
  function sourceReason(src) {
    var q = { '4K': '4K', '1080p': 'Full HD', '720p': 'HD', 'SD': 'SD' }[src.quality] || '';
    var parts = [];
    var langs = sourceLangText(src);
    if (langs) { parts.push(langs); }
    if (src.cam) { parts.push('CAM'); }
    if (q) { parts.push(q); }
    if (src.kind === 'torrent') { if (src.seeds !== null) { parts.push(src.seeds + (src.seeds === 1 ? ' semilla' : ' semillas')); } }
    else { parts.push('Directo'); }
    if (src.size) { parts.push(src.size.replace('.', ',')); }
    return parts.join(' · ');
  }

  /* ------------------------------------------------ preferences editor */
  /* The options of Torrentio's configure page, applied by OpenTV to every
     addon; in Ajustes → Preferencias de addons and inside "Elegir fuente".
     Same rows as the rest of Ajustes (screens/settings-hub.js): grouped, the
     name and ⓘ on the left, the choices on the right. onChange runs after
     each change (already saved). */
  function buildSourcePrefsEditor(onChange) {
    var root = el('div', 'set-page srcpref');
    var group = root;
    function changed() { if (onChange) { onChange(); } }
    function section(title) { group = settingsGroup(root, title); }
    function row(label, hint) {
      var r = el('div', 'set-row');
      var name = el('div', 'set-row-name');
      name.appendChild(el('span', null, label));
      if (hint) { name.appendChild(settingsInfo(hint)); }
      r.appendChild(name);
      var seg = el('div', 'set-seg is-wrap');
      r.appendChild(seg);
      group.appendChild(r);
      return seg;
    }
    function chip(parent, text, on, run) {
      var c = el('div', 'set-seg-btn focusable' + (on ? ' is-on' : ''), text);
      c.setAttribute('role', 'button');
      c._activate = function () { run(); paint(); changed(); };
      parent.appendChild(c);
      return c;
    }
    function paint() {
      var keep = state.focus && state.focus.classList && state.focus.classList.contains('set-seg-btn') ? state.focus.textContent : '';
      var keepRow = keep && state.focus.parentNode ? Array.prototype.indexOf.call(root.querySelectorAll('.set-seg'), state.focus.parentNode) : -1;
      clear(root);
      group = root;
      var p = loadSourcePrefs();
      function save() { saveSourcePrefs(p); }

      section('Idioma');
      var langs = row('Idiomas preferidos', 'Toca en orden: el 1 va primero. Sin bandera de idioma = inglés (original).');
      SOURCE_PREF_LANGS.forEach(function (l) {
        var pos = p.langs.indexOf(l);
        chip(langs, (pos !== -1 ? (pos + 1) + ' · ' : '') + SOURCE_LANG_LABELS[l], pos !== -1, function () {
          if (pos !== -1) { p.langs.splice(pos, 1); } else { p.langs.push(l); }
          save();
        });
      });
      var subs = row('Subtítulos', 'Los del archivo vienen con el vídeo y van sincronizados. Si no hay, se usan los de tus addons.');
      [['file', 'Archivo primero'], ['addons', 'Addons primero'], ['fileOnly', 'Solo archivo'], ['addonsOnly', 'Solo addons']].forEach(function (o) {
        chip(subs, o[1], p.subsFrom === o[0], function () { p.subsFrom = o[0]; save(); });
      });

      section('Calidad');
      var mbps = knownNetSpeed();
      var quality = row('Calidad', mbps ? 'Tu internet: ~' + Math.round(mbps) + ' Mbps. Automática elige la mejor que alcanza.'
        : 'Automática busca Full HD y baja si tu internet no alcanza.');
      [['auto', 'Automática'], ['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD']].forEach(function (o) {
        chip(quality, o[1], p.quality === o[0], function () { p.quality = o[0]; save(); });
      });
      var exclude = row('Ocultar', 'Calidades que nunca se muestran. CAM: grabadas en el cine.');
      [['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD'], ['CAM', 'CAM'], ['unknown', 'Sin calidad']].forEach(function (o) {
        var on = p.exclude.indexOf(o[0]) !== -1;
        chip(exclude, o[1], on, function () {
          if (on) { p.exclude.splice(p.exclude.indexOf(o[0]), 1); } else { p.exclude.push(o[0]); }
          save();
        });
      });
      var per = row('Máximo por calidad', 'Cuántas fuentes de cada calidad muestra cada addon.');
      [[0, 'Todas'], [3, '3'], [5, '5'], [10, '10']].forEach(function (o) {
        chip(per, o[1], p.perQuality === o[0], function () { p.perQuality = o[0]; save(); });
      });

      section('Torrents');
      var seeds = row('Mínimo de semillas', 'Se ocultan los torrents con menos personas compartiendo.');
      [[0, 'Cualquiera'], [2, '2'], [5, '5'], [10, '10'], [25, '25']].forEach(function (o) {
        chip(seeds, o[1], p.minSeeds === o[0], function () { p.minSeeds = o[0]; save(); });
      });
      var movie = row('Tamaño máximo · Películas');
      [[0, 'Sin límite'], [2, '2 GB'], [4, '4 GB'], [8, '8 GB'], [15, '15 GB']].forEach(function (o) {
        chip(movie, o[1], p.maxMovieGB === o[0], function () { p.maxMovieGB = o[0]; save(); });
      });
      var ep = row('Tamaño máximo · Capítulos');
      [[0, 'Sin límite'], [0.5, '500 MB'], [1, '1 GB'], [2, '2 GB'], [4, '4 GB']].forEach(function (o) {
        chip(ep, o[1], p.maxEpisodeGB === o[0], function () { p.maxEpisodeGB = o[0]; save(); });
      });
      if (p.providers.length || p.hiddenProviders.length) {
        var sites = row('Sitios', 'Toca un sitio para ocultar sus fuentes (tachado = oculto).');
        var all = p.providers.slice();
        p.hiddenProviders.forEach(function (h) { if (all.indexOf(h) === -1) { all.push(h); } });
        all.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
        all.forEach(function (name) {
          var hidden = p.hiddenProviders.indexOf(name) !== -1;
          var c = chip(sites, name, !hidden, function () {
            if (hidden) { p.hiddenProviders.splice(p.hiddenProviders.indexOf(name), 1); } else { p.hiddenProviders.push(name); }
            save();
          });
          if (hidden) { c.classList.add('is-struck'); }
        });
      }

      section('Al reproducir');
      var auto = row('Fuente', 'La recomendada se elige por idioma, calidad, semillas y lo que tu aparato reproduce.');
      chip(auto, 'Usar la recomendada', p.autoPlay, function () { p.autoPlay = true; save(); });
      chip(auto, 'Preguntarme', !p.autoPlay, function () { p.autoPlay = false; save(); });

      var reset = el('div', 'set-reset');
      var rb = el('div', 'set-seg-btn focusable', 'Restablecer');
      rb._activate = function () {
        var keepSites = loadSourcePrefs().providers;
        var d = defaultSourcePrefs();
        d.providers = keepSites;
        saveSourcePrefs(d);
        paint();
        changed();
      };
      reset.appendChild(rb);
      root.appendChild(reset);

      /* Keep the focus on the choice that was pressed (the rows are redrawn). */
      if (keep && keepRow !== -1) {
        var rows = root.querySelectorAll('.set-seg');
        var target = rows[keepRow] && rows[keepRow].querySelectorAll('.set-seg-btn');
        var pick = null;
        for (var i = 0; target && i < target.length && !pick; i++) {
          if (target[i].textContent.replace(/^\d+ · /, '') === keep.replace(/^\d+ · /, '')) { pick = target[i]; }
        }
        if (pick) { setFocus(pick); }
      }
    }
    paint();
    return root;
  }

  /* ---- player/stremio-sources.js --------------------------------------------- */
  /* player/stremio-sources.js — Modo manual (Stremio, solo PC): elegir la fuente
     de una película o capítulo (enlace directo o torrent) y reproducirla.
     Parte del módulo único de la app (ver ui/js/src/README.md).

     Flujo: Reproducir → (fuente guardada de ese título, o panel "Elegir
     fuente") → servicio resolveExternal (y torrentStart para torrents) → el
     mismo reproductor y modo compatible para todo lo que dan los addons. */

  var STREMIO_PICKS_KEY = 'opentv_stremio_picks_v1';
  var TORRENT_NOTICE_KEY = 'opentv_torrent_notice_v1';
  var STREMIO_PICKS_MAX = 300;

  /* ------------------------------------------------ remembered sources */
  function stremioTargetId(item, episode) {
    if (isSeriesItem(item)) { return episode && episode.id ? String(episode.id) : ''; }
    return item._stremioId || String(item.id).replace(/^stremio:/, '');
  }

  function loadStremioPicks() {
    try { return JSON.parse(localStorage.getItem(STREMIO_PICKS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function savedStremioPick(item, episode) {
    var id = stremioTargetId(item, episode);
    return id ? (loadStremioPicks()[id] || null) : null;
  }

  function rememberStremioPick(item, episode, src) {
    var id = stremioTargetId(item, episode);
    if (!id || !src) { return; }
    var picks = loadStremioPicks();
    picks[id] = {
      addon: src.addon, url: src.url || '', infoHash: src.infoHash || '', fileIdx: src.fileIdx,
      sources: src.sources || null, headers: src.headers || null, notWebReady: !!src.notWebReady,
      filename: src.filename || '', label: src.label || '', quality: src.quality || '',
      langs: src.langs || [], original: !!src.original, at: Date.now()
    };
    var keys = Object.keys(picks);
    if (keys.length > STREMIO_PICKS_MAX) {
      keys.sort(function (a, b) { return (picks[a].at || 0) - (picks[b].at || 0); });
      for (var i = 0; i < keys.length - STREMIO_PICKS_MAX; i++) { delete picks[keys[i]]; }
    }
    try { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* full */ }
  }

  function forgetStremioPick(item, episode) {
    var id = stremioTargetId(item, episode);
    var picks = loadStremioPicks();
    if (id && picks[id]) {
      delete picks[id];
      try { localStorage.setItem(STREMIO_PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* ignore */ }
    }
    var target = episode || item;
    if (target) { target._stremioSource = null; }
  }

  /* ------------------------------------------------ the addons' sources */
  function stremioStreamId(item, episode) {
    var id = isSeriesItem(item) ? (episode && episode.id) : (item._stremioId || String(item.id).replace(/^stremio:/, ''));
    return encodeURIComponent(String(id || '')).replace(/%3A/gi, ':');
  }

  /* "Torrentio\n1080p" + "Movie.2010.1080p.mkv\n👤 23 💾 2.1 GB ⚙️ Site" → parts. */
  function describeStremioStream(s, addonName) {
    var name = String(s.name || addonName || '').replace(/\s+/g, ' ').trim();
    var title = String(s.title || s.description || '');
    var text = name + ' ' + title;
    var quality = /\b(2160p|4k|uhd)\b/i.test(text) ? '4K' : (/\b1080p\b/i.test(text) ? '1080p' :
      (/\b720p\b/i.test(text) ? '720p' : (/\b(480p|sd)\b/i.test(text) ? 'SD' : '')));
    var size = /💾\s*([\d.,]+\s*[KMGT]i?B)/i.exec(title) || /\b([\d.,]+\s?[MG]B)\b/i.exec(title);
    var seeds = /👤\s*(\d+)/.exec(title);
    /* Size and peers have their own place in the row: drop them from the text. */
    var lines = title.replace(/👤\s*\d+/g, '').replace(/💾\s*[\d.,]+\s*[KMGT]i?B/gi, '').split(/\n+/);
    var hints = s.behaviorHints || {};
    var tags = sourceTags(name, title, hints.filename);
    return {
      addon: addonName,
      kind: s.infoHash ? 'torrent' : (s.url ? 'direct' : 'other'),
      url: s.url || '',
      infoHash: s.infoHash ? String(s.infoHash).toLowerCase() : '',
      fileIdx: s.fileIdx,
      sources: s.sources || null,
      headers: (hints.proxyHeaders && hints.proxyHeaders.request) || null,
      notWebReady: !!hints.notWebReady,
      filename: hints.filename || '',
      quality: quality,
      size: size ? size[1] : '',
      sizeBytes: size ? sizeToBytes(size[1]) : 0,
      seeds: seeds ? Number(seeds[1]) : null,
      /* Languages as the addons write them (flags or words): latino,
         castellano, es (Spanish, variant not said), en… (source-rank.js). */
      langs: tags.langs,
      original: tags.original,
      multi: tags.multi,
      subsEs: tags.subsEs,
      spanish: tags.langs.indexOf('latino') !== -1 || tags.langs.indexOf('castellano') !== -1 || tags.langs.indexOf('es') !== -1,
      cam: tags.cam,
      hevc: tags.hevc,
      tenBit: tags.tenBit,
      hdr: tags.hdr,
      remux: tags.remux,
      audioDts: tags.audioDts,
      audioTrueHd: tags.audioTrueHd,
      audioEac3: tags.audioEac3,
      av1: tags.av1,
      threeD: tags.threeD,
      mp4: tags.mp4,
      provider: tags.provider,
      label: (lines[0] || name || 'Fuente').trim(),
      detail: lines.slice(1).join(' ').replace(/\s+/g, ' ').trim(),
      name: name
    };
  }

  /* "2.1 GB" → bytes, to sort the sources by size. */
  function sizeToBytes(text) {
    var m = /([\d.,]+)\s*([KMGT])i?B/i.exec(String(text || ''));
    if (!m) { return 0; }
    var n = parseFloat(m[1].replace(',', '.')) || 0;
    return n * Math.pow(1024, { K: 1, M: 2, G: 3, T: 4 }[m[2].toUpperCase()]);
  }

  function stremioSourcePlayable(src) {
    if (src.kind === 'torrent') { return platformHas('torrents') && /^[0-9a-f]{40}$/.test(src.infoHash); }
    return src.kind === 'direct' && /^https?:\/\//i.test(src.url);
  }

  /* Asks every addon with "stream" at once; onUpdate(groups, pending) runs as
     each one answers, so the list fills in while the slow ones search. */
  /* What the addons answered for a title or episode, kept 10 minutes: an
     episode picked on the details screen has its sources ready when the
     viewer presses Reproducir. Also one lookup at a time per episode. */
  var STREAMS_CACHE_MS = 10 * 60 * 1000;
  var streamsCache = {};      /* key → { at, groups } */
  var streamsInFlight = {};   /* key → [onUpdate…] */

  function copyStreamGroups(groups) {
    return groups.map(function (g) {
      var c = {};
      for (var k in g) { if (Object.prototype.hasOwnProperty.call(g, k)) { c[k] = g[k]; } }
      c.sources = g.sources.slice();
      return c;
    });
  }

  function fetchStremioStreams(item, episode, onUpdate) {
    var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
    var key = type + '|' + stremioStreamId(item, episode) + '|' + getVodSourcesConfig().addons.length;
    var hit = streamsCache[key];
    if (hit && Date.now() - hit.at < STREAMS_CACHE_MS) { onUpdate(copyStreamGroups(hit.groups), 0); return; }
    if (streamsInFlight[key]) { streamsInFlight[key].push(onUpdate); return; }
    var listeners = streamsInFlight[key] = [onUpdate];
    fetchStremioStreamsNow(item, episode, function (groups, pending) {
      if (!pending) {
        delete streamsInFlight[key];
        /* (Nothing kept when every addon failed: try again next time.) */
        if (groups.some(function (g) { return g.state === 'done'; })) { streamsCache[key] = { at: Date.now(), groups: copyStreamGroups(groups) }; }
      }
      for (var i = 0; i < listeners.length; i++) { listeners[i](pending ? groups : copyStreamGroups(groups), pending); }
    });
  }

  function fetchStremioStreamsNow(item, episode, onUpdate) {
    var cfg = getVodSourcesConfig();
    var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
    var rawId = isSeriesItem(item) ? (episode && episode.id) : (item._stremioId || '');
    var groups = [];
    for (var i = 0; i < cfg.addons.length; i++) {
      if (addonSupports(cfg.addons[i], 'stream', type, rawId)) {
        groups.push({ addon: cfg.addons[i], name: cfg.addons[i].name, state: 'loading', sources: [], hidden: 0, dead: 0 });
      }
    }
    var pending = groups.length;
    onUpdate(groups, pending);
    groups.forEach(function (g) {
      addonRequest(g.addon.baseUrl + '/stream/' + encodeURIComponent(type) + '/' + stremioStreamId(item, episode) + '.json', function (err, payload) {
        var streams = (!err && payload && payload.streams) ? payload.streams : [];
        for (var s = 0; s < streams.length; s++) {
          var src = describeStremioStream(streams[s], g.name);
          src._i = g.sources.length;   /* the addon's own order, a tie-breaker */
          /* A torrent nobody is sharing (0 peers) would never start: left out. */
          if (src.kind === 'torrent' && src.seeds === 0) { g.dead++; }
          else if (stremioSourcePlayable(src)) { g.sources.push(src); } else { g.hidden++; }
        }
        g.state = err ? 'error' : 'done';
        g.error = err || '';
        noteSourceProviders(g.sources);
        onUpdate(groups, --pending);
      }, 25000);
    });
  }

  /* Next episode with no source chosen: the best one from the same addon,
     quality and type as before, or else the best of all. */
  function autoPickStremioSource(item, episode, previous, done) {
    var finished = false;
    fetchStremioStreams(item, episode, function (groups, pending) {
      if (finished || pending > 0) { return; }
      finished = true;
      var all = [];
      groups.forEach(function (g) { all = all.concat(g.sources); });
      var ctx = sourceRankContext(item, episode);
      var best = null;
      if (previous) {
        best = bestSource(all.filter(function (s) {
          return s.addon === previous.addon && s.quality === previous.quality && s.kind === previous.kind;
        }), ctx);
      }
      done(best || bestSource(all, ctx) || null);
    });
  }

  /* ------------------------------------------------ "Elegir fuente" panel */
  var sourcePickerOpen = false;
  var sourcePickerNode = null;
  var sourcePickerReturn = null;
  var sourcePickerSeq = 0;
  var sourcePickerCleanup = null;

  function closeSourcePicker() {
    sourcePickerOpen = false;
    sourcePickerSeq++;
    if (sourcePickerCleanup) { sourcePickerCleanup(); sourcePickerCleanup = null; }
    if (sourcePickerNode && sourcePickerNode.parentNode) { sourcePickerNode.parentNode.removeChild(sourcePickerNode); }
    sourcePickerNode = null;
    if (sourcePickerReturn && isVisible(sourcePickerReturn)) { setFocus(sourcePickerReturn); }
    sourcePickerReturn = null;
  }

  /* "Elegir fuente" filters, kept for the next title. */
  var SOURCE_FILTERS_KEY = 'opentv_source_filters_v1';
  function loadSourceFilters() {
    var f = { quality: 'all', kind: 'all', lang: 'all', sort: 'rec' };
    try {
      var saved = JSON.parse(localStorage.getItem(SOURCE_FILTERS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (/^(all|4K|1080p|720p|SD|CAM)$/.test(saved.quality)) { f.quality = saved.quality; }
        if (/^(all|direct|torrent)$/.test(saved.kind)) { f.kind = saved.kind; }
        if (/^(rec|big|small|seeds)$/.test(saved.sort)) { f.sort = saved.sort; }
        if (/^(all|latino|castellano|es|en)$/.test(saved.lang)) { f.lang = saved.lang; }
      }
    } catch (e) { /* defaults */ }
    return f;
  }
  function saveSourceFilters(f) {
    try { localStorage.setItem(SOURCE_FILTERS_KEY, JSON.stringify(f)); } catch (e) { /* ignore */ }
  }

  /* The quick filters of the panel (the preferences hide sources before). */
  function sourcePassesFilters(src, filters) {
    if (filters.quality === 'CAM') { if (!src.cam) { return false; } }
    else if (filters.quality !== 'all' && (src.quality !== filters.quality || src.cam)) { return false; }
    if (filters.kind !== 'all' && src.kind !== filters.kind) { return false; }
    if (filters.lang !== 'all' && !sourceHasLang(src, filters.lang)) { return false; }
    return true;
  }

  function torrentNoticeSeen(key) {
    try { return localStorage.getItem(key || TORRENT_NOTICE_KEY) === '1'; } catch (e) { return false; }
  }

  var DOWNLOAD_NOTICE_KEY = 'opentv_download_notice_v1';

  /* opts.auto: play the recommended source when the search ends, unless the
     viewer presses a key or clicks first. opts.download: pick what to
     download (never automatic). */
  function openSourcePicker(item, episode, onPick, opts) {
    opts = opts || {};
    if (sourcePickerOpen) { closeSourcePicker(); }
    sourcePickerOpen = true;
    sourcePickerReturn = state.focus;
    var seq = ++sourcePickerSeq;
    var ctx = sourceRankContext(item, episode);
    var root = el('div', 'source-picker');
    root.id = 'dialog-sources';
    var panel = el('div', 'srcp-panel');
    var head = el('div', 'srcp-head');
    head.appendChild(el('div', 'srcp-title', opts.download ? 'Descargar' : 'Elegir fuente'));
    var what = item.title || '';
    if (episode) { what += ' · ' + (episode.number ? 'Capítulo ' + episode.number : (episode.title || '')); }
    head.appendChild(el('div', 'srcp-sub', what));
    panel.appendChild(head);
    /* Filters: quality, type, language, and the order (kept for next time). */
    var filters = loadSourceFilters();
    var showHidden = false;
    var bar = el('div', 'srcp-filters');
    panel.appendChild(bar);
    var body = el('div', 'srcp-body scrollable');
    panel.appendChild(body);
    var foot = el('div', 'srcp-foot');
    var note = el('div', 'srcp-note', '');
    var cancel = el('div', 'acc-seg-btn focusable', 'Cancelar');
    cancel._activate = closeSourcePicker;
    foot.appendChild(note);
    foot.appendChild(cancel);
    panel.appendChild(foot);
    root.appendChild(panel);
    root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
    mountOverlay(root);
    sourcePickerNode = root;
    setFocus(cancel);

    /* Automatic choice: off as soon as the viewer does anything here. */
    var waiting = !!opts.auto && !opts.download && ctx.prefs.autoPlay;
    var autoTimer = null;
    function stopWaiting() {
      if (!waiting) { return; }
      waiting = false;
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      if (seq === sourcePickerSeq && sourcePickerOpen) { render(lastGroups, lastPending); }
    }
    function onKey() { stopWaiting(); }
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', stopWaiting);
    root.addEventListener('wheel', stopWaiting);
    sourcePickerCleanup = function () {
      document.removeEventListener('keydown', onKey, true);
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    };

    function choose(src) {
      var key = opts.download ? DOWNLOAD_NOTICE_KEY : TORRENT_NOTICE_KEY;
      if (src.kind === 'torrent' && !torrentNoticeSeen(key)) { return showTorrentNotice(src, key); }
      closeSourcePicker();
      onPick(src);
    }

    /* First torrent (and first torrent download): a short, calm note, once. */
    function showTorrentNotice(src, key) {
      waiting = false;
      clear(body);
      bar.hidden = true;
      var box = el('div', 'srcp-notice');
      box.appendChild(el('b', null, opts.download ? 'Descargar con torrent' : 'Reproducir con torrent'));
      box.appendChild(el('p', null, opts.download
        ? 'El archivo llega de otras personas que lo comparten, y mientras se descarga tu equipo también comparte las partes que ya tiene. Al terminar queda en tu carpeta Videos\\OpenTV.'
        : 'El vídeo llega de otras personas que lo comparten, y mientras lo ves tu equipo también comparte lo que ya bajó. Al terminar, se borra.'));
      box.appendChild(el('p', 'srcp-notice-small', opts.download ? 'Descarga solo contenido que tengas derecho a guardar.' : 'Usa solo contenido que tengas derecho a ver.'));
      var row = el('div', 'srcp-notice-actions');
      var ok = el('div', 'acc-seg-btn focusable is-selected', opts.download ? 'Descargar' : 'Reproducir');
      ok._activate = function () {
        try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
        closeSourcePicker();
        onPick(src);
      };
      var backBtn = el('div', 'acc-seg-btn focusable', 'Volver');
      backBtn._activate = function () { bar.hidden = false; render(lastGroups, lastPending); };
      row.appendChild(ok);
      row.appendChild(backBtn);
      box.appendChild(row);
      body.appendChild(box);
      setFocus(ok);
    }

    /* Ajustes de fuentes inside the panel (Torrentio-style preferences). */
    function showPrefs() {
      waiting = false;
      clear(body);
      bar.hidden = true;
      var back = el('div', 'srcp-chip focusable is-on srcpref-back', '← Volver a las fuentes');
      back._activate = function () { bar.hidden = false; render(lastGroups, lastPending); body.scrollTop = 0; };
      body.appendChild(back);
      body.appendChild(buildSourcePrefsEditor(function () { ctx = sourceRankContext(item, episode); }));
      setFocus(back);
    }

    /* Chip rows of the filter bar, with how many sources each would show. */
    function renderFilters(all) {
      var keepChip = state.focus && state.focus._chipKey;
      clear(bar);
      function count(test) { var n = 0; all.forEach(function (s) { if (test(s)) { n++; } }); return n; }
      function chip(group, value, label, n) {
        var on = filters[group] === value;
        var c = el('div', 'srcp-chip focusable' + (on ? ' is-on' : '') + (n === 0 && value !== 'all' && !on ? ' is-empty' : ''),
          label + (typeof n === 'number' && value !== 'all' ? ' · ' + n : ''));
        c._chipKey = group + ':' + value;
        c._activate = function () {
          filters[group] = value;
          saveSourceFilters(filters);
          render(lastGroups, lastPending);
          body.scrollTop = 0;   /* the new list starts at its top */
        };
        return c;
      }
      var qRow = el('div', 'srcp-chips');
      qRow.appendChild(chip('quality', 'all', 'Todas'));
      [['4K', '4K'], ['1080p', 'Full HD'], ['720p', 'HD'], ['SD', 'SD']].forEach(function (q) {
        qRow.appendChild(chip('quality', q[0], q[1], count(function (s) { return s.quality === q[0] && !s.cam; })));
      });
      var cams = count(function (s) { return s.cam; });
      if (cams || filters.quality === 'CAM') { qRow.appendChild(chip('quality', 'CAM', 'CAM', cams)); }
      qRow.appendChild(el('span', 'srcp-chips-gap'));
      [['all', 'Todo'], ['direct', 'Directo'], ['torrent', 'Torrent']].forEach(function (k) {
        qRow.appendChild(chip('kind', k[0], k[1], count(function (s) { return s.kind === k[0]; })));
      });
      bar.appendChild(qRow);
      var lRow = el('div', 'srcp-chips');
      lRow.appendChild(el('span', 'srcp-chips-label', 'Idioma'));
      lRow.appendChild(chip('lang', 'all', 'Todos'));
      [['latino', 'Latino'], ['castellano', 'Castellano'], ['es', 'Español'], ['en', 'Inglés']].forEach(function (l) {
        var n = count(function (s) { return sourceHasLang(s, l[0]); });
        /* "Español" (variant not said) only when some source says just that. */
        if (l[0] === 'es' && !n && filters.lang !== 'es') { return; }
        lRow.appendChild(chip('lang', l[0], l[1], n));
      });
      bar.appendChild(lRow);
      var sRow = el('div', 'srcp-chips');
      sRow.appendChild(el('span', 'srcp-chips-label', 'Ordenar'));
      [['rec', 'Recomendado'], ['big', 'Más pesadas'], ['small', 'Más ligeras'], ['seeds', 'Más semillas']].forEach(function (o) {
        sRow.appendChild(chip('sort', o[0], o[1]));
      });
      sRow.appendChild(el('span', 'srcp-chips-gap'));
      var prefsChip = el('div', 'srcp-chip focusable srcp-chip-prefs', 'Preferencias');
      prefsChip._chipKey = 'prefs';
      prefsChip._activate = showPrefs;
      sRow.appendChild(prefsChip);
      bar.appendChild(sRow);
      if (keepChip) {
        var again = bar.querySelector('.srcp-chip.focusable');
        var chips = bar.querySelectorAll('.srcp-chip');
        for (var i = 0; i < chips.length; i++) { if (chips[i]._chipKey === keepChip) { again = chips[i]; } }
        if (again) { setFocus(again); }
      }
    }

    function ordered(list) {
      var out = list.slice();
      if (filters.sort === 'big') { out.sort(function (a, b) { return (b.sizeBytes || 0) - (a.sizeBytes || 0) || a._i - b._i; }); }
      else if (filters.sort === 'small') { out.sort(function (a, b) { return (a.sizeBytes || Infinity) - (b.sizeBytes || Infinity) || a._i - b._i; }); }
      else if (filters.sort === 'seeds') { out.sort(function (a, b) { return (b.seeds || 0) - (a.seeds || 0) || a._i - b._i; }); }
      else { out.sort(function (a, b) { return b._score - a._score; }); }
      return out;
    }

    /* Like Torrentio's "max results per quality": the first N of each. */
    function capPerQuality(list) {
      var max = ctx.prefs.perQuality;
      if (!max || showHidden) { return list; }
      var seen = {};
      return list.filter(function (s) {
        var q = s.cam ? 'CAM' : (s.quality || '?');
        seen[q] = (seen[q] || 0) + 1;
        return seen[q] <= max;
      });
    }

    function sourceRow(src, key, best) {
      var row = el('div', 'srcp-item focusable' + (src === best ? ' is-best' : ''));
      row._srcKey = key;
      var q = el('span', 'srcp-q' + (src.quality || src.cam ? '' : ' is-empty') + (src.cam ? ' is-cam' : ''), src.cam ? 'CAM' : (src.quality || '—'));
      var txt = el('div', 'srcp-text');
      txt.appendChild(el('div', 'srcp-label', src.label));
      var meta = [];
      var langs = sourceLangText(src);
      meta.push(langs || 'Idioma original');
      meta.push(src.kind === 'torrent' ? 'Torrent' : 'Directo');
      if (src.size) { meta.push(src.size); }
      if (src.seeds !== null) { meta.push(src.seeds + (src.seeds === 1 ? ' semilla' : ' semillas')); }
      if (src.hdr) { meta.push('HDR'); }
      if (src.hevc) { meta.push('HEVC'); }
      if (src.provider) { meta.push(src.provider); }
      else if (src.detail) { meta.push(src.detail); }
      txt.appendChild(el('div', 'srcp-meta', meta.join(' · ')));
      /* Android: why this device avoids it (silent audio, no room…). */
      var warn = sourceDeviceNote(src);
      if (warn) { txt.appendChild(el('div', 'srcp-warn', warn)); }
      row.appendChild(q);
      row.appendChild(txt);
      row.classList.toggle('is-torrent', src.kind === 'torrent');
      row._activate = function () { choose(src); };
      return row;
    }

    var lastGroups = [], lastPending = 0;
    function render(groups, pending) {
      lastGroups = groups;
      lastPending = pending;
      if (bar.hidden) { return; }   /* the notice or the preferences are open */
      var keepFocus = state.focus && state.focus._srcKey;
      var all = [];
      groups.forEach(function (g) {
        g.sources.forEach(function (s, i) { s._i = i; s._score = scoreSource(s, ctx); all.push(s); });
      });
      var best = bestSource(all, ctx);
      renderFilters(all);
      clear(body);
      if (!groups.length) {
        body.appendChild(el('div', 'srcp-empty', 'Ninguno de tus addons da fuentes para reproducir. Agrega un addon de fuentes en Ajustes → Addons.'));
      }
      var total = 0, shown = 0, first = null, again = null;
      /* The recommended one first, with why. */
      if (best && all.length > 1) {
        var rec = el('div', 'srcp-group srcp-rec');
        var rh = el('div', 'srcp-group-head');
        rh.appendChild(el('span', 'srcp-group-name', 'Recomendada'));
        rh.appendChild(el('span', 'srcp-group-state', best.addon));
        rec.appendChild(rh);
        var bestRow = sourceRow(best, 'best', best);
        rec.appendChild(bestRow);
        rec.appendChild(el('div', 'srcp-why', sourceReason(best)));
        body.appendChild(rec);
        first = bestRow;
        if (keepFocus === 'best') { again = bestRow; }
      }
      var prefHidden = 0;
      groups.forEach(function (g) {
        var sec = el('div', 'srcp-group');
        var gh = el('div', 'srcp-group-head');
        gh.appendChild(el('span', 'srcp-group-name', g.name));
        var allowed = g.sources.filter(function (s) { return showHidden || !sourcePrefsBlock(s, ctx.prefs, !!episode); });
        prefHidden += g.sources.length - allowed.length;
        var visible = capPerQuality(ordered(allowed.filter(function (s) { return sourcePassesFilters(s, filters); })));
        total += g.sources.length;
        gh.appendChild(el('span', 'srcp-group-state', g.state === 'loading' ? 'Buscando…'
          : (g.state === 'error' ? 'No respondió' : (visible.length === g.sources.length
            ? g.sources.length + (g.sources.length === 1 ? ' fuente' : ' fuentes')
            : visible.length + ' de ' + g.sources.length))));
        sec.appendChild(gh);
        if (g.state === 'done' && g.sources.length && !visible.length) {
          sec.appendChild(el('div', 'srcp-hidden', 'Ninguna fuente con estos filtros.'));
        }
        visible.forEach(function (src) {
          shown++;
          /* Already at the top, under "Recomendada". */
          if (src === best && all.length > 1) { return; }
          var row = sourceRow(src, g.name + '#' + src._i, best);
          sec.appendChild(row);
          if (!first) { first = row; }
          if (keepFocus && keepFocus === row._srcKey) { again = row; }
        });
        if (g.dead) { sec.appendChild(el('div', 'srcp-hidden', g.dead + (g.dead === 1 ? ' torrent oculto: nadie lo está compartiendo ahora.' : ' torrents ocultos: nadie los está compartiendo ahora.'))); }
        if (g.hidden) { sec.appendChild(el('div', 'srcp-hidden', g.hidden + ' no se pueden reproducir en OpenTV (YouTube o enlaces externos).')); }
        body.appendChild(sec);
      });
      if (prefHidden || showHidden) {
        var more = el('div', 'srcp-chip focusable srcp-showhidden', showHidden ? 'Aplicar mis preferencias otra vez'
          : prefHidden + (prefHidden === 1 ? ' fuente oculta' : ' fuentes ocultas') + ' por tus preferencias · Mostrar');
        more._srcKey = 'showhidden';
        more._activate = function () { showHidden = !showHidden; render(lastGroups, lastPending); };
        body.appendChild(more);
        if (keepFocus === 'showhidden') { again = more; }
      }
      var count = pending > 0 ? 'Buscando en ' + pending + (pending === 1 ? ' addon…' : ' addons…')
        : (shown === total ? total + (total === 1 ? ' fuente' : ' fuentes') : shown + ' de ' + total + ' fuentes');
      note.textContent = waiting && best ? count + ' · Se reproducirá la recomendada. Pulsa cualquier tecla para elegir otra.' : count;

      /* Play the recommended one when every addon answered, or 8 s after the
         first sources arrived (a slow addon must not hold the viewer). */
      if (waiting && best) {
        if (pending === 0) { return autoChoose(); }
        if (!autoTimer) {
          autoTimer = setTimeout(function () {
            autoTimer = null;
            if (waiting && seq === sourcePickerSeq && sourcePickerOpen) { autoChoose(); }
          }, 8000);
        }
      }
      if (waiting && pending === 0 && !best) { waiting = false; }

      /* Focus the first source as soon as one shows up, but never take the
         focus away from where the viewer already is (a filter chip, too). */
      if (state.focus && state.focus._chipKey && isVisible(state.focus)) { return; }
      if (again) { setFocus(again); }
      else if (first && (!state.focus || state.focus === cancel || !isVisible(state.focus))) { setFocus(first); }
    }

    function autoChoose() {
      waiting = false;
      var all = [];
      lastGroups.forEach(function (g) { all = all.concat(g.sources); });
      var best = bestSource(all, ctx);
      if (best) { choose(best); }
    }

    fetchStremioStreams(item, episode, function (groups, pending) {
      if (seq !== sourcePickerSeq || !sourcePickerOpen) { return; }
      render(groups, pending);
    });
  }

  /* ------------------------------------------------ playback */
  /* Called by expandToFullscreen: true when it must wait (details still
     loading, or the viewer has to pick a source first). */
  function stremioNeedsPick(item, episode) {
    if (!item || !item._stremio || item._plain) { return false; }
    if (isSeriesItem(item) && !episode) {
      var ep = state.detailEpisode || (item.episodes && item.episodes[0]) || null;
      if (!ep && !item._detailsLoaded) {
        loadStremioMeta(item, function () {
          if (item.episodes && item.episodes.length) { expandToFullscreen(item, state.detailEpisode || item.episodes[0]); }
        });
        return true;
      }
      if (ep) { expandToFullscreen(item, ep); return true; }
      return false;
    }
    var target = episode || item;
    if (target._stremioSource) { return false; }
    /* Downloaded: plays from the disk, no source to choose. */
    if (item._downloadId || downloadedFileFor(item, episode)) { return false; }
    /* No addon gives sources: say where to add one, play nothing. */
    if (!hasSourceAddons()) { showNoSourcesNotice(); return true; }
    var saved = savedStremioPick(item, episode);
    if (saved) { target._stremioSource = saved; return false; }
    openSourcePicker(item, episode, function (src) {
      target._stremioSource = src;
      rememberStremioPick(item, episode, src);
      expandToFullscreen(item, episode);
    }, { auto: true });
    return true;
  }

  /* "Reproducir" with no addon that gives sources (Cinemeta and Kitsu only
     give the catalog): say so, and where to add one. */
  function showNoSourcesNotice() {
    showShortNotice('Agrega un addon para reproducir',
      'Para ver este contenido necesitas un addon de fuentes. Agrégalo en Addons.',
      'Ir a Addons', function () { openSettingsAt('sources'); });
  }

  /* Panels over the app (source picker, notices, the guide): inside the
     1920×1080 canvas; on a phone, over its own layer instead (the canvas is
     hidden there until a video plays). */
  function mountOverlay(root) {
    if (typeof isPhone === 'function' && isPhone()) {
      root.classList.add('is-sheet');
      document.body.appendChild(root);
      return;
    }
    ($('app') || document.body).appendChild(root);
  }

  /* A short message in the panel window: title, one sentence, and an
     optional action next to "Entendido". */
  function showShortNotice(title, text, actionLabel, action) {
    if (sourcePickerOpen) { closeSourcePicker(); }
    sourcePickerOpen = true;
    sourcePickerReturn = state.focus;
    sourcePickerSeq++;
    var root = el('div', 'source-picker');
    var panel = el('div', 'srcp-panel is-notice');
    var head = el('div', 'srcp-head');
    head.appendChild(el('div', 'srcp-title', title));
    panel.appendChild(head);
    var body = el('div', 'srcp-body');
    var box = el('div', 'srcp-notice');
    box.appendChild(el('p', null, text));
    body.appendChild(box);
    panel.appendChild(body);
    var foot = el('div', 'srcp-foot');
    var ok = el('div', 'acc-seg-btn focusable' + (action ? '' : ' is-selected'), 'Entendido');
    ok._activate = closeSourcePicker;
    foot.appendChild(ok);
    var first = ok;
    if (action) {
      var go = el('div', 'acc-seg-btn focusable is-selected', actionLabel);
      go._activate = function () { closeSourcePicker(); action(); };
      foot.appendChild(go);
      first = go;
    }
    panel.appendChild(foot);
    root.appendChild(panel);
    root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
    mountOverlay(root);
    sourcePickerNode = root;
    setFocus(first);
  }

  /* Detail page "Cambiar fuente". */
  function changeStremioSource(item, episode) {
    if (isSeriesItem(item) && !episode) { episode = state.detailEpisode || (item.episodes && item.episodes[0]) || null; }
    openSourcePicker(item, episode, function (src) {
      var target = episode || item;
      target._stremioSource = src;
      target._stremioNoCopy = false;   /* a new file: try copying its video again */
      rememberStremioPick(item, episode, src);
      resumeRestarted = false;
      /* Stop the current source the player's own way (it saves the position
         and detaches its handlers: emptying src by hand fires an error that
         the compatibility watchdog takes for an unplayable video). */
      if (playerVideo && state.playerItem === item) {
        stopPlayerVideo();
        /* src="" reads back as the page's own URL, which expandToFullscreen
           would take for a video still loaded: no attribute at all. */
        playerVideo.removeAttribute('src');
      }
      state.streamMode = 'normal';
      expandToFullscreen(item, episode);
    });
  }

  var torrentPoll = null;
  var torrentInUse = false;

  function stopTorrentPoll() {
    if (torrentPoll) { clearInterval(torrentPoll); torrentPoll = null; }
  }

  /* Leaving movies and series for good (not just to the details page, where
     the small player keeps going): stop the torrent and free the disk. */
  function stremioTorrentRelease() {
    stopTorrentPoll();
    if (!torrentInUse) { return; }
    torrentInUse = false;
    portalServiceCall('torrentStop', {}, function () {});
  }

  function formatSpeed(bytes) {
    if (bytes >= 1048576) { return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB/s'; }
    return Math.max(0, Math.round(bytes / 1024)) + ' KB/s';
  }

  /* While the torrent starts: how many people it found and how fast it goes. */
  function startTorrentPoll(item) {
    stopTorrentPoll();
    torrentPoll = setInterval(function () {
      if (state.playerItem !== item || (state.screen !== 'player' && state.screen !== 'detail')) { return stopTorrentPoll(); }
      if (playerVideo && playerVideo.readyState >= 3 && !playerVideo.paused) { return stopTorrentPoll(); }
      portalServiceCall('torrentStats', {}, function (err, st) {
        if (!torrentPoll || err || !st || !st.active || state.playerItem !== item) { return; }
        /* The fastest download seen tells how good this connection is. */
        noteNetSpeed(st.speed);
        if (playerVideo && playerVideo.readyState >= 3) { return; }
        setPlayerStatus((st.ready ? 'Cargando torrent' : 'Buscando el torrent') + ' · ' +
          st.peers + (st.peers === 1 ? ' conexión' : ' conexiones') + ' · ' + formatSpeed(st.speed));
      }, 5000);
    }, 1000);
  }

  /* resolvePlayerStream for addon titles: the chosen source → playable URL. */
  function resolveStremioPlayback(item, done) {
    var mySeq = resolveSeq;
    if (item._plain) { return done(item.streamUrl || ''); }
    var series = isSeriesItem(item);
    var ep = series ? (state.playerEpisode || (item.episodes && item.episodes[0]) || null) : null;
    if (series && !ep) {
      if (!item._detailsLoaded) {
        setPlayerStatus('Cargando capítulos…');
        loadStremioMeta(item, function () {
          if (mySeq !== resolveSeq) { return; }
          if (item.episodes && item.episodes.length) { resolveStremioPlayback(item, done); }
          else { vodFailure('los capítulos', item._detailError || 'Ninguno de tus addons da los capítulos'); done(''); }
        });
        return;
      }
      vodFailure('los capítulos', item._detailError || 'Ninguno de tus addons da los capítulos');
      return done('');
    }
    if (ep && !state.playerEpisode) { state.playerEpisode = ep; }
    var target = ep || item;
    /* Downloaded: the file on disk, through the downloads' local server. */
    var local = item._downloadId ? { id: item._downloadId, fileName: '' }
      : (target._stremioSource ? null : downloadedFileFor(item, ep));
    if (local) {
      stremioTorrentRelease();
      setPlayerStatus('Abriendo la descarga…');
      portalServiceCall('downloadOpen', { id: local.id }, function (err, info) {
        if (mySeq !== resolveSeq) { return; }
        if (err || !info || info.returnValue === false || !info.url) {
          vodFailure('la descarga', err || (info && info.errorText) || 'No se encontró el archivo descargado');
          return done('');
        }
        resolveExternal(info.url, info.name || local.fileName, null, false);
      });
      return;
    }
    var src = target._stremioSource || savedStremioPick(item, ep);
    if (src) { return go(src); }
    var previous = null;
    if (item.episodes) {
      for (var i = 0; i < item.episodes.length && !previous; i++) {
        if (item.episodes[i] !== ep && item.episodes[i]._stremioSource) { previous = item.episodes[i]._stremioSource; }
      }
    }
    /* Nothing chosen and no earlier episode to copy: the panel opens and plays
       the recommended source unless the viewer picks another one. */
    if (!previous) {
      setPlayerStatus('Buscando la mejor fuente…');
      openSourcePicker(item, ep, function (picked) {
        target._stremioSource = picked;
        rememberStremioPick(item, ep, picked);
        if (mySeq === resolveSeq) { go(picked); }
      }, { auto: true });
      return;
    }
    /* Next episode played on its own: same addon and quality as the last one. */
    setPlayerStatus('Buscando fuente…');
    autoPickStremioSource(item, ep, previous, function (picked) {
      if (mySeq !== resolveSeq) { return; }
      if (!picked) { vodFailure('la fuente', 'Tus addons no dieron ninguna fuente para este título'); return done(''); }
      rememberStremioPick(item, ep, picked);
      go(picked);
    });

    function go(chosen) {
      target._stremioSource = chosen;
      if (chosen.infoHash) {
        if (!platformHas('torrents')) { vodFailure('la fuente', 'Los torrents no funcionan en este aparato'); return done(''); }
        setPlayerStatus('Buscando el torrent…');
        torrentInUse = true;
        startTorrentPoll(item);
        portalServiceCall('torrentStart', { infoHash: chosen.infoHash, fileIdx: chosen.fileIdx, sources: chosen.sources }, function (err, info) {
          if (mySeq !== resolveSeq) { return; }
          if (err || !info || info.returnValue === false || !info.url) {
            stopTorrentPoll();
            vodFailure('el torrent', err || (info && info.errorText) || 'No se pudo abrir el torrent');
            return done('');
          }
          /* Android: plays, but the whole file will not fit on this device. */
          if (info.fits === false) { setPlayerStatus('Este torrent no cabe completo en el aparato: se verá mientras haya espacio.'); }
          resolveExternal(info.url, info.name || chosen.filename, null, false);
        }, 75000);
        return;
      }
      stremioTorrentRelease();
      resolveExternal(chosen.url, chosen.filename, chosen.headers, chosen.notWebReady);
    }

    function resolveExternal(url, name, headers, notWebReady) {
      var smooth = state.streamMode === 'smooth' || state.streamMode === 'relay';
      var params = {
        url: url, name: name || '', headers: headers || {}, notWebReady: !!notWebReady,
        forceRelay: smooth,
        /* Copy the video and convert only the audio, unless that already failed. */
        videoCopy: !target._stremioNoCopy,
        audioTrack: vodCurrentAudioTrack || 0,
        duration: durationToSeconds(target.duration)
      };
      lastVodAttempt = { phase: 'enlace de vídeo', status: 'cargando', error: '' };
      portalServiceCall('resolveExternal', params, function (error, payload) {
        if (mySeq !== resolveSeq) { return; }
        if (error || !payload || payload.returnValue === false || !(payload.proxyPath || payload.url)) {
          vodFailure('el enlace de vídeo', error || (payload && payload.errorText) || 'Respuesta vacía del servicio');
          return done('');
        }
        lastVodAttempt = { phase: 'enlace de vídeo', status: 'recibido', error: '' };
        item.streamMime = payload.mime || '';
        item.streamCodec = '';
        item.isHls = !!payload.isHls;
        item._relayUrl = payload.relayUrl || '';
        if (ep) { ep._relayUrl = item._relayUrl; }
        target._stremioRelayCopy = !!payload.isRelay && params.videoCopy;
        /* A new file: its own tracks and the addons' are read again; what the
           viewer imported stays with the title. */
        var old = mediaInfoCache[mediaInfoKey(item)];
        var info = { audio: '', subtitles: [], tracks: [], selected: {}, duration: 0, _importedSubs: (old && old._importedSubs) || [] };
        info.subtitles = info._importedSubs.slice();
        item.subtitles = info.subtitles;
        stopEmbeddedSubtitle();
        /* Android: ExoPlayer starts each file with its own tracks off. */
        nativeSubIndex = -1;
        nativeCueText = '';
        mediaInfoCache[mediaInfoKey(item)] = info;
        done(payload.proxyPath || payload.url);
        requestVideoDuration(item, ep, payload);
        loadStremioSubtitles(item, ep, { url: url, headers: headers, name: name });
        bindNativeTextTracks();
      }, 30000);
    }
  }

  /* A torrent is slow to start and may pause while it downloads: that is the
     network, not a video the player cannot read (compat-watchdog.js). */
  function stremioPlayingTorrent() {
    var item = state.playerItem;
    var target = item ? (state.playerEpisode || item) : null;
    return !!(item && item._stremio && target._stremioSource && target._stremioSource.infoHash);
  }

  /* The relay copied a video the player then could not show: try once more
     converting the video too (slower, but plays anything). */
  function stremioRetryTranscode() {
    var item = state.playerItem;
    if (!item || !item._stremio || state.playerMode !== 'vod') { return false; }
    var target = state.playerEpisode || item;
    if (target._stremioNoCopy || !target._stremioRelayCopy) { return false; }
    target._stremioNoCopy = true;
    state.streamMode = 'smooth';
    setPlayerStatus('Ajustando la reproducción…');
    setTimeout(function () {
      if (state.playerItem === item && state.playerMode === 'vod') { restartCurrentPlayback(); }
    }, 0);
    return true;
  }

  /* ------------------------------------------------ the file's audio tracks */
  /* One track as the settings dialog shows it. The track's own title says the
     dub ("Latino", "Castellano"); when it says nothing, the source's tags do
     (a "Latino" release with one Spanish track is Latino). */
  function audioTrackLabel(t, src) {
    var title = String(t.title || '');
    var low = title.toLowerCase();
    var label;
    if (/latin|latam|\blat\b|m[eé]xic|hispanoam/.test(low)) { label = 'Español (Latino)'; }
    else if (/castell|espa[ñn]a\b|\bspain\b|europe|\bcast\b/.test(low)) { label = 'Español (Castellano)'; }
    else {
      var code = String(t.lang || '').toLowerCase();
      var known = code && !/^(und|unk|mis|zxx|mul)$/.test(code);
      label = known ? formatAudioLang(code) : '';
      if (!label && title) {
        label = /english|ingl[eé]s/.test(low) ? 'Inglés' : (/spanish|espa[ñn]ol/.test(low) ? 'Español'
          : (/portug/.test(low) ? 'Portugués' : (/fran[cç]|french/.test(low) ? 'Francés'
          : (/ital/.test(low) ? 'Italiano' : (/german|deutsch/.test(low) ? 'Alemán'
          : (/japan|jap[oó]n/.test(low) ? 'Japonés' : title.charAt(0).toUpperCase() + title.slice(1)))))));
      }
      if (!label) { label = 'Pista'; }
      if (label === 'Español' && src && src.langs) {
        var lat = src.langs.indexOf('latino') !== -1, cas = src.langs.indexOf('castellano') !== -1;
        if (lat && !cas) { label = 'Español (Latino)'; } else if (cas && !lat) { label = 'Español (Castellano)'; }
      }
    }
    if (/comment|comentario/.test(low)) { label += ' · Comentarios'; }
    return label;
  }

  /* The tracks the service read from the file → [{index, code, label}],
     telling apart two tracks with the same name by title or channels. */
  function stremioAudioList(tracks, src) {
    var out = tracks.map(function (t, i) {
      return { index: i, code: String(t.lang || 'und'), label: audioTrackLabel(t, src), title: String(t.title || ''), channels: String(t.channels || '') };
    });
    var counts = {};
    out.forEach(function (t) { counts[t.label] = (counts[t.label] || 0) + 1; });
    out.forEach(function (t) {
      if (counts[t.label] < 2) { return; }
      var extra = t.title && t.title.toLowerCase() !== t.label.toLowerCase() ? t.title : (t.channels || ('pista ' + (t.index + 1)));
      t.label += ' · ' + extra;
    });
    return out;
  }

  /* Which track the viewer's languages want (Ajustes → Preferencias de addons), -1 = none. */
  function preferredSourceAudioIndex(list) {
    var langs = loadSourcePrefs().langs;
    var tests = {
      latino: [/Latino/, /^Español$/], castellano: [/Castellano/, /^Español$/],
      en: [/^Inglés/], pt: [/^Portugués/]
    };
    for (var i = 0; i < langs.length; i++) {
      var rules = tests[langs[i]] || [];
      for (var r = 0; r < rules.length; r++) {
        for (var t = 0; t < list.length; t++) { if (rules[r].test(list[t].label)) { return list[t].index; } }
      }
    }
    return -1;
  }

  function stremioMediaInfo(item) {
    var key = mediaInfoKey(item);
    var info = mediaInfoCache[key] || { audio: '', subtitles: item.subtitles || [], tracks: [], selected: {}, duration: 0 };
    mediaInfoCache[key] = info;
    return info;
  }

  /* playback.js requestVideoDuration: the service read the file's tracks.
     Audio: shown with its real language, and a file that starts on another
     dub switches to the viewer's language once. Subtitles: the text ones
     inside the file join the addons' (Preferencias decides the order). */
  function onSourceTracks(item, episode, answer) {
    if (!item || !item._stremio) { return; }
    var target = episode || item;
    var info = stremioMediaInfo(item);
    var tracks = answer.audio || [];
    if (tracks.length) {
      var list = stremioAudioList(tracks, target._stremioSource || null);
      info.audioTracks = list;
      info.audio = list.map(function (t) { return t.code; }).join(',');
      if (state.playerItem === item && list.length > 1 && !vodAudioChosen && relayBaseUrl) {
        var want = preferredSourceAudioIndex(list);
        if (want >= 0 && want !== (vodCurrentAudioTrack || 0)) { switchAudioTrack(want); }
      }
      if (dialogPlaySettingsOpen) { renderDialogAudio(); }
    }
    /* Only through the relay (it writes them while playing), and only text
       ones: picture subtitles (PGS, VobSub) cannot become text. */
    var fileSubs = [];
    (answer.subtitles || []).forEach(function (s, idx) {
      if (!s.text) { return; }
      fileSubs.push({ lang: s.lang || 'und', url: 'embedded:' + idx, format: 'vtt', forced: !!s.forced,
        label: audioTrackLabel({ lang: s.lang, title: s.title }, null) + (s.forced ? ' · forzados' : '') + ' · del archivo' });
    });
    /* (Android: ExoPlayer lists the file's own tracks, see bindNativeTextTracks.) */
    if (relayBaseUrl) { info._fileSubs = fileSubs; }
    composeStremioSubtitles(item, info);
  }

  /* The subtitle list of the title: the file's own tracks and the addons',
     in the order (or only the ones) Preferencias says. */
  function composeStremioSubtitles(item, info) {
    var from = loadSourcePrefs().subsFrom;
    var file = from === 'addonsOnly' ? [] : (info._fileSubs || []);
    var addons = from === 'fileOnly' ? [] : (info._addonSubs || []);
    var imported = info._importedSubs || [];
    /* Forced tracks (only the foreign lines) go after the full ones. */
    file = file.filter(function (s) { return !s.forced; }).concat(file.filter(function (s) { return s.forced; }));
    var list = (from === 'addons' || from === 'addonsOnly') ? addons.concat(file) : file.concat(addons);
    info.subtitles = imported.concat(list);
    item.subtitles = info.subtitles;
    if (state.playerItem === item) { applySubtitleDefaults(info); }
    if (dialogPlaySettingsOpen) { renderDialogSubtitle(); }
  }

  /* ------------------------------------------------ subtitles inside the file */
  /* Android: ExoPlayer reads the file's own text tracks (MKV, MP4) and sends
     the line on screen; the page draws it with the viewer's style
     (ui/js/native-player.js: window.__opentvNative). */
  var nativeTextBound = false;
  function bindNativeTextTracks() {
    var n = window.__opentvNative;
    if (nativeTextBound || !n || typeof n.onTextTracks !== 'function') { return; }
    nativeTextBound = true;
    n.onTextTracks(function (tracks) {
      var item = state.playerItem;
      if (!item || !item._stremio) { return; }
      var info = stremioMediaInfo(item);
      info._fileSubs = (tracks || []).map(function (t) {
        return { lang: t.lang || 'und', url: 'native:' + t.index, format: 'native', forced: !!t.forced,
          label: audioTrackLabel({ lang: t.lang, title: t.label }, null) + (t.forced ? ' · forzados' : '') + ' · del archivo' };
      });
      composeStremioSubtitles(item, info);
    });
    n.onCues(function (text) {
      nativeCueText = text || '';
      if (nativeSubIndex >= 0) { updateSubtitleDisplay(vodPlaybackPosition()); }
    });
  }

  var embeddedSub = null;   /* { n, base, timer } */

  function embeddedSubtitleOn(sub) {
    return !!(embeddedSub && relayBaseUrl === embeddedSub.base && sub.url === 'embedded:' + embeddedSub.n);
  }

  function stopEmbeddedSubtitle() {
    if (!embeddedSub) { return; }
    if (embeddedSub.timer) { clearInterval(embeddedSub.timer); }
    var base = embeddedSub.base;
    embeddedSub = null;
    /* The next relay runs stop writing them (the current one may finish). */
    try { var x = new XMLHttpRequest(); x.open('GET', base + '?setsub=-1', true); x.send(null); } catch (e) { /* ignore */ }
  }

  /* Asks the relay to write that track while it plays (one restart at the
     same second), then reads what it wrote every 2 s. */
  function startEmbeddedSubtitle(sub, seq) {
    stopEmbeddedSubtitle();
    activeSubtitleCues = [];
    if (!relayBaseUrl || !playerVideo) { return; }
    var n = parseInt(String(sub.url).split(':')[1], 10) || 0;
    var base = relayBaseUrl;
    embeddedSub = { n: n, base: base, timer: null };
    var mine = embeddedSub;
    function read() {
      if (embeddedSub !== mine || seq !== subtitleSeq) { return; }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', base + '?vtt=1', true);
      xhr.onload = function () {
        if (embeddedSub !== mine || seq !== subtitleSeq) { return; }
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
        if (!data || !data.text) { return; }
        var shift = Number(data.base) || 0;
        var cues = parseSRT(data.text).map(function (c) { return { start: c.start + shift, end: c.end + shift, text: c.text }; });
        if (cues.length !== activeSubtitleCues.length) { activeSubtitleCues = cues; syncNativeSubtitleTrack(); }
      };
      try { xhr.send(null); } catch (e) { /* ignore */ }
    }
    var set = new XMLHttpRequest();
    set.open('GET', base + '?setsub=' + n, true);
    set.onload = function () {
      if (embeddedSub !== mine) { return; }
      var cur = Math.floor(relayStartOffset + (playerVideo.currentTime || 0));
      playUrl(base + '?start=' + cur + '&a=' + (vodCurrentAudioTrack || 0), { remainPaused: playerVideo.paused });
      mine.timer = setInterval(read, 2000);
    };
    try { set.send(null); } catch (e) { /* ignore */ }
  }

  /* "Importar subtítulos": a .srt / .vtt file of the viewer, read here. */
  function importSubtitleFile(done) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.sub,.txt';
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) { return; }
      function use(text) {
        var cues = parseSRT(text);
        if (!cues.length) { return done('El archivo no tiene subtítulos que se puedan leer (usa .srt o .vtt).'); }
        done(null, { lang: 'imp', url: 'imported:' + Date.now(), format: 'srt', label: f.name.replace(/\.[^.]+$/, '').slice(0, 40), cues: cues });
      }
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        /* Most Spanish .srt files are Windows-1252: read again if UTF-8 broke the accents. */
        if (text.indexOf('�') !== -1) {
          var again = new FileReader();
          again.onload = function () { use(String(again.result || '')); };
          again.readAsText(f, 'windows-1252');
          return;
        }
        use(text);
      };
      reader.onerror = function () { done('No se pudo leer el archivo.'); };
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  }

  /* OpenSubtitles answers dozens of files (six Dutch, four Spanish…). The
     dialog shows one button per language, so keep the first file of each
     language: Spanish, English and Portuguese first, then the rest, at most
     STREMIO_SUBTITLE_MAX (the local service keeps that many links alive). */
  var STREMIO_SUBTITLE_MAX = 16;
  function pickStremioSubtitles(all) {
    var seen = {}, first = [], rest = [];
    for (var i = 0; i < all.length; i++) {
      var label = formatAudioLang(all[i].lang);
      if (seen[label]) { continue; }
      seen[label] = true;
      (/^(Español|Inglés|Portugués)/.test(label) ? first : rest).push(all[i]);
    }
    first.sort(function (a, b) {
      var order = ['Español', 'Inglés', 'Portugués'];
      return order.indexOf(formatAudioLang(a.lang).split(' ')[0]) - order.indexOf(formatAudioLang(b.lang).split(' ')[0]);
    });
    return first.concat(rest).slice(0, STREMIO_SUBTITLE_MAX);
  }

  /* Subtitles from the addons that offer them (for example OpenSubtitles),
     through the local service like the catalog's own subtitles. */
  /* file: { url, headers, name } of the video playing. Like Stremio, the
     addon is told the file's OpenSubtitles hash, size and name: it then
     answers the subtitles made for this release first (same cut and frame
     rate), the ones that stay in sync. */
  function loadStremioSubtitles(item, episode, file) {
    var cfg = getVodSourcesConfig();
    var type = item._stremioType || (isSeriesItem(item) ? 'series' : 'movie');
    var rawId = isSeriesItem(item) ? (episode && episode.id) : item._stremioId;
    var addons = cfg.addons.filter(function (ad) { return addonSupports(ad, 'subtitles', type, rawId); });
    if (!addons.length || !rawId) { return; }
    if (file && file.url && !file._hashed) {
      var asked = false;
      var go = function (extra) { if (!asked) { asked = true; loadStremioSubtitles(item, episode, { _hashed: true, extra: extra }); } };
      setTimeout(function () { go(''); }, 9000);   /* no hash in time: ask without it */
      portalServiceCall('videoHash', { url: file.url, headers: file.headers || {} }, function (err, info) {
        var name = String(file.name || '').split(/[\/\\]/).pop();
        var extra = [];
        if (!err && info && /^[0-9a-f]{16}$/.test(info.hash || '')) { extra.push('videoHash=' + info.hash, 'videoSize=' + info.size); }
        if (name) { extra.push('filename=' + encodeURIComponent(name)); }
        go(extra.join('&'));
      }, 9000);
      return;
    }
    var extraPath = file && file.extra ? '/' + file.extra : '';
    var all = [], left = addons.length;
    addons.forEach(function (ad) {
      addonRequest(ad.baseUrl + '/subtitles/' + encodeURIComponent(type) + '/' + stremioStreamId(item, episode) + extraPath + '.json', function (err, payload) {
        var subs = (!err && payload && payload.subtitles) ? payload.subtitles : [];
        for (var i = 0; i < subs.length; i++) {
          if (subs[i] && /^https?:\/\//i.test(subs[i].url || '')) { all.push({ lang: subs[i].lang || '', url: subs[i].url }); }
        }
        if (--left > 0) { return; }
        var found = pickStremioSubtitles(all);
        if (!found.length) { return; }
        portalServiceCall('proxySubtitles', { subtitles: found }, function (pErr, answer) {
          /* Subtitles belong to the title, not to one stream attempt: the
             player restarts the source (resume, audio, quality) and bumps
             resolveSeq, so check that the same title/episode is still on. */
          if (state.playerItem !== item || (episode && state.playerEpisode !== episode)) { return; }
          if (pErr || !answer || !answer.subtitles) { return; }
          var info = stremioMediaInfo(item);
          info._addonSubs = answer.subtitles;
          composeStremioSubtitles(item, info);
        });
      }, 15000);
    });
  }

  /* ---- player/downloads.js --------------------------------------------------- */
  /* player/downloads.js — Descargas (Modo Addons, solo PC por ahora): guardar
     una película o un capítulo para verlo sin internet. El servicio descarga en
     segundo plano (service/downloads.js); aquí se pide, se avisa y se muestra
     el panel Ajustes → Descargas (en curso y completadas).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var downloadsList = [];
  var downloadsDir = '';
  var downloadsLoaded = false;
  var downloadsFree = 0;

  /* Asks the service for the list (also at start, so "Reproducir" finds the
     downloaded files without waiting). */
  function refreshDownloads(done) {
    if (!platformHas('downloads')) { if (done) { done([]); } return; }
    portalServiceCall('downloadList', {}, function (err, answer) {
      if (!err && answer && answer.items) {
        downloadsList = answer.items;
        downloadsDir = answer.dir || downloadsDir;
        /* Android: free space where the downloads go (the PC service omits it). */
        downloadsFree = answer.free > 0 ? answer.free : 0;
        downloadsLoaded = true;
      }
      updateDownloadsIndicator();
      if (done) { done(downloadsList); }
    });
  }

  function downloadRunning(d) { return d.status === 'downloading' || d.status === 'queued'; }

  /* Title bar: how far the running downloads are, in one number. While any
     runs, the list is read every 2 s; then the watch stops. */
  var downloadsWatchTimer = null;
  var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/></svg>';
  function updateDownloadsIndicator() {
    var running = downloadsList.filter(downloadRunning);
    if (running.length) { watchDownloads(); }
    var btn = $('atb-downloads');
    if (!btn) { return; }
    if (!running.length) { btn.hidden = true; return; }
    var bytes = 0, total = 0, speed = 0;
    running.forEach(function (d) { bytes += d.bytes || 0; total += d.total || 0; speed += d.speed || 0; });
    var pct = total > 0 ? Math.min(99, Math.floor(bytes * 100 / total)) : 0;
    btn.hidden = false;
    btn.innerHTML = DOWNLOAD_ICON + '<span>' + pct + ' %</span>';
    var tip = running.length + (running.length === 1 ? ' descarga' : ' descargas') + (speed ? ' · ' + formatSpeed(speed) : '') + ' · Ver descargas';
    btn.setAttribute('data-tip', tip);
    btn.setAttribute('aria-label', tip);
  }

  function watchDownloads() {
    if (downloadsWatchTimer) { return; }
    downloadsWatchTimer = setInterval(function () {
      refreshDownloads(function (list) {
        if (!list.some(downloadRunning)) { clearInterval(downloadsWatchTimer); downloadsWatchTimer = null; }
      });
    }, 2000);
  }

  /* The finished download of this movie or episode, or null. */
  function downloadedFileFor(item, episode) {
    if (!platformHas('downloads') || !item || !item._stremio) { return null; }
    if (!downloadsLoaded) { refreshDownloads(); return null; }
    var id = stremioTargetId(item, isSeriesItem(item) ? (episode || state.playerEpisode || state.detailEpisode) : null);
    if (!id) { return null; }
    for (var i = 0; i < downloadsList.length; i++) {
      if (downloadsList[i].targetId === id && downloadsList[i].status === 'done') { return downloadsList[i]; }
    }
    return null;
  }

  function downloadFor(item, episode) {
    var id = stremioTargetId(item, episode);
    for (var i = 0; i < downloadsList.length; i++) { if (downloadsList[i].targetId === id) { return downloadsList[i]; } }
    return null;
  }

  /* Detail page "Descargar": choose the source (the recommended one first),
     the service starts it in the background and a short notice says so. */
  function startTitleDownload(item, episode) {
    if (isSeriesItem(item) && !episode) { episode = state.detailEpisode || (item.episodes && item.episodes[0]) || null; }
    if (isSeriesItem(item) && !episode) { return; }
    var existing = downloadFor(item, episode);
    if (existing && existing.status !== 'error' && existing.status !== 'missing') { return openSettingsAt('downloads'); }
    openSourcePicker(item, episode, function (src) {
      var target = episode || item;
      portalServiceCall('downloadStart', {
        title: item.title || '',
        subtitle: episode ? ((episode.season ? 'T' + episode.season + ' ' : '') + (episode.number ? 'Capítulo ' + episode.number : (episode.title || ''))) : '',
        targetId: stremioTargetId(item, episode),
        itemId: String(item.id || ''),
        poster: item.poster || item.cover || '',
        url: src.url || '', headers: src.headers || null,
        infoHash: src.infoHash || '', fileIdx: src.fileIdx, sources: src.sources || null,
        filename: src.filename || '',
        duration: durationToSeconds(target.duration || item.duration)
      }, function (err, answer) {
        var failed = err || !answer || answer.returnValue === false;
        refreshDownloads();
        showDownloadNotice(failed ? ('No se pudo descargar: ' + (err || (answer && answer.errorText) || 'error desconocido')) : '');
      });
    }, { download: true });
  }

  /* "Se está descargando": continue using the app, or go see it. */
  function showDownloadNotice(error) {
    if (sourcePickerOpen) { closeSourcePicker(); }
    sourcePickerOpen = true;
    sourcePickerReturn = state.focus;
    sourcePickerSeq++;
    var root = el('div', 'source-picker');
    root.id = 'dialog-download-started';
    var panel = el('div', 'srcp-panel is-notice');
    var head = el('div', 'srcp-head');
    head.appendChild(el('div', 'srcp-title', error ? 'No se pudo descargar' : 'Se está descargando'));
    panel.appendChild(head);
    var body = el('div', 'srcp-body');
    var box = el('div', 'srcp-notice');
    box.appendChild(el('p', null, error ||
      'Puedes seguir usando la app mientras se descarga. Si cierras OpenTV, la descarga se detiene y sigue cuando lo vuelvas a abrir.'));
    body.appendChild(box);
    panel.appendChild(body);
    var foot = el('div', 'srcp-foot');
    var ok = el('div', 'acc-seg-btn focusable', 'Entendido');
    ok._activate = closeSourcePicker;
    var go = el('div', 'acc-seg-btn focusable is-selected', 'Ver mis descargas');
    go._activate = function () { closeSourcePicker(); openSettingsAt('downloads'); };
    foot.appendChild(ok);
    foot.appendChild(go);
    panel.appendChild(foot);
    root.appendChild(panel);
    root.addEventListener('click', function (ev) { if (ev.target === root) { closeSourcePicker(); } });
    mountOverlay(root);
    sourcePickerNode = root;
    setFocus(go);
  }

  function formatBytes(n) {
    if (!(n > 0)) { return '0 MB'; }
    if (n >= 1073741824) { return (n / 1073741824).toFixed(2).replace('.', ',') + ' GB'; }
    /* Small files: "450 KB" / "3,2 MB", never "0 MB". */
    if (n < 1048576) { return Math.max(1, Math.round(n / 1024)) + ' KB'; }
    if (n < 10485760) { return (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
    return Math.round(n / 1048576) + ' MB';
  }

  /* Plays a finished download as its own title (the file goes through the
     same relay as any addon source: MKV, other audio…). */
  function watchDownload(d) {
    expandToFullscreen({ id: 'download:' + d.id, title: d.title + (d.subtitle ? ' · ' + d.subtitle : ''),
      _stremio: true, _downloadId: d.id, kind: 'pelicula', type: 'movie', poster: d.poster || '', cover: d.poster || '' }, null);
  }

  /* ------------------------------------------------ Ajustes → Descargas */
  /* Same look as Mi lista: two tabs (En curso / Completadas) and a grid of
     posters with the progress bar on them. While it is shown it refreshes
     every 1.5 s, touching only what changed (no flicker, hover kept). */
  var downloadsTab = 'running';
  var downloadsPanel = null;
  var downloadsCards = {};      /* id -> { card, fill, sub, status } */
  var downloadsPanelTimer = null;
  var DL_PAUSE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg>';
  var DL_PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>';

  function downloadIsRunning(d) { return d.status !== 'done' && d.status !== 'missing'; }

  function downloadPct(d) { return d.total > 0 ? Math.min(100, Math.floor(d.bytes * 100 / d.total)) : 0; }

  function downloadSubText(d) {
    if (d.status === 'downloading') { return downloadPct(d) + ' %' + (d.speed ? ' · ' + formatSpeed(d.speed) : ''); }
    if (d.status === 'queued') { return 'En espera'; }
    if (d.status === 'paused') { return 'En pausa · ' + downloadPct(d) + ' %'; }
    if (d.status === 'error') { return 'Error · toca para reintentar'; }
    if (d.status === 'missing') { return 'El archivo ya no está'; }
    return formatBytes(d.total || d.bytes);
  }

  function buildDownloadsPanel() {
    downloadsPanel = el('div', 'settings-panel history-panel is-library downloads-panel');
    paintDownloadsPanel(true);
    return downloadsPanel;
  }

  /* While the panel is shown: refresh every 1.5 s (progress and speed). */
  function setDownloadsPanelLive(on) {
    if (downloadsPanelTimer) { clearInterval(downloadsPanelTimer); downloadsPanelTimer = null; }
    if (!on) { return; }
    refreshDownloads(function () {
      /* Nothing downloading but some ready: open on Completadas. */
      var running = downloadsList.some(downloadIsRunning);
      var ready = downloadsList.some(function (d) { return !downloadIsRunning(d); });
      if (!running && ready && downloadsTab !== 'done') { downloadsTab = 'done'; return paintDownloadsPanel(true); }
      paintDownloadsPanel(false);
    });
    downloadsPanelTimer = setInterval(function () {
      if (state.screen !== 'settings') { clearInterval(downloadsPanelTimer); downloadsPanelTimer = null; return; }
      refreshDownloads(function () { paintDownloadsPanel(false); });
    }, 1500);
  }

  function downloadAct(d, what) {
    portalServiceCall('downloadAction', { id: d.id, action: what }, function () {
      refreshDownloads(function () { paintDownloadsPanel(true); });
    });
  }

  /* full: rebuild everything; otherwise only bars and texts are updated while
     the same downloads are on screen in the same states. */
  function paintDownloadsPanel(full) {
    var p = downloadsPanel;
    if (!p) { return; }
    var list = downloadsList.filter(function (d) { return downloadsTab === 'running' ? downloadIsRunning(d) : !downloadIsRunning(d); });
    var speed = 0;
    downloadsList.forEach(function (d) { if (d.status === 'downloading') { speed += d.speed || 0; } });
    if (speed) { noteNetSpeed(speed); }
    var same = !full && list.length === Object.keys(downloadsCards).length && list.every(function (d) {
      return downloadsCards[d.id] && downloadsCards[d.id].status === d.status;
    });
    if (same) {
      list.forEach(function (d) {
        var c = downloadsCards[d.id];
        c.sub.textContent = downloadSubText(d);
        if (c.fill) { c.fill.style.width = Math.max(2, downloadPct(d)) + '%'; }
      });
      return;
    }
    var keep = state.focus && state.focus._dlKey;
    var again = null;
    clear(p);
    downloadsCards = {};
    var tabs = el('div', 'history-tabs');
    [['running', 'En curso'], ['done', 'Completadas']].forEach(function (t) {
      var tab = el('div', 'history-tab focusable' + (downloadsTab === t[0] ? ' is-selected' : ''), t[1]);
      tab._dlKey = 'tab:' + t[0];
      tab._activate = function () { downloadsTab = t[0]; paintDownloadsPanel(true); };
      if (keep === tab._dlKey) { again = tab; }
      tabs.appendChild(tab);
    });
    p.appendChild(tabs);
    p.appendChild(el('div', 'history-rule'));
    var total = el('div', 'history-total', downloadsTab === 'running' ? 'Descargando · ' : 'Para ver sin internet · ');
    total.appendChild(el('span', null, String(list.length)));
    if (downloadsFree) { total.appendChild(document.createTextNode(' · ' + formatBytes(downloadsFree) + ' libres')); }
    if (window.desktop && window.desktop.openDownloads) {
      var folder = el('div', 'history-clear focusable', 'Abrir carpeta');
      folder._dlKey = 'folder';
      folder._activate = function () { window.desktop.openDownloads(); };
      total.appendChild(folder);
    }
    p.appendChild(total);
    var grid = el('div', 'history-grid library-grid scrollable');
    if (!list.length) {
      grid.appendChild(el('div', 'history-grid-empty', downloadsTab === 'running'
        ? 'Nada descargándose. En la ficha de una película o capítulo, toca el botón de descarga.'
        : 'Aún no hay descargas completas.'));
    }
    list.forEach(function (d) {
      var running = d.status === 'downloading' || d.status === 'queued';
      var card = el('div', 'history-card library-card focusable' + (d.status === 'paused' ? ' is-paused' : ''));
      card._dlKey = 'card:' + d.id;
      var art = el('div', 'library-art');
      var img = document.createElement('img');
      img.className = 'history-poster';
      img.alt = '';
      img.loading = 'lazy';
      img.src = d.poster || 'assets/original/common/bg_placehoder_vertical.png';
      img.onerror = function () { this.style.visibility = 'hidden'; };
      art.appendChild(img);
      var fill = null;
      if (downloadIsRunning(d)) {
        var bar = el('div', 'history-bar library-bar');
        fill = el('i');
        fill.style.width = Math.max(2, downloadPct(d)) + '%';
        bar.appendChild(fill);
        art.appendChild(bar);
      }
      /* The big icon: play a finished one, pause / resume a running one. */
      var ico = el('i', 'history-play');
      ico.innerHTML = running ? DL_PAUSE_SVG : DL_PLAY_SVG;
      art.appendChild(ico);
      if (platformHas('mouse')) {
        var remove = el('button', 'library-remove desktop-native-control');
        remove.type = 'button';
        remove.title = d.status === 'done' ? 'Borrar descarga' : 'Cancelar descarga';
        remove.innerHTML = REMOVE_SVG;
        remove.addEventListener('click', function (event) { event.stopPropagation(); downloadAct(d, 'delete'); });
        art.appendChild(remove);
      }
      card.appendChild(art);
      card.appendChild(el('div', 'history-card-title', d.title + (d.subtitle ? ' · ' + d.subtitle : '')));
      var sub = el('div', 'history-sub', downloadSubText(d));
      card.appendChild(sub);
      card.title = d.status === 'done' ? 'Ver ' + d.title : (running ? 'Pausar' : 'Reanudar');
      card._activate = function () {
        if (d.status === 'done') { return watchDownload(d); }
        if (d.status === 'missing') { return downloadAct(d, 'remove'); }
        downloadAct(d, running ? 'pause' : 'resume');
      };
      if (keep === card._dlKey) { again = card; }
      downloadsCards[d.id] = { card: card, fill: fill, sub: sub, status: d.status };
      grid.appendChild(card);
    });
    p.appendChild(grid);
    if (again) { setFocus(again); }
  }

  /* ---- player/live.js -------------------------------------------------------- */
  /* player/live.js — Reproductor en vivo: cambio de canal, info del canal y regreso a la pantalla anterior.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  var liveChannelSeq = 0;
  var liveChannelDebounceTimer = null;
  function startLiveChannel(ch, immediate) {
    /* A new channel (or Reintentar) plays in the player's own element. */
    if (liveHandoff && liveHandoff.type === 'preview') { stopLivePreview(); }
    if (liveChannelDebounceTimer) {
      clearTimeout(liveChannelDebounceTimer);
      liveChannelDebounceTimer = null;
    }
    if (!ch) { ch = CHANNELS[state.channel]; }
    if (!ch) {
      /* No channels (no lists yet, or none could be read): say why. */
      if (state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(liveEmptyMessage()); }
      return;
    }
    if (!ch.streamUrl) {
      state.streamError = 'Señal no disponible';
      setPlayerStatus(state.streamError);
      return;
    }
    noteLivePlaying(ch);

    var doStart = function () {
      ++liveChannelSeq;
      /* The viewer left the player while the channel was waiting to start (TV
         and desktop): starting it now would play it hidden, with sound. */
      if (state.screen !== 'player' || state.playerMode !== 'live') { return; }
      setPlayerStatus('');
      showInfobar();
      /* (A title's still from the details screen does not belong to a channel.) */
      if (playerVideo) { playerVideo.removeAttribute('poster'); }
      /* An M3U channel plays its own link (no service round trip). */
      playUrl(ch.streamUrl);
    };

    if (immediate) {
      doStart();
    } else {
      liveChannelDebounceTimer = setTimeout(doStart, 180);
    }
  }

  function updatePlayerChannel() {
    if (!playerStage) { return; }
    updatePlayer();
  }

  function updatePlayer() {
    var live = state.playerMode === 'live';
    var ch = CHANNELS[state.channel] || {};
    var idx = playerInfo.querySelector('.pi-index');
    var name = playerInfo.querySelector('.pi-name');
    var date = playerInfo.querySelector('.pi-date');
    var range = playerInfo.querySelector('.pi-range');
    var now = playerInfo.querySelector('.pi-now');
    var next = playerInfo.querySelector('.pi-next');
    var uhd = playerInfo.querySelector('.pi-uhd');
    var logo = playerInfo.querySelector('.pi-logo');

    if (live) {
      var actionButtons = playerInfo.querySelectorAll('.pi-act');
      for (var ab = 0; ab < actionButtons.length; ab++) {
        if (actionButtons[ab]._kind === 'Favorito') {
          actionButtons[ab].classList.toggle('is-selected', !!ch.fav);
          setButtonText(actionButtons[ab], ch.fav ? (actionButtons[ab]._iconized ? 'Quitar de favoritos' : 'En favoritos')
            : (actionButtons[ab]._iconized ? 'Añadir a favoritos' : 'Favorito'));
        }
      }
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
      if (playerInfo) { playerInfo.style.display = ''; }
      idx.style.display = 'block';
      idx.textContent = pad2(ch.index || (state.channel + 1));
      name.textContent = ch.name || '';
      var piSub = playerInfo.querySelector('.pi-sub');
      if (piSub) { piSub.textContent = 'Canal ' + (ch.index || (state.channel + 1)) + '  ·  ' + liveChannelGroups(ch).join(', '); }
      var piTop = playerInfo.querySelector('.pi-top-title');
      if (piTop) { piTop.textContent = ch.name || ''; }
      nameRowPosition();
      /* "Hoy" only makes sense next to a programme time. */
      date.textContent = ch.time ? 'Hoy' : '';
      range.textContent = ch.time || '';
      now.style.display = 'block';
      now.textContent = ch.now || 'En vivo';
      next.style.display = ch.next ? 'block' : 'none';
      if (ch.next) { next.textContent = 'Siguiente: ' + ch.next; }
      uhd.style.display = ch.uhd ? 'block' : 'none';
      logo.style.display = 'block';
      if (logo) {
        if (ch.logo) {
          logo.style.backgroundImage = 'url(' + ch.logo + ')';
        } else {
          logo.style.backgroundImage = '';
        }
      }
    } else {
      if (playerInfo) { playerInfo.classList.remove('is-active'); playerInfo.style.display = 'none'; }
      var item = state.playerItem || VOD[0];
      if (vodInfobarTitle) {
        if (isSeriesItem(item) && state.playerEpisode) {
          var epTitle = state.playerEpisode.title || state.playerEpisode.name;
          var epNum = state.playerEpisode.number || state.playerEpisode.seriesNumber;
          var epLabel = epTitle || (epNum ? ('Capítulo ' + epNum) : '');
          if (window.OPENTV_DESKTOP) {
            /* "Serie  E3 · Nombre", without repeating the series name. */
            var named = epTitle && norm(epTitle).indexOf(norm(item.title)) === -1 && !/^(episodio|capítulo|cap\.?)\s*\d+$/i.test(epTitle) ? ' · ' + epTitle : '';
            vodInfobarTitle.textContent = item.title + (epNum ? '  E' + epNum : '') + named;
          } else {
            vodInfobarTitle.textContent = epLabel ? (item.title + ' - ' + epLabel) : item.title;
          }
        } else {
          vodInfobarTitle.textContent = item.title;
        }
      }
      if (vodInfobarPoster) {
        vodInfobarPoster.src = item.poster || item.cover || 'assets/original/common/bg_placehoder_vertical.png';
      }
      updateVodProgress(playerVideo ? playerVideo.currentTime : 0, playerVideo ? playerVideo.duration : 0);
    }
    for (var rowIndex in playerChannelRows) {
      if (playerChannelRows.hasOwnProperty(rowIndex)) {
        playerChannelRows[rowIndex].classList.toggle('is-current', playerChannelRows[rowIndex]._channel === state.channel);
      }
    }
    layoutInfoTexts();
  }

  function nameRowPosition() {
    var row = playerInfo.querySelector('.pi-namerow');
    if (!row) { return; }
    var idx = playerInfo.querySelector('.pi-index');
    var nm = row.querySelector('.pi-name');
    var uhd = row.querySelector('.pi-uhd');
    /* Keep a fixed lane for the channel number.  Measuring an auto-width
       number while Starfish is animating the infobar returns inconsistent
       values and can place the name on top of it. */
    var base = 165;

    row.style.position = 'absolute';
    row.style.left = (367.5 + base) + 'px';
    row.style.top = '13.5px';
    row.style.width = '480px';
    row.style.height = '58px';
    row.style.display = 'block';

    nm.style.position = 'absolute';
    nm.style.left = '0px';
    nm.style.top = '8px';                       /* alignBottom with mTextChannelIndex */
    nm.style.width = '480px';
    nm.style.height = '50px';
    nm.style.lineHeight = '50px';

    if (uhd) {
      uhd.style.left = (nm.offsetWidth + 30) + 'px';   /* 20dp */
      uhd.style.top = '18.5px';                        /* alignTop name + 7dp */
    }
  }

  function layoutInfoTexts() {
    var q = playerInfo.querySelector('.pi-quality');
    var s = playerInfo.querySelector('.pi-scale');
    var f = playerInfo.querySelector('.pi-func');
    if (!q || !s || !f) { return; }
    q.style.left = '517.5px';                   /* 345dp */
    s.style.left = (q.offsetLeft + q.offsetWidth + 30) + 'px';   /* 20dp */
    f.style.left = (s.offsetLeft + s.offsetWidth + 30) + 'px';   /* 20dp */
  }

  function openChannelPanel() {
    if (state.playerMode !== 'live') { return; }
    state.channelsOpen = true;
    playerChannels.classList.add('is-active');
    renderPlayerCategories();
    renderPlayerChannels(state.channel);
    /* Bring the active category into view: with dozens of categories the
       rail is very wide and the selected pill is usually off-screen. */
    scrollSelectedCategoryPill();
    var row = playerChannelRows[state.channel];
    if (row) {
      setFocus(row);
      var list = row.parentNode;
      var top = state.channel * 111;
      if (top < list.scrollTop || top + 109.5 > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - 120);
      }
    }
  }

  function closeChannelPanel() {
    state.channelsOpen = false;
    playerChannels.classList.remove('is-active');
    if (state.screen === 'player') { setFocus(playerStage); }
  }

  function restorePlayerReturn() {
    hideInfobar();
    hideVodInfobar();
    var ret = state.playerReturn;
    if (ret && ret.screen === 'detail') {
      var scrPlayer = $('screen-player');
      var scrDetail = $('screen-detail');
      if (scrPlayer && detailShowsArt()) {
        /* PC and TVs: back on the details screen the video stops (no small
           player there, only the title's picture). */
        stopPlayerVideo();
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      } else if (scrPlayer) {
        scrPlayer.classList.add('is-mini');
        scrPlayer.classList.add('is-active');
      }
      if (scrDetail) {
        scrDetail.classList.add('is-active');
      }
      state.screen = 'detail';
      var rebuiltDetail = false;
      if (state.detailNeedsRebuild && state.detail) {
        /* The episode browser switched season: rebuild the detail list so the
           season dropdown and the episode grid match what is playing. */
        state.detailNeedsRebuild = false;
        buildDetail(state.detail);
        rebuiltDetail = true;
        var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
        if (sBtn) { setFocus(sBtn); }
      } else if (state.detail) {
        syncDetailEpisodeHighlight(state.detail);
        /* The progress saved while watching changes the main button
           ("Reanudar · 25:10"). */
        rebuiltDetail = refreshDetailResume(state.detail);
      }
      if (!rebuiltDetail) {
        if (ret.focus && isVisible(ret.focus)) {
          setFocus(ret.focus);
        } else {
          var firstBtn = detailButtons ? detailButtons.querySelector('.focusable') : null;
          if (firstBtn) { setFocus(firstBtn); }
        }
      }
    } else {
      /* Desktop: a TV channel goes on playing in the home preview. */
      var toHome = !(ret && ret.screen === 'search');
      var handed = window.OPENTV_DESKTOP && toHome && borrowPlayerIntoHome();
      if (!handed && !keepFloatingVideo()) {
        /* Also cancel a channel that is still resolving or waiting to start. */
        liveChannelSeq++;
        if (liveChannelDebounceTimer) { clearTimeout(liveChannelDebounceTimer); liveChannelDebounceTimer = null; }
        stopPlayerVideo();
      }  /* PiP keeps playing while browsing */
      var scrP = $('screen-player');
      if (scrP) {
        scrP.classList.remove('is-mini');
        scrP.classList.remove('is-active');
      }
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
    }
  }

  /* ---- player/live-controls.js ----------------------------------------------- */
  /* player/live-controls.js — Escritorio: TV en pantalla completa real, pausa/reproducir y actualizar canales.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* "Pantalla completa" on the TV now really fills the screen (Windows full
     screen, like a TV); leaving the player leaves it too, and Esc does both
     at once. */
  var liveAutoFullscreen = false;

  /* The video on screen: the home preview's own element while it stands in
     for the player (hand-off), otherwise the player's. */
  function liveActiveVideo() {
    return liveHandoff && liveHandoff.type === 'preview' && livePreviewVideo ? livePreviewVideo : playerVideo;
  }

  function enterLiveFullscreen() {
    if (!window.OPENTV_DESKTOP || isWindowFullscreen()) { return; }
    liveAutoFullscreen = true;
    setWindowFullscreen(true);
  }

  function leaveLiveFullscreen() {
    if (!liveAutoFullscreen) { return; }
    liveAutoFullscreen = false;
    if (isWindowFullscreen()) { setWindowFullscreen(false); }
  }

  function toggleLivePlayPause() {
    var v = liveActiveVideo();
    if (!v) { return; }
    if (v.paused) {
      var p = v.play();
      if (p && p.catch) { p.catch(function () {}); }
      showOsdIcon('none');
    } else {
      v.pause();
      showOsdIcon('pause');
    }
    syncLivePlayButton();
    showInfobar();
  }

  function syncLivePlayButton() {
    var b = document.querySelector('.pi-act.pi-play');
    if (!b) { return; }
    var v = liveActiveVideo();
    var paused = !!(v && v.paused);
    if (b._paused === paused) { return; }
    b._paused = paused;
    setButtonText(b, paused ? 'Reproducir (Espacio)' : 'Pausa (Espacio)', paused ? UI_ICONS.play : UI_ICONS.pause);
  }

  function syncLiveFullscreenButton() {
    var b = document.querySelector('.pi-act.pi-full');
    if (!b) { return; }
    var full = isWindowFullscreen();
    setButtonText(b, full ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa (F)', full ? UI_ICONS.exitFullscreen : UI_ICONS.fullscreen);
  }

  /* Reads the viewer's M3U lists again and keeps the channel that is playing
     selected. */
  function refreshLiveChannels(btn) {
    if (!currentLiveCategory) { return; }
    var keep = liveChannelKey(CHANNELS[state.channel]);
    if (btn) { btn.classList.add('is-spinning'); }
    setPlayerStatus('Actualizando canales…');
    var reload = currentLiveCategory.isSaved
      ? function (done) { switchLiveCategory(currentLiveCategory, done); }
      : reloadLiveLists;
    reload(function () {
      for (var i = 0; i < CHANNELS.length; i++) {
        if (liveChannelKey(CHANNELS[i]) === keep) { state.channel = i; break; }
      }
      renderPlayerChannels(state.channel);
      renderLiveRows(false);
      setPlayerStatus('');
      if (btn) { btn.classList.remove('is-spinning'); }
    });
  }

  var liveControlsWatching = false;
  function installLiveControls() {
    if (!window.OPENTV_DESKTOP) { return; }
    [playerVideo, livePreviewVideo].forEach(function (v) {
      if (!v || v._liveControls) { return; }
      v._liveControls = true;
      v.addEventListener('play', syncLivePlayButton);
      v.addEventListener('pause', syncLivePlayButton);
    });
    if (!liveControlsWatching && window.desktop && window.desktop.onFullscreenChanged) {
      liveControlsWatching = true;
      window.desktop.onFullscreenChanged(function (isFull) {
        syncLiveFullscreenButton();
        /* Esc (or F11) out of the TV's full screen also leaves the player. */
        if (!isFull && liveAutoFullscreen && state.screen === 'player' && state.playerMode === 'live') {
          liveAutoFullscreen = false;
          desktopBack();
        }
      });
    }
  }

  /* ------------------------------------------------------------------
     Changing category (guide, chips, channel panel) only changes the list:
     the channel that is playing keeps playing. It stays selected in the new
     list, or is shown on top of it when that category does not have it.
     ------------------------------------------------------------------ */
  var liveNowPlaying = null;
  function noteLivePlaying(ch) {
    if (!window.OPENTV_DESKTOP) { return; }
    /* The channel watched before this one, for "Último canal" (TV remote ←). */
    if (liveNowPlaying && ch && liveChannelKey(liveNowPlaying) !== liveChannelKey(ch)) { liveRecallChannel = liveNowPlaying; }
    liveNowPlaying = ch || null;
  }

  var liveRecallChannel = null;
  /* Back to the channel watched before (like a TV remote's "recall" key). */
  function recallLastChannel() {
    var want = liveRecallChannel;
    if (!want) { setPlayerStatus('Aún no has visto otro canal'); setTimeout(function () { setPlayerStatus(''); }, 1600); return; }
    var key = liveChannelKey(want);
    for (var i = 0; i < CHANNELS.length; i++) {
      if (liveChannelKey(CHANNELS[i]) === key) { setChannel(i, true); showInfobar(); return; }
    }
    /* Not in the current category: play it all the same. */
    startLiveChannel(want, true);
    showInfobar();
  }

  function livePlayingToKeep() {
    if (!window.OPENTV_DESKTOP || !liveNowPlaying) { return null; }
    var key = liveChannelKey(liveNowPlaying);
    if (!key) { return null; }
    if (state.screen === 'player' && state.playerMode === 'live') { return liveNowPlaying; }
    if (livePreviewChannel === key) { return liveNowPlaying; }
    return null;
  }

  function keepLivePlayingChannel(keep) {
    if (!keep) { return false; }
    var key = liveChannelKey(keep);
    for (var i = 0; i < CHANNELS.length; i++) {
      if (liveChannelKey(CHANNELS[i]) === key) { state.channel = i; return true; }
    }
    var copy = {};
    for (var k in keep) { if (Object.prototype.hasOwnProperty.call(keep, k)) { copy[k] = keep[k]; } }
    copy._keptPlaying = true;
    copy.fav = !!state.favs[liveFavKey(copy)];
    CHANNELS.unshift(copy);
    state.channel = 0;
    return true;
  }

  /* ---- desktop/titlebar.js --------------------------------------------------- */
  /* desktop/titlebar.js — Barra de título propia de la ventana (logo + zona para arrastrar).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The window has no native title bar: this strip takes its place, and
     Windows draws its own minimize / maximize / close buttons over the right
     end of it. It disappears in full screen. The canvas is laid out below it
     (see fitDesignViewport). */
  var titleBarEl = null;

  function titleBarHeight() {
    if (!titleBarEl || document.body.classList.contains('is-window-fullscreen')) { return 0; }
    return titleBarEl.offsetHeight || 0;
  }

  function installTitleBar() {
    var info = window.OPENTV_DESKTOP && window.desktop && window.desktop.titleBar;
    if (!info || titleBarEl) { return; }
    titleBarEl = el('div', 'app-titlebar');
    titleBarEl.id = 'app-titlebar';
    titleBarEl.style.height = (parseInt(info.height, 10) || 36) + 'px';
    var brand = el('div', 'atb-brand');
    var logo = el('img', 'atb-logo');
    logo.src = 'images/logo-mark.svg';
    logo.alt = '';
    brand.appendChild(logo);
    brand.appendChild(el('span', 'atb-name', 'OpenTV'));
    titleBarEl.appendChild(brand);
    titleBarEl.appendChild(el('div', 'atb-section', ''));
    /* Downloads in progress: icon + percentage, opens Ajustes → Descargas
       (player/downloads.js keeps it up to date; hidden when nothing runs). */
    if (platformHas('downloads')) {
      var dlBtn = el('button', 'atb-dl');
      dlBtn.type = 'button';
      dlBtn.id = 'atb-downloads';
      dlBtn.hidden = true;
      dlBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        openSettingsAt('downloads');
      });
      titleBarEl.appendChild(dlBtn);
    }
    if (window.desktop && window.desktop.pin) {
      var pinBtn = el('button', 'atb-pin');
      pinBtn.type = 'button';
      pinBtn.id = 'atb-pin';
      pinBtn.innerHTML = UI_ICONS.pin;
      var applyPinState = function (pinned) {
        pinBtn.classList.toggle('is-pinned', !!pinned);
        var tip = pinned ? 'Ventana siempre visible activada (clic para desactivar)' : 'Fijar ventana siempre encima';
        pinBtn.setAttribute('data-tip', tip);
        pinBtn.setAttribute('aria-label', tip);
        pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      };
      applyPinState(false);
      pinBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        try {
          var p = window.desktop.pin();
          if (p && p.then) { p.then(applyPinState).catch(function () {}); }
        } catch (ePin) { /* ignore */ }
      });
      try {
        var qp = window.desktop.pin('query');
        if (qp && qp.then) { qp.then(applyPinState).catch(function () {}); }
      } catch (ePinQ) { /* ignore */ }
      titleBarEl.appendChild(pinBtn);
    }
    /* Next to the pin: the whole app in full screen (the bar hides itself
       there; Esc or F11 brings the window back). */
    if (window.desktop && window.desktop.fullscreen) {
      var fullBtn = el('button', 'atb-pin atb-full');
      fullBtn.type = 'button';
      fullBtn.id = 'atb-full';
      fullBtn.innerHTML = UI_ICONS.fullscreen;
      fullBtn.setAttribute('data-tip', 'Pantalla completa (F11)');
      fullBtn.setAttribute('aria-label', 'Pantalla completa');
      fullBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        try { window.desktop.fullscreen(true); } catch (eFull) { /* ignore */ }
      });
      titleBarEl.appendChild(fullBtn);
    }
    document.body.insertBefore(titleBarEl, document.body.firstChild);
    document.body.classList.add('has-titlebar');
    if (window.desktop && window.desktop.onFullscreenChanged) {
      window.desktop.onFullscreenChanged(function (isFull) {
        document.body.classList.toggle('is-window-fullscreen', !!isFull);
        fitDesignViewport();
      });
    }
    if (window.desktop && window.desktop.fullscreen) {
      try {
        var q = window.desktop.fullscreen('query');
        if (q && q.then) {
          q.then(function (isFull) {
            document.body.classList.toggle('is-window-fullscreen', !!isFull);
            fitDesignViewport();
          }).catch(function () {});
        }
      } catch (eQuery) { /* no full-screen info */ }
    }
  }

  /* Shows where the viewer is ("Películas", "Ajustes"…) next to the logo. */
  function updateTitleBarSection() {
    if (!titleBarEl) { return; }
    var label = '';
    if (state.screen === 'home') {
      var tab = TABS[state.tab];
      label = tab ? String(tab.label || '') : '';
    } else if (state.screen === 'search') { label = 'Buscar'; }
    else if (state.screen === 'settings') { label = 'Ajustes'; }
    else if (state.screen === 'detail' && state.detail) { label = state.detail.title || ''; }
    else if (state.screen === 'player') {
      label = state.playerMode === 'live' ? ((CHANNELS[state.channel] || {}).name || 'TV en vivo')
        : ((state.playerItem && state.playerItem.title) || '');
    }
    var node = titleBarEl.querySelector('.atb-section');
    if (node.textContent !== label) { node.textContent = label; }
  }

  /* ---- desktop/splash.js ----------------------------------------------------- */
  /* desktop/splash.js — Pantalla de arranque: el nombre de OpenTV mientras se prepara el inicio (sin logo grande).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Covers the window from the very first frame and fades out once the home
     screen is built (at least a short moment, so it never just flickers). */
  var SPLASH_MIN_MS = 1100;
  var SPLASH_MAX_MS = 8000;

  function showBootSplash() {
    /* index.html already has it from the first frame; built here only if not. */
    var splash = $('boot-splash');
    if (!window.OPENTV_DESKTOP) {
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
      /* The same breathing dots as the screen loader (core/loader.js). */
      var dots = makeLoader('', '').firstChild;
      splash.appendChild(dots);
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

  /* ---- desktop/updates.js ---------------------------------------------------- */
  /* desktop/updates.js — Actualizaciones automáticas: estado en Acerca de y aviso "Reiniciar y actualizar".
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The download runs in the main process (platforms/electron/updater.cjs). Here the
     viewer sees what is happening and can restart to install right away;
     otherwise the update installs by itself when the app is closed. */
  var updateStatus = { state: 'idle' };
  var updateCards = [];
  var updateNotice = null;
  var updateNoticeDismissed = '';

  function updatesApi() {
    return window.OPENTV_DESKTOP && window.desktop && window.desktop.updates ? window.desktop.updates : null;
  }

  function updateStatusText(s) {
    switch (s.state) {
      case 'checking': return 'Buscando actualizaciones…';
      case 'current': return 'Tienes la última versión.';
      case 'downloading': return 'Descargando la versión ' + (s.version || 'nueva') + (s.percent ? ' · ' + s.percent + ' %' : '…');
      case 'ready': return 'La versión ' + (s.version || 'nueva') + ' está lista. Se instalará al cerrar la app.';
      case 'available-portable': return 'Hay una versión nueva (' + (s.version || '') + '). La versión portable no se actualiza sola: descarga la nueva y reemplaza el .exe.';
      case 'unconfigured': return 'Las actualizaciones automáticas aún no están conectadas a GitHub en esta compilación.';
      case 'dev': return 'Modo desarrollo: las actualizaciones solo funcionan en la versión instalada.';
      case 'error': return 'No se pudo comprobar: ' + (s.error || 'error desconocido');
      default: return 'La app busca actualizaciones al abrirse y cada 6 horas.';
    }
  }

  function buildUpdateCard() {
    var card = desktopSettingsCard(UI_ICONS.retry, 'Actualizaciones', updateStatusText(updateStatus));
    card.classList.add('sd-update-card');
    var btn = desktopSettingsButton('Buscar actualizaciones', UI_ICONS.retry, function () {
      var api = updatesApi();
      if (!api) { return; }
      if (updateStatus.state === 'ready') { api.install(); return; }
      if (updateStatus.state === 'available-portable') { if (api.releases) { api.releases(); } return; }
      updateStatus = { state: 'checking' };
      renderUpdateUi();
      api.check().then(function (s) { if (s && s.state !== 'idle' && updateStatus.state === 'checking' && s.state !== 'checking') { updateStatus = s; renderUpdateUi(); } }).catch(function () {});
    });
    btn.classList.add('sd-update-btn');
    card.appendChild(btn);
    updateCards.push(card);
    renderUpdateUi();
    return card;
  }

  function renderUpdateUi() {
    /* (Cards are built with the Ajustes screen, once; a card that is not on
       the page yet must still be filled.) */
    var s = updateStatus;
    for (var i = 0; i < updateCards.length; i++) {
      var text = updateCards[i].querySelector('.sd-card-sub');
      if (text) { text.textContent = updateStatusText(s); }
      var btn = updateCards[i].querySelector('.sd-update-btn');
      if (btn) {
        btn.lastChild.textContent = s.state === 'ready' ? 'Reiniciar y actualizar'
          : s.state === 'available-portable' ? 'Descargar versión nueva' : 'Buscar actualizaciones';
        var busy = s.state === 'checking' || s.state === 'downloading';
        btn.classList.toggle('is-disabled', busy || s.state === 'dev' || s.state === 'unconfigured');
        btn.classList.toggle('is-primary', s.state === 'ready' || s.state === 'available-portable');
      }
    }
    showUpdateNotice();
  }

  /* Small card when a downloaded update is waiting (once per version). */
  function showUpdateNotice() {
    var s = updateStatus;
    var want = s.state === 'ready' && updateNoticeDismissed !== s.version;
    if (!want) { if (updateNotice) { updateNotice.classList.remove('is-visible'); } return; }
    if (!updateNotice) {
      updateNotice = el('div', 'update-notice');
      updateNotice.setAttribute('data-no-gesture', '');
      document.body.appendChild(updateNotice);
    }
    clear(updateNotice);
    var ico = el('div', 'un-icon');
    ico.innerHTML = UI_ICONS.retry;
    updateNotice.appendChild(ico);
    var text = el('div', 'un-text');
    text.appendChild(el('b', null, 'Actualización lista'));
    text.appendChild(el('span', null, 'OpenTV ' + (s.version || '') + ' se instalará al cerrar la app.'));
    updateNotice.appendChild(text);
    var now = el('button', 'un-btn is-primary', 'Reiniciar ahora');
    now.type = 'button';
    now.addEventListener('click', function () { var api = updatesApi(); if (api) { api.install(); } });
    var later = el('button', 'un-btn', 'Más tarde');
    later.type = 'button';
    later.addEventListener('click', function () { updateNoticeDismissed = s.version; updateNotice.classList.remove('is-visible'); });
    updateNotice.appendChild(now);
    updateNotice.appendChild(later);
    /* Not while a video is playing full window: it waits for the next screen. */
    if (state.screen === 'player') { updateNotice.classList.remove('is-visible'); return; }
    updateNotice.classList.add('is-visible');
  }

  function installUpdates() {
    var api = updatesApi();
    if (!api) { return; }
    api.onStatus(function (s) { if (s) { updateStatus = s; renderUpdateUi(); } });
    api.status().then(function (s) { if (s) { updateStatus = s; renderUpdateUi(); } }).catch(function () {});
  }

  /* ---- desktop/display.js ---------------------------------------------------- */
  /* desktop/display.js — Escalado del lienzo a la ventana y "Volver" de escritorio.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ---------------------------------------------------------------- display */
  /* The reference UI is authored at 1920×1080. Older sets expose that exact
     logical viewport, whereas some UHD sets expose 3840×2160.
     Without this fit pass only the left half of the fixed canvas is painted
     and the right half of the TV remains black. */
  function viewportSize() {
    /* Most devices report the CSS viewport here. Some 2K/4K firmware
       reports a legacy 1280×720 inner viewport while compositing to its full
       physical 1920/3840 panel; using that value alone paints the left part
       of the TV and leaves the right side black. */
    var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
    var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
    if (!vw || !vh) { vw = 1920; vh = 1080; }
    var panelW = Math.floor((screen && screen.width) || 0);
    var panelH = Math.floor((screen && screen.height) || 0);
    var cssRatio = vw / vh;
    var panelRatio = panelW && panelH ? panelW / panelH : 0;
    /* Only trust screen.* when it is a true UHD/4K panel (>= 2560).
       Never override an HD/720p viewport (1280×720) with a virtual 1920 panel,
       which would force scale=1.0 and crop 640px on the right and 360px on the bottom. */
    if (panelW >= 2560 && panelW >= vw * 1.25 && panelH >= vh * 1.25 &&
        Math.abs(cssRatio - panelRatio) < 0.03) {
      vw = panelW;
      vh = panelH;
    }
    var panel = (panelW > 0 && panelH > 0) ? { w: panelW, h: panelH } : null;
    return { w: vw, h: vh, panel: panel };
  }

  function fitDesignViewport() {
    var app = $('app');
    if (!app) { return; }
    var size = viewportSize();
    var vw = size.w;
    var vh = size.h;
    /* Desktop: the window's own title bar strip sits above the canvas. */
    var titleInset = window.OPENTV_DESKTOP ? titleBarHeight() : 0;
    vh = Math.max(1, vh - titleInset);
    var scale = Math.min(vw / 1920, vh / 1080);
    if (!isFinite(scale) || scale <= 0) { scale = 1; }
    scale = Math.round(scale * 10000) / 10000;
    /* Keep a non-16:9 display letterboxed instead of stretching the design. */
    var left = Math.max(0, Math.round((vw - (1920 * scale)) / 2));
    var top = Math.max(0, Math.round((vh - (1080 * scale)) / 2));
    if (window.OPENTV_DESKTOP) {
      /* Desktop windows have any shape. Instead of letterboxing the 1920×1080
         design, the canvas grows to fill the whole window and every screen
         keeps its layout centred inside it (see desktop/theme.css). The
         player video and the screen backgrounds cover the full window. */
      var cw = Math.ceil(vw / scale);
      var ch = Math.ceil(vh / scale);
      app.style.width = cw + 'px';
      app.style.height = ch + 'px';
      app.style.setProperty('--cw', cw + 'px');
      app.style.setProperty('--ch', ch + 'px');
      app.style.setProperty('--ox', Math.floor((cw - 1920) / 2) + 'px');
      app.style.setProperty('--oy', Math.floor((ch - 1080) / 2) + 'px');
      left = 0; top = titleInset;
    }
    app.style.left = left + 'px';
    app.style.top = top + 'px';
    app.style.webkitTransform = 'scale(' + scale + ')';
    app.style.transform = 'scale(' + scale + ')';
  }


  function desktopBack() {
    if (historyDrawerOpen) { closeHistoryDrawer(); return; }
    if (dialogAddonsOpen) { closeAddonsDialog(); return; }
    if (dialogPlaySettingsOpen) { closePlaySettingsDialog(); return; }
    if (state.categoryPickerOpen) { closeCategoryPicker(); return; }
    if (state.episodeBrowserOpen) { closeEpisodeBrowser(); return; }
    if (playSettingViewOpen) { closePlaySettingView(); return; }
    if (state.screen === 'player') {
      leaveVodScrub(false);
      closeChannelPanel();
      restorePlayerReturn();
      return;
    }
    lastBackTime = 0;
    back();
  }

  /* ---- desktop/pip.js -------------------------------------------------------- */
  /* desktop/pip.js — Ventana flotante (Picture-in-Picture) y controles multimedia del sistema.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* Picture-in-Picture: the video floats in a small window on top of other
     apps. It keeps playing while the viewer browses or minimizes OpenTV.
     Subtitles are drawn by the page, so they are not shown in that window. */
  var pipMediaSessionReady = false;
  function setupPipMediaSession() {
    if (pipMediaSessionReady || !navigator.mediaSession) { return; }
    pipMediaSessionReady = true;
    var handlers = {
      play: function () { if (playerVideo) { playerVideo.play().catch(function () {}); } },
      pause: function () { if (playerVideo) { playerVideo.pause(); } },
      seekbackward: function () { playerSeek(-10); },
      seekforward: function () { playerSeek(10); },
      nexttrack: function () {
        if (state.playerMode === 'vod' && isSeriesItem(state.playerItem)) { advanceToNextEpisode(); }
      }
    };
    for (var name in handlers) {
      if (handlers.hasOwnProperty(name)) {
        try { navigator.mediaSession.setActionHandler(name, handlers[name]); } catch (eAction) { /* unsupported */ }
      }
    }
  }

  /* While another title floats in the PiP window, opening a detail page must
     not replace it with an automatic preview. Explicit play still does. */
  function keepFloatingVideo() {
    return !!(playerVideo && document.pictureInPictureElement === playerVideo);
  }

  function autoPreviewAllowed(item) {
    /* TVs show the title's picture on the details screen, not a preview. */
    if (platformIsTv() || detailShowsArt()) { return false; }
    /* Stremio mode: nothing plays until the viewer picks a source (a preview
       could start a torrent just by opening the page). */
    if (item && item._stremio) { return false; }
    if (!document.pictureInPictureElement || !playerVideo) { return true; }
    return !state.playerItem || state.playerItem === item;
  }

  /* Leaving PiP. Chromium pauses the video when the window is closed with
     its X, and keeps it playing for "back to tab". Closed: stop it if no
     player is on screen. Back: show the same video full size, no restart. */
  var pipLeaveBound = false;
  function bindPipLeave() {
    if (pipLeaveBound || !playerVideo) { return; }
    pipLeaveBound = true;
    playerVideo.addEventListener('leavepictureinpicture', function () {
      setTimeout(function () {
        var visible = state.screen === 'player' || state.screen === 'detail';
        if (playerVideo.paused) {
          if (!visible) { stopPlayerVideo(); }
          return;
        }
        if (state.screen === 'player') { return; }
        showFloatingVideoFullSize();
      }, 0);
    });
  }

  function showFloatingVideoFullSize() {
    var item = state.playerItem;
    if (!item || !playerStage) { return; }
    stopLivePreview();
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) { screens[i].classList.remove('is-active'); }
    if (state.detail !== item) { state.detail = item; state.detailNeedsRebuild = true; }
    state.playerMode = 'vod';
    state.playerReturn = { screen: 'detail', focus: null };
    var scrPlayer = $('screen-player');
    if (scrPlayer) { scrPlayer.classList.remove('is-mini'); scrPlayer.classList.add('is-active'); }
    state.screen = 'player';
    playerStage.classList.add('is-vod');
    updatePlayer();
    setFocus(playerStage);
    showVodInfobar();
  }

  function togglePictureInPicture() {
    if (!playerVideo || !document.pictureInPictureEnabled) { return; }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
      return;
    }
    if (!(playerVideo.currentSrc || playerVideo.getAttribute('src'))) {
      setPlayerStatus('Reproduce un vídeo para abrir la ventana flotante');
      return;
    }
    setupPipMediaSession();
    bindPipLeave();
    if (navigator.mediaSession && window.MediaMetadata && state.playerItem) {
      try {
        var ep = state.playerEpisode;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: state.playerItem.title || 'OpenTV',
          artist: ep && ep.number ? ('Episodio ' + ep.number) : ''
        });
      } catch (eMeta) { /* optional */ }
    }
    playerVideo.requestPictureInPicture().catch(function (err) {
      setPlayerStatus('No se pudo abrir la ventana flotante' + (err && err.message ? ': ' + err.message : ''));
    });
  }

  /* ---- desktop/navigation.js ------------------------------------------------- */
  /* desktop/navigation.js — Botón flotante Volver y modo cine al reproducir.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function installDesktopNavigation() {
    var button = el('button', 'desktop-native-control');
    button.innerHTML = UI_ICONS.back;
    button.setAttribute('data-tip', 'Volver (Esc)');
    button.id = 'desktop-back';
    button.type = 'button';
    button.setAttribute('aria-label', 'Volver a la pantalla anterior');
    button.addEventListener('click', desktopBack);
    document.body.appendChild(button);

    /* No floating Historial button: history lives in Ajustes → Mi lista
       (and Ctrl+J still opens it). */

    /* While a video plays, the floating buttons and the cursor get out of
       the way. They come back with the player controls (mouse move, a key,
       pause) and leave again when those controls auto-hide. */
    var body = document.body;
    var lastScreen = '';
    setInterval(function () {
      var onPlayer = state.screen === 'player';
      /* TV en vivo full screen can be showing the home preview's own <video>
         (live/channels.js hands it over): that one is what plays, and the
         player's element stays empty and paused. */
      var shown = (liveHandoff && liveHandoff.type === 'preview' && livePreviewVideo) ? livePreviewVideo : playerVideo;
      var controlsUp = onPlayer && (state.infobar || state.episodeBrowserOpen || playSettingViewOpen ||
        state.channelsOpen || state.categoryPickerOpen || dialogPlaySettingsOpen || dialogAddonsOpen || sourcePickerOpen ||
        historyDrawerOpen || !shown || shown.paused);
      body.classList.toggle('is-playing-idle', onPlayer && !controlsUp);
      if (state.screen !== lastScreen) { lastScreen = state.screen; body.setAttribute('data-screen', state.screen); }
      /* The movie player has its own Volver (top left), so no second one. */
      var hide = state.screen === 'welcome' ||
        (state.screen === 'home' && !dialogAddonsOpen && !historyDrawerOpen) ||
        (state.screen === 'player' && state.playerMode === 'vod');
      /* Only when it changes: writing the same value is still an attribute
         change, and restyled the page every 150 ms (seen on a Fire TV). */
      if (button.hidden !== hide) { button.hidden = hide; }
      if (button.disabled) { button.disabled = false; }
    }, 150);
  }

  /* ---- desktop/tooltip.js ---------------------------------------------------- */
  /* desktop/tooltip.js — Descripciones emergentes al pasar el ratón (data-tip / title).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* One tooltip for the whole app, drawn in the app's style instead of the
     native Windows one. Any element with data-tip or title gets it; a title is
     moved to data-tip on hover so the native tooltip does not appear too. */
  var tooltipEl = null;
  var tooltipTarget = null;
  var tooltipTimer = null;

  function installTooltips() {
    if (tooltipEl || !window.OPENTV_DESKTOP || !platformHas('mouse')) { return; }
    tooltipEl = el('div', 'ui-tooltip');
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);

    document.addEventListener('pointerover', function (event) {
      if (event.pointerType && event.pointerType !== 'mouse') { return; }
      var node = event.target instanceof Element ? event.target.closest('[data-tip], [title]') : null;
      if (node && node.hasAttribute('title')) {
        var t = node.getAttribute('title');
        node.removeAttribute('title');
        if (t && !node.getAttribute('data-tip')) { node.setAttribute('data-tip', t); }
      }
      if (node === tooltipTarget) { return; }
      hideTooltip();
      if (!node || !node.getAttribute('data-tip')) { return; }
      tooltipTarget = node;
      tooltipTimer = setTimeout(showTooltip, 380);
    }, true);
    document.addEventListener('pointerout', function (event) {
      if (tooltipTarget && (!event.relatedTarget || !tooltipTarget.contains(event.relatedTarget))) { hideTooltip(); }
    }, true);
    document.addEventListener('pointerdown', hideTooltip, true);
    document.addEventListener('keydown', hideTooltip, true);
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
  }

  function showTooltip() {
    tooltipTimer = null;
    var node = tooltipTarget;
    if (!node || !node.isConnected || !tooltipEl) { return; }
    var text = node.getAttribute('data-tip');
    if (!text) { return; }
    tooltipEl.textContent = text;
    tooltipEl.classList.add('is-visible');
    var r = node.getBoundingClientRect();
    var tw = tooltipEl.offsetWidth;
    var th = tooltipEl.offsetHeight;
    var gap = 8;
    var top = r.bottom + gap;
    /* Controls at the bottom of the player: show the tooltip above them. */
    if (top + th > window.innerHeight - 6) { top = r.top - th - gap; }
    var left = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
    tooltipEl.style.left = Math.round(left) + 'px';
    tooltipEl.style.top = Math.round(Math.max(6, top)) + 'px';
    /* The element can vanish under the mouse (a panel redrawn, another page
       opened) without any pointerout: then the tooltip goes too. */
    if (tooltipWatch) { clearInterval(tooltipWatch); }
    tooltipWatch = setInterval(function () {
      if (!tooltipTarget || !tooltipTarget.isConnected || !isVisible(tooltipTarget)) { hideTooltip(); }
    }, 300);
  }

  var tooltipWatch = null;
  function hideTooltip() {
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
    if (tooltipWatch) { clearInterval(tooltipWatch); tooltipWatch = null; }
    tooltipTarget = null;
    if (tooltipEl) { tooltipEl.classList.remove('is-visible'); }
  }

  /* ---- desktop/hovercard.js -------------------------------------------------- */
  /* desktop/hovercard.js — Tarjeta ampliada al dejar el ratón sobre un póster (como Netflix).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* After a short pause over a poster of the home pages, a bigger card grows
     out of it with wide artwork, quick buttons (play, Mi lista, details),
     rating, year, type and genres. It lives in real pixels on <body>, so it
     can overflow rows and the screen edges are respected. */
  var HOVER_DELAY_MS = 520;
  var hoverCard = null;
  var hoverCardFor = null;
  var hoverTimer = null;
  var hoverHideTimer = null;

  function hoverPosterFrom(target) {
    if (!target || !target.closest) { return null; }
    var poster = target.closest('.poster');
    /* Home rows, and "Recomendaciones" on the details screen. */
    if (!poster || !poster._item || !(poster.closest('#screen-home .home-page.is-current') || poster.closest('#screen-detail .dd-related'))) { return null; }
    return poster;
  }

  function installHoverCards() {
    if (!window.OPENTV_DESKTOP || !platformHas('mouse')) { return; }
    document.addEventListener('mouseover', function (event) {
      if (hoverCard && hoverCard.contains(event.target)) { cancelHoverHide(); return; }
      var poster = hoverPosterFrom(event.target);
      if (!poster) { return; }
      /* Modo ligero: no enlarged card (it costs a lot to draw). */
      if (document.body.classList.contains('is-lite')) { return; }
      if (poster === hoverCardFor && hoverCard && hoverCard.classList.contains('is-open')) { cancelHoverHide(); return; }
      if (hoverTimer) { clearTimeout(hoverTimer); }
      hoverTimer = setTimeout(function () {
        hoverTimer = null;
        if (poster.matches(':hover') && (state.screen === 'home' || state.screen === 'detail')) { openHoverCard(poster); }
      }, HOVER_DELAY_MS);
    }, true);
    document.addEventListener('mouseout', function (event) {
      var to = event.relatedTarget;
      var poster = hoverPosterFrom(event.target);
      if (poster && hoverTimer && !(to && poster.contains(to))) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (!hoverCard || !hoverCard.classList.contains('is-open')) { return; }
      if (to && (hoverCard.contains(to) || (hoverCardFor && hoverCardFor.contains(to)))) { return; }
      if (hoverCard.contains(event.target) || (hoverCardFor && hoverCardFor.contains(event.target))) { scheduleHoverHide(); }
    }, true);
    /* Anything that moves the page or changes the screen closes it. */
    ['wheel', 'keydown', 'scroll'].forEach(function (type) {
      document.addEventListener(type, function (event) {
        if (type === 'scroll' && hoverCard && hoverCard.contains(event.target)) { return; }
        closeHoverCard();
      }, { capture: true, passive: true });
    });
    window.addEventListener('blur', closeHoverCard);
    window.addEventListener('resize', closeHoverCard);
  }

  function scheduleHoverHide() {
    cancelHoverHide();
    hoverHideTimer = setTimeout(closeHoverCard, 120);
  }
  function cancelHoverHide() {
    if (hoverHideTimer) { clearTimeout(hoverHideTimer); hoverHideTimer = null; }
  }

  function closeHoverCard() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    cancelHoverHide();
    if (hoverCard) { hoverCard.classList.remove('is-open'); }
    hoverCardFor = null;
  }

  function hoverButton(cls, icon, tip, run) {
    var b = el('button', 'hc-btn ' + cls);
    b.type = 'button';
    b.innerHTML = icon;
    b.setAttribute('data-tip', tip);
    b.setAttribute('aria-label', tip);
    b.addEventListener('click', function (event) { event.stopPropagation(); run(b); });
    return b;
  }

  function openHoverCard(poster) {
    var item = poster._item;
    if (!hoverCard) {
      hoverCard = el('div', 'hover-card');
      hoverCard.setAttribute('data-no-gesture', '');
      document.body.appendChild(hoverCard);
    }
    clear(hoverCard);
    var art = el('div', 'hc-art');
    var src = item.landscape || item.backdrop || item.poster;
    if (src) {
      var img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.onload = function () { art.classList.add('is-loaded'); };
      img.onerror = function () { img.remove(); art.classList.add('is-generic'); };
      img.src = src;
      art.appendChild(img);
    }
    art.appendChild(el('div', 'hc-art-shade'));
    art.appendChild(el('div', 'hc-art-title', item.title));
    art.addEventListener('click', function () { closeHoverCard(); openDetail(item); });
    hoverCard.appendChild(art);

    var body = el('div', 'hc-body');
    var buttons = el('div', 'hc-buttons');
    buttons.appendChild(hoverButton('is-play', UI_ICONS.play, 'Reproducir', function () { closeHoverCard(); playTitleNow(item); }));
    var inList = inMyList(item);
    buttons.appendChild(hoverButton('is-list' + (inList ? ' is-on' : ''), inList ? UI_ICONS.check : UI_ICONS.mylist,
      inList ? 'Quitar de Mi lista' : 'Añadir a Mi lista', function (b) {
        var on = toggleMyList(item);
        b.classList.toggle('is-on', on);
        b.innerHTML = on ? UI_ICONS.check : UI_ICONS.mylist;
        b.setAttribute('data-tip', on ? 'Quitar de Mi lista' : 'Añadir a Mi lista');
      }));
    var info = hoverButton('is-info', UI_ICONS.info, 'Más información', function () { closeHoverCard(); openDetail(item); });
    buttons.appendChild(info);
    body.appendChild(buttons);
    body.appendChild(el('div', 'hc-meta', itemMetaLine(item)));
    var genres = itemGenres(item, 3);
    if (genres.length) { body.appendChild(el('div', 'hc-genres', genres.join('  •  '))); }
    hoverCard.appendChild(body);

    /* Grow from the poster, wider than it, kept inside the window. */
    var r = poster.getBoundingClientRect();
    var w = Math.max(300, Math.min(420, r.width * 1.55));
    hoverCard.style.width = w + 'px';
    hoverCard.classList.add('is-measuring');
    var h = hoverCard.offsetHeight;
    hoverCard.classList.remove('is-measuring');
    var left = r.left + r.width / 2 - w / 2;
    var top = r.top + r.height / 2 - h / 2;
    var minTop = (document.body.classList.contains('has-titlebar') ? 44 : 8);
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    top = Math.max(minTop, Math.min(window.innerHeight - h - 8, top));
    hoverCard.style.left = Math.round(left) + 'px';
    hoverCard.style.top = Math.round(top) + 'px';
    hoverCard.style.transformOrigin = Math.round(r.left + r.width / 2 - left) + 'px ' + Math.round(r.top + r.height / 2 - top) + 'px';
    hoverCardFor = poster;
    void hoverCard.offsetWidth;
    hoverCard.classList.add('is-open');
  }

  /* ---- desktop/window.js ----------------------------------------------------- */
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
        if (fsBtn) {
          setButtonText(fsBtn, _desktopFullscreen ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa (F)',
            _desktopFullscreen ? UI_ICONS.exitFullscreen : UI_ICONS.fullscreen);
        }
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
      if (event.target && event.target.closest && event.target.closest('[data-no-gesture]')) { return; }
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

  /* ---- player/compat-watchdog.js --------------------------------------------- */
  /* player/compat-watchdog.js — Cambio automático al modo compatible y aviso "¿Problemas con este vídeo?".
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------------
     Compatibility mode, automatic.
     Normal playback (Directo) is used first. When a VOD title fails to
     start, keeps freezing or has no sound, it is restarted once through the
     FFmpeg compatibility route ("Modo fluido" internally), at the same
     position. If it then plays, the title is remembered on this PC. When the
     automatic retry was already used for that title, the player only offers
     it in a small notice instead of switching on its own.
     ------------------------------------------------------------------ */
  var COMPAT_START_MS = 15000;      // no picture after this long
  var COMPAT_STALL_MS = 2500;       // a wait longer than this is a freeze
  var COMPAT_STALLS = 3;            // ...this many freezes...
  var COMPAT_STALL_WINDOW = 60000;  // ...within this window
  var COMPAT_LONG_STALL_MS = 12000; // or one freeze this long
  var compatWatch = null;
  var compatAuto = null;
  var compatTimer = null;
  var compatSuggest = null;
  var compatSuggestTimer = null;
  var COMPAT_AUDIO_SECS = 3;        // seconds of picture with no decoded sound = Dolby audio
  var COMPAT_AUDIO_STORE = 'opentv_compat_audio_v1';

  /* Titles whose only problem was the audio (AC3/EAC3, which Chromium cannot
     decode). For them the relay copies the video untouched and converts only
     the sound to AAC, instead of re-encoding the whole picture. */
  function loadCompatAudioTitles() {
    try { return JSON.parse(localStorage.getItem(COMPAT_AUDIO_STORE) || '{}') || {}; } catch (eLoad) { return {}; }
  }
  function saveCompatAudioTitle(key) {
    if (!key) { return; }
    var all = loadCompatAudioTitles();
    all[key] = Date.now();
    var keys = Object.keys(all);
    if (keys.length > 400) {
      keys.sort(function (a, b) { return all[a] - all[b]; });
      for (var i = 0; i < keys.length - 400; i++) { delete all[keys[i]]; }
    }
    try { localStorage.setItem(COMPAT_AUDIO_STORE, JSON.stringify(all)); } catch (eSave) { /* storage full or off */ }
  }

  /* Only the PC app: its Chromium decodes H.264 and HEVC itself, and the TV
     players keep the proven full re-encode. */
  function compatVideoCopy(item) {
    if (platformName() !== 'electron' || !item) { return false; }
    var key = compatEpisodeKey(item);
    var audioOnly = (compatAuto && compatAuto.item === item && compatAuto.reason === 'audio') ||
      (key && loadCompatAudioTitles().hasOwnProperty(key));
    if (!audioOnly) { return false; }
    if (/hevc|h\.?265/i.test(item.streamCodec || '')) {
      try { return !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'); } catch (eType) { return false; }
    }
    return true;
  }

  function tryCompatFallback(reason) {
    if (state.playerMode !== 'vod' || state.streamMode !== 'normal' || !state.playerItem) { return false; }
    var item = state.playerItem;
    var key = compatEpisodeKey(item);
    if (autoSmoothFallbackKey === key) {
      if (window.OPENTV_DESKTOP) { showCompatSuggestion(item); }
      return false;
    }
    autoSmoothFallbackKey = key;
    compatAuto = { item: item, key: key, reason: reason };
    if (compatWatch) { compatWatch.item = null; }
    state.streamMode = 'smooth';
    setPlayerStatus(window.OPENTV_DESKTOP ? 'Ajustando la reproducción…' : 'Reintentando película en modo compatible…');
    setTimeout(function () {
      if (state.playerMode === 'vod' && state.playerItem === item && state.streamMode === 'smooth') {
        restartCurrentPlayback();
      }
    }, 0);
    return true;
  }

  function compatWatchBegin() {
    if (!window.OPENTV_DESKTOP || !playerVideo) { return; }
    hideCompatSuggestion();
    compatWatch = { item: state.playerItem, began: Date.now(), played: false, stalls: [],
                    waitingSince: 0, playSecs: 0, audioChecked: false };
    if (playerVideo) { playerVideo._opentvNoAudio = false; }
    if (compatTimer) { return; }
    playerVideo.addEventListener('waiting', function () {
      if (compatWatch && compatWatch.played && !compatWatch.waitingSince) { compatWatch.waitingSince = Date.now(); }
    });
    playerVideo.addEventListener('playing', function () {
      var w = compatWatch;
      if (w) {
        if (w.waitingSince && Date.now() - w.waitingSince > COMPAT_STALL_MS) { w.stalls.push(Date.now()); }
        w.waitingSince = 0;
        w.played = true;
      }
      if (compatAuto && state.streamMode === 'smooth' && state.playerItem === compatAuto.item) {
        saveCompatTitle(compatAuto.key, true);
        if (compatAuto.reason === 'audio') { saveCompatAudioTitle(compatAuto.key); }
        compatAuto = null;
      }
    });
    playerVideo.addEventListener('seeking', function () {
      /* A wait caused by the viewer seeking is not a freeze. */
      if (compatWatch) { compatWatch.waitingSince = 0; }
    });
    document.addEventListener('opentv:hls-fatal', function () { tryCompatFallback('hls'); });
    compatTimer = setInterval(compatWatchTick, 1000);
  }

  function compatWatchTick() {
    var w = compatWatch;
    if (compatSuggest && state.screen !== 'player' && state.screen !== 'detail') { hideCompatSuggestion(); }
    if (!w || !w.item || !playerVideo || state.playerMode !== 'vod' || state.playerItem !== w.item ||
        state.streamMode !== 'normal') { return; }
    var now = Date.now();
    /* Torrents (Stremio mode): slow starts and pauses are the download. */
    var torrent = stremioPlayingTorrent();
    if (!w.played) {
      if (playerVideo.readyState >= 3) { w.played = true; return; }
      if (now - w.began > COMPAT_START_MS && !torrent) { w.item = null; tryCompatFallback('start'); }
      return;
    }
    if (torrent) { w.waitingSince = 0; w.stalls = []; }
    if (w.waitingSince && now - w.waitingSince > COMPAT_LONG_STALL_MS) {
      w.waitingSince = 0; w.stalls = [];
      tryCompatFallback('stall');
      return;
    }
    while (w.stalls.length && now - w.stalls[0] > COMPAT_STALL_WINDOW) { w.stalls.shift(); }
    if (w.stalls.length >= COMPAT_STALLS) {
      w.stalls = [];
      tryCompatFallback('stalls');
      return;
    }
    if (!w.audioChecked && !playerVideo.paused && playerVideo.readyState >= 3) {
      w.playSecs++;
      if (w.playSecs >= COMPAT_AUDIO_SECS) {
        w.audioChecked = true;
        var audioBytes = playerVideo.webkitAudioDecodedByteCount;
        var videoBytes = playerVideo.webkitVideoDecodedByteCount;
        /* A few seconds of picture are enough: supported audio is decoded
           alongside the first frames, so zero bytes here means Dolby. */
        var silent = playerVideo._opentvNoAudio === true ||
          (typeof audioBytes === 'number' && audioBytes === 0 && videoBytes > 300000);
        if (silent) { tryCompatFallback('audio'); }
      }
    }
  }

  function showCompatSuggestion(item) {
    if (!window.OPENTV_DESKTOP || (state.screen !== 'player' && state.screen !== 'detail')) { return; }
    if (!compatSuggest) {
      compatSuggest = el('div', 'compat-suggest');
      compatSuggest.setAttribute('role', 'status');
      compatSuggest.setAttribute('aria-live', 'polite');
      var icon = el('div', 'cs-icon');
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>';
      var text = el('div', 'cs-text');
      text.appendChild(el('b', null, '¿Problemas con este vídeo?'));
      text.appendChild(el('span', null, 'Si se corta, no carga o no tiene sonido, prueba el modo compatible.'));
      var go = el('button', 'cs-go desktop-native-control', 'Probar modo compatible');
      go.type = 'button';
      var close = el('button', 'cs-close desktop-native-control');
      close.type = 'button';
      close.setAttribute('aria-label', 'Cerrar aviso');
      close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      go.addEventListener('click', function () {
        var target = compatSuggest._item;
        hideCompatSuggestion();
        if (target && state.playerItem === target) {
          setSmoothMode(target, true);
          renderPlaySettingPlayerOptions();
          restartCurrentPlayback();
        }
      });
      close.addEventListener('click', hideCompatSuggestion);
      compatSuggest.appendChild(icon);
      compatSuggest.appendChild(text);
      compatSuggest.appendChild(go);
      compatSuggest.appendChild(close);
      document.body.appendChild(compatSuggest);
    }
    compatSuggest._item = item;
    compatSuggest.classList.add('is-visible');
    if (compatSuggestTimer) { clearTimeout(compatSuggestTimer); }
    compatSuggestTimer = setTimeout(hideCompatSuggestion, 20000);
  }

  function hideCompatSuggestion() {
    if (compatSuggestTimer) { clearTimeout(compatSuggestTimer); compatSuggestTimer = null; }
    if (compatSuggest) { compatSuggest.classList.remove('is-visible'); }
  }

  /* ---- desktop/gestures.js --------------------------------------------------- */
  /* desktop/gestures.js — Gestos del ratón sobre el vídeo y controles VOD de escritorio.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  function installVideoGestures() {
    installPanelDismiss();
    if (!playerStage || playerStage._gestures) { return; }
    playerStage._gestures = true;
    installMiniControls();

    var indicator = el('div', 'hold-seek');
    indicator.hidden = true;
    playerStage.appendChild(indicator);

    function onVideoArea(target) {
      return target === playerStage || target === playerVideo ||
        (target && target.classList && (target.classList.contains('player-frame') ||
          target.classList.contains('player-status') || target.classList.contains('player-osd-icon')));
    }

    bindClickGestures(playerStage, function () {
      if (playerStage._activate) { playerStage._activate(); }
    }, function () {
      if (state.screen === 'detail') {
        /* From the detail preview: open the player straight in full screen. */
        if (playerStage._activate) { playerStage._activate(); }
        setWindowFullscreen(true);
        return;
      }
      setWindowFullscreen(!isWindowFullscreen());
    });

    var hold = null;
    function canHoldSeek() {
      return state.screen === 'player' && state.playerMode === 'vod' && playerVideo &&
        !state.episodeBrowserOpen && !playSettingViewOpen &&
        !!(playerVideo.currentSrc || playerVideo.getAttribute('src'));
    }
    /* +10 s per tick for the first 3 s, then faster: about 1:40 after 3 s,
       5 min after 6 s, then +1 min per tick. */
    function holdStep(elapsed) {
      if (elapsed < 3000) { return 10; }
      if (elapsed < 6000) { return 20; }
      return 60;
    }
    function renderHold() {
      var duration = vodPlaybackDuration();
      var arrow = hold.dir > 0 ? '»' : '«';
      var text = arrow + ' ' + (hold.dir > 0 ? '+' : '−') + formatSeekAmount(hold.total);
      if (duration) {
        var target = Math.max(0, Math.min(duration - 1, hold.base + hold.dir * hold.total));
        text += '\n' + formatTime(target) + ' / ' + formatTime(duration);
        if (vodScrubbing) { vodScrubTime = target; updateVodProgress(target, duration); }
      }
      indicator.textContent = text;
      indicator.className = 'hold-seek ' + (hold.dir > 0 ? 'is-right' : 'is-left');
      indicator.hidden = false;
    }
    function startHold() {
      hold.active = true;
      hold.base = vodPlaybackPosition();
      hold.total = 10;
      hold.startedAt = Date.now();
      if (vodPlaybackDuration()) { enterVodScrub(); }
      renderHold();
      hold.ticker = setInterval(function () {
        hold.total += holdStep(Date.now() - hold.startedAt);
        var duration = vodPlaybackDuration();
        if (duration) {
          var room = hold.dir > 0 ? (duration - 1 - hold.base) : hold.base;
          hold.total = Math.max(0, Math.min(hold.total, room));
        }
        renderHold();
      }, 300);
    }
    function endHold(apply) {
      if (!hold) { return; }
      var h = hold;
      hold = null;
      clearTimeout(h.timer);
      if (!h.active) { return; }
      clearInterval(h.ticker);
      /* The click that follows this release must not pause the video. It is
         cleared by the click handler, or after a moment if no click comes. */
      playerStage._suppressClick = true;
      setTimeout(function () { playerStage._suppressClick = false; }, 500);
      setTimeout(function () { indicator.hidden = true; }, 500);
      if (vodScrubbing) {
        /* vodScrubTime already holds the target shown by the counter. */
        leaveVodScrub(apply);
      } else if (apply && h.total) {
        playerSeek(h.dir * h.total);
      }
    }

    playerStage.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !onVideoArea(event.target) || !canHoldSeek()) { return; }
      var rect = playerStage.getBoundingClientRect();
      var x = (event.clientX - rect.left) / rect.width;
      if (x > 1 / 3 && x < 2 / 3) { return; }
      endHold(false);
      hold = { dir: x <= 1 / 3 ? -1 : 1, active: false };
      hold.timer = setTimeout(startHold, HOLD_START_MS);
    });
    playerStage.addEventListener('pointerup', function () { endHold(true); });
    playerStage.addEventListener('pointerleave', function () { endHold(true); });
    playerStage.addEventListener('pointercancel', function () { endHold(false); });
    window.addEventListener('blur', function () { endHold(true); });
  }

  /* Home TV preview: click opens the TV player, double click opens it in
     Windows full screen. */
  function installLivePreviewGestures(node) {
    if (!node || node._gestures) { return; }
    node._gestures = true;
    bindClickGestures(node, function () { openPlayer('live'); }, function () {
      openPlayer('live');
      setWindowFullscreen(true);
    });
  }

  function bindDesktopPlayback() {
    installVideoGestures();
    if (!vodSeekbar || vodSeekbar._desktopBound) return;
    vodSeekbar._desktopBound = true;
    vodSeekbar.setAttribute('role', 'slider');
    vodSeekbar.setAttribute('aria-label', 'Posición de reproducción');
    vodSeekbar.setAttribute('aria-valuemin', '0');
    vodSeekbar.setAttribute('tabindex', '0');
    var durationNote = el('div', 'vod-duration-note');
    durationNote.id = 'vod-duration-note'; durationNote.hidden = true;
    document.querySelector('.vod-infobar-content').appendChild(durationNote);
    var pointer = null;
    function preview(event) {
      var rect = vodSeekbar.getBoundingClientRect();
      var duration = vodPlaybackDuration();
      var fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      vodScrubTime = Math.max(0, Math.min(duration - 1, fraction * duration));
      updateVodProgress(vodScrubTime, duration);
    }
    vodSeekbar.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || state.screen !== 'player' || state.playerMode !== 'vod' || !isVisible(vodSeekbar)) return;
      event.preventDefault(); event.stopPropagation();
      if (!vodPlaybackDuration()) {
        updateVodProgress(vodPlaybackPosition(), 0);
        return;
      }
      pointer = event.pointerId;
      enterVodScrub();
      vodSeekbar.setPointerCapture(pointer);
      preview(event);
    });
    vodSeekbar.addEventListener('pointermove', function (event) {
      if (event.pointerId === pointer) { event.preventDefault(); preview(event); }
    });
    vodSeekbar.addEventListener('pointerup', function (event) {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); event.stopPropagation();
      preview(event);
      var id = pointer; pointer = null;
      if (vodSeekbar.hasPointerCapture(id)) vodSeekbar.releasePointerCapture(id);
      leaveVodScrub(true);
    });
    function cancel() { if (pointer !== null) { pointer = null; leaveVodScrub(false); } }
    vodSeekbar._cancelDesktopScrub = cancel;
    vodSeekbar.addEventListener('pointercancel', cancel);
    vodSeekbar.addEventListener('lostpointercapture', cancel);
    vodSeekbar.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); });
    vodSeekbar.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation();
        if (!vodScrubbing) enterVodScrub();
        vodScrubTime = Math.max(0, Math.min(vodPlaybackDuration() - 1, vodScrubTime + (event.key === 'ArrowRight' ? 10 : -10)));
        updateVodProgress(vodScrubTime, vodPlaybackDuration());
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); event.stopPropagation();
        if (!vodScrubbing) enterVodScrub();
        vodScrubTime = event.key === 'Home' ? 0 : Math.max(0, vodPlaybackDuration() - 2);
        updateVodProgress(vodScrubTime, vodPlaybackDuration());
      }
    });
    var tips = document.querySelector('.vod-infobar-tips');
    clear(tips);
    /* Volver and the title at the top left; -10 s, play, +10 s in the
       middle; the volume on the left; the rest on the right. */
    var defs = [
      { id: 'vod-back', group: 'top', icon: UI_ICONS.back, tip: 'Volver (Esc)', run: desktopBack },
      { id: 'vod-rewind', group: 'center', icon: UI_ICONS.rewind, tip: 'Retroceder 10 s (←)', run: function () { playerSeek(-10); } },
      { id: 'vod-toggle', group: 'center', icon: UI_ICONS.pause, tip: 'Pausa (Espacio)', run: togglePlayerPlayPause },
      { id: 'vod-forward', group: 'center', icon: UI_ICONS.forward, tip: 'Adelantar 10 s (→)', run: function () { playerSeek(10); } },
      { id: 'vod-next', group: 'right', icon: UI_ICONS.next, tip: 'Siguiente episodio', run: function () { hideNextEpisodePrompt(); advanceToNextEpisode(); } },
      { id: 'vod-episodes', group: 'right', icon: UI_ICONS.episodes, tip: 'Episodios', run: openEpisodeBrowser },
      { id: 'vod-speed', group: 'right', icon: UI_ICONS.speed, tip: 'Velocidad', run: function () { toggleSpeedMenu($('vod-speed')); } },
      { id: 'vod-settings', group: 'right', icon: UI_ICONS.settings, tip: 'Audio, subtítulos y más (↓)', run: openPlaySettingView }
    ];
    if (platformHas('pip') && document.pictureInPictureEnabled) {
      defs.push({ id: 'vod-pip', group: 'right', icon: UI_ICONS.pip, tip: 'Ventana flotante (Ctrl+P)', run: togglePictureInPicture });
    }
    defs.push({ id: 'vod-quality', group: 'right', icon: UI_ICONS.quality, tip: 'Calidad', run: function () { toggleQualityMenu($('vod-quality')); } });
    if (platformHas('window')) {
      defs.push({ id: 'vod-fullscreen', group: 'right', icon: UI_ICONS.fullscreen, tip: 'Pantalla completa (F)', run: function () { window.desktop.fullscreen(); } });
    }
    /* Three zones: Volver on the left, seek/play in the middle, the rest on the right. */
    var groups = { left: el('div', 'vt-group vt-left'), center: el('div', 'vt-group vt-center'), right: el('div', 'vt-group vt-right'), top: el('div', 'vod-topbar') };
    tips.appendChild(groups.left);
    tips.appendChild(groups.center);
    tips.appendChild(groups.right);
    /* Volver + title live next to the bar (not inside it: the bar animates
       with a transform, which moved them to the bottom under the video). */
    var vodBar = $('player-vod-infobar');
    vodBar.parentNode.insertBefore(groups.top, vodBar.nextSibling);
    var titleNode = $('vod-infobar-title');
    /* The title sits next to Volver at the top; the controls stay centred. */
    if (titleNode) { groups.top.appendChild(titleNode); }
    for (var i = 0; i < defs.length; i++) {
      var b = el('button', 'vod-tip focusable');
      b.type = 'button'; b.id = defs[i].id;
      iconizeButton(b, defs[i].icon, defs[i].tip);
      b._activate = defs[i].run;
      groups[defs[i].group].appendChild(b);
    }
    /* TVs: the remote cannot reach this toolbar (left/right seek, down opens
       the settings, Back leaves), so only the play state in the middle shows
       (desktop/tw/input.css, "Teles"), with this hint instead of the buttons. */
    if (platformIsTv()) {
      groups.right.parentNode.appendChild(el('div', 'vt-tv-hint', '↓  Audio, subtítulos y más'));
    }
    function updateButtons() {
      var toggle = $('vod-toggle');
      var showPlay = playerVideo.paused;
      if (toggle._showsPlay !== showPlay) {
        toggle._showsPlay = showPlay;
        setButtonText(toggle, showPlay ? 'Reproducir (Espacio)' : 'Pausa (Espacio)', showPlay ? UI_ICONS.play : UI_ICONS.pause);
      }
      $('vod-episodes').hidden = !isSeriesItem(state.playerItem);
      $('vod-next').hidden = !(isSeriesItem(state.playerItem) && upcomingEpisode(state.playerItem));
      updateQualityButton();
      var canSkip = state.playerMode === 'vod' && !!(playerVideo.currentSrc || playerVideo.getAttribute('src'));
      $('vod-forward').disabled = !canSkip;
      $('vod-rewind').disabled = !canSkip;
      if ($('vod-pip')) {
        var inPip = document.pictureInPictureElement === playerVideo;
        setButtonText($('vod-pip'), inPip ? 'Cerrar ventana flotante (Ctrl+P)' : 'Ventana flotante (Ctrl+P)');
        $('vod-pip').classList.toggle('is-selected', inPip);
        $('vod-pip').disabled = !canSkip && !inPip;
      }
    }
    playerVideo.addEventListener('enterpictureinpicture', updateButtons);
    playerVideo.addEventListener('leavepictureinpicture', updateButtons);
    /* The floating window shows only the video: the page's subtitles would
       stay behind on the big window, so hide them meanwhile. */
    playerVideo.addEventListener('enterpictureinpicture', function () { document.body.classList.add('is-pip-video'); });
    playerVideo.addEventListener('leavepictureinpicture', function () { document.body.classList.remove('is-pip-video'); });
    playerVideo.addEventListener('play', updateButtons);
    playerVideo.addEventListener('pause', updateButtons);
    playerVideo.addEventListener('loadedmetadata', updateButtons);
    playerVideo.addEventListener('durationchange', updateButtons);
    document.addEventListener('opentv:duration', updateButtons);
    /* A new title in the player: right away, not when its video starts (a
       torrent can take a while), or a movie shows the series buttons. */
    document.addEventListener('opentv:player-item', updateButtons);
    document.addEventListener('opentv:timeline', function () {
      updateButtons();
      if (state.playerMode === 'vod') updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
    });
    var screen = $('screen-player');
    screen.addEventListener('pointermove', function () {
      if (state.screen === 'player' && !playSettingViewOpen && !dialogPlaySettingsOpen &&
          !state.episodeBrowserOpen && !state.categoryPickerOpen && !state.channelsOpen && !vodScrubbing) showInfobar();
    });
    installPlayerVolume();
  }

  /* ---- desktop/mini-controls.js ---------------------------------------------- */
  /* desktop/mini-controls.js — Controles de la vista previa de la ficha (pausa, tiempo, barra y ampliar).
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* The detail page plays a preview in a small frame. On hover it shows a
     compact control bar: play/pause, current time / duration, a seek bar and
     a button to open the full player. Clicks on the bar never open the
     player by accident (data-no-gesture, see bindClickGestures). */
  var miniControls = null;

  function miniTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function installMiniControls() {
    if (!window.OPENTV_DESKTOP || !playerStage || !playerVideo || miniControls) { return; }
    miniControls = el('div', 'mini-controls');
    miniControls.setAttribute('data-no-gesture', '');

    var play = el('button', 'mc-btn mc-play');
    play.type = 'button';
    iconizeButton(play, UI_ICONS.pause, 'Pausa');
    var time = el('div', 'mc-time', '0:00');
    var bar = el('div', 'mc-bar');
    var fill = el('i', 'mc-fill');
    bar.appendChild(fill);
    var expand = el('button', 'mc-btn mc-expand');
    expand.type = 'button';
    iconizeButton(expand, UI_ICONS.expand, 'Ver en grande');

    miniControls.appendChild(play);
    miniControls.appendChild(time);
    miniControls.appendChild(bar);
    miniControls.appendChild(expand);
    playerStage.appendChild(miniControls);

    function stop(event) { event.preventDefault(); event.stopPropagation(); }
    miniControls.addEventListener('click', stop);
    miniControls.addEventListener('dblclick', stop);
    miniControls.addEventListener('pointerdown', function (event) { event.stopPropagation(); });

    play.addEventListener('click', function (event) {
      stop(event);
      togglePlayerPlayPause();
      update();
    });
    expand.addEventListener('click', function (event) {
      stop(event);
      if (playerStage._activate) { playerStage._activate(); }
    });
    bar.addEventListener('click', function (event) {
      stop(event);
      var duration = vodPlaybackDuration();
      if (!duration) { return; }
      var r = bar.getBoundingClientRect();
      var fraction = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width));
      enterVodScrub();
      vodScrubTime = Math.max(0, Math.min(duration - 1, fraction * duration));
      leaveVodScrub(true);
    });

    var shownPaused = null;
    function update() {
      var scr = $('screen-player');
      if (!scr || !scr.classList.contains('is-mini')) { return; }
      var duration = vodPlaybackDuration();
      var position = vodPlaybackPosition();
      time.textContent = duration ? miniTime(position) + ' / ' + miniTime(duration) : miniTime(position);
      fill.style.width = duration ? Math.min(100, (position / duration) * 100) + '%' : '0';
      bar.classList.toggle('is-disabled', !duration);
      var paused = playerVideo.paused;
      if (paused !== shownPaused) {
        shownPaused = paused;
        setButtonText(play, paused ? 'Reproducir' : 'Pausa', paused ? UI_ICONS.play : UI_ICONS.pause);
      }
    }
    ['timeupdate', 'play', 'pause', 'durationchange', 'loadedmetadata', 'seeked'].forEach(function (type) {
      playerVideo.addEventListener(type, update);
    });
    playerStage.addEventListener('pointerenter', update);
  }

  /* ---- mobile/mobile-app.js -------------------------------------------------- */
  /* mobile/mobile-app.js — Celulares (Android; el mismo diseño servirá para iOS).
     Parte del módulo único de la app (ver ui/js/src/README.md).

     The PC and TV interfaces are drawn on a fixed 1920×1080 canvas, which a
     phone held upright would shrink to a strip. Phones get their own layer
     instead (#m-app, ui/mobile/mobile.css): a vertical, touch layout with the
     menu at the bottom, laid out by the browser (no canvas), reusing the same
     catalogue, trends, history, favourites and profiles. Playing a title
     opens the existing player full screen (the phone turned sideways); when it
     closes, the phone layer comes back. Preview on a PC: open the app with
     ?platform=android in a phone-sized browser window. */

  function isPhone() { return platformName() === 'android' && !platformIsTv(); }

  var mob = {
    root: null, main: null, nav: null, tab: 'inicio', chip: 'todo', screen: 'home',
    stamp: '', detail: null, playPending: 0, rotateTimer: null, searchTimer: null
  };

  var M_TABS = [
    { id: 'inicio', label: 'Inicio', icon: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/>' },
    { id: 'pelicula', label: 'Películas', icon: '<rect x="3" y="3.5" width="18" height="17" rx="2"/><path d="M7.5 3.5v17M16.5 3.5v17M3 12h18"/>' },
    { id: 'serie', label: 'Series', icon: '<rect x="2.5" y="6.5" width="19" height="13" rx="2"/><path d="M8 2.5l4 4 4-4"/>' },
    { id: 'live', label: 'TV en vivo', icon: '<rect x="2.5" y="5" width="19" height="13" rx="2"/><path d="M8 21h8"/>' },
    { id: 'cuenta', label: 'Mi cuenta', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>' }
  ];
  /* Inicio's chips: the sections that do not fit in the bottom menu. */
  var M_CHIPS = [
    { id: 'todo', label: 'Todo', category: 'destacado', trend: 'inicio' },
    { id: 'kids', label: 'Kids', category: 'infantil', trend: 'kids' },
    { id: 'anime', label: 'Anime', category: 'anime', trend: 'anime' },
    { id: 'milista', label: 'Mi lista' }
  ];

  function mSvg(body, size) {
    return '<svg width="' + (size || 24) + '" height="' + (size || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  /* Images at the size they are shown (the app's native resizer on Android). */
  function mImg(url, cssWidth) {
    if (!url) { return ''; }
    if (!nativeImageSizer || !/^https?:\/\//i.test(url)) { return url; }
    var px = Math.round(cssWidth * (window.devicePixelRatio || 1));
    return nativeImageSizer + '?w=' + px + '&u=' + encodeURIComponent(url);
  }

  function mPicture(url, cssWidth, cls) {
    var img = el('img', cls || 'm-img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    if (url) { img.src = mImg(url, cssWidth); }
    img.onerror = function () { img.style.visibility = 'hidden'; };
    return img;
  }

  function mButton(cls, html, label, run) {
    var b = el('button', cls);
    b.type = 'button';
    if (html) { b.innerHTML = html; }
    if (label) { b.setAttribute('aria-label', label); }
    b.addEventListener('click', function (event) { event.preventDefault(); run(event); });
    return b;
  }

  /* -------------------------------------------------------------- shell */
  function installMobileApp() {
    if (!isPhone() || mob.root) { return; }
    document.body.classList.add('is-phone');
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'mobile/mobile.css';
    document.head.appendChild(css);

    mob.root = el('div', 'm-app');
    mob.root.id = 'm-app';
    mob.main = el('main', 'm-main');
    mob.root.appendChild(mob.main);
    mob.nav = el('nav', 'm-nav');
    mob.nav.setAttribute('aria-label', 'Menú principal');
    /* A kids profile only sees Kids (no TV, no adult sections), as on the PC. */
    if (activeProfile().kids) {
      M_TABS = M_TABS.filter(function (t) { return t.id === 'inicio' || t.id === 'cuenta'; });
      M_CHIPS = M_CHIPS.filter(function (c) { return c.id === 'kids' || c.id === 'milista'; });
      mob.chip = 'kids';
    }
    /* Several profiles and none chosen yet: "¿Quién está viendo?" first. */
    if (profilesData.list.length > 1 && !profileChosenThisSession) { mob.screen = 'picker'; }
    M_TABS.forEach(function (t) {
      var b = mButton('m-tab', mSvg(t.icon) + '<span>' + t.label + '</span>', null, function () { mobileGoTab(t.id); });
      b._tab = t.id;
      mob.nav.appendChild(b);
    });
    mob.root.appendChild(mob.nav);
    document.body.appendChild(mob.root);
    renderMobile();
    setInterval(mobileSync, 1000);
  }

  /* Redraw when the catalogue, the trends, the history or the favourites
     change, and hide the phone layer while the player is on screen. */
  function mobileSync() {
    var playing = state.screen === 'player';
    document.body.classList.toggle('m-playing', playing);
    if (playing) { return; }
    unlockMobileRotation();
    var stamp = [VOD.length, catalogStaleAt, trendingRows.length, (localProfile.history || []).length,
      Object.keys(state.favs || {}).length, CHANNELS.length].join('|');
    if (stamp !== mob.stamp && mob.screen === 'home') { mob.stamp = stamp; renderMobile(true); }
  }

  function mobileGoTab(id) {
    mob.tab = id;
    mob.screen = 'home';
    renderMobile();
    mob.main.scrollTop = 0;
  }

  /* Back (the phone's button or gesture): close what is open in the phone
     layer first. Returns true when it handled it. */
  function mobileBack() {
    if (!mob.root || state.screen === 'player') { return false; }
    if (mob.screen === 'picker') { return false; }
    if (mob.screen !== 'home') { mob.screen = M_PARENT[mob.screen] || 'home'; renderMobile(); return true; }
    var homeChip = M_CHIPS[0].id;
    if (mob.tab !== 'inicio' || mob.chip !== homeChip) { mob.tab = 'inicio'; mob.chip = homeChip; renderMobile(); mob.main.scrollTop = 0; return true; }
    return false;
  }

  function renderMobile(keepScroll) {
    if (!mob.root) { return; }
    var top = keepScroll ? mob.main.scrollTop : 0;
    if (mob.rotateTimer) { clearInterval(mob.rotateTimer); mob.rotateTimer = null; }
    clear(mob.main);
    for (var i = 0; i < mob.nav.children.length; i++) {
      mob.nav.children[i].classList.toggle('is-on', mob.nav.children[i]._tab === mob.tab);
    }
    mob.root.classList.toggle('is-sub', mob.screen !== 'home');
    if (mob.screen === 'detail' && mob.detail) { renderMobileDetail(mob.detail); }
    else if (mob.screen === 'search') { renderMobileSearch(); }
    else if (M_SCREENS[mob.screen]) { M_SCREENS[mob.screen](); }
    else if (mob.tab === 'live') { renderMobileLive(); }
    else if (mob.tab === 'cuenta') { renderMobileAccount(); }
    else { renderMobileFeed(); }
    if (keepScroll) { mob.main.scrollTop = top; }
  }

  function mobileHeader(title) {
    var h = el('header', 'm-head');
    if (title) {
      h.appendChild(el('h1', 'm-h1', title));
    } else {
      var brand = el('div', 'm-brand');
      brand.innerHTML = '<svg width="26" height="26" viewBox="72 68 368 372" fill="none" stroke="#fff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M196 84 256 144 316 84"/><rect x="92" y="144" width="328" height="232" rx="44"/><path d="M231 224v72l62-36z"/><path d="M188 424h136"/></svg><span>OpenTV</span>';
      h.appendChild(brand);
    }
    /* (No search on a kids profile, as on the PC.) */
    if (!activeProfile().kids) {
      h.appendChild(mButton('m-round', mSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 20), 'Buscar', function () {
        mob.screen = 'search';
        renderMobile();
      }));
    }
    var me = mButton('m-round m-avatar', avatarSvg(activeProfile().avatar || 0), 'Mi cuenta', function () { mobileGoTab('cuenta'); });
    h.appendChild(me);
    return h;
  }

  /* ---------------------------------------------------------- the feed */
  function renderMobileFeed() {
    var chip = M_CHIPS[0];
    if (mob.tab === 'inicio') {
      for (var c = 0; c < M_CHIPS.length; c++) { if (M_CHIPS[c].id === mob.chip) { chip = M_CHIPS[c]; } }
    }
    var category = mob.tab === 'pelicula' ? 'pelicula' : mob.tab === 'serie' ? 'serie' : chip.category;
    var trendKey = mob.tab === 'pelicula' ? 'movie' : mob.tab === 'serie' ? 'series' : chip.trend;
    mob.main.appendChild(mobileHeader(mob.tab === 'pelicula' ? 'Películas' : mob.tab === 'serie' ? 'Series' : null));

    if (mob.tab === 'inicio') {
      var chips = el('nav', 'm-chips');
      chips.setAttribute('aria-label', 'Secciones');
      M_CHIPS.forEach(function (ch) {
        var b = mButton('m-chip' + (ch.id === mob.chip ? ' is-on' : ''), null, null, function () {
          mob.chip = ch.id;
          renderMobile();
          mob.main.scrollTop = 0;
        });
        b.textContent = ch.label;
        chips.appendChild(b);
      });
      mob.main.appendChild(chips);
    }

    if (chip.id === 'milista' && mob.tab === 'inicio') { renderMobileMyList(); return; }

    var all = allVodFor(category) || [];
    if (!all.length) {
      mob.main.appendChild(VOD.length ? el('p', 'm-empty', 'No hay títulos en esta sección todavía.')
        : makeLoader('Cargando el catálogo…', 'is-page'));
      return;
    }
    /* Top of the section: this week's TMDB trends that the catalogue has, then
       the portal's titles (the same list the PC hero and the TV cards use). */
    var trends = trendKey ? sectionTrendItems(trendKey) : [];
    var seen = {}, pool = [];
    trends.concat(all).forEach(function (v) {
      if (v && !seen[v.id] && (heroArt(v) || v._trendArt) && hasUsableCover(v) && pool.length < 9) { seen[v.id] = true; pool.push(v); }
    });
    /* #1 opens the big card (then it takes turns with #6 onwards); #2–#5 are
       the four small cards, like the TV's top. */
    if (pool.length) { mob.main.appendChild(mobileFeature([pool[0]].concat(pool.slice(5)))); }
    if (pool.length >= 5) { mob.main.appendChild(mobileSmallCards(pool.slice(1, 5))); }

    var filter = mob.tab === 'pelicula' ? 'movie' : mob.tab === 'serie' ? 'series' : '';
    var records = continueRecords(filter);
    if (records.length && chip.id === 'todo') { mob.main.appendChild(mobileContinueRow(records)); }

    var shelves = portalRowsFor(category, 4);
    for (var s = 0; s < shelves.length; s++) {
      var top = /top\s*1[05]|clasificad/i.test(shelves[s].title);
      if (top && mob.tab === 'inicio' && chip.id === 'todo') {
        var series = shelves[s].items.length && isSeriesItem(shelves[s].items[0]);
        mob.main.appendChild(mobileTopRow(series ? 'Top 10 series hoy' : 'Top 10 películas hoy', shelves[s].items.slice(0, 10)));
      } else if (!top) {
        mob.main.appendChild(mobilePosterRow(shelves[s].title, shelves[s].items));
      }
    }
    if (!shelves.length) { mob.main.appendChild(mobileGrid('Catálogo', all.slice(0, 60))); }
  }

  /* The big card: one title at a time, the next one every few seconds. */
  function mobileFeature(items) {
    var box = el('section', 'm-feature');
    box.setAttribute('aria-label', 'Destacado');
    var card = el('a', 'm-feature-card');
    card.href = '#';
    var img = mPicture('', 360, 'm-img');
    var shade = el('div', 'm-shade');
    var text = el('div', 'm-feature-text');
    var kicker = el('span', 'm-kicker');
    var title = el('span', 'm-feature-title');
    var meta = el('span', 'm-meta');
    text.appendChild(kicker); text.appendChild(title); text.appendChild(meta);
    var dots = el('div', 'm-dots');
    for (var d = 0; d < Math.min(items.length, 6); d++) { dots.appendChild(el('i')); }
    card.appendChild(img); card.appendChild(shade); card.appendChild(text); card.appendChild(dots);
    box.appendChild(card);
    var at = 0;
    function show(n) {
      var item = items[n % items.length];
      at = n % items.length;
      img.style.visibility = '';
      img.src = mImg(item._trendArt || heroArt(item) || item.poster, 360);
      kicker.textContent = isSeriesItem(item) ? 'SERIE' : 'PELÍCULA';
      title.textContent = item.title || '';
      meta.textContent = itemMetaLine(item) || '';
      for (var i = 0; i < dots.children.length; i++) { dots.children[i].className = i === at % dots.children.length ? 'is-on' : ''; }
      card._item = item;
    }
    card.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(card._item); });
    show(0);
    if (items.length > 1) {
      mob.rotateTimer = setInterval(function () {
        if (mob.screen !== 'home' || state.screen === 'player' || document.hidden) { return; }
        var next = items[(at + 1) % items.length];
        var pre = new Image();
        pre.onload = function () { show(at + 1); };
        pre.src = mImg(next._trendArt || heroArt(next) || next.poster, 360);
      }, 7000);
    }
    return box;
  }

  function mobileSmallCards(items) {
    var grid = el('section', 'm-small');
    grid.setAttribute('aria-label', 'Más tendencias');
    items.forEach(function (item) {
      var a = el('a', 'm-small-card');
      a.href = '#';
      a.appendChild(mPicture(item._trendArt || heroArt(item) || item.poster, 180));
      a.appendChild(el('div', 'm-shade'));
      a.appendChild(el('span', 'm-small-title', item.title || ''));
      a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
      grid.appendChild(a);
    });
    return grid;
  }

  function mobileRow(title) {
    var sec = el('section', 'm-section');
    sec.appendChild(el('h2', 'm-h2', title));
    var row = el('div', 'm-row');
    sec.appendChild(row);
    sec._row = row;
    return sec;
  }

  function mobilePosterRow(title, items) {
    var sec = mobileRow(title);
    items.slice(0, 30).forEach(function (item) { sec._row.appendChild(mobilePoster(item)); });
    return sec;
  }

  function mobilePoster(item) {
    var a = el('a', 'm-poster');
    a.href = '#';
    a.setAttribute('aria-label', item.title || 'Título');
    a.appendChild(mPicture(item.poster, 112));
    a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
    return a;
  }

  function mobileTopRow(title, items) {
    var sec = mobileRow(title);
    sec._row.classList.add('is-top');
    items.forEach(function (item, n) {
      var a = el('a', 'm-top');
      a.href = '#';
      a.setAttribute('aria-label', (n + 1) + '. ' + (item.title || ''));
      var num = el('span', 'm-top-n', String(n + 1));
      num.setAttribute('aria-hidden', 'true');
      a.appendChild(num);
      a.appendChild(mPicture(item.poster, 100));
      a.addEventListener('click', function (event) { event.preventDefault(); openMobileDetail(item); });
      sec._row.appendChild(a);
    });
    return sec;
  }

  function mobileContinueRow(records) {
    var sec = mobileRow('Seguir viendo');
    records.forEach(function (r) {
      var item = vodForHistoryRecord(r);
      var a = el('a', 'm-continue');
      a.href = '#';
      var frame = el('div', 'm-continue-frame');
      frame.appendChild(mPicture((item && (item.landscape || item.backdrop || item.poster)) || r.poster, 210));
      var pct = r.duration ? Math.min(100, Math.max(2, Math.round(r.position / r.duration * 100))) : 0;
      if (pct) {
        var bar = el('div', 'm-progress');
        var fill = el('i');
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        frame.appendChild(bar);
      }
      a.appendChild(frame);
      a.appendChild(el('span', 'm-continue-title', r.title || (item && item.title) || 'Contenido'));
      a.appendChild(el('span', 'm-continue-sub', continueSubtitle(r)));
      a.addEventListener('click', function (event) {
        event.preventDefault();
        if (mobileRecordBlocked(r)) { return; }
        mobileWillPlay();
        openHistoryRecord(r);
      });
      sec._row.appendChild(a);
    });
    return sec;
  }

  function mobileGrid(title, items) {
    var sec = el('section', 'm-section');
    if (title) { sec.appendChild(el('h2', 'm-h2', title)); }
    var grid = el('div', 'm-grid');
    items.forEach(function (item) { grid.appendChild(mobilePoster(item)); });
    sec.appendChild(grid);
    return sec;
  }

  /* Mi lista: Historial (a medias, with its progress) · Mi lista (para ver
     después) · Mis favoritos, like the other layouts (screens/history.js). */
  var mobLibraryTab = 'history';
  function renderMobileMyList() {
    var seg = el('div', 'm-seg m-library-tabs');
    LIBRARY_TABS.forEach(function (t) {
      var b = mButton('m-seg-btn' + (mobLibraryTab === t.id ? ' is-on' : ''), null, null, function () {
        mobLibraryTab = t.id;
        renderMobile(true);
      });
      b.textContent = t.label;
      b.setAttribute('aria-pressed', mobLibraryTab === t.id ? 'true' : 'false');
      seg.appendChild(b);
    });
    var wrap = el('div', 'm-pad');
    wrap.appendChild(seg);
    mob.main.appendChild(wrap);
    var records = libraryRecords(mobLibraryTab);
    if (!records.length) { mob.main.appendChild(el('p', 'm-empty', LIBRARY_EMPTY[mobLibraryTab])); return; }
    var sec = el('section', 'm-section');
    var grid = el('div', 'm-grid');
    records.slice(0, 90).forEach(function (r) {
      var item = libraryItem(r);
      if (!item) { return; }
      var a = mobilePoster(item);
      if (mobLibraryTab === 'history') {
        var pct = historyRecordLine(r).pct;
        var bar = el('div', 'm-progress');
        var fill = el('i');
        fill.style.width = Math.max(2, pct) + '%';
        bar.appendChild(fill);
        a.appendChild(bar);
      }
      grid.appendChild(a);
    });
    sec.appendChild(grid);
    mob.main.appendChild(sec);
  }

  /* ------------------------------------------------------- details */
  function openMobileDetail(item) {
    if (!item) { return; }
    mob.detail = item;
    mob.screen = 'detail';
    renderMobile();
    loadVodDetail(item, function (loaded) {
      if (loaded && mob.screen === 'detail' && mob.detail === item) { renderMobile(); }
    });
  }

  function renderMobileDetail(item) {
    var page = el('article', 'm-detail');
    var hero = el('div', 'm-detail-hero');
    hero.appendChild(mPicture(item._trendArt || heroArt(item) || item.poster, 390));
    hero.appendChild(el('div', 'm-detail-shade'));
    hero.appendChild(mButton('m-round m-back', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
    page.appendChild(hero);

    var body = el('div', 'm-detail-body');
    body.appendChild(el('h1', 'm-detail-title', item.title || ''));
    var meta = itemMetaLine(item);
    if (meta) { body.appendChild(el('div', 'm-meta', meta)); }
    var genres = itemGenres(item, 3);
    if (genres.length) {
      var g = el('div', 'm-tags');
      genres.forEach(function (name) { g.appendChild(el('span', 'm-tag', name)); });
      body.appendChild(g);
    }

    var rec = historyRecordFor(item);
    var resume = rec && (rec.position || 0) > 5 && !(rec.duration && rec.position / rec.duration > 0.95);
    var play = mButton('m-play', '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l11-6.8a.8.8 0 0 0 0-1.4l-11-6.8a.8.8 0 0 0-1.2.7z"/></svg>' +
      '<span>' + (resume ? 'Reanudar' : 'Reproducir') + '</span>', null, function () {
      if (resume) {
        if (mobileCannotPlay(item, null)) { return; }
        mobileWillPlay();
        openHistoryRecord(rec);
      } else { mobilePlay(item, null); }
    });
    body.appendChild(play);
    if (resume) {
      body.appendChild(mButton('m-play is-secondary', mSvg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>', 18) +
        '<span>Ver desde el principio</span>', null, function () { mobileStartOver(item); }));
    }

    /* Two icon-only toggles: Favorito and Mi lista (always resumes where it was left). */
    var actions = el('div', 'm-actions is-icons');
    var fav = !!state.favs[String(item.id)];
    var listed = inMyList(item);
    var favBtn = mButton('m-action is-icon' + (fav ? ' is-on' : ''),
      mSvg('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z"' + (fav ? ' fill="currentColor"' : '') + '/>'),
      fav ? 'Quitar de favoritos' : 'Añadir a favoritos', function () {
        toggleFavorite(item);
        renderMobile(true);
      });
    var listBtn = mButton('m-action is-icon' + (listed ? ' is-on' : ''),
      mSvg('<path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"' + (listed ? ' fill="currentColor"' : '') + '/>'),
      listed ? 'Quitar de Mi lista' : 'Añadir a Mi lista', function () {
        toggleMyList(item);
        renderMobile(true);
      });
    actions.appendChild(favBtn);
    actions.appendChild(listBtn);
    body.appendChild(actions);

    var syn = String(item.synopsis || '');
    if (syn && !/^sin sinopsis/i.test(syn)) {
      var p = el('p', 'm-synopsis is-short', syn);
      p.addEventListener('click', function () { p.classList.toggle('is-short'); });
      body.appendChild(p);
    }
    page.appendChild(body);

    if (isSeriesItem(item)) { page.appendChild(mobileEpisodes(item)); }
    var related = allVodFor(norm(item.category || '').split(',')[0] || 'destacado').filter(function (v) { return v.id !== item.id; }).slice(0, 18);
    if (related.length) { page.appendChild(mobilePosterRow('Recomendaciones', related)); }
    mob.main.appendChild(page);
  }

  function mobileEpisodes(item) {
    var sec = el('section', 'm-section m-episodes');
    var head = el('div', 'm-ep-head');
    head.appendChild(el('h2', 'm-h2', 'Episodios'));
    var seasons = item.seasons || [];
    if (seasons.length > 1) {
      var select = document.createElement('select');
      select.className = 'm-select';
      select.setAttribute('aria-label', 'Temporada');
      seasons.forEach(function (s, n) {
        var o = document.createElement('option');
        o.value = String(n);
        o.textContent = s.name || ('Temporada ' + (s.number || n + 1));
        if (n === (state.detailSeason || 0)) { o.selected = true; }
        select.appendChild(o);
      });
      select.addEventListener('change', function () {
        var n = parseInt(select.value, 10) || 0;
        var season = seasons[n];
        state.detailSeason = n;
        if (season._episodes && season._episodes.length) {
          item.episodes = season._episodes; item.seasonId = season.id; renderMobile(true); return;
        }
        portalServiceCall('detail', { contentId: season.id }, function (err, payload) {
          if (!err && payload && payload.returnValue !== false) {
            season._episodes = payload.episodes || [];
            item.episodes = season._episodes;
            item.seasonId = season.id;
          }
          if (mob.detail === item) { renderMobile(true); }
        });
      });
      head.appendChild(select);
    }
    sec.appendChild(head);
    var eps = item.episodes || [];
    if (!eps.length) { sec.appendChild(el('p', 'm-empty', item._detailsLoaded ? 'Sin episodios disponibles.' : 'Cargando episodios…')); }
    eps.forEach(function (ep, n) {
      var a = el('a', 'm-episode');
      a.href = '#';
      var thumb = el('div', 'm-ep-thumb');
      thumb.appendChild(mPicture(ep.poster || ep.image || item.landscape || item.backdrop || item.poster, 132));
      a.appendChild(thumb);
      var t = el('div', 'm-ep-text');
      /* "Supergatinhos Temp.1_03" only repeats the series: "Episodio 3". */
      var epNo = ep.number || n + 1;
      var epName = ep.title || ep.name || '';
      var seriesNorm = norm(String(item.title || '').replace(/\s*(T|Temp\.?|Temporada)\s*\d+\s*$/i, ''));
      if (!epName || (seriesNorm && norm(epName).indexOf(seriesNorm) === 0) || /^(episodio|capitulo|cap\.?)\s*\d+$/i.test(norm(epName))) {
        epName = 'Episodio ' + epNo;
      } else {
        epName = epNo + '. ' + epName;
      }
      t.appendChild(el('span', 'm-ep-title', epName));
      if (ep.duration) { t.appendChild(el('span', 'm-ep-meta', String(ep.duration))); }
      a.appendChild(t);
      a.addEventListener('click', function (event) { event.preventDefault(); mobilePlay(item, ep); });
      sec.appendChild(a);
    });
    return sec;
  }

  /* ---------------------------------------------------------- playing */
  /* The phone turns sideways for the player and back afterwards (where the
     browser lets the page lock the orientation; the Android app does). */
  function lockMobileRotation() {
    try { if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(function () {}); } } catch (e) { /* not allowed */ }
  }
  function unlockMobileRotation() {
    try { if (screen.orientation && screen.orientation.unlock && mob.rotated) { screen.orientation.unlock(); } } catch (e) { /* not allowed */ }
    mob.rotated = false;
  }

  /* Shows the player as soon as it opens (no wait for the next sync). */
  function mobileWillPlay() {
    mob.rotated = true;
    lockMobileRotation();
    var started = Date.now();
    if (mob.playPending) { clearInterval(mob.playPending); }
    mob.playPending = setInterval(function () {
      if (state.screen === 'player' || Date.now() - started > 20000) {
        clearInterval(mob.playPending);
        mob.playPending = 0;
        mobileSync();
      }
    }, 120);
  }

  /* Nothing to play with (no addon gives sources, not downloaded): the
     notice, without turning the phone sideways first. */
  function mobileCannotPlay(item, episode) {
    if (!item || !item._stremio || item._plain || item._downloadId || hasSourceAddons()) { return false; }
    if (typeof downloadedFileFor === 'function' && downloadedFileFor(item, episode || null)) { return false; }
    showNoSourcesNotice();
    return true;
  }

  /* The same for a "Seguir viendo" / history record. */
  function mobileRecordBlocked(r) {
    if (!r || !/^stremio:/.test(String(r.id)) || hasSourceAddons()) { return false; }
    return mobileCannotPlay(stremioItemFromHistory(r), null);
  }

  function mobilePlay(item, episode) {
    if (mobileCannotPlay(item, episode)) { return; }
    mobileWillPlay();
    openDetail(item);
    loadVodDetail(item, function (loaded) {
      if (!loaded || state.detail !== item) { return; }
      expandToFullscreen(item, episode || state.detailEpisode);
    });
  }

  /* "Ver desde el principio": the movie, or the episode the viewer was on
     (the detail page selects it from the history), from second 0. */
  function mobileStartOver(item) {
    if (mobileCannotPlay(item, null)) { return; }
    mobileWillPlay();
    openDetail(item);
    loadVodDetail(item, function (loaded) {
      if (!loaded || state.detail !== item) { return; }
      startOverTitle(item, isSeriesItem(item) ? state.detailEpisode : null);
    });
  }

  /* ---------------------------------------------------------- TV en vivo */
  var M_LIVE_BATCH = 80;
  function renderMobileLive() {
    mob.main.appendChild(mobileHeader('TV en vivo'));
    if (!CHANNELS.length) {
      mob.main.appendChild(liveChannelsPending() ? makeLoader('Cargando canales…', 'is-page')
        : el('p', 'm-empty', liveEmptyMessage()));
      if (!liveChannelsLoaded) { loadLiveChannels(); }
      return;
    }
    var cur = CHANNELS[state.channel] || CHANNELS[0];
    var now = el('section', 'm-live-now');
    now.appendChild(el('span', 'm-live-badge', 'EN VIVO'));
    now.appendChild(el('span', 'm-live-name', cur.name || 'Canal'));
    now.appendChild(mButton('m-play is-compact', mSvg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 18) + '<span>Ver</span>', null, function () {
      mobileWillPlay();
      openPlayer('live');
    }));
    mob.main.appendChild(now);

    var list = el('section', 'm-channels');
    list.setAttribute('aria-label', 'Canales');
    var shown = 0;
    function more() {
      var end = Math.min(CHANNELS.length, shown + M_LIVE_BATCH);
      for (; shown < end; shown++) {
        (function (i) {
          var ch = CHANNELS[i];
          var a = el('a', 'm-channel' + (i === state.channel ? ' is-on' : ''));
          a.href = '#';
          var logo = el('span', 'm-ch-logo');
          if (ch.logo) { logo.appendChild(mPicture(ch.logo, 44)); } else { logo.textContent = String(i + 1); }
          a.appendChild(logo);
          a.appendChild(el('span', 'm-ch-name', ch.name || ('Canal ' + (i + 1))));
          a.addEventListener('click', function (event) {
            event.preventDefault();
            setChannel(i, true);
            mobileWillPlay();
            openPlayer('live');
          });
          list.appendChild(a);
        })(shown);
      }
    }
    more();
    mob.main.appendChild(list);
    mob.main.onscroll = function () {
      if (mob.tab !== 'live' || shown >= CHANNELS.length) { return; }
      if (mob.main.scrollTop + mob.main.clientHeight > mob.main.scrollHeight - 600) { more(); }
    };
  }

  /* ---------------------------------------------------------- search */
  function renderMobileSearch() {
    var head = el('header', 'm-head m-search-head');
    head.appendChild(mButton('m-round', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
    var input = document.createElement('input');
    input.type = 'search';
    input.className = 'm-search';
    input.placeholder = 'Películas, series, anime…';
    input.setAttribute('aria-label', 'Buscar');
    head.appendChild(input);
    mob.main.appendChild(head);
    var results = el('div', 'm-search-results');
    mob.main.appendChild(results);
    function run() {
      var q = input.value.trim();
      clear(results);
      if (q.length < 2) { return; }
      results.appendChild(el('p', 'm-empty', 'Buscando…'));
      /* The loaded titles first, then what the addons that can search find. */
      var nq = norm(q);
      var local = VOD.filter(function (v) { return itemNorm(v, 'title').indexOf(nq) !== -1; });
      /* As each addon answers, best match first. */
      searchTitles(q, function (found, finished) {
        if (input.value.trim() !== q) { return; }
        var items = rankSearchResults(q, local.concat(found));
        if (!items.length && !finished) { return; }
        clear(results);
        if (!items.length) { results.appendChild(el('p', 'm-empty', 'Sin resultados para «' + q + '».')); return; }
        results.appendChild(mobileGrid('', items));
        if (!finished) { results.appendChild(el('p', 'm-empty is-small', 'Buscando en más addons…')); }
      });
    }
    input.addEventListener('input', function () {
      if (mob.searchTimer) { clearTimeout(mob.searchTimer); }
      mob.searchTimer = setTimeout(run, 450);
    });
    setTimeout(function () { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
  }

  /* ---------------------------------------------------------- account */
  /* Sub-screens of Mi cuenta and where Back goes from each. */
  var M_PARENT = { profiles: 'home', profileEdit: 'profiles', playback: 'home', history: 'home', mylist: 'home', about: 'home', addons: 'home' };
  var M_SCREENS = {
    addons: function () { renderMobileAddons(); },
    picker: function () { renderMobilePicker(); },
    profiles: function () { renderMobileProfiles(); },
    profileEdit: function () { renderMobileProfileEdit(); },
    playback: function () { renderMobilePlayback(); },
    history: function () { renderMobileHistory(); },
    mylist: function () { mob.main.appendChild(mobileSubHeader('Mi lista')); renderMobileMyList(true); },
    about: function () { renderMobileAbout(); }
  };

  function mobileOpen(screen) {
    mob.screen = screen;
    renderMobile();
    mob.main.scrollTop = 0;
  }

  /* Title bar of a sub-screen: Back and its name. */
  function mobileSubHeader(title) {
    var h = el('header', 'm-head');
    h.appendChild(mButton('m-round', mSvg('<path d="M15 18l-6-6 6-6"/>', 22), 'Volver', function () { mobileBack(); }));
    h.appendChild(el('h1', 'm-h1', title));
    return h;
  }

  /* A settings row: icon, title, short text and a chevron. */
  function mobileListItem(icon, title, sub, run) {
    var b = mButton('m-item', null, null, run);
    var ic = el('span', 'm-item-icon');
    ic.innerHTML = mSvg(icon, 22);
    b.appendChild(ic);
    var tx = el('span', 'm-item-text');
    tx.appendChild(el('span', 'm-item-title', title));
    if (sub) { tx.appendChild(el('span', 'm-item-sub', sub)); }
    b.appendChild(tx);
    var ch = el('span', 'm-item-chevron');
    ch.innerHTML = mSvg('<path d="M9 6l6 6-6 6"/>', 18);
    b.appendChild(ch);
    return b;
  }

  /* An on/off switch row. */
  function mobileSwitch(title, sub, on, change) {
    var row = el('label', 'm-switch-row');
    var tx = el('span', 'm-item-text');
    tx.appendChild(el('span', 'm-item-title', title));
    if (sub) { tx.appendChild(el('span', 'm-item-sub', sub)); }
    row.appendChild(tx);
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'm-switch';
    box.checked = !!on;
    box.addEventListener('change', function () { change(box.checked); });
    row.appendChild(box);
    return row;
  }

  /* One choice among a few (segmented buttons). */
  function mobileChoice(title, options, selected, change) {
    var box = el('div', 'm-choice');
    box.appendChild(el('span', 'm-choice-title', title));
    var seg = el('div', 'm-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', title);
    options.forEach(function (label, i) {
      var b = mButton('m-seg-btn' + (i === selected ? ' is-on' : ''), null, null, function () {
        for (var k = 0; k < seg.children.length; k++) { seg.children[k].classList.toggle('is-on', k === i); seg.children[k].setAttribute('aria-checked', String(k === i)); }
        change(i);
      });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === selected));
      b.innerHTML = label;
      seg.appendChild(b);
    });
    box.appendChild(seg);
    return box;
  }

  function renderMobileAccount() {
    mob.main.appendChild(mobileHeader('Mi cuenta'));
    var me = activeProfile();
    var card = el('section', 'm-me');
    var av = el('span', 'm-me-avatar');
    av.innerHTML = avatarSvg(me.avatar || 0);
    card.appendChild(av);
    var who = el('span', 'm-me-who');
    who.appendChild(el('span', 'm-me-name', me.name || 'Mi usuario'));
    who.appendChild(el('span', 'm-item-sub', (me.kids ? 'Perfil infantil · ' : '') + 'Guardado solo en este equipo'));
    card.appendChild(who);
    mob.main.appendChild(card);

    if (profilesData.list.length > 1) {
      var sec = el('section', 'm-section');
      sec.appendChild(el('h2', 'm-h2', 'Cambiar de perfil'));
      var row = el('div', 'm-profiles');
      profilesData.list.forEach(function (p) {
        var b = mButton('m-profile' + (p.id === me.id ? ' is-on' : ''), null, null, function () { switchToProfile(p.id); });
        var a = el('span', 'm-profile-avatar');
        a.innerHTML = avatarSvg(p.avatar || 0);
        b.appendChild(a);
        b.appendChild(el('span', 'm-profile-name', p.name || 'Perfil'));
        row.appendChild(b);
      });
      sec.appendChild(row);
      mob.main.appendChild(sec);
    }

    var titles = 0;
    for (var key in state.mylist) {
      if (Object.prototype.hasOwnProperty.call(state.mylist, key)) { titles++; }
    }
    var list = el('section', 'm-list');
    list.appendChild(mobileListItem('<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5 12 21l9-4.5"/>', 'Addons y listas',
      'Catálogo, fuentes, subtítulos y TV en vivo', function () { mobileOpen('addons'); }));
    list.appendChild(mobileListItem('<path d="M6 3.5h12v17l-6-4-6 4z"/>', 'Mi lista', 'Historial, Mi lista y favoritos' + (titles ? ' · ' + titles + (titles === 1 ? ' guardado' : ' guardados') : ''), function () { mobileOpen('mylist'); }));
    list.appendChild(mobileListItem('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>', 'Historial', 'Sigue donde lo dejaste', function () { mobileOpen('history'); }));
    list.appendChild(mobileListItem('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>', 'Reproducción y subtítulos', 'Formato, idioma y subtítulos', function () { mobileOpen('playback'); }));
    list.appendChild(mobileListItem('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.7c1.7.8 2.7 2.6 3 5.3"/>', 'Administrar perfiles', 'Crear, editar o eliminar perfiles', function () { mobileOpen('profiles'); }));
    mob.main.appendChild(list);

    var look = el('section', 'm-list');
    look.appendChild(mobileSwitch('Modo ligero', 'Menos efectos; úsalo si la app va lenta en tu celular.', liteMode(), function (on) { setLiteMode(on); }));
    mob.main.appendChild(look);

    var more = el('section', 'm-list');
    more.appendChild(mobileListItem('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>', 'Acerca de OpenTV', 'Versión, privacidad y créditos', function () { mobileOpen('about'); }));
    mob.main.appendChild(more);
  }

  /* ---------------------------------------------------------- addons */
  /* Phone: the same as Ajustes → Addons on PC: the addons (catalog, sources,
     subtitles) and the TV en vivo lists (M3U / IPTV), add and remove. */
  function renderMobileAddons() {
    mob.main.appendChild(mobileSubHeader('Addons y listas'));

    function addForm(placeholder, run) {
      var form = el('form', 'm-add');
      var input = document.createElement('input');
      input.type = 'url';
      input.className = 'm-search m-add-input';
      input.placeholder = placeholder;
      input.autocapitalize = 'off';
      input.spellcheck = false;
      var btn = el('button', 'm-add-btn', 'Agregar');
      btn.type = 'submit';
      var msg = el('p', 'm-add-msg', '');
      form.appendChild(input);
      form.appendChild(btn);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var url = (input.value || '').trim();
        if (!/^(https?|stremio):\/\//i.test(url)) { msg.textContent = 'Pega una dirección que empiece con https://'; msg.className = 'm-add-msg is-err'; return; }
        btn.disabled = true;
        btn.textContent = 'Agregando…';
        run(url, function (err, text) {
          btn.disabled = false;
          btn.textContent = 'Agregar';
          msg.textContent = err ? 'No se pudo agregar: ' + err : text;
          msg.className = 'm-add-msg ' + (err ? 'is-err' : 'is-ok');
          if (!err) { input.value = ''; setTimeout(function () { renderMobile(true); }, 900); }
        });
      });
      var wrap = el('div', 'm-add-wrap');
      wrap.appendChild(form);
      wrap.appendChild(msg);
      return wrap;
    }

    function row(title, sub, onRemove) {
      var r = el('div', 'm-item m-addon');
      var tx = el('span', 'm-item-text');
      tx.appendChild(el('span', 'm-item-title', title));
      if (sub) { tx.appendChild(el('span', 'm-item-sub', sub)); }
      r.appendChild(tx);
      /* (No onRemove: one of the app's own addons, which stays.) */
      if (onRemove) {
        r.appendChild(mButton('m-round m-remove', mSvg('<path d="M6 6l12 12M18 6 6 18"/>', 18), 'Quitar', onRemove));
      } else {
        r.appendChild(el('span', 'm-tag-fixed', 'Incluido'));
      }
      return r;
    }

    /* A recommended addon or list: name, what it gives and Agregar. */
    function recRow(title, sub, on, run) {
      var r = el('div', 'm-item m-addon');
      var tx = el('span', 'm-item-text');
      tx.appendChild(el('span', 'm-item-title', title));
      tx.appendChild(el('span', 'm-item-sub', sub));
      r.appendChild(tx);
      if (on) { r.appendChild(el('span', 'm-tag-fixed', 'Agregado')); return r; }
      var btn = el('button', 'm-add-btn m-rec-btn', 'Agregar');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Agregando…';
        run(function (err) {
          if (err) { btn.disabled = false; btn.textContent = 'No cargó'; return; }
          renderMobile(true);
        });
      });
      r.appendChild(btn);
      return r;
    }

    /* Películas y series */
    var cfg = getVodSourcesConfig();
    var vod = el('section', 'm-section');
    vod.appendChild(el('h2', 'm-h2', 'Películas y series'));
    var vodList = el('div', 'm-list');
    cfg.addons.forEach(function (ad, idx) {
      vodList.appendChild(row(ad.name || 'Addon', addonOffers(ad), isBuiltinVodAddon(ad) ? null : function () {
        var c = getVodSourcesConfig();
        c.addons.splice(idx, 1);
        saveVodSourcesConfig(c);
        syncExternalVodCatalogs(function () {});
        renderMobile(true);
      }));
    });
    vod.appendChild(vodList);
    if (!hasSourceAddons()) { vod.appendChild(el('p', 'm-note', 'Sin addon de fuentes: puedes ver la información, pero no reproducir.')); }
    vod.appendChild(addForm('https://…/manifest.json', function (url, done) {
      installVodAddon({ url: url }, function (err, count, info) { done(err, '✔ ' + (info ? info.name : 'Addon') + (count ? ' · ' + count + ' títulos' : '')); });
    }));
    vod.appendChild(el('h3', 'm-h3', 'Recomendados'));
    var vodRec = el('div', 'm-list');
    RECOMMENDED_VOD_ADDONS.forEach(function (rec) {
      vodRec.appendChild(recRow(rec.name, rec.desc, isVodAddonInstalled(rec.url), function (done) {
        installVodAddon({ url: rec.url }, function (err) { done(err); });
      }));
    });
    vod.appendChild(vodRec);
    mob.main.appendChild(vod);

    /* TV en vivo */
    var live = el('section', 'm-section');
    live.appendChild(el('h2', 'm-h2', 'TV en vivo'));
    var liveList = el('div', 'm-list');
    getSavedAddons().forEach(function (ad, idx) {
      liveList.appendChild(row(ad.name || 'Lista M3U', ad.count ? ad.count + ' canales' : 'Lista M3U / IPTV', function () {
        var current = getSavedAddons();
        current.splice(idx, 1);
        saveSavedAddons(current);
        reloadLiveLists();
        renderMobile(true);
      }));
    });
    live.appendChild(liveList);
    if (!getSavedAddons().length) { live.appendChild(el('p', 'm-note', 'Agrega una lista M3U o IPTV para ver canales en vivo.')); }
    live.appendChild(addForm('https://…/lista.m3u', function (url, done) {
      installAddon({ id: 'custom_' + Date.now(), name: 'Lista M3U', url: url }, function (err, count) {
        if (!err) { reloadLiveLists(); }
        done(err, '✔ ' + count + ' canales');
      });
    }));
    /* Recomendadas: the free-channel lists at the top of PRESET_ADDONS (the
       ones before the iptv-org block, which starts at España TDT). */
    live.appendChild(el('h3', 'm-h3', 'Recomendadas'));
    var liveRec = el('div', 'm-list');
    var savedUrls = {};
    getSavedAddons().forEach(function (ad) { savedUrls[ad.url] = true; });
    for (var p = 0; p < PRESET_ADDONS.length && PRESET_ADDONS[p].id !== 'es_tdt'; p++) {
      (function (preset) {
        liveRec.appendChild(recRow(preset.name, preset.desc, !!savedUrls[preset.url], function (done) {
          installAddon(preset, function (err) {
            if (!err) { reloadLiveLists(); }
            done(err);
          });
        }));
      })(PRESET_ADDONS[p]);
    }
    live.appendChild(liveRec);
    mob.main.appendChild(live);
  }

  /* ---------------------------------------------------------- profiles */
  function renderMobilePicker() {
    var page = el('section', 'm-picker');
    page.appendChild(el('h1', 'm-picker-title', '¿Quién está viendo?'));
    var grid = el('div', 'm-picker-grid');
    profilesData.list.forEach(function (p) {
      var b = mButton('m-picker-item', null, null, function () {
        try { sessionStorage.setItem(ACTIVE_PROFILE_SESSION, p.id); } catch (e) { /* private mode */ }
        profileChosenThisSession = true;
        if (!switchToProfile(p.id)) { mob.screen = 'home'; renderMobile(); }
      });
      var a = el('span', 'm-picker-avatar');
      a.innerHTML = avatarSvg(p.avatar || 0);
      b.appendChild(a);
      b.appendChild(el('span', 'm-picker-name', (p.name || 'Perfil') + (p.kids ? ' · Kids' : '')));
      grid.appendChild(b);
    });
    page.appendChild(grid);
    page.appendChild(mButton('m-ghost', null, null, function () { mob.screen = 'profiles'; mob.pickerManage = true; renderMobile(); })).textContent = 'Administrar perfiles';
    mob.main.appendChild(page);
  }

  function renderMobileProfiles() {
    mob.main.appendChild(mobileSubHeader('Perfiles'));
    var list = el('section', 'm-list');
    profilesData.list.forEach(function (p) {
      var b = mButton('m-item', null, null, function () { mob.editing = p; mobileOpen('profileEdit'); });
      var a = el('span', 'm-item-avatar');
      a.innerHTML = avatarSvg(p.avatar || 0);
      b.appendChild(a);
      var tx = el('span', 'm-item-text');
      tx.appendChild(el('span', 'm-item-title', p.name || 'Perfil'));
      tx.appendChild(el('span', 'm-item-sub', (p.kids ? 'Perfil infantil' : 'Perfil') + (p.id === activeProfileId ? ' · en uso' : '')));
      b.appendChild(tx);
      var ch = el('span', 'm-item-chevron');
      ch.innerHTML = mSvg('<path d="M9 6l6 6-6 6"/>', 18);
      b.appendChild(ch);
      list.appendChild(b);
    });
    mob.main.appendChild(list);
    if (profilesData.list.length < 6) {
      var add = mButton('m-play is-secondary', mSvg('<path d="M12 5v14M5 12h14"/>', 18) + '<span>Añadir perfil</span>', null, function () { mob.editing = null; mobileOpen('profileEdit'); });
      var wrap = el('div', 'm-pad');
      wrap.appendChild(add);
      mob.main.appendChild(wrap);
    }
  }

  /* Create or edit a profile: name, avatar and kids profile, with the same
     rules as the PC (a name, not repeated; at most six profiles). */
  function renderMobileProfileEdit() {
    var p = mob.editing;
    var isNew = !p;
    var draft = p ? { name: p.name, avatar: p.avatar || 0, kids: !!p.kids } : { name: '', avatar: profilesData.list.length % AVATARS.length, kids: false };
    mob.main.appendChild(mobileSubHeader(isNew ? 'Nuevo perfil' : 'Editar perfil'));
    var form = el('form', 'm-form');
    var preview = el('span', 'm-me-avatar m-edit-preview');
    preview.innerHTML = avatarSvg(draft.avatar);
    form.appendChild(preview);

    var label = el('label', 'm-field');
    label.appendChild(el('span', 'm-field-label', 'Nombre'));
    var name = document.createElement('input');
    name.className = 'm-input';
    name.maxLength = 20;
    name.value = draft.name;
    name.placeholder = 'Nombre del perfil';
    label.appendChild(name);
    form.appendChild(label);

    form.appendChild(el('span', 'm-field-label', 'Elige un avatar'));
    var grid = el('div', 'm-avatars');
    AVATARS.forEach(function (a, i) {
      var b = mButton('m-avatar-pick' + (i === draft.avatar ? ' is-on' : ''), avatarSvg(i), 'Avatar ' + (i + 1), function () {
        draft.avatar = i;
        preview.innerHTML = avatarSvg(i);
        for (var k = 0; k < grid.children.length; k++) { grid.children[k].classList.toggle('is-on', k === i); }
      });
      grid.appendChild(b);
    });
    form.appendChild(grid);
    form.appendChild(mobileSwitch('Perfil infantil', 'Solo muestra la sección Kids.', draft.kids, function (on) { draft.kids = on; }));

    var msg = el('p', 'm-form-msg');
    form.appendChild(msg);
    var save = el('button', 'm-play');
    save.type = 'submit';
    save.textContent = isNew ? 'Crear perfil' : 'Guardar';
    form.appendChild(save);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var n = name.value.trim();
      if (!n) { msg.textContent = 'Escribe un nombre.'; return; }
      for (var i = 0; i < profilesData.list.length; i++) {
        if (profilesData.list[i] !== p && profilesData.list[i].name.toLowerCase() === n.toLowerCase()) { msg.textContent = 'Ya hay un perfil con ese nombre.'; return; }
      }
      if (isNew) {
        profilesData.list.push({ id: 'p' + Date.now().toString(36), name: n, avatar: draft.avatar, kids: draft.kids, createdAt: Date.now() });
      } else {
        p.name = n; p.avatar = draft.avatar; p.kids = draft.kids;
      }
      profilesData.created = true;
      saveProfiles();
      if (!isNew && p.id === activeProfileId) { location.reload(); return; }
      mob.screen = 'profiles';
      renderMobile();
    });
    if (!isNew && profilesData.list.length > 1) {
      var del = mButton('m-danger', null, null, function () {
        if (window.confirm('¿Eliminar el perfil «' + p.name + '»? Se borran su lista y su historial.')) {
          deleteProfile(p.id);
          mob.screen = 'profiles';
          renderMobile();
        }
      });
      del.textContent = 'Eliminar perfil';
      form.appendChild(del);
    }
    mob.main.appendChild(form);
  }

  /* ---------------------------------------------------------- playback */
  /* The same global preferences as Ajustes → Reproducción on the PC. The
     "Compatibilidad máxima" choice is not offered: Android has no FFmpeg. */
  function renderMobilePlayback() {
    mob.main.appendChild(mobileSubHeader('Reproducción y subtítulos'));
    var box = el('section', 'm-settings');
    function set(key, value) {
      state.playback[key] = value;
      applyGlobalPlaybackPreferences();
      saveGlobalPlayback();
    }
    box.appendChild(el('p', 'm-note', 'Se aplican a todas las películas y series que veas.'));
    box.appendChild(mobileChoice('Formato de pantalla', ['Llenar', 'Original', '16:9', '4:3'], state.playback.screen === undefined ? 1 : Number(state.playback.screen), function (i) { set('screen', i); }));
    box.appendChild(mobileChoice('Audio preferido', ['Español', 'Portugués', 'Inglés'], Number(state.playback.audio) || 0, function (i) { set('audio', i); }));
    box.appendChild(el('h2', 'm-h2 m-flush', 'Subtítulos'));
    box.appendChild(mobileSwitch('Mostrar subtítulos', 'Cuando el título los tiene.', !!state.playback.subtitle, function (on) { set('subtitle', on); }));
    box.appendChild(mobileChoice('Idioma', ['Español', 'Portugués', 'Inglés'], Number(state.playback.subLang) || 0, function (i) { set('subLang', i); }));
    box.appendChild(mobileChoice('Tamaño', ['Normal', 'Grande', 'Pequeño'], Number(state.playback.size) || 0, function (i) { set('size', i); }));
    box.appendChild(mobileChoice('Estilo', ['<span class="m-sub-aa is-white">Aa</span>', '<span class="m-sub-aa is-yellow">Aa</span>', '<span class="m-sub-aa is-black">Aa</span>'],
      Number(state.playback.style) || 0, function (i) { set('style', i); }));
    mob.main.appendChild(box);
  }

  /* ---------------------------------------------------------- history */
  function renderMobileHistory() {
    mob.main.appendChild(mobileSubHeader('Historial'));
    var list = localProfile.history || [];
    if (!list.length) { mob.main.appendChild(el('p', 'm-empty', 'Aún no has visto nada en este perfil.')); return; }
    var sec = el('section', 'm-history');
    list.slice(0, 60).forEach(function (r) {
      var item = vodForHistoryRecord(r);
      var a = el('a', 'm-episode');
      a.href = '#';
      var thumb = el('div', 'm-ep-thumb');
      thumb.appendChild(mPicture((item && (item.landscape || item.backdrop || item.poster)) || r.poster, 132));
      var pct = r.duration ? Math.min(100, Math.max(2, Math.round((r.position || 0) / r.duration * 100))) : 0;
      if (pct) {
        var bar = el('div', 'm-progress');
        var fill = el('i');
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        thumb.appendChild(bar);
      }
      a.appendChild(thumb);
      var t = el('div', 'm-ep-text');
      t.appendChild(el('span', 'm-ep-title', r.title || (item && item.title) || 'Contenido'));
      t.appendChild(el('span', 'm-ep-meta', continueSubtitle(r)));
      a.appendChild(t);
      a.addEventListener('click', function (event) { event.preventDefault(); if (mobileRecordBlocked(r)) { return; } mobileWillPlay(); openHistoryRecord(r); });
      sec.appendChild(a);
    });
    mob.main.appendChild(sec);
    var wrap = el('div', 'm-pad');
    var clr = mButton('m-danger', null, null, function () {
      if (!window.confirm('¿Borrar todo el historial de este perfil?')) { return; }
      forgetAllWatched();
      renderMobile();
    });
    clr.textContent = 'Borrar historial';
    wrap.appendChild(clr);
    mob.main.appendChild(wrap);
  }

  /* ---------------------------------------------------------- about */
  function renderMobileAbout() {
    mob.main.appendChild(mobileSubHeader('Acerca de'));
    var box = el('section', 'm-about');
    var brand = el('div', 'm-about-brand');
    brand.innerHTML = '<svg width="56" height="56" viewBox="72 68 368 372" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M196 84 256 144 316 84"/><rect x="92" y="144" width="328" height="232" rx="44"/><path d="M231 224v72l62-36z"/><path d="M188 424h136"/></svg>';
    brand.appendChild(el('span', 'm-about-name', 'OpenTV'));
    brand.appendChild(el('span', 'm-item-sub', 'Versión ' + String(((document.querySelector('.welcome-version') || {}).textContent || '1.1.0')).replace(/^v/, '')));
    box.appendChild(brand);
    /* Updates: look for a new APK, download it and open the installer. */
    var upd = el('div', 'm-about-card');
    upd.appendChild(el('span', 'm-item-title', 'Actualizaciones'));
    var updText = el('span', 'm-item-sub', 'Busca la última versión de OpenTV.');
    upd.appendChild(updText);
    var updBtn = el('button', 'm-add-btn m-update-btn', 'Buscar actualizaciones');
    updBtn.type = 'button';
    function paintUpdate(text, button) {
      updText.textContent = text;
      updBtn.hidden = !button;
      if (button) { updBtn.textContent = button; }
    }
    updBtn.addEventListener('click', function () {
      if (updBtn.textContent === 'Instalar') { return installAndroidUpdate(paintUpdate); }
      if (/Actualizar|Reintentar/.test(updBtn.textContent) && androidUpdate.info && androidUpdate.info.available) { return startAndroidUpdate(paintUpdate); }
      paintUpdate('Buscando…', '');
      portalServiceCall('appUpdate', { action: 'check' }, function (err, res) {
        if (err || !res) { paintUpdate(err || 'No se pudo buscar actualizaciones.', 'Buscar actualizaciones'); return; }
        androidUpdate.info = res;
        if (!res.available) { paintUpdate('Tienes la última versión (' + (res.current || '') + ').', 'Buscar actualizaciones'); return; }
        paintUpdate('Versión ' + res.latest + ' disponible' + (res.size ? ' · ' + formatBytes(res.size) : '') + '.', 'Actualizar');
      }, 20000);
    });
    upd.appendChild(updBtn);
    box.appendChild(upd);
    [
      ['Sin registro ni contraseña', 'Tu lista, el historial y tus preferencias se guardan solo en este celular; no se envían a ningún servidor.'],
      ['Tendencias', 'Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.'],
      ['Desarrollado por', 'TECHPOINT Software™'],
      ['Código abierto', 'Capacitor, HLS.js (Apache 2.0) y ExoPlayer (Apache 2.0).']
    ].forEach(function (b) {
      var card = el('div', 'm-about-card');
      card.appendChild(el('span', 'm-item-title', b[0]));
      card.appendChild(el('span', 'm-item-sub', b[1]));
      box.appendChild(card);
    });
    mob.main.appendChild(box);
  }

  /* ---- main.js --------------------------------------------------------------- */
  /* main.js — Arranque: eventos globales, API de depuración window.__opentv y enlaces profundos.
     Parte del módulo único de la app (ver ui/js/src/README.md). */

  /* ------------------------------------------------------------------ boot */
  function boot() {
    if (window.OPENTV_DESKTOP) { installTitleBar(); showBootSplash(); }
    fitDesignViewport();
    window.addEventListener('resize', fitDesignViewport, false);
    window.addEventListener('orientationchange', fitDesignViewport, false);
    document.addEventListener('visibilitychange', fitDesignViewport, false);
    /* Some TVs only report the final window size after the splash animation. */
    setTimeout(fitDesignViewport, 250);
    setTimeout(fitDesignViewport, 1200);
    setTimeout(fitDesignViewport, 3000);
    document.addEventListener('keydown', handleKey, false);
    /* PC: the downloads list, so "Reproducir" finds a downloaded title at once. */
    if (platformHas('downloads')) { refreshDownloads(); }
    /* Android: what this device can do, from the service: torrents (Android
       9+ on ARM), downloads, its decoders and screen, and free space. */
    if (platformName() === 'android' && window.OPENTV_PLATFORM && window.OPENTV_PLATFORM.enable) {
      portalServiceCall('ping', {}, function (err, info) {
        if (err || !info) { return; }
        if (info.torrents === true) { window.OPENTV_PLATFORM.enable('torrents'); }
        if (info.downloads === true) { window.OPENTV_PLATFORM.enable('downloads'); refreshDownloads(); }
        setDeviceProfile(info.media, info.storage);
      });
      /* A new APK on GitHub: a short notice (Acerca de has the button too). */
      setTimeout(checkAndroidUpdateOnStart, 8000);
      /* The "Descargando" notification was tapped: show the downloads. On a
         cold start the app may say so before this listener exists, so the
         flag it leaves is checked too. */
      var openDownloadsFromNotice = function () {
        window.__opentvOpenDownloads = false;
        if (isPhone()) { return; }
        finishWelcome();
        openSettingsAt('downloads');
      };
      window.addEventListener('opentv:open-downloads', openDownloadsFromNotice);
      if (window.__opentvOpenDownloads) { setTimeout(openDownloadsFromNotice, 1500); }
    }
    document.addEventListener('keyup', function (e) {
      var code = e.keyCode || e.which;
      if (e.key === 'Back' || e.key === 'GoBack') {
        handleKey(e);
      }
    }, false);
    window.addEventListener('popstate', function () {
      back();
    }, false);
    document.addEventListener('click', function (e) {
      var f = closest(e.target, '.focusable');
      if (!f) { return; }
      if (!isVisible(f)) { return; }
      setFocus(f, true);
      if (f._activate) { f._activate(); }
    });
    if (window.OPENTV_DESKTOP) {
      document.addEventListener('scroll', schedulePosterMemoryPass, { capture: true, passive: true });
      /* A page slides in when its tab opens: posters that were still off
         screen at that moment are loaded once the slide ends. */
      document.addEventListener('animationend', function (event) {
        if (event.target && event.target.classList && event.target.classList.contains('home-page')) { schedulePosterMemoryPass(); }
      }, true);
      window.addEventListener('resize', schedulePosterMemoryPass);
    }
    if (window.OPENTV_DESKTOP) document.addEventListener('focusin', function (e) {
      var f = closest(e.target, '.focusable');
      if (f && isVisible(f)) setFocus(f, true);
    });
    forgetPrivateContent();
    applyLiteMode();
    buildSearch();
    startWelcome();
    /* Movies and series: the viewer's addons. */
    loadVodCatalog();
    /* TV en vivo: the viewer's own M3U lists. */
    loadLiveChannels();

    window.__opentv = {
      state: state,
      vod: VOD,
      channels: CHANNELS,
      /* TV en vivo (tests): reload the M3U lists or show a given channel list. */
      live: { reload: reloadLiveLists, use: useLiveChannels, categories: function () { return liveCategories; } },
      api: vodApiState,
      service: portalServiceCall,
      reloadVod: loadVodCatalog,
      skipWelcome: finishWelcome,
      show: function (name) {
        if (name === 'home') { finishWelcome(); }
        else if (name === 'detail') { openDetail(VOD[0]); }
        else if (name === 'search') { openSearch(); }
        else if (name === 'settings') { openSettings(); }
        else if (name === 'history') { openHistoryView(); }
        else if (name === 'help') { openSettings(); showSettingsPanel(settingsIndexOf('feedback'), true); }
        else if (name === 'pip') { togglePictureInPicture(); }
        else if (name === 'player') { openPlayer('live'); }
        else { showScreen(name); }
      },
      selectTab: function (i) { finishWelcome(); selectTab(i, true); },
      openDetail: function (i) { openDetail(VOD[i] || VOD[0]); },
      openSearch: openSearch,
      openSettings: openSettings,
      openPlayer: function (mode, i) { openPlayer(mode || 'live', VOD[i] || null); },
      focus: function (sel) {
        var n = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (n) { setFocus(n); }
      },
      key: function (code) { handleKey({ keyCode: code, preventDefault: function () {} }); },
      search: function (q) { openSearch(); setSearchQuery(q); },
      settingsPanel: function (i) { openSettings(); showSettingsPanel(i, true); },
      settingsIndexOf: settingsIndexOf,
      openItem: function (item) { openDetail(item); },
      /* The catalogue as it is now (`vod` above is the one at start). */
      currentVod: function () { return VOD; },
      avatarSvg: function (i) { return avatarSvg(i); },
      leavePlayer: restorePlayerReturn,
      /* Seguir viendo / Historial: forget a title (tests). */
      forgetWatched: forgetWatchedTitle,
      history: function () { return localProfile.history; },
      /* Reanudar / Ver desde el principio (tests): the plan playing would make. */
      resumePlanFor: function (item, episode, fromStart) {
        resetResumePlan();
        if (fromStart) { resumeFromStartKey = resumeKeyFor(item, episode || null); }
        planResume(item, episode || null);
        var out = { pos: resumePlan ? resumePlan.pos : 0, restarted: resumeRestarted };
        resetResumePlan();
        return out;
      },
      /* Addons (tests): install one, search, the saved source, what it offers. */
      stremio: { install: installVodAddon, sync: syncExternalVodCatalogs, search: searchStremioAddons,
        savedPick: savedStremioPick, offers: addonOffers, hasSources: hasSourceAddons }
    };

    if (window.OPENTV_DESKTOP) { installDesktopNavigation(); installTooltips(); installFocusRingMode(); installQualityControls(); installLiveGuide(); installUpdates(); installHoverCards(); installTrending(); installProfiles(); startCatalogAutoRefresh(); }

    /* Android / Fire TV (Capacitor): the remote's Back reaches the page only
       through the App plugin. Without this listener Android handled it itself
       (it closed the app, and the player could not be left with Back). */
    var capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (capApp && capApp.addListener) {
      capApp.addListener('backButton', function () {
        /* Phones: the phone layer closes its own screens first. */
        if (isPhone() && mobileBack()) { return; }
        handleKey({ keyCode: 27, key: 'GoBack', preventDefault: function () {} });
      });
    }

    /* Phones: their own vertical layout over the canvas (mobile/mobile-app.js). */
    installMobileApp();

    applyQuery();
  }

  /* Deep-link support for the visual comparison harness, e.g.
     index.html?screen=home&tab=2   index.html?screen=detail&vod=3
     index.html?screen=search&q=demo index.html?screen=settings&panel=1
     index.html?screen=player&ch=2&channels=1                            */
  function applyQuery() {
    var raw = String(location.search || '').replace(/^\?/, '');
    if (!raw) { return; }
    var map = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var kv = parts[i].split('=');
      map[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    }
    if (map.ch !== undefined) {
      var ch = parseInt(map.ch, 10) || 0;
      state.channel = Math.max(0, Math.min(CHANNELS.length - 1, ch));
    }
    var screen = map.screen || 'home';
    if (screen === 'welcome') { return; }

    finishWelcome();
    if (map.tab !== undefined) {
      selectTab(parseInt(map.tab, 10) || 0, true);
    } else if (!window.OPENTV_DESKTOP) {
      selectTab(0, false);
      setFocus(liveFocus);
    }
    /* (Desktop: finishWelcome already opened Inicio.) */

    if (screen === 'detail') {
      openDetail(VOD[parseInt(map.vod, 10) || 0]);
    } else if (screen === 'search') {
      openSearch();
      if (map.q) { setSearchQuery(map.q); }
    } else if (screen === 'settings') {
      openSettings();
      if (map.panel !== undefined) { showSettingsPanel(parseInt(map.panel, 10) || 0, true); }
    } else if (screen === 'player') {
      openPlayer(map.mode === 'vod' ? 'vod' : 'live', VOD[parseInt(map.vod, 10) || 0]);
      if (map.channels === '1') { openChannelPanel(); }
    }

    if (map.focus) {
      var n = document.querySelector(map.focus);
      if (n) { setFocus(n); }
    }
  }

  function purgeMemoryCache() {
    stopPlayerVideo();
    clearSearchState();
  }

  window.addEventListener('beforeunload', purgeMemoryCache);
  window.addEventListener('unload', purgeMemoryCache);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !window.OPENTV_DESKTOP) {
      purgeMemoryCache();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
