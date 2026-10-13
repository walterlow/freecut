// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { planarRgbToRgba, rgbaToPlanarRgb } from './planar-rgb'

function makeRgba(width: number, height: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = (i * 7) % 256
    rgba[i * 4 + 1] = (i * 13) % 256
    rgba[i * 4 + 2] = (i * 29) % 256
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

describe('rgbaToPlanarRgb', () => {
  it('deinterleaves into contiguous R, G and B planes', () => {
    const width = 3
    const height = 2
    // pixel 0 = (10, 20, 30), pixel 5 = (60, 70, 80); rest zero.
    const rgba = new Uint8ClampedArray(width * height * 4)
    rgba.set([10, 20, 30, 255], 0)
    rgba.set([60, 70, 80, 255], 5 * 4)

    const planar = rgbaToPlanarRgb(rgba, width, height)
    const pixels = width * height

    expect(planar[0]).toBeCloseTo(10 / 255, 6)
    expect(planar[pixels + 0]).toBeCloseTo(20 / 255, 6)
    expect(planar[pixels * 2 + 0]).toBeCloseTo(30 / 255, 6)

    expect(planar[5]).toBeCloseTo(60 / 255, 6)
    expect(planar[pixels + 5]).toBeCloseTo(70 / 255, 6)
    expect(planar[pixels * 2 + 5]).toBeCloseTo(80 / 255, 6)
  })

  it('drops alpha rather than folding it into the colour planes', () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 0])
    const planar = rgbaToPlanarRgb(rgba, 1, 1)
    expect(planar).toHaveLength(3)
    expect(planar[0]).toBeCloseTo(200 / 255, 6)
  })

  it('rejects a buffer too small for the stated dimensions', () => {
    expect(() => rgbaToPlanarRgb(new Uint8ClampedArray(4), 2, 2)).toThrow(/expected 16 bytes/)
  })
})
describe('planarRgbToRgba', () => {
  it('round-trips 8-bit values exactly', () => {
    const width = 8
    const height = 4
    const rgba = makeRgba(width, height)
    const restored = planarRgbToRgba(rgbaToPlanarRgb(rgba, width, height), width, height)
    expect(Array.from(restored)).toEqual(Array.from(rgba))
  })

  it('saturates values outside [0,1] instead of wrapping', () => {
    // RIFE's final layer is unbounded and routinely overshoots by a fraction of a step.
    const planar = new Float32Array([-0.4, 1.6, 0.5])
    const rgba = planarRgbToRgba(planar, 1, 1)
    expect(rgba[0]).toBe(0)
    expect(rgba[1]).toBe(255)
    expect(rgba[2]).toBe(128)
  })

  it('writes an opaque alpha channel', () => {
    const rgba = planarRgbToRgba(new Float32Array([0, 0, 0]), 1, 1)
    expect(rgba[3]).toBe(255)
  })

  it('rejects a tensor too small for the stated dimensions', () => {
    expect(() => planarRgbToRgba(new Float32Array(3), 2, 2)).toThrow(/expected 12 floats/)
  })
})
