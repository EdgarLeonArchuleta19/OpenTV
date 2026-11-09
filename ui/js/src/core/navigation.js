/* core/navigation.js — Cambio de pantalla, "Volver" y manejador global de teclado / mando (handleKey).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ---------------------------------------------------------------- screen */
function showScreen(name) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) {
    screens[i].classList.remove('is-active');
  }
  var target = $('screen-' + name);
  if (target) { target.classList.add('is-active'); }
  var previousScreen = state.screen;
  state.screen = name;
  if (historyDrawerOpen) { closeHistoryDrawer(true); }
  if (window.XUPER_DESKTOP) {
    if (name === 'home') {
      /* Back from the full-screen TV player: keep the same video playing
         in the home preview instead of reloading the channel. */
      if (liveHandoff && liveHandoff.type === 'preview') { returnPreviewHome(); }
      else if (previousScreen === 'player' && !borrowPlayerIntoHome() && state.playerMode === 'live' &&
               !(liveHandoff && liveHandoff.type === 'player') && !keepFloatingVideo()) {
        /* The channel had not started yet (or was buffering), so it could not
           move into the home preview. Stop it: otherwise it kept playing,
           unseen, with sound, next to the preview. */
        liveChannelSeq++;
        if (liveChannelDebounceTimer) { clearTimeout(liveChannelDebounceTimer); liveChannelDebounceTimer = null; }
        stopPlayerVideo();
      }
    } else if (name !== 'player') {
      /* The home preview must not keep playing (with sound) behind other screens. */
      stopLivePreview();
    }
  }
  if (name !== 'player' && state.episodeBrowserOpen) { closeEpisodeBrowser(true); }
  if (name !== 'player' && state.categoryPickerOpen) { closeCategoryPicker(true); }
  if (name !== 'player' && name !== 'detail') {
    if (dialogPlaySettingsOpen) { closePlaySettingsDialog(); }
    if (playSettingViewOpen) { closePlaySettingView(); }
    var scrPlayer = $('screen-player');
    if (scrPlayer) {
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.remove('is-active');
    }
    /* PiP keeps playing while browsing; a TV channel handed to the home
       preview keeps playing there. */
    if (!keepFloatingVideo() && !(liveHandoff && liveHandoff.type === 'player')) { stopPlayerVideo(); }
    /* Really leaving the player: drop the subtitle cues as well. */
    subtitleSeq++;
    activeSubtitleCues = [];
    if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
  }
  schedulePosterMemoryPass();
}

var lastBackTime = 0;
function back() {
  var now = Date.now();
  if (now - lastBackTime < 250) { return; }
  lastBackTime = now;
  if (historyDrawerOpen) { closeHistoryDrawer(); return; }
  /* The audio/subtitle dialog can now open from the details screen too. */
  if (dialogPlaySettingsOpen) {
    closePlaySettingsDialog();
    return;
  }
  if (state.screen === 'player') {
    if (vodScrubbing) {
      leaveVodScrub(false);
      return;
    }
    if (state.categoryPickerOpen) {
      lastBackTime = Date.now();
      closeCategoryPicker();
      return;
    }
    if (state.episodeBrowserOpen) {
      lastBackTime = Date.now();
      closeEpisodeBrowser();
      return;
    }
    if (playSettingViewOpen) {
      closePlaySettingView();
      return;
    }
    if (state.channelsOpen) {
      closeChannelPanel();
    } else if (state.infobar) {
      hideInfobar();
    } else if (state.vodInfobarVisible) {
      hideVodInfobar();
    } else {
      restorePlayerReturn();
    }
    return;
  }
  if (state.screen === 'detail') {
    if (typeof closeSeasonPopup === 'function' && seasonPopup) {
      closeSeasonPopup();
      var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
      if (sBtn) { setFocus(sBtn); }
      return;
    }
    var scr = $('screen-detail');
    if (scr && scr.classList.contains('is-synopsis-open')) {
      toggleSynopsis();
      return;
    }
    if (!keepFloatingVideo()) { stopPlayerVideo(); }  /* PiP keeps playing while browsing */
    var scrPlayer = $('screen-player');
    if (scrPlayer) {
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.remove('is-active');
    }
    var ret = state.detailReturn;
    if (ret && ret.screen === 'search') {
      showScreen('search');
      setFocus(ret.focus);
    } else {
      showScreen('home');
      selectTab(state.tab, false);
      if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
      else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    }
    return;
  }
  if (state.screen === 'search') {
    clearSearchState();
    showScreen('home');
    selectTab(state.tab, false);
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    return;
  }
  if (state.screen === 'settings') {
    showScreen('home');
    selectTab(state.tab, false);
    if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    return;
  }
  if (state.screen === 'home') {
    if (state.tab !== 0) {
      selectTab(0, true);
      if (tabEls[0]) { setFocus(tabEls[0]); }
      return;
    }
    if (window.webOSTV && window.webOSTV.platformBack) {
      window.webOSTV.platformBack();
    } else if (window.PalmSystem && window.PalmSystem.platformBack) {
      window.PalmSystem.platformBack();
    }
  }
}

function activate() {
  if (!state.focus) { return; }
  if (state.focus.disabled || state.focus.getAttribute('aria-disabled') === 'true') { return; }
  if (state.focus._activate) { state.focus._activate(); }
}

function handleKey(e) {
  if (window.XUPER_DESKTOP && e.target && closest(e.target, '.desktop-native-control') &&
      (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32)) { return; }
  /* Let real desktop text fields keep their caret, selection, paste and
     Backspace behaviour instead of treating them as TV remote commands. */
  if (window.XUPER_DESKTOP && e.target &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
    return;
  }
  var k = e.keyCode || e.which;
  var key = e.key || '';
  var handled = true;

  /* Back buttons */
  var isBack = (k === 461 || k === 27 || k === 8 || key === 'Back' || key === 'GoBack' || key === 'Escape');
  if (isBack) {
    if (state.categoryPickerOpen) {
      closeCategoryPicker();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }
    if (state.episodeBrowserOpen) {
      closeEpisodeBrowser();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }
    if (dialogAddonsOpen) {
      lastBackTime = Date.now();
      closeAddonsDialog();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }
    if (dialogPlaySettingsOpen) {
      /* LG sends a keyup after this keydown.  Mark it consumed, otherwise
         that second event sees the dialog closed and exits the detail page. */
      lastBackTime = Date.now();
      closePlaySettingsDialog();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }
    if (playSettingViewOpen) {
      lastBackTime = Date.now();
      closePlaySettingView();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }
    back();
    if (e.preventDefault) { e.preventDefault(); }
    if (e.stopPropagation) { e.stopPropagation(); }
    return;
  }

  /* Live category picker: a full-screen grid owns the d-pad while open. */
  if (state.categoryPickerOpen) {
    if (k === 37) { moveFocus('left'); }
    else if (k === 38) { moveFocus('up'); }
    else if (k === 39) { moveFocus('right'); }
    else if (k === 40) { moveFocus('down'); }
    else if (k === 13 || k === 32) { activate(); }
    else { handled = false; }
    if (handled && e.preventDefault) { e.preventDefault(); }
    return;
  }

  /* Season/episode browser: it owns the d-pad while open. */
  if (state.episodeBrowserOpen) {
    var inSeasons = closest(state.focus, '#pe-seasons');
    var inEpisodes = closest(state.focus, '#pe-episodes');
    if (k === 37) {
      if (inEpisodes && peSeasonsCol && peSeasonsCol.style.display !== 'none') {
        var selSeason = peSeasons ? (peSeasons.children[state.browserSeason] || firstIn(peSeasons)) : null;
        if (selSeason) { setFocus(selSeason); }
      }
    } else if (k === 39) {
      if (inSeasons) {
        var curEp = peEpisodes ? (peEpisodes.querySelector('.pe-ep.is-current') || firstIn(peEpisodes)) : null;
        if (curEp) { setFocus(curEp); }
      }
    } else if (k === 38) {
      moveFocus('up');
    } else if (k === 40) {
      moveFocus('down');
    } else if (k === 13 || k === 32) {
      activate();
    } else {
      handled = false;
    }
    if (handled && e.preventDefault) { e.preventDefault(); }
    return;
  }

  /* Media Play / Pause / Seek keys on webOS & Android TV remotes */
  var isPlay = (k === 415 || key === 'MediaPlay' || key === 'Play');
  var isPause = (k === 19 || key === 'MediaPause' || key === 'Pause');
  var isPlayPause = (k === 10252 || key === 'MediaPlayPause');
  var isFwd = (k === 417 || key === 'MediaFastForward' || key === 'FastForward');
  var isRwd = (k === 412 || key === 'MediaRewind' || key === 'Rewind');
  var isStop = (k === 413 || key === 'MediaStop' || key === 'Stop');

  if (window.XUPER_DESKTOP && !e.ctrlKey && !e.altKey && !e.metaKey && state.screen !== 'search') {
    if (k === 70 || key === 'f' || key === 'F') {
      if (window.desktop && window.desktop.fullscreen) { window.desktop.fullscreen(); }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if ((k === 77 || key === 'm' || key === 'M') && playerVideo) {
      playerVideo.muted = !playerVideo.muted;
      setPlayerStatus(playerVideo.muted ? 'Audio silenciado (M)' : '');
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
  }

  if (state.screen === 'player') {
    if (isPlay) {
      if (playerVideo && playerVideo.paused) {
        resumePlayerPlayback();
        showOsdIcon('none');
        showInfobar();
      }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (isPause) {
      if (playerVideo && !playerVideo.paused) {
        try { playerVideo.pause(); } catch (ePause) {}
        showOsdIcon('pause');
        showInfobar();
      }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (isPlayPause) {
      togglePlayerPlayPause();
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (isFwd) {
      playerSeek(15);
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (isRwd) {
      playerSeek(-15);
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (isStop) {
      back();
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
  }

  /* Menu / ContextMenu button to open in-player settings */
  var isMenu = (k === 457 || k === 93 || k === 467 || key === 'Menu' || key === 'ContextMenu');
  if (state.screen === 'player' && state.playerMode === 'vod' && isMenu) {
    if (dialogPlaySettingsOpen) {
      closePlaySettingsDialog();
    } else if (playSettingViewOpen) {
      closePlaySettingView();
    } else {
      openPlaySettingView();
    }
    if (e.preventDefault) { e.preventDefault(); }
    return;
  }

  if (state.screen === 'player' && (k === 37 || k === 38 || k === 39 || k === 40)) {
    if (dialogPlaySettingsOpen) {
      if (k === 37) { moveFocus('left'); }
      else if (k === 38) { moveFocus('up'); }
      else if (k === 39) { moveFocus('right'); }
      else if (k === 40) { moveFocus('down'); }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (playSettingViewOpen) {
      schedulePlaySettingHide();
      if (k === 37) { moveFocus('left'); }
      else if (k === 38) { moveFocus('up'); }
      else if (k === 39) { moveFocus('right'); }
      else if (k === 40) { moveFocus('down'); }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }
    if (state.playerMode === 'vod') {
      if (state.focus === vodSeekbar && vodScrubbing) {
        if (k === 37) { moveVodScrub(-1); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 39) { moveVodScrub(1); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 38 || k === 40) { leaveVodScrub(false); if (e.preventDefault) { e.preventDefault(); } return; }
      }
      if (k === 37) { playerSeek(-10); if (e.preventDefault) { e.preventDefault(); } return; }
      if (k === 39) { playerSeek(10); if (e.preventDefault) { e.preventDefault(); } return; }
      if (k === 40) {
        openPlaySettingView();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (k === 38) {
        enterVodScrub();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
    } else {
      /* Some webOS remote events arrive after the panel has painted but
         before its boolean state is restored.  Focus inside the visible
         panel is the authoritative signal, so Up never zaps from channel 1
         to the last channel while the channel list is on screen. */
      var channelPanelHasFocus = state.focus && closest(state.focus, '.player-channels');
      if (state.channelsOpen || channelPanelHasFocus) {
        /* The category rail is a real focus area, not a channel row.  It
           must receive the arrows first; otherwise Right was interpreted as
           "close panel" and Down reused the currently playing channel. */
        var focusIsCategory = state.focus && state.focus.classList &&
          state.focus.classList.contains('pc-cat-pill');
        if (focusIsCategory) {
          if (k === 37) { moveFocus('left'); }
          else if (k === 38) { moveFocus('up'); }
          else if (k === 39) { moveFocus('right'); }
          else if (k === 40) { moveFocus('down'); }
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 38) {
          var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
          if (curIdx === 0) {
            var selCat = playerChannels ? (playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill')) : null;
            if (selCat) { setFocus(selCat); }
          } else {
            var prev = curIdx - 1;
            focusPlayerChannel(prev);
          }
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 40) {
          var curIdx = (state.focus && state.focus._channel !== undefined) ? state.focus._channel : state.channel;
          var next = Math.min(CHANNELS.length - 1, curIdx + 1);
          focusPlayerChannel(next);
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 39) { closeChannelPanel(); if (e.preventDefault) { e.preventDefault(); } return; }
      } else {
        if (k === 38) {
          if (state.channel > 0) { setChannel(state.channel - 1, false); }
          else if (CHANNELS.length) { setChannel(CHANNELS.length - 1, false); }
          showInfobar();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 40) {
          if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1, false); }
          else if (CHANNELS.length) { setChannel(0, false); }
          showInfobar();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 37) {
          openChannelPanel();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (state.infobar) { scheduleInfoHide(); } else { showInfobar(); }
      }
    }
  }

  if (k === 37) { moveFocus('left'); }
  else if (k === 38) { moveFocus('up'); }
  else if (k === 39) { moveFocus('right'); }
  else if (k === 40) { moveFocus('down'); }
  else if (k === 13 || k === 32) {
    if (state.episodeBrowserOpen) {
      activate();
      return;
    }
    if (dialogPlaySettingsOpen) {
      activate();
    } else if (playSettingViewOpen) {
      schedulePlaySettingHide();
      activate();
    } else if (state.screen === 'player' && state.playerMode === 'vod' &&
               state.focus === vodSeekbar && vodScrubbing) {
      /* OK belongs to the focused timeline, not to Play/Pause. */
      leaveVodScrub(true);
    } else if (state.screen === 'player' && state.streamError && playerVideo && playerVideo.src &&
               !closest(state.focus, '.player-channels')) {
      /* OK retries the failed stream, but only from the video surface: with
         the channel panel open it must activate the focused row/pill, or a
         dead channel made every category unfilterable. */
      resumePlayerPlayback();
      state.streamError = '';
      setPlayerStatus('');
    } else if (state.screen === 'player' && state.playerMode === 'vod') {
      togglePlayerPlayPause();
    } else {
      activate();
    }
  }
  else { handled = false; }
  if (handled && e.preventDefault) { e.preventDefault(); }
}
