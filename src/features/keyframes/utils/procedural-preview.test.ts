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

  it('tags micro-shake as a noise band', () => {
    const shake = drift({ id: 's1', type: 'micro-shake' })
    const bands = getProceduralBands([shake], 90)
    expect(bands.get('x')?.kind).toBe('noise')
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
