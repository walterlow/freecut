import { describe, expect, it } from 'vitest';
import { getSourceWarmTarget, resolveSourceWarmSet } from './source-warm-target';

describe('getSourceWarmTarget', () => {
  it('reduces the target under source and element pressure', () => {
    expect(getSourceWarmTarget({
      mode: 'playing',
      currentPoolSourceCount: 28,
      currentPoolElementCount: 45,
      maxSources: 20,
      minSources: 4,
      hardCapSources: 24,
      hardCapElements: 40,
    })).toBe(13);
  });
});

describe('resolveSourceWarmSet', () => {
  it('keeps fresh sticky sources when there is remaining warm capacity', () => {
    const result = resolveSourceWarmSet({
      candidateScores: new Map([
        ['blob:a', 0],
        ['blob:b', 10],
      ]),
      warmTarget: 3,
      recentTouches: new Map([
        ['blob:sticky', 9500],
        ['blob:old', 1000],
      ]),
      nowMs: 10_000,
      stickyMs: 1000,
      hardCapSources: 6,
    });

    expect(result.selectedSources).toEqual(['blob:a', 'blob:b']);
    expect([...result.keepWarm]).toEqual(['blob:a', 'blob:b', 'blob:sticky']);
    expect([...result.nextRecentTouches.entries()]).toEqual([
      ['blob:sticky', 9500],
      ['blob:a', 10_000],
      ['blob:b', 10_000],
    ]);
    expect(result.evictions).toBe(1);
  });

  it('evicts oldest non-kept touches when the sticky set exceeds the hard cap', () => {
    const result = resolveSourceWarmSet({
      candidateScores: new Map([
        ['blob:a', 0],
      ]),
      warmTarget: 1,
      recentTouches: new Map([
        ['blob:oldest', 100],
        ['blob:older', 200],
        ['blob:kept', 300],
      ]),
      nowMs: 350,
      stickyMs: 1000,
      hardCapSources: 2,
    });

    expect([...result.keepWarm]).toEqual(['blob:a']);
    expect([...result.nextRecentTouches.entries()]).toEqual([
      ['blob:kept', 300],
      ['blob:a', 350],
    ]);
    expect(result.evictions).toBe(2);
  });
});
