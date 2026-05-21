import { describe, expect, it } from 'vite-plus/test'
import { TransitionRegistry } from '../registry'
import {
  clamp01,
  crossDissolveT,
  fadeOpacity,
  getNumericProperty,
  registerGpuTransitions,
  seededRandom,
  smoothStep,
} from './gpu'

// GPU transition registrations are stable contract: the IDs are referenced by
// transition data on persisted projects and by the GPU pipeline (TransitionPipeline)
// keyed by gpuTransitionId. Adding or removing one is a schema-affecting change.
const EXPECTED_GPU_TRANSITION_IDS = [
  'dissolve',
  'additiveDissolve',
  'blurDissolve',
  'dipToColorDissolve',
  'nonAdditiveDissolve',
  'smoothCut',
  'sparkles',
  'glitch',
  'pixelate',
  'chromatic',
  'radialBlur',
  'liquidDistort',
  'lensWarpZoom',
  'lightLeakBurn',
  'filmGateSlip',
] as const

describe('clamp01', () => {
  it('passes values inside [0, 1] through', () => {
    expect(clamp01(0)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(1)).toBe(1)
  })

  it('clamps below 0 to 0', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(-Infinity)).toBe(0)
  })

  it('clamps above 1 to 1', () => {
    expect(clamp01(2)).toBe(1)
    expect(clamp01(Infinity)).toBe(1)
  })
})

describe('smoothStep', () => {
  it('returns 0 at or below the lower edge', () => {
    expect(smoothStep(0, 1, 0)).toBe(0)
    expect(smoothStep(0, 1, -5)).toBe(0)
  })

  it('returns 1 at or above the upper edge', () => {
    expect(smoothStep(0, 1, 1)).toBe(1)
    expect(smoothStep(0, 1, 5)).toBe(1)
  })

  it('returns 0.5 at the midpoint of a symmetric interval', () => {
    expect(smoothStep(0, 1, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('produces a smoothed S-curve, not a linear interpolation', () => {
    // smoothStep(0,1,x) = 3x²-2x³ is below the linear line on the lower
    // half and above it on the upper half — that's the defining S-shape
    // and what protects against a "just use linear" rewrite.
    expect(smoothStep(0, 1, 0.25)).toBeLessThan(0.25)
    expect(smoothStep(0, 1, 0.75)).toBeGreaterThan(0.75)

    // Slope at the midpoint is d/dt(3t²-2t³) = 6t(1-t) = 1.5, so the
    // central difference over [0.49, 0.51] is ~0.03 — 1.5× steeper than
    // the linear 0.02. Tight band so a flatter or steeper curve fails.
    const midpointSlope = smoothStep(0, 1, 0.51) - smoothStep(0, 1, 0.49)
    expect(midpointSlope).toBeGreaterThan(0.025)
    expect(midpointSlope).toBeLessThan(0.035)
  })

  it('handles a zero-width interval (edge0 === edge1) without NaN', () => {
    const value = smoothStep(0.5, 0.5, 0.6)
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBe(1)
  })
})

describe('getNumericProperty', () => {
  it('returns the property when it is a finite number', () => {
    expect(getNumericProperty({ radius: 5 }, 'radius', 0)).toBe(5)
    expect(getNumericProperty({ radius: 0 }, 'radius', 99)).toBe(0)
    expect(getNumericProperty({ radius: -3.14 }, 'radius', 0)).toBe(-3.14)
  })

  it('falls back when the property is missing', () => {
    expect(getNumericProperty({}, 'radius', 7)).toBe(7)
    expect(getNumericProperty(undefined, 'radius', 7)).toBe(7)
  })

  it('falls back when the property is not a number', () => {
    expect(getNumericProperty({ radius: '5' }, 'radius', 9)).toBe(9)
    expect(getNumericProperty({ radius: null }, 'radius', 9)).toBe(9)
    expect(getNumericProperty({ radius: true }, 'radius', 9)).toBe(9)
  })

  it('falls back when the property is non-finite (NaN or Infinity)', () => {
    expect(getNumericProperty({ radius: NaN }, 'radius', 1)).toBe(1)
    expect(getNumericProperty({ radius: Infinity }, 'radius', 1)).toBe(1)
    expect(getNumericProperty({ radius: -Infinity }, 'radius', 1)).toBe(1)
  })
})

describe('seededRandom', () => {
  it('is deterministic — same seed gives same value', () => {
    expect(seededRandom(0)).toBe(seededRandom(0))
    expect(seededRandom(1)).toBe(seededRandom(1))
    expect(seededRandom(12345.6789)).toBe(seededRandom(12345.6789))
  })

  it('returns a value in [0, 1)', () => {
    for (const seed of [0, 1, 7, 42, 100, -1, 12345.6789]) {
      const value = seededRandom(seed)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('produces distinct values for nearby seeds', () => {
    // Pseudo-random hash should not collide for adjacent integer seeds.
    expect(seededRandom(0)).not.toBe(seededRandom(1))
    expect(seededRandom(1)).not.toBe(seededRandom(2))
  })
})

describe('fadeOpacity', () => {
  it('outgoing clip is fully visible at progress 0 and fully transparent at progress 1', () => {
    expect(fadeOpacity(0, true)).toBeCloseTo(1, 5)
    expect(fadeOpacity(1, true)).toBeCloseTo(0, 5)
  })

  it('incoming clip is fully transparent at progress 0 and fully visible at progress 1', () => {
    expect(fadeOpacity(0, false)).toBeCloseTo(0, 5)
    expect(fadeOpacity(1, false)).toBeCloseTo(1, 5)
  })

  it('outgoing + incoming sum to a constant-power crossfade (not linear)', () => {
    // cos² + sin² = 1, but the values themselves are cos/sin so at p=0.5
    // each is sqrt(2)/2 ≈ 0.707 and they sum to ~1.414 — confirming the
    // intended constant-power crossfade rather than a 0.5+0.5 linear mix.
    const out = fadeOpacity(0.5, true)
    const inc = fadeOpacity(0.5, false)
    expect(out).toBeCloseTo(Math.SQRT1_2, 5)
    expect(inc).toBeCloseTo(Math.SQRT1_2, 5)
  })
})

describe('crossDissolveT', () => {
  it('returns 0 at progress 0 and 1 at progress 1', () => {
    expect(crossDissolveT(0)).toBeCloseTo(0, 5)
    expect(crossDissolveT(1)).toBeCloseTo(1, 5)
  })

  it('returns 0.5 at progress 0.5 (cosine eased curve crosses midpoint at midpoint)', () => {
    expect(crossDissolveT(0.5)).toBeCloseTo(0.5, 5)
  })

  it('clamps out-of-range progress before easing', () => {
    expect(crossDissolveT(-1)).toBe(crossDissolveT(0))
    expect(crossDissolveT(2)).toBe(crossDissolveT(1))
  })

  it('is monotonically non-decreasing across the range', () => {
    let prev = crossDissolveT(0)
    for (const p of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const value = crossDissolveT(p)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })
})

describe('registerGpuTransitions', () => {
  // Shared across every test in this block — the registry is the unit under
  // test and doesn't mutate, so 17 tests get one registration pass instead
  // of 17.
  const registry = new TransitionRegistry()
  registerGpuTransitions(registry)

  it('registers exactly 15 transitions', () => {
    expect(registry.size).toBe(EXPECTED_GPU_TRANSITION_IDS.length)
    expect(registry.getIds().sort()).toEqual([...EXPECTED_GPU_TRANSITION_IDS].sort())
  })

  it.each(EXPECTED_GPU_TRANSITION_IDS)(
    'registers "%s" with a renderCanvas method and a matching gpuTransitionId',
    (id) => {
      const renderer = registry.getRenderer(id)
      expect(renderer, `${id} renderer should be registered`).toBeDefined()
      expect(typeof renderer?.renderCanvas, `${id} should have renderCanvas`).toBe('function')
      expect(renderer?.gpuTransitionId, `${id} should set gpuTransitionId`).toBe(id)
    },
  )

  it('attaches a TransitionDefinition for every registered transition', () => {
    for (const id of EXPECTED_GPU_TRANSITION_IDS) {
      const definition = registry.getDefinition(id)
      expect(definition, `${id} should have a definition`).toBeDefined()
      expect(definition?.id).toBe(id)
    }
  })
})
