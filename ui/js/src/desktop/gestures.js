/* desktop/gestures.js — Gestos del ratón sobre el vídeo y controles VOD de escritorio.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function installVideoGestures() {
  installPanelDismiss();
  if (!playerStage || playerStage._gestures) { return; }
  playerStage._gestures = true;
  installMiniControls();

  var indicator = el('div', 'hold-seek');
  indicator.hidden = true;
  playerStage.appendChild(indicator);

  function onVideoArea(target) {
    return target === playerStage || target === playerVideo ||
      (target && target.classList && (target.classList.contains('player-frame') ||
        target.classList.contains('player-status') || target.classList.contains('player-osd-icon')));
  }

  bindClickGestures(playerStage, function () {
    if (playerStage._activate) { playerStage._activate(); }
  }, function () {
    if (state.screen === 'detail') {
      /* From the detail preview: open the player straight in full screen. */
      if (playerStage._activate) { playerStage._activate(); }
      setWindowFullscreen(true);
      return;
    }
    setWindowFullscreen(!isWindowFullscreen());
  });

  var hold = null;
  function canHoldSeek() {
    return state.screen === 'player' && state.playerMode === 'vod' && playerVideo &&
      !state.episodeBrowserOpen && !playSettingViewOpen &&
      !!(playerVideo.currentSrc || playerVideo.getAttribute('src'));
  }
  /* +10 s per tick for the first 3 s, then faster: about 1:40 after 3 s,
     5 min after 6 s, then +1 min per tick. */
  function holdStep(elapsed) {
    if (elapsed < 3000) { return 10; }
    if (elapsed < 6000) { return 20; }
    return 60;
  }
  function renderHold() {
    var duration = vodPlaybackDuration();
    var arrow = hold.dir > 0 ? '»' : '«';
    var text = arrow + ' ' + (hold.dir > 0 ? '+' : '−') + formatSeekAmount(hold.total);
    if (duration) {
      var target = Math.max(0, Math.min(duration - 1, hold.base + hold.dir * hold.total));
      text += '\n' + formatTime(target) + ' / ' + formatTime(duration);
      if (vodScrubbing) { vodScrubTime = target; updateVodProgress(target, duration); }
    }
    indicator.textContent = text;
    indicator.className = 'hold-seek ' + (hold.dir > 0 ? 'is-right' : 'is-left');
    indicator.hidden = false;
  }
  function startHold() {
    hold.active = true;
    hold.base = vodPlaybackPosition();
    hold.total = 10;
    hold.startedAt = Date.now();
    if (vodPlaybackDuration()) { enterVodScrub(); }
    renderHold();
    hold.ticker = setInterval(function () {
      hold.total += holdStep(Date.now() - hold.startedAt);
      var duration = vodPlaybackDuration();
      if (duration) {
        var room = hold.dir > 0 ? (duration - 1 - hold.base) : hold.base;
        hold.total = Math.max(0, Math.min(hold.total, room));
      }
      renderHold();
    }, 300);
  }
  function endHold(apply) {
    if (!hold) { return; }
    var h = hold;
    hold = null;
    clearTimeout(h.timer);
    if (!h.active) { return; }
    clearInterval(h.ticker);
    /* The click that follows this release must not pause the video. It is
       cleared by the click handler, or after a moment if no click comes. */
    playerStage._suppressClick = true;
    setTimeout(function () { playerStage._suppressClick = false; }, 500);
    setTimeout(function () { indicator.hidden = true; }, 500);
    if (vodScrubbing) {
      /* vodScrubTime already holds the target shown by the counter. */
      leaveVodScrub(apply);
    } else if (apply && h.total) {
      playerSeek(h.dir * h.total);
    }
  }

  playerStage.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || !onVideoArea(event.target) || !canHoldSeek()) { return; }
    var rect = playerStage.getBoundingClientRect();
    var x = (event.clientX - rect.left) / rect.width;
    if (x > 1 / 3 && x < 2 / 3) { return; }
    endHold(false);
    hold = { dir: x <= 1 / 3 ? -1 : 1, active: false };
    hold.timer = setTimeout(startHold, HOLD_START_MS);
  });
  playerStage.addEventListener('pointerup', function () { endHold(true); });
  playerStage.addEventListener('pointerleave', function () { endHold(true); });
  playerStage.addEventListener('pointercancel', function () { endHold(false); });
  window.addEventListener('blur', function () { endHold(true); });
}

/* Home TV preview: click opens the TV player, double click opens it in
   Windows full screen. */
function installLivePreviewGestures(node) {
  if (!node || node._gestures) { return; }
  node._gestures = true;
  bindClickGestures(node, function () { openPlayer('live'); }, function () {
    openPlayer('live');
    setWindowFullscreen(true);
  });
}

function bindDesktopPlayback() {
  installVideoGestures();
  if (!vodSeekbar || vodSeekbar._desktopBound) return;
  vodSeekbar._desktopBound = true;
  vodSeekbar.setAttribute('role', 'slider');
  vodSeekbar.setAttribute('aria-label', 'Posición de reproducción');
  vodSeekbar.setAttribute('aria-valuemin', '0');
  vodSeekbar.setAttribute('tabindex', '0');
  var durationNote = el('div', 'vod-duration-note');
  durationNote.id = 'vod-duration-note'; durationNote.hidden = true;
  document.querySelector('.vod-infobar-content').appendChild(durationNote);
  var pointer = null;
  function preview(event) {
    var rect = vodSeekbar.getBoundingClientRect();
    var duration = vodPlaybackDuration();
    var fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    vodScrubTime = Math.max(0, Math.min(duration - 1, fraction * duration));
    updateVodProgress(vodScrubTime, duration);
  }
  vodSeekbar.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || state.screen !== 'player' || state.playerMode !== 'vod' || !isVisible(vodSeekbar)) return;
    event.preventDefault(); event.stopPropagation();
    if (!vodPlaybackDuration()) {
      updateVodProgress(vodPlaybackPosition(), 0);
      return;
    }
    pointer = event.pointerId;
    enterVodScrub();
    vodSeekbar.setPointerCapture(pointer);
    preview(event);
  });
  vodSeekbar.addEventListener('pointermove', function (event) {
    if (event.pointerId === pointer) { event.preventDefault(); preview(event); }
  });
  vodSeekbar.addEventListener('pointerup', function (event) {
    if (event.pointerId !== pointer) return;
    event.preventDefault(); event.stopPropagation();
    preview(event);
    var id = pointer; pointer = null;
    if (vodSeekbar.hasPointerCapture(id)) vodSeekbar.releasePointerCapture(id);
    leaveVodScrub(true);
  });
  function cancel() { if (pointer !== null) { pointer = null; leaveVodScrub(false); } }
  vodSeekbar._cancelDesktopScrub = cancel;
  vodSeekbar.addEventListener('pointercancel', cancel);
  vodSeekbar.addEventListener('lostpointercapture', cancel);
  vodSeekbar.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); });
  vodSeekbar.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); event.stopPropagation();
      if (!vodScrubbing) enterVodScrub();
      vodScrubTime = Math.max(0, Math.min(vodPlaybackDuration() - 1, vodScrubTime + (event.key === 'ArrowRight' ? 10 : -10)));
      updateVodProgress(vodScrubTime, vodPlaybackDuration());
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); event.stopPropagation();
      if (!vodScrubbing) enterVodScrub();
      vodScrubTime = event.key === 'Home' ? 0 : Math.max(0, vodPlaybackDuration() - 2);
      updateVodProgress(vodScrubTime, vodPlaybackDuration());
    }
  });
  var tips = document.querySelector('.vod-infobar-tips');
  clear(tips);
  var defs = [
    { id: 'vod-back', icon: UI_ICONS.back, tip: 'Volver (Esc)', run: desktopBack },
    { id: 'vod-rewind', icon: UI_ICONS.rewind, tip: 'Retroceder 10 s (←)', run: function () { playerSeek(-10); } },
    { id: 'vod-toggle', icon: UI_ICONS.pause, tip: 'Pausa (Espacio)', run: togglePlayerPlayPause },
    { id: 'vod-forward', icon: UI_ICONS.forward, tip: 'Adelantar 10 s (→)', run: function () { playerSeek(10); } },
    { id: 'vod-episodes', icon: UI_ICONS.episodes, tip: 'Episodios', run: openEpisodeBrowser },
    { id: 'vod-settings', icon: UI_ICONS.settings, tip: 'Ajustes de reproducción (↓)', run: openPlaySettingView }
  ];
  if (document.pictureInPictureEnabled) {
    defs.push({ id: 'vod-pip', icon: UI_ICONS.pip, tip: 'Ventana flotante (Ctrl+P)', run: togglePictureInPicture });
  }
  defs.push({ id: 'vod-fullscreen', icon: UI_ICONS.fullscreen, tip: 'Pantalla completa (F)', run: function () { window.desktop.fullscreen(); } });
  for (var i = 0; i < defs.length; i++) {
    var b = el('button', 'vod-tip focusable');
    b.type = 'button'; b.id = defs[i].id;
    iconizeButton(b, defs[i].icon, defs[i].tip);
    b._activate = defs[i].run;
    tips.appendChild(b);
  }
  function updateButtons() {
    var toggle = $('vod-toggle');
    var showPlay = playerVideo.paused;
    if (toggle._showsPlay !== showPlay) {
      toggle._showsPlay = showPlay;
      setButtonText(toggle, showPlay ? 'Reproducir (Espacio)' : 'Pausa (Espacio)', showPlay ? UI_ICONS.play : UI_ICONS.pause);
    }
    $('vod-episodes').hidden = !isSeriesItem(state.playerItem);
    var canSkip = state.playerMode === 'vod' && !!(playerVideo.currentSrc || playerVideo.getAttribute('src'));
    $('vod-forward').disabled = !canSkip;
    $('vod-rewind').disabled = !canSkip;
    if ($('vod-pip')) {
      var inPip = document.pictureInPictureElement === playerVideo;
      setButtonText($('vod-pip'), inPip ? 'Cerrar ventana flotante (Ctrl+P)' : 'Ventana flotante (Ctrl+P)');
      $('vod-pip').classList.toggle('is-selected', inPip);
      $('vod-pip').disabled = !canSkip && !inPip;
    }
  }
  playerVideo.addEventListener('enterpictureinpicture', updateButtons);
  playerVideo.addEventListener('leavepictureinpicture', updateButtons);
  playerVideo.addEventListener('play', updateButtons);
  playerVideo.addEventListener('pause', updateButtons);
  playerVideo.addEventListener('loadedmetadata', updateButtons);
  playerVideo.addEventListener('durationchange', updateButtons);
  document.addEventListener('xuper:duration', updateButtons);
  document.addEventListener('xuper:timeline', function () {
    updateButtons();
    if (state.playerMode === 'vod') updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
  });
  var screen = $('screen-player');
  screen.addEventListener('pointermove', function () {
    if (state.screen === 'player' && !playSettingViewOpen && !dialogPlaySettingsOpen &&
        !state.episodeBrowserOpen && !state.categoryPickerOpen && !state.channelsOpen && !vodScrubbing) showInfobar();
  });
}
