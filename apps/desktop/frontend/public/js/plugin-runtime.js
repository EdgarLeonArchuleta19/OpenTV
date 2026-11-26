/* plugin-runtime.js — Donde corren los plugins JS (kino-plugin.json + plugin.js), aislados de la app.
   Lo carga plugin-sandbox.html dentro de un iframe con sandbox="allow-scripts"
   (sin allow-same-origin): sin acceso a la app, a su localStorage, a sus
   cookies ni a window.desktop / al servicio. Su política (CSP) le prohíbe
   además conectarse por su cuenta: todo lo de red pasa por la app
   (ui/js/src/services/js-plugins.js), que aplica sus reglas.
   ES5 como el resto de ui/js (teles viejas); el código del plugin (ES2020)
   se compila aquí con Function(), solo en aparatos que lo soportan. */
(function () {
  'use strict';

  var host = window.parent;
  var instances = {};   /* key -> { exports, names } */
  var asks = {};        /* id -> { resolve, reject } */
  var askSeq = 0;
  /* Each sandbox (iframe on PC, WebView on Android) hosts ONE plugin: the
     first `load` binds its key and any other key is refused. */
  var boundKey = null;
  /* The app's own bridges must not reach this frame. A very old Android
     WebView injects Capacitor's bridge into every frame: then nothing runs. */
  /* Tauri (WebView2) injects its IPC globals (`__TAURI_INTERNALS__`, `ipc`) into
     EVERY frame, as non-configurable properties, so they cannot be removed here.
     Inside this frame they are inert: opaque origin, the CSP forbids any connection
     (including Tauri's ipc:// fetch) and WebView2 does not deliver iframe
     postMessage to Tauri's handler, so an invoke() never gets an answer. Only
     bridges that would really work refuse the load: Capacitor/Android, the v1
     Electron `desktop` bridge, the global Tauri API, and the service token. */
  var exposed = typeof window.androidBridge !== 'undefined' || typeof window.Capacitor !== 'undefined' ||
    typeof window.desktop !== 'undefined' || typeof window.__TAURI__ !== 'undefined' ||
    typeof window.__OPENTV_TAURI_INIT__ !== 'undefined';
  /* Cryptographic randomness when the engine has it (it does on every
     supported WebView); Math.random only as a last resort. */
  function randomByte() {
    var c = window.crypto || window.msCrypto;
    if (c && typeof c.getRandomValues === 'function') {
      var a = new Uint8Array(1);
      c.getRandomValues(a);
      return a[0];
    }
    return Math.floor(Math.random() * 256);
  }

  function post(msg) {
    msg.opentvPlugin = 1;
    host.postMessage(msg, '*');
  }

  /* A plain copy of what a plugin answered (functions and cycles dropped). */
  function plain(value) {
    if (value === undefined) { return null; }
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }

  /* Asks the app for something only it may do (network, TMDB, the hidden
     browser, saving). */
  function ask(op, pluginKey, args) {
    return new Promise(function (resolve, reject) {
      var id = ++askSeq;
      asks[id] = { resolve: resolve, reject: reject };
      post({ kind: 'ask', id: id, op: op, key: pluginKey, args: plain(args) || {} });
    });
  }

  function codedError(code, msg, extra) {
    var e = new Error(String(msg || code || 'error'));
    e.code = String(code || 'unknown');
    if (extra && typeof extra === 'object' && typeof extra.userMessage === 'string') {
      e.userMessage = extra.userMessage.slice(0, 300);
    }
    return e;
  }

  /* Maps a failed host fetch (status 0 + error text) to a coded rejection,
     the way Kino plugins expect (`e.code === 'timeout'`, ...). */
  function fetchFailure(r) {
    var msg = String((r && r.error) || 'Error de red');
    var code = (r && typeof r.code === 'string' && r.code) ||
      (/timeout|tiempo/i.test(msg) ? 'timeout' : 'network');
    return codedError(code, msg);
  }

  /* A per-plugin view of the global object. Bundled plugins read
     `globalThis.kino` (not the `kino` parameter) before using optional APIs,
     and set flags such as `globalThis.__kinoDropPendingFetches`; keep them
     off the real window (each plugin also has its own frame). Constructors and
     namespaces (URL, Promise, JSON...) come back untouched; plain functions
     (setTimeout, atob...) are bound to the real window. */
  function shadowGlobal(kinoObj) {
    var own = { kino: kinoObj };
    if (typeof Proxy !== 'function') { return own; }
    return new Proxy(own, {
      get: function (t, p) {
        if (Object.prototype.hasOwnProperty.call(t, p)) { return t[p]; }
        var v = window[p];
        if (typeof v === 'function' && typeof p === 'string' && /^[a-z]/.test(p)) { return v.bind(window); }
        return v;
      },
      set: function (t, p, v) { t[p] = v; return true; },
      has: function (t, p) { return Object.prototype.hasOwnProperty.call(t, p) || (p in window); }
    });
  }

  function norm(s) {
    s = String(s).toLowerCase();
    if (s.normalize) { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    return s;
  }

  /* ------------------------------------------------ the plugin's code */
  /* Transforms ESM export declarations into __exports assignments so the bundle
     can run inside a Function('kino', '__exports', code) scope. */
  function transformEsmToCommon(code) {
    var names = [];
    var out = String(code || '')
      .replace(/export\s+async\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, function (_, n) {
        names.push(n);
        return 'async function ' + n + '(';
      })
      .replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, function (_, n) {
        names.push(n);
        return 'function ' + n + '(';
      })
      .replace(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g, function (_, n) {
        names.push(n);
        return 'var ' + n + ' =';
      })
      .replace(/export\s*\{([^}]+)\}\s*;?/g, function (_, list) {
        var parts = list.split(',');
        var assigns = [];
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i].trim();
          if (!p) { continue; }
          var asMatch = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(p);
          if (asMatch) { assigns.push('__exports.' + asMatch[2] + ' = ' + asMatch[1] + ';'); }
          else { assigns.push('__exports.' + p + ' = ' + p + ';'); }
        }
        return assigns.join('\n');
      });
    var tail = '\n';
    for (var j = 0; j < names.length; j++) {
      tail += '__exports.' + names[j] + ' = ' + names[j] + ';\n';
    }
    return out + tail;
  }

  /* ------------------------------------------------ kino.crypto, pure JS */
  /* Pure-JS SHA-256 / HMAC-SHA256 / randomBytes / UUID for kino.crypto */
  var K256 = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rotr(n, x) { return (x >>> n) | (x << (32 - n)); }
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64DecodeBytes(str) {
    var clean = String(str || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
    var out = [], i;
    for (i = 0; i < clean.length; i += 4) {
      var c0 = B64_CHARS.indexOf(clean.charAt(i));
      var c1 = B64_CHARS.indexOf(clean.charAt(i + 1));
      var c2 = i + 2 < clean.length ? B64_CHARS.indexOf(clean.charAt(i + 2)) : -1;
      var c3 = i + 3 < clean.length ? B64_CHARS.indexOf(clean.charAt(i + 3)) : -1;
      if (c0 < 0 || c1 < 0) { break; }
      out.push(((c0 << 2) | (c1 >>> 4)) & 0xff);
      if (c2 >= 0) { out.push((((c1 & 15) << 4) | (c2 >>> 2)) & 0xff); }
      if (c3 >= 0) { out.push((((c2 & 3) << 6) | c3) & 0xff); }
    }
    return out;
  }
  function b64EncodeBytes(bytes) {
    var out = '', i;
    for (i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i] & 0xff;
      var has1 = i + 1 < bytes.length, b1 = has1 ? (bytes[i + 1] & 0xff) : 0;
      var has2 = i + 2 < bytes.length, b2 = has2 ? (bytes[i + 2] & 0xff) : 0;
      out += B64_CHARS.charAt(b0 >>> 2);
      out += B64_CHARS.charAt(((b0 & 3) << 4) | (b1 >>> 4));
      out += has1 ? B64_CHARS.charAt(((b1 & 15) << 2) | (b2 >>> 6)) : '=';
      out += has2 ? B64_CHARS.charAt(b2 & 63) : '=';
    }
    return out;
  }
  function strToBytes(str, enc) {
    var s = String(str || '');
    var out = [], i;
    if (enc === 'hex') {
      for (i = 0; i + 1 < s.length; i += 2) { out.push(parseInt(s.substr(i, 2), 16) || 0); }
      return out;
    }
    if (enc === 'base64') {
      return b64DecodeBytes(s);
    }
    var utf8 = unescape(encodeURIComponent(s));
    for (i = 0; i < utf8.length; i++) { out.push(utf8.charCodeAt(i) & 0xff); }
    return out;
  }
  function bytesToOut(bytes, enc) {
    var i;
    if (enc === 'base64') {
      return b64EncodeBytes(bytes);
    }
    if (enc === 'utf8') {
      var s = '';
      for (i = 0; i < bytes.length; i++) { s += String.fromCharCode(bytes[i] & 0xff); }
      try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    }
    var hex = '';
    for (i = 0; i < bytes.length; i++) {
      var h = (bytes[i] & 0xff).toString(16);
      hex += h.length === 1 ? '0' + h : h;
    }
    return hex;
  }
  function sha256Bytes(msgBytes) {
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var l = msgBytes.length;
    var bitLen = l * 8;
    var padded = msgBytes.slice();
    padded.push(0x80);
    while ((padded.length % 64) !== 56) { padded.push(0); }
    padded.push(0, 0, 0, 0);
    padded.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
    var W = new Array(64);
    for (var i = 0; i < padded.length; i += 64) {
      for (var t = 0; t < 16; t++) {
        var j = i + t * 4;
        W[t] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) | 0;
      }
      for (var t2 = 16; t2 < 64; t2++) {
        var s0 = rotr(7, W[t2 - 15]) ^ rotr(18, W[t2 - 15]) ^ (W[t2 - 15] >>> 3);
        var s1 = rotr(17, W[t2 - 2]) ^ rotr(19, W[t2 - 2]) ^ (W[t2 - 2] >>> 10);
        W[t2] = (W[t2 - 16] + s0 + W[t2 - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var t3 = 0; t3 < 64; t3++) {
        var S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (h + S1 + ch + K256[t3] + W[t3]) | 0;
        var S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = [];
    for (var hi = 0; hi < 8; hi++) {
      out.push((H[hi] >>> 24) & 0xff, (H[hi] >>> 16) & 0xff, (H[hi] >>> 8) & 0xff, H[hi] & 0xff);
    }
    return out;
  }
  function hmacSha256Bytes(keyBytes, dataBytes) {
    var k = keyBytes.length > 64 ? sha256Bytes(keyBytes) : keyBytes.slice();
    while (k.length < 64) { k.push(0); }
    var oKey = [], iKey = [];
    for (var i = 0; i < 64; i++) {
      oKey.push(k[i] ^ 0x5c);
      iKey.push(k[i] ^ 0x36);
    }
    return sha256Bytes(oKey.concat(sha256Bytes(iKey.concat(dataBytes))));
  }
  /* Pure-JS AES-128 / AES-256 (GCM and CBC) for synchronous kino.crypto.encrypt / decrypt */
  var AES_SBOX = [], AES_INV_SBOX = [], AES_RCON = [0,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];
  (function () {
    var p = 1, q = 1, i;
    for (i = 0; i < 256; i++) { AES_SBOX[i] = 0; AES_INV_SBOX[i] = 0; }
    do {
      p = p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0);
      p &= 0xff;
      q ^= q << 1; q ^= q << 2; q ^= q << 4;
      q ^= (q & 0x80) ? 0x09 : 0;
      q &= 0xff;
      var xformed = q ^ ((q << 1) | (q >>> 7)) ^ ((q << 2) | (q >>> 6)) ^ ((q << 3) | (q >>> 5)) ^ ((q << 4) | (q >>> 4)) ^ 0x63;
      AES_SBOX[p] = xformed & 0xff;
      AES_INV_SBOX[xformed & 0xff] = p;
    } while (p !== 1);
    AES_SBOX[0] = 0x63;
    AES_INV_SBOX[0x63] = 0;
  })();
  function gfMul2(x) { return ((x << 1) ^ ((x & 0x80) ? 0x1b : 0)) & 0xff; }
  function gfMul(x, y) {
    var r = 0, a = x & 0xff, b = y & 0xff;
    while (b > 0) {
      if (b & 1) { r ^= a; }
      a = gfMul2(a);
      b >>>= 1;
    }
    return r;
  }
  function aesExpandKey(key) {
    var nk = key.length >>> 2;
    var nr = nk + 6;
    var totalWords = 4 * (nr + 1);
    var w = new Array(totalWords * 4);
    var i;
    for (i = 0; i < key.length; i++) { w[i] = key[i] & 0xff; }
    for (i = nk; i < totalWords; i++) {
      var t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
      if (i % nk === 0) {
        var tmp = t0;
        t0 = AES_SBOX[t1] ^ AES_RCON[i / nk];
        t1 = AES_SBOX[t2];
        t2 = AES_SBOX[t3];
        t3 = AES_SBOX[tmp];
      } else if (nk > 6 && (i % nk === 4)) {
        t0 = AES_SBOX[t0]; t1 = AES_SBOX[t1]; t2 = AES_SBOX[t2]; t3 = AES_SBOX[t3];
      }
      var p = (i - nk) * 4;
      w[i * 4] = w[p] ^ t0;
      w[i * 4 + 1] = w[p + 1] ^ t1;
      w[i * 4 + 2] = w[p + 2] ^ t2;
      w[i * 4 + 3] = w[p + 3] ^ t3;
    }
    return { w: w, nr: nr };
  }
  function aesEncryptBlock(ek, blk) {
    var s = blk.slice(0, 16), w = ek.w, nr = ek.nr, i, r, t, c, a0, a1, a2, a3;
    for (i = 0; i < 16; i++) { s[i] ^= w[i]; }
    for (r = 1; r <= nr; r++) {
      for (i = 0; i < 16; i++) { s[i] = AES_SBOX[s[i]]; }
      t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (r < nr) {
        for (c = 0; c < 16; c += 4) {
          a0 = s[c]; a1 = s[c + 1]; a2 = s[c + 2]; a3 = s[c + 3];
          s[c] = gfMul2(a0) ^ gfMul2(a1) ^ a1 ^ a2 ^ a3;
          s[c + 1] = a0 ^ gfMul2(a1) ^ gfMul2(a2) ^ a2 ^ a3;
          s[c + 2] = a0 ^ a1 ^ gfMul2(a2) ^ gfMul2(a3) ^ a3;
          s[c + 3] = gfMul2(a0) ^ a0 ^ a1 ^ a2 ^ gfMul2(a3);
        }
      }
      var roff = r * 16;
      for (i = 0; i < 16; i++) { s[i] ^= w[roff + i]; }
    }
    return s;
  }
  function aesDecryptBlock(ek, blk) {
    var s = blk.slice(0, 16), w = ek.w, nr = ek.nr, i, r, t, c, a0, a1, a2, a3;
    for (i = 0; i < 16; i++) { s[i] ^= w[nr * 16 + i]; }
    for (r = nr - 1; r >= 0; r--) {
      t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
      for (i = 0; i < 16; i++) { s[i] = AES_INV_SBOX[s[i]]; }
      var roff = r * 16;
      for (i = 0; i < 16; i++) { s[i] ^= w[roff + i]; }
      if (r > 0) {
        for (c = 0; c < 16; c += 4) {
          a0 = s[c]; a1 = s[c + 1]; a2 = s[c + 2]; a3 = s[c + 3];
          s[c] = gfMul(a0, 14) ^ gfMul(a1, 11) ^ gfMul(a2, 13) ^ gfMul(a3, 9);
          s[c + 1] = gfMul(a0, 9) ^ gfMul(a1, 14) ^ gfMul(a2, 11) ^ gfMul(a3, 13);
          s[c + 2] = gfMul(a0, 13) ^ gfMul(a1, 9) ^ gfMul(a2, 14) ^ gfMul(a3, 11);
          s[c + 3] = gfMul(a0, 11) ^ gfMul(a1, 13) ^ gfMul(a2, 9) ^ gfMul(a3, 14);
        }
      }
    }
    return s;
  }
  function gcmMulBlock(X, Y) {
    var Z = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    var V = Y.slice(0, 16);
    for (var i = 0; i < 128; i++) {
      if ((X[i >>> 3] >>> (7 - (i & 7))) & 1) {
        for (var j = 0; j < 16; j++) { Z[j] ^= V[j]; }
      }
      var lsb = V[15] & 1;
      for (var k = 15; k > 0; k--) { V[k] = ((V[k] >>> 1) | ((V[k - 1] & 1) << 7)) & 0xff; }
      V[0] = (V[0] >>> 1) & 0xff;
      if (lsb) { V[0] ^= 0xe1; }
    }
    return Z;
  }
  function ghash(H, aad, cipher) {
    var Y = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    function feed(arr) {
      for (var i = 0; i < arr.length; i += 16) {
        for (var j = 0; j < 16 && (i + j) < arr.length; j++) { Y[j] ^= arr[i + j] & 0xff; }
        Y = gcmMulBlock(Y, H);
      }
    }
    feed(aad);
    feed(cipher);
    var aBits = aad.length * 8, cBits = cipher.length * 8;
    var lenBlk = [
      0, 0, 0, 0, (aBits >>> 24) & 0xff, (aBits >>> 16) & 0xff, (aBits >>> 8) & 0xff, aBits & 0xff,
      0, 0, 0, 0, (cBits >>> 24) & 0xff, (cBits >>> 16) & 0xff, (cBits >>> 8) & 0xff, cBits & 0xff
    ];
    for (var k = 0; k < 16; k++) { Y[k] ^= lenBlk[k]; }
    return gcmMulBlock(Y, H);
  }
  function inc32Block(blk) {
    var out = blk.slice(0, 16);
    var c = (((out[12] << 24) | (out[13] << 16) | (out[14] << 8) | out[15]) + 1) >>> 0;
    out[12] = (c >>> 24) & 0xff;
    out[13] = (c >>> 16) & 0xff;
    out[14] = (c >>> 8) & 0xff;
    out[15] = c & 0xff;
    return out;
  }
  function kinoAesCrypt(isEncrypt, alg, params) {
    var p = params || {};
    var a = String(alg || '').toLowerCase();
    var keyB = strToBytes(p.key, p.keyEncoding || 'base64');
    var ivB = strToBytes(p.iv, p.ivEncoding || 'base64');
    var inB = strToBytes(p.data, p.inputEncoding || (isEncrypt ? 'utf8' : 'base64'));
    var outEnc = p.outputEncoding || (isEncrypt ? 'base64' : 'utf8');
    var ek = aesExpandKey(keyB);
    var i, j;
    if (a.indexOf('gcm') !== -1) {
      var aadB = p.aad != null ? strToBytes(p.aad, p.aadEncoding || 'utf8') : [];
      var H = aesEncryptBlock(ek, [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
      var J0 = ivB.length === 12 ? ivB.concat([0, 0, 0, 1]) : ghash(H, [], ivB);
      var cipherPart = inB;
      if (!isEncrypt) {
        cipherPart = (p.tag != null || inB.length < 16) ? inB : inB.slice(0, inB.length - 16);
      }
      var ctr = J0, outGcm = [];
      for (i = 0; i < cipherPart.length; i += 16) {
        ctr = inc32Block(ctr);
        var ks = aesEncryptBlock(ek, ctr);
        for (j = 0; j < 16 && (i + j) < cipherPart.length; j++) {
          outGcm.push((cipherPart[i + j] ^ ks[j]) & 0xff);
        }
      }
      if (isEncrypt) {
        var sTag = ghash(H, aadB, outGcm);
        var eJ0 = aesEncryptBlock(ek, J0);
        for (j = 0; j < 16; j++) { outGcm.push((sTag[j] ^ eJ0[j]) & 0xff); }
      }
      return bytesToOut(outGcm, outEnc);
    }
    var noPad = a.indexOf('nopadding') !== -1;
    var prev = ivB.slice(0, 16);
    while (prev.length < 16) { prev.push(0); }
    if (isEncrypt) {
      var padded = inB.slice();
      if (!noPad) {
        var padLen = 16 - (padded.length % 16);
        for (i = 0; i < padLen; i++) { padded.push(padLen); }
      }
      var outCbc = [];
      for (i = 0; i < padded.length; i += 16) {
        var blk = [];
        for (j = 0; j < 16; j++) { blk.push(((padded[i + j] || 0) ^ prev[j]) & 0xff); }
        prev = aesEncryptBlock(ek, blk);
        for (j = 0; j < 16; j++) { outCbc.push(prev[j]); }
      }
      return bytesToOut(outCbc, outEnc);
    } else {
      var decCbc = [];
      for (i = 0; i < inB.length; i += 16) {
        var cBlk = inB.slice(i, i + 16);
        while (cBlk.length < 16) { cBlk.push(0); }
        var dBlk = aesDecryptBlock(ek, cBlk);
        for (j = 0; j < 16; j++) { decCbc.push((dBlk[j] ^ prev[j]) & 0xff); }
        prev = cBlk;
      }
      if (!noPad && decCbc.length >= 16) {
        var pVal = decCbc[decCbc.length - 1];
        if (pVal >= 1 && pVal <= 16) { decCbc = decCbc.slice(0, decCbc.length - pVal); }
      }
      return bytesToOut(decCbc, outEnc);
    }
  }

  function htmlSelect(html, css) {
    if (typeof DOMParser === 'undefined') { return []; }
    try {
      var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
      var nodes = doc.querySelectorAll(String(css || ''));
      var res = [];
      for (var i = 0; i < nodes.length && i < 500; i++) {
        var elNode = nodes[i];
        var attrs = {};
        if (elNode.attributes) {
          for (var a = 0; a < elNode.attributes.length; a++) {
            attrs[elNode.attributes[a].name] = elNode.attributes[a].value;
          }
        }
        res.push({
          tag: (elNode.tagName || '').toLowerCase(),
          text: elNode.textContent || '',
          html: elNode.innerHTML || '',
          attrs: attrs
        });
      }
      return res;
    } catch (e) {
      return [];
    }
  }
  function rankTokens(s) {
    var clean = norm(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();
    return clean ? clean.split(/\s+/) : [];
  }
  function rankScoreItem(it, qTokens, qStr, optYear) {
    var tStr = norm(String((it && (it.title || it.name)) || '')).replace(/[^a-z0-9]+/g, ' ').trim();
    var tTokens = tStr ? tStr.split(/\s+/) : [];
    if (!qTokens.length || !tTokens.length) { return 0; }
    var inter = 0, i;
    for (i = 0; i < qTokens.length; i++) {
      if (tTokens.indexOf(qTokens[i]) !== -1) { inter++; }
    }
    var union = qTokens.length + tTokens.length - inter;
    var jaccard = union > 0 ? inter / union : 0;
    var prefixBonus = tStr.indexOf(qStr) === 0 ? 0.15 : 0;
    var yearBonus = (optYear && it && it.year && Number(it.year) === Number(optYear)) ? 0.1 : 0;
    return Math.min(1, jaccard + prefixBonus + yearBonus);
  }

  /* ----------------------------------------------------------- cookies */
  /* The app keeps the jar (it adds and saves cookies around each request);
     a copy arrives here with every answer, for kino.cookies.get(). */
  var jar = {};
  function cookieHostFrom(urlOrDomain) {
    var s = String(urlOrDomain || '').trim().toLowerCase();
    var m = /^https?:\/\/([^\/:?#]+)/i.exec(s);
    if (m) { s = m[1]; }
    return s.replace(/^\.+/, '').replace(/:\d+$/, '');
  }
  function cookiesForHost(urlOrDomain) {
    var hostName = cookieHostFrom(urlOrDomain);
    if (!hostName) { return ''; }
    var merged = {};
    for (var dom in jar) {
      if (!Object.prototype.hasOwnProperty.call(jar, dom)) { continue; }
      if (hostName === dom || (hostName.length > dom.length && hostName.slice(-(dom.length + 1)) === '.' + dom)) {
        var map = jar[dom] || {};
        for (var k in map) {
          if (Object.prototype.hasOwnProperty.call(map, k)) { merged[k] = map[k]; }
        }
      }
    }
    var pairs = [];
    for (var ck in merged) {
      if (Object.prototype.hasOwnProperty.call(merged, ck)) { pairs.push(ck + '=' + merged[ck]); }
    }
    return pairs.join('; ');
  }

  /* ------------------------------------------------------------ kino */
  function buildKino(key, setup) {
    var store = setup.storage || {};
    var cfgValues = setup.config || {};
    function fetchVia(url, opts) {
      opts = opts || {};
      var o = {
        method: opts.method, headers: opts.headers, redirect: opts.redirect, timeoutMs: opts.timeoutMs,
        body: typeof opts.body === 'string' ? opts.body : null,
        bodyBase64: opts.body && opts.body.base64 !== undefined ? String(opts.body.base64) : null,
        bodyJson: opts.body && opts.body.json !== undefined ? opts.body.json : undefined,
        bodyForm: opts.body && opts.body.form && typeof opts.body.form === 'object' ? opts.body.form : null,
        maxBytes: typeof opts.maxBytes === 'number' ? opts.maxBytes : undefined
      };
      return ask('fetch', key, { url: String(url || ''), opts: o }).then(function (r) {
        r = r || {};
        if (!r.status && r.error) { throw fetchFailure(r); }
        var text = typeof r.text === 'string' ? r.text : '';
        var b64 = typeof r.base64 === 'string' ? r.base64 : '';
        return {
          ok: !!r.ok,
          status: r.status || 0,
          url: r.url || String(url || ''),
          headers: r.headers || {},
          text: function () { return text; },
          json: function () { return JSON.parse(text); },
          base64: function () { return b64; }
        };
      });
    }
    function browserRun(url, opts, returnHtml) {
      opts = opts || {};
      var matchSource = '', matchFlags = 'i';
      if (opts.match instanceof RegExp) { matchSource = opts.match.source; matchFlags = opts.match.flags || 'i'; }
      else if (typeof opts.match === 'string' && opts.match) { matchSource = opts.match; }
      return ask('browser', key, {
        url: String(url || '').trim(), matchSource: matchSource, matchFlags: matchFlags,
        timeoutMs: opts.timeoutMs || 15000, waitMs: opts.waitMs || 350, headers: opts.headers || {},
        returnHtml: !!returnHtml
      });
    }
    return {
      apiVersion: 30,
      appVersion: setup.appVersion || '',
      lang: 'es-MX',
      error: codedError,
      log: function () {},
      fetch: fetchVia,
      tmdb: function (route, params) { return ask('tmdb', key, { route: String(route || ''), params: params || {} }); },
      crypto: {
        hash: function (alg, data, o) {
          var p = o || {};
          return bytesToOut(sha256Bytes(strToBytes(data, p.inputEncoding || 'utf8')), p.outputEncoding || 'hex');
        },
        hmac: function (alg, k, data, o) {
          var p = o || {};
          return bytesToOut(hmacSha256Bytes(strToBytes(k, p.keyEncoding || 'utf8'), strToBytes(data, p.inputEncoding || 'utf8')), p.outputEncoding || 'hex');
        },
        encrypt: function (alg, params) { return kinoAesCrypt(true, alg, params); },
        decrypt: function (alg, params) { return kinoAesCrypt(false, alg, params); },
        randomBytes: function (count, outEnc) {
          var n = Math.min(1024, Math.max(1, Number(count) || 16)), b = [];
          for (var i = 0; i < n; i++) { b.push(randomByte()); }
          return bytesToOut(b, outEnc || 'hex');
        },
        uuid: function () {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var r = randomByte() & 15;
            return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
          });
        }
      },
      sleep: function (ms) {
        return new Promise(function (r) { setTimeout(r, Math.min(10000, Math.max(0, Number(ms) || 0))); });
      },
      html: { select: htmlSelect },
      /* The plugin's own saved values: a copy in memory (read at once), each
         change also saved by the app under this plugin's prefix. */
      storage: {
        get: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        set: function (k, v) { k = String(k); store[k] = String(v); ask('storageSet', key, { k: k, v: String(v) }); },
        remove: function (k) { k = String(k); delete store[k]; ask('storageRemove', key, { k: k }); },
        keys: function () { return Object.keys(store); }
      },
      config: {
        get: function (k) { k = String(k || ''); return Object.prototype.hasOwnProperty.call(cfgValues, k) ? cfgValues[k] : undefined; },
        all: function () { var copy = {}; for (var k in cfgValues) { if (Object.prototype.hasOwnProperty.call(cfgValues, k)) { copy[k] = cfgValues[k]; } } return copy; }
      },
      cookies: {
        get: function (domain) { return cookiesForHost(domain) || null; },
        clear: function (domain) {
          if (!domain) { jar = {}; }
          else {
            var h = cookieHostFrom(domain);
            for (var dom in jar) {
              if (Object.prototype.hasOwnProperty.call(jar, dom) && (dom === h || h.slice(-(dom.length + 1)) === '.' + dom)) { delete jar[dom]; }
            }
          }
          ask('cookiesClear', key, { domain: domain ? String(domain) : '' });
        }
      },
      browser: {
        capture: function (url, opts) { return browserRun(url, opts, false); },
        load: function (url, opts) { return browserRun(url, opts, true); },
        /* `browser: "pages"`: the rendered HTML of a page (Cloudflare checks...). */
        page: function (url, opts) {
          opts = opts || {};
          var o = { timeoutMs: opts.timeoutMs, waitMs: opts.waitMs };
          if (opts.userAgent) { o.headers = { 'User-Agent': String(opts.userAgent) }; }
          return browserRun(url, o, true).then(function (r) {
            if (!r || !r.ok || typeof r.html !== 'string') {
              throw codedError('unavailable', (r && r.error) || 'No se pudo abrir la página');
            }
            return { url: r.url || String(url || ''), html: r.html };
          });
        }
      },
      meta: {
        byTitle: function () { return Promise.resolve(null); }
      },
      plugins: {
        /* Calls another plugin's door (`provides.<door>.calls.<fn>`), e.g. the
           shared "resolver". The app finds the provider and runs it in its
           OWN sandbox under its own key, passing only plain data. */
        call: function (door, fn, args) {
          return ask('pluginCall', key, { door: String(door || ''), fn: String(fn || ''), args: args === undefined ? null : args });
        }
      },
      rank: {
        shortQuery: function (q) {
          var text = String(q || '').trim();
          var head = text.split(/[:,|–—]/)[0].trim();
          return head.length >= 3 ? head : text;
        },
        sortBySimilarity: function (items, query, options) {
          if (!Array.isArray(items)) { return []; }
          var qTokens = rankTokens(query);
          var qStr = qTokens.join(' ');
          var optYear = options && options.year;
          return items.map(function (it, idx) {
            return { it: it, idx: idx, s: rankScoreItem(it, qTokens, qStr, optYear) };
          }).sort(function (a, b) { return (b.s - a.s) || (a.idx - b.idx); }).map(function (x) { return x.it; });
        },
        filterRelevant: function (items, query, options) {
          if (!Array.isArray(items)) { return []; }
          var minScore = (options && options.minScore !== undefined) ? Number(options.minScore) : 0.25;
          var qTokens = rankTokens(query);
          var qStr = qTokens.join(' ');
          return items.filter(function (it) { return rankScoreItem(it, qTokens, qStr, null) >= minScore; });
        }
      }
    };
  }

  /* --------------------------------------------------------- messages */
  var CALLABLE = ['home', 'search', 'episodes', 'resolve', 'details'];
  /* Door entry points (`proto_<door>_<call>`), called by the app on behalf of
     another plugin's kino.plugins.call(). */
  var DOOR_FN = /^proto_[A-Za-z0-9]{1,32}_[A-Za-z0-9]{1,32}$/;
  function callable(name) { return CALLABLE.indexOf(name) !== -1 || DOOR_FN.test(String(name)); }
  function errorReply(id, e, fallback) {
    var out = { kind: 'reply', id: id, error: (e && e.message) || String(e || fallback) };
    if (e && typeof e.code === 'string') { out.code = e.code; }
    if (e && typeof e.userMessage === 'string') { out.userMessage = e.userMessage; }
    return out;
  }

  function load(msg) {
    if (exposed) {
      return post({
        kind: 'reply', id: msg.id, error: 'Este aparato no puede aislar los plugins JS', code: 'unsupported',
        userMessage: 'este equipo no puede aislar los plugins de forma segura'
      });
    }
    if (boundKey !== null && msg.key !== boundKey) {
      return post({ kind: 'reply', id: msg.id, error: 'Cada plugin corre en su propio entorno aislado', code: 'unsupported' });
    }
    boundKey = msg.key;
    try {
      if (msg.jar && typeof msg.jar === 'object') { jar = msg.jar; }
      var exportsObj = {};
      var fn = new Function('kino', '__exports', 'globalThis', transformEsmToCommon(msg.code));
      var kinoObj = buildKino(msg.key, msg.setup || {});
      fn(kinoObj, exportsObj, shadowGlobal(kinoObj));
      var names = [];
      for (var en in exportsObj) {
        if (Object.prototype.hasOwnProperty.call(exportsObj, en) && callable(en) && typeof exportsObj[en] === 'function') { names.push(en); }
      }
      instances[msg.key] = { exports: exportsObj, names: names };
      post({ kind: 'reply', id: msg.id, value: { names: names } });
    } catch (e) {
      post({ kind: 'reply', id: msg.id, error: 'Este aparato no pudo compilar el plugin JS: ' + (e && e.message ? e.message : e) });
    }
  }

  function call(msg) {
    var inst = instances[msg.key];
    if (!inst || !callable(msg.fn) || typeof inst.exports[msg.fn] !== 'function') {
      return post({ kind: 'reply', id: msg.id, error: 'El plugin no tiene ' + msg.fn, code: 'provider_missing' });
    }
    var out;
    try { out = inst.exports[msg.fn].apply(null, Array.isArray(msg.args) ? msg.args : []); }
    catch (e) { return post(errorReply(msg.id, e, 'Error del plugin')); }
    Promise.resolve(out).then(function (value) {
      post({ kind: 'reply', id: msg.id, value: plain(value) });
    }, function (e) {
      post(errorReply(msg.id, e, 'Error del plugin'));
    });
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== host) { return; }
    var m = ev.data;
    if (!m || m.opentvPlugin !== 1) { return; }
    if (m.kind === 'answer') {
      var a = asks[m.id];
      if (!a) { return; }
      delete asks[m.id];
      if (m.jar && typeof m.jar === 'object') { jar = m.jar; }
      if (m.error) { a.reject(codedError(m.code || 'error', m.error, m)); } else { a.resolve(m.value); }
    } else if (m.kind === 'load') {
      load(m);
    } else if (m.kind === 'call') {
      call(m);
    } else if (m.kind === 'unload') {
      delete instances[m.key];
    }
  });

  /* (Tests: kino built outside the frame. One plugin per frame.) */
  window.__opentvKino = { build: buildKino };
  post({ kind: 'ready', exposed: exposed });
}());
