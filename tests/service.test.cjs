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
