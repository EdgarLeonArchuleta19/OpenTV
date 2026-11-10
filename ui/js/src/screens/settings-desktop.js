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

function buildDesktopSharePanel() {
  var page = desktopSettingsPage('sd-share', 'Compartir', 'Lleva OpenTV a otro equipo con Windows.');
  page.body.appendChild(desktopSettingsCard(UI_ICONS.share, 'Comparte el instalador',
    'Copia el archivo "OpenTV Setup" (o la versión portable) a otro PC y ábrelo allí. No hace falta internet para instalarlo.'));
  page.body.appendChild(desktopSettingsCard(UI_ICONS.user, 'Tu perfil se queda aquí',
    'Tu lista, el historial y tus preferencias están guardados solo en este equipo. En otro PC la app empieza con un perfil nuevo.'));
  page.body.appendChild(desktopSettingsCard(UI_ICONS.lock, 'Sin cuentas ni contraseñas',
    'No hay que registrarse: cada equipo crea su propio perfil local al abrir la app.'));
  return page.panel;
}

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
  var page = desktopSettingsPage('sd-help', 'Ayuda', 'Si algo no funciona, el diagnóstico te dice dónde está el problema.');
  var diag = desktopSettingsCard(UI_ICONS.diagnostics, '¿Un vídeo o canal no carga?',
    'Abre el diagnóstico: comprueba tu conexión, el DNS seguro y los servidores, y puede generar un reporte para enviarlo. Nada se envía de forma automática.');
  diag.appendChild(desktopSettingsButton('Abrir diagnóstico', UI_ICONS.wifi, openDesktopDiagnostic, true));
  page.body.appendChild(diag);
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
  ki.innerHTML = UI_ICONS.keyboard;
  kh.appendChild(ki);
  kh.appendChild(el('div', 'sd-card-title', 'Atajos de teclado'));
  keys.appendChild(kh);
  var grid = el('div', 'sd-keys-grid');
  DESKTOP_SHORTCUTS.forEach(function (k) {
    var row = el('div', 'sd-key-row');
    row.appendChild(el('kbd', null, k[0]));
    row.appendChild(el('span', null, k[1]));
    grid.appendChild(row);
  });
  keys.appendChild(grid);
  page.body.appendChild(keys);
  return page.panel;
}

function buildDesktopAboutPanel() {
  var page = desktopSettingsPage('sd-about', 'Acerca de', null);
  var hero = el('div', 'sd-about-hero');
  var logo = el('img', 'sd-about-logo');
  logo.src = 'images/logo.svg';
  logo.alt = '';
  hero.appendChild(logo);
  var who = el('div', 'sd-about-who');
  who.appendChild(el('div', 'sd-about-name', 'OpenTV'));
  var ver = el('div', 'sd-about-ver', 'Versión 1.0.0 · Windows x64');
  who.appendChild(ver);
  hero.appendChild(who);
  page.body.appendChild(hero);
  if (window.desktop && window.desktop.info) {
    window.desktop.info().then(function (info) {
      if (info && info.version) { ver.textContent = 'Versión ' + info.version + ' · Windows ' + (info.arch || 'x64'); }
    }).catch(function () {});
  }
  page.body.appendChild(buildUpdateCard());
  page.body.appendChild(desktopSettingsCard(UI_ICONS.channels, 'Películas, series y TV en vivo en un solo lugar',
    'Catálogo que se actualiza solo, reproducción automática con modo compatible, ventana flotante y tu lista guardada en este equipo.'));
  page.body.appendChild(desktopSettingsCard(UI_ICONS.user, 'Desarrollado por TECHPOINT Software™', null));
  page.body.appendChild(desktopSettingsCard(UI_ICONS.info, 'Componentes de código abierto',
    'Electron, HLS.js (Apache 2.0) y FFmpeg (GPL v3). Las licencias completas están en la carpeta "licenses" de la instalación.'));
  return page.panel;
}
