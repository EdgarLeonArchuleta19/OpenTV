/* desktop/updates.js — Actualizaciones automáticas: estado en Acerca de y aviso "Reiniciar y actualizar".
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The download runs in the main process (desktop/updater.cjs). Here the
   viewer sees what is happening and can restart to install right away;
   otherwise the update installs by itself when the app is closed. */
var updateStatus = { state: 'idle' };
var updateCards = [];
var updateNotice = null;
var updateNoticeDismissed = '';

function updatesApi() {
  return window.XUPER_DESKTOP && window.desktop && window.desktop.updates ? window.desktop.updates : null;
}

function updateStatusText(s) {
  switch (s.state) {
    case 'checking': return 'Buscando actualizaciones…';
    case 'current': return 'Tienes la última versión.';
    case 'downloading': return 'Descargando la versión ' + (s.version || 'nueva') + (s.percent ? ' · ' + s.percent + ' %' : '…');
    case 'ready': return 'La versión ' + (s.version || 'nueva') + ' está lista. Se instalará al cerrar la app.';
    case 'available-portable': return 'Hay una versión nueva (' + (s.version || '') + '). La versión portable no se actualiza sola: descarga la nueva y reemplaza el .exe.';
    case 'unconfigured': return 'Las actualizaciones automáticas no están configuradas en esta compilación.';
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
      btn.lastChild.textContent = s.state === 'ready' ? 'Reiniciar y actualizar' : 'Buscar actualizaciones';
      var busy = s.state === 'checking' || s.state === 'downloading';
      btn.classList.toggle('is-disabled', busy || s.state === 'dev' || s.state === 'unconfigured');
      btn.classList.toggle('is-primary', s.state === 'ready');
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
