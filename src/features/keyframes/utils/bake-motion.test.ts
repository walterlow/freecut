import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import type { AudioPulseModulation } from '@/types/effects'
import type { MotionModifier } from '@/types/motion'
import { applyMotionModifiers } from './motion-modifier-eval'
import { bakeMotionModifiersToKeyframes, bakeAudioPulseToKeyframes } from './bake-motion'

const baseTransform: ResolvedTransform = {
  x: 100,
  y: 200,
  width: 400,
  height: 300,
  anchorX: 200,
  anchorY: 150,
  rotation: 0,
  opacity: 0.9,
  cornerRadius: 0,
}

function modifier(overrides: Partial<MotionModifier> = {}): MotionModifier {
  return {
    id: 'm1',
    type: 'float-drift',
    enabled: true,
    amplitude: 1,
    frequency: 0.625,
    phaseFrames: 0,
    seed: 1,
    ...overrides,
  }
}

describe('bake motion modifiers to keyframes', () => {
  it('emits keyframes only for the properties the modifiers drive', () => {
    const { properties } = bakeMotionModifiersToKeyframes({
      baseTransform,
      keyframes: undefined,
      modifiers: [modifier({ type: 'float-drift' })],
      durationInFrames: 120,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })

    expect(new Set(properties)).toEqual(new Set(['x', 'y', 'rotation']))
  })

  it('baked keyframe values match the evaluated modifier at the sampled frame', () => {
    const modifiers = [modifier({ type: 'float-drift' })]
    const { keyframes } = bakeMotionModifiersToKeyframes({
      baseTransform,
      keyframes: undefined,
      modifiers,
      durationInFrames: 120,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })

    // Pick a baked x keyframe at a non-zero frame and verify it equals the
    // resolver output — baking reproduces the procedural motion exactly.
    const sample = keyframes.find((kf) => kf.property === 'x' && kf.frame > 0)
    expect(sample).toBeDefined()
    const expected = applyMotionModifiers(baseTransform, modifiers, {
      frame: sample!.frame,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })
    expect(sample!.value).toBeCloseTo(expected.x, 6)
  })

  it('always samples the final frame and stays bounded for slow oscillators', () => {
    const { keyframes } = bakeMotionModifiersToKeyframes({
      baseTransform,
      keyframes: undefined,
      modifiers: [modifier({ type: 'float-drift', frequency: 0.625 })],
      durationInFrames: 121,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })

    const xFrames = keyframes.filter((kf) => kf.property === 'x').map((kf) => kf.frame)
    expect(xFrames.at(-1)).toBe(120)
    // ~6 samples/cycle over ~2.5 cycles -> far fewer than per-frame (121).
    expect(xFrames.length).toBeLessThan(40)
  })

  it('returns nothing when no modifiers are active', () => {
    const result = bakeMotionModifiersToKeyframes({
      baseTransform,
      keyframes: undefined,
      modifiers: [modifier({ enabled: false })],
      durationInFrames: 120,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })
    expect(result.keyframes).toEqual([])
    expect(result.properties).toEqual([])
  })
})

describe('bake audio pulse to keyframes', () => {
  const modulation: AudioPulseModulation = {
    enabled: true,
    beats: [
      { frame: 20, amplitude: 1 },
      { frame: 70, amplitude: 0.6 },
    ],
    durationFrames: 11,
    strength: 0.085,
    chroma: 0.019,
    glowColorBase: 0x2e6b8c,
  }

  it('writes all four trigger-wave params with control points per beat', () => {
    const baked = bakeAudioPulseToKeyframes({
      effectId: 'effect-1',
      modulation,
      durationInFrames: 120,
    })

    const properties = new Set(baked.map((kf) => kf.property))
    expect(properties).toEqual(
      new Set([
        'effect:gpu-trigger-wave:effect-1:strength',
        'effect:gpu-trigger-wave:effect-1:chroma',
        'effect:gpu-trigger-wave:effect-1:phase',
        'effect:gpu-trigger-wave:effect-1:glowColor',
      ]),
    )
    // Sparse: a handful of control frames, not a per-frame envelope bake.
    const strengthFrames = baked.filter((kf) => kf.property.endsWith(':strength'))
    expect(strengthFrames.length).toBeLessThan(12)
    expect(strengthFrames.some((kf) => kf.value > 0)).toBe(true)
  })

  it('returns nothing for a disabled or beatless modulation', () => {
    expect(
      bakeAudioPulseToKeyframes({
        effectId: 'e',
        modulation: { ...modulation, enabled: false },
        durationInFrames: 120,
      }),
    ).toEqual([])
    expect(
      bakeAudioPulseToKeyframes({
        effectId: 'e',
        modulation: { ...modulation, beats: [] },
        durationInFrames: 120,
      }),
    ).toEqual([])
  })
})
