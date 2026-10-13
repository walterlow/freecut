// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { concatPlanarPair, framesDiffer } from './frame-tensor'

describe('concatPlanarPair', () => {
  it('stacks left into channels 0-2 and right into 3-5', () => {
    const width = 2
    const height = 2
    const planeCount = 3 * width * height
    const left = new Float32Array(planeCount).fill(0.25)
    const right = new Float32Array(planeCount).fill(0.75)

    const packed = concatPlanarPair(left, right, width, height)

    expect(packed).toHaveLength(planeCount * 2)
    expect(packed.slice(0, planeCount).every((v) => v === 0.25)).toBe(true)
    expect(packed.slice(planeCount).every((v) => v === 0.75)).toBe(true)
  })

  it('does not alias its operands', () => {
    const left = new Float32Array(3).fill(1)
    const right = new Float32Array(3).fill(0)
    const packed = concatPlanarPair(left, right, 1, 1)
    packed[0] = 0.5
    expect(left[0]).toBe(1)
  })

  it('rejects operands shorter than one planar frame', () => {
    expect(() => concatPlanarPair(new Float32Array(3), new Float32Array(12), 2, 2)).toThrow(
      /shorter than one planar RGB frame/,
    )
  })
})
describe('framesDiffer', () => {
  it('reports no difference for identical frames', () => {
    const a = new Float32Array([0.1, 0.2, 0.3])
    expect(framesDiffer(a, Float32Array.from(a), 0)).toBe(false)
  })

  it('excludes the threshold itself, so a change of exactly the threshold is noise', () => {
    const a = new Float32Array([0.5])
    const b = new Float32Array([0.5 + 3 / 255])
    expect(framesDiffer(a, b, 3 / 255)).toBe(false)
  })

  it('reports a difference just past the threshold', () => {
    const a = new Float32Array([0.5])
    const b = new Float32Array([0.5 + 3.001 / 255])
    expect(framesDiffer(a, b, 3 / 255)).toBe(true)
  })

  it('detects a change in any channel, including the last', () => {
    const a = new Float32Array([0, 0, 0, 0])
    for (let i = 0; i < a.length; i++) {
      const b = Float32Array.from(a)
      b[i] = 1
      expect(framesDiffer(a, b, 0.01)).toBe(true)
    }
  })

  it('detects a decrease as well as an increase', () => {
    expect(framesDiffer(new Float32Array([0.5]), new Float32Array([0.1]), 0.01)).toBe(true)
  })

  it('reports a difference unconditionally for a negative threshold', () => {
    const a = new Float32Array([0.25])
    expect(framesDiffer(a, Float32Array.from(a), -1)).toBe(true)
  })

  it('rejects frames of different lengths', () => {
    expect(() => framesDiffer(new Float32Array(3), new Float32Array(4), 0)).toThrow(
      /length mismatch, 3 vs 4/,
    )
  })
})
