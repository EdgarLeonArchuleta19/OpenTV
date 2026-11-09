/* player/build.js — Construcción del reproductor, selector de categorías y panel de canales.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function buildPlayer() {
  playerStage = $('player-stage');
  playerInfo = $('player-infobar');
  playerVodInfo = $('player-vod-infobar');
  playerChannels = $('player-channels');
  categoryPicker = $('player-categories');
  pcatGrid = $('pcat-grid');
  pcatSub = $('pcat-sub');
  playerVideo = $('player-video');
  playerStatus = $('player-status');
  nextEpisodeLoading = $('next-episode-loading');
  playerOsdIcon = $('player-osd-icon');
  playerFrame = playerStage ? playerStage.querySelector('.player-frame') : null;

  vodInfobarPoster = $('vod-infobar-poster');
  vodInfobarTitle = $('vod-infobar-title');
  vodTimeCurrent = $('vod-time-current');
  vodTimeTotal = $('vod-time-total');
  vodSeekbar = $('vod-seekbar');
  vodSeekProgress = $('vod-seek-progress');
  vodSeekBuffered = $('vod-seek-buffered');
  vodSeekThumb = $('vod-seek-thumb');

  if (vodSeekbar) {
    vodSeekbar.classList.add('focusable');
    vodSeekbar._activate = function () { leaveVodScrub(true); };
    vodSeekbar._onMove = function (dir) {
      if (dir === 'left') { moveVodScrub(-1); return true; }
      if (dir === 'right') { moveVodScrub(1); return true; }
      if (dir === 'down' || dir === 'up') { leaveVodScrub(false); return true; }
      return false;
    };
  }

  /* PlaySettingView elements */
  playSettingView = $('player-playsetting-view');
  psvSecSelection = $('psv-sec-selection');
  psvEpisodesRow = $('psv-episodes-row');
  psvBtnEpisodes = $('psv-btn-episodes');
  psvBtnConfig = $('psv-btn-config');
  psvBtnP1 = $('psv-btn-p1');
  psvBtnP2 = $('psv-btn-p2');
  psvSecAudio = $('psv-sec-audio');
  psvSecQuality = $('psv-sec-quality');
  psvQualityRow = $('psv-quality-row');
  psvSecAspect = $('psv-sec-aspect');
  psvSecPlayer = $('psv-sec-player');
  psvBtnFeedback = $('psv-btn-feedback');
  psvAspectRow = $('psv-aspect-row');

  /* Season/episode browser */
  episodeBrowser = $('player-episodes');
  peTitle = $('pe-title');
  peSub = $('pe-sub');
  peSeasons = $('pe-seasons');
  peSeasonsCol = $('pe-seasons-col');
  peEpisodes = $('pe-episodes');
  peSeasonLabel = $('pe-season-label');

  if (psvBtnEpisodes) {
    psvBtnEpisodes._activate = function () { openEpisodeBrowser(); };
  }

  if (psvBtnFeedback) {
    if (window.XUPER_DESKTOP) psvBtnFeedback.textContent = 'Diagnóstico';
    psvBtnFeedback._activate = openDesktopDiagnostic;
  }

  if (psvBtnConfig) {
    psvBtnConfig._activate = function () {
      openPlaySettingsDialog();
    };
  }
  if (psvBtnP1) {
    psvBtnP1._activate = function () {
      /* Explicit user action must always recreate the source.  Never use
         the visual selection or a stale URL as a reason to skip it. */
      setSmoothMode(playSettingsItem(), true);
      renderPlaySettingPlayerOptions();
      schedulePlaySettingHide();
      restartCurrentPlayback();
    };
  }
  if (psvBtnP2) {
    psvBtnP2._activate = function () {
      setSmoothMode(playSettingsItem(), false);
      renderPlaySettingPlayerOptions();
      schedulePlaySettingHide();
      restartCurrentPlayback();
    };
  }
  if (psvAspectRow) {
    var aBtns = psvAspectRow.querySelectorAll('.psv-btn');
    for (var ai = 0; ai < aBtns.length; ai++) {
      (function (b) {
        b._activate = function () {
          var asp = b.getAttribute('data-aspect');
          setPlayerAspect(asp);
        };
      })(aBtns[ai]);
    }
  }

  /* Modal Dialog elements */
  dialogPlaySettings = $('dialog-playsettings');
  dpsAudioOptions = $('dps-audio-options');
  dpsSubSwitch = $('dps-sub-switch');
  dpsRowLang = $('dps-row-lang');
  dpsRowSize = $('dps-row-size');
  dpsRowStyle = $('dps-row-style');
  dpsLangOptions = $('dps-lang-options');
  dpsSizeOptions = $('dps-size-options');
  dpsStyleOptions = $('dps-style-options');
  dpsBtnExit = $('dps-btn-exit');
  playerSubtitles = $('player-subtitles');

  if (dpsSubSwitch) {
    dpsSubSwitch._activate = function () {
      vodSubChosen = true;
      vodSubActive = !vodSubActive;
      if (!vodSubActive) {
        loadSubtitleTrack(null);
      } else {
        var info = mediaInfoCache[mediaInfoKey(playSettingsItem())];
        var subs = subtitleLanguageList(info);
        if (!vodCurrentSubtitle && subs.length) {
          vodCurrentSubtitle = subs[0];
        }
        if (vodCurrentSubtitle) {
          loadSubtitleTrack(vodCurrentSubtitle);
        }
      }
      renderDialogSubtitle();
      schedulePlaySettingHide();
    };
  }

  if (dpsSizeOptions) {
    var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
    for (var si = 0; si < sBtns.length; si++) {
      (function (b) {
        b._activate = function () {
          vodSubSize = b.getAttribute('data-size') || 'normal';
          applySubtitleStyles();
          renderDialogSubtitle();
        };
      })(sBtns[si]);
    }
  }

  if (dpsStyleOptions) {
    var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
    for (var sti = 0; sti < stBtns.length; sti++) {
      (function (b) {
        b._activate = function () {
          vodSubStyle = b.getAttribute('data-style') || 'white';
          applySubtitleStyles();
          renderDialogSubtitle();
        };
      })(stBtns[sti]);
    }
  }

  if (dpsBtnExit) {
    dpsBtnExit._activate = function () {
      closePlaySettingsDialog();
    };
  }

  applySubtitleStyles();
  applyGlobalPlaybackPreferences();

  clear(playerInfo); clear(playerChannels);

  playerStage.classList.add('focusable');
  playerStage._onMove = function (dir) {
    if (state.playerMode === 'vod') {
      if (dir === 'left') { playerSeek(-10); return true; }
      if (dir === 'right') { playerSeek(10); return true; }
      if (dir === 'down') {
        openPlaySettingView();
        return true;
      }
      if (dir === 'up') {
        enterVodScrub();
        return true;
      }
      return false;
    }
    if (dir === 'left') { openChannelPanel(); return true; }
    if (dir === 'right') { closeChannelPanel(); return true; }
    if (dir === 'up') { setChannel(state.channel - 1); return true; }
    if (dir === 'down') { setChannel(state.channel + 1); return true; }
    return false;
  };
  playerStage._activate = function () {
    if (window.XUPER_DESKTOP && state.screen === 'detail') {
      expandToFullscreen(state.detail, state.detailEpisode);
      return;
    }
    if (state.playerMode === 'vod') {
      togglePlayerPlayPause();
      return;
    }
    if (state.infobar) { hideInfobar(); }
    else { showInfobar(); }
  };

  if (window.XUPER_DESKTOP) bindDesktopPlayback();

  /* --- infobar (layout_live_infobar, 160dp = 240px) --- */
  playerInfo.appendChild(el('div', 'pi-logo'));
  playerInfo.appendChild(el('div', 'pi-index'));
  var nameRow = el('div', 'pi-namerow');
  var nm = el('div', 'pi-name');
  nameRow.appendChild(nm);
  var uhd = el('div', 'pi-uhd');
  uhd.style.left = '20px';
  nameRow.appendChild(uhd);
  playerInfo.appendChild(nameRow);
  playerInfo.appendChild(el('div', 'pi-date'));
  playerInfo.appendChild(el('div', 'pi-range'));
  playerInfo.appendChild(el('div', 'pi-now'));
  playerInfo.appendChild(el('div', 'pi-next'));
  var seek = el('div', 'pi-seek');
  seek.appendChild(el('div', 'bar'));
  playerInfo.appendChild(seek);
  playerInfo.appendChild(el('div', 'pi-menu', 'info'));
  playerInfo.appendChild(el('div', 'pi-quality', 'HD'));
  playerInfo.appendChild(el('div', 'pi-scale', 'Normal'));
  playerInfo.appendChild(el('div', 'pi-func', 'Selecion de función'));

  var actions = el('div', 'pi-actions');
  var actDefs = [
    { label: 'Pip', right: 446, w: 67, hidden: true },
    { label: 'HD', right: 389, w: 67 },
    { label: 'Anterior', right: 333, w: 67 },
    { label: 'Formato', right: 249, w: 120 },
    { label: 'Favorito', right: 219, w: 67 },
    { label: 'Reproductor 1', right: 151, w: 90 },
    { label: 'Bloquear', right: 107, w: 67 },
    { label: 'Feedback', right: 50, w: 67 }
  ];
  if (window.XUPER_DESKTOP) actDefs.push({ label: 'Canales', right: 0, w: 90 });
  if (window.XUPER_DESKTOP && document.pictureInPictureEnabled) actDefs.push({ label: 'Ventana flotante', right: 0, w: 120 });
  for (var i = 0; i < actDefs.length; i++) {
    var d = actDefs[i];
    if (d.hidden) { continue; }
    var b = el('div', 'pi-act focusable', d.label);
    b.style.width = (d.w * 1.5) + 'px';
    b.style.left = (1920 - d.right * 1.5 - d.w * 1.5) + 'px';
    b._kind = d.label;
    if (window.XUPER_DESKTOP) {
      if (d.label === 'HD' || d.label === 'Bloquear') {
        b.setAttribute('aria-disabled', 'true');
        b.title = d.label === 'HD' ? 'La calidad de esta señal es automática' : 'Bloqueo por PIN no disponible';
      }
      if (d.label === 'Reproductor 1') b.textContent = 'Reintentar';
      if (d.label === 'Feedback') b.textContent = 'Diagnóstico';
    }
    b._activate = (function (label) {
      return function () {
        if (label === 'Anterior') { setChannel(state.channel - 1); }
        else if (label === 'Formato') {
          var sc = playerInfo.querySelector('.pi-scale');
          sc.textContent = sc.textContent === 'Normal' ? '16:9' : (sc.textContent === '16:9' ? '4:3' : 'Normal');
          if (window.XUPER_DESKTOP) setPlayerAspect(sc.textContent === 'Normal' ? 'contain' : (sc.textContent === '16:9' ? '16-9' : '4-3'));
          layoutInfoTexts();
        } else if (label === 'Favorito') {
          var ch = CHANNELS[state.channel];
          if (ch) {
            ch.fav = toggleFavorite({ id: 'live:' + (ch.channelCode || ch.id || ch.name) });
            this.classList.toggle('is-selected', ch.fav);
            this.textContent = ch.fav ? 'En favoritos' : 'Favorito';
          }
        } else if (label === 'Canales') { openChannelPanel(); }
        else if (label === 'Ventana flotante') { togglePictureInPicture(); }
        else if (label === 'Feedback') { openDesktopDiagnostic(); }
        else if (label === 'Reproductor 1') { startLiveChannel(CHANNELS[state.channel], true); }
      };
    })(d.label);
    actions.appendChild(b);
  }
  playerInfo.appendChild(actions);

  /* --- channel panel (frag_live_channel) with category bar and addons --- */
  var pcHeader = el('div', 'pc-header');
  pcHeader.appendChild(el('div', 'pc-title', 'Canales de TV'));
  playerChannels.appendChild(pcHeader);

  var pcCategories = el('div', 'pc-categories scrollable');
  pcCategories.id = 'pc-categories';
  playerChannels.appendChild(pcCategories);

  playerChannels.appendChild(el('div', 'pc-div'));
  var list = el('div', 'pc-list scrollable');
  playerChannels.appendChild(list);
  renderPlayerCategories();
  renderPlayerChannels();

  var menu = el('div', 'pc-menu');
  menu.appendChild(el('div', 'ic'));
  menu.appendChild(el('div', 'l1', 'Presione [OK] para reproducir'));
  menu.appendChild(el('div', 'l2', '(Arriba: Categorías · OK: Filtrar)'));
  playerChannels.appendChild(menu);
}

function renderPlayerCategories() {
  if (!playerChannels) { return; }
  var bar = playerChannels.querySelector('.pc-categories');
  if (!bar) { return; }
  var cats = liveCategories && liveCategories.length ? liveCategories : [
    { id: 76182, name: 'Todos' },
    { id: 76206, name: 'Deportes' },
    { id: 76205, name: 'Cine y Series' },
    { id: 76188, name: 'Colombia' },
    { id: 76191, name: 'España' },
    { id: 76197, name: 'México' },
    { id: 'addons', name: '➕ Addons M3U', isAddon: true }
  ];

  /* The portal returns 38 columns.  Rebuilding all 39 pills on every filter
     detached the focused node mid-keypress, so the rail looked alive but the
     d-pad had nowhere to go ("no puedo navegar hacia las categorías").
     The bar is now rebuilt only when the column list itself changes;
     selecting a category just swaps the is-selected class. */
  var key = '';
  for (var kk = 0; kk < cats.length; kk++) { key += cats[kk].id + '|'; }
  var focusedCat = (state.focus && state.focus._cat) ? state.focus._cat : null;

  if (key !== renderedCategoryKey) {
    clear(bar);
    var pills = [];
    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var pill = el('button', 'pc-cat-pill focusable', cat.name);
      pill._cat = cat;
      pill._idx = i;
      pill._activate = (function (c) {
        return function () { switchLiveCategory(c); };
      })(cat);
      pill._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'left') {
            if (idx > 0 && pills[idx - 1]) {
              setFocus(pills[idx - 1]);
              scrollPillIntoView(bar, pills[idx - 1]);
            }
            return true;
          }
          if (dir === 'right') {
            if (idx < pills.length - 1 && pills[idx + 1]) {
              setFocus(pills[idx + 1]);
              scrollPillIntoView(bar, pills[idx + 1]);
            } else {
              setFocus(playerStage);
            }
            return true;
          }
          if (dir === 'up') {
            /* All portal columns do not fit in the rail, so Up opens the
               full-screen category grid (the reference app's "all columns"). */
            openCategoryPicker();
            return true;
          }
          if (dir === 'down') {
            var promo = playerChannels.querySelector('.pc-row-addon-promo');
            if (promo) { setFocus(promo); return true; }
            if (CHANNELS.length) { focusPlayerChannel(state.channel); return true; }
          }
          return false;
        };
      })(i);
      bar.appendChild(pill);
      pills.push(pill);
    }
    bar._pills = pills;
    renderedCategoryKey = key;
  }

  var current = currentLiveCategory || cats[0];
  var now = bar._pills || [];
  for (var j = 0; j < now.length; j++) {
    var p = now[j];
    if (p._cat && current && p._cat.id === current.id) { p.classList.add('is-selected'); }
    else { p.classList.remove('is-selected'); }
  }

  /* Filtering must leave the d-pad on the rail, on the same pill. */
  if (focusedCat) {
    var same = null;
    for (var m = 0; m < now.length; m++) {
      if (now[m]._cat && now[m]._cat.id === focusedCat.id) { same = now[m]; break; }
    }
    if (same) {
      if (state.focus !== same) { setFocus(same); }
      scrollPillIntoView(bar, same);
    }
  }
}

function scrollSelectedCategoryPill() {
  if (!playerChannels) { return; }
  var bar = playerChannels.querySelector('.pc-categories');
  var pill = bar ? bar.querySelector('.pc-cat-pill.is-selected') : null;
  if (bar && pill) { scrollPillIntoView(bar, pill); }
}

/* Full-screen column picker.  The reference APK opens a separate "all
   columns" screen from the live home (mIvAllColumn); 38 portal categories
   cannot fit in the 453dp in-player rail, so Up on the rail opens this grid. */
function openCategoryPicker() {
  if (!categoryPicker) {
    categoryPicker = $('player-categories');
    pcatGrid = $('pcat-grid');
    pcatSub = $('pcat-sub');
  }
  if (!categoryPicker || !pcatGrid) { return; }
  state.categoryPickerOpen = true;
  categoryPicker.classList.add('is-active');
  hideInfobar();
  renderCategoryPicker();
  var cur = pcatGrid.querySelector('.pcat-tile.is-selected') || firstIn(pcatGrid);
  if (cur) { setFocus(cur); }
}

function closeCategoryPicker(keepFocus) {
  if (!categoryPicker || !state.categoryPickerOpen) { return; }
  state.categoryPickerOpen = false;
  categoryPicker.classList.remove('is-active');
  if (keepFocus) { return; }
  var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
  if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
  else if (state.screen === 'player' && playerStage) { setFocus(playerStage); }
}

function renderCategoryPicker() {
  if (!pcatGrid) { return; }
  var cats = liveCategories && liveCategories.length ? liveCategories : [];
  clear(pcatGrid);
  if (pcatSub) {
    pcatSub.textContent = cats.length
      ? (cats.length + ' categorías · elige una para filtrar los canales')
      : 'Cargando categorías…';
  }
  for (var i = 0; i < cats.length; i++) {
    (function (cat) {
      var tile = el('div', 'pcat-tile focusable');
      tile.appendChild(el('div', 'pcat-name', cat.name));
      if (currentLiveCategory && currentLiveCategory.id === cat.id) { tile.classList.add('is-selected'); }
      tile._cat = cat;
      tile._activate = function () {
        switchLiveCategory(cat);
        closeCategoryPicker(true);
        var pill = playerChannels ? playerChannels.querySelector('.pc-cat-pill.is-selected') : null;
        if (pill) { setFocus(pill); scrollSelectedCategoryPill(); }
        else { closeChannelPanel(); }
      };
      pcatGrid.appendChild(tile);
    })(cats[i]);
  }
}

function scrollPillIntoView(bar, pill) {
  if (!bar || !pill) { return; }
  var pl = pill.offsetLeft;
  var pw = pill.offsetWidth;
  var bl = bar.scrollLeft;
  var bw = bar.clientWidth;
  if (pl < bl) { bar.scrollLeft = pl - 20; }
  else if (pl + pw > bl + bw) { bar.scrollLeft = pl + pw - bw + 20; }
}

function focusPlayerChannel(index) {
  if (!CHANNELS.length) { return; }
  index = Math.max(0, Math.min(CHANNELS.length - 1, Number(index) || 0));
  if (!playerChannelRows[index]) { renderPlayerChannels(index); }
  if (playerChannelRows[index]) { setFocus(playerChannelRows[index]); }
}

function renderPlayerChannels(anchorIndex) {
  if (!playerChannels) { return; }
  var list = playerChannels.querySelector('.pc-list');
  if (!list) { return; }
  clear(list);
  playerChannelRows = {};

  /* If in Addons category, display manage promo header at top */
  if (currentLiveCategory && currentLiveCategory.isAddon) {
    var promo = el('div', 'pc-row-addon-promo focusable');
    promo.appendChild(el('div', 'promo-icon', '⚙️'));
    var promoInfo = el('div', 'promo-info');
    promoInfo.appendChild(el('div', 'promo-text', '➕ Administrar Addons y Listas M3U'));
    promoInfo.appendChild(el('div', 'promo-sub', 'Instala listas recomendadas o agrega tu enlace'));
    promo.appendChild(promoInfo);
    promo._activate = function () { openAddonsDialog(); };
    promo._onMove = function (dir) {
      if (dir === 'up') {
        var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
        if (selCat) { setFocus(selCat); }
        return true;
      }
      if (dir === 'down') {
        if (CHANNELS.length) { focusPlayerChannel(0); }
        return true;
      }
      if (dir === 'right') { setFocus(playerStage); return true; }
      return false;
    };
    list.appendChild(promo);
  }

  if (!CHANNELS.length) {
    var emptyRow = el('div', 'pc-empty-channels', 'No hay canales disponibles en esta categoría');
    emptyRow.style.padding = '30px';
    emptyRow.style.color = '#888';
    emptyRow.style.fontSize = '20px';
    list.appendChild(emptyRow);
    return;
  }

  anchorIndex = Number(anchorIndex);
  if (!isFinite(anchorIndex)) { anchorIndex = state.channel; }
  anchorIndex = Math.max(0, Math.min(CHANNELS.length - 1, anchorIndex || 0));
  var firstChannel = Math.max(0, anchorIndex - Math.floor(LIVE_PANEL_WINDOW / 2));
  var lastChannel = Math.min(CHANNELS.length, firstChannel + LIVE_PANEL_WINDOW);
  firstChannel = Math.max(0, lastChannel - LIVE_PANEL_WINDOW);

  for (var c = firstChannel; c < lastChannel; c++) {
    var row = el('div', 'pc-row focusable');
    row._channel = c;
    var ic = el('div', 'ic');
    if (CHANNELS[c].logo) {
      ic.style.backgroundImage = 'url(' + CHANNELS[c].logo + ')';
      ic.style.backgroundSize = 'contain';
      ic.style.backgroundRepeat = 'no-repeat';
      ic.style.backgroundPosition = 'center';
    }
    var num = el('div', 'num', pad2(CHANNELS[c].index || (c + 1)));
    var nm2 = el('div', 'nm', CHANNELS[c].name);
    var epg = el('div', 'epg', CHANNELS[c].now || 'En vivo');
    row.appendChild(ic); row.appendChild(num); row.appendChild(nm2); row.appendChild(epg);
    if (c === state.channel) { row.classList.add('is-current'); }
    row._activate = (function (idx) {
      return function () {
        setChannel(idx, true);
        closeChannelPanel();
        setFocus(playerStage);
      };
    })(c);
    row._onMove = (function (idx) {
      return function (dir) {
        if (dir === 'right') { setFocus(playerStage); return true; }
        if (dir === 'up') {
          if (idx > 0) {
            focusPlayerChannel(idx - 1);
          } else if (idx === 0) {
            var promo = playerChannels.querySelector('.pc-row-addon-promo');
            if (promo) { setFocus(promo); }
            else {
              var selCat = playerChannels.querySelector('.pc-cat-pill.is-selected') || playerChannels.querySelector('.pc-cat-pill');
              if (selCat) { setFocus(selCat); }
            }
          }
          return true;
        }
        if (dir === 'down') {
          if (idx < CHANNELS.length - 1) { focusPlayerChannel(idx + 1); }
          return true;
        }
        return false;
      };
    })(c);
    list.appendChild(row);
    playerChannelRows[c] = row;
  }
}
