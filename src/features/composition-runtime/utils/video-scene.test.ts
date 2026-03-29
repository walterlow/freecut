import { describe, expect, it } from 'vitest';
import {
  collectShadowItemIndices,
  findActiveVideoItemIndex,
  groupStableVideoItems,
} from './video-scene';

describe('video scene', () => {
  it('groups stable video items by origin and adjacency', () => {
    const groups = groupStableVideoItems([
      { id: 'clip-1', mediaId: 'media-1', originId: 'origin-1', from: 0, durationInFrames: 30 },
      { id: 'clip-2', mediaId: 'media-1', originId: 'origin-1', from: 30, durationInFrames: 20 },
      { id: 'clip-3', mediaId: 'media-1', originId: 'origin-1', from: 80, durationInFrames: 10 },
    ]);

    expect(groups.map((group) => ({
      originKey: group.originKey,
      itemIds: group.items.map((item) => item.id),
      minFrom: group.minFrom,
      maxEnd: group.maxEnd,
    }))).toEqual([
      {
        originKey: 'media-1-origin-1-clip-1',
        itemIds: ['clip-1', 'clip-2'],
        minFrom: 0,
        maxEnd: 50,
      },
      {
        originKey: 'media-1-origin-1-clip-3',
        itemIds: ['clip-3'],
        minFrom: 80,
        maxEnd: 90,
      },
    ]);
  });

  it('splits custom-speed clips into their own stable groups', () => {
    const groups = groupStableVideoItems([
      { id: 'clip-1', mediaId: 'media-1', originId: 'origin-1', from: 0, durationInFrames: 30 },
      { id: 'clip-2', mediaId: 'media-1', originId: 'origin-1', from: 30, durationInFrames: 20, speed: 1.5 },
    ]);

    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['clip-1'],
      ['clip-2'],
    ]);
  });

  it('prefers the right-most overlapping active clip at a frame', () => {
    const items = [
      { id: 'left', from: 0, durationInFrames: 30 },
      { id: 'right', from: 20, durationInFrames: 30 },
    ];

    expect(findActiveVideoItemIndex(items, 10)).toBe(0);
    expect(findActiveVideoItemIndex(items, 25)).toBe(1);
    expect(findActiveVideoItemIndex(items, 55)).toBe(-1);
  });

  it('collects overlap shadow indices with lookahead', () => {
    const items = [
      { id: 'left', from: 0, durationInFrames: 30 },
      { id: 'right', from: 35, durationInFrames: 20 },
      { id: 'later', from: 80, durationInFrames: 10 },
    ];

    expect(collectShadowItemIndices({
      items,
      activeItemIndex: 0,
      globalFrame: 10,
      lookaheadFrames: 30,
    })).toEqual([1]);

    expect(collectShadowItemIndices({
      items,
      activeItemIndex: 1,
      globalFrame: 40,
      lookaheadFrames: 10,
    })).toEqual([]);
  });
});
