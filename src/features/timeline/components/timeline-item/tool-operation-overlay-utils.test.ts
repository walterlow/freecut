import { describe, expect, it } from 'vitest';
import type { VideoItem } from '@/types/timeline';
import { getSlipOperationBoundsVisual, getTrimOperationBoundsVisual } from './tool-operation-overlay-utils';

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
      constraintEdge: null,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    });

    expect(visual.boxLeftPx).toBe(70);
    expect(visual.boxWidthPx).toBe(120);
    expect(visual.limitEdgePositionsPx).toEqual([70, 190]);
  });

  it('uses the rolling intersection span around the cut instead of the active clip span', () => {
    const left = {
      ...createVideoItem(),
      id: 'left',
      from: 100,
      durationInFrames: 60,
      sourceStart: 20,
      sourceEnd: 80,
      sourceDuration: 90,
    };
    const right = {
      ...createVideoItem(),
      id: 'right',
      from: 160,
      durationInFrames: 60,
      sourceStart: 0,
      sourceEnd: 60,
      sourceDuration: 60,
    };

    const visual = getTrimOperationBoundsVisual({
      item: left,
      items: [left, right],
      transitions: [],
      fps: 30,
      frameToPixels: (frames) => frames,
      handle: 'end',
      isRollingEdit: true,
      isRippleEdit: false,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 160,
    });

    expect(visual.mode).toBe('rolling');
    expect(visual.boxLeftPx).toBe(160);
    expect(visual.boxWidthPx).toBe(10);
    expect(visual.limitEdgePositionsPx).toEqual([160, 170]);
  });

  it('anchors ripple-start limits to the previewed right-edge span', () => {
    const item = createVideoItem();

    const visual = getTrimOperationBoundsVisual({
      item,
      items: [item],
      transitions: [],
      fps: 30,
      frameToPixels: (frames) => frames,
      handle: 'start',
      isRollingEdit: false,
      isRippleEdit: true,
      constrained: false,
      currentLeftPx: 100,
      currentRightPx: 170,
    });

    expect(visual.mode).toBe('ripple');
    expect(visual.boxLeftPx).toBe(100);
    expect(visual.boxWidthPx).toBe(80);
    expect(visual.limitEdgePositionsPx).toEqual([101, 180]);
    expect(visual.edgePositionsPx).toEqual([170]);
  });
});
