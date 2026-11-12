/* boot-guard.js — The start screen (#boot-splash in index.html) shows from the
   first frame and desktop/splash.js removes it once the home is ready. If
   app.js failed to start, this takes it away so the app is not left behind a
   start screen forever. ES5, no dependencies. */
(function () {
  setTimeout(function () {
    var s = document.getElementById('boot-splash');
    if (s && !s._running && s.parentNode) { s.parentNode.removeChild(s); }
  }, 15000);
})();
