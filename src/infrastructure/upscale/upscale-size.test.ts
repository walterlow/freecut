// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  canUpscale,
  UPSCALE_MAX_OUTPUT_DIMENSION,
  UPSCALE_MAX_OUTPUT_PIXELS,
  upscaledSize,
} from './upscale-size'

describe('upscaledSize', () => {
  it('doubles both dimensions', () => {
    expect(upscaledSize(1280, 720)).toEqual({ width: 2560, height: 1440 })
  })

  it('produces even dimensions even from an odd source', () => {
    const { width, height } = upscaledSize(1919, 1079)
    expect(width % 2).toBe(0)
    expect(height % 2).toBe(0)
  })

  it.each([
    [0, 100],
    [100, 0],
    [-2, 100],
    [1.5, 100],
  ])('rejects an invalid source size %ix%i', (w, h) => {
    expect(() => upscaledSize(w, h)).toThrow(/invalid source size/)
  })
})

describe('canUpscale', () => {
  it('accepts 1080p, whose output lands exactly on the pixel budget', () => {
    expect(upscaledSize(1920, 1080).width * upscaledSize(1920, 1080).height).toBe(
      UPSCALE_MAX_OUTPUT_PIXELS,
    )
    expect(canUpscale(1920, 1080)).toBe(true)
  })

  it('rejects a source one pixel wider than 1080p', () => {
    expect(canUpscale(1921, 1080)).toBe(false)
  })

  it('rejects 4K, whose 7680x4320 output no encoder will take', () => {
    expect(canUpscale(3840, 2160)).toBe(false)
  })

  it('accepts an output landing exactly on the per-dimension ceiling', () => {
    expect(upscaledSize(UPSCALE_MAX_OUTPUT_DIMENSION / 2, 100).width).toBe(
      UPSCALE_MAX_OUTPUT_DIMENSION,
    )
    expect(canUpscale(UPSCALE_MAX_OUTPUT_DIMENSION / 2, 100)).toBe(true)
  })

  it('rejects an output one pixel past the per-dimension ceiling', () => {
    expect(canUpscale(UPSCALE_MAX_OUTPUT_DIMENSION / 2 + 1, 100)).toBe(false)
  })

  it('rejects on the pixel budget even when both dimensions fit', () => {
    // 4000x2200: both under 4096, but 8.8M pixels is past the 3840x2160 budget.
    expect(canUpscale(2000, 1100)).toBe(false)
    expect(upscaledSize(2000, 1100).width).toBeLessThan(UPSCALE_MAX_OUTPUT_DIMENSION)
    expect(upscaledSize(2000, 1100).height).toBeLessThan(UPSCALE_MAX_OUTPUT_DIMENSION)
  })

  it.each([
    [0, 100],
    [100, 0],
    [-1, -1],
    [1.5, 100],
  ])('reports false rather than throwing for invalid size %ix%i', (w, h) => {
    expect(canUpscale(w, h)).toBe(false)
  })
})
