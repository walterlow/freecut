import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearEditOverlayFrameCache,
  getCachedEditOverlayFrame,
  getEditOverlayFrameCacheKey,
  getEditOverlayFrameCacheSize,
  putCachedEditOverlayFrame,
} from './edit-overlay-frame-cache';

function createMockBitmap(label: string): ImageBitmap {
  return {
    close: vi.fn(),
    label,
  } as unknown as ImageBitmap;
}

describe('edit-overlay-frame-cache', () => {
  afterEach(() => {
    clearEditOverlayFrameCache();
  });

  it('quantizes keys by source time', () => {
    const base = getEditOverlayFrameCacheKey('blob:test', 1.001, 1 / 60);
    const nearby = getEditOverlayFrameCacheKey('blob:test', 1.004, 1 / 60);
    const far = getEditOverlayFrameCacheKey('blob:test', 1.03, 1 / 60);

    expect(base).toBe(nearby);
    expect(base).not.toBe(far);
  });

  it('reuses existing cached frames for identical keys', () => {
    const key = 'blob:test::1.000000';
    const first = createMockBitmap('first');
    const duplicate = createMockBitmap('duplicate');

    putCachedEditOverlayFrame(key, first);
    putCachedEditOverlayFrame(key, duplicate);

    expect(getCachedEditOverlayFrame(key)).toBe(first);
    expect(duplicate.close).toHaveBeenCalledTimes(1);
    expect(getEditOverlayFrameCacheSize()).toBe(1);
  });

  it('evicts the oldest frame when capacity is exceeded', () => {
    const oldest = createMockBitmap('oldest');
    const newest = createMockBitmap('newest');

    putCachedEditOverlayFrame('a', oldest, 1);
    putCachedEditOverlayFrame('b', newest, 1);

    expect(oldest.close).toHaveBeenCalledTimes(1);
    expect(getCachedEditOverlayFrame('a')).toBeUndefined();
    expect(getCachedEditOverlayFrame('b')).toBe(newest);
  });
});
