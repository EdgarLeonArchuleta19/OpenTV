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
  var nameRow = el('div', 'acc-name', me.name);
  /* Stremio mode (PC): say it here too. */
  if (stremioModeOn()) { nameRow.appendChild(el('span', 'mode-pill is-inline', 'Modo Addons')); }
  who.appendChild(nameRow);
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

  /* Counted with the catalog of the current mode (automatic or Stremio),
     the same as the tabs of Mi lista. */
  var titles = libraryRecords('mylist').length;
  var favTitles = libraryRecords('favs').length;
  var watched = (localProfile.history || []).filter(function (r) {
    return r && r.id && libraryModeMatches(r.id, r.stremio);
  }).length;
  var stats = el('div', 'acc-stats');
  [[titles, titles === 1 ? 'Título en Mi lista' : 'Títulos en Mi lista'],
   [favTitles, favTitles === 1 ? 'Favorito' : 'Favoritos'],
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
  liteText.appendChild(el('div', 'acc-action-sub', platformHas('mouse') ? 'Quita desenfoques, animaciones y la tarjeta grande al pasar el ratón. Úsalo si los menús van lentos.'
    : 'Quita desenfoques y animaciones. Úsalo si los menús van lentos.'));
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
  /* (How your data is kept is told in Acerca de.) */
  return p;
}

/* Ajustes → Fuentes: de dónde salen las películas y series (solo PC) y las
   listas M3U de TV en vivo. Diseño corto: un selector, listas y un campo. */
function buildSourcesPanel() {
  var page = desktopSettingsPage('sd-sources scrollable', 'Fuentes', '');
  page.body.appendChild(buildContentSourcesSection());
  return page.panel;
}

/* What an installed addon offers, as short chips. */
function addonOffers(ad) {
  if (ad.kind === 'm3u') { return 'Lista M3U'; }
  if (ad.kind === 'json') { return 'Catálogo'; }
  var names = { catalog: 'Catálogo', stream: 'Fuentes', subtitles: 'Subtítulos' };
  var out = [];
  var res = ad.resources || [];
  for (var i = 0; i < res.length; i++) {
    var label = names[res[i].name];
    if (label && out.indexOf(label) === -1) { out.push(label); }
  }
  return out.join(' · ');
}

function addonHas(ad, name) {
  if (ad.kind === 'm3u' || ad.kind === 'json') { return name === 'catalog'; }
  var res = ad.resources || [];
  for (var i = 0; i < res.length; i++) { if (res[i].name === name) { return true; } }
  return false;
}

var FX_ICONS = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

function fxIconButton(icon, tip, run, danger) {
  var b = el('div', 'fx-icon focusable' + (danger ? ' is-danger' : ''));
  b.innerHTML = icon;
  b.setAttribute('data-tip', tip);
  b.setAttribute('aria-label', tip);
  b._activate = run;
  return b;
}

/* Section title + optional right-side note. */
function fxSection(title) {
  var sec = el('section', 'fx-section');
  sec.appendChild(el('h3', 'fx-title', title));
  return sec;
}

/* Text field + button; Enter adds too. */
function fxAddRow(placeholder, label, run) {
  var row = el('div', 'fx-add');
  var input = document.createElement('input');
  input.type = 'text';
  input.className = 'fx-input focusable';
  input.placeholder = placeholder;
  input.spellcheck = false;
  var btn = el('div', 'fx-btn focusable', label);
  btn._activate = function () { run(input, btn); };
  input.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.keyCode === 13) { ev.preventDefault(); btn._activate(); }
  });
  row.appendChild(input);
  row.appendChild(btn);
  return row;
}

function fxRow(iconUrl, name, meta, actions) {
  var row = el('div', 'fx-row');
  var logo = el('div', 'fx-logo');
  if (iconUrl) {
    var img = document.createElement('img');
    img.alt = '';
    img.src = iconUrl;
    img.onerror = function () { logo.textContent = (name || '?').charAt(0).toUpperCase(); this.remove(); };
    logo.appendChild(img);
  } else {
    logo.textContent = (name || '?').charAt(0).toUpperCase();
  }
  row.appendChild(logo);
  var text = el('div', 'fx-text');
  text.appendChild(el('div', 'fx-name', name));
  if (meta) { text.appendChild(el('div', 'fx-meta', meta)); }
  row.appendChild(text);
  actions.forEach(function (a) { row.appendChild(a); });
  return row;
}

function buildContentSourcesSection() {
  var wrap = el('div', 'fx-wrap');
  if (platformHas('addons')) { wrap.appendChild(buildMoviesSourcesSection()); }
  wrap.appendChild(buildLiveSourcesSection());
  return wrap;
}

/* Películas y series (PC): two mode cards, and the addons. */
function buildMoviesSourcesSection() {
  var sec = fxSection('Películas y series');
  var seg = el('div', 'fx-modes');
  var list = el('div', 'fx-list');
  var warn = el('div', 'fx-warn', '');
  var msg = el('div', 'fx-msg', '');
  var busy = false;

  function say(text, kind) { msg.textContent = text || ''; msg.className = 'fx-msg' + (kind ? ' is-' + kind : ''); }

  var modes = [
    { id: 'auto', label: 'Automático', badge: 'Recomendado', hint: 'El catálogo de OpenTV, listo para ver.' },
    { id: 'external', label: 'Addons', hint: 'Tus addons (compatibles con Stremio). Eliges la fuente al reproducir.' }
  ];
  modes.forEach(function (m) {
    var b = el('div', 'fx-mode focusable');
    var head = el('div', 'fx-mode-head');
    head.appendChild(el('span', 'fx-mode-radio'));
    head.appendChild(el('span', 'fx-mode-title', m.label));
    if (m.badge) { head.appendChild(el('span', 'fx-mode-badge', m.badge)); }
    b.appendChild(head);
    b.appendChild(el('div', 'fx-mode-desc', m.hint));
    b._mode = m.id;
    b.setAttribute('role', 'radio');
    b._activate = function () {
      if (busy || getVodSourcesConfig().mode === m.id) { return; }
      function apply() {
        busy = true;
        say('Cargando…', '');
        applyVodSourceMode(m.id, function (err, count) {
          busy = false;
          if (err) { say(err, 'err'); } else { say(m.id === 'external' ? count + ' títulos de tus addons.' : '', 'ok'); }
          paint();
        });
      }
      /* Stremio: first say what this mode depends on. */
      if (m.id === 'external') { openStremioModeNotice(getVodSourcesConfig().addons, apply); } else { apply(); }
    };
    seg.appendChild(b);
  });

  function paint() {
    var cfg = getVodSourcesConfig();
    var btns = seg.querySelectorAll('.fx-mode');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i]._mode === cfg.mode;
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    renderAddons(cfg);
  }

  function renderAddons(cfg) {
    clear(list);
    cfg.addons.forEach(function (ad, idx) {
      var actions = [];
      if (ad.configurable && ad.baseUrl && window.desktop && window.desktop.openAddonConfig) {
        actions.push(fxIconButton(FX_ICONS.gear, 'Configurar en el navegador', function () {
          window.desktop.openAddonConfig(ad.baseUrl + '/configure');
          say('Al terminar, pega aquí la URL nueva que te dé el addon.', '');
        }));
      }
      if (idx > 0) {
        actions.push(fxIconButton(FX_ICONS.up, 'Subir (sus filas y fuentes salen antes)', function () {
          var c = getVodSourcesConfig();
          c.addons.splice(idx - 1, 0, c.addons.splice(idx, 1)[0]);
          saveVodSourcesConfig(c);
          paint();
          if (stremioModeOn()) { syncExternalVodCatalogs(function () {}); }
        }));
      }
      actions.push(fxIconButton(FX_ICONS.remove, 'Quitar', function () {
        var c = getVodSourcesConfig();
        var manual = c.mode === 'external';
        c.addons.splice(idx, 1);
        if (!c.addons.length) { c.mode = 'auto'; }
        saveVodSourcesConfig(c);
        if (manual) { applyVodSourceMode(c.addons.length ? 'external' : 'auto', paint); } else { paint(); }
      }, true));
      list.appendChild(fxRow(ad.logo, ad.name || 'Addon', addonOffers(ad), actions));
    });
    /* What is missing for the manual mode to work. */
    var hasCatalog = cfg.addons.some(function (ad) { return addonHas(ad, 'catalog'); });
    var hasStream = cfg.addons.some(function (ad) { return addonHas(ad, 'stream') || ad.kind === 'm3u'; });
    /* Only Modo Addons depends on them (Automático has its own catalog). */
    warn.textContent = !cfg.addons.length || cfg.mode !== 'external' ? ''
      : (!hasCatalog ? 'Falta un addon con Catálogo: sin él no hay películas ni series que mostrar.'
        : (!hasStream ? 'Falta un addon con Fuentes: sin él no hay nada que reproducir.' : ''));
    warn.hidden = !warn.textContent;
  }

  var add = fxAddRow('URL del addon (…/manifest.json)', 'Agregar', function (input, btn) {
    var url = (input.value || '').trim();
    if (!url) { return say('Pega la URL de un addon (compatible con Stremio).', 'err'); }
    btn.textContent = 'Agregando…';
    installVodAddon({ url: url }, function (err, count, info) {
      btn.textContent = 'Agregar';
      if (err) { return say('No se pudo agregar: ' + err, 'err'); }
      input.value = '';
      say('✔ ' + info.name + (stremioModeOn() && count ? ' · ' + count + ' títulos' : ''), 'ok');
      paint();
    });
  });

  sec.appendChild(seg);
  sec.appendChild(list);
  sec.appendChild(warn);
  sec.appendChild(add);
  sec.appendChild(msg);
  paint();
  /* Addons saved with only their URL (the preinstalled ones): read their
     manifests once for the logo and what they offer. */
  refreshAddonManifests(getVodSourcesConfig(), function () { if (sec.isConnected) { paint(); } });
  return sec;
}

/* TV en vivo: the user's M3U lists. */
function buildLiveSourcesSection() {
  var sec = fxSection('TV en vivo');
  var list = el('div', 'fx-list');
  var msg = el('div', 'fx-msg', '');
  function say(text, kind) { msg.textContent = text || ''; msg.className = 'fx-msg' + (kind ? ' is-' + kind : ''); }

  function render() {
    clear(list);
    getSavedAddons().forEach(function (ad, idx) {
      list.appendChild(fxRow('', ad.name || 'Lista M3U', ad.count ? ad.count + ' canales' : '', [
        fxIconButton(FX_ICONS.remove, 'Quitar', function () {
          var current = getSavedAddons();
          current.splice(idx, 1);
          saveSavedAddons(current);
          render();
          if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
        }, true)
      ]));
    });
  }

  var add = fxAddRow('URL de una lista .m3u', 'Agregar', function (input, btn) {
    var url = (input.value || '').trim();
    if (!/^https?:\/\//i.test(url)) { return say('La URL debe empezar con http:// o https://', 'err'); }
    btn.textContent = 'Agregando…';
    installAddon({ id: 'custom_' + Date.now(), name: 'Lista M3U', url: url }, function (err, count) {
      btn.textContent = 'Agregar';
      if (err) { return say('No se pudo cargar: ' + err, 'err'); }
      input.value = '';
      say('✔ ' + count + ' canales', 'ok');
      render();
      if (currentLiveCategory && currentLiveCategory.isAddon) { loadAddonChannels(); }
    });
  });

  /* Buscar: the preloaded free lists (live/addons-dialog.js). */
  var search = el('div', 'fx-btn is-ghost is-search focusable', 'Buscar');
  search.setAttribute('data-tip', 'Listas de TV recomendadas');
  search._activate = function () { openAddonsDialog(); };
  add.appendChild(search);

  sec.appendChild(list);
  sec.appendChild(add);
  sec.appendChild(msg);
  render();
  return sec;
}
