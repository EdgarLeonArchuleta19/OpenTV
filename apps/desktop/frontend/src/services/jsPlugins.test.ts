import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  service: vi.fn(),
  tmdb: vi.fn(),
  browserCapture: vi.fn(),
}));
vi.mock('./tauri', () => ({ desktopApi: api }));
vi.mock('./deviceProfile', () => ({ recordThroughput: () => {} }));

import { IsolatedJsPluginRunner, type SandboxFrameFactory } from './jsPlugins';
import { sha256Hex } from './jsPluginSecurity';

const RESOLVER = 'https://raw.githubusercontent.com/xuper-plugin/kino-plugin-kino-resolver/HEAD';
const RESOLVER_CODE = 'export function proto_resolver_resolve(){}';

interface FakeFrame {
  window: object;
  posted: Array<Record<string, unknown>>;
  key: string | null;
  destroyed: boolean;
}

/** Fake sandboxes: answer `load` like the runtime; `call`s are answered by the test. */
function setup(files: Record<string, string>) {
  const frames: FakeFrame[] = [];
  let runner!: IsolatedJsPluginRunner;
  const send = (frame: FakeFrame, data: Record<string, unknown>) =>
    runner.receive({ source: frame.window, origin: 'null', data: { opentvPlugin: 1, ...data } });
  const factory: SandboxFrameFactory = () => {
    const frame: FakeFrame = { window: {}, posted: [], key: null, destroyed: false };
    frames.push(frame);
    queueMicrotask(() => send(frame, { kind: 'ready' }));
    return {
      window: frame.window,
      post(msg) {
        frame.posted.push(msg);
        if (msg.kind === 'load') {
          frame.key = String(msg.key);
          queueMicrotask(() => send(frame, { kind: 'reply', id: msg.id, value: { names: ['resolve', 'proto_resolver_resolve'] } }));
        }
      },
      destroy() {
        frame.destroyed = true;
      },
    };
  };
  runner = new IsolatedJsPluginRunner(factory);
  api.service.mockImplementation(async (method: string, params: Record<string, unknown>) => {
    if (method !== 'pluginFetch') return {};
    const url = String(params.url);
    if (url in files) return { ok: true, status: 200, text: files[url] };
    return { ok: true, status: 200, url, text: 'net', setCookies: url.includes('login') ? ['sid=secret; Path=/'] : [] };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = runner as any;
  const load = (key: string, base: string, allowLan: boolean) => priv.ensureLoaded(key, key, base, allowLan);
  const frameOf = (key: string) => frames.find((f) => f.key === key)!;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { runner, priv, frames, send, load, frameOf, flush };
}

function pluginFiles(base: string, manifest: Record<string, unknown>, code = 'export function resolve(){}') {
  return { [`${base}/kino-plugin.json`]: JSON.stringify(manifest), [`${base}/plugin.js`]: code };
}

const lastAnswer = (frame: FakeFrame) => [...frame.posted].reverse().find((m) => m.kind === 'answer')!;

beforeEach(() => {
  api.service.mockReset();
  api.tmdb.mockReset();
});

describe('IsolatedJsPluginRunner isolation', () => {
  it('gives each plugin its own frame and binds identity to the sending frame', async () => {
    const t = setup({ ...pluginFiles('https://a', { name: 'A' }), ...pluginFiles('https://b', { name: 'B' }, 'b') });
    await t.load('lanPlugin', 'https://a', true);
    await t.load('evil', 'https://b', false);
    expect(t.frames.length).toBe(2);
    api.service.mockClear();

    // `evil` claims to be the LAN plugin: the host ignores msg.key.
    t.send(t.frameOf('evil'), { kind: 'ask', id: 1, op: 'fetch', key: 'lanPlugin', args: { url: 'http://192.168.1.1/' } });
    await t.flush();
    expect(api.service).toHaveBeenCalledTimes(1);
    expect(api.service.mock.calls[0][1]).toMatchObject({ url: 'http://192.168.1.1/', allowLan: false });

    // Messages from an unknown window or a non-opaque origin are dropped.
    t.runner.receive({ source: {}, origin: 'null', data: { opentvPlugin: 1, kind: 'ask', id: 2, op: 'fetch', args: { url: 'https://x' } } });
    t.runner.receive({
      source: t.frameOf('evil').window,
      origin: 'https://evil.example',
      data: { opentvPlugin: 1, kind: 'ask', id: 3, op: 'fetch', args: { url: 'https://x' } },
    });
    await t.flush();
    expect(api.service).toHaveBeenCalledTimes(1);
  });

  it('only the owning frame can answer a pending call, and ids are random', async () => {
    const t = setup({ ...pluginFiles('https://a', {}), ...pluginFiles('https://b', {}, 'b') });
    await t.load('good', 'https://a', false);
    await t.load('evil', 'https://b', false);
    const p1 = t.priv.callPlugin('good', 'resolve', ['x'], 5_000);
    const p2 = t.priv.callPlugin('good', 'resolve', ['y'], 5_000);
    const calls = t.frameOf('good').posted.filter((m) => m.kind === 'call');
    const [id1, id2] = calls.map((m) => String(m.id));
    expect(id1).toMatch(/^h_[0-9a-f]{32}$/);
    expect(id1).not.toBe(id2);
    // The other plugin's frame never sees the call ids at all.
    expect(t.frameOf('evil').posted.some((m) => m.kind === 'call')).toBe(false);

    let settled = false;
    p1.then(() => (settled = true));
    t.send(t.frameOf('evil'), { kind: 'reply', id: id1, value: { streams: [{ url: 'https://evil/x.m3u8' }] } });
    await t.flush();
    expect(settled).toBe(false);

    t.send(t.frameOf('good'), { kind: 'reply', id: id1, value: 'ok' });
    t.send(t.frameOf('good'), { kind: 'reply', id: id2, value: 'ok2' });
    await expect(p1).resolves.toBe('ok');
    await expect(p2).resolves.toBe('ok2');
  });

  it('keeps cookie jars and storage per plugin', async () => {
    const t = setup({ ...pluginFiles('https://a', {}), ...pluginFiles('https://b', {}, 'b') });
    await t.load('a', 'https://a', false);
    await t.load('b', 'https://b', false);

    t.send(t.frameOf('a'), { kind: 'ask', id: 1, op: 'fetch', args: { url: 'https://site.com/login' } });
    await t.flush();
    expect(lastAnswer(t.frameOf('a')).jar).toEqual({ 'site.com': { sid: 'secret' } });

    api.service.mockClear();
    t.send(t.frameOf('b'), { kind: 'ask', id: 1, op: 'fetch', args: { url: 'https://site.com/page' } });
    await t.flush();
    const headers = (api.service.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('cookie');
    expect(lastAnswer(t.frameOf('b')).jar).toEqual({});

    // Storage writes land under the sending frame's key, whatever key it claims.
    t.send(t.frameOf('b'), { kind: 'ask', id: 2, op: 'storageSet', key: 'a', args: { k: 'token', v: 'pwned' } });
    await t.flush();
    expect(t.priv.storageFor('a')).toEqual({});
    expect(t.priv.storageFor('b')).toEqual({ token: 'pwned' });
  });
});

describe('IsolatedJsPluginRunner doors (helper plugins)', () => {
  it('rejects helpers outside the allowlist with a Spanish message', async () => {
    const t = setup(pluginFiles('https://a', { consumes: { resolver: { repo: 'evil/helper' } } }));
    await t.load('caller', 'https://a', true);
    t.send(t.frameOf('caller'), { kind: 'ask', id: 7, op: 'pluginCall', args: { door: 'resolver', fn: 'resolve', args: {} } });
    await t.flush();
    const ans = lastAnswer(t.frameOf('caller'));
    expect(ans.code).toBe('provider_missing');
    expect(ans.userMessage).toBe('Este plugin necesita un plugin auxiliar no verificado: evil/helper');
    expect(t.frames.length).toBe(1);
    expect(api.service.mock.calls.some((c) => String(c[1].url).includes('evil/helper'))).toBe(false);
  });

  it('runs the approved helper in its own frame without allowLan and plain data only', async () => {
    const t = setup({
      ...pluginFiles('https://a', { consumes: { resolver: { repo: 'xuper-plugin/kino-plugin-kino-resolver' } } }),
      ...pluginFiles(RESOLVER, { name: 'Kino Resolver', provides: { resolver: { calls: { resolve: {} } } } }, RESOLVER_CODE),
    });
    await t.load('caller', 'https://a', true);
    t.send(t.frameOf('caller'), {
      kind: 'ask',
      id: 9,
      op: 'pluginCall',
      args: { door: 'resolver', fn: 'resolve', args: { url: 'https://embed/x' } },
    });
    await t.flush();
    await t.flush();
    const helper = t.frames.find((f) => f.key?.includes('kino-plugin-kino-resolver'))!;
    expect(helper).toBeTruthy();
    expect(helper).not.toBe(t.frameOf('caller'));
    const call = helper.posted.find((m) => m.kind === 'call')!;
    expect(call.fn).toBe('proto_resolver_resolve');
    expect(call.args).toEqual([{ url: 'https://embed/x' }]);

    // The helper's own network goes out without the caller's LAN permission.
    api.service.mockClear();
    t.send(helper, { kind: 'ask', id: 1, op: 'fetch', args: { url: 'http://10.0.0.2/' } });
    await t.flush();
    expect(api.service.mock.calls[0][1]).toMatchObject({ allowLan: false });

    t.send(helper, { kind: 'reply', id: call.id, value: { streams: [{ url: 'https://cdn/x.m3u8' }] } });
    await t.flush();
    await t.flush();
    expect(lastAnswer(t.frameOf('caller')).value).toEqual({ streams: [{ url: 'https://cdn/x.m3u8' }] });
  });

  it('refuses a helper whose code does not match the pinned SHA-256', async () => {
    const good = await sha256Hex(RESOLVER_CODE);
    const t = setup({
      ...pluginFiles('https://a', { consumes: { resolver: { repo: 'xuper-plugin/kino-plugin-kino-resolver', sha256: good } } }),
      ...pluginFiles(RESOLVER, { provides: { resolver: { calls: { resolve: {} } } } }, `${RESOLVER_CODE}/*tampered*/`),
    });
    await t.load('caller', 'https://a', false);
    t.send(t.frameOf('caller'), { kind: 'ask', id: 3, op: 'pluginCall', args: { door: 'resolver', fn: 'resolve', args: {} } });
    await t.flush();
    await t.flush();
    expect(lastAnswer(t.frameOf('caller')).code).toBe('provider_missing');
    expect(t.frames.length).toBe(1);
  });
});

describe('IsolatedJsPluginRunner TMDB', () => {
  it('forwards only whitelisted routes', async () => {
    const t = setup(pluginFiles('https://a', {}));
    await t.load('p', 'https://a', false);
    api.tmdb.mockResolvedValue({ item: { id: 550 } });

    t.send(t.frameOf('p'), { kind: 'ask', id: 1, op: 'tmdb', args: { route: 'raw:/account/1/lists', params: {} } });
    await t.flush();
    expect(api.tmdb).not.toHaveBeenCalled();
    expect(lastAnswer(t.frameOf('p')).code).toBe('not_supported');

    t.send(t.frameOf('p'), { kind: 'ask', id: 2, op: 'tmdb', args: { route: '/movie/550', params: { language: 'es-MX' } } });
    await t.flush();
    expect(api.tmdb).toHaveBeenCalledWith('raw:/movie/550?language=es-MX&include_adult=false');
    expect(lastAnswer(t.frameOf('p')).value).toEqual({ id: 550 });
  });
});
