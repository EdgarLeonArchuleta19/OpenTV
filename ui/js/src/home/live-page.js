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

/* PC and TV (design "3A"): the channel list on the left (search, category chips,
   channels), the video in a 16:9 card on the right and, under it, the
   channel's name and the controls, so nothing covers the picture. */
var liveUnder = null;

function liveSideLayout() { return !!window.OPENTV_DESKTOP; }

/* The channel's name on the preview and, on PC, the line under the video. */
function setLiveInfoText(text) {
  if (liveInfoText) { liveInfoText.textContent = text || ''; }
  syncLiveUnder();
}

function syncLiveUnder() {
  if (!liveUnder) { return; }
  var ch = CHANNELS[state.channel];
  var logo = liveUnder._logo, name = liveUnder._name, meta = liveUnder._meta;
  clear(logo);
  if (!ch) {
    name.textContent = '';
    meta.textContent = '';
    liveUnder.classList.add('is-empty');
    return;
  }
  liveUnder.classList.remove('is-empty');
  if (ch.logo) {
    var img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = ch.logo;
    img.onerror = function () { clear(logo); logo.textContent = String(ch.name || '?').charAt(0).toUpperCase(); };
    logo.appendChild(img);
  } else {
    logo.textContent = String(ch.name || '?').charAt(0).toUpperCase();
  }
  name.textContent = ch.name || '';
  meta.textContent = 'Canal ' + (state.channel + 1) + '  ·  ' + liveChannelGroups(ch).join(', ');
}

/* ------------------------------------------------------------- home live */
function buildLivePage(page) {
  var pcLayout = liveSideLayout();
  if (pcLayout) { page.classList.add('live-3a'); }
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
  if (pcLayout) { liveMain.appendChild(el('span', 'live-badge', 'EN VIVO')); }
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
  if (window.OPENTV_DESKTOP) {
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

  /* PC: one column on the left (search, category chips, channels). */
  var side = page;
  if (pcLayout) {
    side = el('div', 'live-side');
    page.appendChild(side);
  }
  if (window.OPENTV_DESKTOP) {
    side.appendChild(createChannelSearchBox('is-home', 'Buscar canal'));
  }
  /* PC: the category chips above the list (TVs have them under the video). */
  if (pcLayout) {
    liveDockCats = el('div', 'live-dock-cats live-side-cats');
    side.appendChild(liveDockCats);
    liveUnder = el('div', 'live-under');
    liveUnder._logo = el('div', 'live-under-logo');
    var text = el('div', 'live-under-text');
    liveUnder._name = el('div', 'live-under-name');
    liveUnder._meta = el('div', 'live-under-meta');
    text.appendChild(liveUnder._name);
    text.appendChild(liveUnder._meta);
    liveUnder.appendChild(liveUnder._logo);
    liveUnder.appendChild(text);
  }

  liveList = el('div', 'live-list scrollable');
  side.appendChild(liveList);
  if (window.OPENTV_DESKTOP) { bindScrollArrows(liveList, up, down); }
  renderLiveRows(false);
  loadLiveChannels();

  liveFocus = el('div', 'live-focus focusable');
  liveFocus._onMove = function (dir) {
    /* TVs: down goes to the controls under the preview and up to the icons
       at the top (the channel list on the right changes channel). */
    if (platformIsTv() && window.OPENTV_DESKTOP) {
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
    /* Design "3A": the list is on the left of the video. */
    if (dir === (pcLayout ? 'left' : 'right')) {
      var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
      if (row) { setFocus(row); }
      else if (liveRows.length) { setFocus(liveRows[0]); }
      else {
        /* No channels: the "Agregar lista M3U" button of the empty list. */
        var add = liveList && liveList.querySelector('.focusable');
        if (add) { setFocus(add); }
      }
      return true;
    }
    if (dir === 'left' || dir === 'right') {
      if (!pcLayout && tabEls[0]) { setFocus(tabEls[0]); }
      return true;
    }
    return false;
  };
  liveFocus._activate = function () { openPlayer('live'); };
  page.appendChild(liveFocus);
  if (window.OPENTV_DESKTOP) {
    buildLiveDock(page);
    installLivePreviewGestures(liveFocus);
  }
  /* PC: under the video, one line: the channel on the left, the controls
     on the right. */
  if (pcLayout && liveDock) {
    var bar = el('div', 'live-bar3a');
    bar.appendChild(liveUnder);
    bar.appendChild(liveDock);
    page.appendChild(bar);
  }
  syncLiveUnder();
}
