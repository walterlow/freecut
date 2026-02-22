import { describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
import { computeSlideContinuitySourceDelta } from './slide-utils';

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 100,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: 100,
    sourceDuration: 500,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  };
}

describe('computeSlideContinuitySourceDelta', () => {
  it('returns source delta for split-contiguous chains', () => {
    const left = makeVideoItem({
      id: 'left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
    });
    const middle = makeVideoItem({
      id: 'middle',
      from: 100,
      durationInFrames: 100,
      sourceStart: 100,
      sourceEnd: 200,
    });
    const right = makeVideoItem({
      id: 'right',
      from: 200,
      durationInFrames: 100,
      sourceStart: 200,
      sourceEnd: 300,
    });

    const delta = computeSlideContinuitySourceDelta(middle, left, right, 20, 30);
    expect(delta).toBe(20);
  });

  it('returns 0 for non-split chains', () => {
    const left = makeVideoItem({
      id: 'left',
      originId: 'left-origin',
      mediaId: 'media-left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
    });
    const middle = makeVideoItem({
      id: 'middle',
      originId: 'middle-origin',
      mediaId: 'media-middle',
      from: 100,
      durationInFrames: 100,
      sourceStart: 100,
      sourceEnd: 200,
    });
    const right = makeVideoItem({
      id: 'right',
      originId: 'right-origin',
      mediaId: 'media-right',
      from: 200,
      durationInFrames: 100,
      sourceStart: 200,
      sourceEnd: 300,
    });

    const delta = computeSlideContinuitySourceDelta(middle, left, right, 20, 30);
    expect(delta).toBe(0);
  });

  it('returns 0 when full source delta cannot be applied', () => {
    const left = makeVideoItem({
      id: 'left',
      from: 0,
      durationInFrames: 100,
      sourceStart: 0,
      sourceEnd: 100,
    });
    const middle = makeVideoItem({
      id: 'middle',
      from: 100,
      durationInFrames: 100,
      sourceStart: 100,
      sourceEnd: 200,
      sourceDuration: 205,
    });
    const right = makeVideoItem({
      id: 'right',
      from: 200,
      durationInFrames: 100,
      sourceStart: 200,
      sourceEnd: 300,
      sourceDuration: 600,
    });

    const delta = computeSlideContinuitySourceDelta(middle, left, right, 20, 30);
    expect(delta).toBe(0);
  });
});
