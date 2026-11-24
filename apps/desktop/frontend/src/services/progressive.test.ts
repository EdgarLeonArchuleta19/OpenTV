import { describe, expect, it } from 'vitest';
import { settleInOrder } from './progressive';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('settleInOrder', () => {
  it('reports the settled prefix in input order, never out of order', async () => {
    const a = deferred<string | null>();
    const b = deferred<string | null>();
    const c = deferred<string | null>();
    const calls: Array<[string[], boolean]> = [];
    const all = settleInOrder([a.promise, b.promise, c.promise], (v, done) => calls.push([v, done]));

    c.resolve('C');
    await flush();
    expect(calls).toEqual([]); // C waits for A and B

    a.resolve('A');
    await flush();
    expect(calls).toEqual([[['A'], false]]);

    b.resolve('B');
    await flush();
    expect(calls[1]).toEqual([['A', 'B', 'C'], true]);
    await expect(all).resolves.toEqual(['A', 'B', 'C']);
  });

  it('skips nulls and rejections', async () => {
    const out = await settleInOrder([Promise.resolve(null), Promise.reject(new Error('x')), Promise.resolve(3)]);
    expect(out).toEqual([3]);
  });

  it('handles an empty task list', async () => {
    const calls: boolean[] = [];
    await expect(settleInOrder([], (_v, done) => calls.push(done))).resolves.toEqual([]);
    expect(calls).toEqual([true]);
  });
});
