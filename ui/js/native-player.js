/* js/native-player.js — Android (phone, Android TV, Fire TV): the player's
   <video> elements play through the app's native player (AndroidX Media3 /
   ExoPlayer, NativePlayerPlugin.java) instead of hls.js in the WebView, so
   the picture is decoded in hardware like in native TV apps.

   Nothing else in the interface changes: the two video elements the app
   uses (#player-video and the home "TV en vivo" preview, .live-preview-video)
   keep their API (src, <source>, load/play/pause, currentTime, paused,
   duration, readyState, volume, events...), and the calls go to the plugin.
   The picture is a surface BEHIND the transparent WebView, placed where the
   element sits on the page; the page areas in front of it become
   transparent (attribute data-np-hole) while it shows.

   Only on Android with the plugin (capability 'native-player' in
   js/platform.js). Elsewhere this file does nothing. ES5 only (webOS loads
   it too). */
(function () {
  'use strict';
  var P = window.OPENTV_PLATFORM;
  var cap = window.Capacitor;
  if (!P || !P.has('native-player') || !cap || typeof cap.nativePromise !== 'function' ||
      typeof cap.addListener !== 'function') { return; }

  var PLUGIN = 'NativePlayer';
  var QUALITY_PREF_KEY = 'xuper_quality_pref_v1';
  var proto = HTMLMediaElement.prototype;
  var vproto = HTMLVideoElement.prototype;
  var nodeProto = Node.prototype;
  var elProto = Element.prototype;

  function call(method, opts) {
    try {
      var p = cap.nativePromise(PLUGIN, method, opts || {});
      if (p && p.then) { p.then(null, function () {}); }
    } catch (e) { /* the plugin is missing: nothing plays */ }
  }
  function desc(o, name) {
    var d = null;
    while (o && !(d = Object.getOwnPropertyDescriptor(o, name))) { o = Object.getPrototypeOf(o); }
    return d;
  }
  function managed(el) {
    return !!el && el.tagName === 'VIDEO' &&
      (el.id === 'player-video' || (el.classList && el.classList.contains('live-preview-video')));
  }
  function fire(el, type) {
    try { el.dispatchEvent(new Event(type)); } catch (e) { /* ignore */ }
  }
  function docEvent(type) {
    try { document.dispatchEvent(new CustomEvent(type)); } catch (e) { /* ignore */ }
  }

  var owner = null;          /* the element the native player plays for */
  var genCounter = 0;
  var seekCounter = 0;

  function st(el) {
    if (!el._np) {
      el._np = { src: '', sourceUrl: '', sourceType: '', url: '', gen: 0, paused: true, time: 0,
        dur: NaN, buf: 0, dyn: false, live: false, hls: false, ready: 0, ended: false, seeking: false,
        seekSeq: 0, seekQueued: false, playing: false, vw: 0, vh: 0, volume: 1, muted: false, rate: 1,
        error: null, waiters: [], tracks: { audio: [], video: [] }, autoLoad: false, qualityAuto: true };
    }
    return el._np;
  }

  function settleWaiters(s, error) {
    var w = s.waiters;
    s.waiters = [];
    for (var i = 0; i < w.length; i++) {
      try { if (error) { w[i][1](error); } else { w[i][0](); } } catch (e) { /* ignore */ }
    }
  }

  function mediaError(code, message) {
    return { code: code, message: message || '', MEDIA_ERR_ABORTED: 1, MEDIA_ERR_NETWORK: 2,
      MEDIA_ERR_DECODE: 3, MEDIA_ERR_SRC_NOT_SUPPORTED: 4 };
  }

  function resetState(s) {
    s.url = '';
    s.paused = true;
    s.playing = false;
    s.ready = 0;
    s.time = 0;
    s.dur = NaN;
    s.buf = 0;
    s.dyn = false;
    s.ended = false;
    s.seeking = false;
    s.error = null;
    s.vw = 0;
    s.vh = 0;
    s.tracks = { audio: [], video: [] };
    s.waiters = [];
  }

  /* Stops the native player when el owns it; el forgets its source. */
  function detach(el) {
    var s = st(el);
    var had = !!s.url;
    if (el === owner) {
      if (had) { call('stop'); }
      owner = null;
    }
    resetState(s);
    if (had) {
      if (el.id === 'player-video') { docEvent('xuper:hls-levels'); }
      fire(el, 'emptied');
    }
    /* Not at once: a stop is usually followed, in the same task, by the
       next title or channel, and the picture area should not flicker. */
    setTimeout(updateLayout, 0);
  }

  function setTimeline(el, s, complete, duration) {
    if (el.id !== 'player-video') { return; }
    var kind = s.hls ? 'hls' : 'native';
    var old = el._xuperTimeline;
    var dur = complete && duration > 0 ? duration : 0;
    if (old && old.kind === kind && old.complete === complete && old.duration === dur) { return; }
    el._xuperTimeline = { kind: kind, complete: complete, duration: dur };
    try { document.dispatchEvent(new CustomEvent('xuper:timeline', { detail: el._xuperTimeline })); } catch (e) { /* ignore */ }
  }

  function doLoad(el, url) {
    var s = st(el);
    s.autoLoad = false;
    if (owner && owner !== el) {
      /* One native player: the other element lets go of it (no stop, the
         new load replaces its media). */
      var other = owner;
      var os = st(other);
      owner = null;
      var had = !!os.url;
      resetState(os);
      if (had) { fire(other, 'emptied'); }
    }
    owner = el;
    var start = el._xuperStartPos > 0 ? el._xuperStartPos : 0;
    el._xuperStartPos = 0;
    resetState(s);
    s.url = url;
    s.gen = ++genCounter;
    s.seekSeq = 0;
    s.time = start;
    s.qualityAuto = true;
    /* A title served as MPEG-TS plays as the file itself (not through the
       service's virtual HLS route as hls.js does): ExoPlayer seeks inside
       the TS by itself, knows the whole duration at once and, unlike any
       HLS player, offers every audio language of the file. */
    var nativeUrl = url;
    var isTs = /\.ts(?:\?|$)/i.test(url) || /mp2t/i.test(s.sourceType || '');
    s.hls = !isTs && (/\.m3u8(?:\?|$)/i.test(url) || /mpegurl/i.test(s.sourceType || ''));
    /* Titles start where asked; an HLS stream may be a live channel. */
    s.live = el.classList.contains('live-preview-video') || (s.hls && !start);
    setTimeline(el, s, false, 0);
    /* ...unless ExoPlayer cannot work out the file's length (then it could
       not seek): the plugin falls back to the virtual HLS route. */
    var alt = /^http:\/\/127\.0\.0\.1:\d+\/media\/[a-f0-9]+\/stream\.ts(?:\?|$)/i.test(url)
      ? url.replace(/\/stream\.ts(\?|$)/i, '/stream.m3u8$1') : '';
    call('load', { url: nativeUrl, alt: alt, start: start, autoplay: false, hls: s.hls, live: s.live, g: s.gen });
    call('setVolume', { v: s.volume, m: s.muted });
    call('setRate', { r: s.rate || 1 });
    fire(el, 'loadstart');
    updateLayout();
    ensurePoll();
  }

  function loadNow(el) {
    var s = st(el);
    s.autoLoad = false;
    var url = s.src || s.sourceUrl;
    if (!url) { detach(el); return; }
    doLoad(el, url);
  }

  /* HTML starts loading by itself when src is set or a <source> is added;
     the app calls load() right after, which cancels this. */
  function scheduleAutoLoad(el) {
    var s = st(el);
    if (s.autoLoad) { return; }
    s.autoLoad = true;
    Promise.resolve().then(function () { if (s.autoLoad) { loadNow(el); } });
  }

  function queueSeek(el) {
    var s = st(el);
    if (s.seekQueued) { return; }
    s.seekQueued = true;
    Promise.resolve().then(function () {
      s.seekQueued = false;
      if (el !== owner || !s.url || !s.seeking) { return; }
      call('seek', { t: s.time, s: s.seekSeq });
    });
  }

  /* ------------------------------------------------------- native events */
  function onNative(d) {
    var el = owner;
    if (!el || !d) { return; }
    var s = st(el);
    if (d.g !== s.gen || !s.url) { return; }
    switch (d.t) {
      case 'state': onState(el, s, d); break;
      case 'time': onTime(el, s, d); break;
      case 'seeked':
        if (d.s === s.seekSeq && s.seeking) {
          s.seeking = false;
          fire(el, 'seeked');
          fire(el, 'timeupdate');
        }
        break;
      case 'size':
        s.vw = d.w || 0;
        s.vh = d.h || 0;
        fire(el, 'resize');
        break;
      case 'frame':
        break;
      case 'tracks': onTracks(el, s, d); break;
      case 'ext':
        /* Paused or resumed by Android (app in the background, audio focus). */
        if (d.pwr && s.paused) { s.paused = false; fire(el, 'play'); }
        else if (!d.pwr && !s.paused) { s.paused = true; fire(el, 'pause'); }
        break;
      case 'error':
        s.error = mediaError(d.code || 4, (d.name || '') + (d.msg ? ': ' + d.msg : ''));
        try { console.warn('[native-player]', d.name, d.msg); } catch (e) { /* ignore */ }
        settleWaiters(s, new DOMException('El vídeo no está disponible', 'NotSupportedError'));
        fire(el, 'error');
        break;
    }
  }

  function onState(el, s, d) {
    var stateNo = d.st;   /* 1 idle, 2 buffering, 3 ready, 4 ended */
    if (stateNo === 3) {
      if (s.ready < 1) {
        s.ready = 4;
        fire(el, 'loadedmetadata');
        fire(el, 'durationchange');
        fire(el, 'loadeddata');
        fire(el, 'canplay');
        fire(el, 'canplaythrough');
      } else if (s.ready < 4) {
        s.ready = 4;
        fire(el, 'canplay');
      }
    } else if (stateNo === 2 && s.ready >= 3) {
      s.ready = 2;
      if (!s.paused) { fire(el, 'waiting'); }
    }
    if (d.pl && !s.playing) {
      s.playing = true;
      if (s.paused) { s.paused = false; fire(el, 'play'); }
      fire(el, 'playing');
      settleWaiters(s, null);
    } else if (!d.pl && s.playing) {
      s.playing = false;
    }
    if (stateNo === 4 && !s.ended) {
      s.ended = true;
      if (isFinite(s.dur) && s.dur > 0) { s.time = s.dur; }
      fire(el, 'timeupdate');
      if (!s.paused) { s.paused = true; fire(el, 'pause'); }
      fire(el, 'ended');
    }
  }

  function onTime(el, s, d) {
    if (d.s === s.seekSeq && !s.seeking && !s.ended && typeof d.p === 'number') { s.time = d.p; }
    var dur = (typeof d.d === 'number' && d.d > 0) ? d.d : NaN;
    if (s.live && d.dyn) { dur = Infinity; }
    s.buf = d.b || 0;
    s.seekEnd = d.d > 0 ? (d.o || 0) + d.d : s.buf;
    s.dyn = !!d.dyn;
    setTimeline(el, s, !d.dyn && d.d > 0, d.d);
    if (s.ready >= 1 && dur !== s.dur && !(isNaN(dur) && isNaN(s.dur))) {
      s.dur = dur;
      fire(el, 'durationchange');
    } else {
      s.dur = dur;
    }
    if (s.ready >= 1) { fire(el, 'timeupdate'); }
  }

  function onTracks(el, s, d) {
    s.tracks = { audio: d.audio || [], video: d.video || [] };
    var hasVideo = s.tracks.video.length > 0;
    el._xuperNoAudio = hasVideo && !s.tracks.audio.length;
    if (el.id === 'player-video') {
      var levels = qualityLevels(s);
      var pref = preferredHeight();
      if (pref && levels.length > 1 && s.qualityAuto) { chooseQuality(s, pref); }
      docEvent('xuper:hls-levels');
    }
  }

  cap.addListener(PLUGIN, 'ev', onNative);

  /* ------------------------------------------------------------- quality */
  function preferredHeight() {
    try { return parseInt(JSON.parse(localStorage.getItem(QUALITY_PREF_KEY) || '0'), 10) || 0; } catch (e) { return 0; }
  }
  function qualityLevels(s) {
    var seen = {};
    var out = [];
    (s.tracks.video || []).forEach(function (v, i) {
      if (!v.h || seen[v.h]) { return; }
      seen[v.h] = true;
      out.push({ height: v.h, index: i });
    });
    return out.sort(function (a, b) { return b.height - a.height; });
  }
  function chooseQuality(s, height) {
    var levels = qualityLevels(s);
    var best = 0;
    for (var i = 0; i < levels.length; i++) {
      /* The closest level at or below the wanted height (or the lowest). */
      if (levels[i].height <= height && levels[i].height > best) { best = levels[i].height; }
    }
    if (!best && levels.length) { best = levels[levels.length - 1].height; }
    s.qualityAuto = !height;
    call('selectQuality', { h: height ? best : 0 });
  }
  function playerState() {
    var v = document.getElementById('player-video');
    return v && v === owner ? st(v) : null;
  }
  /* Same interface as desktop/player.js (ui/js/src/player/quality.js). */
  window.__opentvHls = {
    levels: function () {
      var s = playerState();
      return s ? qualityLevels(s) : [];
    },
    current: function () {
      var s = playerState();
      if (!s) { return null; }
      var h = 0;
      (s.tracks.video || []).forEach(function (v) { if (v.sel) { h = v.h; } });
      if (!h && s.vh) { h = s.vh; }
      return { auto: s.qualityAuto, height: h };
    },
    choose: function (height) {
      try { localStorage.setItem(QUALITY_PREF_KEY, JSON.stringify(height || 0)); } catch (e) { /* optional */ }
      var s = playerState();
      if (!s) { return; }
      chooseQuality(s, height || 0);
      docEvent('xuper:hls-levels');
    }
  };

  /* ----------------------------------------------- position on the page */
  var lastRect = '';
  var lastHoleKey = '';
  var holes = [];
  var pollTimer = null;

  function clearHoles() {
    for (var i = 0; i < holes.length; i++) { holes[i].removeAttribute('data-np-hole'); }
    holes = [];
  }
  function opaque(node) {
    var cs = getComputedStyle(node);
    var bg = cs.backgroundColor;
    return (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) || (cs.backgroundImage && cs.backgroundImage !== 'none');
  }
  /* Elements once found opaque. Their computed colour cannot be trusted
     again soon: while see-through it is transparent, and a CSS transition
     keeps it looking transparent for a while after the attribute goes.
     (Marking an element that is transparent anyway changes nothing.) */
  var knownOpaque = [];
  function hole(node) {
    if (!node || node.nodeType !== 1 || holes.indexOf(node) !== -1) { return; }
    if (knownOpaque.indexOf(node) === -1) {
      if (!opaque(node)) { return; }
      knownOpaque.push(node);
      if (knownOpaque.length > 40) { knownOpaque.shift(); }
    }
    node.setAttribute('data-np-hole', '');
    holes.push(node);
  }
  /* The element, its ancestors and whatever lies under it must let the
     native picture through. */
  function makeHoles(el, r) {
    var old = holes;
    holes = [];
    makeHolesFor(el, r);
    for (var k = 0; k < old.length; k++) {
      if (holes.indexOf(old[k]) === -1) { old[k].removeAttribute('data-np-hole'); }
    }
  }
  function makeHolesFor(el, r) {
    if (!el) { return; }
    for (var node = el; node && node.nodeType === 1; node = node.parentElement) { hole(node); }
    if (document.elementsFromPoint) {
      var pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85]];
      for (var p = 0; p < pts.length; p++) {
        var list = document.elementsFromPoint(r.left + r.width * pts[p][0], r.top + r.height * pts[p][1]);
        var below = false;
        for (var i = 0; i < list.length; i++) {
          if (list[i] === el) { below = true; continue; }
          /* An idle player element in front (the home preview while the
             player's own element is shown there) shows nothing but its
             black background. */
          if (!below && managed(list[i]) && !st(list[i]).url) { hole(list[i]); continue; }
          if (below && !list[i].contains(el)) { hole(list[i]); }
        }
      }
    }
  }

  function updateLayout() {
    var el = owner;
    var show = false;
    var x = 0, y = 0, w = 0, h = 0, fit = 'contain';
    var r = null;
    if (el && st(el).url && el.isConnected) {
      r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        var cs = getComputedStyle(el);
        if (cs.display !== 'none' && cs.visibility !== 'hidden') {
          var dpr = window.devicePixelRatio || 1;
          show = true;
          x = Math.round(r.left * dpr);
          y = Math.round(r.top * dpr);
          w = Math.round(r.width * dpr);
          h = Math.round(r.height * dpr);
          fit = cs.objectFit || 'contain';
        }
      }
    }
    var key = show ? [x, y, w, h, fit, el.id || el.className].join(',') : 'hidden';
    if (key === lastRect) { return; }
    var wasShown = lastRect !== '' && lastRect !== 'hidden';
    lastRect = key;
    /* The see-through elements only change with the element's place in the
       page, not while it merely moves. */
    var holeKey = show ? el.className + '|' + (el.parentNode ? el.parentNode.className : '') : '';
    if (!show) { clearHoles(); lastHoleKey = ''; }
    else if (holeKey !== lastHoleKey || !wasShown) { lastHoleKey = holeKey; makeHoles(el, r); }
    if (show || wasShown) { call('setRect', { x: x, y: y, w: w, h: h, fit: fit, show: show }); }
    document.documentElement.classList.toggle('np-video', show);
    /* The box moved: it may be animating (screen change, preview growing),
       so follow it frame by frame until it stops. */
    if (show && wasShown) { followFrames = 20; if (!followRaf) { followRaf = requestAnimationFrame(follow); } }
  }
  var followFrames = 0;
  var followRaf = 0;
  function follow() {
    followRaf = 0;
    var before = lastRect;
    updateLayout();
    if (lastRect === before) { followFrames--; }
    if (!followRaf && followFrames > 0 && lastRect !== 'hidden') { followRaf = requestAnimationFrame(follow); }
  }

  function ensurePoll() {
    if (pollTimer) { return; }
    pollTimer = setInterval(function () {
      updateLayout();
      if (!owner && lastRect === 'hidden') { clearInterval(pollTimer); pollTimer = null; }
    }, 250);
  }
  window.addEventListener('resize', updateLayout);
  /* Inspector aid: where the native picture is and what was made see-through. */
  window.__opentvNative = {
    info: function () {
      return { owner: owner ? (owner.id || owner.className) : '', rect: lastRect,
        holes: holes.map(function (n) { return n.id || String(n.className).split(' ')[0] || n.tagName; }) };
    },
    relayout: function () { lastRect = ''; updateLayout(); }
  };

  var style = document.createElement('style');
  /* The :not(#…) parts only raise the specificity, above the app's own
     "background: #000 !important" rules (ids included). */
  style.textContent = '[data-np-hole]:not(#np-a):not(#np-b):not(#np-c){background:transparent!important}';
  (document.head || document.documentElement).appendChild(style);

  /* -------------------------------------------------- the element's API */
  function override(target, name, getter, setter) {
    var d = desc(target, name);
    var def = {
      configurable: true,
      enumerable: d ? d.enumerable : true,
      get: function () {
        if (managed(this)) { return getter.call(this, st(this)); }
        return d && d.get ? d.get.call(this) : (d ? d.value : undefined);
      }
    };
    def.set = function (v) {
      if (managed(this)) { if (setter) { setter.call(this, st(this), v); } return; }
      if (d && d.set) { d.set.call(this, v); }
    };
    Object.defineProperty(target, name, def);
  }
  function timeRanges(end) {
    var has = end > 0;
    return {
      length: has ? 1 : 0,
      start: function () { return 0; },
      end: function () { return has ? end : 0; }
    };
  }

  override(proto, 'src', function (s) { return s.src; }, function (s, v) {
    v = v ? String(v) : '';
    s.src = v;
    s.sourceUrl = '';
    if (v) { scheduleAutoLoad(this); } else { s.autoLoad = false; detach(this); }
  });
  override(proto, 'currentSrc', function (s) { return s.url; });
  override(proto, 'paused', function (s) { return s.paused; });
  override(proto, 'ended', function (s) { return s.ended; });
  override(proto, 'seeking', function (s) { return s.seeking; });
  override(proto, 'readyState', function (s) { return s.ready; });
  override(proto, 'networkState', function (s) { return s.url ? 2 : 0; });
  override(proto, 'error', function (s) { return s.error; });
  override(proto, 'duration', function (s) { return s.dur; });
  override(proto, 'buffered', function (s) { return timeRanges(s.buf); });
  override(proto, 'seekable', function (s) { return timeRanges(s.seekEnd || 0); });
  override(proto, 'currentTime', function (s) { return s.time; }, function (s, v) {
    v = Number(v) || 0;
    if (v < 0) { v = 0; }
    if (!s.url || this !== owner) { s.time = v; return; }
    if (!s.seeking && Math.abs(v - s.time) < 0.25) { return; }
    s.time = v;
    s.ended = false;
    s.seeking = true;
    s.seekSeq = ++seekCounter;
    fire(this, 'seeking');
    queueSeek(this);
  });
  override(proto, 'volume', function (s) { return s.volume; }, function (s, v) {
    v = Math.max(0, Math.min(1, Number(v)));
    if (isNaN(v) || v === s.volume) { return; }
    s.volume = v;
    if (this === owner) { call('setVolume', { v: s.volume, m: s.muted }); }
    fire(this, 'volumechange');
  });
  override(proto, 'muted', function (s) { return s.muted; }, function (s, v) {
    v = !!v;
    if (v === s.muted) { return; }
    s.muted = v;
    if (this === owner) { call('setVolume', { v: s.volume, m: s.muted }); }
    fire(this, 'volumechange');
  });
  override(proto, 'playbackRate', function (s) { return s.rate; }, function (s, v) {
    v = Number(v) || 1;
    if (v === s.rate) { return; }
    s.rate = v;
    if (this === owner) { call('setRate', { r: v }); }
    fire(this, 'ratechange');
  });
  override(vproto, 'videoWidth', function (s) { return s.vw; });
  override(vproto, 'videoHeight', function (s) { return s.vh; });
  /* The WebView does not decode anything here. */
  override(proto, 'webkitAudioDecodedByteCount', function () { return undefined; });
  override(vproto, 'webkitVideoDecodedByteCount', function () { return undefined; });
  /* Audio languages of the title (in stream order, like the portal's list). */
  override(proto, 'audioTracks', function (s) {
    var el = this;
    var list = [];
    (s.tracks.audio || []).forEach(function (a, i) {
      var t = { id: String(i), kind: 'main', label: a.label || '', language: a.lang || '' };
      Object.defineProperty(t, 'enabled', {
        get: function () { return !!a.sel; },
        set: function (on) {
          if (!on || el !== owner) { return; }
          (s.tracks.audio || []).forEach(function (o, j) { o.sel = j === i; });
          call('selectAudio', { i: i });
        }
      });
      list.push(t);
    });
    return list;
  });

  var nativeLoad = proto.load;
  var nativePlay = proto.play;
  var nativePause = proto.pause;
  proto.load = function () {
    if (!managed(this)) { return nativeLoad.call(this); }
    loadNow(this);
  };
  proto.play = function () {
    if (!managed(this)) { return nativePlay.call(this); }
    var el = this;
    var s = st(el);
    if (s.autoLoad) { loadNow(el); }
    if (!s.url || el !== owner) {
      return Promise.reject(new DOMException('Sin fuente de vídeo', 'NotSupportedError'));
    }
    if (s.error) { return Promise.reject(new DOMException('El vídeo no está disponible', 'NotSupportedError')); }
    if (s.ended) { s.ended = false; s.time = 0; }
    if (s.paused) {
      s.paused = false;
      call('play');
      fire(el, 'play');
    }
    if (s.playing) { return Promise.resolve(); }
    return new Promise(function (resolve, reject) { s.waiters.push([resolve, reject]); });
  };
  proto.pause = function () {
    if (!managed(this)) { return nativePause.call(this); }
    var s = st(this);
    if (s.paused) { return; }
    s.paused = true;
    if (s.url && this === owner) { call('pause'); }
    fire(this, 'pause');
  };

  /* <source> children: remembered, never inserted (the WebView would start
     loading them itself). */
  var nativeAppend = nodeProto.appendChild;
  var nativeInsert = nodeProto.insertBefore;
  function takeSource(el, node) {
    var s = st(el);
    s.sourceUrl = node.getAttribute('src') || '';
    s.sourceType = node.getAttribute('type') || '';
    if (!s.src && s.sourceUrl) { scheduleAutoLoad(el); }
    return node;
  }
  nodeProto.appendChild = function (node) {
    if (node && node.tagName === 'SOURCE' && managed(this)) { return takeSource(this, node); }
    return nativeAppend.call(this, node);
  };
  nodeProto.insertBefore = function (node, ref) {
    if (node && node.tagName === 'SOURCE' && managed(this)) { return takeSource(this, node); }
    return nativeInsert.call(this, node, ref);
  };
  var nativeRemoveAttr = elProto.removeAttribute;
  elProto.removeAttribute = function (name) {
    if (managed(this) && String(name).toLowerCase() === 'src') {
      var s = st(this);
      s.src = '';
      s.sourceUrl = '';
      s.autoLoad = false;
      detach(this);
    }
    return nativeRemoveAttr.call(this, name);
  };
}());
