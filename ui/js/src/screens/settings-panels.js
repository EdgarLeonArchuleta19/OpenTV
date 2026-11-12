/* screens/settings-panels.js — Paneles de Ajustes: control parental, ayuda, actualización y acerca de.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function buildParentPanel() {
  /* (Desktop has no PIN lock and no menu entry for this panel.) */
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
  if (window.XUPER_DESKTOP) { return buildDesktopFeedbackPanel(); }
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
  if (window.XUPER_DESKTOP) { return buildDesktopAboutPanel(); }
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
