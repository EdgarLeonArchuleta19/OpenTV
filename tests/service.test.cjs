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
