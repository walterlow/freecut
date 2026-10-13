// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { interpolateGap } from './interpolate-gap'
import { SUPPORTED_INTERPOLATION_FACTORS } from './interpolation-factor'

/**
 * A real phase interpolator: the exact linear blend at `t`. A correct schedule over a linear
 * ramp reproduces the ramp, so every synthesized position is analytically known — this checks
 * the schedule, not a mock.
 */
const lerp = async (left: Float32Array, right: Float32Array, t: number): Promise<Float32Array> =>
  left.map((value, i) => value + (right[i]! - value) * t)

const ramp = (from: number, to: number): [Float32Array, Float32Array] => [
  new Float32Array([from]),
  new Float32Array([to]),
]

describe('interpolateGap', () => {
  it('returns factor-1 frames for every supported factor', async () => {
    const [a, b] = ramp(0, 1)
    for (const factor of SUPPORTED_INTERPOLATION_FACTORS) {
      expect(await interpolateGap(a, b, factor, lerp)).toHaveLength(factor - 1)
    }
  })

  it('places each frame at its nominal fraction of the gap', async () => {
    const [a, b] = ramp(0, 1)
    for (const factor of SUPPORTED_INTERPOLATION_FACTORS) {
      const positions = (await interpolateGap(a, b, factor, lerp)).map((f) => f[0]!)
      positions.forEach((value, i) => expect(value).toBeCloseTo((i + 1) / factor, 6))
    }
  })

  it('handles factors that are not powers of two', async () => {
    const positions = (await interpolateGap(...ramp(0, 3), 3, lerp)).map((f) => f[0]!)
    expect(positions[0]).toBeCloseTo(1, 6)
    expect(positions[1]).toBeCloseTo(2, 6)
  })

  it('returns frames in ascending time order, closest-to-left first', async () => {
    const values = (await interpolateGap(...ramp(0, 8), 8, lerp)).map((f) => f[0]!)
    expect(values).toEqual([...values].sort((x, y) => x - y))
  })

  it('synthesizes every frame from the two source frames, never from an intermediate', async () => {
    const seen: Array<[number, number, number]> = []
    const spy = async (l: Float32Array, r: Float32Array, t: number): Promise<Float32Array> => {
      seen.push([l[0]!, r[0]!, t])
      return lerp(l, r, t)
    }
    await interpolateGap(...ramp(0, 4), 4, spy)

    expect(seen.map(([l, r]) => [l, r])).toEqual([
      [0, 4],
      [0, 4],
      [0, 4],
    ])
    expect(seen.map(([, , t]) => t)).toEqual([0.25, 0.5, 0.75])
  })

  it('runs exactly factor-1 inferences', async () => {
    let calls = 0
    const counted = async (l: Float32Array, r: Float32Array, t: number): Promise<Float32Array> => {
      calls++
      return lerp(l, r, t)
    }
    await interpolateGap(...ramp(0, 1), 8, counted)
    expect(calls).toBe(7)
  })

  it('does not mutate its source frames', async () => {
    const a = new Float32Array([0.25, 0.5])
    const b = new Float32Array([0.75, 1])
    await interpolateGap(a, b, 4, lerp)
    expect(Array.from(a)).toEqual([0.25, 0.5])
    expect(Array.from(b)).toEqual([0.75, 1])
  })

  it('rejects an unsupported factor before doing any work', async () => {
    let calls = 0
    const counted = async (): Promise<Float32Array> => {
      calls++
      return new Float32Array([0])
    }
    await expect(interpolateGap(...ramp(0, 1), 16 as never, counted)).rejects.toThrow(
      'Unsupported interpolation factor: 16',
    )
    expect(calls).toBe(0)
  })

  it('propagates interpolator failures', async () => {
    const failing = async (): Promise<Float32Array> => {
      throw new Error('inference exploded')
    }
    await expect(interpolateGap(...ramp(0, 1), 4, failing)).rejects.toThrow('inference exploded')
  })

  describe('static gap', () => {
    const never = async (): Promise<Float32Array> => {
      throw new Error('interpolator must not run on a static gap')
    }

    it('skips inference entirely when the frames are identical', async () => {
      const a = new Float32Array([0.2, 0.4, 0.6])
      const frames = await interpolateGap(a, Float32Array.from(a), 8, never)
      expect(frames).toHaveLength(7)
      for (const frame of frames) expect(Array.from(frame)).toEqual(Array.from(a))
    })

    it('tolerates sub-threshold codec noise', async () => {
      const a = new Float32Array([0.5, 0.5])
      const b = new Float32Array([0.5 + 2 / 255, 0.5 - 2 / 255])
      expect(await interpolateGap(a, b, 2, never)).toHaveLength(1)
    })

    it('runs the interpolator once any channel moves past the threshold', async () => {
      const a = new Float32Array([0.5, 0.5])
      const b = new Float32Array([0.5, 0.5 + 4 / 255])
      let calls = 0
      await interpolateGap(a, b, 2, async (l, r, t) => {
        calls++
        return lerp(l, r, t)
      })
      expect(calls).toBe(1)
    })

    it('aliases the left frame rather than copying it', async () => {
      const a = new Float32Array([0.1])
      const frames = await interpolateGap(a, Float32Array.from(a), 4, never)
      for (const frame of frames) expect(frame).toBe(a)
    })

    it('forces inference when the threshold is negative, even on identical frames', async () => {
      const a = new Float32Array([0.3])
      let calls = 0
      await interpolateGap(
        a,
        Float32Array.from(a),
        4,
        async (l, r, t) => {
          calls++
          return lerp(l, r, t)
        },
        -1,
      )
      expect(calls).toBe(3)
    })
  })
})
