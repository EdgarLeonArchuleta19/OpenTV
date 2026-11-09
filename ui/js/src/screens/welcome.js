/* screens/welcome.js — Pantalla de bienvenida.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* ================================================================ WELCOME */
function startWelcome() {
  var img = $('welcome-loading-img');
  var frame = 1;
  welcomeTimer = setInterval(function () {
    frame++;
    if (frame > (window.XUPER_DESKTOP ? 9 : 16)) { finishWelcome(); return; }
    img.src = 'assets/original/welcome/img_welcome_loading' + frame + '.png';
  }, 250);
}

function finishWelcome() {
  if (welcomeTimer) { clearInterval(welcomeTimer); welcomeTimer = null; }
  if (!homeBuilt) { buildHome(); }
  showScreen('home');
  /* Desktop opens on Inicio (also where Ctrl+H goes); the TV opens on TV. */
  var startTab = 0;
  if (window.XUPER_DESKTOP) {
    for (var t = 0; t < TABS.length; t++) { if (TABS[t].page === 1) { startTab = t; break; } }
  }
  selectTab(startTab, false);
  if (startTab === 0) { setFocus(liveFocus); }
  else {
    var first = pages[TABS[startTab].page] ? firstIn(pages[TABS[startTab].page]) : null;
    setFocus(first || tabEls[startTab], true);
  }
  /* The first launch shows the full tab labels even though the video holds
     focus; the rail collapses on the first focus change. */
  var rail = $('home-tabs');
  if (rail) { rail.classList.add('is-expanded'); rail.classList.remove('is-collapsed'); }
  if (!window.XUPER_DESKTOP) {
    var railBg = document.querySelector('.home-sidebar-bg');
    if (railBg) { railBg.classList.add('is-on'); }
    var homeScreen = $('screen-home');
    if (homeScreen) { homeScreen.classList.add('is-rail-open'); }
  }
}
