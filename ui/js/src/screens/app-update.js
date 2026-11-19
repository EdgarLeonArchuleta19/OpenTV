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
