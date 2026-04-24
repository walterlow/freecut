import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BEZIER_POINTS,
  DEFAULT_SPRING_PARAMS,
  applyEasing,
  applyEasingConfig,
  cubicBezier,
  springEasing,
} from '@freecut/core/easing';

describe('easing', () => {
  it('applies basic easing with clamped progress', () => {
    expect(applyEasing(-1, 'linear')).toBe(0);
    expect(applyEasing(2, 'linear')).toBe(1);
    expect(applyEasing(0.5, 'ease-in')).toBe(0.25);
    expect(applyEasing(0.5, 'ease-out')).toBe(0.75);
  });

  it('applies configured cubic bezier easing', () => {
    expect(cubicBezier(0, DEFAULT_BEZIER_POINTS)).toBe(0);
    expect(cubicBezier(1, DEFAULT_BEZIER_POINTS)).toBe(1);
    expect(applyEasingConfig(0.5, { type: 'cubic-bezier' })).toBeCloseTo(0.5, 4);
  });

  it('applies spring easing within the expected output range', () => {
    const value = springEasing(0.5, DEFAULT_SPRING_PARAMS);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1.2);
  });
});
