/**
 * Runs every task in parallel but reports results in input order: each time the settled
 * prefix grows, `onPrefix` receives the non-null values of that prefix. Rows therefore
 * appear top-down as soon as they can (the first row no longer waits for the slowest one)
 * and never jump around. Rejections count as `null`. Resolves with all non-null values.
 */
export function settleInOrder<T>(
  tasks: Array<Promise<T | null>>,
  onPrefix?: (values: T[], done: boolean) => void,
): Promise<T[]> {
  if (tasks.length === 0) {
    onPrefix?.([], true);
    return Promise.resolve([]);
  }
  const results: Array<T | null> = new Array(tasks.length).fill(null);
  const settled: boolean[] = new Array(tasks.length).fill(false);
  let prefix = 0;
  return new Promise((resolve) => {
    const onSettled = (idx: number, value: T | null) => {
      results[idx] = value;
      settled[idx] = true;
      const before = prefix;
      while (prefix < tasks.length && settled[prefix]) prefix++;
      if (prefix === before) return;
      const values = results.slice(0, prefix).filter((v): v is T => v !== null);
      const done = prefix === tasks.length;
      onPrefix?.(values, done);
      if (done) resolve(values);
    };
    tasks.forEach((task, idx) => {
      task.then(
        (v) => onSettled(idx, v ?? null),
        () => onSettled(idx, null),
      );
    });
  });
}

/** Schedules `fn` when the main thread is idle (falls back to a timeout outside Chromium). */
export function whenIdle(fn: () => void, timeoutMs = 2000): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(fn, 200);
  return () => clearTimeout(t);
}
