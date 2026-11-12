/* player/volume.js — Escritorio: volumen en el reproductor y vista previa del tiempo sobre la barra.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The player shares the TV volume (liveAudio): one level for the whole app.
   When Windows volume control is available it moves the real system volume,
   exactly like the TV slider; otherwise it is the video's own volume. */
var playerVolRange = null, playerMuteBtn = null, playerVolLabel = null;

function applyPlayerAudio() {
  if (!window.XUPER_DESKTOP || !playerVideo || state.screen !== 'player') { return; }
  if (systemVolumeOn) {
    playerVideo.volume = 1;
    playerVideo.muted = false;
  } else {
    playerVideo.volume = liveAudio.volume;
    playerVideo.muted = liveAudio.muted;
  }
  syncPlayerVolumeUi();
}

function syncPlayerVolumeUi() {
  if (!playerVolRange) { return; }
  var off = liveAudio.muted || liveAudio.volume === 0;
  var pct = off ? 0 : Math.round(liveAudio.volume * 100);
  if (String(playerVolRange.value) !== String(pct)) { playerVolRange.value = pct; }
  playerVolRange.style.setProperty('--vol', pct + '%');
  if (playerVolLabel) { playerVolLabel.textContent = off ? 'Sin sonido' : pct + '%'; }
  if (playerMuteBtn) {
    playerMuteBtn.innerHTML = off ? LIVE_DOCK_ICONS.mute : (liveAudio.volume < 0.5 ? LIVE_DOCK_ICONS.soundLow : LIVE_DOCK_ICONS.sound);
    playerMuteBtn.setAttribute('data-tip', off ? 'Activar sonido (M)' : 'Silenciar (M)');
    playerMuteBtn.setAttribute('aria-label', off ? 'Activar sonido' : 'Silenciar');
    playerMuteBtn.classList.toggle('is-off', off);
  }
}

function togglePlayerMute() {
  if (liveAudio.volume === 0) { liveAudio.volume = 0.5; liveAudio.muted = false; }
  else { liveAudio.muted = !liveAudio.muted; }
  applyLiveAudio(true);
  showLiveVolumeToast();
}

/* Mute button + slider, next to Volver on the left of the bar. */
function buildPlayerVolume(group) {
  var wrap = el('div', 'vod-volume');
  wrap.setAttribute('data-no-gesture', '');
  playerMuteBtn = el('button', 'vod-tip vod-mute focusable');
  playerMuteBtn.type = 'button';
  playerMuteBtn._activate = togglePlayerMute;
  wrap.appendChild(playerMuteBtn);
  playerVolRange = document.createElement('input');
  playerVolRange.type = 'range';
  playerVolRange.min = '0';
  playerVolRange.max = '100';
  playerVolRange.step = '1';
  playerVolRange.className = 'live-vol-range vod-vol-range';
  playerVolRange.setAttribute('aria-label', 'Volumen');
  playerVolRange.addEventListener('input', function () {
    liveAudio.volume = Math.max(0, Math.min(1, playerVolRange.value / 100));
    liveAudio.muted = liveAudio.volume === 0;
    applyLiveAudio(false);
    if (systemVolumeOn) { pushSystemVolume(); }
  });
  playerVolRange.addEventListener('change', function () { applyLiveAudio(true); });
  playerVolRange.addEventListener('keydown', function (event) {
    /* Arrow keys keep seeking the video; the slider only takes the mouse. */
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); }
  });
  wrap.appendChild(playerVolRange);
  playerVolLabel = el('span', 'vod-vol-label', '');
  wrap.appendChild(playerVolLabel);
  wrap.setAttribute('data-tip', systemVolumeApi() ? 'Volumen de Windows · rueda del ratón' : 'Volumen · rueda del ratón');
  group.appendChild(wrap);
  syncPlayerVolumeUi();
}

/* Wheel over the picture changes the volume (Ctrl + wheel is left alone). */
function installPlayerWheelVolume() {
  if (!window.XUPER_DESKTOP || !playerStage || playerStage._wheelVolume) { return; }
  playerStage._wheelVolume = true;
  $('screen-player').addEventListener('wheel', function (event) {
    if (event.ctrlKey || state.screen !== 'player') { return; }
    if (playSettingViewOpen || dialogPlaySettingsOpen || state.episodeBrowserOpen || state.categoryPickerOpen || state.channelsOpen) { return; }
    if (event.target && event.target.closest && event.target.closest('.scrollable, .quality-menu, .pc-list, .player-channels')) { return; }
    event.preventDefault();
    changeLiveVolume(event.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });
}

/* Hovering the seek bar shows the time under the pointer. */
function installSeekHoverPreview() {
  if (!window.XUPER_DESKTOP || !vodSeekbar || vodSeekbar._hoverPreview) { return; }
  vodSeekbar._hoverPreview = true;
  var bubble = el('div', 'vod-seek-hover');
  var ghost = el('div', 'vod-seek-ghost');
  vodSeekbar.appendChild(ghost);
  vodSeekbar.appendChild(bubble);
  function show(event) {
    var duration = vodPlaybackDuration();
    if (!duration) { hide(); return; }
    var rect = vodSeekbar.getBoundingClientRect();
    var fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    var t = vodScrubbing ? vodScrubTime : fraction * duration;
    var delta = t - vodPlaybackPosition();
    bubble.innerHTML = '<b>' + formatTime(t) + '</b>' + (vodScrubbing || Math.abs(delta) < 5 ? ''
      : '<span>' + (delta > 0 ? '+' : '−') + formatTime(Math.abs(delta)).replace(/^00:/, '') + '</span>');
    /* Position in the bar's own (unscaled) units. */
    var scale = rect.width / (vodSeekbar.offsetWidth || rect.width);
    var x = (vodScrubbing ? (vodScrubTime / duration) * rect.width : fraction * rect.width) / scale;
    bubble.style.left = x + 'px';
    ghost.style.width = (fraction * 100) + '%';
    vodSeekbar.classList.add('is-hovering');
  }
  function hide() { vodSeekbar.classList.remove('is-hovering'); }
  vodSeekbar.addEventListener('pointermove', show);
  vodSeekbar.addEventListener('pointerenter', show);
  vodSeekbar.addEventListener('pointerleave', function () { if (!vodScrubbing) { hide(); } });
  vodSeekbar.addEventListener('pointerup', function () { setTimeout(hide, 600); });
}

function installPlayerVolume() {
  /* TVs: the remote changes the TV's own volume; the slider, the wheel and
     the seek preview on hover are mouse controls. */
  if (!window.XUPER_DESKTOP || platformIsTv()) { return; }
  var left = document.querySelector('.vod-infobar-tips .vt-left');
  if (left && !left.querySelector('.vod-volume')) { buildPlayerVolume(left); }
  playerVideo.addEventListener('playing', applyPlayerAudio);
  installPlayerWheelVolume();
  installSeekHoverPreview();
}
