import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import type { MotionModifier } from '@/types/motion'
import { DEFAULT_MOTION_GENERATOR_SETTINGS } from './motion-generator'
import {
  applyMotionModifiers,
  createMotionModifier,
  evaluateMotionModifiers,
  getMotionModifierSettings,
  updateMotionModifierSettings,
  type MotionModifierEvalContext,
} from './motion-modifier-eval'

const resting: ResolvedTransform = {
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

function ctx(overrides: Partial<MotionModifierEvalContext> = {}): MotionModifierEvalContext {
  return { frame: 15, fps: 30, frameWidth: 1920, frameHeight: 1080, ...overrides }
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

describe('motion modifier evaluation', () => {
  it('is frame-rate independent at equal wall-clock time', () => {
    // 0.5s in: frame 15 @30fps vs frame 30 @60fps must produce the same offset.
    const at30 = evaluateMotionModifiers([modifier()], ctx({ frame: 15, fps: 30 }))
    const at60 = evaluateMotionModifiers([modifier()], ctx({ frame: 30, fps: 60 }))

    expect(at60.dx).toBeCloseTo(at30.dx, 6)
    expect(at60.dy).toBeCloseTo(at30.dy, 6)
    expect(at60.dRotation).toBeCloseTo(at30.dRotation, 6)
  })

  it('scales position offset linearly with amplitude', () => {
    const weak = evaluateMotionModifiers([modifier({ amplitude: 0.5 })], ctx())
    const strong = evaluateMotionModifiers([modifier({ amplitude: 1 })], ctx())

    // Same phase, double amplitude -> double offset.
    expect(strong.dx).toBeCloseTo(weak.dx * 2, 6)
    expect(strong.dy).toBeCloseTo(weak.dy * 2, 6)
  })

  it('sums contributions from multiple modifiers additively', () => {
    const a = modifier({ id: 'a', type: 'float-drift' })
    const b = modifier({ id: 'b', type: 'micro-shake', frequency: 8, seed: 3 })

    const combined = evaluateMotionModifiers([a, b], ctx())
    const onlyA = evaluateMotionModifiers([a], ctx())
    const onlyB = evaluateMotionModifiers([b], ctx())

    expect(combined.dx).toBeCloseTo(onlyA.dx + onlyB.dx, 6)
    expect(combined.dy).toBeCloseTo(onlyA.dy + onlyB.dy, 6)
  })

  it('ignores disabled and zero-amplitude modifiers', () => {
    const disabled = evaluateMotionModifiers([modifier({ enabled: false })], ctx())
    const muted = evaluateMotionModifiers([modifier({ amplitude: 0 })], ctx())

    for (const c of [disabled, muted]) {
      expect(c.dx).toBe(0)
      expect(c.dy).toBe(0)
      expect(c.dRotation).toBe(0)
      expect(c.scaleWidth).toBe(1)
      expect(c.scaleHeight).toBe(1)
    }
  })

  it('returns the same transform reference when nothing applies (fast path)', () => {
    expect(applyMotionModifiers(resting, undefined, ctx())).toBe(resting)
    expect(applyMotionModifiers(resting, [], ctx())).toBe(resting)
    expect(applyMotionModifiers(resting, [modifier({ enabled: false })], ctx())).toBe(resting)
  })

  it('layers drift as additive position/rotation deltas around rest', () => {
    const result = applyMotionModifiers(resting, [modifier()], ctx())

    // Offsets are bounded by the derived amplitudes; box/opacity untouched by drift.
    expect(Math.abs(result.x - resting.x)).toBeGreaterThan(0)
    expect(Math.abs(result.x - resting.x)).toBeLessThanOrEqual(18)
    expect(result.width).toBe(resting.width)
    expect(result.opacity).toBe(resting.opacity)
  })

  it('breath-pulse rescales the box and nudges opacity, clamped to [0,1]', () => {
    const breath = modifier({ type: 'breath-pulse', frequency: 0.55 })
    // Pick a frame near the wave peak so the scale clearly deviates from 1.
    const result = applyMotionModifiers({ ...resting, opacity: 1 }, [breath], ctx({ frame: 13 }))

    expect(result.width).not.toBe(resting.width)
    expect(result.opacity).toBeLessThanOrEqual(1)
    expect(result.opacity).toBeGreaterThanOrEqual(0)
  })

  it('micro-shake is deterministic for a given seed and frame', () => {
    const shake = modifier({ type: 'micro-shake', frequency: 8, seed: 5 })
    const first = evaluateMotionModifiers([shake], ctx({ frame: 9 }))
    const second = evaluateMotionModifiers([shake], ctx({ frame: 9 }))

    expect(first).toEqual(second)
  })

  it('createMotionModifier staggers phase and varies seed by item index', () => {
    const settings = { ...DEFAULT_MOTION_GENERATOR_SETTINGS, staggerFrames: 4 }
    const first = createMotionModifier('float-drift', settings, 0)
    const second = createMotionModifier('float-drift', settings, 2)

    expect(first.phaseFrames).toBe(0)
    expect(second.phaseFrames).toBe(8)
    expect(second.seed).not.toBe(first.seed)
    expect(first.amplitude).toBe(settings.intensityScale)
  })

  it('round-trips generator settings through create/get (frequency is duration inverse)', () => {
    const settings = { ...DEFAULT_MOTION_GENERATOR_SETTINGS, intensityScale: 1.4, durationScale: 2 }
    const mod = createMotionModifier('float-drift', settings)
    const recovered = getMotionModifierSettings(mod)
    expect(recovered.intensityScale).toBeCloseTo(1.4, 6)
    expect(recovered.durationScale).toBeCloseTo(2, 6)
  })

  it('updateMotionModifierSettings tunes amplitude/frequency but keeps identity', () => {
    const mod = createMotionModifier('breath-pulse', DEFAULT_MOTION_GENERATOR_SETTINGS, 3)
    const next = updateMotionModifierSettings(mod, { intensityScale: 0.5, durationScale: 0.5 })

    expect(next.id).toBe(mod.id) // same instance — editing, not replacing
    expect(next.seed).toBe(mod.seed)
    expect(next.amplitude).toBeCloseTo(0.5, 6)
    // durationScale 0.5 → twice as fast as the 1.0 baseline.
    const baseline = createMotionModifier('breath-pulse', DEFAULT_MOTION_GENERATOR_SETTINGS)
    expect(next.frequency).toBeCloseTo(baseline.frequency * 2, 6)
    // A partial edit leaves the untouched field alone.
    const intensityOnly = updateMotionModifierSettings(mod, { intensityScale: 1 })
    expect(intensityOnly.frequency).toBe(mod.frequency)
  })

  it('sway oscillates rotation only, peaking near a quarter period', () => {
    const sway = createMotionModifier('sway', DEFAULT_MOTION_GENERATOR_SETTINGS)
    // freq 0.5Hz -> 2s period -> quarter at 0.5s = frame 15 @30fps, sin=1.
    const peak = evaluateMotionModifiers([sway], ctx({ frame: 15 }))
    const start = evaluateMotionModifiers([sway], ctx({ frame: 0 }))
    expect(peak.dRotation).toBeCloseTo(4, 3) // ±4° at full intensity
    expect(start.dRotation).toBeCloseTo(0, 6)
    expect(peak.dx).toBe(0) // rotation only
    expect(peak.scaleWidth).toBe(1)
  })

  it('spin accumulates rotation continuously (not an oscillation)', () => {
    const spin = createMotionModifier('spin', DEFAULT_MOTION_GENERATOR_SETTINGS)
    const r0 = evaluateMotionModifiers([spin], ctx({ frame: 0 })).dRotation
    const r1 = evaluateMotionModifiers([spin], ctx({ frame: 30 })).dRotation
    const r2 = evaluateMotionModifiers([spin], ctx({ frame: 60 })).dRotation
    expect(r0).toBe(0)
    expect(r1).toBeGreaterThan(0)
    expect(r2).toBeGreaterThan(r1) // keeps growing, doesn't return
    // freq 0.3 rev/s -> 108°/s; at 1s ≈ 108°.
    expect(r1).toBeCloseTo(108, 3)
  })

  it('createMotionModifier slows oscillation as duration scale grows', () => {
    const fast = createMotionModifier('float-drift', {
      ...DEFAULT_MOTION_GENERATOR_SETTINGS,
      durationScale: 1,
    })
    const slow = createMotionModifier('float-drift', {
      ...DEFAULT_MOTION_GENERATOR_SETTINGS,
      durationScale: 2,
    })

    expect(slow.frequency).toBeCloseTo(fast.frequency / 2, 6)
  })
})
