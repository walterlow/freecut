import { describe, expect, it } from 'vitest'

import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS } from '@/types/keyframe'
import {
  buildEasingConfig,
  clampBezierValue,
  clampSpringValue,
  findMatchingBezierPreset,
} from './easing-presets'

describe('buildEasingConfig', () => {
  it('maps named eases to their fixed bezier curve', () => {
    expect(buildEasingConfig('ease-in')).toEqual({
      type: 'cubic-bezier',
      bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 },
    })
    expect(buildEasingConfig('ease-out')).toEqual({
      type: 'cubic-bezier',
      bezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 },
    })
  })

  it('returns no config for linear and hold', () => {
    expect(buildEasingConfig('linear')).toBeUndefined()
    expect(buildEasingConfig('hold')).toBeUndefined()
  })

  it('preserves an existing compatible cubic-bezier config', () => {
    const existing = { type: 'cubic-bezier' as const, bezier: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 } }
    expect(buildEasingConfig('cubic-bezier', existing)?.bezier).toEqual(existing.bezier)
  })

  it('falls back to defaults for cubic-bezier / spring without a compatible config', () => {
    expect(buildEasingConfig('cubic-bezier')?.bezier).toEqual(DEFAULT_BEZIER_POINTS)
    // A spring easing should not adopt an incompatible bezier config.
    expect(
      buildEasingConfig('spring', { type: 'cubic-bezier', bezier: DEFAULT_BEZIER_POINTS })?.spring,
    ).toEqual(DEFAULT_SPRING_PARAMS)
  })

  it('preserves an existing spring config', () => {
    const existing = { type: 'spring' as const, spring: { tension: 200, friction: 12, mass: 2 } }
    expect(buildEasingConfig('spring', existing)?.spring).toEqual(existing.spring)
  })
})

describe('findMatchingBezierPreset', () => {
  it('identifies the named preset for exact control points', () => {
    // The default points coincide with the "soft" preset.
    expect(findMatchingBezierPreset(DEFAULT_BEZIER_POINTS)).toBe('soft')
    expect(findMatchingBezierPreset({ x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 })).toBe('overshoot')
  })

  it('returns "custom" when no preset matches', () => {
    expect(findMatchingBezierPreset({ x1: 0.11, y1: 0.22, x2: 0.33, y2: 0.44 })).toBe('custom')
  })
})

describe('clamping', () => {
  it('clamps bezier x to [0,1] and y to [-2,3]', () => {
    expect(clampBezierValue('x1', 1.5)).toBe(1)
    expect(clampBezierValue('x2', -0.5)).toBe(0)
    expect(clampBezierValue('y1', 5)).toBe(3)
    expect(clampBezierValue('y2', -9)).toBe(-2)
  })

  it('clamps spring parameters to their valid ranges', () => {
    expect(clampSpringValue('tension', 9999)).toBe(500)
    expect(clampSpringValue('friction', 0)).toBe(1)
    expect(clampSpringValue('mass', 0)).toBe(0.1)
  })
})
