/* player/compat-mode.js — Modo compatible (FFmpeg): preferencia por título y memoria en este equipo.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* "Modo fluido" is a per-title preference: turning it on for one movie must
   not leak into the next one, while a series keeps it across its episodes
   (same series id). */
var smoothModeByTitle = {};
/* Stops an automatic Normal -> Fluido retry from looping if FFmpeg itself
   cannot open a particular title. Cleared when the viewer opens a title. */
var autoSmoothFallbackKey = '';

function smoothModeKey(item) {
  if (!item) { return ''; }
  /* A manual mode is a series preference while chapters are playing.  The
     previous key used the current episode id, so selecting Fluido in E1
     silently reverted to Normal in E2 and could leave its resolver waiting
     on an incompatible direct pipeline. */
  if (isSeriesItem(item)) {
    return 'series:' + (item.seriesContentId || item.seriesId || item.seasonId || item.id || '');
  }
  var ep = mediaInfoEpisode(item);
  return (ep && ep.id) ? ep.id : (item.id || '');
}

/* Titles that only play in compatibility mode are remembered on this PC,
   so the next time they open straight in that mode. */
var COMPAT_STORE = 'opentv_compat_titles_v1';
function loadCompatTitles() {
  try { return JSON.parse(localStorage.getItem(COMPAT_STORE) || '{}') || {}; } catch (eLoad) { return {}; }
}
function saveCompatTitle(key, on) {
  if (!key) { return; }
  var all = loadCompatTitles();
  if (on) { all[key] = Date.now(); } else { delete all[key]; }
  var keys = Object.keys(all);
  if (keys.length > 400) {
    keys.sort(function (a, b) { return all[a] - all[b]; });
    for (var i = 0; i < keys.length - 400; i++) { delete all[keys[i]]; }
  }
  try { localStorage.setItem(COMPAT_STORE, JSON.stringify(all)); } catch (eSave) { /* storage full or off */ }
}
function clearCompatTitles() {
  try {
    localStorage.removeItem(COMPAT_STORE);
    localStorage.removeItem('opentv_compat_audio_v1');   // compat-watchdog.js COMPAT_AUDIO_STORE
  } catch (eClear) { /* ignore */ }
}
function compatEpisodeKey(item) { return mediaInfoKey(item) || smoothModeKey(item); }

function restoreSmoothMode(item) {
  var key = smoothModeKey(item);
  var saved = window.XUPER_DESKTOP ? loadCompatTitles() : {};
  if (key && !smoothModeByTitle.hasOwnProperty(key) &&
      (saved.hasOwnProperty(key) || saved.hasOwnProperty(compatEpisodeKey(item)))) {
    state.streamMode = 'smooth';
  } else if (key && smoothModeByTitle.hasOwnProperty(key)) {
    state.streamMode = smoothModeByTitle[key] ? 'smooth' : 'normal';
  } else {
    state.streamMode = state.playback.streamMode === 'smooth' ? 'smooth' : 'normal';
  }
}

function setSmoothMode(item, on) {
  var key = smoothModeKey(item);
  state.streamMode = on ? 'smooth' : 'normal';
  if (key) { smoothModeByTitle[key] = !!on; }
  if (window.XUPER_DESKTOP) {
    saveCompatTitle(key, on);
    if (!on) { saveCompatTitle(compatEpisodeKey(item), false); }
  }
}
