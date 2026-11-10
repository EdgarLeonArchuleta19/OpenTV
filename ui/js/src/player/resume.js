/* player/resume.js — Escritorio: seguir donde te quedaste (película o episodio) y barra de avance continua.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The history already stores, per title, the episode and the second where
   playback stopped. Here it is used: opening a series selects that episode
   (or the next one if it was finished), and playing starts at that second.
   "Desde el inicio" in the detail page skips it once. */
var RESUME_MIN_S = 10;
var resumePlan = null;
var resumeSkipOnce = false;
var resumeRestarted = false;

/* Accepts the title or its id. Grouped series may have been saved under a
   season id, so those and the title are tried too. */
function historyRecordFor(itemOrId) {
  var list = localProfile.history || [];
  var item = itemOrId && typeof itemOrId === 'object' ? itemOrId : null;
  var id = String(item ? item.id : itemOrId);
  var seasonId = item && item.seasonId ? String(item.seasonId) : '';
  var i;
  for (i = 0; i < list.length; i++) {
    if (!list[i]) { continue; }
    var recId = String(list[i].id);
    var recSeasonId = list[i].seasonId ? String(list[i].seasonId) : '';
    if (recId === id || (seasonId && (recId === seasonId || recSeasonId === seasonId)) || (recSeasonId && recSeasonId === id)) {
      return list[i];
    }
  }
  if (!item) { return null; }
  var seasons = (item._catalogSeasons && item._catalogSeasons.length) ? item._catalogSeasons : (item.seasons || []);
  var title = norm(item.title || item.name || '');
  for (i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r) { continue; }
    for (var s = 0; s < seasons.length; s++) {
      var sid = String(seasons[s].id);
      if (sid === String(r.id) || (r.seasonId && sid === String(r.seasonId))) { return r; }
    }
    if (title && r.title && norm(r.title) === title && !!r.series === !!isSeriesItem(item)) { return r; }
  }
  return null;
}

function recordFinished(r) {
  return !!(r && r.duration > 60 && (r.position / r.duration > 0.95 || r.duration - r.position < 45));
}

/* Second to resume at for this title/episode, or 0. */
function resumePositionFor(item, episode) {
  if (!item) { return 0; }
  var r = historyRecordFor(item);
  if (!r || (r.position || 0) < RESUME_MIN_S || recordFinished(r)) { return 0; }
  if (r.series || isSeriesItem(item)) {
    if (!episode) { return 0; }
    var idMatch = r.episodeId && String(episode.id) === String(r.episodeId);
    var numMatch = !idMatch && r.episodeNumber &&
      String(episode.number || episode.seriesNumber || '') === String(r.episodeNumber) &&
      (!r.seasonId || !item.seasonId || String(r.seasonId) === String(item.seasonId));
    if (!idMatch && !numMatch) { return 0; }
  }
  return Math.floor(r.position);
}

/* Detail page: pick the episode the viewer was on (the next one when it
   was finished). */
function preferHistoryEpisode(item) {
  if (!window.XUPER_DESKTOP || !item) { return; }
  var r = historyRecordFor(item);
  if (r && r.episodeId) { pendingHistoryRecord = r; }
}

function nextAfterFinished(item, index) {
  var r = pendingHistoryRecord || historyRecordFor(item);
  if (r && recordFinished(r) && item.episodes[index + 1]) { return item.episodes[index + 1]; }
  return item.episodes[index];
}

/* Called when a title starts playing (detail preview or full screen). */
var resumePlannedKey = '';
/* A new request to watch a title (detail page, play buttons, Seguir viendo)
   plans again even if it is the title that played last. */
/* One retry loop at a time: video events also call applyResumePlan, and
   parallel loops used up the tries (and the hold) several times faster. */
var resumeRetryTimer = null;
function scheduleResumeRetry(ms) {
  if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); }
  resumeRetryTimer = setTimeout(function () { resumeRetryTimer = null; applyResumePlan(); }, ms);
}
function resetResumePlan() {
  if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null; }
  resumePlannedKey = '';
  resumePlan = null;
  resumeRestarted = false;
}
/* While a jump to the saved second is pending, the first seconds of the
   video must not overwrite that saved second. */
function resumePending(item) {
  if (!resumePlan || !item) { return false; }
  var sameItem = resumePlan.item === item || String(resumePlan.itemId) === String(item.id);
  if (!sameItem) { return false; }
  if (vodPlaybackPosition() >= resumePlan.pos - 5) {
    resumePlan = null;
    return false;
  }
  return true;
}
function planResume(item, episode) {
  if (!window.XUPER_DESKTOP || !item) { return; }
  var key = String(item.id) + '|' + (episode ? String(episode.id) : '');
  if (resumeSkipOnce) {
    resumeSkipOnce = false;
    resumeRestarted = true;
    resumePlannedKey = key;
    resumePlan = null;
    return;
  }
  /* Restarts of the same video (compatibility mode, retries) keep their own
     position if the resume plan was already satisfied. */
  if (key === resumePlannedKey && (!resumePlan || vodPlaybackPosition() >= resumePlan.pos - 5)) {
    return;
  }
  resumePlannedKey = key;
  resumeRestarted = false;
  if (resumeRetryTimer) { clearTimeout(resumeRetryTimer); resumeRetryTimer = null; }
  var pos = resumePositionFor(item, episode);
  resumePlan = pos ? {
    item: item,
    itemId: String(item.id),
    episodeId: episode ? String(episode.id) : '',
    pos: pos,
    tries: 0,
    held: false,
    notified: false
  } : null;
}

function notifyResumeToast(pos) {
  setPlayerStatus('Reanudando desde ' + formatTime(pos).replace(/^00:/, ''));
  setTimeout(function () {
    if (/^Reanudando/.test((playerStatus && playerStatus.textContent) || '')) {
      setPlayerStatus('');
    }
  }, 1800);
}

function applyResumePlan() {
  var plan = resumePlan;
  if (!plan || state.playerMode !== 'vod') { return; }
  if (state.playerItem !== plan.item && (!state.playerItem || String(state.playerItem.id) !== String(plan.itemId))) { return; }
  var ep = state.playerEpisode;
  if (plan.episodeId && (!ep || String(ep.id) !== plan.episodeId)) { resumePlan = null; return; }

  var currentPos = vodPlaybackPosition();
  if (currentPos >= plan.pos - 5) {
    var wasHeld = plan.held;
    var wasNotified = plan.notified;
    var targetPos = plan.pos;
    resumePlan = null;
    if (wasHeld || playerVideo.paused) { setTimeout(resumePlayerPlayback, 100); }
    if (!wasNotified) { notifyResumeToast(targetPos); }
    return;
  }

  /* If we are on arelay stream that started at 0 instead of plan.pos, jump via ?start= */
  if (relayBaseUrl && relayStartOffset < plan.pos - 5 && !relaySeekInFlight) {
    plan.notified = true;
    var relayTarget = Math.floor(plan.pos);
    var rUrl = relayBaseUrl + '?start=' + relayTarget + '&a=' + (vodCurrentAudioTrack || 0);
    notifyResumeToast(plan.pos);
    playUrl(rUrl);
    return;
  }

  /* If we are on a local proxy TS stream that cannot seek ahead without indexing
     the whole file, and the service provided a relayUrl, jump immediately via FFmpeg relay. */
  if (!relayBaseUrl && state.playerItem && state.playerItem._relayUrl &&
      /\/media\/[^/]+\/stream\.ts$/i.test(lastPlayingUrl || '')) {
    plan.notified = true;
    var fUrl = state.playerItem._relayUrl + '?start=' + Math.floor(plan.pos) + '&a=' + (vodCurrentAudioTrack || 0);
    notifyResumeToast(plan.pos);
    playUrl(fUrl);
    return;
  }

  var seekableEnd = 0;
  if (!relayBaseUrl && playerVideo.seekable && playerVideo.seekable.length) {
    seekableEnd = playerVideo.seekable.end(playerVideo.seekable.length - 1);
  }
  var knownDur = vodPlaybackDuration();
  var reachable = relayBaseUrl ? true : (seekableEnd >= plan.pos || (playerVideo.readyState >= 1 && isFinite(playerVideo.duration) && playerVideo.duration >= plan.pos));
  if ((knownDur > 0 && knownDur < plan.pos + 2 && !reachable) || !reachable) {
    plan.tries = (plan.tries || 0) + 1;
    if (!plan.held && plan.tries < 40 && !playerVideo.paused) {
      plan.held = true;
      try { playerVideo.pause(); } catch (ePause) { /* ignore */ }
      setPlayerStatus('Reanudando desde ' + formatTime(plan.pos).replace(/^00:/, '') + '…');
    }
    if (plan.tries === 40 && plan.held) { plan.held = false; setPlayerStatus(''); resumePlayerPlayback(); }
    if (plan.tries < 280) { scheduleResumeRetry(350); }
    else { resumePlan = null; }
    return;
  }

  try { playerVideo.currentTime = plan.pos; } catch (eSeek) { /* ignore */ }
  if (vodPlaybackPosition() >= plan.pos - 5) {
    var heldNow = plan.held;
    var posNow = plan.pos;
    resumePlan = null;
    if (heldNow || playerVideo.paused) { setTimeout(resumePlayerPlayback, 150); }
    notifyResumeToast(posNow);
  } else {
    plan.tries = (plan.tries || 0) + 1;
    if (plan.tries < 60) { scheduleResumeRetry(300); }
    else { resumePlan = null; }
  }
}

/* Text for the detail page's play button. */
function resumeLabelFor(item) {
  var r = historyRecordFor(item);
  if (!r || (r.position || 0) < RESUME_MIN_S) { return ''; }
  if (r.series || isSeriesItem(item)) {
    var sPrefix = r.seasonNumber ? ('T' + r.seasonNumber + ':') : '';
    if (recordFinished(r)) {
      return r.episodeNumber ? ('Ver ' + sPrefix + 'E' + (parseInt(r.episodeNumber, 10) + 1)) : '';
    }
    return 'Reanudar' + (r.episodeNumber ? (' · ' + sPrefix + 'E' + r.episodeNumber) : '') + ' · ' + formatTime(r.position).replace(/^00:/, '');
  }
  if (recordFinished(r)) { return ''; }
  return 'Reanudar · ' + formatTime(r.position).replace(/^00:/, '');
}

/* ------------------------------------------------- smooth progress bar */
/* timeupdate fires ~4 times a second, so the handle moved in jumps; while
   the controls are visible it follows the video every frame. */
var smoothProgressFrame = 0;
function smoothProgressTick() {
  smoothProgressFrame = 0;
  if (state.screen !== 'player' || state.playerMode !== 'vod' || !playerVideo || playerVideo.paused || vodScrubbing) { return; }
  var bar = $('player-vod-infobar');
  if (!bar || !bar.classList.contains('is-active')) { return; }
  var duration = vodPlaybackDuration();
  if (duration > 0 && vodSeekProgress) {
    var pct = Math.max(0, Math.min(100, vodPlaybackPosition() / duration * 100));
    vodSeekProgress.style.width = pct + '%';
    if (vodSeekThumb) { vodSeekThumb.style.left = pct + '%'; }
  }
  smoothProgressFrame = requestAnimationFrame(smoothProgressTick);
}
function kickSmoothProgress() {
  if (!smoothProgressFrame) { smoothProgressFrame = requestAnimationFrame(smoothProgressTick); }
}

function installResume() {
  if (!window.XUPER_DESKTOP || !playerVideo || playerVideo._resumeHooks) { return; }
  playerVideo._resumeHooks = true;
  playerVideo.addEventListener('loadedmetadata', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
  playerVideo.addEventListener('canplay', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
  playerVideo.addEventListener('playing', function () { applyResumePlan(); kickSmoothProgress(); });
  playerVideo.addEventListener('timeupdate', function () { if (resumePlan && !resumeRetryTimer) { applyResumePlan(); } });
  document.addEventListener('pointermove', kickSmoothProgress, { passive: true });
}
