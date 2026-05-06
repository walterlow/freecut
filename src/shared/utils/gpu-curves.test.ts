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
