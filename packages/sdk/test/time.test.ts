import { describe, expect, it } from 'vitest';
import { framesToSeconds, secondsToFrames } from '../src/index';

describe('time helpers', () => {
  it('rounds seconds to the nearest frame', () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(1 / 30, 30)).toBe(1);
    expect(secondsToFrames(0.5, 60)).toBe(30);
  });

  it('round-trips frames through seconds at project fps', () => {
    const fps = 30;
    for (let f = 0; f < 1000; f += 7) {
      expect(secondsToFrames(framesToSeconds(f, fps), fps)).toBe(f);
    }
  });

  it('rejects invalid inputs', () => {
    expect(() => secondsToFrames(-1, 30)).toThrow(RangeError);
    expect(() => secondsToFrames(1, 0)).toThrow(RangeError);
    expect(() => secondsToFrames(Infinity, 30)).toThrow(RangeError);
  });
});
