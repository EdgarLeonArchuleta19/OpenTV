(function () {
  'use strict';
  // Chromium needs MediaSource/HLS.js for HLS and raw MPEG-TS. Keep all of
  // the upstream player's controls, progress, episode and subtitle handlers.
  var nativeLoad = HTMLMediaElement.prototype.load;
  var nativePlay = HTMLMediaElement.prototype.play;
  var currentHls = null;
  var attachedUrl = '';
  var ready = null;
  function timeline(video, kind, complete, duration) {
    duration = Number(duration);
    video._xuperTimeline = {
      kind: kind, complete: !!complete,
      duration: complete && isFinite(duration) && duration > 0 ? duration : 0
    };
    // A generated TS playlist grows while its index is built. Its current
    // end is a transport boundary, not the full movie/episode duration.
    document.dispatchEvent(new CustomEvent('xuper:timeline', { detail: video._xuperTimeline }));
  }
  function reset() {
    if (currentHls) currentHls.destroy();
    currentHls = null;
    attachedUrl = '';
    ready = null;
    levelsChanged();
  }
  // Quality levels of the current HLS stream, for the player menus (app.js).
  var QUALITY_PREF_KEY = 'xuper_quality_pref_v1';
  function levelsChanged() {
    document.dispatchEvent(new CustomEvent('xuper:hls-levels'));
  }
  function preferredHeight() {
    try { return parseInt(JSON.parse(localStorage.getItem(QUALITY_PREF_KEY) || '0'), 10) || 0; } catch (_) { return 0; }
  }
  window.__opentvHls = {
    // Distinct heights, highest first: [{ height, index }]
    levels: function () {
      if (!currentHls || !currentHls.levels) return [];
      var seen = {}, out = [];
      currentHls.levels.forEach(function (l, i) {
        if (!l.height || seen[l.height]) return;
        seen[l.height] = true;
        out.push({ height: l.height, index: i });
      });
      return out.sort(function (a, b) { return b.height - a.height; });
    },
    // { auto, height }: the chosen mode and the height playing now.
    current: function () {
      if (!currentHls) return null;
      var lvl = currentHls.levels && currentHls.levels[currentHls.currentLevel];
      return { auto: currentHls.autoLevelEnabled, height: lvl ? lvl.height : 0 };
    },
    // height 0 = automatic. The choice is remembered for later videos.
    choose: function (height) {
      try { localStorage.setItem(QUALITY_PREF_KEY, JSON.stringify(height || 0)); } catch (_) { /* optional */ }
      if (!currentHls) return;
      currentHls.currentLevel = height ? levelForHeight(height) : -1;
      levelsChanged();
    }
  };
  function levelForHeight(height) {
    var best = -1, bestH = 0;
    (currentHls.levels || []).forEach(function (l, i) {
      // The closest level at or below the wanted height (or the lowest one).
      if (l.height && l.height <= height && l.height > bestH) { best = i; bestH = l.height; }
    });
    if (best < 0 && currentHls.levels && currentHls.levels.length) best = 0;
    return best;
  }
  HTMLMediaElement.prototype.load = function () {
    if (this.id !== 'player-video') return nativeLoad.call(this);
    var media = this;
    this._xuperResetTimeline = function () {
      reset();
      timeline(media, 'none', false, 0);
    };
    var source = this.querySelector('source');
    var url = source && source.getAttribute('src');
    if (!url) { reset(); timeline(this, 'none', false, 0); return nativeLoad.call(this); }
    var isHls = /\.m3u8(?:\?|$)/i.test(url);
    var isProxyTs = /^http:\/\/127\.0\.0\.1:\d+\/media\/[a-f0-9]+\/stream\.ts(?:\?|$)/i.test(url);
    if (!isHls && !isProxyTs) {
      reset();
      var isRelay = /^https?:\/\/127\.0\.0\.1:\d+\/s\//i.test(url);
      timeline(this, isRelay ? 'relay' : 'native', !isRelay, 0);
      source.type = 'video/mp4';
      return nativeLoad.call(this);
    }
    if (!window.Hls || !Hls.isSupported()) {
      reset(); timeline(this, 'hls', false, 0);
      return nativeLoad.call(this);
    }
    var hlsUrl = isProxyTs ? url.replace('/stream.ts', '/stream.m3u8') : url;
    if (currentHls && attachedUrl === hlsUrl) return;
    reset();
    var video = this;
    timeline(video, 'hls', false, 0);
    attachedUrl = hlsUrl;
    var startPos = (video._xuperStartPos && video._xuperStartPos > 0) ? video._xuperStartPos : -1;
    video._xuperStartPos = 0;
    currentHls = new Hls({ enableWorker: true, maxBufferLength: 25,
      maxMaxBufferLength: 60, backBufferLength: 30,
      startPosition: startPos,
      // Start from a broadband estimate (4 Mbps) instead of 500 kbps, so the
      // picture does not begin blurry and climb up for the first seconds.
      abrEwmaDefaultEstimate: 4000000,
      xhrSetup: function (xhr) { xhr.withCredentials = false; } });
    var instance = currentHls;
    instance.on(Hls.Events.MANIFEST_PARSED, function () {
      if (currentHls !== instance) return;
      var pref = preferredHeight();
      if (pref && instance.levels && instance.levels.length > 1) instance.currentLevel = levelForHeight(pref);
      levelsChanged();
    });
    instance.on(Hls.Events.LEVEL_SWITCHED, function () { if (currentHls === instance) levelsChanged(); });
    // A stream with picture but no audio track: app.js offers compatibility mode.
    instance.on(Hls.Events.BUFFER_CODECS, function (_, data) {
      if (currentHls === instance && data && data.video && !data.audio && !data.audiovideo) video._xuperNoAudio = true;
    });
    instance.on(Hls.Events.LEVEL_LOADED, function (_, data) {
      if (currentHls !== instance || !data || !data.details) return;
      var details = data.details;
      timeline(video, 'hls', details.live === false, details.totalduration);
    });
    ready = new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () { finish(false); }, 20000);
      function finish(ok) { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } }
      var recoveredMedia = false;
      var recoveredNet = false;
      instance.on(Hls.Events.MANIFEST_PARSED, function () { finish(true); });
      instance.on(Hls.Events.ERROR, function (_, data) {
        if (!data.fatal || currentHls !== instance) return;
        if (settled && data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true;
          try { instance.recoverMediaError(); return; } catch (eRec) { /* fall through */ }
        }
        if (settled && data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveredNet) {
          recoveredNet = true;
          try { instance.startLoad(); return; } catch (eNet) { /* fall through */ }
        }
        finish(false);
        var status = document.getElementById('player-status');
        if (status) { status.textContent = 'No se pudo reproducir este vídeo. Revisa la conexión o prueba el modo compatible en Ajustes.'; status.classList.add('is-active'); }
        // app.js retries once in compatibility mode (FFmpeg) when it can.
        document.dispatchEvent(new CustomEvent('xuper:hls-fatal', { detail: { type: data.type, details: data.details } }));
      });
      instance.on(Hls.Events.MEDIA_ATTACHED, function () { instance.loadSource(hlsUrl); });
      instance.attachMedia(video);
    });
  };
  HTMLMediaElement.prototype.play = function () {
    var video = this;
    if (this.id === 'player-video' && ready) {
      var instance = currentHls;
      return ready.then(function (ok) {
        if (!ok || currentHls !== instance) throw new DOMException('El vídeo no está disponible', 'AbortError');
        return nativePlay.call(video);
      });
    }
    return nativePlay.call(this);
  };
})();
