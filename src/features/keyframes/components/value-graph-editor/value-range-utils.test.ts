import { describe, expect, it } from 'vitest';

import { getCombinedGraphValueRange, getGraphValueRange } from './value-range-utils';

describe('getGraphValueRange', () => {
  it('returns the full property range when auto zoom is off', () => {
    expect(
      getGraphValueRange(
        { min: 0, max: 100 },
        [
          { id: 'kf-1', frame: 0, value: 40, easing: 'linear' },
          { id: 'kf-2', frame: 10, value: 42, easing: 'linear' },
        ],
        false
      )
    ).toEqual({ min: 0, max: 100 });
  });

  it('fits the range around the curve values when auto zoom is on', () => {
    const range = getGraphValueRange(
      { min: 0, max: 100 },
      [
        { id: 'kf-1', frame: 0, value: 40, easing: 'linear' },
        { id: 'kf-2', frame: 10, value: 42, easing: 'linear' },
      ],
      true
    );

    expect(range.min).toBeGreaterThan(0);
    expect(range.min).toBeLessThan(40);
    expect(range.max).toBeGreaterThan(42);
    expect(range.max).toBeLessThan(100);
  });

  it('creates a usable range for flat curves', () => {
    const range = getGraphValueRange(
      { min: 0, max: 1 },
      [{ id: 'kf-1', frame: 0, value: 0.4, easing: 'linear' }],
      true
    );

    expect(range.min).toBeLessThan(0.4);
    expect(range.max).toBeGreaterThan(0.4);
    expect(range.max - range.min).toBeGreaterThan(0);
  });

  it('fits across all visible curves when combining ranges', () => {
    const range = getCombinedGraphValueRange(
      [{ min: 0, max: 100 }, { min: -50, max: 50 }],
      [
        [{ id: 'kf-1', frame: 0, value: 40, easing: 'linear' }],
        [{ id: 'kf-2', frame: 10, value: -10, easing: 'linear' }],
      ],
      true
    );

    expect(range.min).toBeLessThan(-10);
    expect(range.max).toBeGreaterThan(40);
  });
});
