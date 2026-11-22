'use strict';
/*
 * SubtitleCat (https://www.subtitlecat.com) online subtitle search fallback.
 *
 * Looks up the title's original English release name via Cinemeta when an
 * IMDb id is known, searches SubtitleCat for the movie ("Title Year") or
 * episode ("Title SxxEyy"), ranks matching releases by words shared with the
 * playing filename, and returns direct .srt links for Spanish and English.
 */

var https = require('https');
var urlmod = require('url');
var dnsx = require('./dnsx');

var BASE = 'https://www.subtitlecat.com';
var PAGES = 2;
var PER_LANG = 3;
var titleCache = {};

var STOP = { the: 1, a: 1, an: 1, of: 1, and: 1, el: 1, la: 1, los: 1, las: 1, de: 1, y: 1 };
var NAMES = {
  english: 'en', spanish: 'es', portuguese: 'pt', french: 'fr', german: 'de',
  italian: 'it', dutch: 'nl', russian: 'ru', japanese: 'ja', korean: 'ko'
};

function unescapeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
}

function foldAccents(s) {
  var str = String(s || '');
  if (typeof str.normalize === 'function') {
    str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return str.toLowerCase();
}

function titleWords(title) {
  return foldAccents(title).split(/[^a-z0-9]+/).filter(function (w) { return w && !STOP[w]; });
}

function tokens(s) {
  return String(s || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '')
    .split(/[^a-z0-9]+/).filter(function (t) { return t.length > 1; });
}

function httpGetText(targetUrl, timeoutMs, cb, redirects) {
  var done = false;
  function finish(err, text) { if (!done) { done = true; cb(err, text || ''); } }
  redirects = redirects || 0;
  if (redirects > 3) { return finish(new Error('redirects')); }
  var opts = urlmod.parse(targetUrl);
  opts.method = 'GET';
  opts.headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
    'Accept': 'text/html,application/json,*/*'
  };
  dnsx.prepare(opts, function (prepErr, prepped) {
    if (prepErr) { return finish(prepErr); }
    var req = https.get(prepped, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpGetText(urlmod.resolve(targetUrl, res.headers.location), timeoutMs, finish, redirects + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return finish(new Error('HTTP ' + res.statusCode));
      }
      var chunks = [], size = 0;
      res.on('data', function (c) {
        size += c.length;
        if (size <= 512 * 1024) { chunks.push(c); }
      });
      res.on('end', function () { finish(null, Buffer.concat(chunks).toString('utf8')); });
    });
    req.setTimeout(timeoutMs || 4500, function () { try { req.abort(); } catch (e) {} finish(new Error('timeout')); });
    req.on('error', function (e) { finish(e); });
  });
}

function originalTitle(imdbId, kind, cb) {
  var clean = String(imdbId || '').split(':')[0];
  if (!/^tt\d{5,10}$/.test(clean)) { return cb(null); }
  if (titleCache[clean]) { return cb(titleCache[clean]); }
  var type = kind === 'series' ? 'series' : 'movie';
  httpGetText('https://v3-cinemeta.strem.io/meta/' + type + '/' + clean + '.json', 2500, function (err, text) {
    if (err || !text) { return cb(null); }
    try {
      var json = JSON.parse(text);
      var name = json && json.meta && json.meta.name;
      if (typeof name === 'string' && name.trim()) {
        titleCache[clean] = name.trim();
        return cb(titleCache[clean]);
      }
    } catch (e) {}
    cb(null);
  });
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function queryFor(a) {
  var title = foldAccents(a.title || '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) { return ''; }
  var s = parseInt(a.season, 10) || 0, e = parseInt(a.episode, 10) || 0;
  if (a.kind === 'series' && s > 0 && e > 0) {
    return title + ' S' + pad2(s) + 'E' + pad2(e);
  }
  return a.year && /^\d{4}$/.test(String(a.year)) ? (title + ' ' + a.year) : title;
}

function parseResults(html) {
  var out = [];
  var re = /<a href="(subs\/\d+\/[^"]+\.html)">([^<]{1,300})<\/a>\s*(?:\(translated from ([A-Za-z ]+)\))?/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var fromLang = NAMES[String(m[3] || '').trim().toLowerCase()] || '';
    out.push({ path: unescapeHtml(m[1]), release: unescapeHtml(m[2]).trim(), from: fromLang });
  }
  return out;
}

function rankRows(rows, a) {
  var s = parseInt(a.season, 10) || 0, e = parseInt(a.episode, 10) || 0;
  var sxe = (a.kind === 'series' && s > 0 && e > 0)
    ? new RegExp('s0?' + s + '[ ._-]?e0?' + e + '(?!\\d)', 'i') : null;
  var year = (a.kind !== 'series' && a.year && /^\d{4}$/.test(String(a.year))) ? String(a.year) : '';
  var words = titleWords(a.title);
  var kept = rows.filter(function (r) {
    var relWords = titleWords(r.release);
    if (!words.length) { return false; }
    for (var i = 0; i < words.length; i++) {
      if (relWords.indexOf(words[i]) === -1) { return false; }
    }
    if (sxe) { return sxe.test(r.release); }
    return year ? r.release.indexOf(year) !== -1 : true;
  });
  var fileTokens = tokens(a.filename);
  function score(r) {
    if (!fileTokens.length) { return 0; }
    var rt = tokens(r.release), hits = 0;
    for (var i = 0; i < rt.length; i++) {
      if (fileTokens.indexOf(rt[i]) !== -1) { hits++; }
    }
    return hits;
  }
  return kept.map(function (r, idx) { return { r: r, idx: idx, s: score(r) }; })
    .sort(function (x, y) { return (y.s - x.s) || (x.idx - y.idx); })
    .map(function (x) { return x.r; });
}

function parseFiles(html) {
  var out = [], seen = {};
  var re = /href="(\/subs\/\d+\/[^"]+?-([a-z]{2,3})(?:-([A-Za-z0-9]{2,4}))?\.srt)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (m[2] === 'orig' || seen[m[1]]) { continue; }
    seen[m[1]] = 1;
    out.push({
      lang: m[2],
      region: m[3] || '',
      url: BASE + encodeURI(unescapeHtml(m[1])).replace(/%25/g, '%')
    });
  }
  return out;
}

function search(args, callback) {
  args = args || {};
  originalTitle(args.imdbId, args.kind, function (orig) {
    var a = {
      imdbId: args.imdbId || '',
      title: orig || args.title || '',
      year: args.year || '',
      kind: args.kind === 'series' ? 'series' : 'movie',
      season: args.season || 0,
      episode: args.episode || 0,
      filename: args.filename || ''
    };
    var q = queryFor(a);
    if (!q) { return callback(null, []); }
    httpGetText(BASE + '/index.php?search=' + encodeURIComponent(q), 4500, function (err, html) {
      if (err || !html) { return callback(null, []); }
      var rows = rankRows(parseResults(html), a).slice(0, PAGES);
      if (!rows.length) { return callback(null, []); }
      var pages = [], left = rows.length;
      rows.forEach(function (row, idx) {
        httpGetText(BASE + '/' + row.path.replace(/^\//, ''), 4500, function (pErr, pHtml) {
          pages[idx] = (!pErr && pHtml) ? parseFiles(pHtml) : [];
          if (--left > 0) { return; }
          var wanted = ['es', 'en'];
          var out = [], perLang = {};
          wanted.forEach(function (lang) {
            rows.forEach(function (r, rIdx) {
              (pages[rIdx] || []).forEach(function (f) {
                if (f.lang !== lang) { return; }
                if ((perLang[lang] || 0) >= PER_LANG) { return; }
                perLang[lang] = (perLang[lang] || 0) + 1;
                var translated = !!(r.from && r.from !== lang);
                var code = f.region === '419' ? (lang + '-419') : (translated ? (lang + '-gt') : lang);
                out.push({ lang: code, url: f.url });
              });
            });
          });
          callback(null, out);
        });
      });
    });
  });
}

module.exports = { search: search };
