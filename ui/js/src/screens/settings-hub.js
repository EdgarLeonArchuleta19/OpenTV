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
