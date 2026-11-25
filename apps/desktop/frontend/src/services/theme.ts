import { ACCENTS } from './catalogs';

export type ThemeId = 'dark' | 'light';

/** WebView zoom applied by "Texto aumentado" (+12 % on every screen, Ajustes included). */
export const TEXT_LARGE_ZOOM = 1.12;

/** Window background per theme, mirrored by the native window (`desktop_appearance`). */
export const THEME_WINDOW_BG: Record<ThemeId, string> = {
  dark: '#0e0e11',
  light: '#f6f6f8',
};

/**
 * Accent shades for the light theme. White would vanish on a light page, so it turns
 * near-black with white ink; the lighter hues get a darker shade so accent text keeps
 * at least 4.5:1 against the light background.
 */
const LIGHT_ACCENTS: Record<string, { color: string; ink: string }> = {
  white: { color: '#111114', ink: '#ffffff' },
  red: { color: '#e50914', ink: '#ffffff' },
  blue: { color: '#2563eb', ink: '#ffffff' },
  purple: { color: '#7c3aed', ink: '#ffffff' },
  green: { color: '#15803d', ink: '#ffffff' },
  amber: { color: '#b45309', ink: '#ffffff' },
};

/** Any stored value other than 'light' (missing, legacy, corrupt) is the default dark theme. */
export function normalizeTheme(value: unknown): ThemeId {
  return value === 'light' ? 'light' : 'dark';
}

/** Appearance prefs with a valid theme (saves and backups from before the light theme stay dark). */
export function withThemeDefault<T extends object>(appearance: T): Omit<T, 'theme'> & { theme: ThemeId } {
  return { ...appearance, theme: normalizeTheme((appearance as { theme?: unknown }).theme) };
}

/** Accent fill + ink colour the UI uses for `accentId` under `theme`. */
export function resolveAccent(accentId: string, theme: ThemeId): { color: string; ink: string } {
  const base = ACCENTS.find((a) => a.id === accentId) || ACCENTS[0];
  if (theme !== 'light') return { color: base.color, ink: base.ink };
  return LIGHT_ACCENTS[base.id] || { color: base.color, ink: base.ink };
}

/** Accent name shown in Ajustes: "Blanco" is drawn black in the light theme, so it is called "Negro" there. */
export function accentLabel(accentId: string, label: string, theme: ThemeId): string {
  return theme === 'light' && accentId === 'white' ? 'Negro' : label;
}

/** WebView zoom factor for the "Tamaño del texto" setting. */
export function zoomFor(textLarge: boolean): number {
  return textLarge ? TEXT_LARGE_ZOOM : 1;
}

/** sRGB relative luminance of a `#rrggbb` colour (WCAG 2.x). */
export function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
