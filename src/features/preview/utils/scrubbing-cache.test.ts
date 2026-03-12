import { describe, expect, it, vi } from 'vitest';
import { ScrubbingCache } from './scrubbing-cache';

type ClosableFrame = ImageBitmap & {
  close: ReturnType<typeof vi.fn>;
};

function createMockFrame(): ClosableFrame {
  return {
    close: vi.fn(),
  } as unknown as ClosableFrame;
}

describe('ScrubbingCache tier 2 video frames', () => {
  it('returns an entry when the source time is within tolerance', () => {
    const cache = new ScrubbingCache();
    const frame = createMockFrame();

    cache.putVideoFrame('item-1', frame, 1.0);

    const entry = cache.getVideoFrameEntry('item-1', 1.02, 0.05);

    expect(entry?.frame).toBe(frame);
    expect(entry?.sourceTime).toBe(1.0);
    expect(cache.getStats().tier2Hits).toBe(1);
  });

  it('misses without incrementing hits when the source time is outside tolerance', () => {
    const cache = new ScrubbingCache();

    cache.putVideoFrame('item-1', createMockFrame(), 1.0);

    const entry = cache.getVideoFrameEntry('item-1', 1.2, 0.05);

    expect(entry).toBeUndefined();
    expect(cache.getStats().tier2Hits).toBe(0);
  });

  it('closes the previous frame when replacing a cached entry', () => {
    const cache = new ScrubbingCache();
    const firstFrame = createMockFrame();
    const secondFrame = createMockFrame();

    cache.putVideoFrame('item-1', firstFrame, 1.0);
    cache.putVideoFrame('item-1', secondFrame, 1.1);

    expect(firstFrame.close).toHaveBeenCalledTimes(1);
    expect(secondFrame.close).not.toHaveBeenCalled();
  });

  it('closes cached frames when invalidating tier 2 entries', () => {
    const cache = new ScrubbingCache();
    const frame = createMockFrame();

    cache.putVideoFrame('item-1', frame, 1.0);
    cache.invalidateVideoFrames();

    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(cache.getVideoFrameEntry('item-1')).toBeUndefined();
  });
});
