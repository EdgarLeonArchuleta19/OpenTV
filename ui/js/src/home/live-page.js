/* home/live-page.js — Página TV del inicio (vista previa del canal y lista).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------- home live */
function buildLivePage(page) {
  liveMain = el('div', 'live-main');
  livePreviewVideo = document.createElement('video');
  livePreviewVideo.className = 'live-preview-video';
  livePreviewVideo.preload = 'auto';
  livePreviewVideo.muted = true;
  livePreviewVideo.volume = 0;
  livePreviewVideo.setAttribute('muted', 'muted');
  livePreviewVideo.setAttribute('playsinline', '');
  livePreviewVideo.setAttribute('webkit-playsinline', '');
  liveMain.appendChild(livePreviewVideo);
  liveMain.appendChild(el('div', 'live-frame'));
  liveMain.appendChild(el('div', 'live-logo'));
  livePreviewStatus = el('div', 'live-preview-status');
  liveMain.appendChild(livePreviewStatus);
  page.appendChild(liveMain);

  var info = el('div', 'live-info');
  liveInfoText = el('div', 'live-channel');
  /* mTvChannel is layout_toLeftOf mIvFullScreen (alignParentRight), so the
     channel name is right-aligned, not left-aligned. */
  liveInfoText.style.right = '112.5px';
  info.appendChild(liveInfoText);
  var full = el('div', 'live-fullscreen focusable');
  full._activate = function () { openPlayer('live'); };
  info.appendChild(full);
  liveMain.appendChild(info);

  var up = el('div', 'live-arrow-up focusable');
  var down = el('div', 'live-arrow-down focusable');
  up.title = 'Desplazar canales hacia arriba';
  down.title = 'Desplazar canales hacia abajo';
  if (window.XUPER_DESKTOP) {
    up.innerHTML = UI_ICONS.chevronUp;
    down.innerHTML = UI_ICONS.chevronDown;
    up._activate = function () {
      if (liveList) { liveList.scrollBy({ top: -360, behavior: 'smooth' }); }
    };
    down._activate = function () {
      if (liveList) { liveList.scrollBy({ top: 360, behavior: 'smooth' }); }
    };
  } else {
    up._activate = function () { setChannel(state.channel - 1, true); };
    down._activate = function () { setChannel(state.channel + 1, true); };
  }
  page.appendChild(up);
  page.appendChild(down);

  if (window.XUPER_DESKTOP) {
    page.appendChild(createChannelSearchBox('is-home', 'Buscar canal en vivo…'));
  }

  liveList = el('div', 'live-list scrollable');
  page.appendChild(liveList);
  renderLiveRows(false);
  loadLiveChannels();

  liveFocus = el('div', 'live-focus focusable');
  liveFocus._onMove = function (dir) {
    if (dir === 'up') {
      if (state.channel > 0) { setChannel(state.channel - 1); }
      return true;
    }
    if (dir === 'down') {
      if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1); }
      return true;
    }
    if (dir === 'right') {
      var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
      if (row) { setFocus(row); }
      else if (liveRows.length) { setFocus(liveRows[0]); }
      return true;
    }
    if (dir === 'left') {
      if (tabEls[0]) { setFocus(tabEls[0]); }
      return true;
    }
    return false;
  };
  liveFocus._activate = function () { openPlayer('live'); };
  page.appendChild(liveFocus);
  if (window.XUPER_DESKTOP) {
    buildLiveDock(page);
    installLivePreviewGestures(liveFocus);
  }
}
