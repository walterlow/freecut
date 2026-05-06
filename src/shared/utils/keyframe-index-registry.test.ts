import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  clearKeyframeIndex,
  getAdaptiveStreamStart,
  registerKeyframeIndex,
} from './keyframe-index-registry'

afterEach(() => {
  clearKeyframeIndex()
})

describe('getAdaptiveStreamStart', () => {
  it('returns the nearest keyframe timestamp at or before the target with safety margin', () => {
    registerKeyframeIndex('blob:clip', [0, 5, 10, 15])

    // Default 0.05s margin to ensure decoder picks up the keyframe
    expect(getAdaptiveStreamStart('blob:clip', 10)).toBe(9.95)
    expect(getAdaptiveStreamStart('blob:clip', 10.25)).toBe(9.95)
    expect(getAdaptiveStreamStart('blob:clip', 14.99)).toBe(9.95)
    // Margin clamped to 0 at start of file
    expect(getAdaptiveStreamStart('blob:clip', 0.01)).toBe(0)
  })

  it('returns null when no earlier keyframe exists', () => {
    registerKeyframeIndex('blob:clip', [5, 10, 15])

    expect(getAdaptiveStreamStart('blob:clip', 4.99)).toBeNull()
  })
})
