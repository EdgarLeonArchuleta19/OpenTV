/* screens/settings.js — Ajustes: menú, panel de reproducción y opciones.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ============================================================== SETTINGS */
function buildSettings() {
  settingsMenu = $('settings-menu');
  settingsRight = $('settings-right');
  clear(settingsMenu); clear(settingsRight);

  settingsItems = [];
  for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
    var item = el('div', 'settings-item focusable');
    item.innerHTML = '<span class="settings-icon">' + (SETTINGS_MENU_ICONS[SETTINGS_ITEMS[i].id] || '') + '</span>' +
      '<span class="settings-label">' + SETTINGS_ITEMS[i].label + '</span>';
    item._index = i;
    item._activate = (function (idx) {
      return function () { showSettingsPanel(idx, true); };
    })(i);
    item._onMove = function (dir) {
      if (dir === 'right') {
        var f = firstIn(settingsRight.querySelector('.settings-panel.is-active'));
        if (f) { setFocus(f); }
        return true;
      }
      return false;
    };
    settingsMenu.appendChild(item);
    settingsItems.push(item);
  }

  settingsPanels = {};
  settingsPanels.profile = buildProfilePanel();
  settingsPanels.history = buildHistoryPanel();
  settingsPanels.share = buildSharePanel();
  settingsPanels.playback = buildPlaybackPanel();
  settingsPanels.netdiag = buildNetdiagPanel();
  settingsPanels.parent = buildParentPanel();
  settingsPanels.feedback = buildFeedbackPanel();
  settingsPanels.about = buildAboutPanel();

  for (var k in settingsPanels) {
    if (settingsPanels.hasOwnProperty(k)) { settingsRight.appendChild(settingsPanels[k]); }
  }
}

function openSettings() {
  if (!settingsMenu) { buildSettings(); }
  showScreen('settings');
  showSettingsPanel(0, false);
  setFocus(settingsItems[0]);
}

function showSettingsPanel(index, focus) {
  var activeId = (SETTINGS_ITEMS[index] && SETTINGS_ITEMS[index].id) || 'profile';
  var settingsScreen = $('screen-settings');
  if (settingsScreen) { settingsScreen.classList.toggle('is-history-view', activeId === 'history'); }
  if (activeId === 'profile' && settingsPanels.profile && settingsRight) {
    var refreshedProfile = buildProfilePanel();
    settingsRight.replaceChild(refreshedProfile, settingsPanels.profile);
    settingsPanels.profile = refreshedProfile;
  } else if (activeId === 'history' && settingsPanels.history && settingsRight) {
    var refreshedHistory = buildHistoryPanel();
    settingsRight.replaceChild(refreshedHistory, settingsPanels.history);
    settingsPanels.history = refreshedHistory;
  } else if (activeId === 'netdiag' && settingsPanels.netdiag && settingsPanels.netdiag._ensureDiag) {
    settingsPanels.netdiag._ensureDiag();
  }
  for (var i = 0; i < settingsItems.length; i++) {
    settingsItems[i].classList.toggle('is-selected', i === index);
  }
  for (var k in settingsPanels) {
    if (settingsPanels.hasOwnProperty(k)) {
      settingsPanels[k].classList.toggle('is-active', k === activeId);
    }
  }
  if (focus) {
    var f = firstIn(settingsPanels[activeId]);
    /* Panels such as "Sobre nosotros" have no focusable control. In that
       case keep the focus on the selected menu entry instead of leaving a
       different, unrelated entry highlighted. */
    setFocus(f || settingsItems[index]);
  }
}

function panelBase(title) {
  var p = el('div', 'settings-panel');
  p.appendChild(el('div', 'sp-title', title));
  return p;
}

function buildPlaybackPanel() {
  var p = panelBase('Configuración global de reproducción');
  p.appendChild(el('div', 'sp-hr'));

  p.appendChild(el('div', 'sp-global-note', 'Estas preferencias se aplican automáticamente a todas las películas y series nuevas.'));
  addOptionRow(p, 198, window.XUPER_DESKTOP ? 'Calidad' : 'Reproductor',
    window.XUPER_DESKTOP ? ['Automática', 'Compatibilidad máxima'] : ['Normal (directo)', 'Modo fluido'],
    'streamMode', state.playback.streamMode === 'smooth' ? 1 : 0);
  addOptionRow(p, 307, 'Formato de pantalla', ['Pantalla completa', 'Normal', '16:9', '4:3'],
    'screen', state.playback.screen);
  addOptionRow(p, 416, 'Audio preferido', ['Español', 'Portugués', 'Inglés'],
    'audio', state.playback.audio);

  p.appendChild(abs(el('div', 'sp-hr'), 0, 535, 1498, 1));
  p.appendChild(el('div', 'sp-subtitle-h', 'Subtítulos'));
  var sw = el('div', 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off'));
  sw._activate = function () {
    state.playback.subtitle = !state.playback.subtitle;
    sw.className = 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off');
    saveGlobalPlayback();
    setFocus(sw);
  };
  p.appendChild(sw);

  addOptionRow(p, 680, 'Idioma', ['Español', 'Portugués', 'Inglés'],
    'subLang', state.playback.subLang);
  addOptionRow(p, 793, 'Tamaño', ['Normal', 'Grande', 'Pequeño'],
    'size', state.playback.size);
  addStyleRow(p, 906);
  return p;
}

function addOptionRow(panel, top, label, options, group, selected) {
  var row = el('div', 'pb-row');
  row.style.top = top + 'px';
  row.appendChild(el('div', 'pb-label', label));
  for (var i = 0; i < options.length; i++) {
    var opt = el('div', 'pb-opt focusable' + (i === selected ? ' is-checked' : ''));
    opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
    opt.appendChild(el('div', 'radio'));
    opt.appendChild(el('span', null, options[i]));
    opt._group = group;
    opt._index = i;
    opt._activate = function () {
      if (this._group === 'streamMode') {
        state.playback.streamMode = this._index === 1 ? 'smooth' : 'normal';
        /* A deliberate global choice supersedes temporary per-title
           overrides from this session. */
        smoothModeByTitle = {};
        clearCompatTitles();
        if (state.playerItem) { restoreSmoothMode(state.playerItem); }
      } else {
        state.playback[this._group] = this._index;
      }
      applyGlobalPlaybackPreferences();
      saveGlobalPlayback();
      var opts = panel.querySelectorAll('.pb-opt');
      for (var o = 0; o < opts.length; o++) {
        if (opts[o]._group === this._group) {
          opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
        }
      }
    };
    row.appendChild(opt);
  }
  panel.appendChild(row);
}

function addStyleRow(panel, top) {
  var row = el('div', 'pb-row');
  row.style.top = top + 'px';
  row.appendChild(el('div', 'pb-label', 'Estilo'));
  var colors = ['#ffffff', '#f6e33f', '#ffffff'];
  for (var i = 0; i < 3; i++) {
    var opt = el('div', 'pb-opt focusable' + (i === state.playback.style ? ' is-checked' : ''));
    opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
    opt.appendChild(el('div', 'radio'));
    var aa = el('span', null, 'Aa');
    aa.style.color = colors[i];
    if (i === 2) {
      aa.style.background = '#000000';
      aa.style.display = 'inline-block';
      aa.style.width = '94px';
      aa.style.height = '50px';
      aa.style.lineHeight = '50px';
      aa.style.fontSize = '28px';
    }
    opt.appendChild(aa);
    opt._group = 'style';
    opt._index = i;
    opt._activate = function () {
      state.playback.style = this._index;
      applyGlobalPlaybackPreferences();
      saveGlobalPlayback();
      var opts = panel.querySelectorAll('.pb-opt');
      for (var o = 0; o < opts.length; o++) {
        if (opts[o]._group === 'style') {
          opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
        }
      }
    };
    row.appendChild(opt);
  }
  panel.appendChild(row);
}

function buildProfilePanel() {
  var p = el('div', 'settings-panel account-panel');
  var avatar = el('div', 'account-avatar');
  avatar.innerHTML = SETTINGS_MENU_ICONS.profile;
  p.appendChild(avatar);
  p.appendChild(el('div', 'account-number', localProfile.id));
  p.appendChild(el('div', 'account-type', 'Perfil local de este televisor'));
  var summary = el('div', 'account-card');
  summary.appendChild(el('div', 'account-card-title', 'Tu cuenta está lista'));
  summary.appendChild(el('div', 'account-card-text', 'Las preferencias, el historial y el capítulo que estabas viendo se guardan automáticamente en este TV.'));
  p.appendChild(summary);
  var goHistory = el('div', 'account-history-btn focusable', 'Ver mi lista');
  goHistory._activate = function () { showSettingsPanel(1, true); };
  p.appendChild(goHistory);
  var privacy = el('div', 'account-card account-card-small');
  privacy.appendChild(el('div', 'account-card-title', 'Sin registro ni contraseña'));
  privacy.appendChild(el('div', 'account-card-text', 'Este perfil no envía tus datos a ningún servidor.'));
  p.appendChild(privacy);
  return p;
}

function timeAgo(ts) {
  if (!ts) { return ''; }
  var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) { return 'Hace un momento'; }
  if (mins < 60) { return 'Hace ' + mins + ' min'; }
  var hours = Math.round(mins / 60);
  if (hours < 24) { return 'Hace ' + hours + ' h'; }
  var days = Math.round(hours / 24);
  if (days === 1) { return 'Ayer'; }
  if (days < 30) { return 'Hace ' + days + ' días'; }
  return new Date(ts).toLocaleDateString('es');
}
