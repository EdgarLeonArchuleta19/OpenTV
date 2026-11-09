'use strict';
/* Local service pieces that work offline. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');

test('M3U lists become channels with logo, group and stream', () => {
  const magis = require(path.join(ROOT, 'service', 'magis.js'));
  const list = [
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="https://x/logo.png" group-title="Noticias",Canal Uno',
    'https://example.test/uno.m3u8',
    '#EXTINF:-1,Sin logo',
    '#EXTVLCOPT:http-user-agent=Test',
    'https://example.test/dos.m3u8',
    'https://example.test/huerfano.m3u8'
  ].join('\r\n');
  const channels = magis.parseM3u(list);
  assert.equal(channels.length, 2);
  assert.deepEqual(
    { name: channels[0].name, logo: channels[0].logo, group: channels[0].group, url: channels[0].streamUrl, code: channels[0].channelCode },
    { name: 'Canal Uno', logo: 'https://x/logo.png', group: 'Noticias', url: 'https://example.test/uno.m3u8', code: 'm3u_1' });
  assert.equal(channels[1].name, 'Sin logo');
  assert.equal(channels[1].group, 'Addon');
});

test('the bundled catalogue snapshot is valid and has every home section', () => {
  const file = path.join(ROOT, 'ui', 'data', 'portal.js');
  const sandbox = { window: {} };
  require('node:vm').runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  const snap = sandbox.window.XUPERTV_PORTAL;
  assert.ok(snap && Array.isArray(snap.items) && snap.items.length > 100, 'snapshot has items');
  const cats = new Set(snap.items.flatMap((i) => String(i.category || '').split(',')));
  for (const c of ['destacado', 'pelicula', 'serie', 'infantil', 'anime']) assert.ok(cats.has(c), 'section ' + c);
  for (const item of snap.items.slice(0, 50)) {
    assert.ok(item.id && item.title, 'item has id and title');
    assert.ok(/^https:\/\//.test(item.poster || 'https://'), 'poster is https');
  }
});
