/* player/live-controls.js — Escritorio: TV en pantalla completa real, pausa/reproducir y actualizar canales.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* "Pantalla completa" on the TV now really fills the screen (Windows full
   screen, like a TV); leaving the player leaves it too, and Esc does both
   at once. */
var liveAutoFullscreen = false;

/* The video on screen: the home preview's own element while it stands in
   for the player (hand-off), otherwise the player's. */
function liveActiveVideo() {
  return liveHandoff && liveHandoff.type === 'preview' && livePreviewVideo ? livePreviewVideo : playerVideo;
}

function enterLiveFullscreen() {
  if (!window.XUPER_DESKTOP || isWindowFullscreen()) { return; }
  liveAutoFullscreen = true;
  setWindowFullscreen(true);
}

function leaveLiveFullscreen() {
  if (!liveAutoFullscreen) { return; }
  liveAutoFullscreen = false;
  if (isWindowFullscreen()) { setWindowFullscreen(false); }
}

function toggleLivePlayPause() {
  var v = liveActiveVideo();
  if (!v) { return; }
  if (v.paused) {
    var p = v.play();
    if (p && p.catch) { p.catch(function () {}); }
    showOsdIcon('none');
  } else {
    v.pause();
    showOsdIcon('pause');
  }
  syncLivePlayButton();
  showInfobar();
}

function syncLivePlayButton() {
  var b = document.querySelector('.pi-act.pi-play');
  if (!b) { return; }
  var v = liveActiveVideo();
  var paused = !!(v && v.paused);
  if (b._paused === paused) { return; }
  b._paused = paused;
  setButtonText(b, paused ? 'Reproducir (Espacio)' : 'Pausa (Espacio)', paused ? UI_ICONS.play : UI_ICONS.pause);
}

function syncLiveFullscreenButton() {
  var b = document.querySelector('.pi-act.pi-full');
  if (!b) { return; }
  var full = isWindowFullscreen();
  setButtonText(b, full ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa (F)', full ? UI_ICONS.exitFullscreen : UI_ICONS.fullscreen);
}

/* Reloads the channels of the current category and keeps the channel that
   is playing selected. */
function refreshLiveChannels(btn) {
  if (!currentLiveCategory) { return; }
  var keep = liveChannelKey(CHANNELS[state.channel]);
  if (btn) { btn.classList.add('is-spinning'); }
  setPlayerStatus('Actualizando canales…');
  switchLiveCategory(currentLiveCategory, function () {
    for (var i = 0; i < CHANNELS.length; i++) {
      if (liveChannelKey(CHANNELS[i]) === keep) { state.channel = i; break; }
    }
    renderPlayerChannels(state.channel);
    renderLiveRows(false);
    setPlayerStatus('');
    if (btn) { btn.classList.remove('is-spinning'); }
  });
}

var liveControlsWatching = false;
function installLiveControls() {
  if (!window.XUPER_DESKTOP) { return; }
  [playerVideo, livePreviewVideo].forEach(function (v) {
    if (!v || v._liveControls) { return; }
    v._liveControls = true;
    v.addEventListener('play', syncLivePlayButton);
    v.addEventListener('pause', syncLivePlayButton);
  });
  if (!liveControlsWatching && window.desktop && window.desktop.onFullscreenChanged) {
    liveControlsWatching = true;
    window.desktop.onFullscreenChanged(function (isFull) {
      syncLiveFullscreenButton();
      /* Esc (or F11) out of the TV's full screen also leaves the player. */
      if (!isFull && liveAutoFullscreen && state.screen === 'player' && state.playerMode === 'live') {
        liveAutoFullscreen = false;
        desktopBack();
      }
    });
  }
}

/* ------------------------------------------------------------------
   Changing category (guide, chips, channel panel) only changes the list:
   the channel that is playing keeps playing. It stays selected in the new
   list, or is shown on top of it when that category does not have it.
   ------------------------------------------------------------------ */
var liveNowPlaying = null;
function noteLivePlaying(ch) {
  if (!window.XUPER_DESKTOP) { return; }
  liveNowPlaying = ch || null;
}

function livePlayingToKeep() {
  if (!window.XUPER_DESKTOP || !liveNowPlaying) { return null; }
  var key = liveChannelKey(liveNowPlaying);
  if (!key) { return null; }
  if (state.screen === 'player' && state.playerMode === 'live') { return liveNowPlaying; }
  if (livePreviewChannel === key) { return liveNowPlaying; }
  return null;
}

function keepLivePlayingChannel(keep) {
  if (!keep) { return false; }
  var key = liveChannelKey(keep);
  for (var i = 0; i < CHANNELS.length; i++) {
    if (liveChannelKey(CHANNELS[i]) === key) { state.channel = i; return true; }
  }
  var copy = {};
  for (var k in keep) { if (Object.prototype.hasOwnProperty.call(keep, k)) { copy[k] = keep[k]; } }
  copy._keptPlaying = true;
  copy.fav = !!state.favs[liveFavKey(copy)];
  CHANNELS.unshift(copy);
  state.channel = 0;
  return true;
}
