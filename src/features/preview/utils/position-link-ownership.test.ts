import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import { getPositionLinkOwner } from './position-link-ownership'

function keyframesWithLinks(
  propertyLinks: NonNullable<ItemKeyframes['propertyLinks']>,
): ItemKeyframes {
  return {
    itemId: 'text',
    properties: [],
    vectorProperties: [],
    propertyLinks,
    expressions: [],
  }
}

describe('getPositionLinkOwner', () => {
  it.each(['position', 'x', 'y'] as const)(
    'blocks canvas translation when %s is link-driven',
    (targetProperty) => {
      const link = {
        type: 'link' as const,
        targetProperty,
        sourceItemId: 'polygon',
        sourceProperty: targetProperty,
        enabled: true,
        timeOffsetFrames: 0,
      }

      expect(getPositionLinkOwner(keyframesWithLinks([link]))).toEqual(link)
    },
  )

  it('ignores disabled and non-position links', () => {
    expect(
      getPositionLinkOwner(
        keyframesWithLinks([
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: 'polygon',
            sourceProperty: 'position',
            enabled: false,
            timeOffsetFrames: 0,
          },
          {
            type: 'link',
            targetProperty: 'rotation',
            sourceItemId: 'polygon',
            sourceProperty: 'rotation',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ]),
      ),
    ).toBeNull()
  })
})
