'use strict';
// ffmpeg-tls.js  (ES5)
// FFmpeg checks the certificate of every HTTPS source (-tls_verify 1): the
// request headers it sends can carry tokens or cookies. A server whose
// certificate does not pass (expired, self-signed, wrong name: common on
// small video hosts) is remembered for this session and asked again
// without the check, so the source still plays. Used by ffmpeg-relay.js
// (modo compatible) and media-duration.js.

var url = require('url');

var looseHosts = {};   /* host -> true: its certificate failed once */

function hostOf(target) {
  try { return String(url.parse(String(target || '')).hostname || '').toLowerCase(); } catch (e) { return ''; }
}

/* The TLS options for this input ([] when it is not HTTPS). */
function args(target) {
  if (!/^https:/i.test(String(target || ''))) { return []; }
  return looseHosts[hostOf(target)] ? ['-tls_verify', '0'] : ['-tls_verify', '1'];
}

/* Reads FFmpeg's error text; true when it was the certificate check of a
   host still checked (that host is not checked any more). */
function noteFailure(target, text) {
  var host = hostOf(target);
  if (!host || looseHosts[host] || !/^https:/i.test(String(target || ''))) { return false; }
  if (!/certificate|x509|ssl|tls/i.test(String(text || ''))) { return false; }
  if (!/verif|expired|self.signed|unknown|untrusted|issuer|mismatch|fail|error/i.test(String(text || ''))) { return false; }
  looseHosts[host] = true;
  return true;
}

module.exports = { args: args, noteFailure: noteFailure };
