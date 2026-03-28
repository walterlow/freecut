import { describe, expect, it } from 'vitest';

import { constrainSelectedKeyframeDelta } from './frame-move-constraints';

describe('constrainSelectedKeyframeDelta', () => {
  it('clamps a selected keyframe before the next unselected keyframe', () => {
    expect(
      constrainSelectedKeyframeDelta({
        keyframesByProperty: {
          x: [
            { id: 'kf-1', frame: 20, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 30, value: 0, easing: 'linear' },
          ],
        },
        selectedKeyframeIds: new Set(['kf-1']),
        totalFrames: 100,
        deltaFrames: 20,
      })
    ).toBe(9);
  });

  it('treats non-selected gaps as barriers for multi-selection moves', () => {
    expect(
      constrainSelectedKeyframeDelta({
        keyframesByProperty: {
          x: [
            { id: 'kf-1', frame: 10, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 15, value: 0, easing: 'linear' },
            { id: 'kf-3', frame: 20, value: 0, easing: 'linear' },
          ],
        },
        selectedKeyframeIds: new Set(['kf-1', 'kf-3']),
        totalFrames: 100,
        deltaFrames: 10,
      })
    ).toBe(4);
  });

  it('allows contiguous selected keyframes to move together until the next fixed keyframe', () => {
    expect(
      constrainSelectedKeyframeDelta({
        keyframesByProperty: {
          x: [
            { id: 'kf-1', frame: 10, value: 0, easing: 'linear' },
            { id: 'kf-2', frame: 15, value: 0, easing: 'linear' },
            { id: 'kf-3', frame: 20, value: 0, easing: 'linear' },
            { id: 'kf-4', frame: 24, value: 0, easing: 'linear' },
          ],
        },
        selectedKeyframeIds: new Set(['kf-2', 'kf-3']),
        totalFrames: 100,
        deltaFrames: 10,
      })
    ).toBe(3);
  });

  it('clamps movement to frame zero and the last valid frame', () => {
    expect(
      constrainSelectedKeyframeDelta({
        keyframesByProperty: {
          x: [{ id: 'kf-1', frame: 2, value: 0, easing: 'linear' }],
        },
        selectedKeyframeIds: new Set(['kf-1']),
        totalFrames: 6,
        deltaFrames: -10,
      })
    ).toBe(-2);

    expect(
      constrainSelectedKeyframeDelta({
        keyframesByProperty: {
          x: [{ id: 'kf-1', frame: 2, value: 0, easing: 'linear' }],
        },
        selectedKeyframeIds: new Set(['kf-1']),
        totalFrames: 6,
        deltaFrames: 10,
      })
    ).toBe(3);
  });
});
