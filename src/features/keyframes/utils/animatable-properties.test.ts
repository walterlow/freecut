import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import { getAnimatablePropertiesForItem } from './animatable-properties'

function createItem<TType extends TimelineItem['type']>(
  type: TType,
): Extract<TimelineItem, { type: TType }> {
  return {
    id: `${type}-1`,
    type,
    trackId: 'track-1',
    from: 0,
    durationInFrames: 60,
    label: `${type} item`,
  } as Extract<TimelineItem, { type: TType }>
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
      'cropLeft',
      'cropRight',
      'cropTop',
      'cropBottom',
      'cropSoftness',
      'volume',
    ])
  })

  it('includes anchor properties for composition items', () => {
    expect(
      getAnimatablePropertiesForItem({
        ...createItem('composition'),
        compositionId: 'comp-1',
        compositionWidth: 1920,
        compositionHeight: 1080,
      }),
    ).toEqual([
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
    ])
  })

  it('does not expose anchor properties for non-video visual items', () => {
    expect(getAnimatablePropertiesForItem(createItem('image'))).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'cornerRadius',
    ])
  })

  it('includes text-specific properties for text items', () => {
    expect(
      getAnimatablePropertiesForItem({
        ...createItem('text'),
        text: 'Hello world',
        color: '#ffffff',
      }),
    ).toEqual([
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'cornerRadius',
      'textStyleScale',
      'fontSize',
      'lineHeight',
      'textPadding',
      'backgroundRadius',
      'textShadowOffsetX',
      'textShadowOffsetY',
      'textShadowBlur',
      'strokeWidth',
    ])
  })
})
