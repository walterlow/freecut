import { describe, expect, it } from 'vitest';
import { collectVisualInvalidationRanges } from './preview-frame-invalidation';
import type { CompositionInputProps } from '@/types/export';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem } from '@/types/timeline';

function createTracks(items: TimelineItem[]): CompositionInputProps['tracks'] {
  return [
    {
      id: 'track-1',
      name: 'Track 1',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items,
    },
  ];
}

describe('collectVisualInvalidationRanges', () => {
  it('returns merged frame ranges for changed items and keyframes', () => {
    const unchangedItem = {
      id: 'item-unchanged',
      type: 'video',
      trackId: 'track-1',
      from: 200,
      durationInFrames: 30,
      src: 'blob:unchanged',
    } as TimelineItem;
    const previousItem = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 40,
      src: 'blob:clip',
      transform: { x: 0, y: 0, width: 100, height: 60, rotation: 0, opacity: 1 },
    } as TimelineItem;
    const nextItem = {
      ...previousItem,
      transform: { ...previousItem.transform!, x: 50 },
    } as TimelineItem;
    const previousKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-2',
        properties: [
          {
            property: 'x',
            keyframes: [{ id: 'kf-1', frame: 0, value: 0, easing: 'linear' }],
          },
        ],
      },
    ];
    const nextKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-2',
        properties: [
          {
            property: 'x',
            keyframes: [{ id: 'kf-2', frame: 0, value: 100, easing: 'linear' }],
          },
        ],
      },
    ];
    const keyedItem = {
      id: 'item-2',
      type: 'video',
      trackId: 'track-1',
      from: 40,
      durationInFrames: 30,
      src: 'blob:keyed',
    } as TimelineItem;

    expect(collectVisualInvalidationRanges({
      previousTracks: createTracks([previousItem, keyedItem, unchangedItem]),
      nextTracks: createTracks([nextItem, keyedItem, unchangedItem]),
      previousKeyframes,
      nextKeyframes,
    })).toEqual([
      { startFrame: 10, endFrame: 70 },
    ]);
  });

  it('skips invalidation when item and keyframe references are unchanged', () => {
    const item = {
      id: 'item-1',
      type: 'video',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      src: 'blob:clip',
    } as TimelineItem;
    const keyframes: ItemKeyframes[] = [];
    const tracks = createTracks([item]);

    expect(collectVisualInvalidationRanges({
      previousTracks: tracks,
      nextTracks: tracks,
      previousKeyframes: keyframes,
      nextKeyframes: keyframes,
    })).toEqual([]);
  });
});
