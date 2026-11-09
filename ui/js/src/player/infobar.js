/* player/infobar.js — Reproductor: tiempos, barra de progreso VOD, iconos OSD y barras de información.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ================================================================ PLAYER */
/* The player controller hides itself after a few seconds without input.
   The constant is not exposed in the decoded resources; 5000 ms is used
   until it can be measured on the running app (WSA/Android TV). */
var INFO_HIDE_MS = 5000;
var osdHideTimer = null;

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function durationToSeconds(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value > 0 ? (value > 100000 ? value / 1000 : value) : 0;
  }
  if (typeof value !== 'string') return 0;
  var raw = value.trim().toLowerCase().replace(/,/g, '.');
  if (!raw || /^(?:n\/a|none|null|undefined|unknown|infinity|—|-)$/.test(raw)) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return durationToSeconds(Number(raw));
  var clock = /^(\d+):(\d{1,2}(?:\.\d+)?)(?::(\d{1,2}(?:\.\d+)?))?$/.exec(raw);
  if (clock) {
    var first = Number(clock[1]), middle = Number(clock[2]);
    if (middle >= 60 || (clock[3] != null && Number(clock[3]) >= 60)) return 0;
    return clock[3] == null ? first * 60 + middle : first * 3600 + middle * 60 + Number(clock[3]);
  }
  var total = 0, found = false;
  var unit = /(\d+(?:\.\d+)?)\s*(horas?|hours?|hrs?|h|minutos?|minutes?|mins?|min|m|segundos?|seconds?|secs?|sec|seg|s)(?![a-z])/g;
  var match;
  while ((match = unit.exec(raw))) {
    var label = match[2];
    var multiplier = label.charAt(0) === 'h' ? 3600 : label.charAt(0) === 'm' ? 60 : 1;
    total += Number(match[1]) * multiplier;
    found = true;
  }
  return found && isFinite(total) && total > 0 ? total : 0;
}

var vodProgressInterval = null;
function startVodProgressTicker() {
  stopVodProgressTicker();
  vodProgressInterval = setInterval(function () {
    if (state.screen === 'player' && state.playerMode === 'vod' && playerVideo && !playerVideo.paused) {
      var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var totalDur = vodPlaybackDuration();
      updateVodProgress(cur, totalDur);
      updateSubtitleDisplay(cur);
      rememberWatchProgress(cur, totalDur);
    }
  }, 500);
}
function stopVodProgressTicker() {
  if (vodProgressInterval) {
    clearInterval(vodProgressInterval);
    vodProgressInterval = null;
  }
}

function updateVodProgress(current, duration) {
  if (!vodTimeCurrent || !vodTimeTotal || !vodSeekProgress) { return; }
  if (vodScrubbing) { current = vodScrubTime; }
  var knownDuration = window.XUPER_DESKTOP ? vodPlaybackDuration() : durationToSeconds(duration);
  if (!knownDuration && !window.XUPER_DESKTOP && state.playerEpisode && state.playerEpisode.duration) {
    knownDuration = durationToSeconds(state.playerEpisode.duration);
  }
  if (!knownDuration && !window.XUPER_DESKTOP && state.playerItem && state.playerItem.duration) {
    knownDuration = durationToSeconds(state.playerItem.duration);
  }
  if (!knownDuration && !window.XUPER_DESKTOP && playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0) {
    knownDuration = playerVideo.duration;
  }
  if (!knownDuration && !window.XUPER_DESKTOP && activeSubtitleCues && activeSubtitleCues.length) {
    var lastCue = activeSubtitleCues[activeSubtitleCues.length - 1];
    if (lastCue && lastCue.end > 0) {
      knownDuration = Math.round(lastCue.end + 60);
    }
  }

  current = Number(current) || 0;
  vodTimeCurrent.textContent = formatTime(current);

  var durationNote = $('vod-duration-note');
  if (durationNote) {
    var durationTarget = state.playerEpisode || state.playerItem;
    durationNote.hidden = !!knownDuration;
    durationNote.textContent = durationTarget && durationTarget._durationPending ?
      'Obteniendo duración… Puedes usar −10 s y +10 s.' : 'Duración no disponible. Puedes usar −10 s y +10 s.';
  }
  if (window.XUPER_DESKTOP && !knownDuration) {
    vodTimeTotal.textContent = '--:--:--';
    vodSeekProgress.style.width = '0%';
    if (vodSeekThumb) vodSeekThumb.style.left = '0%';
    if (vodSeekBuffered) vodSeekBuffered.style.width = '0%';
    if (vodSeekbar) {
      vodSeekbar.setAttribute('aria-valuemax', '0');
      vodSeekbar.setAttribute('aria-valuenow', String(Math.floor(current)));
      vodSeekbar.setAttribute('aria-valuetext', formatTime(current) + '; duración no disponible');
    }
    return;
  }
  if (!knownDuration || knownDuration <= 0) {
    var isSeries = isSeriesItem(state.playerItem);
    knownDuration = isSeries ? 2700 : 6300;
    if (current > knownDuration) {
      knownDuration = Math.round(current * 1.15);
    }
  }

  vodTimeTotal.textContent = formatTime(knownDuration);
  var pct = Math.min(100, Math.max(0, (current / knownDuration) * 100));
  vodSeekProgress.style.width = pct.toFixed(2) + '%';
  if (window.XUPER_DESKTOP && vodSeekbar) {
    vodSeekbar.setAttribute('aria-valuemax', String(Math.floor(vodPlaybackDuration())));
    vodSeekbar.setAttribute('aria-valuenow', String(Math.floor(current)));
    vodSeekbar.setAttribute('aria-valuetext', formatTime(current) + ' de ' + formatTime(knownDuration));
  }
  if (vodSeekThumb) {
    vodSeekThumb.style.left = pct.toFixed(2) + '%';
  }
  if (playerVideo && playerVideo.buffered && playerVideo.buffered.length > 0) {
    try {
      var bufEnd = playerVideo.buffered.end(playerVideo.buffered.length - 1);
      if (relayBaseUrl) { bufEnd += relayStartOffset; }
      var bufPct = Math.min(100, Math.max(0, (bufEnd / knownDuration) * 100));
      if (vodSeekBuffered) { vodSeekBuffered.style.width = bufPct.toFixed(2) + '%'; }
    } catch (eB) { /* ignore */ }
  }
}


function showOsdIcon(type) {
  if (!playerOsdIcon) { playerOsdIcon = $('player-osd-icon'); }
  if (!playerOsdIcon) { return; }
  if (osdHideTimer) { clearTimeout(osdHideTimer); osdHideTimer = null; }
  if (window.XUPER_DESKTOP) {
    var osdIcons = { pause: UI_ICONS.pause, forward: UI_ICONS.forward, backward: UI_ICONS.rewind };
    if (!osdIcons[type]) { playerOsdIcon.classList.remove('is-active'); return; }
    playerOsdIcon.style.backgroundImage = 'none';
    playerOsdIcon.innerHTML = osdIcons[type];
    playerOsdIcon.className = 'player-osd-icon is-svg is-' + type;
    /* Force the pop animation to restart on every press. */
    void playerOsdIcon.offsetWidth;
    playerOsdIcon.classList.add('is-active');
    if (type !== 'pause') {
      osdHideTimer = setTimeout(function () { playerOsdIcon.classList.remove('is-active'); }, 700);
    }
    return;
  }
  if (type === 'pause') {
    playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_pause.png)';
    playerOsdIcon.classList.add('is-active');
  } else if (type === 'forward') {
    playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_forward.png)';
    playerOsdIcon.classList.add('is-active');
    osdHideTimer = setTimeout(function () {
      playerOsdIcon.classList.remove('is-active');
    }, 900);
  } else if (type === 'backward') {
    playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_backward.png)';
    playerOsdIcon.classList.add('is-active');
    osdHideTimer = setTimeout(function () {
      playerOsdIcon.classList.remove('is-active');
    }, 900);
  } else {
    playerOsdIcon.classList.remove('is-active');
  }
}

function togglePlayerPlayPause() {
  if (window.XUPER_DESKTOP && state.playerMode === 'live' && state.screen === 'player') { toggleLivePlayPause(); return; }
  if (!playerVideo) { return; }
  if (playerVideo.paused) {
    resumePlayerPlayback();
    showOsdIcon('none');
    showInfobar();
  } else {
    try {
      playerVideo.pause();
    } catch (eP2) {}
    showOsdIcon('pause');
    showInfobar();
  }
}

function scheduleInfoHide() {
  if (state.infoTimer) { clearTimeout(state.infoTimer); }
  state.infoTimer = setTimeout(function () {
    state.infoTimer = null;
    if (state.screen !== 'player' || state.channelsOpen) { return; }
    if (window.XUPER_DESKTOP && (vodScrubbing || (playerVodInfo && playerVodInfo.matches(':hover')) || (playerInfo && playerInfo.matches(':hover')))) { scheduleInfoHide(); return; }
    hideInfobar();
  }, INFO_HIDE_MS);
}

function showInfobar() {
  state.infobar = true;
  if (state.playerMode === 'vod') {
    if (playerVodInfo) { playerVodInfo.classList.add('is-active'); }
    if (playerInfo) { playerInfo.classList.remove('is-active'); }
  } else {
    if (playerInfo) { playerInfo.classList.add('is-active'); }
    if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
  }
  scheduleInfoHide();
}

function hideInfobar() {
  if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
  state.infobar = false;
  if (playerInfo) { playerInfo.classList.remove('is-active'); }
  if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
}

function showVodInfobar() {
  showInfobar();
}

function hideVodInfobar() {
  hideInfobar();
}
