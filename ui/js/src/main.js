/* main.js — Arranque: eventos globales, API de depuración window.__opentv y enlaces profundos.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ------------------------------------------------------------------ boot */
function boot() {
  if (window.OPENTV_DESKTOP) { installTitleBar(); showBootSplash(); }
  applyAccent();
  applyTextSize();
  fitDesignViewport();
  window.addEventListener('resize', fitDesignViewport, false);
  window.addEventListener('orientationchange', fitDesignViewport, false);
  document.addEventListener('visibilitychange', fitDesignViewport, false);
  /* Some TVs only report the final window size after the splash animation. */
  setTimeout(fitDesignViewport, 250);
  setTimeout(fitDesignViewport, 1200);
  setTimeout(fitDesignViewport, 3000);
  document.addEventListener('keydown', handleKey, false);
  /* PC: the app's volume is Windows' own (full level in the app, the
     slider moves the system volume), from the start, not only once the TV
     page was opened. */
  startSystemVolumeSync();
  /* PC: the downloads list, so "Reproducir" finds a downloaded title at once. */
  if (platformHas('downloads')) { refreshDownloads(); }
  /* Android: what this device can do, from the service: torrents (Android
     9+ on ARM), downloads, its decoders and screen, and free space. */
  if (platformName() === 'android' && window.OPENTV_PLATFORM && window.OPENTV_PLATFORM.enable) {
    portalServiceCall('ping', {}, function (err, info) {
      if (err || !info) { return; }
      if (info.torrents === true) { window.OPENTV_PLATFORM.enable('torrents'); }
      /* Downloads: phones only. A TV has little storage and is never
         taken anywhere without internet. */
      if (info.downloads === true && !platformIsTv()) { window.OPENTV_PLATFORM.enable('downloads'); refreshDownloads(); }
      setDeviceProfile(info.media, info.storage);
    });
    /* A new APK on GitHub: a short notice (Acerca de has the button too). */
    setTimeout(checkAndroidUpdateOnStart, 8000);
    /* The "Descargando" notification was tapped: show the downloads. On a
       cold start the app may say so before this listener exists, so the
       flag it leaves is checked too. */
    var openDownloadsFromNotice = function () {
      window.__opentvOpenDownloads = false;
      if (isPhone()) { return; }
      finishWelcome();
      openSettingsAt('downloads');
    };
    window.addEventListener('opentv:open-downloads', openDownloadsFromNotice);
    if (window.__opentvOpenDownloads) { setTimeout(openDownloadsFromNotice, 1500); }
  }
  document.addEventListener('keyup', function (e) {
    var code = e.keyCode || e.which;
    if (e.key === 'Back' || e.key === 'GoBack') {
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
  if (window.OPENTV_DESKTOP) {
    document.addEventListener('scroll', schedulePosterMemoryPass, { capture: true, passive: true });
    /* A page slides in when its tab opens: posters that were still off
       screen at that moment are loaded once the slide ends. */
    document.addEventListener('animationend', function (event) {
      if (event.target && event.target.classList && event.target.classList.contains('home-page')) { schedulePosterMemoryPass(); }
    }, true);
    window.addEventListener('resize', schedulePosterMemoryPass);
  }
  if (window.OPENTV_DESKTOP) document.addEventListener('focusin', function (e) {
    var f = closest(e.target, '.focusable');
    if (f && isVisible(f)) setFocus(f, true);
  });
  forgetPrivateContent();
  applyLiteMode();
  buildSearch();
  startWelcome();
  /* Movies and series: the viewer's addons. */
  loadVodCatalog();
  /* TV en vivo: the viewer's own M3U lists. */
  loadLiveChannels();

  window.__opentv = {
    state: state,
    vod: VOD,
    channels: CHANNELS,
    /* TV en vivo (tests): reload the M3U lists or show a given channel list. */
    live: { reload: reloadLiveLists, use: useLiveChannels, categories: function () { return liveCategories; },
      channels: function () { return liveAllChannels; } },
    api: vodApiState,
    service: portalServiceCall,
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
    settingsPanel: function (i) { openSettings(); showSettingsPanel(i, true); },
    settingsIndexOf: settingsIndexOf,
    openItem: function (item) { openDetail(item); },
    /* The catalogue as it is now (`vod` above is the one at start). */
    currentVod: function () { return VOD; },
    /* Tests: a JS plugin's code in the sandbox, without downloading it. */
    jsPluginLoadCode: function (ad, code, cb) { loadJsPluginCode(ad, code, cb); },
    avatarSvg: function (i) { return avatarSvg(i); },
    leavePlayer: restorePlayerReturn,
    /* Seguir viendo / Historial: forget a title (tests). */
    forgetWatched: forgetWatchedTitle,
    history: function () { return localProfile.history; },
    /* Reanudar / Ver desde el principio (tests): the plan playing would make. */
    resumePlanFor: function (item, episode, fromStart) {
      resetResumePlan();
      if (fromStart) { resumeFromStartKey = resumeKeyFor(item, episode || null); }
      planResume(item, episode || null);
      var out = { pos: resumePlan ? resumePlan.pos : 0, restarted: resumeRestarted };
      resetResumePlan();
      return out;
    },
    /* Addons (tests): install one, search, the saved source, what it offers. */
    stremio: { install: installVodAddon, sync: syncExternalVodCatalogs, search: searchStremioAddons,
      savedPick: savedStremioPick, offers: addonOffers, hasSources: hasSourceAddons }
  };

  if (window.OPENTV_DESKTOP) { installDesktopNavigation(); installTooltips(); installFocusRingMode(); installQualityControls(); installLiveGuide(); installUpdates(); installHoverCards(); installTrending(); installProfiles(); startCatalogAutoRefresh(); }

  /* Android / Fire TV (Capacitor): the remote's Back reaches the page only
     through the App plugin. Without this listener Android handled it itself
     (it closed the app, and the player could not be left with Back). */
  var capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (capApp && capApp.addListener) {
    capApp.addListener('backButton', function () {
      /* Phones: the phone layer closes its own screens first. */
      if (isPhone() && mobileBack()) { return; }
      handleKey({ keyCode: 27, key: 'GoBack', preventDefault: function () {} });
    });
  }

  /* Phones: their own vertical layout over the canvas (mobile/mobile-app.js). */
  installMobileApp();

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
  } else if (!window.OPENTV_DESKTOP) {
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
  if (document.hidden && !window.OPENTV_DESKTOP) {
    purgeMemoryCache();
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
