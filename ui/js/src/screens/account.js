/* screens/account.js — Página "Mi cuenta" del escritorio: perfil local, resumen y accesos directos.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function settingsIndexOf(id) {
  for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
    if (SETTINGS_ITEMS[i].id === id) { return i; }
  }
  return 0;
}

function buildDesktopProfilePanel() {
  var p = el('div', 'settings-panel account-panel acc-desktop');

  var head = el('div', 'acc-head');
  var avatar = el('div', 'acc-avatar');
  avatar.innerHTML = UI_ICONS.user;
  var who = el('div', 'acc-who');
  who.appendChild(el('div', 'acc-name', 'Perfil local'));
  who.appendChild(el('div', 'acc-id', 'ID de este equipo · ' + localProfile.id));
  head.appendChild(avatar);
  head.appendChild(who);
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
