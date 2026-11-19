/* player/live.js — Reproductor en vivo: cambio de canal, info del canal y regreso a la pantalla anterior.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

var liveChannelSeq = 0;
var liveChannelDebounceTimer = null;
function startLiveChannel(ch, immediate) {
  /* A new channel (or Reintentar) plays in the player's own element. */
  if (liveHandoff && liveHandoff.type === 'preview') { stopLivePreview(); }
  if (liveChannelDebounceTimer) {
    clearTimeout(liveChannelDebounceTimer);
    liveChannelDebounceTimer = null;
  }
  if (!ch) { ch = CHANNELS[state.channel]; }
  if (!ch) {
    /* No channels (no lists yet, or none could be read): say why. */
    if (state.screen === 'player' && state.playerMode === 'live') { setPlayerStatus(liveEmptyMessage()); }
    return;
  }
  if (!ch.streamUrl) {
    state.streamError = 'Señal no disponible';
    setPlayerStatus(state.streamError);
    return;
  }
  noteLivePlaying(ch);

  var doStart = function () {
    ++liveChannelSeq;
    /* The viewer left the player while the channel was waiting to start (TV
       and desktop): starting it now would play it hidden, with sound. */
    if (state.screen !== 'player' || state.playerMode !== 'live') { return; }
    setPlayerStatus('');
    showInfobar();
    /* (A title's still from the details screen does not belong to a channel.) */
    if (playerVideo) { playerVideo.removeAttribute('poster'); }
    /* An M3U channel plays its own link (no service round trip). */
    playUrl(ch.streamUrl);
  };

  if (immediate) {
    doStart();
  } else {
    liveChannelDebounceTimer = setTimeout(doStart, 180);
  }
}

function updatePlayerChannel() {
  if (!playerStage) { return; }
  updatePlayer();
}

function updatePlayer() {
  var live = state.playerMode === 'live';
  var ch = CHANNELS[state.channel] || {};
  var idx = playerInfo.querySelector('.pi-index');
  var name = playerInfo.querySelector('.pi-name');
  var date = playerInfo.querySelector('.pi-date');
  var range = playerInfo.querySelector('.pi-range');
  var now = playerInfo.querySelector('.pi-now');
  var next = playerInfo.querySelector('.pi-next');
  var uhd = playerInfo.querySelector('.pi-uhd');
  var logo = playerInfo.querySelector('.pi-logo');

  if (live) {
    var actionButtons = playerInfo.querySelectorAll('.pi-act');
    for (var ab = 0; ab < actionButtons.length; ab++) {
      if (actionButtons[ab]._kind === 'Favorito') {
        actionButtons[ab].classList.toggle('is-selected', !!ch.fav);
        setButtonText(actionButtons[ab], ch.fav ? (actionButtons[ab]._iconized ? 'Quitar de favoritos' : 'En favoritos')
          : (actionButtons[ab]._iconized ? 'Añadir a favoritos' : 'Favorito'));
      }
    }
    if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
    if (playerInfo) { playerInfo.style.display = ''; }
    idx.style.display = 'block';
    idx.textContent = pad2(ch.index || (state.channel + 1));
    name.textContent = ch.name || '';
    var piSub = playerInfo.querySelector('.pi-sub');
    if (piSub) { piSub.textContent = 'Canal ' + (ch.index || (state.channel + 1)) + '  ·  ' + liveChannelGroups(ch).join(', '); }
    var piTop = playerInfo.querySelector('.pi-top-title');
    if (piTop) { piTop.textContent = ch.name || ''; }
    nameRowPosition();
    /* "Hoy" only makes sense next to a programme time. */
    date.textContent = ch.time ? 'Hoy' : '';
    range.textContent = ch.time || '';
    now.style.display = 'block';
    now.textContent = ch.now || 'En vivo';
    next.style.display = ch.next ? 'block' : 'none';
    if (ch.next) { next.textContent = 'Siguiente: ' + ch.next; }
    uhd.style.display = ch.uhd ? 'block' : 'none';
    logo.style.display = 'block';
    if (logo) {
      if (ch.logo) {
        logo.style.backgroundImage = 'url(' + ch.logo + ')';
      } else {
        logo.style.backgroundImage = '';
      }
    }
  } else {
    if (playerInfo) { playerInfo.classList.remove('is-active'); playerInfo.style.display = 'none'; }
    var item = state.playerItem || VOD[0];
    if (vodInfobarTitle) {
      if (isSeriesItem(item) && state.playerEpisode) {
        var epTitle = state.playerEpisode.title || state.playerEpisode.name;
        var epNum = state.playerEpisode.number || state.playerEpisode.seriesNumber;
        var epLabel = epTitle || (epNum ? ('Capítulo ' + epNum) : '');
        if (window.OPENTV_DESKTOP) {
          /* "Serie  E3 · Nombre", without repeating the series name. */
          var named = epTitle && norm(epTitle).indexOf(norm(item.title)) === -1 && !/^(episodio|capítulo|cap\.?)\s*\d+$/i.test(epTitle) ? ' · ' + epTitle : '';
          vodInfobarTitle.textContent = item.title + (epNum ? '  E' + epNum : '') + named;
        } else {
          vodInfobarTitle.textContent = epLabel ? (item.title + ' - ' + epLabel) : item.title;
        }
      } else {
        vodInfobarTitle.textContent = item.title;
      }
    }
    if (vodInfobarPoster) {
      vodInfobarPoster.src = item.poster || item.cover || 'assets/original/common/bg_placehoder_vertical.png';
    }
    updateVodProgress(playerVideo ? playerVideo.currentTime : 0, playerVideo ? playerVideo.duration : 0);
  }
  for (var rowIndex in playerChannelRows) {
    if (playerChannelRows.hasOwnProperty(rowIndex)) {
      playerChannelRows[rowIndex].classList.toggle('is-current', playerChannelRows[rowIndex]._channel === state.channel);
    }
  }
  layoutInfoTexts();
}

function nameRowPosition() {
  var row = playerInfo.querySelector('.pi-namerow');
  if (!row) { return; }
  var idx = playerInfo.querySelector('.pi-index');
  var nm = row.querySelector('.pi-name');
  var uhd = row.querySelector('.pi-uhd');
  /* Keep a fixed lane for the channel number.  Measuring an auto-width
     number while Starfish is animating the infobar returns inconsistent
     values and can place the name on top of it. */
  var base = 165;

  row.style.position = 'absolute';
  row.style.left = (367.5 + base) + 'px';
  row.style.top = '13.5px';
  row.style.width = '480px';
  row.style.height = '58px';
  row.style.display = 'block';

  nm.style.position = 'absolute';
  nm.style.left = '0px';
  nm.style.top = '8px';                       /* alignBottom with mTextChannelIndex */
  nm.style.width = '480px';
  nm.style.height = '50px';
  nm.style.lineHeight = '50px';

  if (uhd) {
    uhd.style.left = (nm.offsetWidth + 30) + 'px';   /* 20dp */
    uhd.style.top = '18.5px';                        /* alignTop name + 7dp */
  }
}

function layoutInfoTexts() {
  var q = playerInfo.querySelector('.pi-quality');
  var s = playerInfo.querySelector('.pi-scale');
  var f = playerInfo.querySelector('.pi-func');
  if (!q || !s || !f) { return; }
  q.style.left = '517.5px';                   /* 345dp */
  s.style.left = (q.offsetLeft + q.offsetWidth + 30) + 'px';   /* 20dp */
  f.style.left = (s.offsetLeft + s.offsetWidth + 30) + 'px';   /* 20dp */
}

function openChannelPanel() {
  if (state.playerMode !== 'live') { return; }
  state.channelsOpen = true;
  playerChannels.classList.add('is-active');
  renderPlayerCategories();
  renderPlayerChannels(state.channel);
  /* Bring the active category into view: with dozens of categories the
     rail is very wide and the selected pill is usually off-screen. */
  scrollSelectedCategoryPill();
  var row = playerChannelRows[state.channel];
  if (row) {
    setFocus(row);
    var list = row.parentNode;
    var top = state.channel * 111;
    if (top < list.scrollTop || top + 109.5 > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - 120);
    }
  }
}

function closeChannelPanel() {
  state.channelsOpen = false;
  playerChannels.classList.remove('is-active');
  if (state.screen === 'player') { setFocus(playerStage); }
}

function restorePlayerReturn() {
  hideInfobar();
  hideVodInfobar();
  var ret = state.playerReturn;
  if (ret && ret.screen === 'detail') {
    var scrPlayer = $('screen-player');
    var scrDetail = $('screen-detail');
    if (scrPlayer && detailShowsArt()) {
      /* PC and TVs: back on the details screen the video stops (no small
         player there, only the title's picture). */
      stopPlayerVideo();
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.remove('is-active');
    } else if (scrPlayer) {
      scrPlayer.classList.add('is-mini');
      scrPlayer.classList.add('is-active');
    }
    if (scrDetail) {
      scrDetail.classList.add('is-active');
    }
    state.screen = 'detail';
    var rebuiltDetail = false;
    if (state.detailNeedsRebuild && state.detail) {
      /* The episode browser switched season: rebuild the detail list so the
         season dropdown and the episode grid match what is playing. */
      state.detailNeedsRebuild = false;
      buildDetail(state.detail);
      rebuiltDetail = true;
      var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
      if (sBtn) { setFocus(sBtn); }
    } else if (state.detail) {
      syncDetailEpisodeHighlight(state.detail);
      /* The progress saved while watching changes the main button
         ("Reanudar · 25:10"). */
      rebuiltDetail = refreshDetailResume(state.detail);
    }
    if (!rebuiltDetail) {
      if (ret.focus && isVisible(ret.focus)) {
        setFocus(ret.focus);
      } else {
        var firstBtn = detailButtons ? detailButtons.querySelector('.focusable') : null;
        if (firstBtn) { setFocus(firstBtn); }
      }
    }
  } else {
    /* Desktop: a TV channel goes on playing in the home preview. */
    var toHome = !(ret && ret.screen === 'search');
    var handed = window.OPENTV_DESKTOP && toHome && borrowPlayerIntoHome();
    if (!handed && !keepFloatingVideo()) {
      /* Also cancel a channel that is still resolving or waiting to start. */
      liveChannelSeq++;
      if (liveChannelDebounceTimer) { clearTimeout(liveChannelDebounceTimer); liveChannelDebounceTimer = null; }
      stopPlayerVideo();
    }  /* PiP keeps playing while browsing */
    var scrP = $('screen-player');
    if (scrP) {
      scrP.classList.remove('is-mini');
      scrP.classList.remove('is-active');
    }
    if (ret && ret.screen === 'search') {
      showScreen('search');
      setFocus(ret.focus);
    } else {
      showScreen('home');
      selectTab(state.tab, false);
      if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
      else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    }
  }
}
