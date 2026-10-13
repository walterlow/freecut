// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { displaySize, medianFps } from './render-support'

describe('displaySize', () => {
  it('leaves an unrotated frame alone', () => {
    expect(displaySize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
  })

  it('leaves a 180-degree frame alone', () => {
    expect(displaySize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 })
  })

  it.each([90, 270])('swaps the axes at %i degrees', (rotation) => {
    expect(displaySize(1920, 1080, rotation)).toEqual({ width: 1080, height: 1920 })
  })

  it('turns a landscape-coded phone video upright', () => {
    // The exact case that squashed portrait footage into a landscape frame: the container
    // reports 1920x1080 while the rotation matrix says the frames are portrait.
    expect(displaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 })
  })

  it('is an involution: rotating a rotated size back restores it', () => {
    const once = displaySize(1920, 1080, 90)
    expect(displaySize(once.width, once.height, 90)).toEqual({ width: 1920, height: 1080 })
  })
})

describe('medianFps', () => {
  it('falls back when no gaps were observed', () => {
    expect(medianFps([], 24)).toBe(24)
  })

  it('inverts the median gap', () => {
    expect(medianFps([0.04, 0.04, 0.04], 30)).toBeCloseTo(25, 6)
  })

  it('averages the two middle gaps for an even count', () => {
    expect(medianFps([0.02, 0.04], 30)).toBeCloseTo(1 / 0.03, 6)
  })

  it('ignores a single huge gap at a scene cut, which a mean would not', () => {
    const gaps = [0.04, 0.04, 0.04, 0.04, 5]
    expect(medianFps(gaps, 30)).toBeCloseTo(25, 6)
    const meanFps = gaps.length / gaps.reduce((a, b) => a + b, 0)
    expect(meanFps).toBeLessThan(1) // what the mean would have produced
  })

  it('does not depend on the order gaps arrived in', () => {
    expect(medianFps([5, 0.04, 0.04, 0.04, 0.04], 30)).toBeCloseTo(25, 6)
  })

  it('falls back when the median gap is not positive', () => {
    expect(medianFps([0, 0, 0], 60)).toBe(60)
  })
})
