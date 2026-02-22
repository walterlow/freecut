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

  it('returns 0 when slideDelta is 0', () => {
    const item = makeVideoItem();
    const left = makeVideoItem({ id: 'left' });
    const right = makeVideoItem({ id: 'right' });
    const delta = computeSlideContinuitySourceDelta(item, left, right, 0, 30);
    expect(delta).toBe(0);
  });

  it('returns 0 when leftNeighbor is null', () => {
    const item = makeVideoItem();
    const right = makeVideoItem({ id: 'right' });
    const delta = computeSlideContinuitySourceDelta(item, null, right, 10, 30);
    expect(delta).toBe(0);
  });

  it('returns 0 when rightNeighbor is null', () => {
    const item = makeVideoItem();
    const left = makeVideoItem({ id: 'left' });
    const delta = computeSlideContinuitySourceDelta(item, left, null, 10, 30);
    expect(delta).toBe(0);
  });

  it('returns 0 for non-media item types', () => {
    const textItem = {
      id: 'text-1',
      type: 'text' as const,
      trackId: 'track-1',
      from: 100,
      durationInFrames: 100,
      label: 'Hello',
      text: 'Hello',
      color: '#ffffff',
    };
    const left = makeVideoItem({ id: 'left', from: 0 });
    const right = makeVideoItem({ id: 'right', from: 200 });
    const delta = computeSlideContinuitySourceDelta(textItem, left, right, 10, 30);
    expect(delta).toBe(0);
  });

  it('returns 0 when sourceEnd is undefined', () => {
    const item = makeVideoItem({ sourceEnd: undefined });
    const left = makeVideoItem({ id: 'left', from: 0 });
    const right = makeVideoItem({ id: 'right', from: 200 });
    const delta = computeSlideContinuitySourceDelta(item, left, right, 10, 30);
    expect(delta).toBe(0);
  });

  it('applies fps and speed conversion for mismatched source/timeline fps', () => {
    // sourceFps=60, speed=2, timelineFps=30
    // timelineToSourceFrames(10, 2, 30, 60) = round((10/30) * 60 * 2) = 40
    const left = makeVideoItem({
      id: 'left',
      from: 0,
      durationInFrames: 50,
      sourceStart: 0,
      sourceEnd: 200,
      sourceDuration: 1000,
      sourceFps: 60,
      speed: 2,
    });
    const middle = makeVideoItem({
      id: 'middle',
      from: 50,
      durationInFrames: 50,
      sourceStart: 200,
      sourceEnd: 400,
      sourceDuration: 1000,
      sourceFps: 60,
      speed: 2,
    });
    const right = makeVideoItem({
      id: 'right',
      from: 100,
      durationInFrames: 50,
      sourceStart: 400,
      sourceEnd: 600,
      sourceDuration: 1000,
      sourceFps: 60,
      speed: 2,
    });

    const delta = computeSlideContinuitySourceDelta(middle, left, right, 10, 30);
    // sourceDelta = round((10/30) * 60 * 2) = 40
    expect(delta).toBe(40);
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
