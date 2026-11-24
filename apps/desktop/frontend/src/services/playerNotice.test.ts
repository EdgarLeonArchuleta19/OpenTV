import { describe, expect, it } from 'vitest';
import { noticeDurationMs, pushNotice, routeGlobalToast } from './playerNotice';

describe('playerNotice', () => {
  it('drops global toasts only while the player is open', () => {
    expect(routeGlobalToast(true)).toBe('drop');
    expect(routeGlobalToast(false)).toBe('toast');
  });

  it('keeps durations readable but bounded', () => {
    expect(noticeDurationMs('Hola')).toBe(2500);
    expect(noticeDurationMs('x'.repeat(500))).toBe(6000);
  });

  it('extends a repeated message instead of stacking it', () => {
    const first = pushNotice(null, 'Probando siguiente fuente (1080p)…', 0)!;
    const again = pushNotice(first, 'Probando siguiente fuente (1080p)…', 1000)!;
    expect(again.id).toBe(first.id);
    expect(again.until).toBeGreaterThan(first.until);
  });

  it('replaces with a new message and ignores blanks', () => {
    const first = pushNotice(null, 'Subtítulos: Español', 0)!;
    const next = pushNotice(first, 'Audio: Inglés', 100)!;
    expect(next.id).toBe(first.id + 1);
    expect(next.text).toBe('Audio: Inglés');
    expect(pushNotice(next, '   ', 200)).toBe(next);
  });
});
