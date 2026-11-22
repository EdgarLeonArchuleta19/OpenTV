'use strict';
// netguard.js  (ES5: same style as the rest of the service)
// Where the JS plugins may connect (pluginFetch, the hidden browser). The
// address is checked after resolving the name, and the request then goes to
// that same address (a name cannot answer "public" to the check and
// "127.0.0.1" to the connection):
//   - OpenTV's own loopback (127.0.0.0/8, ::1, localhost): never.
//   - The home network (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10,
//     fc00::/7, fe80::/10): only when the viewer allowed that plugin.
//   - 0.0.0.0/8, multicast and reserved ranges: never.
// Android has the same rules in NetGuard.java.

var net = require('net');
var dnsx = require('./dnsx');

function v4Parts(ip) {
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) { return null; }
  var p = [+m[1], +m[2], +m[3], +m[4]];
  for (var i = 0; i < 4; i++) { if (p[i] > 255) { return null; } }
  return p;
}

/* 'loopback' | 'lan' | 'blocked' | 'public' */
function classify(ip) {
  ip = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  var mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) { ip = mapped[1]; }
  var p = v4Parts(ip);
  if (p) {
    if (p[0] === 127) { return 'loopback'; }
    if (p[0] === 0 || p[0] >= 224) { return 'blocked'; }
    if (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) ||
        (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)) { return 'lan'; }
    return 'public';
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1') { return 'loopback'; }
    if (ip === '::' || /^ff/.test(ip)) { return 'blocked'; }
    if (/^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) { return 'lan'; }
    return 'public';
  }
  return 'blocked';
}

function allowed(kind, allowLan) {
  return kind === 'public' || (kind === 'lan' && !!allowLan);
}

function refusal(kind) {
  return kind === 'lan' ? 'Este plugin no tiene permiso para usar la red de tu casa'
    : (kind === 'loopback' ? 'No se permite conectar con el propio aparato' : 'Dirección no permitida');
}

/* check(hostname, allowLan, cb) -> cb(err, ip): the address to connect to. */
function check(hostname, allowLan, cb) {
  var host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) { return cb(new Error('Host inválido')); }
  if (host === 'localhost' || /\.localhost$/.test(host)) { return cb(new Error(refusal('loopback'))); }
  if (v4Parts(host) || net.isIPv6(host)) {
    var kind = classify(host);
    return allowed(kind, allowLan) ? cb(null, host) : cb(new Error(refusal(kind)));
  }
  dnsx.resolve(host, function (err, res) {
    if (err || !res || !res.ips || !res.ips.length) { return cb(err || new Error('No se pudo resolver ' + host)); }
    /* Every address of the name must pass (a mixed answer is refused). */
    for (var i = 0; i < res.ips.length; i++) {
      var k = classify(res.ips[i]);
      if (!allowed(k, allowLan)) { return cb(new Error(refusal(k))); }
    }
    cb(null, res.ips[0]);
  });
}

module.exports = { classify: classify, check: check };
