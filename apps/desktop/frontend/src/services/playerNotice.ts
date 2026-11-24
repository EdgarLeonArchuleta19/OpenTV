/**
 * In-player notices: while the player is open every status/info message is shown inside the
 * player (small pill near the top), never as the app's global toast.
 */

export interface PlayerNotice {
  id: number;
  text: string;
  /** Epoch ms when it hides. */
  until: number;
}

/** Visible time: long enough to read (≈ 45 ms per character), 2.5–6 s. */
export function noticeDurationMs(text: string): number {
  return Math.max(2500, Math.min(6000, 1800 + text.length * 45));
}

/**
 * Next notice state. The same text repeated while visible only extends it (no flicker, no
 * stacking); a different text replaces it. Blank text is ignored.
 */
export function pushNotice(prev: PlayerNotice | null, text: string, now: number): PlayerNotice | null {
  const clean = text.trim();
  if (!clean) return prev;
  const until = now + noticeDurationMs(clean);
  if (prev && prev.text === clean && prev.until > now) return { ...prev, until };
  return { id: (prev?.id ?? 0) + 1, text: clean, until };
}

/**
 * Global toast gate: while the player is mounted global toasts are dropped (messages from
 * other screens or background services, e.g. JS plugin failures of the shared source search).
 */
export function routeGlobalToast(playerActive: boolean): 'toast' | 'drop' {
  return playerActive ? 'drop' : 'toast';
}
