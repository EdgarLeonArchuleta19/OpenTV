'use strict';
/* Local service pieces that work offline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

test('the duration probe also lists the audio tracks with language and title', () => {
  const md = require(path.join(ROOT, 'service', 'media-duration.js'));
  const out = [
    "Input #0, matroska,webm, from 'http://127.0.0.1:1/t/x/peli.mkv':",
    '  Duration: 01:52:10.05, start: 0.000000, bitrate: 4000 kb/s',
    '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 23.98 fps (default)',
    '  Stream #0:1(spa): Audio: ac3, 48000 Hz, 5.1(side), fltp, 640 kb/s (default)',
    '    Metadata:',
    '      title           : Latino',
    '  Stream #0:2(spa): Audio: aac (LC), 48000 Hz, stereo, fltp',
    '    Metadata:',
    '      title           : Castellano',
    '  Stream #0:3(eng): Audio: eac3, 48000 Hz, 5.1(side), fltp',
    '  Stream #0:4(spa): Subtitle: subrip',
    '    Metadata:',
    '      title           : Forzados',
    'At least one output file must be specified'
  ].join('\n');
  assert.deepEqual(md.audioTracks(out), [
    { lang: 'spa', title: 'Latino', codec: 'ac3', channels: '5.1', default: true },
    { lang: 'spa', title: 'Castellano', codec: 'aac', channels: 'stereo', default: false },
    { lang: 'eng', title: '', codec: 'eac3', channels: '5.1', default: false }
  ]);
});

test('download file names are safe for Windows', () => {
  const dl = require(path.join(ROOT, 'service', 'downloads.js'));
  assert.equal(dl.safeName('Misión: Imposible / Parte 1?'), 'Misión Imposible Parte 1');
  assert.equal(dl.safeName('   '), 'Video');
  assert.equal(dl.safeName('Nombre.'), 'Nombre');
});

test('M3U lists become channels with logo, group and stream', () => {
  const m3u = require(path.join(ROOT, 'service', 'm3u.js'));
  const list = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="https://x/logo.png" group-title="Noticias",Canal Uno',
    'https://example.test/uno.m3u8',
    '#EXTINF:-1,Sin logo',
    '#EXTVLCOPT:http-user-agent=Test',
    'https://example.test/dos.m3u8',
    'https://example.test/huerfano.m3u8'
  ].join('\r\n');
  const channels = m3u.parseM3u(list);
  assert.equal(channels.length, 2);
  assert.deepEqual(
    { name: channels[0].name, logo: channels[0].logo, group: channels[0].group, url: channels[0].streamUrl, code: channels[0].channelCode },
    { name: 'Canal Uno', logo: 'https://x/logo.png', group: 'Noticias', url: 'https://example.test/uno.m3u8', code: 'm3u_1' });
  assert.equal(channels[1].name, 'Sin logo');
  assert.equal(channels[1].group, 'Addon');
});

test('the OpenSubtitles hash matches the reference algorithm', () => {
  const vh = require(path.join(ROOT, 'service', 'video-hash.js'));
  const head = Buffer.alloc(65536), tail = Buffer.alloc(65536);
  for (let i = 0; i < 65536; i++) { head[i] = (i * 31) & 255; tail[i] = (i * 17 + 5) & 255; }
  const size = 5000000123;
  let sum = BigInt(size);
  for (const b of [head, tail]) { for (let i = 0; i < b.length; i += 8) { sum += b.readBigUInt64LE(i); } }
  const ref = (sum & 0xffffffffffffffffn).toString(16).padStart(16, '0');
  assert.equal(vh.compute(head, tail, size), ref);
});

test('torrents: tracker lists are read safely and race candidates are unique, valid and capped', () => {
  const t = require('../service/torrents.js');
  assert.deepEqual(t._parseTrackers('udp://a.org:1/announce\n\nnot a tracker\nhttp://b.org/announce\r\nudp://a.org:1/announce\nfile:///etc/passwd'),
    ['udp://a.org:1/announce', 'http://b.org/announce']);
  const h = (c) => c.repeat(40);
  const c = t._candidatesFrom({ infoHash: h('a'), alternatives: [{ infoHash: h('a') }, { infoHash: 'xyz' }, { infoHash: h('b') }, { infoHash: h('c') }, { infoHash: h('d') }, { infoHash: h('e') }] });
  assert.deepEqual(c.map((x) => x.hash[0]), ['a', 'b', 'c', 'd']);
});

test('torrents: in a season pack the episode plays, not the biggest file', () => {
  const t = require('../service/torrents.js');
  const files = [
    { name: 'Show.S01E01.1080p.mkv', length: 900 },
    { name: 'Show.S01E02.1080p.mkv', length: 1500 },
    { name: 'Show.S01E10.1080p.mkv', length: 800 },
    { name: 'Show.S01E10.sample.mkv', length: 50 },
    { name: 'notes.txt', length: 5 }
  ];
  /* The addon's fileIdx wins. */
  assert.equal(t._pickFile(files, { fileIdx: 0 }).name, 'Show.S01E01.1080p.mkv');
  /* No fileIdx: the addon's file name, then the episode's (not S01E01 for E10, nor the sample). */
  assert.equal(t._pickFile(files, { filename: 'Pack/Show.S01E01.1080p.mkv' }).name, 'Show.S01E01.1080p.mkv');
  assert.equal(t._pickFile(files, { season: 1, episode: 10 }).name, 'Show.S01E10.1080p.mkv');
  assert.equal(t._pickFile(files, { season: 1, episode: 1 }).name, 'Show.S01E01.1080p.mkv');
  assert.equal(t._pickFile([{ name: 'show.1x02.avi', length: 1 }, { name: 'show.1x03.avi', length: 9 }], { season: 1, episode: 2 }).name, 'show.1x02.avi');
  /* A film (nothing to match): the biggest video. */
  assert.equal(t._pickFile(files, {}).name, 'Show.S01E02.1080p.mkv');
});

test('epg: the Programación of one channel keeps only that channel, more programmes', () => {
  const epg = require('../service/epg.js');
  const p2 = (n) => String(n).padStart(2, '0');
  const t = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + '00 +0000'; };
  const now = Date.now();
  let xml = '<tv>';
  for (let i = 0; i < 20; i++) {
    const s = now + i * 30 * 60e3 - 10 * 60e3;
    xml += '<programme channel="c1" start="' + t(s) + '" stop="' + t(s + 30 * 60e3) + '"><title>P' + i + '</title></programme>';
    xml += '<programme channel="c2" start="' + t(s) + '" stop="' + t(s + 30 * 60e3) + '"><title>Q' + i + '</title></programme>';
  }
  xml += '</tv>';
  const shared = {};
  const r1 = epg._makeReader(shared); r1.write(xml); r1.end();
  assert.equal(shared.c1.length, 10);
  const one = {};
  const r2 = epg._makeReader(one, { only: 'c1', cap: 60 }); r2.write(xml); r2.end();
  assert.deepEqual(Object.keys(one), ['c1']);
  assert.equal(one.c1.length, 20);
  assert.equal(one.c1[0].t, 'P0');
});

test('epg: XMLTV times, the guide link of a list and what is on now and next', () => {
  const epg = require('../service/epg.js');
  const m3u = require('../service/m3u.js');
  assert.equal(epg._xmltvTime('20261119050428 +0000'), Date.UTC(2026, 10, 19, 5, 4, 28));
  assert.equal(epg._xmltvTime('20261119050000 -0600'), Date.UTC(2026, 10, 19, 11, 0, 0));
  assert.equal(epg._unescapeXml('Tom &amp; Jerry &#233;  <![CDATA[x]]>'), 'Tom & Jerry é x');
  const list = m3u.parseM3u('#EXTM3U url-tvg="https://g.example/mx.xml.gz,https://other/x.xml"\n#EXTINF:-1 tvg-id="c1" group-title="Cine",Canal 1\nhttp://s/1.m3u8\n');
  assert.equal(list[0].epg, 'https://g.example/mx.xml.gz');
  assert.equal(list[0].tvgId, 'c1');
  const t = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + '00 +0000'; };
  const now = Date.now();
  const byId = {};
  const r = epg._makeReader(byId);
  const xml = '<tv><programme channel="c1" start="' + t(now - 3600e3) + '" stop="' + t(now - 1800e3) + '"><title>Ya pasó</title></programme>' +
    '<programme channel="c1" start="' + t(now - 600e3) + '" stop="' + t(now + 1800e3) + '"><title lang="es">Ahora &amp; aquí</title><desc>Algo</desc></programme>' +
    '<programme channel="c1" start="' + t(now + 1800e3) + '" stop="' + t(now + 3600e3) + '"><title>Después</title></programme></tv>';
  /* Split in odd places: blocks across pieces still parse. */
  r.write(xml.slice(0, 77)); r.write(xml.slice(77, 300)); r.write(xml.slice(300)); r.end();
  assert.deepEqual(byId.c1.map((p) => p.t), ['Ahora & aquí', 'Después']);
  assert.equal(byId.c1[0].d, 'Algo');
});

test('netguard: never this device, the home network only when allowed, checked by address', async () => {
  const g = require('../service/netguard.js');
  const kinds = {
    '127.0.0.1': 'loopback', '127.8.9.1': 'loopback', '::1': 'loopback', '[::1]': 'loopback', '::ffff:127.0.0.1': 'loopback',
    '10.0.0.5': 'lan', '172.16.0.1': 'lan', '172.31.255.1': 'lan', '192.168.1.69': 'lan', '169.254.1.1': 'lan',
    '100.64.0.1': 'lan', 'fd00::1': 'lan', 'fe80::1': 'lan',
    '0.0.0.0': 'blocked', '224.0.0.1': 'blocked', '255.255.255.255': 'blocked', '::': 'blocked', 'ff02::1': 'blocked', '999.1.1.1': 'blocked',
    '172.32.0.1': 'public', '8.8.8.8': 'public', '2606:4700::1111': 'public'
  };
  for (const ip of Object.keys(kinds)) assert.equal(g.classify(ip), kinds[ip], ip);
  const check = (host, lan) => new Promise((resolve) => g.check(host, lan, (err, ip) => resolve(err ? 'refused' : ip)));
  assert.equal(await check('localhost', true), 'refused');
  assert.equal(await check('127.0.0.1', true), 'refused');
  assert.equal(await check('192.168.1.69', false), 'refused');
  assert.equal(await check('192.168.1.69', true), '192.168.1.69');
  assert.equal(await check('8.8.8.8', false), '8.8.8.8');
});

test('ffmpeg-tls: HTTPS is verified; a host whose certificate failed is asked again without it', () => {
  const tls = require('../service/ffmpeg-tls.js');
  assert.deepEqual(tls.args('http://a.example/v.mp4'), []);
  assert.deepEqual(tls.args('https://cdn.example/v.mp4'), ['-tls_verify', '1']);
  assert.equal(tls.noteFailure('https://cdn.example/v.mp4', 'Connection refused'), false);
  assert.equal(tls.noteFailure('https://cdn.example/v.mp4', 'error:0A000086:SSL routines::certificate verify failed'), true);
  assert.deepEqual(tls.args('https://cdn.example/other.mp4'), ['-tls_verify', '0']);
  assert.deepEqual(tls.args('https://other.example/v.mp4'), ['-tls_verify', '1']);
});

test('PC: the app page reads media from servers that allow only their own site', () => {
  const cors = require(path.join(ROOT, 'platforms', 'electron', 'media-cors.cjs'));
  const on = {};
  const ses = { webRequest: {} };
  ['onBeforeSendHeaders', 'onHeadersReceived', 'onCompleted', 'onErrorOccurred'].forEach((n) => { ses.webRequest[n] = (fn) => { on[n] = fn; }; });
  cors.install(ses);
  const send = (id, origin) => on.onBeforeSendHeaders({ id, url: 'https://tv.example/a.m3u8', requestHeaders: origin ? { Origin: origin } : {} }, () => {});
  const answer = (id) => {
    let out = null;
    on.onHeadersReceived({ id, responseHeaders: { 'access-control-allow-origin': ['http://pluto.tv'], 'Access-Control-Allow-Credentials': ['true'], 'Content-Type': ['x'] } }, (r) => { out = r; });
    return out;
  };
  send(1, 'opentv://app');
  const r1 = answer(1);
  assert.deepEqual(r1.responseHeaders['Access-Control-Allow-Origin'], ['*']);
  assert.equal(r1.responseHeaders['access-control-allow-origin'], undefined);
  assert.equal(r1.responseHeaders['Access-Control-Allow-Credentials'], undefined);
  assert.deepEqual(r1.responseHeaders['Content-Type'], ['x']);
  /* A redirect hop keeps the same id. */
  assert.deepEqual(answer(1).responseHeaders['Access-Control-Allow-Origin'], ['*']);
  on.onCompleted({ id: 1 });
  assert.deepEqual(answer(1), {});
  /* The JS plugins' page (Origin null) and other requests are left alone. */
  send(2, 'null');
  assert.deepEqual(answer(2), {});
  send(3, '');
  assert.deepEqual(answer(3), {});
});
