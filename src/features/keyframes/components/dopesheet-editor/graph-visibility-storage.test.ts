import { describe, it, expect, beforeEach } from 'vitest'
import type { AnimatableProperty } from '@/types/keyframe'
import { loadGraphVisibleProperties, saveGraphVisibleProperties } from './graph-visibility-storage'

const ITEM = 'item-1'
const props = (...names: string[]) => names as AnimatableProperty[]

describe('graph visible properties storage', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to the selected property when nothing is stored', () => {
    const result = loadGraphVisibleProperties(ITEM, props('x', 'y'), 'y' as AnimatableProperty)
    expect([...result]).toEqual(['y'])
  })

  it('defaults to the first property when nothing is stored and none is selected', () => {
    const result = loadGraphVisibleProperties(ITEM, props('x', 'y'), null)
    expect([...result]).toEqual(['x'])
  })

  it('falls back to a default curve when an empty set was stored but the clip is animated', () => {
    // Regression: applying a preset (or otherwise adding keyframes) must not leave
    // the graph blank just because an empty set had been persisted earlier.
    saveGraphVisibleProperties(ITEM, new Set())
    const result = loadGraphVisibleProperties(ITEM, props('x', 'y'), 'x' as AnimatableProperty)
    expect([...result]).toEqual(['x'])
  })

  it('keeps only stored properties that are still available', () => {
    saveGraphVisibleProperties(ITEM, new Set(props('x', 'rotation')))
    const result = loadGraphVisibleProperties(ITEM, props('x', 'y'), null)
    expect([...result]).toEqual(['x'])
  })

  it('prefers a property with a real curve over a single-keyframe selection', () => {
    // 'x' is selected but has <2 keyframes; only 'opacity' is graphable, so the
    // default must land on opacity rather than blanking the graph on x.
    const result = loadGraphVisibleProperties(
      ITEM,
      props('x', 'opacity'),
      'x' as AnimatableProperty,
      props('opacity'),
    )
    expect([...result]).toEqual(['opacity'])
  })

  it('keeps the selection when it has a real curve', () => {
    const result = loadGraphVisibleProperties(
      ITEM,
      props('x', 'opacity'),
      'opacity' as AnimatableProperty,
      props('opacity'),
    )
    expect([...result]).toEqual(['opacity'])
  })

  it('ignores a stored set that has no drawable curve and falls back to a graphable default', () => {
    // Regression: a leftover ["x"] (single-keyframe / no curve) must not keep the
    // graph parked on a curveless property while width/height are animated.
    saveGraphVisibleProperties(ITEM, new Set(props('x')))
    const result = loadGraphVisibleProperties(
      ITEM,
      props('x', 'width', 'height'),
      null,
      props('width', 'height'),
    )
    expect([...result]).toEqual(['width'])
  })

  it('keeps a stored set that includes at least one drawable curve', () => {
    saveGraphVisibleProperties(ITEM, new Set(props('x', 'width')))
    const result = loadGraphVisibleProperties(
      ITEM,
      props('x', 'width', 'height'),
      null,
      props('width', 'height'),
    )
    expect([...result].sort()).toEqual(['width', 'x'])
  })

  it('returns an empty set when the clip has no animatable properties', () => {
    saveGraphVisibleProperties(ITEM, new Set(props('x')))
    const result = loadGraphVisibleProperties(ITEM, props(), null)
    expect(result.size).toBe(0)
  })
})
