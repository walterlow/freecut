import { describe, expect, it } from 'vitest';
import { getDopesheetRowControlState } from './row-controls';

const keyframes = [
  { id: 'kf-1', frame: 10, value: 0, easing: 'linear' as const },
  { id: 'kf-2', frame: 24, value: 10, easing: 'linear' as const },
  { id: 'kf-3', frame: 36, value: 20, easing: 'linear' as const },
];

describe('getDopesheetRowControlState', () => {
  it('returns previous and next keyframes around the current frame', () => {
    const state = getDopesheetRowControlState(keyframes, 24);

    expect(state.prevKeyframe?.id).toBe('kf-1');
    expect(state.nextKeyframe?.id).toBe('kf-3');
    expect(state.currentKeyframes.map((keyframe) => keyframe.id)).toEqual(['kf-2']);
    expect(state.hasKeyframeAtCurrentFrame).toBe(true);
  });

  it('reports no previous keyframe at the start of the row', () => {
    const state = getDopesheetRowControlState(keyframes, 5);

    expect(state.prevKeyframe).toBeNull();
    expect(state.nextKeyframe?.id).toBe('kf-1');
    expect(state.hasKeyframeAtCurrentFrame).toBe(false);
  });
});
