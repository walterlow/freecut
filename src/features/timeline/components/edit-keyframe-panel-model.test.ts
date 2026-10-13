import { describe, expect, it } from 'vite-plus/test'

import type { ItemKeyframes } from '@/types/keyframe'
import {
  hasEditableKeyframes,
  isVectorPropertySeparated,
  resolveEditorScalarLane,
  shouldShowSeparatedPosition,
} from './edit-keyframe-panel-model'

describe('Edit keyframe panel model', () => {
  it('detects scalar and vector keyframes', () => {
    const scalar: ItemKeyframes = {
      itemId: 'scalar-clip',
      properties: [
        {
          property: 'opacity',
          keyframes: [{ id: 'opacity-1', frame: 0, value: 1, easing: 'linear' }],
        },
      ],
    }
    const vector: ItemKeyframes = {
      itemId: 'vector-clip',
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            {
              id: 'position-1',
              frame: 0,
              value: { x: 10, y: 20 },
              easing: 'linear',
            },
          ],
        },
      ],
    }

    expect(hasEditableKeyframes(scalar)).toBe(true)
    expect(hasEditableKeyframes(vector)).toBe(true)
  })

  it('rejects missing and empty keyframe data', () => {
    expect(hasEditableKeyframes(null)).toBe(false)
    expect(hasEditableKeyframes({ itemId: 'empty', properties: [] })).toBe(false)
  })

  it('presents a legacy one-axis position preset as one coupled Position lane', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'legacy-preset',
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'x-1', frame: 10, value: 20, easing: 'ease-out' },
            { id: 'x-2', frame: 20, value: 40, easing: 'linear' },
          ],
        },
      ],
    }

    expect(shouldShowSeparatedPosition(itemKeyframes)).toBe(false)
  })

  it('keeps explicitly separated or independently timed X/Y lanes separate', () => {
    const explicit: ItemKeyframes = {
      itemId: 'explicit',
      properties: [],
      separatedVectorProperties: ['position'],
    }
    const independent: ItemKeyframes = {
      itemId: 'independent',
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x-1', frame: 10, value: 20, easing: 'linear' }],
        },
        {
          property: 'y',
          keyframes: [{ id: 'y-1', frame: 15, value: 40, easing: 'linear' }],
        },
      ],
    }

    expect(shouldShowSeparatedPosition(explicit)).toBe(true)
    expect(shouldShowSeparatedPosition(independent)).toBe(true)
  })

  it('allows matching legacy X/Y timings to migrate as one Position lane', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'matching',
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x-1', frame: 10, value: 20, easing: 'ease-out' }],
        },
        {
          property: 'y',
          keyframes: [{ id: 'y-1', frame: 10, value: 40, easing: 'ease-out' }],
        },
      ],
    }

    expect(shouldShowSeparatedPosition(itemKeyframes)).toBe(false)
  })

  it('keeps separated lanes out of shared-vector edit operations', () => {
    const explicit: ItemKeyframes = {
      itemId: 'explicit-vectors',
      properties: [],
      separatedVectorProperties: ['position', 'scale'],
    }
    const legacyIndependent: ItemKeyframes = {
      itemId: 'legacy-independent',
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x-1', frame: 10, value: 20, easing: 'linear' }],
        },
        {
          property: 'y',
          keyframes: [{ id: 'y-1', frame: 15, value: 40, easing: 'linear' }],
        },
      ],
    }

    expect(isVectorPropertySeparated(explicit, 'position')).toBe(true)
    expect(isVectorPropertySeparated(explicit, 'scale')).toBe(true)
    expect(isVectorPropertySeparated(explicit, 'anchor')).toBe(false)
    expect(isVectorPropertySeparated(legacyIndependent, 'position')).toBe(true)
  })

  it('uses real scalar IDs for separated lanes instead of synthetic vector IDs', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'separated-position',
      separatedVectorProperties: ['position'],
      properties: [
        {
          property: 'y',
          keyframes: [{ id: 'real-y', frame: 12, value: 40, easing: 'linear' }],
        },
      ],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'vector-position', frame: 12, value: { x: 20, y: 40 }, easing: 'linear' },
          ],
        },
      ],
    }

    expect(
      resolveEditorScalarLane(
        itemKeyframes,
        'position',
        'y',
        'y',
        itemKeyframes.vectorProperties![0]!.keyframes,
      ),
    ).toEqual(itemKeyframes.properties[0]!.keyframes)
  })
})
