/**
 * "Modo ligero": a lighter OpenTV for modest PCs and slow networks. Read during render by
 * the image helpers, Detail, Home and the source ranker; App keeps it in sync with settings.
 * Screens re-mount when the user leaves Ajustes, so a plain module flag is enough.
 */
let lite = false;

export function setLiteMode(on: boolean): void {
  lite = on;
}

export function isLiteMode(): boolean {
  return lite;
}

/** Lite mode asks the CDNs for ~60 % of the usual width (posters stay sharp, far fewer bytes). */
export function liteImageWidth(widthPx: number): number {
  return lite ? Math.max(160, Math.round(widthPx * 0.6)) : widthPx;
}
