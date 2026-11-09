/* player/media-state.js — Reproductor: estado de audio/subtítulos/formato, preferencias globales, progreso visto y subtítulos SRT.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --- PlaySettingView (Bottom Drawer) & SelectSubTitleAndAudioDialog Controller --- */
var playSettingView = null;
var dialogPlaySettings = null;
var psvSecSelection = null;
var psvEpisodesRow = null;
var psvBtnConfig = null;
var psvBtnP1 = null;
var psvBtnP2 = null;
var psvSecAudio = null;
var psvSecQuality = null;
var psvQualityRow = null;
var psvSecAspect = null;
var psvSecPlayer = null;
var psvBtnFeedback = null;
var psvAspectRow = null;

/* Season/episode browser (in-player). */
var psvBtnEpisodes = null;
var episodeBrowser = null;
var peTitle = null, peSub = null, peSeasons = null, peSeasonsCol = null,
    peEpisodes = null, peSeasonLabel = null;

var dpsAudioOptions = null;
var dpsSubSwitch = null;
var dpsRowLang = null;
var dpsRowSize = null;
var dpsRowStyle = null;
var dpsLangOptions = null;
var dpsSizeOptions = null;
var dpsStyleOptions = null;
var dpsBtnExit = null;
var playerSubtitles = null;

var playSettingViewOpen = false;
var dialogPlaySettingsOpen = false;
var playSettingTimer = null;
var vodCurrentAudioTrack = 0;
/* Once the user picks a language we stop auto-selecting the preferred one. */
var vodAudioChosen = false;
/* Older Starfish builds can report MEDIA_ERR_SRC_NOT_SUPPORTED while they
   apply a native audio PID.  It is not a failed movie and must never turn
   Normal (Directo) into Modo Fluido. */
var audioTrackSwitchUntil = 0;
var vodCurrentSubtitle = null;
var vodSubActive = false;
/* True once the user flips the switch or picks a language; from then on the
   default (Spanish when available) no longer overrides the choice. */
var vodSubChosen = false;
var subtitleSeq = 0;
var vodSubSize = 'normal';
var vodSubStyle = 'white';
var playerCurrentAspect = 'contain';
var lastHistorySaveAt = 0;

function globalAspectValue() {
  return ['cover', 'contain', '16-9', '4-3'][Number(state.playback.screen) || 0] || 'contain';
}

function globalSubtitleSize() {
  return ['normal', 'big', 'small'][Number(state.playback.size) || 0] || 'normal';
}

function globalSubtitleStyle() {
  return ['white', 'yellow', 'black'][Number(state.playback.style) || 0] || 'white';
}

function applyGlobalPlaybackPreferences() {
  vodSubSize = globalSubtitleSize();
  vodSubStyle = globalSubtitleStyle();
  if (!vodSubChosen) { vodSubActive = !!state.playback.subtitle; }
  setPlayerAspect(globalAspectValue());
  applySubtitleStyles();
}

function preferredLanguageCode() {
  return ['es', 'pt', 'en'][Number(state.playback.audio) || 0] || 'es';
}

function preferredSubtitleCode() {
  return ['es', 'pt', 'en'][Number(state.playback.subLang) || 0] || 'es';
}

function languageMatchesPreference(label, code) {
  var value = String(label || code || '').toLowerCase();
  var wanted = code || 'es';
  if (wanted === 'es') {
    return /^(es|spa|esp|lat|cast)|espa|latino|latin|castell/i.test(value);
  }
  if (wanted === 'pt') { return /^(pt|por)|portu/.test(value); }
  if (wanted === 'en') { return /^(en|eng|ing)|ingl/.test(value); }
  return false;
}

function rememberWatchProgress(current, duration, force) {
  var item = state.playerItem;
  if (!item || !item.id || current < 3) { return; }
  var now = Date.now();
  if (!force && now - lastHistorySaveAt < 15000) { return; }
  lastHistorySaveAt = now;
  var episode = state.playerEpisode;
  var key = String(item.id);
  var record = {
    id: key,
    title: item.title || item.name || 'Contenido',
    poster: item.poster || item.cover || '',
    series: !!isSeriesItem(item),
    episodeId: episode && episode.id ? String(episode.id) : '',
    episodeNumber: episode ? (episode.number || episode.seriesNumber || '') : '',
    position: Math.floor(current),
    duration: Math.floor(vodPlaybackDuration() || durationToSeconds(duration) || 0),
    updatedAt: now
  };
  var next = [record];
  var old = localProfile.history || [];
  for (var i = 0; i < old.length && next.length < 30; i++) {
    if (String(old[i].id) !== key) { next.push(old[i]); }
  }
  localProfile.history = next;
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
}

var pendingHistoryRecord = null;
function applyPendingHistoryEpisode(item) {
  var record = pendingHistoryRecord;
  if (!record || !item || String(record.id) !== String(item.id) || !record.episodeId || !item.episodes) { return; }
  for (var i = 0; i < item.episodes.length; i++) {
    if (String(item.episodes[i].id) === record.episodeId) {
      state.detailEpisode = item.episodes[i];
      state.playerEpisode = item.episodes[i];
      return;
    }
  }
}

function openHistoryRecord(record) {
  if (!record) { return; }
  for (var i = 0; i < VOD.length; i++) {
    if (String(VOD[i].id) === String(record.id)) {
      pendingHistoryRecord = record;
      openDetail(VOD[i]);
      return;
    }
  }
  /* Catalog refreshes can group seasons or replace the visible root list.
     Recover by grouped season id/title, and finally recreate a portal item
     from the durable history record so its real id can still be resolved. */
  var wantedTitle = norm(record.title || '');
  for (var v = 0; v < VOD.length; v++) {
    var candidate = VOD[v];
    var seasons = candidate._catalogSeasons || [];
    var seasonMatch = false;
    for (var s = 0; s < seasons.length; s++) {
      if (String(seasons[s].id) === String(record.id)) { seasonMatch = true; break; }
    }
    if (seasonMatch || (wantedTitle && norm(candidate.title || '') === wantedTitle)) {
      pendingHistoryRecord = record;
      openDetail(candidate);
      return;
    }
  }
  var recovered = normalizeVod({
    id: record.id,
    title: record.title,
    poster: record.poster,
    type: record.series ? 'teleplay' : 'movie',
    portal: true
  }, 0);
  recovered._portal = true;
  pendingHistoryRecord = record;
  openDetail(recovered);
}
var activeSubtitleCues = [];
/* mediaInfo payloads keyed by episode/movie content id. */
var mediaInfoCache = {};
var mediaInfoPending = {};
var dialogReturnFocus = null;

function parseTimestamp(s) {
  if (!s) return 0;
  var p = s.replace(',', '.').split(':');
  if (p.length === 3) {
    return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
  }
  return 0;
}

function parseSRT(data) {
  var cues = [];
  if (!data) return cues;
  var blocks = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].trim().split('\n');
    if (lines.length >= 2) {
      var timeLine = (lines[0].indexOf('-->') !== -1) ? lines[0] : lines[1];
      var textLines = (lines[0].indexOf('-->') !== -1) ? lines.slice(1) : lines.slice(2);
      if (timeLine && timeLine.indexOf('-->') !== -1) {
        var m = timeLine.split('-->');
        var start = parseTimestamp(m[0].trim());
        var end = parseTimestamp(m[1].trim());
        var txt = textLines.join('<br>').replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '').trim();
        if (txt) cues.push({ start: start, end: end, text: txt });
      }
    }
  }
  return cues;
}

function loadSubtitleTrack(sub) {
  subtitleSeq++;
  var mySeq = subtitleSeq;
  if (!sub || !sub.url) {
    activeSubtitleCues = [];
    if (playerSubtitles) playerSubtitles.innerHTML = '';
    return;
  }
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', sub.url, true);
    xhr.onload = function () {
      if (mySeq !== subtitleSeq) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        activeSubtitleCues = parseSRT(xhr.responseText);
      }
    };
    xhr.send();
  } catch (eSub) { /* ignore */ }
}

function applySubtitleStyles() {
  if (!playerSubtitles) return;
  playerSubtitles.classList.remove('size-small', 'size-normal', 'size-big');
  playerSubtitles.classList.add('size-' + vodSubSize);
  playerSubtitles.classList.remove('color-white', 'color-yellow', 'color-black');
  playerSubtitles.classList.add('color-' + vodSubStyle);
}

function updateSubtitleDisplay(currentSec) {
  if (!playerSubtitles) return;
  if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
    if (playerSubtitles.innerHTML !== '') playerSubtitles.innerHTML = '';
    return;
  }
  var cue = null;
  for (var i = 0; i < activeSubtitleCues.length; i++) {
    if (currentSec >= activeSubtitleCues[i].start && currentSec <= activeSubtitleCues[i].end) {
      cue = activeSubtitleCues[i];
      break;
    }
  }
  if (cue) {
    var html = '<span class="player-subtitles-text">' + cue.text + '</span>';
    if (playerSubtitles.innerHTML !== html) {
      playerSubtitles.innerHTML = html;
    }
  } else {
    if (playerSubtitles.innerHTML !== '') {
      playerSubtitles.innerHTML = '';
    }
  }
}

/* ---- Real portal audio/subtitle metadata -------------------------------
   PlaySettingView and the "Ajuste de reproducir" dialog read the same data
   the portal returns for startPlayVOD: the audio PID list and the subtitle
   file list.  It is fetched once per episode/movie and cached; playback
   still goes through resolve(). */
function playSettingsItem() {
  if (state.screen === 'detail') { return state.detail || null; }
  return state.playerItem || state.detail || null;
}
