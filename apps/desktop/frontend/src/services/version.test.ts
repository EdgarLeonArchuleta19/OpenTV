import { describe, expect, it } from 'vitest';
import { compareVersions, isMandatoryUpdate } from './version';

describe('version & mandatory update policy', () => {
  it('compares SemVer releases and prereleases accurately', () => {
    expect(compareVersions('2.0.0', '2.0.0-alpha.1')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0-alpha.1', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0-alpha.10', '2.0.0-alpha.2')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0-alpha.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.1', '2.0.0')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2.1', '2.0.0-alpha.1')).toBeLessThan(0);
  });

  it('enforces mandatory update only when latest version is strictly newer', () => {
    expect(
      isMandatoryUpdate({ state: 'available', available: '2.0.0', mandatory: true }, '2.0.0-alpha.1'),
    ).toBe(true);
    expect(
      isMandatoryUpdate({ state: 'downloading', available: '2.1.0', mandatory: true }, '2.0.0'),
    ).toBe(true);
    expect(
      isMandatoryUpdate({ state: 'up-to-date', available: null, mandatory: false }, '2.0.0'),
    ).toBe(false);
    expect(
      isMandatoryUpdate({ state: 'available', available: '1.9.0', mandatory: false }, '2.0.0-alpha.1'),
    ).toBe(false);
  });
});
