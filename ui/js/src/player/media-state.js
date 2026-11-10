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
var dpsRowSync = null;
var dpsLangOptions = null;
var dpsSizeOptions = null;
var dpsStyleOptions = null;
var dpsSyncOptions = null;
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
var vodSubOffset = 0;
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
  if (window.XUPER_DESKTOP && resumePending(item)) { return; }
  var episode = state.playerEpisode;
  if (window.XUPER_DESKTOP && !resumeRestarted) {
    var existing = historyRecordFor(item);
    if (existing && (existing.position || 0) >= RESUME_MIN_S && current < RESUME_MIN_S) {
      var sameTarget = !isSeriesItem(item) ||
        (episode && String(existing.episodeId) === String(episode.id));
      if (sameTarget) { return; }
    }
  }
  var now = Date.now();
  if (!force && now - lastHistorySaveAt < 10000) { return; }
  lastHistorySaveAt = now;
  var key = String(item.id);
  var seasonIdx = typeof state.playerSeasonIndex === 'number' ? state.playerSeasonIndex : (state.detailSeason || 0);
  var curSeasonObj = (item.seasons && item.seasons[seasonIdx]) || null;
  var seasonId = (curSeasonObj && curSeasonObj.id) ? String(curSeasonObj.id) : (item.seasonId ? String(item.seasonId) : key);
  var knownDur = Math.floor(vodPlaybackDuration() || durationToSeconds(duration) || (existing && existing.duration) || 0);
  var record = {
    id: key,
    title: item.title || item.name || 'Contenido',
    poster: item.poster || item.cover || '',
    landscape: item.landscape || item.backdrop || '',
    series: !!isSeriesItem(item),
    portal: !!item._portal,
    stremio: !!item._stremio,
    seasonId: seasonId,
    seasonIndex: seasonIdx,
    seasonNumber: (curSeasonObj && curSeasonObj.number) || '',
    episodeId: episode && episode.id ? String(episode.id) : '',
    episodeNumber: episode ? (episode.number || episode.seriesNumber || '') : '',
    position: Math.floor(current),
    duration: knownDur,
    updatedAt: now
  };
  var next = [record];
  var old = localProfile.history || [];
  var itemTitleNorm = norm(record.title || '');
  var itemSeasons = item._catalogSeasons || item.seasons || [];
  for (var i = 0; i < old.length && next.length < 30; i++) {
    var oldRec = old[i];
    if (!oldRec) { continue; }
    if (String(oldRec.id) === key) { continue; }
    if (record.series && oldRec.series) {
      if (seasonId && (String(oldRec.id) === seasonId || String(oldRec.seasonId) === seasonId)) { continue; }
      var matchedSeason = false;
      for (var s = 0; s < itemSeasons.length; s++) {
        if (String(itemSeasons[s].id) === String(oldRec.id) ||
            (oldRec.seasonId && String(itemSeasons[s].id) === String(oldRec.seasonId))) {
          matchedSeason = true;
          break;
        }
      }
      if (matchedSeason || (itemTitleNorm && norm(oldRec.title || '') === itemTitleNorm)) { continue; }
    }
    next.push(oldRec);
  }
  localProfile.history = next;
  safeLocalWrite(LOCAL_PROFILE_KEY, localProfile);
  if (typeof refreshContinueRows === 'function') { refreshContinueRows(); }
  if (state.screen === 'detail' && state.detail === item && detailButtons) {
    var mainPlayBtn = detailButtons.querySelector('.detail-btn[data-kind="fullscreen"] span');
    var nextLabel = resumeLabelFor(item);
    if (mainPlayBtn && nextLabel) { mainPlayBtn.textContent = nextLabel; }
  }
}

var pendingHistoryRecord = null;
function applyPendingHistoryEpisode(item) {
  var record = pendingHistoryRecord || (window.XUPER_DESKTOP ? historyRecordFor(item) : null);
  if (!record || !item || !record.episodeId || !item.episodes || !item.episodes.length) { return; }
  var matchedRecord = historyRecordFor(item);
  if (String(record.id) !== String(item.id) && matchedRecord !== record) { return; }
  if (item.seasons && item.seasons.length > 1) {
    var wantedSeasonId = String(record.seasonId || record.id || '');
    for (var s = 0; s < item.seasons.length; s++) {
      if (String(item.seasons[s].id) === wantedSeasonId) {
        state.detailSeason = s;
        state.playerSeasonIndex = s;
        break;
      }
    }
  }
  for (var i = 0; i < item.episodes.length; i++) {
    var ep = item.episodes[i];
    var idMatch = String(ep.id) === String(record.episodeId);
    var numMatch = !idMatch && record.episodeNumber &&
      String(ep.number || ep.seriesNumber || (i + 1)) === String(record.episodeNumber);
    if (idMatch || numMatch) {
      /* Desktop: a finished episode moves on to the next one. */
      var pickIndex = (window.XUPER_DESKTOP && recordFinished(record) && item.episodes[i + 1]) ? (i + 1) : i;
      var pick = item.episodes[pickIndex];
      state.detailEpisode = pick;
      state.playerEpisode = pick;
      state.detailRange = Math.floor(pickIndex / 20);
      state.playerEpisodeRange = Math.floor(pickIndex / 20);
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

function escapeSubtitleText(text) {
  return String(text)
    .replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>');
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
        /* Subtitle files come from the network: escape everything, then
           restore only the plain formatting tags SRT files use. */
        var txt = escapeSubtitleText(textLines.join('\n')).replace(/\n/g, '<br>').trim();
        if (txt) cues.push({ start: start, end: end, text: txt });
      }
    }
  }
  return cues;
}

var nativeSubTrack = null;

function syncNativeSubtitleTrack() {
  if (!playerVideo || typeof VTTCue === 'undefined') { return; }
  try {
    if (!nativeSubTrack) {
      nativeSubTrack = playerVideo.addTextTrack('subtitles', 'Subtítulos', 'es');
    }
    while (nativeSubTrack.cues && nativeSubTrack.cues.length) {
      nativeSubTrack.removeCue(nativeSubTrack.cues[0]);
    }
    if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
      nativeSubTrack.mode = 'disabled';
      return;
    }
    var offset = vodSubOffset || 0;
    for (var i = 0; i < activeSubtitleCues.length; i++) {
      var c = activeSubtitleCues[i];
      var s = Math.max(0, c.start + offset);
      var e = Math.max(s + 0.2, c.end + offset);
      var plain = String(c.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      nativeSubTrack.addCue(new VTTCue(s, e, plain));
    }
    var inPip = typeof document.pictureInPictureElement !== 'undefined' && document.pictureInPictureElement === playerVideo;
    nativeSubTrack.mode = inPip ? 'showing' : 'hidden';
  } catch (eTrack) { /* ignore */ }
}

function loadSubtitleTrack(sub) {
  subtitleSeq++;
  var mySeq = subtitleSeq;
  if (!sub || !sub.url) {
    activeSubtitleCues = [];
    if (playerSubtitles) playerSubtitles.innerHTML = '';
    syncNativeSubtitleTrack();
    return;
  }
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', sub.url, true);
    xhr.onload = function () {
      if (mySeq !== subtitleSeq) { return; }
      if (xhr.status >= 200 && xhr.status < 300) {
        activeSubtitleCues = parseSRT(xhr.responseText);
        syncNativeSubtitleTrack();
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
  if (nativeSubTrack && playerVideo) {
    var inPip = typeof document.pictureInPictureElement !== 'undefined' && document.pictureInPictureElement === playerVideo;
    var targetMode = (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) ? 'disabled' : (inPip ? 'showing' : 'hidden');
    if (nativeSubTrack.mode !== targetMode) { nativeSubTrack.mode = targetMode; }
  }
  if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
    if (playerSubtitles.innerHTML !== '') playerSubtitles.innerHTML = '';
    return;
  }
  var effectiveSec = currentSec - (vodSubOffset || 0);
  var cue = null;
  for (var i = 0; i < activeSubtitleCues.length; i++) {
    if (effectiveSec >= activeSubtitleCues[i].start && effectiveSec <= activeSubtitleCues[i].end) {
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
