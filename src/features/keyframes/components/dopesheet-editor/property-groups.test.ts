import { describe, expect, it } from 'vite-plus/test'
import { getPropertyAccordionGroups } from './property-groups'

describe('getPropertyAccordionGroups', () => {
  it('groups transform and audio properties in a stable order', () => {
    expect(
      getPropertyAccordionGroups(['volume', 'cropRight', 'anchorY', 'y', 'anchorX', 'x']),
    ).toEqual([
      {
        id: 'transform',
        label: 'Transform',
        properties: ['x', 'y', 'anchorX', 'anchorY'],
      },
      {
        id: 'crop',
        label: 'Crop',
        properties: ['cropRight'],
      },
      {
        id: 'audio',
        label: 'Audio',
        properties: ['volume'],
      },
    ])
  })
})
