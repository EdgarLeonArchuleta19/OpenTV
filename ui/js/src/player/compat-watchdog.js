/* player/compat-watchdog.js — Cambio automático al modo compatible y aviso "¿Problemas con este vídeo?".
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------
   Compatibility mode, automatic.
   Normal playback (Directo) is used first. When a VOD title fails to
   start, keeps freezing or has no sound, it is restarted once through the
   FFmpeg compatibility route ("Modo fluido" internally), at the same
   position. If it then plays, the title is remembered on this PC. When the
   automatic retry was already used for that title, the player only offers
   it in a small notice instead of switching on its own.
   ------------------------------------------------------------------ */
var COMPAT_START_MS = 15000;      // no picture after this long
var COMPAT_STALL_MS = 2500;       // a wait longer than this is a freeze
var COMPAT_STALLS = 3;            // ...this many freezes...
var COMPAT_STALL_WINDOW = 60000;  // ...within this window
var COMPAT_LONG_STALL_MS = 12000; // or one freeze this long
var compatWatch = null;
var compatAuto = null;
var compatTimer = null;
var compatSuggest = null;
var compatSuggestTimer = null;

function tryCompatFallback(reason) {
  if (state.playerMode !== 'vod' || state.streamMode !== 'normal' || !state.playerItem) { return false; }
  var item = state.playerItem;
  var key = compatEpisodeKey(item);
  if (autoSmoothFallbackKey === key) {
    if (window.XUPER_DESKTOP) { showCompatSuggestion(item); }
    return false;
  }
  autoSmoothFallbackKey = key;
  compatAuto = { item: item, key: key, reason: reason };
  if (compatWatch) { compatWatch.item = null; }
  state.streamMode = 'smooth';
  setPlayerStatus(window.XUPER_DESKTOP ? 'Ajustando la reproducción…' : 'Reintentando película en modo compatible…');
  setTimeout(function () {
    if (state.playerMode === 'vod' && state.playerItem === item && state.streamMode === 'smooth') {
      restartCurrentPlayback();
    }
  }, 0);
  return true;
}

function compatWatchBegin() {
  if (!window.XUPER_DESKTOP || !playerVideo) { return; }
  hideCompatSuggestion();
  compatWatch = { item: state.playerItem, began: Date.now(), played: false, stalls: [],
                  waitingSince: 0, playSecs: 0, audioChecked: false };
  if (playerVideo) { playerVideo._xuperNoAudio = false; }
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
      compatAuto = null;
    }
  });
  playerVideo.addEventListener('seeking', function () {
    /* A wait caused by the viewer seeking is not a freeze. */
    if (compatWatch) { compatWatch.waitingSince = 0; }
  });
  document.addEventListener('xuper:hls-fatal', function () { tryCompatFallback('hls'); });
  compatTimer = setInterval(compatWatchTick, 1000);
}

function compatWatchTick() {
  var w = compatWatch;
  if (compatSuggest && state.screen !== 'player' && state.screen !== 'detail') { hideCompatSuggestion(); }
  if (!w || !w.item || !playerVideo || state.playerMode !== 'vod' || state.playerItem !== w.item ||
      state.streamMode !== 'normal') { return; }
  var now = Date.now();
  if (!w.played) {
    if (playerVideo.readyState >= 3) { w.played = true; return; }
    if (now - w.began > COMPAT_START_MS) { w.item = null; tryCompatFallback('start'); }
    return;
  }
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
    if (w.playSecs >= 8) {
      w.audioChecked = true;
      var audioBytes = playerVideo.webkitAudioDecodedByteCount;
      var videoBytes = playerVideo.webkitVideoDecodedByteCount;
      var silent = playerVideo._xuperNoAudio === true ||
        (typeof audioBytes === 'number' && audioBytes === 0 && videoBytes > 2000000);
      if (silent) { tryCompatFallback('audio'); }
    }
  }
}

function showCompatSuggestion(item) {
  if (!window.XUPER_DESKTOP || (state.screen !== 'player' && state.screen !== 'detail')) { return; }
  if (!compatSuggest) {
    compatSuggest = el('div', 'compat-suggest');
    compatSuggest.setAttribute('role', 'status');
    compatSuggest.setAttribute('aria-live', 'polite');
    var icon = el('div', 'cs-icon');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>';
    var text = el('div', 'cs-text');
    text.appendChild(el('b', null, '¿Problemas con este vídeo?'));
    text.appendChild(el('span', null, 'Si se corta, no carga o no tiene sonido, prueba el modo compatible.'));
    var go = el('button', 'cs-go desktop-native-control', 'Probar modo compatible');
    go.type = 'button';
    var close = el('button', 'cs-close desktop-native-control');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar aviso');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    go.addEventListener('click', function () {
      var target = compatSuggest._item;
      hideCompatSuggestion();
      if (target && state.playerItem === target) {
        setSmoothMode(target, true);
        renderPlaySettingPlayerOptions();
        restartCurrentPlayback();
      }
    });
    close.addEventListener('click', hideCompatSuggestion);
    compatSuggest.appendChild(icon);
    compatSuggest.appendChild(text);
    compatSuggest.appendChild(go);
    compatSuggest.appendChild(close);
    document.body.appendChild(compatSuggest);
  }
  compatSuggest._item = item;
  compatSuggest.classList.add('is-visible');
  if (compatSuggestTimer) { clearTimeout(compatSuggestTimer); }
  compatSuggestTimer = setTimeout(hideCompatSuggestion, 20000);
}

function hideCompatSuggestion() {
  if (compatSuggestTimer) { clearTimeout(compatSuggestTimer); compatSuggestTimer = null; }
  if (compatSuggest) { compatSuggest.classList.remove('is-visible'); }
}
