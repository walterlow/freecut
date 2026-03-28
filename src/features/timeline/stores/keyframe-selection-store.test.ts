import { beforeEach, describe, expect, it } from 'vitest';
import type { ItemKeyframes } from '@/types/keyframe';
import { useKeyframeSelectionStore } from './keyframe-selection-store';
import { useKeyframesStore } from './keyframes-store';

describe('useKeyframeSelectionStore', () => {
  beforeEach(() => {
    useKeyframesStore.getState().setKeyframes([]);
    useKeyframeSelectionStore.setState({
      selectedKeyframes: [],
      clipboard: null,
      isCut: false,
    });
  });

  it('stores origin frame and source refs when copying keyframes', () => {
    const initialKeyframes: ItemKeyframes[] = [
      {
        itemId: 'item-1',
        properties: [
          {
            property: 'x',
            keyframes: [
              { id: 'kf-a', frame: 5, value: 10, easing: 'linear' },
            ],
          },
          {
            property: 'opacity',
            keyframes: [
              { id: 'kf-b', frame: 9, value: 0.5, easing: 'linear' },
            ],
          },
        ],
      },
    ];

    useKeyframesStore.getState().setKeyframes(initialKeyframes);
    useKeyframeSelectionStore.getState().selectKeyframes([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-a' },
      { itemId: 'item-1', property: 'opacity', keyframeId: 'kf-b' },
    ]);

    useKeyframeSelectionStore.getState().copySelectedKeyframes();

    expect(useKeyframeSelectionStore.getState().clipboard).toEqual({
      keyframes: [
        { property: 'x', frame: 0, value: 10, easing: 'linear', easingConfig: undefined },
        { property: 'opacity', frame: 4, value: 0.5, easing: 'linear', easingConfig: undefined },
      ],
      sourceItemId: 'item-1',
      originFrame: 5,
      sourceRefs: [
        { itemId: 'item-1', property: 'x', keyframeId: 'kf-a' },
        { itemId: 'item-1', property: 'opacity', keyframeId: 'kf-b' },
      ],
    });
  });
});
