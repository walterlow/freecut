import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/types/timeline';
import { getAnimatablePropertiesForItem } from './animatable-properties';

function createItem(type: TimelineItem['type']): TimelineItem {
  return {
    id: `${type}-1`,
    type,
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: `${type} item`,
  };
}

describe('getAnimatablePropertiesForItem', () => {
  it('includes anchor properties for video items', () => {
    expect(getAnimatablePropertiesForItem(createItem('video'))).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'cornerRadius',
      'anchorX',
      'anchorY',
      'volume',
    ]);
  });

  it('includes anchor properties for composition items', () => {
    expect(getAnimatablePropertiesForItem({
      ...createItem('composition'),
      compositionId: 'comp-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    })).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'cornerRadius',
      'anchorX',
      'anchorY',
      'volume',
    ]);
  });

  it('does not expose anchor properties for non-video visual items', () => {
    expect(getAnimatablePropertiesForItem(createItem('image'))).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'cornerRadius',
    ]);
  });
});
