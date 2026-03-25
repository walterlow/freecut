import { describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
import { getSlipOperationBoundsVisual } from './tool-operation-overlay-utils';

function createVideoItem(): VideoItem {
  return {
    id: 'clip-1',
    type: 'video',
    trackId: 'track-1',
    from: 100,
    durationInFrames: 60,
    label: 'clip-1',
    src: 'clip-1.mp4',
    sourceStart: 20,
    sourceEnd: 80,
    sourceDuration: 120,
    sourceFps: 30,
  };
}

describe('tool operation overlay utils', () => {
  it('moves the slip bounds box together with the slip preview delta', () => {
    const visual = getSlipOperationBoundsVisual({
      item: {
        ...createVideoItem(),
        sourceStart: 30,
        sourceEnd: 90,
      },
      fps: 30,
      frameToPixels: (frames) => frames,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    });

    expect(visual.boxLeftPx).toBe(70);
    expect(visual.boxWidthPx).toBe(120);
    expect(visual.limitEdgePositionsPx).toEqual([70, 190]);
  });
});
