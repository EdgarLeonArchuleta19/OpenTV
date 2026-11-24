import type { UpdateStatus } from '../types/models';

function parseSemver(v: string): { core: [number, number, number]; pre: string | null } {
  const trimmed = String(v || '').trim().replace(/^[vV]/, '');
  const noBuild = trimmed.split('+')[0] || '';
  const dashIdx = noBuild.indexOf('-');
  const coreStr = dashIdx >= 0 ? noBuild.slice(0, dashIdx) : noBuild;
  const pre = dashIdx >= 0 ? noBuild.slice(dashIdx + 1) || null : null;
  const segs = coreStr.split('.').slice(0, 3);
  const core: [number, number, number] = [
    Number.parseInt(segs[0] || '0', 10) || 0,
    Number.parseInt(segs[1] || '0', 10) || 0,
    Number.parseInt(segs[2] || '0', 10) || 0,
  ];
  return { core, pre };
}

function comparePrerelease(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number.parseInt(x, 10) : NaN;
    const ny = /^\d+$/.test(y) ? Number.parseInt(y, 10) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx > ny ? 1 : -1;
    if (!Number.isNaN(nx)) return -1;
    if (!Number.isNaN(ny)) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * SemVer comparator matching Rust (`opentv-core::app_update::compare_versions`) and Kotlin (`AppUpdatePolicy`).
 * Returns `> 0` when `a` is newer than `b`, `< 0` when older, `0` when equal.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] > vb.core[i] ? 1 : -1;
  }
  if (!va.pre && !vb.pre) return 0;
  if (!va.pre && vb.pre) return 1; // 2.0.0 > 2.0.0-alpha.1
  if (va.pre && !vb.pre) return -1;
  return comparePrerelease(va.pre!, vb.pre!);
}

export function isMandatoryUpdate(status: UpdateStatus | null | undefined, currentVersion: string): boolean {
  if (!status) return false;
  if (status.available && compareVersions(status.available, currentVersion) > 0) return true;
  if (status.mandatory && status.state !== 'up-to-date') return true;
  return false;
}
