/* home/live-dock-tools.js — Escritorio: los botones del reproductor de TV también en la vista previa.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Pausa, reintentar, calidad, ventana flotante y diagnóstico act
   on the video shown in the home preview (its own element, or the player's
   while it is lent to the home). */
var liveDockPlayBtn = null;

function liveHomeVideo() {
  return liveHandoff && liveHandoff.type === 'player' ? playerVideo : livePreviewVideo;
}

function showLiveDockToast(icon, text) {
  if (!liveMain) { return; }
  if (!liveVolToast || liveVolToast.parentNode !== liveMain) {
    if (liveVolToast && liveVolToast.parentNode) { liveVolToast.parentNode.removeChild(liveVolToast); }
    liveVolToast = el('div', 'live-vol-toast');
    liveMain.appendChild(liveVolToast);
  }
  /* The text can carry a channel name from an addon: never as HTML. */
  liveVolToast.innerHTML = icon;
  liveVolToast.appendChild(el('span', null, text));
  liveVolToast.classList.add('is-visible');
  if (liveVolToastTimer) { clearTimeout(liveVolToastTimer); }
  liveVolToastTimer = setTimeout(function () { liveVolToast.classList.remove('is-visible'); }, 1400);
}

function toggleLivePreviewPlay() {
  var v = liveHomeVideo();
  if (!v || !(v.currentSrc || v.getAttribute('src'))) {
    var ch = CHANNELS[state.channel];
    if (ch) { startLivePreview(ch); }
    return;
  }
  if (v.paused) {
    var p = v.play();
    if (p && p.catch) { p.catch(function () {}); }
  } else {
    v.pause();
  }
  syncLiveDockPlay();
}

function syncLiveDockPlay() {
  if (!liveDockPlayBtn) { return; }
  var v = liveHomeVideo();
  var paused = !!(v && v.paused && (v.currentSrc || v.getAttribute('src')));
  if (liveDockPlayBtn._paused === paused) { return; }
  liveDockPlayBtn._paused = paused;
  liveDockPlayBtn.querySelector('.live-dock-ico').innerHTML = paused ? UI_ICONS.play : UI_ICONS.pause;
  var tip = paused ? 'Reproducir' : 'Pausa';
  liveDockPlayBtn.setAttribute('data-tip', tip);
  liveDockPlayBtn.setAttribute('aria-label', tip);
  if (liveMain) { liveMain.classList.toggle('is-preview-paused', paused); }
  if (liveMain && !liveMain._pauseMark) {
    /* Big play mark in the middle of the paused picture; a click resumes. */
    var mark = el('div', 'live-paused-mark');
    mark.innerHTML = UI_ICONS.play;
    mark.addEventListener('click', function (event) { event.stopPropagation(); toggleLivePreviewPlay(); });
    liveMain.appendChild(mark);
    liveMain._pauseMark = mark;
  }
}

function retryLivePreview() {
  var ch = CHANNELS[state.channel];
  if (!ch) { return; }
  stopLivePreview();
  startLivePreview(ch);
  showLiveDockToast(UI_ICONS.retry, 'Reconectando ' + (ch.name || 'canal') + '…');
}

/* Automática → highest → … → lowest → Automática. */
function cycleLivePreviewQuality() {
  if (liveHandoff && liveHandoff.type === 'player') {
    var api = hlsQualityApi();
    if (api && api.levels().length > 1) {
      cycleHlsQuality();
      var cur = api.current() || {};
      showLiveDockToast(UI_ICONS.quality, 'Calidad: ' + (cur.auto ? 'Automática' : hlsQualityLabel(cur.height)));
      return;
    }
  }
  var hls = livePreviewHls;
  var levels = hls && hls.levels ? hls.levels : [];
  if (levels.length < 2) {
    var h = livePreviewVideo && livePreviewVideo.videoHeight;
    showLiveDockToast(UI_ICONS.quality, 'Esta señal tiene una sola calidad' + (h ? ' (' + hlsQualityLabel(h) + ')' : ''));
    return;
  }
  var order = [-1];
  var byHeight = levels.map(function (l, i) { return { i: i, h: l.height || 0 }; })
    .sort(function (a, b) { return b.h - a.h; });
  byHeight.forEach(function (l) { order.push(l.i); });
  var at = hls.autoLevelEnabled ? 0 : order.indexOf(hls.currentLevel);
  var next = order[(at + 1) % order.length];
  hls.currentLevel = next;
  showLiveDockToast(UI_ICONS.quality, 'Calidad: ' + (next < 0 ? 'Automática' : hlsQualityLabel(levels[next].height || 0)));
}

function toggleLivePreviewPip() {
  if (!document.pictureInPictureEnabled) { return; }
  if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(function () {}); return; }
  var v = liveHomeVideo();
  if (!v || !(v.currentSrc || v.getAttribute('src'))) {
    showLiveDockToast(UI_ICONS.pip, 'Elige un canal para abrir la ventana flotante');
    return;
  }
  v.requestPictureInPicture().catch(function () {});
}

/* Icon-only buttons placed after the volume. */
function appendLiveDockTools(bar) {
  bar.appendChild(dockButton('is-tool', UI_ICONS.retry, '', 'Reintentar señal', retryLivePreview));
  bar.appendChild(dockButton('is-tool', UI_ICONS.quality, '', 'Calidad', cycleLivePreviewQuality));
  if (platformHas('pip')) { bar.appendChild(dockButton('is-tool', UI_ICONS.pip, '', 'Ventana flotante', toggleLivePreviewPip)); }
}

function makeLiveDockPlayButton() {
  liveDockPlayBtn = dockButton('is-play', UI_ICONS.pause, '', 'Pausa', toggleLivePreviewPlay);
  liveDockPlayBtn._paused = false;
  if (!document._dockPlayHooks) {
    /* Media events do not bubble; capture sees those of every video. */
    document._dockPlayHooks = true;
    ['play', 'pause', 'emptied', 'playing'].forEach(function (name) {
      document.addEventListener(name, syncLiveDockPlay, true);
    });
  }
  return liveDockPlayBtn;
}
