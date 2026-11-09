/* desktop/pip.js — Ventana flotante (Picture-in-Picture) y controles multimedia del sistema.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Picture-in-Picture: the video floats in a small window on top of other
   apps. It keeps playing while the viewer browses or minimizes OpenTV.
   Subtitles are drawn by the page, so they are not shown in that window. */
var pipMediaSessionReady = false;
function setupPipMediaSession() {
  if (pipMediaSessionReady || !navigator.mediaSession) { return; }
  pipMediaSessionReady = true;
  var handlers = {
    play: function () { if (playerVideo) { playerVideo.play().catch(function () {}); } },
    pause: function () { if (playerVideo) { playerVideo.pause(); } },
    seekbackward: function () { playerSeek(-10); },
    seekforward: function () { playerSeek(10); },
    nexttrack: function () {
      if (state.playerMode === 'vod' && isSeriesItem(state.playerItem)) { advanceToNextEpisode(); }
    }
  };
  for (var name in handlers) {
    if (handlers.hasOwnProperty(name)) {
      try { navigator.mediaSession.setActionHandler(name, handlers[name]); } catch (eAction) { /* unsupported */ }
    }
  }
}

/* While another title floats in the PiP window, opening a detail page must
   not replace it with an automatic preview. Explicit play still does. */
function keepFloatingVideo() {
  return !!(playerVideo && document.pictureInPictureElement === playerVideo);
}

function autoPreviewAllowed(item) {
  if (!document.pictureInPictureElement || !playerVideo) { return true; }
  return !state.playerItem || state.playerItem === item;
}

/* Leaving PiP. Chromium pauses the video when the window is closed with
   its X, and keeps it playing for "back to tab". Closed: stop it if no
   player is on screen. Back: show the same video full size, no restart. */
var pipLeaveBound = false;
function bindPipLeave() {
  if (pipLeaveBound || !playerVideo) { return; }
  pipLeaveBound = true;
  playerVideo.addEventListener('leavepictureinpicture', function () {
    setTimeout(function () {
      var visible = state.screen === 'player' || state.screen === 'detail';
      if (playerVideo.paused) {
        if (!visible) { stopPlayerVideo(); }
        return;
      }
      if (state.screen === 'player') { return; }
      showFloatingVideoFullSize();
    }, 0);
  });
}

function showFloatingVideoFullSize() {
  var item = state.playerItem;
  if (!item || !playerStage) { return; }
  stopLivePreview();
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) { screens[i].classList.remove('is-active'); }
  if (state.detail !== item) { state.detail = item; state.detailNeedsRebuild = true; }
  state.playerMode = 'vod';
  state.playerReturn = { screen: 'detail', focus: null };
  var scrPlayer = $('screen-player');
  if (scrPlayer) { scrPlayer.classList.remove('is-mini'); scrPlayer.classList.add('is-active'); }
  state.screen = 'player';
  playerStage.classList.add('is-vod');
  updatePlayer();
  setFocus(playerStage);
  showVodInfobar();
}

function togglePictureInPicture() {
  if (!playerVideo || !document.pictureInPictureEnabled) { return; }
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(function () {});
    return;
  }
  if (!(playerVideo.currentSrc || playerVideo.getAttribute('src'))) {
    setPlayerStatus('Reproduce un vídeo para abrir la ventana flotante');
    return;
  }
  setupPipMediaSession();
  bindPipLeave();
  if (navigator.mediaSession && window.MediaMetadata && state.playerItem) {
    try {
      var ep = state.playerEpisode;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.playerItem.title || 'OpenTV',
        artist: ep && ep.number ? ('Episodio ' + ep.number) : ''
      });
    } catch (eMeta) { /* optional */ }
  }
  playerVideo.requestPictureInPicture().catch(function (err) {
    setPlayerStatus('No se pudo abrir la ventana flotante' + (err && err.message ? ': ' + err.message : ''));
  });
}
