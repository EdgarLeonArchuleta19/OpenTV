/* home/live-dock.js — Barra de controles de la TV del inicio: volumen, favoritos y países/temas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Desktop: sound for the home TV preview, a control bar and category
   chips under the video (the TV app kept this preview muted).
   ------------------------------------------------------------------ */
var liveDock = null, liveDockCats = null, liveMuteBtn = null, liveVolLabel = null, liveFavBtn = null;
var liveAudio = { muted: false, volume: 0.8 };

var LIVE_DOCK_ICONS = {
  prev: UI_ICONS.prev,
  next: UI_ICONS.next,
  sound: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  soundLow: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/>'),
  mute: uiSvg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>',
  star: UI_ICONS.star,
  full: UI_ICONS.fullscreen,
  guide: uiSvg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>'),
  schedule: uiSvg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h4M7.5 17h7"/>')
};
var liveVolRange = null;
var liveVolToast = null;
var liveVolToastTimer = null;

function loadLiveAudio() {
  var saved = safeLocalRead('opentv_live_audio_v1', null);
  if (saved) {
    liveAudio.muted = !!saved.muted;
    if (typeof saved.volume === 'number') { liveAudio.volume = Math.max(0, Math.min(1, saved.volume)); }
  }
}
/* Desktop: when the system volume is available the TV slider and mute
   button act on Windows itself (the taskbar speaker), and the videos play at
   full level so the slider means the real loudness. */
var systemVolumeOn = false;
var systemVolumeTimer = null;
var systemVolumePending = null;
function systemVolumeApi() {
  return window.OPENTV_DESKTOP && window.desktop && window.desktop.systemVolume ? window.desktop.systemVolume : null;
}
function syncFromSystemVolume() {
  var api = systemVolumeApi();
  if (!api || systemVolumePending !== null) { return; }
  api('get').then(function (r) {
    if (!r || r.error || typeof r.volume !== 'number' || systemVolumePending !== null) { return; }
    /* The first answer always applies: the videos go to full level. */
    var first = !systemVolumeOn;
    systemVolumeOn = true;
    if (first || Math.abs(r.volume - liveAudio.volume) > 0.004 || r.muted !== liveAudio.muted) {
      liveAudio.volume = r.volume;
      liveAudio.muted = r.muted;
      applyLiveAudio(false);
    }
  }).catch(function () {});
}
function pushSystemVolume() {
  var api = systemVolumeApi();
  if (!api || !systemVolumeOn) { return; }
  systemVolumePending = { volume: liveAudio.volume, muted: liveAudio.muted };
  if (systemVolumeTimer) { return; }
  systemVolumeTimer = setTimeout(function () {
    systemVolumeTimer = null;
    var want = systemVolumePending;
    api('set', want.volume).then(function () { return api('mute', want.muted); }).then(function () {
      if (systemVolumePending === want) { systemVolumePending = null; }
      else { systemVolumePending = null; pushSystemVolume(); }
    }).catch(function () { systemVolumePending = null; });
  }, 60);
}
/* Once, at start (main.js) and again from the TV page (harmless): the app
   plays at full level and its volume is Windows' own, everywhere. */
var systemVolumeStarted = false;
function startSystemVolumeSync() {
  if (!systemVolumeApi() || systemVolumeStarted) { return; }
  systemVolumeStarted = true;
  syncFromSystemVolume();
  /* Follow changes made with the keyboard volume keys or the taskbar. */
  setInterval(function () {
    if (((state.screen === 'home' && onTvTab()) || state.screen === 'player') && document.hasFocus()) { syncFromSystemVolume(); }
  }, 2500);
}

function applyLiveAudio(save) {
  if (systemVolumeOn) {
    if (livePreviewVideo) { livePreviewVideo.muted = false; livePreviewVideo.volume = 1; livePreviewVideo.removeAttribute('muted'); }
    if (playerVideo) { playerVideo.volume = 1; if (liveHandoff && liveHandoff.type === 'player') { playerVideo.muted = false; } }
  } else if (livePreviewVideo) {
    livePreviewVideo.muted = liveAudio.muted;
    livePreviewVideo.volume = liveAudio.volume;
    if (liveAudio.muted) { livePreviewVideo.setAttribute('muted', 'muted'); } else { livePreviewVideo.removeAttribute('muted'); }
  }
  if (playerVideo && !systemVolumeOn) {
    playerVideo.volume = liveAudio.volume;
    /* While the player's video stands in for the home preview it follows the
       preview's mute button. */
    if (liveHandoff && liveHandoff.type === 'player') { playerVideo.muted = liveAudio.muted; }
  }
  var off = liveAudio.muted || liveAudio.volume === 0;
  var pct = Math.round(liveAudio.volume * 100);
  if (liveMuteBtn) {
    var muteSvg = off ? LIVE_DOCK_ICONS.mute : (liveAudio.volume < 0.5 ? LIVE_DOCK_ICONS.soundLow : LIVE_DOCK_ICONS.sound);
    var muteIco = liveMuteBtn.querySelector('.live-dock-ico');
    if (muteIco) { muteIco.innerHTML = muteSvg; }
    else { liveMuteBtn.innerHTML = '<i class="live-dock-ico">' + muteSvg + '</i>'; }
    liveMuteBtn.setAttribute('data-tip', off ? 'Activar sonido (M)' : 'Silenciar (M)');
    liveMuteBtn.classList.toggle('is-off', off);
  }
  if (liveVolLabel) { liveVolLabel.textContent = off ? 'Sin sonido' : pct + '%'; }
  if (liveVolRange) {
    var shown = off ? 0 : pct;
    if (String(liveVolRange.value) !== String(shown)) { liveVolRange.value = shown; }
    liveVolRange.style.setProperty('--vol', shown + '%');
  }
  if (save) {
    if (systemVolumeOn) { pushSystemVolume(); }
    else { safeLocalWrite('opentv_live_audio_v1', liveAudio); }
  }
  if (window.OPENTV_DESKTOP) { applyPlayerAudio(); }
}
function changeLiveVolume(delta) {
  liveAudio.volume = Math.max(0, Math.min(1, Math.round((liveAudio.volume + delta) * 20) / 20));
  if (delta > 0) { liveAudio.muted = false; }
  applyLiveAudio(true);
  showLiveVolumeToast();
}

/* Small "volume" pill over the preview while it changes. */
function showLiveVolumeToast() {
  var host = state.screen === 'player' ? playerStage : liveMain;
  if (!window.OPENTV_DESKTOP || !host) { return; }
  if (!liveVolToast || liveVolToast.parentNode !== host) {
    if (liveVolToast && liveVolToast.parentNode) { liveVolToast.parentNode.removeChild(liveVolToast); }
    liveVolToast = el('div', 'live-vol-toast');
    host.appendChild(liveVolToast);
  }
  var off = liveAudio.muted || liveAudio.volume === 0;
  var pct = off ? 0 : Math.round(liveAudio.volume * 100);
  liveVolToast.innerHTML = (off ? LIVE_DOCK_ICONS.mute : LIVE_DOCK_ICONS.sound) +
    '<i><b style="width:' + pct + '%"></b></i><span>' + (off ? 'Sin sonido' : pct + '%') + '</span>';
  liveVolToast.classList.add('is-visible');
  if (liveVolToastTimer) { clearTimeout(liveVolToastTimer); }
  liveVolToastTimer = setTimeout(function () { liveVolToast.classList.remove('is-visible'); }, 1100);
}

/* A TV favourite is kept by the channel's link (stable when the lists change). */
function liveFavKey(ch) { return 'live:' + (ch.streamUrl || ch.channelCode || ch.id || ch.name); }
function syncLiveFavButton() {
  if (!liveFavBtn) { return; }
  var ch = CHANNELS[state.channel];
  var on = !!(ch && (ch.fav || state.favs[liveFavKey(ch)]));
  liveFavBtn.classList.toggle('is-selected', on);
  liveFavBtn.querySelector('span').textContent = on ? 'En favoritos' : 'Favorito';
  liveFavBtn.setAttribute('data-tip', on ? 'Quitar de favoritos' : 'Guardar canal en favoritos');
}

function dockButton(cls, icon, label, title, run) {
  var b = el('div', 'live-dock-btn focusable ' + cls);
  var ico = el('i', 'live-dock-ico');
  ico.innerHTML = icon;
  b.appendChild(ico);
  if (label) { b.appendChild(el('span', null, label)); }
  if (title) { b.setAttribute('data-tip', title); b.setAttribute('aria-label', title); }
  b._activate = run;
  /* TVs: up goes back to the preview above; nothing below the bar. */
  if (platformIsTv() && window.OPENTV_DESKTOP) {
    b._onMove = function (dir) {
      if (dir === 'up' && liveFocus) { setFocus(liveFocus); return true; }
      if (dir === 'down') { return true; }
      return false;
    };
  }
  return b;
}

function buildLiveDock(page) {
  loadLiveAudio();
  liveDock = el('div', 'live-dock');
  var dockBar = el('div', 'live-dock-bar');
  /* Desktop: three groups — sound and tools, the channel buttons with
     pause in the middle, and favourites / guide / full screen. */
  var dockLeft = dockBar, dockCenter = dockBar, dockRight = dockBar;
  if (window.OPENTV_DESKTOP) {
    dockLeft = el('div', 'ldb-group is-left');
    dockCenter = el('div', 'ldb-group is-center');
    dockRight = el('div', 'ldb-group is-right');
    dockBar.appendChild(dockLeft);
    dockBar.appendChild(dockCenter);
    dockBar.appendChild(dockRight);
  }
  var bar = dockCenter;
  bar.appendChild(dockButton('is-zap', LIVE_DOCK_ICONS.prev, 'Anterior', 'Canal anterior', function () { setChannel(state.channel - 1, true); }));
  if (window.OPENTV_DESKTOP) { bar.appendChild(makeLiveDockPlayButton()); }
  bar.appendChild(dockButton('is-zap', LIVE_DOCK_ICONS.next, 'Siguiente', 'Canal siguiente', function () { setChannel(state.channel + 1, true); }));
  if (!window.OPENTV_DESKTOP) { bar.appendChild(el('i', 'live-dock-sep')); }
  bar = dockLeft;
  liveMuteBtn = dockButton('is-icon is-mute', LIVE_DOCK_ICONS.sound, '', 'Silenciar', function () {
    if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
    else { liveAudio.muted = !liveAudio.muted; }
    applyLiveAudio(true);
  });
  bar.appendChild(liveMuteBtn);
  /* Volume: a slider (drag or click) and its value. */
  var volWrap = el('div', 'live-dock-volume');
  liveVolRange = document.createElement('input');
  liveVolRange.type = 'range';
  liveVolRange.min = '0';
  liveVolRange.max = '100';
  liveVolRange.step = '1';
  liveVolRange.className = 'live-vol-range';
  liveVolRange.setAttribute('aria-label', 'Volumen');
  liveVolRange.addEventListener('input', function () {
    liveAudio.volume = Math.max(0, Math.min(1, liveVolRange.value / 100));
    liveAudio.muted = liveAudio.volume === 0;
    applyLiveAudio(false);
    if (systemVolumeOn) { pushSystemVolume(); }
  });
  liveVolRange.addEventListener('change', function () { applyLiveAudio(true); });
  volWrap.appendChild(liveVolRange);
  liveVolLabel = el('span', 'live-dock-vol', '80%');
  volWrap.appendChild(liveVolLabel);
  bar.appendChild(volWrap);
  if (window.OPENTV_DESKTOP) { bar.appendChild(el('i', 'live-dock-sep')); appendLiveDockTools(bar); }
  else { bar.appendChild(el('i', 'live-dock-sep')); }
  bar = dockRight;
  liveFavBtn = dockButton('is-fav', LIVE_DOCK_ICONS.star, 'Favorito', 'Guardar canal en favoritos', function () {
    var ch = CHANNELS[state.channel];
    if (!ch) { return; }
    toggleLiveFavorite(ch);
    if (liveGuideOpen) { renderLiveGuideGrid(); }
  });
  bar.appendChild(liveFavBtn);
  if (window.OPENTV_DESKTOP) {
    bar.appendChild(dockButton('is-schedule', LIVE_DOCK_ICONS.schedule, 'Programación', 'Programación del canal', function () { openLiveSchedule(); }));
    bar.appendChild(dockButton('is-guide', LIVE_DOCK_ICONS.guide, 'Guía', 'Guía de canales (G)', openLiveGuide));
  }
  bar.appendChild(dockButton('is-full', LIVE_DOCK_ICONS.full, 'Pantalla completa', 'Ver en pantalla completa', function () { openPlayer('live'); }));
  liveDock.appendChild(dockBar);

  /* Desktop: the categories live in the Guía (ordered by country and
     topic); the chip row under the preview is only on the TV. */
  if (!window.OPENTV_DESKTOP) {
    liveDockCats = el('div', 'live-dock-cats scrollable');
    liveDockCats.setAttribute('data-wheel-x', '');
    liveDock.appendChild(liveDockCats);
  }
  page.appendChild(liveDock);
  renderLiveDockCats();
  applyLiveAudio(false);
  syncLiveFavButton();
  if (volWrap) { volWrap.setAttribute('data-tip', systemVolumeApi() ? 'Volumen de Windows' : 'Volumen'); }
  startSystemVolumeSync();
}

/* PC and TV (design "3A"): the categories in one drop-down in the app's
   style (lists bring 30 or more; chips covered the channels). A button
   with the current one; it opens a panel with every category, a check on
   the chosen one, scrolling when long. Mouse, keyboard and remote. */
var liveCatMenu = null;

function liveCatMenuOpen() { return !!(liveCatMenu && liveCatMenu.parentNode); }

function closeLiveCatMenu(refocus) {
  if (!liveCatMenuOpen()) { return; }
  liveCatMenu.parentNode.removeChild(liveCatMenu);
  liveCatMenu = null;
  var btn = liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
  if (btn) {
    btn.classList.remove('is-open');
    if (refocus) { setFocus(btn); }
  }
}

function liveCatChoices() {
  var out = [{ cat: LIVE_ALL_CATEGORY, text: 'Todas las categorías' }];
  var saved = liveSaved();
  if (saved.favs.length) { out.push({ cat: LIVE_SAVED_CATS.favs, text: 'Favoritos' }); }
  if (saved.recent.length) { out.push({ cat: LIVE_SAVED_CATS.recent, text: 'Recientes' }); }
  for (var i = 0; i < liveCategories.length; i++) {
    if (liveCategories[i].id !== LIVE_ALL_CATEGORY.id) { out.push({ cat: liveCategories[i], text: liveCategories[i].name }); }
  }
  return out;
}

function sameLiveCategory(a, b) { return a === b || !!(a && b && a.id === b.id); }

function openLiveCatMenu(btn) {
  closeLiveCatMenu(false);
  liveCatMenu = el('div', 'live-cat-menu scrollable');
  liveCatMenu.setAttribute('role', 'listbox');
  var current = null;
  liveCatChoices().forEach(function (c) {
    var on = sameLiveCategory(currentLiveCategory, c.cat);
    var item = el('div', 'live-cat-item focusable' + (on ? ' is-selected' : ''));
    item.setAttribute('role', 'option');
    item.appendChild(el('span', 'live-cat-name', c.text));
    var check = el('i', 'live-cat-check');
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
    item.appendChild(check);
    item._activate = function () {
      closeLiveCatMenu(false);
      if (!on) { switchLiveCategory(c.cat); renderLiveDockCats(); }
      var again = liveDockCats ? liveDockCats.querySelector('.live-cat-btn') : null;
      if (again) { setFocus(again); }
    };
    /* The list stays the remote's whole world while it is open. */
    item._onMove = function (dir) { return dir === 'left' || dir === 'right'; };
    if (on) { current = item; }
    liveCatMenu.appendChild(item);
  });
  btn.classList.add('is-open');
  /* Last in the column, right under the button: over the channel list. */
  var column = liveDockCats.parentNode || liveDockCats;
  liveCatMenu.style.top = (liveDockCats.offsetTop + btn.offsetHeight + 8) + 'px';
  column.appendChild(liveCatMenu);
  var first = current || liveCatMenu.firstChild;
  if (first) {
    setFocus(first, true);
    liveCatMenu.scrollTop = Math.max(0, first.offsetTop - 120);
  }
}

function renderLiveCatSelect() {
  closeLiveCatMenu(false);
  clear(liveDockCats);
  var label = 'Cargando categorías…';
  if (liveCategoriesLoaded) {
    var choices = liveCatChoices();
    label = choices[0].text;
    for (var i = 0; i < choices.length; i++) { if (sameLiveCategory(currentLiveCategory, choices[i].cat)) { label = choices[i].text; } }
  }
  var btn = el('div', 'live-cat-btn focusable');
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.appendChild(el('span', 'live-cat-label', label));
  var chev = el('i', 'live-cat-chev');
  chev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  btn.appendChild(chev);
  btn._activate = function () {
    if (!liveCategoriesLoaded) { return; }
    if (liveCatMenuOpen()) { closeLiveCatMenu(true); } else { openLiveCatMenu(btn); }
  };
  liveDockCats.appendChild(btn);
}

/* A click anywhere else closes it. */
document.addEventListener('pointerdown', function (event) {
  if (!liveCatMenuOpen()) { return; }
  var t = event.target;
  if (liveDockCats && t && (liveDockCats.contains(t) || liveCatMenu.contains(t))) { return; }
  closeLiveCatMenu(false);
}, true);

function renderLiveDockCats() {
  if (!liveDockCats) { return; }
  if (typeof liveSideLayout === 'function' && liveSideLayout()) { renderLiveCatSelect(); return; }
  clear(liveDockCats);
  if (!liveCategoriesLoaded) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Cargando categorías…'));
    return;
  }
  var topics = [];
  for (var i = 0; i < liveCategories.length; i++) {
    if (liveCategories[i].id !== LIVE_ALL_CATEGORY.id) { topics.push(liveCategories[i]); }
  }
  function chip(cat, text) {
    var selected = currentLiveCategory === cat ||
      (currentLiveCategory && cat && currentLiveCategory.id === cat.id);
    var b = el('div', 'live-chip focusable' + (selected ? ' is-selected' : ''), text || cat.name);
    b._activate = function () {
      switchLiveCategory(cat);
      renderLiveDockCats();
    };
    liveDockCats.appendChild(b);
  }
  chip(LIVE_ALL_CATEGORY, 'Todos');
  if (window.OPENTV_DESKTOP) {
    var saved = liveSaved();
    if (saved.favs.length) { chip(LIVE_SAVED_CATS.favs, '★ Favoritos'); }
    if (saved.recent.length) { chip(LIVE_SAVED_CATS.recent, 'Recientes'); }
  }
  if (topics.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Categorías'));
    for (var t = 0; t < topics.length; t++) { chip(topics[t]); }
  }
}
