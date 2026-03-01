import { describe, expect, it } from 'vitest';
import { getDirectionalPrewarmOffsets } from './fast-scrub-prewarm';

describe('getDirectionalPrewarmOffsets', () => {
  it('biases forward offsets for forward direction', () => {
    expect(getDirectionalPrewarmOffsets(1)).toEqual([1, 2, 3, 4, -1, -2]);
  });

  it('biases backward offsets for backward direction', () => {
    expect(getDirectionalPrewarmOffsets(-1)).toEqual([-1, -2, -3, -4, -5, -6, -7, -8, 1, 2]);
  });

  it('returns symmetric offsets in neutral direction', () => {
    expect(getDirectionalPrewarmOffsets(0)).toEqual([-1, 1, -2, 2]);
  });

  it('supports custom option values', () => {
    expect(
      getDirectionalPrewarmOffsets(-1, {
        backwardSteps: 3,
        oppositeSteps: 1,
      })
    ).toEqual([-1, -2, -3, 1]);
  });

  it('supports low-latency option profile', () => {
    expect(
      getDirectionalPrewarmOffsets(-1, {
        forwardSteps: 1,
        backwardSteps: 2,
        oppositeSteps: 0,
        neutralRadius: 1,
      })
    ).toEqual([-1, -2]);
  });
});
