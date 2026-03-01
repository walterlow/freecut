import { describe, expect, it } from 'vitest';
import { resolveCompositionScale } from './composition-space-context';

describe('resolveCompositionScale', () => {
  it('returns matching scales for exact aspect matches', () => {
    const scale = resolveCompositionScale(1920, 1080, 960, 540);
    expect(scale.scaleX).toBeCloseTo(0.5, 5);
    expect(scale.scaleY).toBeCloseTo(0.5, 5);
    expect(scale.scale).toBeCloseTo(0.5, 5);
  });

  it('preserves per-axis scale when aspect drift exists', () => {
    const scale = resolveCompositionScale(853, 480, 426, 240);
    expect(scale.scaleX).toBeCloseTo(426 / 853, 8);
    expect(scale.scaleY).toBeCloseTo(240 / 480, 8);
    expect(scale.scaleX).not.toBeCloseTo(scale.scaleY, 6);
  });

  it('preserves non-uniform scale for meaningful aspect differences', () => {
    const scale = resolveCompositionScale(1920, 1080, 960, 500);
    expect(scale.scaleX).toBeCloseTo(0.5, 5);
    expect(scale.scaleY).toBeCloseTo(500 / 1080, 5);
    expect(scale.scaleX).not.toBeCloseTo(scale.scaleY, 3);
  });
});
