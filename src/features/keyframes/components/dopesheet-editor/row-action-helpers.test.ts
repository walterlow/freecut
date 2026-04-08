import { describe, expect, it } from 'vitest';
import {
  buildGroupAddEntries,
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  getRemovableGroupCurrentKeyframes,
  removeSelectionIds,
} from './row-action-helpers';

describe('row action helpers', () => {
  const rows = [
    {
      property: 'x' as const,
      keyframes: [
        { id: 'kf-x-1', frame: 12, value: 100, easing: 'linear' as const },
        { id: 'kf-x-2', frame: 24, value: 140, easing: 'linear' as const },
      ],
    },
    {
      property: 'y' as const,
      keyframes: [{ id: 'kf-y-1', frame: 12, value: 200, easing: 'linear' as const }],
    },
  ];

  it('builds row-scoped keyframe refs', () => {
    expect(buildRowKeyframeRefs('item-1', rows)).toEqual([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-2' },
      { itemId: 'item-1', property: 'y', keyframeId: 'kf-y-1' },
    ]);
  });

  it('builds property-scoped keyframe refs', () => {
    expect(buildPropertyKeyframeRefs('item-1', 'x', rows[0]!.keyframes)).toEqual([
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-1' },
      { itemId: 'item-1', property: 'x', keyframeId: 'kf-x-2' },
    ]);
  });

  it('removes deleted ids from the current selection', () => {
    expect(removeSelectionIds(new Set(['kf-x-1', 'kf-y-1']), ['kf-y-1'])).toEqual(
      new Set(['kf-x-1'])
    );
  });

  it('collects add entries only for rows that can add keyframes', () => {
    expect(
      buildGroupAddEntries(rows, 12, (row) => row.property !== 'y')
    ).toEqual([{ property: 'x', frame: 12 }]);
  });

  it('filters group current keyframes down to unlocked properties', () => {
    expect(
      getRemovableGroupCurrentKeyframes(
        rows.flatMap((row) => row.keyframes.map((keyframe) => ({ property: row.property, keyframe }))),
        (property) => property === 'y'
      )
    ).toEqual([
      {
        property: 'x',
        keyframe: { id: 'kf-x-1', frame: 12, value: 100, easing: 'linear' },
      },
      {
        property: 'x',
        keyframe: { id: 'kf-x-2', frame: 24, value: 140, easing: 'linear' },
      },
    ]);
  });
});
