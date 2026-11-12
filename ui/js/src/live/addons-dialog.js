/* live/addons-dialog.js — "Buscar listas de TV": las listas M3U recomendadas
   (PRESET_ADDONS), con un buscador. Se abre con el botón Buscar de Ajustes →
   Fuentes y desde el panel de canales del reproductor.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var addonsDialogReturn = null;

function openAddonsDialog() {
  var dlg = $('dialog-addons');
  if (!dlg) { return; }
  dialogAddonsOpen = true;
  addonsDialogReturn = state.focus;
  dlg.classList.add('is-active');
  var search = $('da-search');
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
  /* From Ajustes → Fuentes: show the lists just added there. */
  if (state.screen === 'settings' && typeof settingsIndexOf === 'function') {
    showSettingsPanel(settingsIndexOf('sources'), false);
    var again = settingsRight && settingsRight.querySelector('.fx-btn.is-search');
    if (again) { setFocus(again); return; }
  }
  if (addonsDialogReturn && isVisible(addonsDialogReturn)) { setFocus(addonsDialogReturn); }
}

function renderAddonsDialog() {
  var box = $('da-presets-list');
  if (!box) { return; }
  var q = norm(($('da-search') || {}).value || '');
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
        if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
      });
    };
    box.appendChild(item);
  });
  if (!shown) { box.appendChild(el('div', 'da-empty', 'No hay listas con ese nombre.')); }
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
