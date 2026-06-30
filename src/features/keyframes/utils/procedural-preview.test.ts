import { describe, expect, it } from 'vitest'
import type { ResolvedTransform } from '@/types/transform'
import type { MotionModifier } from '@/types/motion'
import { getProceduralBands, sampleProceduralCurve } from './procedural-preview'

const base: ResolvedTransform = {
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

function drift(overrides: Partial<MotionModifier> = {}): MotionModifier {
  return {
    id: 'd1',
    type: 'float-drift',
    enabled: true,
    amplitude: 1,
    frequency: 0.625,
    phaseFrames: 0,
    seed: 1,
    ...overrides,
  }
}

describe('getProceduralBands', () => {
  it('spans the full clip for continuous modifiers and tags the kind', () => {
    const bands = getProceduralBands([drift()], 90)
    // float-drift drives x, y, rotation
    expect([...bands.keys()].sort()).toEqual(['rotation', 'x', 'y'])
    const xBand = bands.get('x')!
    expect(xBand.kind).toBe('wave')
    expect(xBand.fromFrame).toBe(0)
    expect(xBand.toFrame).toBe(89)
  })

  it('uses a beats band scoped to the beat span for audio-reactive', () => {
    const ar: MotionModifier = {
      id: 'a1',
      type: 'audio-reactive',
      enabled: true,
      amplitude: 1,
      frequency: 0,
      phaseFrames: 0,
      seed: 1,
      target: 'scale',
      pulseFrames: 6,
      beats: [
        { frame: 10, amplitude: 1 },
        { frame: 40, amplitude: 0.8 },
      ],
    }
    const bands = getProceduralBands([ar], 90)
    // scale target → width + height
    expect([...bands.keys()].sort()).toEqual(['height', 'width'])
    const band = bands.get('width')!
    expect(band.kind).toBe('beats')
    expect(band.beats).toEqual([10, 40])
    expect(band.fromFrame).toBe(10)
    expect(band.toFrame).toBe(46) // last beat (40) + pulseFrames (6)
  })

  it('ignores disabled / zero-amplitude modifiers', () => {
    expect(getProceduralBands([drift({ enabled: false })], 90).size).toBe(0)
    expect(getProceduralBands([drift({ amplitude: 0 })], 90).size).toBe(0)
  })
})

describe('sampleProceduralCurve', () => {
  it('samples a varying curve for a driven property', () => {
    const points = sampleProceduralCurve({
      property: 'x',
      base,
      keyframes: undefined,
      modifiers: [drift()],
      fromFrame: 0,
      toFrame: 60,
      step: 5,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })
    expect(points.length).toBeGreaterThan(2)
    // The drift modulates x away from its resting value at some samples.
    const values = points.map((p) => p.value)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0)
  })

  it('returns nothing for a property no modifier drives', () => {
    const points = sampleProceduralCurve({
      property: 'opacity', // float-drift drives x/y/rotation, not opacity
      base,
      keyframes: undefined,
      modifiers: [drift()],
      fromFrame: 0,
      toFrame: 60,
      step: 5,
      fps: 30,
      frameWidth: 1920,
      frameHeight: 1080,
    })
    expect(points).toEqual([])
  })
})
