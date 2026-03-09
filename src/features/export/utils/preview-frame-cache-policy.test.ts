import { describe, expect, it } from 'vitest';
import { shouldCacheRenderedPreviewFrame } from './preview-frame-cache-policy';

describe('shouldCacheRenderedPreviewFrame', () => {
  it('skips sequential forward frames without transitions', () => {
    expect(shouldCacheRenderedPreviewFrame({
      frame: 101,
      lastRenderedFrame: 100,
      activeTransitionCount: 0,
    })).toBe(false);
  });

  it('caches non-sequential access without transitions', () => {
    expect(shouldCacheRenderedPreviewFrame({
      frame: 110,
      lastRenderedFrame: 100,
      activeTransitionCount: 0,
    })).toBe(true);
  });

  it('caches transition frames even during sequential forward skim', () => {
    expect(shouldCacheRenderedPreviewFrame({
      frame: 101,
      lastRenderedFrame: 100,
      activeTransitionCount: 1,
    })).toBe(true);
  });
});
