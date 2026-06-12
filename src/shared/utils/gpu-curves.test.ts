import { describe, expect, it } from 'vite-plus/test'
import {
  evaluateGpuCurvesEffectChannel,
  getGpuCurvesDefaultParams,
  getGpuCurvesDraftParams,
  readGpuCurvesChannelControl,
  toGpuCurvesChannelParamUpdates,
} from './gpu-curves'

describe('gpu-curves', () => {
  it('defaults to an identity curve for every channel', () => {
    const params = getGpuCurvesDefaultParams()

    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.2)).toBeCloseTo(0.2, 4)
    expect(evaluateGpuCurvesEffectChannel(params, 'red', 0.8)).toBeCloseTo(0.8, 4)
    expect(evaluateGpuCurvesEffectChannel(params, 'green', 0.45)).toBeCloseTo(0.45, 4)
    expect(evaluateGpuCurvesEffectChannel(params, 'blue', 0.05)).toBeCloseTo(0.05, 4)
  })

  it('supports a classic S-curve on the master channel', () => {
    const params = {
      ...getGpuCurvesDefaultParams(),
      ...toGpuCurvesChannelParamUpdates('master', {
        shadow: { x: 0.25, y: 0.16 },
        highlight: { x: 0.75, y: 0.87 },
      }),
    }

    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.25)).toBeCloseTo(0.16, 4)
    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.75)).toBeCloseTo(0.87, 4)
    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.25)).toBeLessThan(0.25)
    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.75)).toBeGreaterThan(0.75)
  })

  it('converts legacy master params into explicit control points', () => {
    const legacyParams = {
      shadows: 24,
      midtones: -18,
      highlights: 36,
      contrast: 12,
    }

    const control = readGpuCurvesChannelControl(legacyParams, 'master')
    const draft = getGpuCurvesDraftParams(legacyParams)

    expect(control.shadow.y).not.toBeCloseTo(0.25, 3)
    expect(control.highlight.y).not.toBeCloseTo(0.75, 3)
    expect(draft.masterShadowY).toBeCloseTo(control.shadow.y, 4)
    expect(draft.masterHighlightY).toBeCloseTo(control.highlight.y, 4)
    expect(evaluateGpuCurvesEffectChannel(legacyParams, 'master', 0.25)).toBeCloseTo(
      control.shadow.y,
      4,
    )
    expect(evaluateGpuCurvesEffectChannel(legacyParams, 'master', 0.75)).toBeCloseTo(
      control.highlight.y,
      4,
    )
  })

  it('converts legacy RGB offsets into channel-specific curves after master mapping', () => {
    const legacyParams = {
      red: 40,
    }

    expect(evaluateGpuCurvesEffectChannel(legacyParams, 'red', 0.25)).toBeCloseTo(0.45, 2)
    expect(evaluateGpuCurvesEffectChannel(legacyParams, 'red', 0.75)).toBeCloseTo(0.95, 2)
    expect(evaluateGpuCurvesEffectChannel(legacyParams, 'red', 0.5)).toBeGreaterThan(
      evaluateGpuCurvesEffectChannel(legacyParams, 'master', 0.5),
    )
  })
})

describe('gpu-curves multi-point', () => {
  it('prefers the JSON points param over legacy 2-point controls', async () => {
    const { readGpuCurvesChannelPoints, serializeGpuCurvesChannelPoints } =
      await import('./gpu-curves')
    const points = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.5 },
      { x: 0.6, y: 0.7 },
      { x: 1, y: 1 },
    ]
    const params = {
      ...getGpuCurvesDefaultParams(),
      masterPoints: serializeGpuCurvesChannelPoints(points),
    }

    const read = readGpuCurvesChannelPoints(params, 'master')
    expect(read).toHaveLength(4)
    expect(read[1]).toEqual({ x: 0.3, y: 0.5 })
    expect(evaluateGpuCurvesEffectChannel(params, 'master', 0.3)).toBeCloseTo(0.5, 4)
  })

  it('falls back to legacy points when the JSON param is invalid', async () => {
    const { readGpuCurvesChannelPoints } = await import('./gpu-curves')
    const params = { ...getGpuCurvesDefaultParams(), masterPoints: 'not json' }
    const read = readGpuCurvesChannelPoints(params, 'master')
    expect(read).toHaveLength(4)
    expect(read[0]).toEqual({ x: 0, y: 0 })
  })

  it('sanitizes unsorted and out-of-range points', async () => {
    const { sanitizeGpuCurvesChannelPoints } = await import('./gpu-curves')
    const sanitized = sanitizeGpuCurvesChannelPoints([
      { x: 1.4, y: 2 },
      { x: -0.2, y: -1 },
      { x: 0.5, y: 0.5 },
    ])
    expect(sanitized[0]).toEqual({ x: 0, y: 0 })
    expect(sanitized[sanitized.length - 1]).toEqual({ x: 1, y: 1 })
    expect(sanitized.every((p, i, arr) => i === 0 || p.x >= arr[i - 1]!.x)).toBe(true)
  })

  it('bakes a 256x1 rgba LUT where identity params produce a linear ramp', async () => {
    const { buildGpuCurvesLutData, GPU_CURVES_LUT_WIDTH } = await import('./gpu-curves')
    const data = buildGpuCurvesLutData(getGpuCurvesDefaultParams())
    expect(data).toHaveLength(GPU_CURVES_LUT_WIDTH * 4)
    expect(data[0]).toBe(0)
    expect(data[(GPU_CURVES_LUT_WIDTH - 1) * 4]).toBe(255)
    const mid = Math.floor(GPU_CURVES_LUT_WIDTH / 2)
    expect(
      Math.abs(data[mid * 4]! - Math.round((mid / (GPU_CURVES_LUT_WIDTH - 1)) * 255)),
    ).toBeLessThanOrEqual(1)
    expect(data[3]).toBe(255)
  })

  it('changes the LUT key when any curve param changes', async () => {
    const { getGpuCurvesLutKey, serializeGpuCurvesChannelPoints } = await import('./gpu-curves')
    const base = getGpuCurvesDefaultParams()
    const keyA = getGpuCurvesLutKey(base)
    const keyB = getGpuCurvesLutKey({ ...base, masterShadowY: 0.3 })
    const keyC = getGpuCurvesLutKey({
      ...base,
      redPoints: serializeGpuCurvesChannelPoints([
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ]),
    })
    expect(keyA).not.toBe(keyB)
    expect(keyA).not.toBe(keyC)
    expect(getGpuCurvesLutKey(base)).toBe(keyA)
  })
})
