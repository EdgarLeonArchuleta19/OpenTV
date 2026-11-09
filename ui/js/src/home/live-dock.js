/* home/live-dock.js — Barra de controles de la TV del inicio: volumen, favoritos y países/temas.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Desktop: sound for the home TV preview, a control bar and country /
   topic chips under the video (the TV app kept this preview muted).
   ------------------------------------------------------------------ */
var LIVE_COUNTRIES = ['Perú', 'México', 'Colombia', 'Venezuela', 'Ecuador', 'Chile', 'Bolivia',
  'Uruguay', 'Paraguay', 'Argentina', 'Panamá', 'Puerto Rico', 'España', 'Costa Rica',
  'Estados Unidos', 'Centroamérica', 'Honduras', 'El Salvador', 'República Dominicana', 'Guatemala', 'Nicaragua'];
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
  guide: uiSvg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/>')
};
var liveVolRange = null;
var liveVolToast = null;
var liveVolToastTimer = null;

function loadLiveAudio() {
  var saved = safeLocalRead('xuper_live_audio_v1', null);
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
  return window.XUPER_DESKTOP && window.desktop && window.desktop.systemVolume ? window.desktop.systemVolume : null;
}
function syncFromSystemVolume() {
  var api = systemVolumeApi();
  if (!api || systemVolumePending !== null) { return; }
  api('get').then(function (r) {
    if (!r || r.error || typeof r.volume !== 'number' || systemVolumePending !== null) { return; }
    systemVolumeOn = true;
    if (Math.abs(r.volume - liveAudio.volume) > 0.004 || r.muted !== liveAudio.muted) {
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
function startSystemVolumeSync() {
  if (!systemVolumeApi()) { return; }
  syncFromSystemVolume();
  /* Follow changes made with the keyboard volume keys or the taskbar. */
  setInterval(function () {
    if (((state.screen === 'home' && state.tab === 0) || state.screen === 'player') && document.hasFocus()) { syncFromSystemVolume(); }
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
    liveMuteBtn.innerHTML = off ? LIVE_DOCK_ICONS.mute : (liveAudio.volume < 0.5 ? LIVE_DOCK_ICONS.soundLow : LIVE_DOCK_ICONS.sound);
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
    else { safeLocalWrite('xuper_live_audio_v1', liveAudio); }
  }
  if (window.XUPER_DESKTOP) { applyPlayerAudio(); }
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
  if (!window.XUPER_DESKTOP || !host) { return; }
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

function liveFavKey(ch) { return 'live:' + (ch.channelCode || ch.id || ch.name); }
function syncLiveFavButton() {
  if (!liveFavBtn) { return; }
  var ch = CHANNELS[state.channel];
  var on = !!(ch && state.favs[liveFavKey(ch)]);
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
  return b;
}

function buildLiveDock(page) {
  loadLiveAudio();
  liveDock = el('div', 'live-dock');
  var bar = el('div', 'live-dock-bar');
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.prev, 'Anterior', 'Canal anterior', function () { setChannel(state.channel - 1, true); }));
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.next, 'Siguiente', 'Canal siguiente', function () { setChannel(state.channel + 1, true); }));
  bar.appendChild(el('i', 'live-dock-sep'));
  liveMuteBtn = dockButton('is-icon', LIVE_DOCK_ICONS.sound, '', 'Silenciar', function () {
    if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
    else { liveAudio.muted = !liveAudio.muted; }
    applyLiveAudio(true);
  });
  liveMuteBtn.innerHTML = '';
  bar.appendChild(liveMuteBtn);
  /* Volume: a slider (drag, click or mouse wheel) and its value. */
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
  liveVolRange.addEventListener('wheel', function (event) {
    event.preventDefault();
    changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });
  volWrap.appendChild(liveVolRange);
  liveVolLabel = el('span', 'live-dock-vol', '80%');
  volWrap.appendChild(liveVolLabel);
  bar.appendChild(volWrap);
  bar.appendChild(el('i', 'live-dock-sep'));
  liveFavBtn = dockButton('is-fav', LIVE_DOCK_ICONS.star, 'Favorito', 'Guardar canal en favoritos', function () {
    var ch = CHANNELS[state.channel];
    if (!ch) { return; }
    toggleLiveFavorite(ch);
    if (liveGuideOpen) { renderLiveGuideGrid(); }
  });
  bar.appendChild(liveFavBtn);
  if (window.XUPER_DESKTOP) {
    bar.appendChild(dockButton('is-guide', LIVE_DOCK_ICONS.guide, 'Guía', 'Guía de canales (G)', openLiveGuide));
  }
  bar.appendChild(dockButton('', LIVE_DOCK_ICONS.full, 'Pantalla completa', 'Ver en pantalla completa', function () { openPlayer('live'); }));
  liveDock.appendChild(bar);

  liveDockCats = el('div', 'live-dock-cats scrollable');
  liveDockCats.setAttribute('data-wheel-x', '');
  liveDock.appendChild(liveDockCats);
  page.appendChild(liveDock);
  /* Mouse wheel over the preview changes the volume. */
  if (liveMain && !liveMain._wheelVolume) {
    liveMain._wheelVolume = true;
    liveMain.addEventListener('wheel', function (event) {
      if (event.ctrlKey) { return; }
      event.preventDefault();
      changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });
  }
  renderLiveDockCats();
  applyLiveAudio(false);
  syncLiveFavButton();
  if (volWrap) { volWrap.setAttribute('data-tip', systemVolumeApi() ? 'Volumen de Windows' : 'Volumen'); }
  if (!liveDock._systemSync) { liveDock._systemSync = true; startSystemVolumeSync(); }
}

function renderLiveDockCats() {
  if (!liveDockCats) { return; }
  clear(liveDockCats);
  if (!liveCategories.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Cargando países y temas…'));
    return;
  }
  var countries = [], topics = [], all = null;
  for (var i = 0; i < liveCategories.length; i++) {
    var c = liveCategories[i];
    if (c.name === 'Todos') { all = c; }
    else if (LIVE_COUNTRIES.indexOf(c.name) !== -1) { countries.push(c); }
    else { topics.push(c); }
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
  if (all) { chip(all, 'Todos'); }
  if (window.XUPER_DESKTOP) {
    var saved = liveSaved();
    if (saved.favs.length) { chip(LIVE_SAVED_CATS.favs, '★ Favoritos'); }
    if (saved.recent.length) { chip(LIVE_SAVED_CATS.recent, 'Recientes'); }
  }
  if (countries.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Países'));
    for (var k = 0; k < countries.length; k++) { chip(countries[k]); }
  }
  if (topics.length) {
    liveDockCats.appendChild(el('span', 'live-dock-label', 'Temas'));
    for (var t = 0; t < topics.length; t++) { chip(topics[t], topics[t].isAddon ? 'Mis listas M3U' : null); }
  }
}
