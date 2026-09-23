// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildEffectAnimatableProperty } from '@/types/keyframe'
import { computeKeyframeFrameBounds, formatDopesheetPropertyValue } from './dopesheet-helpers'

function keyframe(id: string, frame: number) {
  return { id, frame, value: 0, easing: 'linear' as const }
}

describe('computeKeyframeFrameBounds', () => {
  it('spans every keyframe of every property', () => {
    expect(
      computeKeyframeFrameBounds({
        x: [keyframe('a', 12), keyframe('b', 40)],
        opacity: [keyframe('c', 3)],
      }),
    ).toEqual({ min: 3, max: 40 })
  })

  it('returns null when no property holds a keyframe', () => {
    expect(computeKeyframeFrameBounds({ x: [], opacity: undefined })).toBeNull()
    expect(computeKeyframeFrameBounds({})).toBeNull()
  })
})

describe('formatDopesheetPropertyValue', () => {
  const colorProperty = buildEffectAnimatableProperty('gpu-fluted-glass', 'fx-1', 'colorShadow')

  it('formats colour properties as hex', () => {
    expect(formatDopesheetPropertyValue(colorProperty, 0xff0000)).toBe('#ff0000')
  })

  it('rounds properties whose range carries no decimals', () => {
    expect(formatDopesheetPropertyValue('x', 12.6)).toBe('13')
    expect(formatDopesheetPropertyValue('x', -0.4)).toBe('0')
  })

  it('uses the range decimals for the remaining properties', () => {
    expect(formatDopesheetPropertyValue('opacity', 0.4567)).toBe('0.46')
  })

  it('renders nothing for a missing or NaN value', () => {
    expect(formatDopesheetPropertyValue('opacity', undefined)).toBe('')
    expect(formatDopesheetPropertyValue('opacity', Number.NaN)).toBe('')
  })
})
