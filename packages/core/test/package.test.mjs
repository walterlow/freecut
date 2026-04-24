import { describe, expect, it } from 'vitest';
import {
  parseSnapshot,
  secondsToFrames,
  validateSnapshot,
} from '@freecut/core';
import { SNAPSHOT_VERSION } from '@freecut/core/snapshot';
import { buildRange as buildRangeFromSubpath } from '@freecut/core/workspace';

describe('package exports', () => {
  it('imports the public package surface by package name', () => {
    expect(typeof parseSnapshot).toBe('function');
    expect(typeof validateSnapshot).toBe('function');
    expect(secondsToFrames(1, 30)).toBe(30);
  });

  it('imports public subpath modules', () => {
    expect(SNAPSHOT_VERSION).toBe('1.0');
    expect(buildRangeFromSubpath({ start: '0', duration: '1' })).toEqual({
      startSeconds: 0,
      durationSeconds: 1,
    });
  });
});
