'use strict';
/* Content-Security-Policy of the app's HTML pages (main.cjs serves them;
   tests/e2e/smoke.cjs uses the same so the tests run under it).
   - The app's pages: only the app's own scripts run (hls.js uses a blob:
     worker); markup that slips in from network data cannot run script. They
     may frame only their own files (the JS plugins' page).
   - The JS plugins' page (ui/plugin-sandbox.html) runs third-party code:
     always sandboxed (even if opened outside its iframe), allowed to compile
     it and nothing else: no network, frames or forms of its own (the app
     does the network for it). */
const APP = "script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'self'";
const PLUGINS = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-eval'; base-uri 'none'; form-action 'none'";

function cspFor(file) {
  return /[\\/]plugin-sandbox\.html$/i.test(String(file || '')) ? PLUGINS : APP;
}

module.exports = { cspFor };
