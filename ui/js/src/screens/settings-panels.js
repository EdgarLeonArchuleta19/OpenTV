/* screens/settings-panels.js — Paneles de Ajustes: compartir, control parental, ayuda, actualización y acerca de.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function buildSharePanel() {
  var p = panelBase('Compartir APP');
  p.appendChild(el('div', 'sp-hr'));
  p.appendChild(el('div', 'share-copy', 'Para compartir la aplicación de Windows, copia el ZIP completo. Los favoritos y el historial de tu perfil permanecen en este equipo.'));
  return p;
}

function buildCrPanel() {
  var p = el('div', 'settings-panel');
  var head = el('div', 'cr-head');
  head.appendChild(el('span', 't', 'Contenido adulto'));
  var sw = el('div', 'sw focusable ' + (state.crOn ? 'on' : 'off'));
  sw._activate = function () {
    state.crOn = !state.crOn;
    sw.className = 'sw focusable ' + (state.crOn ? 'on' : 'off');
    setFocus(sw);
  };
  head.appendChild(sw);
  p.appendChild(head);

  p.appendChild(el('div', 'cr-tip', '(LIVE-18+，Explorar-Adult)'));
  var btn = el('div', 'cr-btn focusable', 'Cambiar contraseña de control parental');
  btn._activate = function () { /* password dialog not reconstructed */ };
  p.appendChild(btn);
  p.appendChild(el('div', 'cr-warn', 'Establecer contraseña para activar contenidos para adultos'));
  return p;
}

function buildParentPanel() {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'pl-title', 'Configuraciones del Control Parental'));
  p.appendChild(el('div', 'pl-tip', window.XUPER_DESKTOP ? 'Control parental no disponible en esta versión. No se aplica ningún bloqueo por PIN.' : 'Ingrese la contraseña de cuatro dígitos e ingrese viendo el programa de bloqueo.'));
  p.appendChild(el('div', 'pl-label', 'Contraseña inicial:'));
  var boxes = el('div', 'pl-boxes');
  for (var i = 0; i < 4; i++) {
    var b = el('div', 'pl-box focusable');
    if (window.XUPER_DESKTOP) b.setAttribute('aria-disabled', 'true');
    b._activate = function () { /* numeric capture not reconstructed */ };
    boxes.appendChild(b);
    if (i < 3) { boxes.appendChild(el('div', 'pl-sep')); }
  }
  p.appendChild(boxes);
  p.appendChild(el('div', 'pl-note', ''));
  var ok = el('div', 'pl-ok focusable', 'OK');
  if (window.XUPER_DESKTOP) ok.setAttribute('aria-disabled', 'true');
  ok._activate = function () { /* password validation not reconstructed */ };
  p.appendChild(ok);
  return p;
}

function buildFeedbackPanel() {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'fb-title', 'Ayuda y Feedback'));
  p.appendChild(el('div', 'fb-hr'));
  p.appendChild(el('div', 'fb-contact',
    'Si tiene alguna duda, puede ponerse en contacto con nosotros a través de los siguientes medios:'));
  p.appendChild(el('div', 'fb-qr-note', 'Escanee el código QR para enviar sugerencias o comentarios.'));
  if (window.XUPER_DESKTOP) {
    p.querySelector('.fb-contact').textContent = 'Abre Diagnóstico para comprobar la conexión y generar un reporte del problema.';
    p.querySelector('.fb-qr-note').textContent = 'El reporte no se envía automáticamente.';
  }
  var qr = el('div', 'fb-qr');
  if (window.XUPER_DESKTOP) qr.hidden = true;
  p.appendChild(qr);
  var help = el('div', 'fb-help focusable', 'Ayuda');
  help.textContent = 'Abrir diagnóstico';
  help._activate = openDesktopDiagnostic;
  p.appendChild(help);
  return p;
}

function buildUpgradePanel() {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'sp-title plain', 'Settings'));
  p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));

  var cache = el('div', 'sp-card');
  abs(cache, 30, 198, 1360, 461);
  cache.appendChild(el('h3', null, 'Limpiar cache'));
  var rows = [
    { y: 139, label: 'Historia', kind: 'history' },
    { y: 246, label: 'Cache de foto', kind: 'photos' },
    { y: 353, label: 'Limpiar todos', kind: 'all' }
  ];
  for (var i = 0; i < rows.length; i++) {
    var row = el('div', 'sp-clear-row');
    row.style.top = rows[i].y + 'px';
    row.appendChild(el('span', 'lbl', rows[i].label));
    var btn = el('div', 'btn focusable', 'Limpiar');
    btn._activate = (function (kind, buttonEl) {
      return function () {
        if (kind === 'history' || kind === 'all') {
          clearWatchHistory();
        }
        if (kind === 'photos' || kind === 'all') {
          evictDetachedPosters();
          schedulePosterMemoryPass();
        }
        buttonEl.textContent = '✔ Limpiado';
        setTimeout(function () { buttonEl.textContent = 'Limpiar'; }, 1800);
      };
    })(rows[i].kind, btn);
    row.appendChild(btn);
    cache.appendChild(row);
  }
  p.appendChild(cache);

  var upd = el('div', 'sp-card');
  abs(upd, 30, 689, 1360, 291);
  upd.appendChild(el('h3', null, 'Actualización'));
  var ver = el('div', 'sp-version', 'Versión 1.0.0');
  upd.appendChild(ver);
  p.appendChild(upd);
  return p;
}

function buildAboutPanel() {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'sp-title plain', 'Sobre nosotros'));
  p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));
  p.appendChild(el('div', 'sp-about-body',
    'OpenTV se dedica a ofrecer a los usuarios una amplia variedad de recursos de alta calidad. ' +
    'Aquí encontrarás miles de películas, series, animes y canales en vivo, todo reunido en un solo lugar. ' +
    'Brindamos una experiencia estable, diversa y siempre actualizada, además de contenidos gratuitos para disfrutar.'));
  var port = el('div', 'sp-about-port');
  port.appendChild(el('div', null, 'OpenTV Desktop · Windows x64'));
  port.appendChild(el('div', 'sp-about-mod', 'Desarrollado por TECHPOINT'));
  p.appendChild(port);
  return p;
}
