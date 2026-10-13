// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { motionBlur } from './blur'

describe('shutter motion blur', () => {
  it('exposes a bounded shutter-quality control surface', () => {
    expect(motionBlur.uniformSize).toBe(32)
    expect(motionBlur.params.shutterAngle).toMatchObject({ default: 180, min: 0, max: 360 })
    expect(motionBlur.params.samples).toMatchObject({ default: 16, min: 4, max: 32 })
    expect(motionBlur.shader).toContain('clamp(params.samples, 4.0, 32.0)')
    expect(motionBlur.shader).toContain('min(max(params.amount, 0.0) * exposure, params.maxRadius)')
  })

  it('preserves legacy blur radius while new effects use a 180 degree shutter', () => {
    const legacy = Array.from(
      motionBlur.packUniforms({ amount: 0.05, angle: 1, samples: 24 }, 1920, 1080)!,
    )
    const shutter = Array.from(
      motionBlur.packUniforms(
        {
          amount: 0.05,
          angle: 1,
          shutterAngle: 180,
          samples: 16,
        },
        1920,
        1080,
      )!,
    )

    expect(legacy.slice(0, 4)).toEqual([expect.closeTo(0.05), 1, 360, 24])
    expect(shutter.slice(0, 4)).toEqual([expect.closeTo(0.05), 1, 180, 16])
    expect(legacy[4]).toBeCloseTo(0.2)
    expect(shutter[4]).toBeCloseTo(0.2)
  })
})
