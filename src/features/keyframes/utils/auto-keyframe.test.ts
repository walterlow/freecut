import { describe, expect, it } from 'vitest';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';
import { useAutoKeyframeStore } from '../stores/auto-keyframe-store';
import { getAutoKeyframeOperation } from './auto-keyframe';

const item: TimelineItem = {
  id: 'item-1',
  type: 'video',
  trackId: 'track-1',
  from: 10,
  durationInFrames: 30,
  label: 'Clip',
  src: 'clip.mp4',
};

describe('getAutoKeyframeOperation', () => {
  it('does not add a keyframe just because the property is already animated', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'kf-1', frame: 2, value: 100, easing: 'linear' }],
        },
      ],
    };

    expect(getAutoKeyframeOperation(item, itemKeyframes, 'x', 200, 15)).toBeNull();
  });

  it('adds a keyframe when the dopesheet auto-key toggle is enabled', () => {
    useAutoKeyframeStore.getState().setAutoKeyframeEnabled(item.id, 'x', true);

    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 15)).toEqual({
      type: 'add',
      itemId: item.id,
      property: 'x',
      frame: 5,
      value: 200,
      easing: 'linear',
    });
  });

  it('still updates an existing keyframe at the current frame when auto-key is off', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: item.id,
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'kf-1', frame: 5, value: 100, easing: 'linear' }],
        },
      ],
    };

    expect(getAutoKeyframeOperation(item, itemKeyframes, 'x', 200, 15)).toEqual({
      type: 'update',
      itemId: item.id,
      property: 'x',
      keyframeId: 'kf-1',
      updates: { value: 200 },
    });
  });

  it('does not auto-key outside the clip bounds even when enabled', () => {
    useAutoKeyframeStore.getState().setAutoKeyframeEnabled(item.id, 'x', true);

    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 9)).toBeNull();
    expect(getAutoKeyframeOperation(item, undefined, 'x', 200, 40)).toBeNull();
  });
});
