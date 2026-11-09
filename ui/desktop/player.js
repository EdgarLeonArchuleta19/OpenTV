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
    currentHls = new Hls({ enableWorker: true, maxBufferLength: 25,
      maxMaxBufferLength: 60, backBufferLength: 30, xhrSetup: function (xhr) { xhr.withCredentials = false; } });
    var instance = currentHls;
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
