/* desktop/display.js — Escalado del lienzo a la ventana y "Volver" de escritorio.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ---------------------------------------------------------------- display */
/* The reference UI is authored at 1920×1080. Older sets expose that exact
   logical viewport, whereas some UHD webOS 22/25 sets expose 3840×2160.
   Without this fit pass only the left half of the fixed canvas is painted
   and the right half of the TV remains black. */
function viewportSize() {
  /* Most webOS builds report the CSS viewport here. Some 2K/4K firmware
     reports a legacy 1280×720 inner viewport while compositing to its full
     physical 1920/3840 panel; using that value alone paints the left part
     of the TV and leaves the right side black. */
  var vw = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0;
  var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 0;
  if (!vw || !vh) { vw = 1920; vh = 1080; }
  var panelW = Math.floor((screen && screen.width) || 0);
  var panelH = Math.floor((screen && screen.height) || 0);
  var cssRatio = vw / vh;
  var panelRatio = panelW && panelH ? panelW / panelH : 0;
  /* Only trust screen.* when it is a true UHD/4K panel (>= 2560).
     Never override an HD/720p viewport (1280×720) with a virtual 1920 panel,
     which would force scale=1.0 and crop 640px on the right and 360px on the bottom. */
  if (panelW >= 2560 && panelW >= vw * 1.25 && panelH >= vh * 1.25 &&
      Math.abs(cssRatio - panelRatio) < 0.03) {
    vw = panelW;
    vh = panelH;
  }
  var panel = (panelW > 0 && panelH > 0) ? { w: panelW, h: panelH } : null;
  return { w: vw, h: vh, panel: panel };
}

function fitDesignViewport() {
  var app = $('app');
  if (!app) { return; }
  var size = viewportSize();
  var vw = size.w;
  var vh = size.h;
  var scale = Math.min(vw / 1920, vh / 1080);
  if (!isFinite(scale) || scale <= 0) { scale = 1; }
  scale = Math.round(scale * 10000) / 10000;
  /* Keep a non-16:9 display letterboxed instead of stretching the design. */
  var left = Math.max(0, Math.round((vw - (1920 * scale)) / 2));
  var top = Math.max(0, Math.round((vh - (1080 * scale)) / 2));
  if (window.XUPER_DESKTOP) {
    /* Desktop windows have any shape. Instead of letterboxing the 1920×1080
       design, the canvas grows to fill the whole window and every screen
       keeps its layout centred inside it (see desktop/theme.css). The
       player video and the screen backgrounds cover the full window. */
    var cw = Math.ceil(vw / scale);
    var ch = Math.ceil(vh / scale);
    app.style.width = cw + 'px';
    app.style.height = ch + 'px';
    app.style.setProperty('--cw', cw + 'px');
    app.style.setProperty('--ch', ch + 'px');
    app.style.setProperty('--ox', Math.floor((cw - 1920) / 2) + 'px');
    app.style.setProperty('--oy', Math.floor((ch - 1080) / 2) + 'px');
    left = 0; top = 0;
  }
  app.style.left = left + 'px';
  app.style.top = top + 'px';
  app.style.webkitTransform = 'scale(' + scale + ')';
  app.style.transform = 'scale(' + scale + ')';
  /* Read by the network diagnostics panel: a photo of that screen tells
     which viewport the TV really gave the app (720p / 2K / 4K sets differ). */
  window.__xuperViewport = {
    w: vw, h: vh, scale: scale,
    panelW: size.panel ? size.panel.w : 0,
    panelH: size.panel ? size.panel.h : 0
  };
}


function openDesktopDiagnostic() {
  if (dialogAddonsOpen) closeAddonsDialog();
  if (state.episodeBrowserOpen) closeEpisodeBrowser();
  if (state.categoryPickerOpen) closeCategoryPicker();
  if (dialogPlaySettingsOpen) closePlaySettingsDialog();
  if (playSettingViewOpen) closePlaySettingView();
  openSettings();
  for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
    if (SETTINGS_ITEMS[i].id === 'netdiag') { showSettingsPanel(i, true); break; }
  }
}

function desktopBack() {
  if (historyDrawerOpen) { closeHistoryDrawer(); return; }
  if (dialogAddonsOpen) { closeAddonsDialog(); return; }
  if (dialogPlaySettingsOpen) { closePlaySettingsDialog(); return; }
  if (state.categoryPickerOpen) { closeCategoryPicker(); return; }
  if (state.episodeBrowserOpen) { closeEpisodeBrowser(); return; }
  if (playSettingViewOpen) { closePlaySettingView(); return; }
  if (state.screen === 'player') {
    leaveVodScrub(false);
    closeChannelPanel();
    restorePlayerReturn();
    return;
  }
  lastBackTime = 0;
  back();
}
