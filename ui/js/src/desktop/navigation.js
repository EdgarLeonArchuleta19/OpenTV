/* desktop/navigation.js — Botones flotantes Volver / Historial y modo cine al reproducir.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

function installDesktopNavigation() {
  var button = el('button', 'desktop-native-control');
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg><span>Volver</span>';
  button.id = 'desktop-back';
  button.type = 'button';
  button.setAttribute('aria-label', 'Volver a la pantalla anterior');
  button.addEventListener('click', desktopBack);
  document.body.appendChild(button);

  var historyBtn = el('button', 'desktop-native-control');
  historyBtn.id = 'desktop-history';
  historyBtn.type = 'button';
  historyBtn.title = 'Historial (Ctrl+J)';
  historyBtn.setAttribute('aria-label', 'Historial de lo que has visto');
  historyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg><span>Historial</span>';
  historyBtn.addEventListener('click', openHistoryView);
  document.body.appendChild(historyBtn);

  /* While a video plays, the floating buttons and the cursor get out of
     the way. They come back with the player controls (mouse move, a key,
     pause) and leave again when those controls auto-hide. */
  var body = document.body;
  var lastScreen = '';
  setInterval(function () {
    var onPlayer = state.screen === 'player';
    var controlsUp = onPlayer && (state.infobar || state.episodeBrowserOpen || playSettingViewOpen ||
      state.channelsOpen || state.categoryPickerOpen || dialogPlaySettingsOpen || dialogAddonsOpen ||
      historyDrawerOpen || !playerVideo || playerVideo.paused);
    body.classList.toggle('is-playing-idle', onPlayer && !controlsUp);
    if (state.screen !== lastScreen) { lastScreen = state.screen; body.setAttribute('data-screen', state.screen); }
    button.hidden = state.screen === 'welcome' ||
      (state.screen === 'home' && !dialogAddonsOpen && !historyDrawerOpen);
    button.disabled = false;
    historyBtn.hidden = state.screen === 'welcome' || onPlayer || state.screen === 'home';
    var onHistory = historyDrawerOpen;
    historyBtn.classList.toggle('is-active', onHistory);
  }, 150);
}
