/* live/channels.js — TV en vivo: listas M3U, categorías, carga de canales y vista previa compartida con el reproductor.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* --- Live TV Categories & Addons (M3U / IPTV) --- */
var PRESET_ADDONS = [
  {
    id: 'es_tdt',
    name: 'España - Canales Nacionales y TDT',
    url: 'https://iptv-org.github.io/iptv/countries/es.m3u',
    desc: '320+ canales: La 1, La 2, Antena 3, Telecinco, laSexta, autonómicas'
  },
  {
    id: 'latam_spa',
    name: 'Latinoamérica y Deportes (Hispano)',
    url: 'https://iptv-org.github.io/iptv/languages/spa.m3u',
    desc: 'Canales en español de Colombia, México, Argentina, Chile y Perú'
  },
  {
    id: 'sports_iptv',
    name: 'Deportes Internacionales',
    url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
    desc: 'Transmisiones deportivas y canales de competiciones'
  },
  {
    id: 'movies_iptv',
    name: 'Cine y Series 24/7',
    url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
    desc: 'Cine clásico, cine de acción y canales continuos de series'
  }
];

function getSavedAddons() {
  try {
    var raw = localStorage.getItem('xuper_m3u_addons');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { return parsed; }
    }
  } catch (e) {}
  /* Default seed: España TDT so user has working external addon out of the box */
  var initial = [PRESET_ADDONS[0]];
  try { localStorage.setItem('xuper_m3u_addons', JSON.stringify(initial)); } catch (e2) {}
  return initial;
}

function saveSavedAddons(list) {
  try { localStorage.setItem('xuper_m3u_addons', JSON.stringify(list || [])); } catch (e) {}
}

var liveCategories = [];
var currentLiveCategory = null;
var liveCategoriesLoaded = false;
var liveChannelsLoaded = false;
var liveChannelsLoading = false;
var liveChannelRequestSeq = 0;
var liveChannelLoadColumnId = null;
/* Home only keeps one muted live preview alive.  This warms the channel
   without creating a second full player or playing sound in the menu. */
var livePreviewVideo = null;
var livePreviewStatus = null;
var livePreviewSeq = 0;
var livePreviewTimer = null;
var livePreviewChannel = '';
var dialogAddonsOpen = false;

/* ------------------------------------------------------------------
   Desktop: the home TV preview and the full-screen TV player hand the same
   playing <video> to each other, so "Pantalla completa" and "Volver" do not
   reload the channel (the TV app used two separate players).
     type 'preview': the home preview element is shown inside the player;
     type 'player' : the player element is shown in the home preview.
   ------------------------------------------------------------------ */
var liveHandoff = null;
var livePreviewHls = null;
function liveChannelKey(ch) { return ch ? (ch.channelCode || ch.streamUrl || '') : ''; }

function borrowPreviewIntoPlayer() {
  if (!window.XUPER_DESKTOP || !livePreviewVideo || !playerStage || !liveMain || liveHandoff) { return false; }
  var ch = CHANNELS[state.channel];
  if (!liveMain.classList.contains('is-preview-playing') || !livePreviewChannel ||
      livePreviewChannel !== liveChannelKey(ch) || livePreviewVideo.paused) { return false; }
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
  playerStage.insertBefore(livePreviewVideo, playerVideo.nextSibling);
  livePreviewVideo.classList.add('is-handoff');
  if (playerFrame) { playerFrame.style.display = 'none'; }
  liveHandoff = { type: 'preview', key: livePreviewChannel };
  return true;
}

function returnPreviewHome() {
  if (!liveHandoff || liveHandoff.type !== 'preview') { return; }
  liveHandoff = null;
  livePreviewVideo.classList.remove('is-handoff');
  liveMain.insertBefore(livePreviewVideo, liveMain.firstChild);
}

function playerIsPlayingLive() {
  return state.playerMode === 'live' && playerVideo && !!playerVideo.currentSrc &&
    !playerVideo.paused && playerVideo.readyState >= 2;
}

function borrowPlayerIntoHome() {
  if (!window.XUPER_DESKTOP || !liveMain || liveHandoff || !playerIsPlayingLive()) { return false; }
  stopLivePreview();
  liveMain.insertBefore(playerVideo, liveMain.firstChild);
  playerVideo.classList.add('is-handoff-home');
  playerVideo.muted = liveAudio.muted;
  livePreviewChannel = liveChannelKey(CHANNELS[state.channel]);
  liveMain.classList.remove('is-preview-loading');
  liveMain.classList.add('is-preview-playing');
  liveHandoff = { type: 'player', key: livePreviewChannel };
  return true;
}

/* Puts the player element back on the player stage; stops it unless the
   same channel is about to be shown full screen. */
function returnPlayerToStage(keepPlaying) {
  if (!liveHandoff || liveHandoff.type !== 'player') { return; }
  liveHandoff = null;
  playerVideo.classList.remove('is-handoff-home');
  playerVideo.muted = false;
  var anchor = playerStage.querySelector('.player-frame');
  playerStage.insertBefore(playerVideo, anchor ? anchor.nextSibling : playerStage.firstChild);
  if (liveMain) { liveMain.classList.remove('is-preview-playing'); }
  livePreviewChannel = '';
  if (!keepPlaying) { stopPlayerVideo(); }
}

function stopLivePreview() {
  if (liveHandoff && liveHandoff.type === 'preview') { returnPreviewHome(); }
  if (liveHandoff && liveHandoff.type === 'player') { returnPlayerToStage(false); }
  livePreviewSeq++;
  livePreviewChannel = '';
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); livePreviewTimer = null; }
  if (liveMain) { liveMain.classList.remove('is-preview-playing', 'is-preview-loading'); }
  if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
  if (!livePreviewVideo) { return; }
  if (livePreviewHls) { try { livePreviewHls.destroy(); } catch (eDestroy) { /* ignore */ } livePreviewHls = null; }
  try { livePreviewVideo.pause(); } catch (ePause) { /* ignore */ }
  livePreviewVideo.removeAttribute('src');
  try { livePreviewVideo.src = ''; livePreviewVideo.load(); } catch (eClear) { /* ignore */ }
}

function startLivePreview(ch) {
  if (!livePreviewVideo || !ch || (!ch.channelCode && !ch.streamUrl)) { return; }
  /* A preview belongs only to the TV tab on the home screen. */
  if (state.screen !== 'home' || state.tab !== 0) { return; }
  /* The full-screen player is already showing this channel here. */
  if (liveHandoff && liveHandoff.type === 'player') {
    if (liveHandoff.key === liveChannelKey(ch)) { return; }
    returnPlayerToStage(false);
  }
  var key = ch.channelCode || ch.streamUrl;
  if (key === livePreviewChannel && liveMain &&
      (liveMain.classList.contains('is-preview-loading') || liveMain.classList.contains('is-preview-playing'))) {
    return;
  }
  stopLivePreview();
  livePreviewChannel = key;
  var mySeq = ++livePreviewSeq;
  liveMain.classList.add('is-preview-loading');
  if (livePreviewStatus) { livePreviewStatus.textContent = 'Cargando ' + (ch.name || 'canal') + '…'; }
  var params = ch.streamUrl ? { streamUrl: ch.streamUrl } : { channelCode: ch.channelCode };
  portalServiceCall('resolveLive', params, function (err, payload) {
    if (mySeq !== livePreviewSeq || state.screen !== 'home' || state.tab !== 0) { return; }
    if (!err && payload) { rememberCdnProbe('live', payload); }
    var url = !err && payload && payload.returnValue !== false && (payload.proxyPath || payload.url);
    if (!url) {
      liveMain.classList.remove('is-preview-loading');
      if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
      return;
    }
    livePreviewVideo.onloadeddata = function () {
      if (mySeq !== livePreviewSeq) { return; }
      liveMain.classList.remove('is-preview-loading');
      liveMain.classList.add('is-preview-playing');
      if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    };
    livePreviewVideo.onerror = function () {
      if (mySeq !== livePreviewSeq) { return; }
      liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
      if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
    };
    /* Desktop: play HLS with hls.js, like the full-screen player. Chromium's
       own HLS support rejects some channels (ECDF: error 4). */
    if (window.XUPER_DESKTOP && window.Hls && window.Hls.isSupported() && /\.m3u8(?:\?|$)/i.test(url)) {
      try {
        var hls = new window.Hls({ enableWorker: true, maxBufferLength: 20, backBufferLength: 10 });
        livePreviewHls = hls;
        hls.on(window.Hls.Events.MEDIA_ATTACHED, function () { hls.loadSource(url); });
        hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
          if (mySeq !== livePreviewSeq) { return; }
          var pp = livePreviewVideo.play();
          if (pp && pp.catch) { pp.catch(function () {}); }
        });
        hls.on(window.Hls.Events.ERROR, function (_, data) {
          if (!data || !data.fatal || mySeq !== livePreviewSeq) { return; }
          liveMain.classList.remove('is-preview-loading', 'is-preview-playing');
          if (livePreviewStatus) { livePreviewStatus.textContent = ''; }
        });
        hls.attachMedia(livePreviewVideo);
        return;
      } catch (eHls) { livePreviewHls = null; /* fall back to the native player */ }
    }
    try {
      livePreviewVideo.src = url;
      livePreviewVideo.load();
      var promise = livePreviewVideo.play();
      if (promise && promise.catch) { promise.catch(function () {}); }
    } catch (ePlay) { liveMain.classList.remove('is-preview-loading'); }
  });
}

function scheduleLivePreview(ch) {
  if (livePreviewTimer) { clearTimeout(livePreviewTimer); }
  livePreviewTimer = setTimeout(function () {
    livePreviewTimer = null;
    startLivePreview(ch || CHANNELS[state.channel]);
  }, 220);
}

function loadLiveCategories(done) {
  if (liveCategoriesLoaded && liveCategories.length) {
    if (done) { done(null, liveCategories); }
    return;
  }
  portalServiceCall('liveCategories', {}, function (err, payload) {
    var cats = [];
    if (payload && payload.categories && payload.categories.length) {
      for (var i = 0; i < payload.categories.length; i++) {
        var c = payload.categories[i];
        var nm = c.name;
        if (nm === 'ChannelList' || c.id === 76182) { nm = 'Todos'; }
        cats.push({ id: c.id, name: nm, code: c.code, isAddon: false });
      }
    } else {
      /* Fallback categories if portal takes time */
      cats = [
        { id: 76182, name: 'Todos' },
        { id: 76206, name: 'Deportes' },
        { id: 76205, name: 'Cine y Series' },
        { id: 76188, name: 'Colombia' },
        { id: 76191, name: 'España' },
        { id: 76197, name: 'México' }
      ];
    }
    /* Append Addons Category */
    cats.push({ id: 'addons', name: '➕ Addons M3U', isAddon: true });
    liveCategories = cats;
    liveCategoriesLoaded = true;
    if (!currentLiveCategory) { currentLiveCategory = liveCategories[0]; }
    renderPlayerCategories();
    renderLiveDockCats();
    if (done) { done(null, liveCategories); }
  });
}

function switchLiveCategory(cat, done) {
  if (!cat) { return; }
  currentLiveCategory = cat;
  renderPlayerCategories();
  if (cat.isAddon) {
    loadAddonChannels(function () {
      if (done) { done(); }
    });
  } else {
    loadLiveChannels(cat.id, function () {
      if (done) { done(); }
    });
  }
}

function loadAddonChannels(done) {
  var addons = getSavedAddons();
  if (!addons || !addons.length) {
    CHANNELS.splice(0, CHANNELS.length);
    state.channel = 0;
    liveChannelsLoaded = true;
    renderLiveRows(false);
    renderPlayerChannels();
    if (liveInfoText) { liveInfoText.textContent = 'Sin addons instalados'; }
    if (done) { done(); }
    return;
  }
  setPlayerStatus('Cargando canales de Addon…');
  var allChannels = [];
  var pending = addons.length;
  for (var a = 0; a < addons.length; a++) {
    (function (ad) {
      portalServiceCall('fetchM3u', { url: ad.url }, function (err, payload) {
        if (payload && payload.channels && payload.channels.length) {
          for (var c = 0; c < payload.channels.length; c++) {
            allChannels.push(payload.channels[c]);
          }
        }
        pending--;
        if (pending <= 0) {
          setPlayerStatus('');
          CHANNELS.splice(0, CHANNELS.length);
          for (var k = 0; k < allChannels.length; k++) {
            allChannels[k].index = k + 1;
            CHANNELS.push(allChannels[k]);
          }
          state.channel = 0;
          renderLiveRows(false);
          renderPlayerChannels();
          if (CHANNELS[0] && liveInfoText) {
            liveInfoText.textContent = CHANNELS[0].name;
          }
          if (state.screen === 'player' && state.playerMode === 'live') {
            updatePlayer();
            startLiveChannel(CHANNELS[0], true);
          }
          if (done) { done(); }
        }
      });
    })(addons[a]);
  }
}

function loadLiveChannels(columnId, done) {
  var requestedColumnId = columnId || 76182;
  /* buildLivePage and the initial boot can both ask for Todos.  Keep the
     existing request instead of clearing the first page while it streams. */
  if (liveChannelsLoading && liveChannelLoadColumnId === requestedColumnId) { return; }
  var requestSeq = ++liveChannelRequestSeq;
  liveChannelLoadColumnId = requestedColumnId;
  liveChannelsLoading = true;
  liveChannelsLoaded = false;
  CHANNELS.splice(0, CHANNELS.length);
  state.channel = 0;
  renderLiveRows(false);
  renderPlayerChannels();

  var pageNum = 1;
  var didReturnFirstPage = false;
  function fetchNextPage() {
    portalServiceCall('liveChannels', {
      columnId: requestedColumnId,
      pageNum: pageNum,
      pageSize: 20
    }, function (err, payload) {
      /* A category was selected while this page was in flight. */
      if (requestSeq !== liveChannelRequestSeq) { return; }
      var pageChannels = payload && payload.channels ? payload.channels : [];
      if (!err && pageChannels.length) {
        var known = {};
        for (var k = 0; k < CHANNELS.length; k++) {
          if (CHANNELS[k] && CHANNELS[k].channelCode) {
            known[CHANNELS[k].channelCode] = true;
          }
        }
        for (var c = 0; c < pageChannels.length; c++) {
          var channel = pageChannels[c];
          if (channel && (!channel.channelCode || !known[channel.channelCode])) {
            if (channel.channelCode) { known[channel.channelCode] = true; }
            channel.fav = !!state.favs['live:' + (channel.channelCode || channel.id || channel.name)];
            CHANNELS.push(channel);
          }
        }
        liveChannelsLoaded = true;
        var firstPage = pageNum === 1;
        if (window.XUPER_DESKTOP && !firstPage) {
          /* Later pages: redraw the list in batches instead of on every page
             (it flickered and kept restarting the preview for ~15 s). */
          scheduleLiveRowsRender(payload && payload.hasMore);
          if (!(payload && payload.hasMore)) { liveChannelsLoading = false; }
          if (payload && payload.hasMore) { pageNum++; setTimeout(fetchNextPage, 25); }
          return;
        }
        renderLiveRows(false);
        renderPlayerChannels();
        if (state.channel >= CHANNELS.length) { state.channel = 0; }
        if (CHANNELS[state.channel] && liveInfoText) {
          liveInfoText.textContent = CHANNELS[state.channel].name;
        }
        syncLiveFavButton();
        if (state.screen === 'player' && state.playerMode === 'live') {
          updatePlayer();
        } else {
          scheduleLivePreview(CHANNELS[state.channel]);
        }
      }

      if (!didReturnFirstPage) {
        didReturnFirstPage = true;
        if (!liveCategoriesLoaded) { loadLiveCategories(); }
        if (done) { done(err, payload); }
      }

      if (!err && payload && payload.hasMore && pageChannels.length) {
        pageNum++;
        /* Yield to webOS between pages so navigating the first block stays
           responsive while the rest of the catalogue arrives. */
        setTimeout(fetchNextPage, 25);
        return;
      }

      liveChannelsLoading = false;
      if (err && !liveChannelsLoaded) {
        setTimeout(function () {
          if (requestSeq === liveChannelRequestSeq) { loadLiveChannels(requestedColumnId); }
        }, 2500);
      }
    });
  }
  fetchNextPage();
}

var liveRowsRenderTimer = null;
var liveRowsRenderedAt = 0;
function scheduleLiveRowsRender(more) {
  /* While pages keep arriving, redraw only if the viewer is near the end of
     the list and needs more rows; otherwise once, when all have arrived. */
  var nearEnd = liveList && liveList.scrollHeight - liveList.scrollTop - liveList.clientHeight < 400;
  if (more && !nearEnd) { return; }
  var wait = more ? Math.max(0, 2500 - (Date.now() - liveRowsRenderedAt)) : 0;
  if (liveRowsRenderTimer) { if (more) { return; } clearTimeout(liveRowsRenderTimer); }
  liveRowsRenderTimer = setTimeout(function () {
    liveRowsRenderTimer = null;
    renderLiveRows(false);
    renderPlayerChannels();
  }, wait);
}

function renderLiveRows(favOnly) {
  if (!liveList) { return; }
  liveRowsRenderedAt = Date.now();
  var keepScroll = window.XUPER_DESKTOP ? liveList.scrollTop : 0;
  clear(liveList);
  if (keepScroll) { setTimeout(function () { liveList.scrollTop = keepScroll; }, 0); }
  liveRows = [];
  if (!CHANNELS.length) {
    liveList.appendChild(el('div', 'live-list-status',
      liveChannelsLoaded ? 'No se encontraron canales' : 'Cargando canales…'));
    return;
  }
  for (var i = 0; i < CHANNELS.length; i++) {
    if (favOnly && !CHANNELS[i].fav) { continue; }
    var row = el('div', 'live-row focusable');
    row._channel = i;
    var icon = el('div', 'row-icon');
    if (CHANNELS[i].logo) {
      icon.style.backgroundImage = 'url(' + CHANNELS[i].logo + ')';
      icon.style.backgroundSize = 'contain';
      icon.style.backgroundRepeat = 'no-repeat';
      icon.style.backgroundPosition = 'center';
    }
    var play = el('div', 'row-play');
    var name = el('div', 'row-name', CHANNELS[i].name);
    row.appendChild(icon);
    row.appendChild(play);
    row.appendChild(name);
    if (i === state.channel) { row.classList.add('is-current'); }
    row._activate = (function (idx) {
      return function () {
        if (window.XUPER_DESKTOP) {
          /* Desktop: a click only switches the home preview. Enter on the
             channel already playing (keyboard) opens it big. */
          if (idx === state.channel) { if (focusRingVisible) { openPlayer('live'); } return; }
          setChannel(idx, true);
          return;
        }
        setChannel(idx, true); openPlayer('live');
      };
    })(i);
    if (window.XUPER_DESKTOP) {
      (function (idx, r) {
        r.addEventListener('dblclick', function () { setChannel(idx, true); openPlayer('live'); });
        var open = el('button', 'row-open');
        open.type = 'button';
        open.innerHTML = UI_ICONS.fullscreen;
        open.setAttribute('data-tip', 'Ver en pantalla grande');
        open.setAttribute('aria-label', 'Ver ' + (CHANNELS[idx].name || 'canal') + ' en pantalla grande');
        open.addEventListener('click', function (event) {
          event.stopPropagation();
          setChannel(idx, true);
          openPlayer('live');
        });
        r.appendChild(open);
        r.setAttribute('data-tip', 'Clic: ver aquí · Doble clic: pantalla grande');
      })(i, row);
    }
    row._onMove = (function (rowIdx) {
      return function (dir) {
        if (dir === 'left') {
          if (liveFocus) { setFocus(liveFocus); }
          else if (tabEls[0]) { setFocus(tabEls[0]); }
          return true;
        }
        if (dir === 'up') {
          if (rowIdx > 0 && liveRows[rowIdx - 1]) {
            setFocus(liveRows[rowIdx - 1]);
          }
          return true;
        }
        if (dir === 'down') {
          if (rowIdx < liveRows.length - 1 && liveRows[rowIdx + 1]) {
            setFocus(liveRows[rowIdx + 1]);
          }
          return true;
        }
        return false;
      };
    })(liveRows.length);
    liveList.appendChild(row);
    liveRows.push(row);
  }
  if (CHANNELS[state.channel] && liveInfoText) {
    liveInfoText.textContent = CHANNELS[state.channel].name;
  }
  scrollLiveList();
}

function scrollLiveList() {
  if (!liveRows.length) { return; }
  var visible = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
  if (!visible) { return; }
  var idx = liveRows.indexOf(visible);
  var top = idx * 120;
  var max = Math.max(0, liveList.scrollHeight - liveList.clientHeight);
  var target = liveList.scrollTop;
  if (top < target) { target = top; }
  if (top + 100.5 > target + liveList.clientHeight) {
    target = top + 100.5 - liveList.clientHeight;
  }
  liveList.scrollTop = Math.max(0, Math.min(max, target));
}

function setChannel(index, immediate) {
  if (index < 0) { index = 0; }
  if (index > CHANNELS.length - 1) { index = CHANNELS.length - 1; }
  state.channel = index;
  for (var i = 0; i < liveRows.length; i++) {
    liveRows[i].classList.toggle('is-current', liveRows[i]._channel === index);
  }
  if (CHANNELS[index] && liveInfoText) {
    liveInfoText.textContent = CHANNELS[index].name;
  }
  scrollLiveList();
  syncLiveFavButton();
  if (state.screen === 'player') {
    updatePlayerChannel();
    if (state.playerMode === 'live') {
      startLiveChannel(CHANNELS[index], !!immediate);
    }
  } else if (state.screen === 'home' && state.tab === 0) {
    scheduleLivePreview(CHANNELS[index]);
  }
}
