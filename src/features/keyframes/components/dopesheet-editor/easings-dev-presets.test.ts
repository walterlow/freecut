import { describe, expect, it } from 'vitest'

import {
  EASING_PRESETS,
  SPRING_PRESETS,
  effectiveBezier,
  findMatchingPreset,
  presetMatchesEasing,
  presetToEasing,
} from './easings-dev-presets'

describe('presetToEasing', () => {
  it('maps an Easing preset to a cubic-bezier config with its exact points', () => {
    const anticipate = EASING_PRESETS.find((p) => p.name === 'Anticipate')!
    expect(presetToEasing(anticipate)).toEqual({
      easing: 'cubic-bezier',
      easingConfig: { type: 'cubic-bezier', bezier: { x1: 1, y1: -0.4, x2: 0.35, y2: 0.95 } },
    })
  })

  it('maps a Spring preset to a spring config (stiffness/damping → tension/friction)', () => {
    const elegant = SPRING_PRESETS.find((p) => p.name === 'Elegant')!
    expect(presetToEasing(elegant)).toEqual({
      easing: 'spring',
      easingConfig: { type: 'spring', spring: { tension: 150, friction: 19, mass: 1.2 } },
    })
  })
})

describe('findMatchingPreset', () => {
  it('round-trips every preset to one with identical values', () => {
    // Note: a few easings.dev presets share the same curve (e.g. "Snappy Out"
    // and "Out Expo" are both [0.19, 1, 0.22, 1]), so matching recovers *a*
    // preset with the same values, not necessarily the same name.
    for (const preset of [...EASING_PRESETS, ...SPRING_PRESETS]) {
      const { easing, easingConfig } = presetToEasing(preset)
      const matched = findMatchingPreset(easing, easingConfig)
      expect(matched).not.toBeNull()
      expect(presetToEasing(matched!).easingConfig).toEqual(easingConfig)
    }
  })

  it('returns null for hold and for an unlisted custom curve', () => {
    expect(findMatchingPreset('hold', undefined)).toBeNull()
    expect(
      findMatchingPreset('cubic-bezier', {
        type: 'cubic-bezier',
        bezier: { x1: 0.11, y1: 0.22, x2: 0.33, y2: 0.44 },
      }),
    ).toBeNull()
  })

  it('matches the legacy named "linear" easing to the Linear preset', () => {
    expect(findMatchingPreset('linear', undefined)?.name).toBe('Linear')
  })
})

describe('presetMatchesEasing (identical-curve disambiguation)', () => {
  it('matches every preset sharing a curve — the picker uses this to keep the right one highlighted', () => {
    // easings.dev ships two presets with the same curve.
    const config = {
      type: 'cubic-bezier' as const,
      bezier: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },
    }
    const snappyOut = EASING_PRESETS.find((p) => p.name === 'Snappy Out')!
    const outExpo = EASING_PRESETS.find((p) => p.name === 'Out Expo')!
    expect(presetMatchesEasing(snappyOut, 'cubic-bezier', config)).toBe(true)
    expect(presetMatchesEasing(outExpo, 'cubic-bezier', config)).toBe(true)
    // findMatchingPreset can only return one (source order), which is why the
    // popover prefers the user's explicit pick instead.
    expect(findMatchingPreset('cubic-bezier', config)?.name).toBe('Snappy Out')
  })

  it('does not match a bezier preset against a spring config, or vice versa', () => {
    const snappyOut = EASING_PRESETS.find((p) => p.name === 'Snappy Out')!
    const spring = SPRING_PRESETS[0]!
    expect(
      presetMatchesEasing(snappyOut, 'spring', {
        type: 'spring',
        spring: spring.spring!,
      }),
    ).toBe(false)
    expect(
      presetMatchesEasing(spring, 'cubic-bezier', {
        type: 'cubic-bezier',
        bezier: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },
      }),
    ).toBe(false)
  })
})

describe('effectiveBezier', () => {
  it('falls back to the linear diagonal when there is no shaped curve', () => {
    expect(effectiveBezier('linear', undefined)).toEqual({ x1: 0, y1: 0, x2: 1, y2: 1 })
    expect(effectiveBezier('spring', { type: 'spring', spring: { tension: 1, friction: 1, mass: 1 } })).toEqual({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
    })
  })

  it('uses a stored cubic-bezier config verbatim', () => {
    const bezier = { x1: 0.3, y1: 0.1, x2: 0.7, y2: 0.9 }
    expect(effectiveBezier('cubic-bezier', { type: 'cubic-bezier', bezier })).toEqual(bezier)
  })
})
