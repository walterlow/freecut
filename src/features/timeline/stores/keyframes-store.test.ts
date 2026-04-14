import { beforeEach, describe, expect, it } from 'vitest';
import type { ItemKeyframes } from '@/types/keyframe';
import { useKeyframesStore } from './keyframes-store';

describe('useKeyframesStore', () => {
  beforeEach(() => {
    useKeyframesStore.getState().setKeyframes([]);
  });

  it('deduplicates same-frame collisions when updating a keyframe frame', () => {
    const initialKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-1',
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-a', frame: 0, value: 0, easing: 'linear' },
              { id: 'kf-b', frame: 10, value: 10, easing: 'linear' },
            ],
          },
        ],
      },
    ];

    useKeyframesStore.getState().setKeyframes(initialKeyframes);
    useKeyframesStore.getState()._updateKeyframe('item-1', 'x', 'kf-a', {
      frame: 10,
      value: 42,
    });

    const updated = useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x');
    expect(updated).toEqual([
      { id: 'kf-a', frame: 10, value: 42, easing: 'linear' },
    ]);
  });

  it('returns the existing keyframe id when addKeyframes overwrites a same-frame keyframe', () => {
    const initialKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-1',
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-existing', frame: 12, value: 1, easing: 'linear' },
            ],
          },
        ],
      },
    ];

    useKeyframesStore.getState().setKeyframes(initialKeyframes);
    const ids = useKeyframesStore.getState()._addKeyframes([
      {
        itemId: 'item-1',
        property: 'x',
        frame: 12,
        value: 9,
        easing: 'linear',
      },
    ]);

    expect(ids).toEqual(['kf-existing']);
    expect(useKeyframesStore.getState().getAllKeyframesForProperty('item-1', 'x')).toEqual([
      { id: 'kf-existing', frame: 12, value: 9, easing: 'linear' },
    ]);
  });
});
