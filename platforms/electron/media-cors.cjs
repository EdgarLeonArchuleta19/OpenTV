'use strict';
/* Live lists and direct links on PC: many TV servers name only their own
   site in Access-Control-Allow-Origin (Pluto answers "http://pluto.tv"), so
   hls.js in the app page could not read the playlist and the channel never
   started. The answers to the app page's own requests (sent with Origin
   opentv://app) are let through.

   - Only the app page: the JS plugins' page sends Origin "null" and has no
     network of its own anyway (csp.cjs); the hidden browser of the plugins
     uses another session (main.cjs).
   - Tracked by request id, so the hops of a redirect count too (after a
     cross-origin redirect the browser sends Origin "null", hence "*").
   - No cookies go with these requests (hls.js sends none), so "*" is
     enough and credentials are never allowed. */
const APP_ORIGIN = 'opentv://app';

function install(ses) {
  const fromApp = new Set();
  const forget = (details) => { fromApp.delete(details.id); };

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const h = details.requestHeaders || {};
    const origin = h.Origin || h.origin || '';
    if (origin === APP_ORIGIN && /^https?:/i.test(details.url)) {
      if (fromApp.size > 4000) fromApp.clear();
      fromApp.add(details.id);
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (!fromApp.has(details.id)) return callback({});
    const headers = {};
    for (const name of Object.keys(details.responseHeaders || {})) {
      if (/^access-control-allow-(origin|credentials)$/i.test(name)) continue;
      headers[name] = details.responseHeaders[name];
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });

  ses.webRequest.onCompleted(forget);
  ses.webRequest.onErrorOccurred(forget);
}

module.exports = { install, APP_ORIGIN };
