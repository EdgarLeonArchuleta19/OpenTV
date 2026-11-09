/* main.js — Arranque: eventos globales, API de depuración window.__xuper y enlaces profundos.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------ boot */
function boot() {
  if (window.XUPER_DESKTOP) { installTitleBar(); showBootSplash(); }
  fitDesignViewport();
  window.addEventListener('resize', fitDesignViewport, false);
  window.addEventListener('orientationchange', fitDesignViewport, false);
  document.addEventListener('visibilitychange', fitDesignViewport, false);
  /* Some webOS builds only report the final window size after the splash
     animation, and 720p / 2K sets take longer than 1080p ones. */
  setTimeout(fitDesignViewport, 250);
  setTimeout(fitDesignViewport, 1200);
  setTimeout(fitDesignViewport, 3000);
  document.addEventListener('keydown', handleKey, false);
  document.addEventListener('keyup', function (e) {
    var code = e.keyCode || e.which;
    if (code === 461 || e.key === 'Back' || e.key === 'GoBack') {
      handleKey(e);
    }
  }, false);
  window.addEventListener('popstate', function () {
    back();
  }, false);
  document.addEventListener('click', function (e) {
    var f = closest(e.target, '.focusable');
    if (!f) { return; }
    if (!isVisible(f)) { return; }
    setFocus(f, true);
    if (f._activate) { f._activate(); }
  });
  if (window.XUPER_DESKTOP) {
    document.addEventListener('scroll', schedulePosterMemoryPass, { capture: true, passive: true });
    /* A page slides in when its tab opens: posters that were still off
       screen at that moment are loaded once the slide ends. */
    document.addEventListener('animationend', function (event) {
      if (event.target && event.target.classList && event.target.classList.contains('home-page')) { schedulePosterMemoryPass(); }
    }, true);
    window.addEventListener('resize', schedulePosterMemoryPass);
  }
  if (window.XUPER_DESKTOP) document.addEventListener('focusin', function (e) {
    var f = closest(e.target, '.focusable');
    if (f && isVisible(f)) setFocus(f, true);
  });
  buildSearch();
  startServiceKeepAlive();
  portalServiceCall('prewarm', {}, function () {});
  startWelcome();
  loadVodCatalog();
  loadLiveChannels();

  window.__xuper = {
    version: '4.34.4',
    state: state,
    vod: VOD,
    channels: CHANNELS,
    api: vodApiState,
    portal: portalState,
    service: portalServiceCall,
    refreshPortal: refreshPortalCatalog,
    reloadVod: loadVodCatalog,
    skipWelcome: finishWelcome,
    show: function (name) {
      if (name === 'home') { finishWelcome(); }
      else if (name === 'detail') { openDetail(VOD[0]); }
      else if (name === 'search') { openSearch(); }
      else if (name === 'settings') { openSettings(); }
      else if (name === 'history') { openHistoryView(); }
      else if (name === 'help') { openSettings(); showSettingsPanel(settingsIndexOf('feedback'), true); }
      else if (name === 'pip') { togglePictureInPicture(); }
      else if (name === 'player') { openPlayer('live'); }
      else { showScreen(name); }
    },
    selectTab: function (i) { finishWelcome(); selectTab(i, true); },
    openDetail: function (i) { openDetail(VOD[i] || VOD[0]); },
    openSearch: openSearch,
    openSettings: openSettings,
    openPlayer: function (mode, i) { openPlayer(mode || 'live', VOD[i] || null); },
    focus: function (sel) {
      var n = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (n) { setFocus(n); }
    },
    key: function (code) { handleKey({ keyCode: code, preventDefault: function () {} }); },
    search: function (q) { openSearch(); setSearchQuery(q); },
    settingsPanel: function (i) { openSettings(); showSettingsPanel(i, true); }
  };

  if (window.XUPER_DESKTOP) { installDesktopNavigation(); installTooltips(); installFocusRingMode(); installQualityControls(); installLiveGuide(); installUpdates(); installHoverCards(); installTrending(); startCatalogAutoRefresh(); }

  applyQuery();
}

/* Deep-link support for the visual comparison harness, e.g.
   index.html?screen=home&tab=2   index.html?screen=detail&vod=3
   index.html?screen=search&q=demo index.html?screen=settings&panel=1
   index.html?screen=player&ch=2&channels=1                            */
function applyQuery() {
  var raw = String(location.search || '').replace(/^\?/, '');
  if (!raw) { return; }
  var map = {};
  var parts = raw.split('&');
  for (var i = 0; i < parts.length; i++) {
    if (!parts[i]) { continue; }
    var kv = parts[i].split('=');
    map[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
  }
  if (map.ch !== undefined) {
    var ch = parseInt(map.ch, 10) || 0;
    state.channel = Math.max(0, Math.min(CHANNELS.length - 1, ch));
  }
  var screen = map.screen || 'home';
  if (screen === 'welcome') { return; }

  finishWelcome();
  if (map.tab !== undefined) {
    selectTab(parseInt(map.tab, 10) || 0, true);
  } else if (!window.XUPER_DESKTOP) {
    selectTab(0, false);
    setFocus(liveFocus);
  }
  /* (Desktop: finishWelcome already opened Inicio.) */

  if (screen === 'detail') {
    openDetail(VOD[parseInt(map.vod, 10) || 0]);
  } else if (screen === 'search') {
    openSearch();
    if (map.q) { setSearchQuery(map.q); }
  } else if (screen === 'settings') {
    openSettings();
    if (map.panel !== undefined) { showSettingsPanel(parseInt(map.panel, 10) || 0, true); }
  } else if (screen === 'player') {
    openPlayer(map.mode === 'vod' ? 'vod' : 'live', VOD[parseInt(map.vod, 10) || 0]);
    if (map.channels === '1') { openChannelPanel(); }
  }

  if (map.focus) {
    var n = document.querySelector(map.focus);
    if (n) { setFocus(n); }
  }
}

function purgeMemoryCache() {
  stopPlayerVideo();
  clearSearchState();
}

window.addEventListener('beforeunload', purgeMemoryCache);
window.addEventListener('unload', purgeMemoryCache);
document.addEventListener('visibilitychange', function () {
  if (document.hidden && !window.XUPER_DESKTOP) {
    purgeMemoryCache();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
