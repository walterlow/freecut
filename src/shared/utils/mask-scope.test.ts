import { describe, expect, it } from 'vitest';
import { doesMaskAffectTrack } from './mask-scope';

describe('doesMaskAffectTrack', () => {
  it('applies masks only to lower tracks', () => {
    expect(doesMaskAffectTrack(0, 1)).toBe(true);
    expect(doesMaskAffectTrack(0, 3)).toBe(true);
  });

  it('does not apply masks to the same track or tracks above the mask', () => {
    expect(doesMaskAffectTrack(1, 1)).toBe(false);
    expect(doesMaskAffectTrack(2, 0)).toBe(false);
  });
});
