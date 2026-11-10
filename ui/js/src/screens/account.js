/* screens/account.js — Página "Mi cuenta" del escritorio: perfil local, resumen y accesos directos.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function settingsIndexOf(id) {
  for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
    if (SETTINGS_ITEMS[i].id === id) { return i; }
  }
  return 0;
}

function buildDesktopProfilePanel() {
  var p = el('div', 'settings-panel account-panel acc-desktop scrollable');

  var head = el('div', 'acc-head');
  var me = activeProfile();
  var avatar = el('div', 'acc-avatar is-profile');
  avatar.innerHTML = avatarSvg(me.avatar);
  var who = el('div', 'acc-who');
  who.appendChild(el('div', 'acc-name', me.name));
  who.appendChild(el('div', 'acc-id', (me.kids ? 'Perfil infantil · ' : '') + 'Guardado solo en este equipo'));
  head.appendChild(avatar);
  head.appendChild(who);
  var headActions = el('div', 'acc-head-actions');
  [['Cambiar de perfil', function () { showProfilePicker(false); }],
   ['Editar perfil', function () { openProfileEditor(activeProfile()); }],
   ['Administrar perfiles', function () { showProfilePicker(true); }]].forEach(function (b) {
    var btn = el('div', 'acc-seg-btn focusable', b[0]);
    btn._activate = b[1];
    headActions.appendChild(btn);
  });
  head.appendChild(headActions);
  p.appendChild(head);

  var titles = 0, channels = 0;
  for (var key in state.favs) {
    if (Object.prototype.hasOwnProperty.call(state.favs, key)) {
      if (String(key).indexOf('live:') === 0) { channels++; } else { titles++; }
    }
  }
  var watched = (localProfile.history || []).length;
  var stats = el('div', 'acc-stats');
  [[titles, titles === 1 ? 'Título en tu lista' : 'Títulos en tu lista'],
   [channels, channels === 1 ? 'Canal favorito' : 'Canales favoritos'],
   [watched, watched === 1 ? 'Visto recientemente' : 'Vistos recientemente']].forEach(function (s) {
    var tile = el('div', 'acc-stat');
    tile.appendChild(el('div', 'acc-stat-num', String(s[0])));
    tile.appendChild(el('div', 'acc-stat-label', s[1]));
    stats.appendChild(tile);
  });
  p.appendChild(stats);

  p.appendChild(el('div', 'acc-section', 'Accesos rápidos'));
  var actions = el('div', 'acc-actions');
  [
    { icon: UI_ICONS.mylist, title: 'Mi lista', text: 'Películas y series que guardaste', run: function () { showSettingsPanel(settingsIndexOf('history'), true); } },
    { icon: UI_ICONS.history, title: 'Historial', text: 'Sigue donde lo dejaste', run: function () { openHistoryView(); } },
    { icon: UI_ICONS.settings, title: 'Reproducción', text: 'Calidad, idioma y subtítulos', run: function () { showSettingsPanel(settingsIndexOf('playback'), true); } }
  ].forEach(function (a) {
    var card = el('div', 'acc-action focusable');
    var ic = el('div', 'acc-action-icon');
    ic.innerHTML = a.icon;
    var tx = el('div', 'acc-action-text');
    tx.appendChild(el('div', 'acc-action-title', a.title));
    tx.appendChild(el('div', 'acc-action-sub', a.text));
    var chevron = el('div', 'acc-action-chevron');
    chevron.innerHTML = UI_ICONS.back;
    card.appendChild(ic);
    card.appendChild(tx);
    card.appendChild(chevron);
    card._activate = a.run;
    actions.appendChild(card);
  });
  p.appendChild(actions);

  p.appendChild(el('div', 'acc-section', 'Apariencia'));
  var look = el('div', 'acc-appearance');
  var lookText = el('div', 'acc-action-text');
  lookText.appendChild(el('div', 'acc-action-title', 'Tamaño de los pósteres'));
  lookText.appendChild(el('div', 'acc-action-sub', 'Compacto muestra más títulos en cada fila'));
  look.appendChild(lookText);
  var seg = el('div', 'acc-seg');
  [['Normal', false], ['Compacto', true]].forEach(function (o) {
    var b = el('div', 'acc-seg-btn focusable' + (catalogCompact() === o[1] ? ' is-selected' : ''), o[0]);
    b._activate = function () {
      setCatalogDensity(o[1]);
      var all = seg.querySelectorAll('.acc-seg-btn');
      for (var i = 0; i < all.length; i++) { all[i].classList.toggle('is-selected', all[i] === b); }
    };
    seg.appendChild(b);
  });
  look.appendChild(seg);
  p.appendChild(look);

  /* Modo ligero (core/lite.js). */
  var lite = el('div', 'acc-appearance');
  var liteText = el('div', 'acc-action-text');
  liteText.appendChild(el('div', 'acc-action-title', 'Modo ligero'));
  liteText.appendChild(el('div', 'acc-action-sub', 'Quita desenfoques, animaciones y la tarjeta grande al pasar el ratón. Úsalo si los menús van lentos.'));
  lite.appendChild(liteText);
  var liteSeg = el('div', 'acc-seg');
  [['Apagado', false], ['Encendido', true]].forEach(function (o) {
    var b = el('div', 'acc-seg-btn focusable' + (liteMode() === o[1] ? ' is-selected' : ''), o[0]);
    b._activate = function () {
      setLiteMode(o[1]);
      var all = liteSeg.querySelectorAll('.acc-seg-btn');
      for (var i = 0; i < all.length; i++) { all[i].classList.toggle('is-selected', all[i] === b); }
    };
    liteSeg.appendChild(b);
  });
  lite.appendChild(liteSeg);
  p.appendChild(lite);

  p.appendChild(el('div', 'acc-section', 'Privacidad'));

  var privacy = el('div', 'acc-privacy');
  var lock = el('div', 'acc-privacy-icon');
  lock.innerHTML = UI_ICONS.lock;
  var ptext = el('div', 'acc-privacy-text');
  ptext.appendChild(el('b', null, 'Sin registro ni contraseña'));
  ptext.appendChild(el('span', null, 'Tu lista, el historial y tus preferencias se guardan solo en este equipo; no se envían a ningún servidor.'));
  privacy.appendChild(lock);
  privacy.appendChild(ptext);
  p.appendChild(privacy);
  return p;
}

/* Ajustes → Fuentes (opción dedicada en la barra lateral de Ajustes) */
function buildSourcesPanel() {
  var page = desktopSettingsPage(
    'sd-sources scrollable',
    'Fuentes',
    'Elige de dónde saca OpenTV las películas y series, y conecta tus listas M3U o addons de Stremio.'
  );
  page.body.appendChild(buildContentSourcesSection());
  return page.panel;
}

/* Tarjeta "Modo del catálogo": tres opciones con descripción. Al elegir una
   se guarda y el catálogo se recarga al momento (no hace falta reiniciar). */
function buildSourceModeCard(onChange) {
  var card = el('div', 'acc-source-card');
  var text = el('div', 'acc-action-text');
  text.appendChild(el('div', 'acc-action-title', 'Modo del catálogo'));
  text.appendChild(el('div', 'acc-action-sub', 'Decide de dónde salen las películas y series. Al cambiar, el catálogo se recarga solo.'));
  card.appendChild(text);

  var grid = el('div', 'acc-mode-grid');
  var status = el('div', 'acc-source-msg', '');
  var busy = false;

  function paint() {
    var current = getVodSourcesConfig().mode;
    var opts = grid.querySelectorAll('.acc-mode-opt');
    for (var k = 0; k < opts.length; k++) {
      var sel = opts[k]._mode === current;
      opts[k].classList.toggle('is-selected', sel);
      opts[k].setAttribute('aria-checked', sel ? 'true' : 'false');
    }
  }

  VOD_SOURCE_MODES.forEach(function (m) {
    var opt = el('div', 'acc-mode-opt focusable');
    opt._mode = m.id;
    opt.setAttribute('role', 'radio');
    var head = el('div', 'acc-mode-head');
    head.appendChild(el('span', 'acc-mode-radio'));
    head.appendChild(el('span', 'acc-mode-title', m.title));
    if (m.badge) { head.appendChild(el('span', 'acc-mode-badge', m.badge)); }
    opt.appendChild(head);
    opt.appendChild(el('div', 'acc-mode-desc', m.desc));
    opt._activate = function () {
      if (busy || getVodSourcesConfig().mode === m.id) { return; }
      busy = true;
      card.classList.add('is-busy');
      status.textContent = 'Recargando catálogo…';
      status.className = 'acc-source-msg';
      applyVodSourceMode(m.id, function (err, count) {
        busy = false;
        card.classList.remove('is-busy');
        paint();
        if (err) {
          status.textContent = err;
          status.className = 'acc-source-msg is-err';
        } else {
          status.textContent = m.id === 'external'
            ? '✔ Modo manual activo: ' + count + ' títulos de tus addons de Stremio.'
            : (m.id === 'portal'
                ? '✔ Modo servidor activo: catálogo recargado desde el servidor principal.'
                : '✔ Respaldo automático activo: servidor principal con tus addons de respaldo.');
          status.className = 'acc-source-msg is-ok';
        }
        if (onChange) { onChange(); }
      });
    };
    grid.appendChild(opt);
  });
  card.appendChild(grid);
  card.appendChild(status);
  paint();
  card._paint = paint;
  return card;
}

function buildContentSourcesSection() {
  var wrap = el('div', 'acc-sources-wrap');
  var modeCard = buildSourceModeCard(function () { renderVodSources(); });
  wrap.appendChild(modeCard);

  /* --- 1. Tarjeta de TV en Vivo (M3U / IPTV) --- */
  var tvCard = el('div', 'acc-source-card');
  var tvHead = el('div', 'acc-source-head');
  var tvText = el('div', 'acc-action-text');
  tvText.appendChild(el('div', 'acc-action-title', 'Televisión en Vivo · Listas M3U / IPTV'));
  var tvSub = el('div', 'acc-action-sub', '');
  tvText.appendChild(tvSub);
  tvHead.appendChild(tvText);

  var tvCatalogBtn = el('div', 'acc-seg-btn focusable is-selected', 'Listas recomendadas (1-Clic)');
  tvCatalogBtn._activate = function () { openAddonsDialog(); };
  tvHead.appendChild(tvCatalogBtn);
  tvCard.appendChild(tvHead);

  var tvInputRow = el('div', 'acc-source-input-row');
  var tvInput = document.createElement('input');
  tvInput.type = 'text';
  tvInput.className = 'acc-source-input focusable';
  tvInput.placeholder = 'Pega aquí un enlace .m3u o .m3u8 de canales de TV (https://ejemplo.com/lista.m3u)…';
  tvInput.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.keyCode === 13) {
      ev.preventDefault();
      if (tvAddBtn._activate) { tvAddBtn._activate(); }
    }
  });
  var tvAddBtn = el('div', 'acc-seg-btn focusable is-selected', '+ Agregar M3U');
  var tvStatus = el('div', 'acc-source-msg', '');
  tvInputRow.appendChild(tvInput);
  tvInputRow.appendChild(tvAddBtn);
  tvCard.appendChild(tvInputRow);
  tvCard.appendChild(tvStatus);

  var tvList = el('div', 'acc-source-list');
  tvCard.appendChild(tvList);

  function renderTvSources() {
    var saved = getSavedAddons();
    var totalCh = 0;
    for (var c = 0; c < saved.length; c++) { totalCh += (parseInt(saved[c].count, 10) || 0); }
    tvSub.textContent = saved.length
      ? (saved.length + (saved.length === 1 ? ' lista M3U activa' : ' listas M3U activas') + (totalCh ? (' · ' + totalCh + ' canales extra disponibles en la categoría Addons M3U') : ''))
      : 'Si el servidor de TV falla o quieres sumar tus propios canales IPTV, agrega cualquier enlace M3U/M3U8.';
    clear(tvList);
    for (var i = 0; i < saved.length; i++) {
      (function (ad, idx) {
        var row = el('div', 'acc-source-item');
        var info = el('div', 'acc-source-item-info');
        info.appendChild(el('div', 'acc-source-item-name', ad.name || 'Lista M3U'));
        info.appendChild(el('div', 'acc-source-item-meta', (ad.count ? (ad.count + ' canales · ') : '') + ad.url));
        row.appendChild(info);
        var del = el('div', 'acc-seg-btn is-danger focusable', 'Quitar');
        del._activate = function () {
          var current = getSavedAddons();
          current.splice(idx, 1);
          saveSavedAddons(current);
          renderTvSources();
          if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
        };
        row.appendChild(del);
        tvList.appendChild(row);
      })(saved[i], i);
    }
  }

  tvAddBtn._activate = function () {
    var url = (tvInput.value || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      tvStatus.textContent = 'Escribe una URL válida que empiece con http:// o https://';
      tvStatus.className = 'acc-source-msg is-err';
      return;
    }
    tvAddBtn.textContent = 'Descargando…';
    tvStatus.textContent = 'Verificando lista M3U…';
    tvStatus.className = 'acc-source-msg';
    installAddon({ id: 'custom_' + Date.now(), name: 'Lista M3U Personalizada', url: url }, function (err, count) {
      tvAddBtn.textContent = '+ Agregar M3U';
      if (err) {
        tvStatus.textContent = 'No se pudo cargar la lista: ' + err;
        tvStatus.className = 'acc-source-msg is-err';
      } else {
        tvInput.value = '';
        tvStatus.textContent = '✔ Lista agregada con éxito (' + count + ' canales).';
        tvStatus.className = 'acc-source-msg is-ok';
        renderTvSources();
        if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
      }
    });
  };
  renderTvSources();
  wrap.appendChild(tvCard);

  /* --- 2. Tarjeta de Películas y Series (Stremio Addons / Catálogo Externo) --- */
  var vodCard = el('div', 'acc-source-card');
  var vodHead = el('div', 'acc-source-head');
  var vodText = el('div', 'acc-action-text');
  vodText.appendChild(el('div', 'acc-action-title', 'Películas y Series · Addons de Stremio y Fuentes Externas'));
  var vodSub = el('div', 'acc-action-sub', '');
  vodText.appendChild(vodSub);
  vodHead.appendChild(vodText);
  vodCard.appendChild(vodHead);

  var vodInputRow = el('div', 'acc-source-input-row');
  var vodInput = document.createElement('input');
  vodInput.type = 'text';
  vodInput.className = 'acc-source-input focusable';
  vodInput.placeholder = 'Pega un addon de Stremio (https://.../manifest.json o stremio://...) o catálogo .json / .m3u…';
  vodInput.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.keyCode === 13) {
      ev.preventDefault();
      if (vodAddBtn._activate) { vodAddBtn._activate(); }
    }
  });
  var vodAddBtn = el('div', 'acc-seg-btn focusable is-selected', '+ Conectar Addon');
  var vodSyncBtn = el('div', 'acc-seg-btn focusable', 'Sincronizar');
  vodInputRow.appendChild(vodInput);
  vodInputRow.appendChild(vodAddBtn);
  vodInputRow.appendChild(vodSyncBtn);
  vodCard.appendChild(vodInputRow);

  var vodStatus = el('div', 'acc-source-msg', '');
  vodCard.appendChild(vodStatus);

  var vodPresetsRow = el('div', 'acc-source-presets');
  vodCard.appendChild(vodPresetsRow);

  var vodList = el('div', 'acc-source-list');
  vodCard.appendChild(vodList);

  function renderVodSources() {
    var cfg = getVodSourcesConfig();
    var installedUrls = {};
    var totalTitles = 0;
    for (var i = 0; i < cfg.addons.length; i++) {
      installedUrls[cfg.addons[i].url] = true;
      totalTitles += (parseInt(cfg.addons[i].count, 10) || 0);
    }
    var modeDesc = cfg.mode === 'external'
      ? 'Modo manual: el catálogo sale solo de estos addons.'
      : (cfg.mode === 'portal'
          ? 'Modo servidor: estos addons quedan guardados pero no se usan.'
          : 'Respaldo automático: si el servidor principal falla, OpenTV usará estos addons.');
    vodSub.textContent = modeDesc + (cfg.addons.length ? (' · ' + cfg.addons.length + ' fuente(s) conectada(s) (' + totalTitles + ' títulos)') : '');

    clear(vodPresetsRow);
    for (var p = 0; p < PRESET_VOD_ADDONS.length; p++) {
      (function (preset) {
        var isInst = !!installedUrls[preset.url];
        var pb = el('div', 'acc-seg-btn acc-preset-pill focusable' + (isInst ? ' is-installed' : ''),
          (isInst ? '✔ ' : '+ Instalar ') + preset.name);
        pb._activate = function () {
          if (isInst) { return; }
          pb.textContent = 'Conectando…';
          installVodAddon(preset, function (err, count) {
            if (err) {
              vodStatus.textContent = 'Error al instalar ' + preset.name + ': ' + err;
              vodStatus.className = 'acc-source-msg is-err';
            } else {
              vodStatus.textContent = '✔ ' + preset.name + ' conectado (' + count + ' títulos sincronizados).';
              vodStatus.className = 'acc-source-msg is-ok';
            }
            renderVodSources();
          });
        };
        vodPresetsRow.appendChild(pb);
      })(PRESET_VOD_ADDONS[p]);
    }

    clear(vodList);
    for (var a = 0; a < cfg.addons.length; a++) {
      (function (ad, idx) {
        var row = el('div', 'acc-source-item');
        var info = el('div', 'acc-source-item-info');
        info.appendChild(el('div', 'acc-source-item-name', ad.name || 'Addon Stremio'));
        info.appendChild(el('div', 'acc-source-item-meta',
          (ad.kind === 'stremio' ? 'Stremio · ' : '') +
          (ad.count ? (ad.count + ' títulos · ') : '') + ad.url));
        row.appendChild(info);
        var del = el('div', 'acc-seg-btn is-danger focusable', 'Quitar');
        del._activate = function () {
          var current = getVodSourcesConfig();
          current.addons.splice(idx, 1);
          saveVodSourcesConfig(current);
          renderVodSources();
          /* En modo manual, el catálogo se rehace sin ese addon; si ya no
             queda ninguno, se vuelve al respaldo automático. */
          if (current.mode === 'external') {
            applyVodSourceMode(current.addons.length ? 'external' : 'auto', function () {
              if (modeCard._paint) { modeCard._paint(); }
              renderVodSources();
            });
          }
        };
        row.appendChild(del);
        vodList.appendChild(row);
      })(cfg.addons[a], a);
    }
  }

  vodAddBtn._activate = function () {
    var rawUrl = (vodInput.value || '').trim();
    if (!rawUrl) {
      vodStatus.textContent = 'Pega la URL de un addon de Stremio (manifest.json) o catálogo externo.';
      vodStatus.className = 'acc-source-msg is-err';
      return;
    }
    vodAddBtn.textContent = 'Conectando…';
    vodStatus.textContent = 'Consultando addon y descargando catálogo…';
    vodStatus.className = 'acc-source-msg';
    installVodAddon({ url: rawUrl }, function (err, count, meta) {
      vodAddBtn.textContent = '+ Conectar Addon';
      if (err) {
        vodStatus.textContent = 'No se pudo conectar el addon: ' + err;
        vodStatus.className = 'acc-source-msg is-err';
      } else {
        vodInput.value = '';
        vodStatus.textContent = '✔ Addon "' + ((meta && meta.name) || 'Stremio') + '" conectado (' + count + ' títulos cargados).';
        vodStatus.className = 'acc-source-msg is-ok';
        renderVodSources();
      }
    });
  };

  vodSyncBtn._activate = function () {
    var cfg = getVodSourcesConfig();
    if (!cfg.addons.length) {
      vodStatus.textContent = 'Primero instala o conecta al menos un addon de Stremio arriba.';
      vodStatus.className = 'acc-source-msg is-err';
      return;
    }
    if (cfg.mode === 'portal') {
      vodStatus.textContent = 'Estás en Modo servidor: los addons no se usan. Cambia a Respaldo automático o Modo manual arriba.';
      vodStatus.className = 'acc-source-msg is-err';
      return;
    }
    vodSyncBtn.textContent = 'Sincronizando…';
    syncExternalVodCatalogs(function (err, count) {
      vodSyncBtn.textContent = 'Sincronizar';
      vodStatus.textContent = '✔ Catálogo externo sincronizado (' + (count || 0) + ' títulos disponibles en Inicio).';
      vodStatus.className = 'acc-source-msg is-ok';
      renderVodSources();
    }, true);
  };

  renderVodSources();
  wrap.appendChild(vodCard);
  return wrap;
}
