/* live/addons-dialog.js — Diálogo de addons y listas M3U.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --- Addon Manager Dialog logic --- */
function openAddonsDialog() {
  dialogAddonsOpen = true;
  var dlg = $('dialog-addons');
  if (!dlg) { return; }
  dlg.classList.add('is-active');
  renderAddonsDialog();
  var firstBtn = dlg.querySelector('.focusable');
  if (firstBtn) { setFocus(firstBtn); }
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
  }
}

function renderAddonsDialog() {
  var presetsBox = $('da-presets-list');
  var installedBox = $('da-installed-list');
  var saved = getSavedAddons();
  var savedUrls = {};
  for (var s = 0; s < saved.length; s++) { savedUrls[saved[s].url] = true; }

  if (presetsBox) {
    clear(presetsBox);
    for (var p = 0; p < PRESET_ADDONS.length; p++) {
      (function (preset) {
        var item = el('div', 'da-preset-item');
        var info = el('div', 'da-preset-info');
        info.appendChild(el('div', 'da-preset-name', preset.name));
        info.appendChild(el('div', 'da-preset-desc', preset.desc));
        item.appendChild(info);

        var isInst = !!savedUrls[preset.url];
        var btn = el('button', 'da-preset-btn focusable' + (isInst ? ' is-installed' : ''), isInst ? '✔ Instalado' : '+ Instalar');
        btn.disabled = isInst;
        btn._activate = function () {
          if (isInst) { return; }
          btn.disabled = true;
          btn.textContent = 'Instalando…';
          installAddon(preset, function (err, count) {
            if (err) {
              btn.disabled = false;
              btn.textContent = 'Error';
              setTimeout(function () { btn.textContent = '+ Instalar'; }, 2000);
            } else {
              renderAddonsDialog();
              if (currentLiveCategory && currentLiveCategory.isAddon) {
                loadAddonChannels();
              }
            }
          });
        };
        item.appendChild(btn);
        presetsBox.appendChild(item);
      })(PRESET_ADDONS[p]);
    }
  }

  if (installedBox) {
    clear(installedBox);
    if (!saved.length) {
      installedBox.appendChild(el('div', 'da-installed-empty', 'No hay addons personalizados instalados aún. Instala una lista recomendada arriba o escribe una URL.'));
    } else {
      for (var i = 0; i < saved.length; i++) {
        (function (ad, idx) {
          var row = el('div', 'da-installed-item');
          var info = el('div', 'da-installed-info');
          var nm = el('div', 'da-preset-name', ad.name);
          var sub = el('div', 'da-preset-desc', (ad.count ? (ad.count + ' canales • ') : '') + ad.url);
          info.appendChild(nm);
          info.appendChild(sub);
          row.appendChild(info);

          var delBtn = el('button', 'da-del-btn focusable', 'Eliminar');
          delBtn._activate = function () {
            saved.splice(idx, 1);
            saveSavedAddons(saved);
            renderAddonsDialog();
            if (currentLiveCategory && currentLiveCategory.isAddon) {
              loadAddonChannels();
            }
          };
          row.appendChild(delBtn);
          installedBox.appendChild(row);
        })(saved[i], i);
      }
    }
  }

  var addCustomBtn = $('da-btn-add-custom');
  if (addCustomBtn) {
    addCustomBtn._activate = function () {
      var inp = $('da-custom-url');
      var url = inp ? (inp.value || '').trim() : '';
      if (!url || !/^https?:\/\//i.test(url)) {
        addCustomBtn.textContent = 'URL inválida';
        setTimeout(function () { addCustomBtn.textContent = 'Agregar'; }, 2000);
        return;
      }
      addCustomBtn.textContent = 'Descargando…';
      addCustomBtn.disabled = true;
      installAddon({ id: 'custom_' + Date.now(), name: 'Lista Personalizada', url: url }, function (err, count) {
        addCustomBtn.disabled = false;
        if (err) {
          addCustomBtn.textContent = 'Error M3U';
          setTimeout(function () { addCustomBtn.textContent = 'Agregar'; }, 2500);
        } else {
          addCustomBtn.textContent = 'Agregar';
          if (inp) { inp.value = ''; }
          renderAddonsDialog();
          if (currentLiveCategory && currentLiveCategory.isAddon) {
            loadAddonChannels();
          }
        }
      });
    };
  }

  var exitBtn = $('da-btn-exit');
  if (exitBtn) {
    exitBtn._activate = function () { closeAddonsDialog(); };
  }
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
