import { describe, expect, it } from 'vitest';
import {
  buildRange,
  parseSnapshot,
  secondsToFrames,
  validateSnapshot,
} from '@freecut/core';

describe('package exports', () => {
  it('imports the public package surface by package name', () => {
    expect(typeof parseSnapshot).toBe('function');
    expect(typeof validateSnapshot).toBe('function');
    expect(secondsToFrames(1, 30)).toBe(30);
    expect(buildRange({ start: '0', duration: '1' })).toEqual({
      startSeconds: 0,
      durationSeconds: 1,
    });
  });
});
