/* player/playback.js — Reproducción: búsqueda (seek), estado, playUrl, resolución de streams y openPlayer.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var lastProxyOrigin = '';
var lastPlayingUrl = '';
/* Generation counter: incremented every time we start a new stream.
   Async resolve callbacks check this before calling playUrl() so that
   stale responses from previously-selected items are silently dropped. */
var resolveSeq = 0;
var relayBaseUrl = '';
var relayStartOffset = 0;
/* The ?start= asked of the relay. relayStartOffset is where the video really
   begins: when the relay copies the video it starts at the keyframe before
   that second (askRelayRealStart). */
var relayRequestedStart = 0;

function askRelayRealStart(base, asked) {
  var video = playerVideo;
  if (!video || !base || !(asked > 0)) { return; }
  var onMeta = function () {
    video.removeEventListener('loadedmetadata', onMeta);
    if (relayBaseUrl !== base || relayRequestedStart !== asked) { return; }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', base + '?where=' + asked, true);
      xhr.timeout = 4000;
      xhr.onload = function () {
        if (relayBaseUrl !== base || relayRequestedStart !== asked) { return; }
        var real = NaN;
        try { real = Number(JSON.parse(xhr.responseText).start); } catch (eJson) { /* ignore */ }
        if (isFinite(real) && real >= 0 && Math.abs(asked - real) < 30) { relayStartOffset = real; }
      };
      xhr.send(null);
    } catch (eAsk) { /* keep the asked second */ }
  };
  video.addEventListener('loadedmetadata', onMeta);
}
/* A fragmented MP4 relay is a one-way HTTP stream.  Several older webOS
   players do not resume that socket after a long pause; opening its local
   URL again at the same offset is the reliable native resume operation. */
var relayPaused = false;

function resumePlayerPlayback() {
  if (!playerVideo) { return; }
  if (relayPaused && relayBaseUrl && state.playerMode === 'vod') {
    var base = relayBaseUrl;
    var position = Math.max(0, Math.floor(relayStartOffset + (playerVideo.currentTime || 0)));
    relayPaused = false;
    var resumeUrl = base + '?start=' + position;
    if (vodCurrentAudioTrack) { resumeUrl += '&a=' + vodCurrentAudioTrack; }
    setPlayerStatus('Reanudando vídeo…');
    playUrl(resumeUrl);
    return;
  }
  try {
    var p = playerVideo.play();
    if (p && p.catch) { p.catch(function () {}); }
  } catch (ePlay) { /* native player rejected resume */ }
}

/* Accumulated seek delta + timer for debouncing rapid seek keypresses.
   webOS Starfish fires a full setPreload/dispatchBufferingStart cycle
   for every currentTime assignment, so we batch rapid presses. */
var seekPending = 0;
var seekTimer = null;
/* Starfish emits transient waiting/stalled events even when its HLS buffer
   recovers before a frame is missed.  Delay the visual notice so those
   micro-events do not flash "Cargando vídeo" over a healthy channel. */
var bufferingNoticeTimer = null;
function clearBufferingNotice() {
  if (bufferingNoticeTimer) {
    clearTimeout(bufferingNoticeTimer);
    bufferingNoticeTimer = null;
  }
}
function scheduleBufferingNotice(text) {
  if (bufferingNoticeTimer || state.streamError) { return; }
  bufferingNoticeTimer = setTimeout(function () {
    bufferingNoticeTimer = null;
    if (!state.streamError && playerVideo && !playerVideo.paused && playerVideo.readyState < 3) {
      setPlayerStatus(text);
    }
  }, 700);
}
/* Fragmented-MP4 seeks restart the native video pipeline on webOS 4.  Do
   not start a second one until that pipeline has acknowledged the first. */
var relaySeekInFlight = false;
var relaySeekWatchdog = null;
function releaseRelaySeek() {
  relaySeekInFlight = false;
  if (relaySeekWatchdog) { clearTimeout(relaySeekWatchdog); relaySeekWatchdog = null; }
}
function flushSeek() {
  seekTimer = null;
  if (!playerVideo || !seekPending) { seekPending = 0; return; }
  if (relayBaseUrl) {
    if (relaySeekInFlight) { seekPending = 0; return; }
    relaySeekInFlight = true;
    var curSec = relayStartOffset + (playerVideo.currentTime || 0);
    var target = Math.max(0, curSec + seekPending);
    seekPending = 0;
    var totalDur = vodPlaybackDuration();
    if (totalDur > 0 && target > totalDur - 2) { target = Math.max(0, totalDur - 2); }
    var keepPaused = playerVideo.paused;
    var seekUrl = relayBaseUrl + '?start=' + Math.floor(target) + '&a=' + (vodCurrentAudioTrack || 0);
    /* Forward: the relay must land past here, even if the keyframe before
       the target is not (see ffmpeg-relay.js probeKeyframe). */
    if (target > curSec + 1) { seekUrl += '&from=' + Math.floor(curSec); }
    /* A failed upstream request must not leave controls locked forever. */
    relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
    playUrl(seekUrl, { remainPaused: keepPaused });
    return;
  }
  var t = (playerVideo.currentTime || 0) + seekPending;
  seekPending = 0;
  var dur = vodPlaybackDuration();
  if (t < 0) { t = 0; }
  if (dur > 0 && t > dur - 1) { t = dur - 1; }
  if (window.OPENTV_DESKTOP && state.playerMode === 'vod' && state.playerItem && state.playerItem._relayUrl &&
      /\/media\/[^/]+\/stream\.ts$/i.test(lastPlayingUrl || '')) {
    var seekEnd = (playerVideo.seekable && playerVideo.seekable.length) ? playerVideo.seekable.end(playerVideo.seekable.length - 1) : 0;
    if (t > seekEnd + 10) {
      if (relaySeekInFlight) { return; }
      relaySeekInFlight = true;
      var keepPausedTs = playerVideo.paused;
      var relaySeekUrl = state.playerItem._relayUrl + '?start=' + Math.floor(t) + '&a=' + (vodCurrentAudioTrack || 0);
      relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
      playUrl(relaySeekUrl, { remainPaused: keepPausedTs });
      return;
    }
  }
  try { playerVideo.currentTime = t; } catch (eSeek) { /* ignore */ }
}
function playerSeek(delta) {
  if (!playerVideo) { return; }
  seekPending += delta;
  if (seekTimer) { clearTimeout(seekTimer); }
  seekTimer = setTimeout(flushSeek, window.OPENTV_DESKTOP ? 150 : 800);
  showInfobar();
  /* OSD feedback while seeking */
  showOsdIcon(delta > 0 ? 'forward' : 'backward');
  setTimeout(function () { showOsdIcon('none'); }, 600);
}

function vodPlaybackPosition() {
  if (!playerVideo) { return 0; }
  return relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
}

function vodPlaybackDuration() {
  var target = state.playerEpisode || state.playerItem;
  var verified = durationToSeconds(target && target._sourceDuration);
  var metadata = durationToSeconds(target && target.duration);
  var timeline = playerVideo && playerVideo._opentvTimeline;
  var completeHls = timeline && timeline.kind === 'hls' && timeline.complete ? durationToSeconds(timeline.duration) : 0;
  // Native MediaSource.duration may only describe the HLS fragments indexed
  // so far. It is never a title total until the manifest is complete.
  if (verified) return verified;
  if (timeline && timeline.kind === 'native' && timeline.complete && playerVideo.readyState >= 1 && isFinite(playerVideo.duration) && playerVideo.duration > 0) return playerVideo.duration;
  if (metadata) return metadata;
  if (completeHls) return completeHls;
  if (relayBaseUrl || (timeline && timeline.kind !== 'native')) return 0;
  return playerVideo && isFinite(playerVideo.duration) && playerVideo.duration > 0 ? playerVideo.duration : 0;
}

function requestVideoDuration(item, episode, payload) {
  var target = episode || item;
  if (!payload.durationId) return;
  if (target._durationProbe === payload.durationId) return;
  target._durationProbe = payload.durationId;
  target._durationPending = true;
  portalServiceCall('mediaDuration', { durationId: payload.durationId }, function (error, answer) {
    if (target._durationProbe !== payload.durationId) return;
    target._durationPending = false;
    var duration = !error && answer && answer.returnValue !== false ? durationToSeconds(answer.duration) : 0;
    /* The same probe lists the file's audio tracks (language and title). */
    if (!error && answer && ((answer.audio && answer.audio.length) || (answer.subtitles && answer.subtitles.length))) {
      onSourceTracks(item, episode, answer);
    }
    if (duration) {
      if (answer.verified) target._sourceDuration = duration;
      if (answer.verified || !durationToSeconds(target.duration)) target.duration = duration;
    }
    if ((state.playerEpisode || state.playerItem) === target) {
      updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
      document.dispatchEvent(new CustomEvent('opentv:duration'));
    }
  }, 10000);
}

function leaveVodScrub(apply) {
  if (!vodScrubbing) { return; }
  var target = vodScrubTime;
  var before = vodPlaybackPosition();
  vodScrubbing = false;
  if (vodSeekbar) { vodSeekbar.classList.remove('is-scrubbing'); }
  if (apply && Math.abs(target - before) >= 1) { playerSeek(target - before); }
  updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
  setFocus(playerStage);
  scheduleInfoHide();
}

function enterVodScrub() {
  var duration = vodPlaybackDuration();
  if (!vodSeekbar || !duration) { showInfobar(); return; }
  vodScrubTime = Math.max(0, Math.min(duration - 1, vodPlaybackPosition()));
  vodScrubbing = true;
  vodSeekbar.classList.add('is-scrubbing');
  showInfobar();
  if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
  updateVodProgress(vodScrubTime, duration);
  setFocus(vodSeekbar);
}

function moveVodScrub(direction) {
  var duration = vodPlaybackDuration();
  if (!vodScrubbing || !duration) { return; }
  var step = Math.max(60, Math.min(300, Math.round(duration * 0.05)));
  vodScrubTime = Math.max(0, Math.min(duration - 1, vodScrubTime + (direction * step)));
  updateVodProgress(vodScrubTime, duration);
}

/* TVs: holding left/right glides through the film like native TV players.
   The bar moves at once (nothing loads meanwhile) and goes faster the
   longer the key is held; the video jumps once, when the key is let go. A
   single press still moves 10 s. */
var tvSeekHold = { start: 0, last: 0, timer: null, bound: false };
function tvSeekCommit() {
  if (tvSeekHold.timer) { clearTimeout(tvSeekHold.timer); tvSeekHold.timer = null; }
  tvSeekHold.last = 0;
  leaveVodScrub(true);
}
function tvSeekKey(dir) {
  if (!tvSeekHold.bound) {
    tvSeekHold.bound = true;
    document.addEventListener('keyup', function (e) {
      var k = e.keyCode || e.which;
      if ((k === 37 || k === 39) && vodScrubbing && tvSeekHold.last) { tvSeekCommit(); }
    }, true);
  }
  var duration = vodPlaybackDuration();
  var now = Date.now();
  if (!vodScrubbing) {
    enterVodScrub();
    tvSeekHold.start = now;
    tvSeekHold.last = 0;
  }
  if (!vodScrubbing || !duration) { playerSeek(dir * 10); return; }
  /* A new press after a pause starts slow again. */
  if (tvSeekHold.last && now - tvSeekHold.last > 450) { tvSeekHold.start = now; tvSeekHold.last = 0; }
  var delta = 10;
  if (tvSeekHold.last) {
    var held = now - tvSeekHold.start;
    var rate = held < 1200 ? 20 : held < 3000 ? 60 : held < 6000 ? 150 : 300;   /* seconds of film per second held */
    delta = rate * Math.min(250, now - tvSeekHold.last) / 1000;
  }
  tvSeekHold.last = now;
  vodScrubTime = Math.max(0, Math.min(duration - 1, vodScrubTime + dir * delta));
  updateVodProgress(vodScrubTime, duration);
  if (tvSeekHold.timer) { clearTimeout(tvSeekHold.timer); }
  /* (Also applied if the remote never sends the key up.) */
  tvSeekHold.timer = setTimeout(tvSeekCommit, 700);
}

function stopPlayerVideo() {
  if (vodSeekbar && vodSeekbar._cancelDesktopScrub) vodSeekbar._cancelDesktopScrub();
  if (state.playerMode === 'vod' && playerVideo) {
    var stopPosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
    var stopDuration = vodPlaybackDuration();
    rememberWatchProgress(stopPosition, stopDuration, true);
  }
  state.streamError = '';
  clearBufferingNotice();
  setPlayerStatus('');
  showOsdIcon('none');
  stopVodProgressTicker();
  /* Keep the settings panel/dialog open across an audio/quality restart;
     back() and screen changes close them. Keep the loaded cues too: an
     audio/quality switch replaces the source but not the subtitles, and
     showScreen() clears them when the player is really left. */
  /* Cancel any pending seek */
  if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; seekPending = 0; }
  releaseRelaySeek();
  relayPaused = false;
  relayBaseUrl = '';
  relayStartOffset = 0;
  relayRequestedStart = 0;
  /* Increment generation so any in-flight resolve() callback is ignored */
  resolveSeq++;
  var proxyToAbort = lastProxyOrigin;
  if (!proxyToAbort && lastPlayingUrl && lastPlayingUrl.indexOf('127.0.0.1') !== -1) {
    var m = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(lastPlayingUrl);
    if (m) { proxyToAbort = m[1]; }
  }
  if (proxyToAbort) {
    try {
      var abortXhr = new XMLHttpRequest();
      abortXhr.open('GET', proxyToAbort + '/media/abort', true);
      abortXhr.send();
    } catch (eAbort) { /* ignore */ }
  }
  try {
    portalServiceCall('abortMedia', {}, function () {});
  } catch (eSvc) { /* ignore */ }
  lastPlayingUrl = '';
  lastProxyOrigin = '';
  if (!playerVideo) { return; }
  /* Detach the old Starfish pipeline callbacks before clearing its source.
     Otherwise an asynchronous error from the previous episode can invoke
     the new episode's handler and briefly paint a misleading código 4. */
  playerVideo.onerror = null;
  playerVideo.onwaiting = null;
  playerVideo.onstalled = null;
  playerVideo.onloadeddata = null;
  playerVideo.oncanplay = null;
  playerVideo.onloadedmetadata = null;
  playerVideo.ondurationchange = null;
  playerVideo.onplaying = null;
  playerVideo.onended = null;
  playerVideo.ontimeupdate = null;
  playerVideo.onpause = null;
  playerVideo.onplay = null;
  try { playerVideo.pause(); } catch (e) { /* ignore */ }
  try { playerVideo.currentTime = 0; } catch (e) { /* ignore */ }
  playerVideo.removeAttribute('src');
  try { playerVideo.src = ''; } catch (e) { /* ignore */ }
  while (playerVideo.firstChild) {
    playerVideo.removeChild(playerVideo.firstChild);
  }
  if (window.OPENTV_DESKTOP && typeof playerVideo._opentvResetTimeline === 'function') playerVideo._opentvResetTimeline();
  /* NOTE: do NOT call playerVideo.load() here.
     A bare load() with no <source> briefly creates a WebMediaPlayerUMS
     pipeline in Starfish (AID=N) that gets destroyed milliseconds later
     when the real load() arrives, wasting one ACB slot and ~70ms. */
  playerVideo.classList.remove('is-active');
  if (playerFrame) { playerFrame.style.display = 'block'; }
}

function setPlayerStatus(text) {
  if (window.OPENTV_DESKTOP) {
    document.dispatchEvent(new CustomEvent('opentv:player-status', { detail: {
      text: text || '', error: !!state.streamError, mode: state.playerMode,
      loading: /^(Preparando|Cargando|Conectando|Reintentando|Reanudando|Cambiando|Ajustando)/i.test(text || '')
    } }));
  }
  if (!playerStatus) { playerStatus = $('player-status'); }
  if (!playerStatus) { return; }
  if (text) {
    playerStatus.textContent = text;
    playerStatus.classList.add('is-active');
  } else {
    playerStatus.textContent = '';
    playerStatus.classList.remove('is-active');
  }
}

function playUrl(url, playOptions) {
  if (!playerVideo || !url) { return; }
  playOptions = playOptions || {};
  var useNativeHlsFallback = !!playOptions.nativeHls;
  if (window.OPENTV_DESKTOP && state.playerMode === 'vod' && !/[?&]start=\d+/.test(url)) {
    var planMatches = resumePlan && state.playerItem &&
      (resumePlan.item === state.playerItem || String(resumePlan.itemId) === String(state.playerItem.id)) &&
      (!resumePlan.episodeId || (state.playerEpisode && String(state.playerEpisode.id) === String(resumePlan.episodeId)));
    var targetStart = (playOptions.startPosition > 0) ? Math.floor(playOptions.startPosition)
                    : (planMatches && resumePlan.pos >= RESUME_MIN_S ? Math.floor(resumePlan.pos) : 0);
    if (targetStart >= RESUME_MIN_S) {
      if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
        url = url.split('?')[0] + '?start=' + targetStart + '&a=' + (vodCurrentAudioTrack || 0);
        playOptions.startPosition = 0;
      } else if (/\/media\/[^/]+\/stream\.ts$/i.test(url) && state.playerItem && state.playerItem._relayUrl) {
        url = state.playerItem._relayUrl + '?start=' + targetStart + '&a=' + (vodCurrentAudioTrack || 0);
        playOptions.startPosition = 0;
      } else {
        playOptions.startPosition = targetStart;
        playerVideo._opentvStartPos = targetStart;
      }
    }
  }
  stopPlayerVideo();
  relayPaused = false;
  lastPlayingUrl = url;
  var mOrigin = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(url);
  if (mOrigin) { lastProxyOrigin = mOrigin[1]; }
  if (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url)) {
    relayBaseUrl = url.split('?')[0];
    var mStart = /[?&]start=(\d+)/.exec(url);
    relayStartOffset = mStart ? parseInt(mStart[1], 10) : 0;
    relayRequestedStart = relayStartOffset;
    askRelayRealStart(relayBaseUrl, relayRequestedStart);
  } else {
    relayBaseUrl = '';
    relayStartOffset = 0;
    relayRequestedStart = 0;
  }
  setPlayerStatus('Conectando con el vídeo…');
  state.streamError = '';
  compatWatchBegin();

  /* The markup defaults to auto too, but set it again because Starfish can
     retain the previous resource's preload mode after source replacement. */
  try { playerVideo.preload = 'auto'; } catch (ePreload) { /* ignore */ }

  var rawMime = (state.playerItem && state.playerItem.streamMime) || '';
  var isHls = (url.indexOf('.m3u8') !== -1) || (rawMime.indexOf('mpegurl') !== -1) || !!(state.playerItem && state.playerItem.isHls);
  var mime = isHls ? 'application/vnd.apple.mpegurl' : ((url.indexOf('.mp4') !== -1 || rawMime.indexOf('mp4') !== -1) ? 'video/mp4' : 'video/mp2t');

  playerVideo.onerror = function () {
    hideNextEpisodeLoading();
    releaseRelaySeek();
    var code = playerVideo.error && playerVideo.error.code;
    /* Some newer webOS releases reject Starfish's legacy mediaOption
       parameter for every HLS channel and report MEDIA_ERR_SRC_NOT_SUPPORTED
       (4). Retry only live HLS once with the standard HTML5 HLS source.
       VOD and the FFmpeg Modo Fluido path are intentionally untouched. */
    if (code === 4 && state.playerMode === 'live' && isHls && !useNativeHlsFallback) {
      var failedChannelSeq = liveChannelSeq;
      setPlayerStatus('Reintentando la señal…');
      setTimeout(function () {
        if (state.playerMode === 'live' && liveChannelSeq === failedChannelSeq) {
          playUrl(url, { nativeHls: true });
        }
      }, 0);
      return;
    }
    /* A manual language change on the direct pipeline must preserve Normal
       mode.  Do not mistake the transient native-track error for an
       unsupported stream and silently restart through the FFmpeg relay. */
    if (code === 4 && state.playerMode === 'vod' && state.streamMode === 'normal' &&
        audioTrackSwitchUntil && Date.now() < audioTrackSwitchUntil) {
      audioTrackSwitchUntil = 0;
      state.streamError = 'No fue posible cambiar el idioma en reproducción Normal';
      setPlayerStatus(state.streamError);
      return;
    }
    /* Some portal VOD files are rejected by a TV's direct TS pipeline even
       though the same HEVC/AAC content plays when remuxed as fragmented MP4.
       Retry once through the protected Modo Fluido route, never in a loop.
       The retry belongs to this episode only: remembering it for the whole
       series opened every following episode in Modo Fluido even after the
       viewer picked Normal. */
    if (code === 4 && tryCompatFallback('error')) { return; }
    if (code && stremioRetryTranscode()) { return; }
    state.streamError = 'No se pudo abrir el stream (código ' + (code || 'error') + ')';
    playerVideo.classList.remove('is-active');
    if (playerFrame) { playerFrame.style.display = 'block'; }
    setPlayerStatus(state.streamError);
  };
  function clearStatus() {
    clearBufferingNotice();
    setPlayerStatus('');
  }
  /* Desktop: while the video should run but has no frames yet, say so.
     A silent frozen picture looked paused and invited a click that
     really paused it. */
  function clearStatusWhenRunning() {
    if (window.OPENTV_DESKTOP && !playerVideo.paused && playerVideo.readyState < 3) {
      if (!state.streamError) { setPlayerStatus('Cargando vídeo…'); }
      return;
    }
    clearStatus();
  }
  /* Directo builds its segment list progressively and HLS.js joins it at
     the newest segment, so an early seek lands short of the target (for
     example 8 s instead of 30 s). Retry until that point is available. */
  var pendingStart = 0;
  var pendingStartTimer = null;
  var pendingSrc = url;
  function stopPendingStart() {
    pendingStart = 0;
    if (pendingStartTimer) { clearInterval(pendingStartTimer); pendingStartTimer = null; }
  }
  function tryPendingStart() {
    if (!pendingStart || !playerVideo) { return stopPendingStart(); }
    var srcNow = playerVideo.currentSrc || '';
    if (srcNow.indexOf('blob:') !== 0 && srcNow !== pendingSrc && srcNow.indexOf(pendingSrc) === -1) { return stopPendingStart(); }
    if (Math.abs((playerVideo.currentTime || 0) - pendingStart) < 3) { return stopPendingStart(); }
    var s = playerVideo.seekable;
    var end = (s && s.length) ? s.end(s.length - 1) : 0;
    if (end >= pendingStart + 1) {
      try { playerVideo.currentTime = pendingStart; } catch (eSeek) { /* retry next tick */ return; }
      stopPendingStart();
    }
  }
  playerVideo.onloadeddata = clearStatusWhenRunning;
  playerVideo.oncanplay = function () { releaseRelaySeek(); clearStatusWhenRunning(); };
  playerVideo.onloadedmetadata = function () {
    if (playOptions.startPosition > 0) {
      var target = playOptions.startPosition;
      try { playerVideo.currentTime = target; } catch (eStart) { /* not seekable yet */ }
      playOptions.startPosition = 0;
      if (window.OPENTV_DESKTOP && !relayBaseUrl) {
        stopPendingStart();
        pendingStart = target;
        pendingStartTimer = setInterval(tryPendingStart, 500);
        setTimeout(stopPendingStart, 60000);
      }
    }
    clearStatusWhenRunning();
    /* Prefer Spanish on the direct path as well.  Android chooses this PID
       internally; on webOS it is exposed only when the native AudioTrackList
       becomes available with the loaded media metadata. */
    if (state.playerMode === 'vod' && state.streamMode === 'normal') {
      var audioInfo = (state.playerItem && state.playerItem.streamAudioInfo);
      var nativeTrack = vodAudioChosen ? vodCurrentAudioTrack : preferredAudioIndex(audioInfo);
      if (selectNativeAudioTrack(nativeTrack)) {
        vodCurrentAudioTrack = nativeTrack;
      }
    }
    if (state.playerMode === 'vod') {
      var cur = relayBaseUrl ? relayStartOffset : (playerVideo.currentTime || 0);
      var totalDur = vodPlaybackDuration();
      updateVodProgress(cur, totalDur);
    }
  };
  playerVideo.ondurationchange = function () {
    if (state.playerMode === 'vod') {
      var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var totalDur = vodPlaybackDuration();
      updateVodProgress(cur, totalDur);
    }
  };
  playerVideo.onplaying = function () {
    hideNextEpisodeLoading();
    clearStatus();
  };
  playerVideo.onended = function () {
    if (state.playerMode !== 'vod') { return; }
    if (window.OPENTV_DESKTOP) { offerNextEpisode(); } else { advanceToNextEpisode(); }
  };
  playerVideo.ontimeupdate = function () {
    if (playerVideo.currentTime > 0) { clearStatusWhenRunning(); }
    if (state.playerMode === 'vod') {
      var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var totalDur = vodPlaybackDuration();
      updateVodProgress(cur, totalDur);
      updateSubtitleDisplay(cur);
      rememberWatchProgress(cur, totalDur);
    }
  };
  playerVideo.onpause = function () {
    stopVodProgressTicker();
    if (state.playerMode === 'vod') {
      var pausePosition = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
      var pauseDuration = vodPlaybackDuration();
      rememberWatchProgress(pausePosition, pauseDuration, true);
      showOsdIcon('pause');
      if (relayBaseUrl) { relayPaused = true; }
    }
  };
  playerVideo.onplay = function () {
    if (state.playerMode === 'vod') {
      showOsdIcon('none');
      startVodProgressTicker();
    }
  };
  playerVideo.onwaiting = function () {
    scheduleBufferingNotice('Cargando vídeo…');
  };
  playerVideo.onstalled = function () {
    scheduleBufferingNotice('Conectando…');
  };

  var transportOptions = {
    mediaTransportType: isHls ? 'HLS' : 'URI',
    option: {
      transmission: {
        playTime: { start: 0 }
      }
    }
  };
  var mediaOption = encodeURI(JSON.stringify(transportOptions));
  var typeStr = useNativeHlsFallback ? mime : (mime + ';mediaOption=' + mediaOption);

  while (playerVideo.firstChild) {
    playerVideo.removeChild(playerVideo.firstChild);
  }
  playerVideo.removeAttribute('src');
  /* Newer webOS uses the MIME type and rejects the old custom property.
     Older sets retain the existing path above as their first attempt. */
  if (!useNativeHlsFallback) {
    try { playerVideo.mediaOption = transportOptions; } catch (eOpt) {}
  } else {
    try { playerVideo.mediaOption = null; } catch (eClearOpt) {}
  }

  var srcNode = document.createElement('source');
  srcNode.setAttribute('src', url);
  srcNode.setAttribute('type', typeStr);
  if (isHls) {
    /* LG's HLS pipeline reads mediaOption from the source element. Setting
       video.src afterwards replaces that source and silently drops HLS mode
       on recent webOS releases, resulting in MEDIA_ERR_SRC_NOT_SUPPORTED. */
    try { playerVideo.load(); } catch (eHlsReset) { /* ignore */ }
  }
  playerVideo.appendChild(srcNode);

  if (!isHls) {
    /* Starfish on webOS 3–6 does not reliably start a non-HLS <source>
       alone.  Keep the source node (for mediaOption) AND assign src, also
       for the local Fluent relay.  This is the proven 1.6.15 behaviour and
       prevents the player from staying forever at “Conectando…”. */
    try { playerVideo.src = url; } catch (eSrc) {}
  }
  try { playerVideo.currentTime = 0; } catch (eCt) {}

  playerVideo.classList.add('is-active');
  if (playerFrame) { playerFrame.style.display = 'none'; }
  try {
    playerVideo.load();
    if (playOptions.remainPaused) { playerVideo.pause(); return; }
    var p = playerVideo.play();
    if (p && p.catch) {
      p.catch(function () {
        if (playerVideo.error) { return; }
        state.streamError = 'Pulsa OK para iniciar la reproducción';
        setPlayerStatus(state.streamError);
      });
    }
  } catch (e2) {
    state.streamError = 'Pulsa OK para iniciar la reproducción';
    setPlayerStatus(state.streamError);
  }
}

/* The playable URL of a title (async: the addon source may need the
   service first). Callers check resolveSeq to drop a late answer. */
function resolvePlayerStream(item, done) {
  /* Addon titles: the source the viewer chose (player/stremio-sources.js). */
  if (item && item._stremio) { return resolveStremioPlayback(item, done); }
  /* Anything else carries its own link. */
  var ep = state.playerEpisode;
  done((ep && ep.streamUrl) || (item && item.streamUrl) || '');
}

function startPlayerVideo(item, episode) {
  if (!playerVideo) { return; }
  if (episode) {
    state.playerEpisode = episode;
    state.playerSeasonIndex = state.detailSeason || 0;
  }
  if (item) { state.playerItem = item; }
  try { document.dispatchEvent(new CustomEvent('opentv:player-item')); } catch (eEv) { /* old webOS */ }
  if (window.OPENTV_DESKTOP) { installResume(); planResume(state.playerItem, state.playerEpisode); }
  var it = item || state.playerItem;
  if (it) { restoreSmoothMode(it); }
  stopPlayerVideo();
  if (!it) { return; }
  /* PC: the title's still until the first frame (not the previous title's). */
  if (window.OPENTV_DESKTOP && !platformIsTv()) {
    var still = heroArt(it) || it.poster || '';
    if (still) { playerVideo.poster = sizedImageUrl(still, 1280); } else { playerVideo.removeAttribute('poster'); }
  }
  vodAudioChosen = false;
  vodCurrentAudioTrack = 0;
  if (it._stremio) {
    resolvePlayerStream(it, function (url) {
      if (url) { playUrl(url); }
      else if (!state.streamError) { setPlayerStatus('Sin fuente de reproducción'); }
    });
    return;
  }
  var directUrl = (episode && episode.streamUrl) || it.streamUrl || '';
  if (!directUrl) { return; }
  playUrl(directUrl);
}

function expandToFullscreen(item, episode) {
  /* Stremio mode: first the viewer picks the source (or the saved one is used). */
  if (stremioNeedsPick(item, episode)) { return; }
  if (!playerStage) { buildPlayer(); }
  /* The detail screen already owns a mini player.  Moving that exact stream
     to fullscreen must not resolve it again, otherwise direct and relay
     VOD both restart from zero. */
  var sameEpisode = !episode || !state.playerEpisode ||
    state.playerEpisode === episode || state.playerEpisode.id === episode.id;
  var keepCurrentVideo = state.screen === 'detail' && playerVideo &&
    !!playerVideo.src && state.playerItem === item && sameEpisode;
  state.playerMode = 'vod';
  if (item && state.playerItem !== item) { resetMediaSelection(); }
  if (item) { state.playerItem = item; }
  if (episode) { state.playerEpisode = episode; }
  try { document.dispatchEvent(new CustomEvent('opentv:player-item')); } catch (eEv) { /* old webOS */ }
  if (item) { restoreSmoothMode(item); }
  state.playerReturn = { screen: 'detail', focus: state.focus };

  var scrPlayer = $('screen-player');
  var scrDetail = $('screen-detail');
  if (scrPlayer) {
    scrPlayer.classList.remove('is-mini');
    scrPlayer.classList.add('is-active');
  }
  if (scrDetail) {
    scrDetail.classList.remove('is-active');
  }
  state.screen = 'player';
  playerStage.classList.add('is-vod');
  updatePlayer();
  setFocus(playerStage);
  showVodInfobar();

  if (!keepCurrentVideo) {
    startPlayerVideo(state.playerItem, state.playerEpisode);
  }
}

function openPlayer(mode, item, episode) {
  if (mode === 'vod' && state.screen === 'detail') {
    expandToFullscreen(item, episode);
    return;
  }
  if (!playerStage) { buildPlayer(); }
  /* Desktop TV: real full screen, like a TV (left again with the player). */
  if (window.OPENTV_DESKTOP && mode === 'live') { installLiveControls(); enterLiveFullscreen(); }
  /* Desktop: reuse the video that is already playing this channel. */
  var handedOver = false;
  if (mode === 'live' && liveHandoff && liveHandoff.type === 'player') {
    if (liveHandoff.key === liveChannelKey(CHANNELS[state.channel])) {
      returnPlayerToStage(true);
      handedOver = true;
    } else {
      returnPlayerToStage(false);
    }
  } else if (mode === 'live') {
    handedOver = borrowPreviewIntoPlayer();
  }
  if (mode === 'live' && !handedOver) { stopLivePreview(); }
  state.playerMode = mode;
  if (item && state.playerItem !== item) { resetMediaSelection(); }
  state.playerItem = item || null;
  state.playerEpisode = episode || null;
  if (mode === 'vod' && item) { restoreSmoothMode(item); }
  state.playerReturn = { screen: state.screen, focus: state.focus };
  state.channelsOpen = false;
  playerInfo.classList.remove('is-active');
  playerChannels.classList.remove('is-active');
  playerStage.classList.toggle('is-vod', mode === 'vod');
  updatePlayer();
  showScreen('player');
  setFocus(playerStage);
  updatePlayer();                 /* re-measure now that the screen is visible */
  if (mode === 'vod') {
    showVodInfobar();
    startPlayerVideo(state.playerItem, state.playerEpisode);
  } else {
    showInfobar();
    if (handedOver) { setPlayerStatus(''); }
    else { startLiveChannel(CHANNELS[state.channel]); }
  }
}
