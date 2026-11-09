/* player/resume.js — Escritorio: seguir donde te quedaste (película o episodio) y barra de avance continua.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* The history already stores, per title, the episode and the second where
   playback stopped. Here it is used: opening a series selects that episode
   (or the next one if it was finished), and playing starts at that second.
   "Desde el inicio" in the detail page skips it once. */
var RESUME_MIN_S = 30;
var resumePlan = null;
var resumeSkipOnce = false;

function historyRecordFor(id) {
  var list = localProfile.history || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].id) === String(id)) { return list[i]; }
  }
  return null;
}

function recordFinished(r) {
  return !!(r && r.duration && (r.position / r.duration > 0.95 || r.duration - r.position < 45));
}

/* Second to resume at for this title/episode, or 0. */
function resumePositionFor(item, episode) {
  if (!item) { return 0; }
  var r = historyRecordFor(item.id);
  if (!r || (r.position || 0) < RESUME_MIN_S || recordFinished(r)) { return 0; }
  if (r.series || isSeriesItem(item)) {
    if (!episode || !r.episodeId || String(episode.id) !== String(r.episodeId)) { return 0; }
  }
  return r.position;
}

/* Detail page: pick the episode the viewer was on (the next one when it
   was finished). */
function preferHistoryEpisode(item) {
  if (!window.XUPER_DESKTOP || !item) { return; }
  if (!pendingHistoryRecord || String(pendingHistoryRecord.id) !== String(item.id)) {
    var r = historyRecordFor(item.id);
    if (r && r.episodeId) { pendingHistoryRecord = r; }
  }
}

function nextAfterFinished(item, index) {
  var r = pendingHistoryRecord;
  if (r && recordFinished(r) && item.episodes[index + 1]) { return item.episodes[index + 1]; }
  return item.episodes[index];
}

/* Called when a title starts playing (detail preview or full screen). */
var resumePlannedKey = '';
function planResume(item, episode) {
  if (!window.XUPER_DESKTOP || !item) { return; }
  /* Restarts of the same video (compatibility mode, retries) keep their own
     position: plan only when the title or episode changes. */
  var key = String(item.id) + '|' + (episode ? String(episode.id) : '');
  if (key === resumePlannedKey && !resumeSkipOnce) { return; }
  resumePlannedKey = key;
  if (resumeSkipOnce) { resumeSkipOnce = false; resumePlan = null; return; }
  var pos = resumePositionFor(item, episode);
  resumePlan = pos ? { item: item, episodeId: episode ? String(episode.id) : '', pos: pos } : null;
}

function applyResumePlan() {
  var plan = resumePlan;
  if (!plan || state.playerMode !== 'vod' || state.playerItem !== plan.item) { return; }
  var ep = state.playerEpisode;
  if (plan.episodeId && (!ep || String(ep.id) !== plan.episodeId)) { resumePlan = null; return; }
  /* Right after starting, the stream may only know its first seconds and
     the seek would be cut to that length: wait until the duration is known. */
  /* HLS: the browser can only jump inside the part of the stream it has
     indexed so far (the rest is clamped to its end), so also wait for that. */
  var seekableEnd = 0;
  if (!relayBaseUrl && playerVideo.seekable && playerVideo.seekable.length) {
    seekableEnd = playerVideo.seekable.end(playerVideo.seekable.length - 1);
  }
  var reachable = relayBaseUrl ? true : seekableEnd > plan.pos + 2;
  if (!(vodPlaybackDuration() > plan.pos + 5) || !reachable) {
    plan.tries = (plan.tries || 0) + 1;
    /* Hold the picture instead of showing the first seconds meanwhile. */
    if (!plan.held && !playerVideo.paused) {
      plan.held = true;
      try { playerVideo.pause(); } catch (ePause) { /* ignore */ }
      setPlayerStatus('Reanudando desde ' + formatTime(plan.pos).replace(/^00:/, '') + '…');
    }
    if (plan.tries < 60) { setTimeout(applyResumePlan, 500); }
    else { resumePlan = null; if (plan.held) { setPlayerStatus(''); resumePlayerPlayback(); } }
    return;
  }
  resumePlan = null;
  var delta = plan.pos - vodPlaybackPosition();
  if (delta < 5) { return; }
  playerSeek(delta);
  if (plan.held) { setTimeout(resumePlayerPlayback, 250); }
  setPlayerStatus('Reanudando desde ' + formatTime(plan.pos).replace(/^00:/, ''));
  setTimeout(function () { if (/^Reanudando/.test((playerStatus && playerStatus.textContent) || '')) { setPlayerStatus(''); } }, 1800);
}

/* Text for the detail page's play button. */
function resumeLabelFor(item) {
  var r = historyRecordFor(item.id);
  if (!r || (r.position || 0) < RESUME_MIN_S) { return ''; }
  if (r.series || isSeriesItem(item)) {
    if (recordFinished(r)) { return r.episodeNumber ? 'Ver episodio ' + (parseInt(r.episodeNumber, 10) + 1) : ''; }
    return 'Reanudar' + (r.episodeNumber ? ' · E' + r.episodeNumber : '') + ' · ' + formatTime(r.position).replace(/^00:/, '');
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
  playerVideo.addEventListener('playing', function () { applyResumePlan(); kickSmoothProgress(); });
  document.addEventListener('pointermove', kickSmoothProgress, { passive: true });
}
