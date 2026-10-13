// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { AnimatableProperty, ItemKeyframes } from '@/types/keyframe'
import { getVisibleMotionPathProperties } from './motion-path-property-visibility'

const properties: AnimatableProperty[] = [
  'x',
  'pathVertex:0:positionX',
  'pathVertex:0:positionY',
  'pathVertex:1:positionX',
  'pathVertex:1:positionY',
  'opacity',
]

describe('getVisibleMotionPathProperties', () => {
  it('shows only the selected vertex channels while keeping non-path properties', () => {
    expect(getVisibleMotionPathProperties(properties, { selectedVertexIndices: [1] })).toEqual([
      'x',
      'pathVertex:1:positionX',
      'pathVertex:1:positionY',
      'opacity',
    ])
  })

  it('never hides keyed or actively graphed path channels', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'path-1',
      properties: [
        {
          property: 'pathVertex:0:positionX',
          keyframes: [{ id: 'key-1', frame: 0, value: 0.25, easing: 'linear' }],
        },
      ],
    }
    expect(
      getVisibleMotionPathProperties(properties, {
        itemKeyframes,
        selectedVertexIndices: [1],
        alwaysInclude: 'pathVertex:0:positionY',
      }),
    ).toEqual(properties)
  })

  it('defaults an unanimated path to Vertex 1 and supports explicit all-vertex mode', () => {
    expect(getVisibleMotionPathProperties(properties)).toEqual([
      'x',
      'pathVertex:0:positionX',
      'pathVertex:0:positionY',
      'opacity',
    ])
    expect(getVisibleMotionPathProperties(properties, { showAllVertices: true })).toEqual(
      properties,
    )
  })
})
