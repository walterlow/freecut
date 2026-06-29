import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import { applyMotionGeneratorSettings } from './motion-generator'
import { MOTION_PRESETS_BY_ID, type MotionPresetBuildContext } from './motion-presets'

const anchor: ResolvedTransform = {
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  anchorX: 200,
  anchorY: 150,
  rotation: 0,
  opacity: 1,
  cornerRadius: 0,
}

function ctx(overrides: Partial<MotionPresetBuildContext> = {}): MotionPresetBuildContext {
  return {
    anchor,
    durationInFrames: 90,
    fps: 30,
    frameWidth: 1920,
    frameHeight: 1080,
    ...overrides,
  }
}

describe('motion generator settings', () => {
  it('scales generated values around the resting transform', () => {
    const preset = MOTION_PRESETS_BY_ID['slide-in-left']
    const payloads = applyMotionGeneratorSettings(
      preset,
      preset.build(ctx()),
      ctx(),
      { durationScale: 1, intensityScale: 0.5, staggerFrames: 0 },
    )

    const xStart = payloads.find((payload) => payload.property === 'x' && payload.frame === 0)
    expect(xStart?.value).toBeGreaterThan(100 - 600)
    expect(xStart?.value).toBeLessThan(100)
  })

  it('retimes entrance motion from the start of the clip', () => {
    const preset = MOTION_PRESETS_BY_ID['fade-in']
    const payloads = applyMotionGeneratorSettings(
      preset,
      preset.build(ctx()),
      ctx(),
      { durationScale: 2, intensityScale: 1, staggerFrames: 0 },
    )

    expect(payloads.at(-1)?.frame).toBe(30)
  })

  it('retimes exit motion toward the end of the clip', () => {
    const preset = MOTION_PRESETS_BY_ID['fade-out']
    const payloads = applyMotionGeneratorSettings(
      preset,
      preset.build(ctx()),
      ctx(),
      { durationScale: 2, intensityScale: 1, staggerFrames: 0 },
    )

    expect(payloads[0]?.frame).toBe(59)
    expect(payloads.at(-1)?.frame).toBe(89)
  })

  it('stagger delays entrances and pulls exits earlier', () => {
    const entrance = MOTION_PRESETS_BY_ID['fade-in']
    const exit = MOTION_PRESETS_BY_ID['fade-out']

    const entrancePayloads = applyMotionGeneratorSettings(
      entrance,
      entrance.build(ctx()),
      ctx(),
      { durationScale: 1, intensityScale: 1, staggerFrames: 3 },
      2,
    )
    const exitPayloads = applyMotionGeneratorSettings(
      exit,
      exit.build(ctx()),
      ctx(),
      { durationScale: 1, intensityScale: 1, staggerFrames: 3 },
      2,
    )

    expect(entrancePayloads[0]?.frame).toBe(6)
    expect(exitPayloads.at(-1)?.frame).toBe(83)
  })
})
