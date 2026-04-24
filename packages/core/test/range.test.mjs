import { describe, expect, it } from 'vitest';
import { resolveRangeFrames, validateRangeFrames } from '../src/index.ts';

describe('range planning', () => {
  it('resolves frame aliases and second-based ranges', () => {
    expect(resolveRangeFrames({ inFrame: 12, outFrame: 42 }, 30)).toEqual({
      inFrame: 12,
      outFrame: 42,
    });
    expect(resolveRangeFrames({ startFrame: 10, durationInFrames: 15 }, 30)).toEqual({
      inFrame: 10,
      outFrame: 25,
    });
    expect(resolveRangeFrames({ startSeconds: 1.5, durationSeconds: 2 }, 24)).toEqual({
      inFrame: 36,
      outFrame: 84,
    });
    expect(resolveRangeFrames({ endSeconds: 2 }, 30)).toEqual({
      inFrame: 0,
      outFrame: 60,
    });
  });

  it('rejects invalid frame ranges and fps values', () => {
    expect(() => validateRangeFrames(-1, 10)).toThrow(/non-negative integer/);
    expect(() => validateRangeFrames(10, 10)).toThrow(/before outFrame/);
    expect(() => resolveRangeFrames({ durationSeconds: 1 }, 0)).toThrow(/fps/);
    expect(() => resolveRangeFrames({ startFrame: 10 }, 30)).toThrow(/render range requires/);
  });
});
