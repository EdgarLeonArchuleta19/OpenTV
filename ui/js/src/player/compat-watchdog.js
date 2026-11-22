/* player/compat-watchdog.js — Cambio automático al modo compatible (solo PC).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Compatibility mode, automatic.
   Normal playback (Directo) is used first. When a VOD title fails to
   start, keeps freezing or has no sound, it is restarted once through the
   FFmpeg compatibility route ("Modo fluido" internally), at the same
   position. If it then plays, the title is remembered on this PC. It is
   tried once per title; there is no manual switch any more.
   ------------------------------------------------------------------ */
var COMPAT_START_MS = 15000;      // no picture after this long
var COMPAT_STALL_MS = 2500;       // a wait longer than this is a freeze
var COMPAT_STALLS = 3;            // ...this many freezes...
var COMPAT_STALL_WINDOW = 60000;  // ...within this window
var COMPAT_LONG_STALL_MS = 12000; // or one freeze this long
var compatWatch = null;
var compatAuto = null;
var compatTimer = null;
var COMPAT_AUDIO_SECS = 3;        // seconds of picture with no decoded sound = Dolby audio
var COMPAT_AUDIO_STORE = 'opentv_compat_audio_v1';

/* Titles whose only problem was the audio (AC3/EAC3, which Chromium cannot
   decode). For them the relay copies the video untouched and converts only
   the sound to AAC, instead of re-encoding the whole picture. */
function loadCompatAudioTitles() {
  try { return JSON.parse(localStorage.getItem(COMPAT_AUDIO_STORE) || '{}') || {}; } catch (eLoad) { return {}; }
}
function saveCompatAudioTitle(key) {
  if (!key) { return; }
  var all = loadCompatAudioTitles();
  all[key] = Date.now();
  var keys = Object.keys(all);
  if (keys.length > 400) {
    keys.sort(function (a, b) { return all[a] - all[b]; });
    for (var i = 0; i < keys.length - 400; i++) { delete all[keys[i]]; }
  }
  try { localStorage.setItem(COMPAT_AUDIO_STORE, JSON.stringify(all)); } catch (eSave) { /* storage full or off */ }
}

/* Only the PC app: its Chromium decodes H.264 and HEVC itself, and the TV
   players keep the proven full re-encode. */
function compatVideoCopy(item) {
  if (platformName() !== 'electron' || !item) { return false; }
  var key = compatEpisodeKey(item);
  var audioOnly = (compatAuto && compatAuto.item === item && compatAuto.reason === 'audio') ||
    (key && loadCompatAudioTitles().hasOwnProperty(key));
  if (!audioOnly) { return false; }
  if (/hevc|h\.?265/i.test(item.streamCodec || '')) {
    try { return !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'); } catch (eType) { return false; }
  }
  return true;
}

function tryCompatFallback(reason) {
  if (state.playerMode !== 'vod' || state.streamMode !== 'normal' || !state.playerItem) { return false; }
  /* Android's player (ExoPlayer) has no FFmpeg route: nothing to switch to. */
  if (platformHas('native-player')) { return false; }
  var item = state.playerItem;
  var key = compatEpisodeKey(item);
  /* Tried once already for this title: the error stays on screen (the
     manual "Probar modo compatible" notice is gone). */
  if (autoSmoothFallbackKey === key) { return false; }
  autoSmoothFallbackKey = key;
  compatAuto = { item: item, key: key, reason: reason };
  if (compatWatch) { compatWatch.item = null; }
  state.streamMode = 'smooth';
  setPlayerStatus(window.OPENTV_DESKTOP ? 'Ajustando la reproducción…' : 'Reintentando película en modo compatible…');
  setTimeout(function () {
    if (state.playerMode === 'vod' && state.playerItem === item && state.streamMode === 'smooth') {
      restartCurrentPlayback();
    }
  }, 0);
  return true;
}

function compatWatchBegin() {
  if (!window.OPENTV_DESKTOP || !playerVideo) { return; }
  compatWatch = { item: state.playerItem, began: Date.now(), played: false, stalls: [],
                  waitingSince: 0, playSecs: 0, audioChecked: false };
  if (playerVideo) { playerVideo._opentvNoAudio = false; }
  if (compatTimer) { return; }
  playerVideo.addEventListener('waiting', function () {
    if (compatWatch && compatWatch.played && !compatWatch.waitingSince) { compatWatch.waitingSince = Date.now(); }
  });
  playerVideo.addEventListener('playing', function () {
    var w = compatWatch;
    if (w) {
      if (w.waitingSince && Date.now() - w.waitingSince > COMPAT_STALL_MS) { w.stalls.push(Date.now()); }
      w.waitingSince = 0;
      w.played = true;
    }
    if (compatAuto && state.streamMode === 'smooth' && state.playerItem === compatAuto.item) {
      saveCompatTitle(compatAuto.key, true);
      if (compatAuto.reason === 'audio') { saveCompatAudioTitle(compatAuto.key); }
      compatAuto = null;
    }
  });
  playerVideo.addEventListener('seeking', function () {
    /* A wait caused by the viewer seeking is not a freeze. */
    if (compatWatch) { compatWatch.waitingSince = 0; }
  });
  document.addEventListener('opentv:hls-fatal', function () { tryCompatFallback('hls'); });
  compatTimer = setInterval(compatWatchTick, 1000);
}

function compatWatchTick() {
  var w = compatWatch;
  if (!w || !w.item || !playerVideo || state.playerMode !== 'vod' || state.playerItem !== w.item ||
      state.streamMode !== 'normal') { return; }
  var now = Date.now();
  /* Torrents (Stremio mode): slow starts and pauses are the download. */
  var torrent = stremioPlayingTorrent();
  if (!w.played) {
    if (playerVideo.readyState >= 3) { w.played = true; return; }
    if (now - w.began > COMPAT_START_MS && !torrent) { w.item = null; tryCompatFallback('start'); }
    return;
  }
  if (torrent) { w.waitingSince = 0; w.stalls = []; }
  if (w.waitingSince && now - w.waitingSince > COMPAT_LONG_STALL_MS) {
    w.waitingSince = 0; w.stalls = [];
    tryCompatFallback('stall');
    return;
  }
  while (w.stalls.length && now - w.stalls[0] > COMPAT_STALL_WINDOW) { w.stalls.shift(); }
  if (w.stalls.length >= COMPAT_STALLS) {
    w.stalls = [];
    tryCompatFallback('stalls');
    return;
  }
  if (!w.audioChecked && !playerVideo.paused && playerVideo.readyState >= 3) {
    w.playSecs++;
    if (w.playSecs >= COMPAT_AUDIO_SECS) {
      w.audioChecked = true;
      var audioBytes = playerVideo.webkitAudioDecodedByteCount;
      var videoBytes = playerVideo.webkitVideoDecodedByteCount;
      /* A few seconds of picture are enough: supported audio is decoded
         alongside the first frames, so zero bytes here means Dolby. */
      var silent = playerVideo._opentvNoAudio === true ||
        (typeof audioBytes === 'number' && audioBytes === 0 && videoBytes > 300000);
      if (silent) { tryCompatFallback('audio'); }
    }
  }
}
