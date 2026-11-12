/* screens/settings-desktop.js — Paneles de Ajustes del escritorio: Compartir, Ayuda y Acerca de.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* One layout for every desktop settings page: a header (title + short
   description) and a column of cards. */
function desktopSettingsPage(cls, title, subtitle) {
  var p = el('div', 'settings-panel sd-page ' + (cls || ''));
  var head = el('div', 'sd-head');
  head.appendChild(el('div', 'sd-title', title));
  if (subtitle) { head.appendChild(el('div', 'sd-sub', subtitle)); }
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
  var page = desktopSettingsPage('sd-help', 'Ayuda', hasKeyboard ? 'Qué hacer si algo no funciona y los atajos de teclado.'
    : 'Qué hacer si algo no funciona y cómo se usa el control remoto.');
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
  if (n === 'webos') { return 'TV LG'; }
  if (n === 'android') { return platformIsTv() ? 'Android TV / Fire TV' : 'Android'; }
  return '';
}

/* Acerca de: who made it, the version, updates (PC), how your data is kept
   and, at the bottom, the credits. */
function buildDesktopAboutPanel() {
  var page = desktopSettingsPage('sd-about', 'Acerca de', null);
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
  page.body.appendChild(desktopSettingsCard(UI_ICONS.lock, 'Sin cuentas ni contraseñas',
    'Tu lista, el historial y tus preferencias se guardan solo en este equipo; no se envían a ningún servidor.'));

  var credits = el('div', 'sd-credits');
  credits.appendChild(el('div', 'sd-credits-by', 'Hecho por TECHPOINT Software™'));
  credits.appendChild(el('div', 'sd-credits-line', '© 2026 TECHPOINT Software™ · Licencia MIT'));
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
