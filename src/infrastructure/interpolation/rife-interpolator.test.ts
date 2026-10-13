// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { RIFE_MAX_RENDER_PIXELS, clampRenderSize } from './rife-interpolator'

describe('clampRenderSize', () => {
  it('leaves sources at or below the cap untouched', () => {
    expect(clampRenderSize(1920, 1080)).toEqual({ width: 1920, height: 1080 })
    expect(clampRenderSize(1280, 720)).toEqual({ width: 1280, height: 720 })
    expect(clampRenderSize(640, 360)).toEqual({ width: 640, height: 360 })
  })

  it('downscales oversized sources under the cap', () => {
    const { width, height } = clampRenderSize(3840, 2160)
    expect(width * height).toBeLessThanOrEqual(RIFE_MAX_RENDER_PIXELS)
    expect(width).toBeGreaterThan(1600)
  })

  it('preserves aspect ratio when downscaling', () => {
    const source = 3840 / 2160
    const { width, height } = clampRenderSize(3840, 2160)
    expect(width / height).toBeCloseTo(source, 2)
  })

  it('preserves aspect ratio for non-16:9 sources', () => {
    const { width, height } = clampRenderSize(4000, 3000) // 4:3, 12M px
    expect(width / height).toBeCloseTo(4 / 3, 2)
    expect(width * height).toBeLessThanOrEqual(RIFE_MAX_RENDER_PIXELS)
  })

  it('forces even dimensions so encoders accept the frames', () => {
    // 1919x1079 is under the cap but odd on both axes.
    expect(clampRenderSize(1919, 1079)).toEqual({ width: 1918, height: 1078 })
    const { width, height } = clampRenderSize(3841, 2161)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
  })

  it('never collapses a tiny source below one macroblock pair', () => {
    expect(clampRenderSize(1, 1)).toEqual({ width: 2, height: 2 })
  })

  it('honours an explicit lower cap', () => {
    const { width, height } = clampRenderSize(1920, 1080, 1280 * 704)
    expect(width * height).toBeLessThanOrEqual(1280 * 704)
    expect(width / height).toBeCloseTo(16 / 9, 2)
  })

  it('rejects a degenerate source size', () => {
    expect(() => clampRenderSize(0, 100)).toThrow(/invalid source size/)
    expect(() => clampRenderSize(100, Number.NaN)).toThrow(/invalid source size/)
  })
})
