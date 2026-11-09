/* player/media-info.js — Metadatos reales de audio/subtítulos del portal y calidades.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Called when a different title is opened, never when zapping episodes. */
function resetMediaSelection() {
  autoSmoothFallbackKey = '';
  vodCurrentAudioTrack = 0;
  vodAudioChosen = false;
  vodCurrentSubtitle = null;
  vodSubActive = false;
  vodSubChosen = false;
  subtitleSeq++;
  state.trackIndex = 0;
  activeSubtitleCues = [];
  if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
}

function mediaInfoEpisode(item) {
  if (!item) { return null; }
  if (isSeriesItem(item)) {
    if (state.screen === 'player' && state.playerEpisode) { return state.playerEpisode; }
    if (state.detailEpisode) { return state.detailEpisode; }
    return (item.episodes && item.episodes[0]) || null;
  }
  return null;
}

function mediaInfoKey(item) {
  if (!item) { return ''; }
  var ep = mediaInfoEpisode(item);
  return (ep && ep.id) ? ep.id : (item.id || '');
}

function ensureMediaInfo(item, done) {
  done = done || function () {};
  if (!item) { return done(null); }
  var key = mediaInfoKey(item);
  if (!key) { return done(null); }
  if (mediaInfoCache[key]) {
    applySubtitleDefaults(mediaInfoCache[key]);
    return done(mediaInfoCache[key]);
  }
  if (mediaInfoPending[key]) { mediaInfoPending[key].push(done); return; }
  mediaInfoPending[key] = [done];

  var ep = mediaInfoEpisode(item);
  var params = { contentId: key };
  var seriesRef = item.seasonId || item.id;
  if (ep && ep.id && seriesRef && ep.id !== seriesRef) { params.seriesContentId = seriesRef; }
  portalServiceCall('mediaInfo', params, function (error, payload) {
    var waiters = mediaInfoPending[key] || [];
    delete mediaInfoPending[key];
    var info = (!error && payload && payload.returnValue !== false) ? payload : null;
    if (info) {
      mediaInfoCache[key] = info;
      var infoDuration = durationToSeconds(info.duration);
      if (infoDuration) {
        (ep || item).duration = infoDuration;
        document.dispatchEvent(new CustomEvent('xuper:duration'));
      }
      applySubtitleDefaults(info);
    }
    for (var i = 0; i < waiters.length; i++) {
      try { waiters[i](info); } catch (eWaiter) { /* ignore */ }
    }
  });
}

/* The portal lists audio PIDs in stream order ("por,spa,eng").  The real
   app preselects Spanish when present, so do the same. */
function preferredAudioIndex(rawAudio) {
  var parts = (rawAudio || '').split(/[,\/]/);
  var preferred = preferredLanguageCode();
  for (var i = 0; i < parts.length; i++) {
    if (languageMatchesPreference(parts[i].trim(), preferred)) { return i; }
  }
  return 0;
}

function audioLanguageList(info) {
  var out = [];
  var parts = ((info && info.audio) || '').split(/[,\/]/);
  for (var i = 0; i < parts.length; i++) {
    var code = parts[i].trim();
    if (!code) { continue; }
    out.push({ index: i, code: code, label: formatAudioLang(code) });
  }
  return out;
}

function subtitleLanguageList(info) {
  var out = [];
  var subs = (info && info.subtitles) || [];
  for (var i = 0; i < subs.length; i++) {
    out.push({ lang: subs[i].lang, url: subs[i].url, format: subs[i].format });
  }
  /* The real dialog lists Español before Inglés for this catalog. */
  out.sort(function (a, b) {
    var pa = /^(es|spa|esp)$/i.test(a.lang || '') ? 0 : 1;
    var pb = /^(es|spa|esp)$/i.test(b.lang || '') ? 0 : 1;
    return pa - pb;
  });
  return out;
}

/* The real app opens with subtitles ON and Spanish selected when the portal
   returns subtitle files. Keep the user's choice once they touch the switch
   or pick a language. */
function applySubtitleDefaults(info) {
  var list = subtitleLanguageList(info);
  if (!vodSubChosen) {
    if (!state.playback.subtitle) {
      vodSubActive = false;
      vodCurrentSubtitle = null;
      loadSubtitleTrack(null);
      return;
    }
    if (!list.length) {
      vodSubActive = false;
      vodCurrentSubtitle = null;
      loadSubtitleTrack(null);
      return;
    }
    vodSubActive = true;
    vodCurrentSubtitle = list[0];
    for (var pref = 0; pref < list.length; pref++) {
      if (languageMatchesPreference(list[pref].lang, preferredSubtitleCode())) {
        vodCurrentSubtitle = list[pref];
        break;
      }
    }
    loadSubtitleTrack(vodCurrentSubtitle);
    return;
  }
  if (!vodSubActive) { return; }
  if (!list.length) {
    vodSubActive = false;
    vodCurrentSubtitle = null;
    loadSubtitleTrack(null);
    return;
  }
  /* New episode with the same preference: keep the language if the new
     episode ships it, otherwise fall back to the first file. */
  var stillThere = false;
  if (vodCurrentSubtitle) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === vodCurrentSubtitle.url) {
        vodCurrentSubtitle = list[i];
        stillThere = true;
        break;
      }
    }
  }
  if (!stillThere) {
    vodCurrentSubtitle = list[0];
    loadSubtitleTrack(vodCurrentSubtitle);
  }
}

function qualityLabel(track) {
  var q = String((track && track.quality) || '').trim().toUpperCase();
  var h = track && track.height;
  if (!q && h) { q = String(h) + 'P'; }
  if (q === '4K' || q === '2160P' || q === 'UHD') { return '4K'; }
  if (/^\d+$/.test(q)) { return q + 'P'; }
  return q || 'AUTO';
}
