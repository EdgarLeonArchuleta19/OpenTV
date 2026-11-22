'use strict';
/* Downloads from the detail page: what is sent to the service. No network:
   the source picker, the JS plugin bridge and the service are stubs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./helpers/load-modules.cjs');

function load(pick, resolver) {
  const calls = { start: [], notices: [], resolved: [] };
  const ctx = loadModules(['player/downloads.js'], {
    platformHas: () => true,
    $: () => null,
    isSeriesItem: () => false,
    stremioTargetId: (item) => 'movie:' + item.id,
    durationToSeconds: () => 0,
    showToast: () => {},
    openSettingsAt: () => {},
    openSourcePicker: (item, episode, done) => done(pick),
    resolveJsPluginLazyRef: (url, ref, done) => { calls.resolved.push([url, ref]); resolver(done); },
    portalServiceCall: (method, params, done) => {
      if (method === 'downloadStart') { calls.start.push(params); done(null, { id: 'd1' }); }
      else { done(null, { items: [] }); }
    }
  });
  ctx.showDownloadNotice = (error) => calls.notices.push(error || '');
  return { ctx, calls };
}

test('a JS plugin server gives its link first, then the download starts with it', () => {
  const { ctx, calls } = load({ addon: 'FrameXTV', url: '', jsLazyRef: 'ref-1', jsAddonUrl: 'kino://frametv', filename: 'x.mp4' },
    (done) => done(null, { url: 'https://cdn.example/video.mp4', headers: { Referer: 'https://site.example/' } }));
  ctx.startTitleDownload({ id: 'tt1', title: 'Una' }, null);
  assert.deepEqual(calls.resolved, [['kino://frametv', 'ref-1']]);
  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0].url, 'https://cdn.example/video.mp4');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.start[0].headers)), { Referer: 'https://site.example/' });
  assert.deepEqual(calls.notices, ['']);
});

test('a JS plugin server that gives no link: no empty download, a clear notice', () => {
  const { ctx, calls } = load({ addon: 'FrameXTV', url: '', jsLazyRef: 'ref-2', jsAddonUrl: 'kino://frametv' },
    (done) => done('El servidor no respondió', null));
  ctx.startTitleDownload({ id: 'tt2', title: 'Dos' }, null);
  assert.equal(calls.start.length, 0);
  assert.equal(calls.notices.length, 1);
  assert.match(calls.notices[0], /^No se pudo descargar: El servidor no respondió/);
});

test('a source with its link (or a torrent) goes to the service as it is', () => {
  const { ctx, calls } = load({ addon: 'Torrentio', infoHash: 'a'.repeat(40), fileIdx: 2 }, () => { throw new Error('not asked'); });
  ctx.startTitleDownload({ id: 'tt3', title: 'Tres' }, null);
  assert.equal(calls.resolved.length, 0);
  assert.equal(calls.start[0].infoHash, 'a'.repeat(40));
  assert.equal(calls.start[0].fileIdx, 2);
});
