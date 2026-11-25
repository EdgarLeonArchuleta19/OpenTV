import { describe, expect, it } from 'vitest';
import { ACCENTS } from './catalogs';
import { THEME_WINDOW_BG, accentLabel, contrastRatio, normalizeTheme, resolveAccent, withThemeDefault, zoomFor } from './theme';

describe('normalizeTheme', () => {
  it('defaults to dark for missing or unknown values', () => {
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme('sepia')).toBe('dark');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('light')).toBe('light');
  });
});

describe('withThemeDefault', () => {
  it('migrates appearance saved before the light theme to dark', () => {
    expect(withThemeDefault({ accentId: 'red' })).toEqual({ accentId: 'red', theme: 'dark' });
    expect(withThemeDefault({ accentId: 'red', theme: 'light' }).theme).toBe('light');
    expect(withThemeDefault({ theme: 42 }).theme).toBe('dark');
  });
});

describe('resolveAccent', () => {
  it('keeps every accent unchanged in the dark theme', () => {
    for (const a of ACCENTS) expect(resolveAccent(a.id, 'dark')).toEqual({ color: a.color, ink: a.ink });
  });

  it('turns the white accent near-black with white ink in the light theme', () => {
    expect(resolveAccent('white', 'light')).toEqual({ color: '#111114', ink: '#ffffff' });
  });

  it('falls back to the first accent for unknown ids', () => {
    expect(resolveAccent('nope', 'dark').color).toBe(ACCENTS[0].color);
    expect(resolveAccent('nope', 'light').color).toBe('#111114');
  });

  it('keeps accent text and ink readable on the light background', () => {
    for (const a of ACCENTS) {
      const { color, ink } = resolveAccent(a.id, 'light');
      // Red keeps its brand shade (4.3:1, large/bold text only); the rest reach AA body text.
      expect(contrastRatio(color, THEME_WINDOW_BG.light)).toBeGreaterThanOrEqual(a.id === 'red' ? 4.2 : 4.5);
      expect(contrastRatio(color, ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('light palette contrast', () => {
  it('muted text reaches 4.5:1 on every light surface', () => {
    for (const bg of ['#f6f6f8', '#ffffff', '#eeeef1', '#ececf0']) {
      expect(contrastRatio('#5b5b66', bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#111114', bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('zoomFor', () => {
  it('scales the whole WebView by 12 % for large text', () => {
    expect(zoomFor(false)).toBe(1);
    expect(zoomFor(true)).toBeCloseTo(1.12);
  });
});

describe('accentLabel', () => {
  it('calls the white accent "Negro" in the light theme only', () => {
    expect(accentLabel('white', 'Blanco', 'light')).toBe('Negro');
    expect(accentLabel('white', 'Blanco', 'dark')).toBe('Blanco');
    expect(accentLabel('red', 'Rojo', 'light')).toBe('Rojo');
  });
});
