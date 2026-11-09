/* screens/netdiag.js — Diagnóstico de red e informe de soporte.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------- network diagnostics
   Reads only: it asks the service for the local DNS answer and the DoH answer
   of every portal/CDN host and shows where the connection breaks.  The
   bypass itself lives in the service (dnsx.js) and needs no user action. */
var netdiagState = { running: false, report: null, error: null, runId: 0 };
var netdiagEnv = null;

function netdiagStateText(host) {
  if (!host) { return 'Sin datos'; }
  switch (host.verdict) {
    case 'ok': return 'Correcto';
    case 'dns-distinto': return 'DNS alterado';
    case 'dns-local-falla': return 'Bloqueado';
    case 'sin-tcp': return 'Sin conexión';
    case 'tls-falla': return 'HTTPS falla';
    case 'sin-tiempo': return 'Sin respuesta';
    default: return 'Sin datos';
  }
}

function netdiagStateClass(host) {
  if (!host) { return ''; }
  if (host.verdict === 'ok') { return 'ok'; }
  if (host.verdict === 'dns-distinto' || host.verdict === 'dns-local-falla' ||
      host.verdict === 'sin-tiempo' || host.timeout) { return 'warn'; }
  return 'bad';
}

function netdiagSummary(verdict) {
  switch (verdict) {
    case 'ok':
      return { cls: 'ok', text: 'La conexión está bien: el catálogo y los servidores de vídeo responden.' };
    case 'dns-distinto':
      return { cls: 'warn', text: 'Tu operador devuelve direcciones distintas a las reales (bloqueo por DNS). La app ya las esquiva sola.' };
    case 'dns-local-falla':
      return { cls: 'warn', text: 'Tu operador bloquea el DNS del televisor (no devuelve estos dominios). La app ya lo esquiva con su DNS seguro.' };
    case 'doh-sin-respuesta':
      return { cls: 'bad', text: 'El DNS seguro no devolvió respuesta. Revisa la conexión del televisor.' };
    case 'doh-bloqueado':
      return { cls: 'bad', text: 'La red bloquea el DNS seguro (Cloudflare y Google por HTTPS).' };
    case 'sin-salida':
      return { cls: 'bad', text: 'Los servidores no aceptan la conexión desde esta red.' };
    case 'algun-servidor':
      return { cls: 'warn', text: 'Un servidor de vídeo no respondió (suele rotar). El resto del catálogo sí responde: vuelve a analizar.' };
    case 'incompleto':
      return { cls: 'warn', text: 'La prueba no terminó: la TV no recibió respuesta de ningún servidor a tiempo. Vuelve a analizar; si se repite, apaga y enciende la TV.' };
    case 'servicio-sin-respuesta':
      return { cls: 'bad', text: 'El servicio de fondo no respondió. El reporte indica si fue el servicio completo o solo el diagnóstico.' };
    default:
      return { cls: '', text: 'Sin resultado todavía.' };
  }
}

function renderNetdiag(summary, list, report) {
  clear(list);
  var summaryInfo = netdiagSummary(report.verdict);
  summary.textContent = summaryInfo.text;
  summary.className = 'dg-summary' + (summaryInfo.cls ? ' ' + summaryInfo.cls : '');

  var hosts = report.hosts || [];
  for (var i = 0; i < hosts.length; i++) {
    var host = hosts[i];
    var row = el('div', 'dg-row ' + netdiagStateClass(host));
    var ips = (host.doh && host.doh.ok && host.doh.ips.length) ? host.doh.ips : (host.system.ips || []);
    var local = (host.system && host.system.ok) ? host.system.ips.join(', ') : 'sin respuesta';
    row.appendChild(el('span', 'dg-host', host.host));
    row.appendChild(el('span', 'dg-local', local));
    row.appendChild(el('span', 'dg-state', netdiagStateText(host)));
    row.appendChild(el('span', 'dg-ip', ips.join(', ')));
    list.appendChild(row);
  }

  var providers = report.providers || [];
  var okProviders = [];
  var badProviders = [];
  for (var p = 0; p < providers.length; p++) {
    if (providers[p].reachable) { okProviders.push(providers[p].ip); }
    else { badProviders.push(providers[p].ip); }
  }
  var providersKnown = providers.length > 0;
  var dnsRow = el('div', 'dg-row dns');
  dnsRow.appendChild(el('span', 'dg-host', 'DNS seguro (DoH)'));
  dnsRow.appendChild(el('span', 'dg-local', providersKnown ? (okProviders.length + '/' + providers.length + ' disponibles') : 'sin datos'));
  dnsRow.appendChild(el('span', 'dg-state', providersKnown ? (okProviders.length ? 'Correcto' : 'Bloqueado') : 'No evaluado'));
  dnsRow.appendChild(el('span', 'dg-ip', okProviders.join(', ')));
  if (!providersKnown) { dnsRow.className = 'dg-row dns warn'; }
  else if (okProviders.length) { dnsRow.className = 'dg-row dns ok'; }
  else { dnsRow.className = 'dg-row dns bad'; }
  list.appendChild(dnsRow);

  /* ── Codec row ─────────────────────────────────────────────────────── */
  var codec = report.codec || {};
  /* canPlayType() is unreliable on several Starfish/webOS builds: it may
     return an empty string even when native playback works. It is evidence
     about the browser API only, never a verdict about the TV hardware. */
  var codecKnown = !!(codec.h264 || codec.hevc || codec.hls);
  var codecRow = el('div', 'dg-row' + (codecKnown ? ' ok' : ' warn'));
  var codecDesc = [
    'H.264: ' + (codec.h264 || 'no informado'),
    'HEVC: '  + (codec.hevc || 'no informado'),
    'HLS: '   + (codec.hls  || 'no informado')
  ].join('  ');
  codecRow.appendChild(el('span', 'dg-host', 'Códec'));
  codecRow.appendChild(el('span', 'dg-local', ''));
  codecRow.appendChild(el('span', 'dg-state', codecKnown ? 'Informado' : 'No confirmado'));
  codecRow.appendChild(el('span', 'dg-ip', codecDesc));
  list.appendChild(codecRow);

  /* ── Layer rows: portal / sesión / live / VOD ───────────────────── */
  var layers = report.layers || {};
  var layerDefs = [
    { key: 'portal',  label: 'Portal' },
    { key: 'session', label: 'Sesión' },
    { key: 'live',    label: 'Live CDN' },
    { key: 'vod',     label: 'VOD CDN' }
  ];
  var liveFail = false;
  var vodFail = false;
  for (var li = 0; li < layerDefs.length; li++) {
    var ldef = layerDefs[li];
    var ldata = layers[ldef.key];
    if (!ldata) { continue; }
    /* A probe that hit the deadline proves nothing about the carrier: it must
       not be reported as a block, only as "no answer". */
    if (ldef.key === 'live' && !ldata.ok && !ldata.timeout) { liveFail = true; }
    if (ldef.key === 'vod' && !ldata.ok && !ldata.timeout) { vodFail = true; }
    var lrow = el('div', 'dg-row ' + (ldata.ok ? 'ok' : (ldata.timeout ? 'warn' : 'bad')));
    var ldesc = ldata.error || (ldata.status ? 'HTTP ' + ldata.status : (ldata.ok ? 'OK' : 'Error'));
    if (ldef.key === 'session') {
      ldesc = 'userId ' + (ldata.userId || '?') + '  token ' + (ldata.token || '?');
    }
    var lms = ldata.ms ? (' ' + ldata.ms + ' ms') : '';
    lrow.appendChild(el('span', 'dg-host', ldef.label));
    lrow.appendChild(el('span', 'dg-local', ''));
    lrow.appendChild(el('span', 'dg-state', ldata.ok ? 'OK' : (ldata.timeout ? 'Sin respuesta' : 'Error')));
    lrow.appendChild(el('span', 'dg-ip', ldesc + lms));
    list.appendChild(lrow);
  }

  /* A green DNS test with dead media CDNs is the classic carrier block:
     the operator answers DNS but drops the video hosts by IP or TLS SNI.
     Without this override the viewer reads "todo bien" and still sees a
     black screen, which is exactly the report we get from Chile/Colombia. */
  if (summaryInfo.cls === 'ok' && (liveFail || vodFail)) {
    var broken = (liveFail && vodFail) ? 'los canales en vivo y las películas'
      : (liveFail ? 'los canales en vivo' : 'las películas');
    summaryInfo = {
      cls: 'bad',
      text: 'El DNS responde bien, pero ' + broken + ' no se pueden abrir: ' +
        'tu operador bloquea las direcciones de vídeo (bloqueo por IP/SNI). ' +
        'Ese bloqueo no se arregla desde la app; hace falta una VPN en el router.'
    };
    summary.textContent = summaryInfo.text;
    summary.className = 'dg-summary ' + summaryInfo.cls;
  }

  if (report.partial && summaryInfo.cls !== 'bad') {
    summary.textContent += ' (La prueba no terminó a tiempo: vuelve a analizar.)';
  }

  if (netdiagEnv) {
    var s = report.screen || {};
    var parts = [];
    if (s.w && s.h) { parts.push('Pantalla ' + s.w + '×' + s.h); }
    if (s.panelW && s.panelH) { parts.push('panel ' + s.panelW + '×' + s.panelH); }
    if (s.scale) { parts.push('escala ' + (Math.round(s.scale * 100) / 100)); }
    if (report.version) { parts.push('versión ' + report.version); }
    netdiagEnv.textContent = parts.join(' · ');
  }
}

function reportSafeText(value) {
  /* A support photo must never expose a playable URL, signed query, token or
     request header. Keep only a short, human-readable error classification. */
  var text = String(value == null ? '' : value);
  text = text.replace(/https?:\/\/[^\s"']+/ig, '[URL OCULTA]');
  text = text.replace(/(token|signature|authorization|cookie|key)=?[^\s,&]*/ig, '$1=[OCULTO]');
  text = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
  return text.slice(0, 150);
}

function layerReportState(layer) {
  if (!layer) { return 'sin datos'; }
  if (layer.ok) { return layer.status ? ('OK (HTTP ' + layer.status + ')') : 'OK'; }
  if (layer.timeout) { return 'sin respuesta'; }
  return 'error' + (layer.error ? (': ' + reportSafeText(layer.error)) : '');
}

function buildSupportReport(report) {
  var lines = [];
  var env = report.screen || {};
  var layers = report.layers || {};
  var hosts = report.hosts || [];
  lines.push('REPORTE DE SOPORTE OPENTV');
  lines.push('Versión: ' + (report.version || 'desconocida'));
  lines.push('Pantalla: ' + ((env.w && env.h) ? (env.w + '×' + env.h) : 'sin datos') +
    ((env.panelW && env.panelH) ? (' | panel ' + env.panelW + '×' + env.panelH) : '') +
    (env.scale ? (' | escala ' + env.scale) : ''));
  lines.push('Red: ' + (report.verdict || 'sin resultado') + (report.partial ? ' (parcial)' : ''));
  if (report.pending) { lines.push('Diagnóstico: sin respuesta / detenido para generar este reporte'); }
  if (report.serviceError) { lines.push('Servicio: ' + reportSafeText(report.serviceError)); }
  lines.push('Portal: ' + layerReportState(layers.portal));
  lines.push('Credenciales locales (sin validar autorización): ' + layerReportState(layers.session));
  lines.push('TV en vivo: ' + layerReportState(layers.live));
  lines.push('Películas/series: ' + layerReportState(layers.vod));
  lines.push('Último intento VOD: ' + lastVodAttempt.phase + ' | ' + lastVodAttempt.status +
    (lastVodAttempt.error ? (' | ' + lastVodAttempt.error) : ''));
  lines.push('Reproductor: ' + (state.playerMode || 'sin reproducción') +
    ' | modo ' + (state.streamMode || 'normal') +
    (state.streamError ? (' | error ' + reportSafeText(state.streamError)) : ''));
  for (var i = 0; i < hosts.length && i < 5; i++) {
    lines.push('Host ' + (i + 1) + ': ' + reportSafeText(hosts[i].host) +
      ' — ' + reportSafeText(hosts[i].verdict || 'sin datos'));
  }
  lines.push('');
  lines.push('Privacidad: este reporte no incluye enlaces, tokens, cabeceras ni historial.');
  lines.push('Toma una foto de esta pantalla y envíala al soporte.');
  return lines.join('\n');
}

function showSupportReport(summary, list) {
  if (!netdiagState.report) {
    /* A frozen service must not prevent a user from contacting support.
       Stop only this UI run and make a report from the known local facts. */
    netdiagState.runId++;
    netdiagState.running = false;
    var vp = window.__xuperViewport || {};
    netdiagState.report = {
      version: (document.querySelector('.welcome-version') || {}).textContent || 'desconocida',
      verdict: 'sin respuesta', partial: true, pending: true,
      screen: { w: vp.w || 0, h: vp.h || 0, scale: vp.scale || 0,
        panelW: vp.panelW || 0, panelH: vp.panelH || 0 },
      layers: {}, hosts: []
    };
  }
  clear(list);
  var report = el('div', 'dg-report', buildSupportReport(netdiagState.report));
  list.appendChild(report);
  summary.className = 'dg-summary ok';
  summary.textContent = 'Reporte listo. Toma una foto de esta pantalla y envíala al soporte.';
}

function runNetdiag(button, summary, list) {
  /* Settings can be rebuilt while a slow TV still has a diagnostic request
     open. Give the new visible panel its own run and ignore the old reply;
     otherwise the reply paints an already-detached panel and viewers see
     an apparently empty Diagnóstico screen. */
  var runId = netdiagState.runId + 1;
  netdiagState.runId = runId;
  netdiagState.running = true;
  netdiagState.error = null;
  button.textContent = 'Analizando…';
  summary.className = 'dg-summary';
  summary.textContent = 'Consultando el DNS del televisor, el DNS seguro y los servidores…';
  clear(list);
  /* The list must never look empty while the test runs: some TVs take a while
     and "nothing happened" is the report we keep getting. */
  list.appendChild(el('div', 'dg-row', 'Analizando…'));

  function localFailure(reason) {
    if (netdiagState.runId !== runId || !netdiagState.running) { return; }
    netdiagState.running = false;
    /* Ignore the late callback from the request that just timed out. */
    netdiagState.runId++;
    netdiagState.report = {
      version: (document.querySelector('.welcome-version') || {}).textContent || 'desconocida',
      verdict: 'servicio-sin-respuesta', partial: true, serviceError: reason,
      screen: (function () {
        var vp = window.__xuperViewport || {};
        return { w: vp.w || 0, h: vp.h || 0, scale: vp.scale || 0,
          panelW: vp.panelW || 0, panelH: vp.panelH || 0 };
      })(),
      layers: {}, hosts: [], providers: []
    };
    button.textContent = 'Analizar de nuevo';
    renderNetdiag(summary, list, netdiagState.report);
  }

  /* First prove that Luna can reach our service. This is deliberately tiny
     and local: it distinguishes a missing/blocked service from a network
     diagnostic that itself is slow, instead of leaving a blank spinner. */
  /* Allow up to 25 seconds for the Node.js service to cold-boot on slower
     dual-core TVs (webOS 3.5 / 2017 models like LJ550 need 8-12 seconds). */
  var pingDone = false;
  var pingTimer = setTimeout(function () {
    if (!pingDone) { pingDone = true; localFailure('ping no respondió en 25 segundos (el servicio no arrancó)'); }
  }, 25000);
  portalServiceCall('ping', {}, function (pingError, pingPayload) {
    if (pingDone) { return; }
    pingDone = true;
    clearTimeout(pingTimer);
    if (pingError || !pingPayload) {
      localFailure('ping falló: ' + reportSafeText(pingError || 'sin respuesta'));
    }
  }, 24000);

  /* Two safety nets: one explains a slow network, the other gives the button
     back if the service never answers at all. */
  var slowTimer = setTimeout(function () {
    if (!netdiagState.running || netdiagState.runId !== runId) { return; }
    summary.textContent = 'Analizando… tu red está respondiendo lento, espera un momento.';
  }, 9000);
  var guardTimer = setTimeout(function () {
    if (!netdiagState.running || netdiagState.runId !== runId) { return; }
    localFailure('ping respondió, pero netdiag no devolvió resultado en 32 segundos');
  }, 32000);

  portalServiceCall('netdiag', (function () {
    var vp = window.__xuperViewport || {};
    var vid = playerVideo || document.querySelector('video');
    function cp(t) { return vid ? (vid.canPlayType(t) || '') : ''; }
    return {
      screenW: vp.w || 0, screenH: vp.h || 0, screenScale: vp.scale || 0,
      panelW: vp.panelW || 0, panelH: vp.panelH || 0,
      codecH264: cp('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      codecHEVC: cp('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      codecHLS:  cp('application/x-mpegURL'),
      /* Last real CDN URLs so the service can prove whether the carrier
         drops live/VOD by IP or SNI even when DNS looks perfect. */
      liveUrl: (lastCdnProbe.live && lastCdnProbe.live.url) || '',
      liveHeaders: (lastCdnProbe.live && lastCdnProbe.live.headers) || {},
      vodUrl: (lastCdnProbe.vod && lastCdnProbe.vod.url) || '',
      vodHeaders: (lastCdnProbe.vod && lastCdnProbe.vod.headers) || {}
    };
  })(), function (error, payload) {
    if (netdiagState.runId !== runId) { return; }
    clearTimeout(slowTimer);
    clearTimeout(guardTimer);
    netdiagState.running = false;
    button.textContent = 'Analizar de nuevo';
    if (button.parentNode && button.parentNode.className.indexOf('is-active') !== -1) { setFocus(button); }
    if (error || !payload) {
      netdiagState.error = error || 'sin respuesta';
      summary.className = 'dg-summary bad';
      var errMsg = String(error || '');
      if (/denied|permission|not permitted|bloqueado el servicio/i.test(errMsg)) {
        summary.textContent = SERVICE_BLOCKED_HINT;
      } else if (/exist|not found|no disponible/i.test(errMsg)) {
        summary.textContent = 'El servicio de fondo no está instalado en la TV. Reinstala la app usando el instalador .bat';
      } else if (/timeout|tiempo|espera/i.test(errMsg)) {
        summary.textContent = 'Tiempo de espera agotado. La conexión es muy lenta o el DNS de tu operador no responde.';
      } else {
        summary.textContent = 'No se pudo ejecutar la prueba (' + (errMsg || 'el servicio no respondió') + ').';
      }
      return;
    }
    netdiagState.report = payload;
    renderNetdiag(summary, list, payload);
  }, 45000);
}

function buildNetdiagPanel() {
  var p = panelBase('Diagnóstico de red');
  p.appendChild(el('div', 'dg-note',
    'Comprueba si tu operador de internet está bloqueando los servidores de OpenTV. ' +
    'La app ya usa un DNS seguro (DNS-over-HTTPS) para evitarlo; esta prueba solo lo muestra.'));
  p.appendChild(abs(el('div', 'sp-hr'), 0, 216, 1478, 1));

  var button = el('div', 'dg-btn focusable', 'Analizar red');
  abs(button, 52, 242, 330, 66);
  var reportButton = el('div', 'dg-btn dg-report-btn focusable', 'Generar reporte');
  abs(reportButton, 400, 242, 330, 66);
  var summary = el('div', 'dg-summary', 'Pulsa "Analizar red" para empezar.');
  abs(summary, 750, 242, 676, 66);

  var head = el('div', 'dg-head');
  abs(head, 52, 336, 1380, 40);
  head.appendChild(el('span', 'dg-host', 'Dominio'));
  head.appendChild(el('span', 'dg-local', 'DNS del televisor'));
  head.appendChild(el('span', 'dg-state', 'Estado'));
  head.appendChild(el('span', 'dg-ip', 'Dirección real (DNS seguro)'));

  var list = el('div', 'dg-list');
  abs(list, 52, 378, 1380, 450);

  var envLine = el('div', 'dg-env', '');
  abs(envLine, 52, 832, 1380, 32);
  netdiagEnv = envLine;

  var foot = el('div', 'dg-foot',
    'Si el estado dice "Bloqueado", tu operador está interceptando el nombre del servidor, pero la app ya conecta por la dirección real. ' +
    'La reproducción automática y la de compatibilidad máxima usan este mismo DNS seguro. ' +
    'Si el vídeo sigue sin abrir con la conexión en verde, el bloqueo es por dirección: hace falta un túnel (VPN local).');
  abs(foot, 52, 872, 1380, 150);

  button._activate = function () { runNetdiag(button, summary, list); };
  reportButton._activate = function () { showSupportReport(summary, list); };
  /* Opening the panel runs the test once: the people who need it are not
     going to press a button they do not understand. */
  p._ensureDiag = function () {
    if (netdiagState.report) {
      renderNetdiag(summary, list, netdiagState.report);
      return;
    }
    runNetdiag(button, summary, list);
  };

  p.appendChild(button);
  p.appendChild(reportButton);
  p.appendChild(summary);
  p.appendChild(head);
  p.appendChild(list);
  p.appendChild(envLine);
  p.appendChild(foot);
  return p;
}

function buildPendingPanel(title, text) {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'sp-title', title));
  p.appendChild(el('div', 'sp-hr'));
  p.appendChild(el('div', 'sp-pending', text));
  return p;
}
