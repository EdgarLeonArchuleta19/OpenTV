/* home/live-page.js — Página TV del inicio (vista previa del canal y lista).
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* PC: a channel list's up/down arrows sat over the first and last rows
   even with nothing more to scroll that way. Each one hides at its end. */
function bindScrollArrows(list, up, down) {
  var pending = false;
  function sync() {
    pending = false;
    var max = list.scrollHeight - list.clientHeight;
    var upOff = list.scrollTop <= 2, downOff = max <= 2 || list.scrollTop >= max - 2;
    /* (A hidden arrow is not a keyboard stop either.) */
    up.classList.toggle('is-off', upOff); up.classList.toggle('focusable', !upOff);
    down.classList.toggle('is-off', downOff); down.classList.toggle('focusable', !downOff);
  }
  function later() {
    if (pending) { return; }
    pending = true;
    (window.requestAnimationFrame || setTimeout)(sync);
  }
  list.addEventListener('scroll', later, { passive: true });
  if (window.MutationObserver) { new MutationObserver(later).observe(list, { childList: true }); }
  window.addEventListener('resize', later);
  later();
}

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
  if (window.XUPER_DESKTOP) { bindScrollArrows(liveList, up, down); }
  renderLiveRows(false);
  loadLiveChannels();

  liveFocus = el('div', 'live-focus focusable');
  liveFocus._onMove = function (dir) {
    /* TVs: down goes to the controls under the preview and up to the icons
       at the top (the channel list on the right changes channel). */
    if (platformIsTv() && window.XUPER_DESKTOP) {
      if (dir === 'down') {
        var dockBtn = liveDock && (liveDock.querySelector('.live-dock-btn.is-play') || firstIn(liveDock));
        if (dockBtn && isVisible(dockBtn)) { setFocus(dockBtn); }
        return true;
      }
      if (dir === 'up') { focusHomeTopIcons(); return true; }
    }
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
