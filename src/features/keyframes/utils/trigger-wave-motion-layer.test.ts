import { describe, expect, it } from 'vitest'
import {
  createAudioPulseModulation,
  evaluateAudioPulseParams,
  buildTriggerWaveMotionLayerKeyframes,
  createTriggerWaveMotionLayerEffects,
} from './trigger-wave-motion-layer'
import { DEFAULT_MOTION_GENERATOR_SETTINGS } from './motion-generator'

describe('trigger wave motion layer', () => {
  it('creates deterministic trigger wave effects for a baked layer', () => {
    const effects = createTriggerWaveMotionLayerEffects({
      ...DEFAULT_MOTION_GENERATOR_SETTINGS,
      intensityScale: 1.5,
      triggerWaveColor: '#ff3366',
    })

    expect(effects.map((effect) => effect.gpuEffectType)).toEqual([
      'gpu-trigger-wave',
      'gpu-rgb-split',
      'gpu-grain',
    ])
    expect(effects[0]?.params).toMatchObject({
      strength: 0,
      phase: 0,
      speed: 0,
      glowColor: '#ff3366',
    })
    expect(effects[0]?.params.chroma).toBeCloseTo(0.009)
  })

  it('bakes phase, strength, chroma, and glow-color keyframes onto the trigger effect', () => {
    const payloads = buildTriggerWaveMotionLayerKeyframes({
      itemId: 'adjustment-1',
      effectId: 'effect-1',
      durationInFrames: 120,
      fps: 30,
      settings: DEFAULT_MOTION_GENERATOR_SETTINGS,
    })

    expect(payloads.map((payload) => payload.property)).toEqual([
      'effect:gpu-trigger-wave:effect-1:phase',
      'effect:gpu-trigger-wave:effect-1:phase',
      'effect:gpu-trigger-wave:effect-1:strength',
      'effect:gpu-trigger-wave:effect-1:strength',
      'effect:gpu-trigger-wave:effect-1:strength',
      'effect:gpu-trigger-wave:effect-1:chroma',
      'effect:gpu-trigger-wave:effect-1:chroma',
      'effect:gpu-trigger-wave:effect-1:chroma',
      'effect:gpu-trigger-wave:effect-1:glowColor',
      'effect:gpu-trigger-wave:effect-1:glowColor',
      'effect:gpu-trigger-wave:effect-1:glowColor',
    ])
    expect(payloads[1]).toMatchObject({ frame: 36, value: 1 })
    expect(payloads[3]?.value).toBeCloseTo(0.07)
    expect(payloads.find((payload) => payload.property.endsWith(':glowColor'))?.value).toBe(
      0x2e6b8c,
    )
  })

  it('scales wave duration and intensity', () => {
    const payloads = buildTriggerWaveMotionLayerKeyframes({
      itemId: 'adjustment-1',
      effectId: 'effect-1',
      durationInFrames: 120,
      fps: 30,
      settings: {
        ...DEFAULT_MOTION_GENERATOR_SETTINGS,
        durationScale: 2,
        intensityScale: 0.5,
      },
    })

    expect(payloads[1]).toMatchObject({ frame: 72, value: 1 })
    expect(payloads[3]?.value).toBeCloseTo(0.035)
  })

  it('builds a sparse audio-pulse modulation instead of baking keyframes', () => {
    const modulation = createAudioPulseModulation({
      beats: [
        { frame: 20, amplitude: 1 },
        { frame: 70, amplitude: 0.8 },
      ],
      durationInFrames: 120,
      fps: 30,
      settings: DEFAULT_MOTION_GENERATOR_SETTINGS,
    })

    // Two beats -> two records, not ~18 keyframes.
    expect(modulation.beats.map((beat) => beat.frame)).toEqual([20, 70])
    expect(modulation.enabled).toBe(true)
    expect(modulation.strength).toBeCloseTo(0.085)
    expect(modulation.durationFrames).toBeGreaterThan(0)
  })

  it('evaluates a beat envelope: zero between beats, a flash within one', () => {
    const modulation = createAudioPulseModulation({
      beats: [{ frame: 20, amplitude: 1 }],
      durationInFrames: 120,
      fps: 30,
      settings: DEFAULT_MOTION_GENERATOR_SETTINGS,
    })

    // Before the beat: rest values (no flash).
    const before = evaluateAudioPulseParams(modulation, 10)
    expect(before?.strength).toBe(0)
    expect(before?.glowColor).toBe(modulation.glowColorBase)

    // Just past the attack peak (~15% of the window): strength is near its max.
    const peakFrame = 20 + Math.round(modulation.durationFrames * 0.15)
    const atPeak = evaluateAudioPulseParams(modulation, peakFrame)
    expect(atPeak?.strength).toBeGreaterThan(0)
    expect(atPeak?.phase).toBeGreaterThan(0)
    expect(atPeak?.phase).toBeLessThan(1)

    // Well after the window has elapsed: back to rest.
    const after = evaluateAudioPulseParams(modulation, 20 + modulation.durationFrames + 5)
    expect(after?.strength).toBe(0)
  })

  it('returns null when disabled or beatless', () => {
    const modulation = createAudioPulseModulation({
      beats: [{ frame: 5, amplitude: 1 }],
      durationInFrames: 60,
      fps: 30,
      settings: DEFAULT_MOTION_GENERATOR_SETTINGS,
    })
    expect(evaluateAudioPulseParams({ ...modulation, enabled: false }, 5)).toBeNull()
    expect(evaluateAudioPulseParams({ ...modulation, beats: [] }, 5)).toBeNull()
  })
})
