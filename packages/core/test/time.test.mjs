import { describe, expect, it } from 'vitest';
import { framesToSeconds, secondsToFrames } from '../src/index.mjs';

describe('time helpers', () => {
  it('converts between seconds and project frames', () => {
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(secondsToFrames(1 / 30, 30)).toBe(1);
    expect(secondsToFrames(0.5, 60)).toBe(30);
    expect(framesToSeconds(45, 30)).toBe(1.5);
  });

  it('rejects invalid inputs', () => {
    expect(() => secondsToFrames(-1, 30)).toThrow(RangeError);
    expect(() => secondsToFrames(1, 0)).toThrow(RangeError);
    expect(() => secondsToFrames(Infinity, 30)).toThrow(RangeError);
  });
});
