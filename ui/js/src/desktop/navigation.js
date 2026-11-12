/* desktop/navigation.js — Botón flotante Volver y modo cine al reproducir.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function installDesktopNavigation() {
  var button = el('button', 'desktop-native-control');
  button.innerHTML = UI_ICONS.back;
  button.setAttribute('data-tip', 'Volver (Esc)');
  button.id = 'desktop-back';
  button.type = 'button';
  button.setAttribute('aria-label', 'Volver a la pantalla anterior');
  button.addEventListener('click', desktopBack);
  document.body.appendChild(button);

  /* No floating Historial button: history lives in Ajustes → Mi lista
     (and Ctrl+J still opens it). */

  /* While a video plays, the floating buttons and the cursor get out of
     the way. They come back with the player controls (mouse move, a key,
     pause) and leave again when those controls auto-hide. */
  var body = document.body;
  var lastScreen = '';
  setInterval(function () {
    var onPlayer = state.screen === 'player';
    /* TV en vivo full screen can be showing the home preview's own <video>
       (live/channels.js hands it over): that one is what plays, and the
       player's element stays empty and paused. */
    var shown = (liveHandoff && liveHandoff.type === 'preview' && livePreviewVideo) ? livePreviewVideo : playerVideo;
    var controlsUp = onPlayer && (state.infobar || state.episodeBrowserOpen || playSettingViewOpen ||
      state.channelsOpen || state.categoryPickerOpen || dialogPlaySettingsOpen || dialogAddonsOpen || sourcePickerOpen ||
      historyDrawerOpen || !shown || shown.paused);
    body.classList.toggle('is-playing-idle', onPlayer && !controlsUp);
    if (state.screen !== lastScreen) { lastScreen = state.screen; body.setAttribute('data-screen', state.screen); }
    /* The movie player has its own Volver (top left), so no second one. */
    var hide = state.screen === 'welcome' ||
      (state.screen === 'home' && !dialogAddonsOpen && !historyDrawerOpen) ||
      (state.screen === 'player' && state.playerMode === 'vod');
    /* Only when it changes: writing the same value is still an attribute
       change, and restyled the page every 150 ms (seen on a Fire TV). */
    if (button.hidden !== hide) { button.hidden = hide; }
    if (button.disabled) { button.disabled = false; }
  }, 150);
}
