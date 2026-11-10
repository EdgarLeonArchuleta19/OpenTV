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
  if (window.XUPER_DESKTOP && state.playerMode === 'vod' && state.playerItem && state.playerItem._relayUrl &&
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
  seekTimer = setTimeout(flushSeek, window.XUPER_DESKTOP ? 150 : 800);
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
  var timeline = playerVideo && playerVideo._xuperTimeline;
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
    if (duration) {
      if (answer.verified) target._sourceDuration = duration;
      if (answer.verified || !durationToSeconds(target.duration)) target.duration = duration;
    }
    if ((state.playerEpisode || state.playerItem) === target) {
      updateVodProgress(vodPlaybackPosition(), vodPlaybackDuration());
      document.dispatchEvent(new CustomEvent('xuper:duration'));
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
  if (window.XUPER_DESKTOP && typeof playerVideo._xuperResetTimeline === 'function') playerVideo._xuperResetTimeline();
  /* NOTE: do NOT call playerVideo.load() here.
     A bare load() with no <source> briefly creates a WebMediaPlayerUMS
     pipeline in Starfish (AID=N) that gets destroyed milliseconds later
     when the real load() arrives, wasting one ACB slot and ~70ms. */
  playerVideo.classList.remove('is-active');
  if (playerFrame) { playerFrame.style.display = 'block'; }
}

function setPlayerStatus(text) {
  if (window.XUPER_DESKTOP) {
    document.dispatchEvent(new CustomEvent('xuper:player-status', { detail: {
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
  if (window.XUPER_DESKTOP && state.playerMode === 'vod' && !/[?&]start=\d+/.test(url)) {
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
        playerVideo._xuperStartPos = targetStart;
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
  } else {
    relayBaseUrl = '';
    relayStartOffset = 0;
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
      setPlayerStatus('Reintentando señal con compatibilidad webOS…');
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
    if (window.XUPER_DESKTOP && !playerVideo.paused && playerVideo.readyState < 3) {
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
      if (window.XUPER_DESKTOP && !relayBaseUrl) {
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
    if (window.XUPER_DESKTOP) { offerNextEpisode(); } else { advanceToNextEpisode(); }
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

/* Portal titles need a license + CDN auth that <video> cannot send: the
   service resolves them and exposes a loopback proxy URL.
   We capture the current resolveSeq at call time; if it changes before
   the async response arrives (user navigated away), we discard the result. */
function resolvePlayerStream(item, done) {
  var mySeq = resolveSeq;
  function resolveNow() {
    var params = { contentId: item.id };
    params.playbackMode = state.streamMode;
    params.forceRelay = state.streamMode === 'smooth' || state.streamMode === 'relay';
    params.trackIndex = state.trackIndex || 0;
    if (window.XUPER_DESKTOP) { params.preferHeight = preferredQualityHeight(); }
    /* Prefer the Spanish PID like the real app when mediaInfo already
       answered; the relay maps it with ffmpeg -map 0:a:<n>. */
    var ep = state.playerEpisode;
    var epKey = (ep && ep.id) || (item && item.id) || '';
    var cachedInfo = mediaInfoCache[epKey] || mediaInfoCache[mediaInfoKey(item)];
    /* Spanish is the default for every episode.  Index 0 is NOT Spanish:
       the portal lists the PIDs in stream order ("por,spa,eng"), so sending
       0 after an episode change made playback start in Portuguese (and the
       FFmpeg relay map the Portuguese PID). */
    var audioList = (cachedInfo && cachedInfo.audio) || (ep && ep.streamAudioInfo) || item.streamAudioInfo || '';
    if (vodAudioChosen) {
      vodCurrentAudioTrack = Math.max(0, Number(vodCurrentAudioTrack) || 0);
    } else {
      vodCurrentAudioTrack = preferredAudioIndex(audioList);
    }
    params.audioTrack = vodCurrentAudioTrack || 0;
    if (isSeriesItem(item)) {
      var epSeries = state.playerEpisode;
      var seriesRef = item.seasonId || item.id;
      if (epSeries && epSeries.id) {
        params.contentId = epSeries.id;
        params.seriesContentId = seriesRef;
      } else {
        if (!item.episodes || !item.episodes.length) {
          vodFailure('los capítulos', item._detailError || 'El servidor no devolvió capítulos reproducibles');
          return done('');
        }
        state.playerEpisode = item.episodes[0];
        params.contentId = item.episodes[0].id;
        params.seriesContentId = seriesRef;
      }
    }
    params.duration = durationToSeconds((state.playerEpisode || item).duration);
    var resolveMethod = params.forceRelay ? 'resolveSmooth' : 'resolve';
    lastVodAttempt = { phase: 'enlace de vídeo', status: 'cargando', error: '' };
    portalServiceCall(resolveMethod, params, function (error, payload) {
      /* Stale response: user already navigated to something else */
      if (mySeq !== resolveSeq) { return; }
      if (error || !payload || payload.returnValue === false || !(payload.proxyPath || payload.url)) {
        vodFailure('el enlace de vídeo', error || (payload && payload.errorText) || 'Respuesta vacía del servicio');
        return done('');
      }
      lastVodAttempt = { phase: 'enlace de vídeo', status: 'recibido', error: '' };
      rememberCdnProbe('vod', payload);
      item.streamMime = payload.mime || '';
      item.streamCodec = payload.codec || '';
      item._relayUrl = payload.relayUrl || (/^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(payload.proxyPath || '') ? payload.proxyPath.split('?')[0] : '');
      if (state.playerEpisode) { state.playerEpisode._relayUrl = item._relayUrl; }
      if (durationToSeconds(payload.duration) > 0) {
        item.duration = durationToSeconds(payload.duration);
        if (state.playerEpisode) { state.playerEpisode.duration = payload.duration; }
      } else {
        item.duration = item.duration || 0;
      }
      item.subtitles = payload.subtitles || [];
      item.streamAudioInfo = payload.audio || item.streamAudioInfo || '';
      if (state.playerEpisode) { state.playerEpisode.streamAudioInfo = payload.audio || ''; }
      item.isHls = !!payload.isHls;
      if (!vodAudioChosen && payload.audio) {
        vodCurrentAudioTrack = preferredAudioIndex(payload.audio);
      }
      /* resolve already completed startPlayVOD.  Reuse its audio/subtitle
         metadata in the panel instead of requesting the same episode a
         second time when the viewer changes chapters. */
      var resolvedInfo = {
        audio: payload.audio || item.streamAudioInfo,
        subtitles: item.subtitles,
        tracks: payload.availableTracks || [],
        selected: payload.selectedTrack || {},
        duration: payload.duration || 0
      };
      mediaInfoCache[mediaInfoKey(item)] = resolvedInfo;
      applySubtitleDefaults(resolvedInfo);
      /* Read-only local diagnostics for the webOS inspector.  Do not place
         the stream URL, licence or headers here. */
      try {
        window.__xuperStreamInfo = {
          selectedTrack: payload.selectedTrack || {},
          availableTracks: payload.availableTracks || []
        };
      } catch (eDiag) { /* ignore */ }
      done(payload.proxyPath || payload.url || '');
      requestVideoDuration(item, state.playerEpisode, payload);
    });
  }
  if (isSeriesItem(item) && !state.playerEpisode && (!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
    setPlayerStatus('Cargando capítulos…');
    loadVodDetail(item, function (loaded) {
      if (mySeq !== resolveSeq) { return; }
      if (!loaded) { return done(''); }
      resolveNow();
    });
    return;
  }
  resolveNow();
}

function startPlayerVideo(item, episode) {
  if (!playerVideo) { return; }
  if (episode) {
    state.playerEpisode = episode;
    state.playerSeasonIndex = state.detailSeason || 0;
  }
  if (item) { state.playerItem = item; }
  if (window.XUPER_DESKTOP) { installResume(); planResume(state.playerItem, state.playerEpisode); }
  var it = item || state.playerItem;
  if (it) { restoreSmoothMode(it); }
  stopPlayerVideo();
  if (!it) { return; }
  vodAudioChosen = false;
  vodCurrentAudioTrack = 0;
  /* resolvePlayerStream returns the same audio/subtitle metadata needed by
     the dialog.  Do not issue mediaInfo in parallel here: on every episode
     change that duplicated startPlayVOD and delayed the next chapter.  It is
     only requested while the audio PID order is still unknown, because the
     portal lists it in stream order (index 0 is not Spanish) and Modo Fluido
     maps that index inside FFmpeg. */
  var currentEp = episode || state.playerEpisode;
  var epKey = (currentEp && currentEp.id) || (it && it.id) || '';
  var epInfo = epKey ? mediaInfoCache[epKey] : null;
  var knownAudio = (epInfo && epInfo.audio) || (currentEp && currentEp.streamAudioInfo) || '';
  if (it._portal && !vodAudioChosen && !knownAudio) {
    var started = false;
    var startSeq = resolveSeq;
    var proceed = function () {
      if (started || startSeq !== resolveSeq) { return; }
      started = true;
      var epNum = episode ? (episode.number || episode.seriesNumber || '') : '';
      setPlayerStatus(epNum ? ('Cargando capítulo ' + epNum + '…') : 'Cargando capítulo…');
      resolvePlayerStream(it, function (url) {
        if (url) { playUrl(url); }
        else if (!state.streamError) { setPlayerStatus('Sin fuente de reproducción'); }
      });
    };
    /* Never hold playback on the metadata call: after 2.5 s resolve anyway. */
    setTimeout(proceed, 2500);
    ensureMediaInfo(it, function (info) {
      proceed();
    });
    return;
  }
  if (it._portal) {
    var epNum = episode ? (episode.number || episode.seriesNumber || '') : '';
    setPlayerStatus(epNum ? ('Cargando capítulo ' + epNum + '…') : 'Cargando capítulo…');
    resolvePlayerStream(it, function (url) {
      if (url) { playUrl(url); }
      else if (!state.streamError) { setPlayerStatus('Sin fuente de reproducción'); }
    });
    return;
  }
  if (it._stremio && !it.streamUrl && !(episode && episode.streamUrl)) {
    setPlayerStatus('Buscando stream en addons de Stremio…');
    resolveStremioStream(it, episode || state.playerEpisode, function (url) {
      if (url) { playUrl(url); }
    });
    return;
  }
  var directUrl = (episode && episode.streamUrl) || it.streamUrl || '';
  if (!directUrl) { return; }
  playUrl(directUrl);
}

function expandToFullscreen(item, episode) {
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
  if (window.XUPER_DESKTOP && mode === 'live') { installLiveControls(); enterLiveFullscreen(); }
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
