import { describe, expect, it } from 'vite-plus/test'
import { GPU_TRANSITION_REGISTRY, getGpuTransition, getGpuTransitionIds } from './index'

describe('GPU transition registry', () => {
  it('registers the Resolve-style dissolve family', () => {
    const ids = getGpuTransitionIds()

    expect(ids).toEqual(
      expect.arrayContaining([
        'dissolve',
        'additiveDissolve',
        'blurDissolve',
        'dipToColorDissolve',
        'nonAdditiveDissolve',
        'smoothCut',
      ]),
    )
    expect(getGpuTransition('dissolve')).toMatchObject({
      id: 'dissolve',
      name: 'Cross Dissolve',
      category: 'dissolve',
      entryPoint: 'dissolveFragment',
      uniformSize: 16,
    })
  })

  it('packs dissolve variant uniforms within their declared buffer sizes', () => {
    const cases = [
      ['additiveDissolve', {}],
      ['blurDissolve', { strength: 8 }],
      ['dipToColorDissolve', { color: [1, 0.9, 0.7] }],
      ['nonAdditiveDissolve', {}],
      ['smoothCut', { strength: 1.2 }],
    ] as const

    for (const [id, properties] of cases) {
      const def = getGpuTransition(id)
      expect(def, id).toBeDefined()
      const uniforms = def!.packUniforms(0.4, 1920, 1080, 0, properties)
      expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    }
  })

  it('registers liquid distort as a directional GPU transition', () => {
    const def = getGpuTransition('liquidDistort')

    expect(getGpuTransitionIds()).toContain('liquidDistort')
    expect(def).toMatchObject({
      id: 'liquidDistort',
      name: 'Liquid Distort',
      category: 'custom',
      entryPoint: 'liquidDistortFragment',
      hasDirection: true,
      directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
      uniformSize: 48,
    })
  })

  it('packs liquid distort uniforms within its declared buffer size', () => {
    const def = getGpuTransition('liquidDistort')

    expect(def).toBeDefined()
    const uniforms = def!.packUniforms(0.35, 1920, 1080, 2, {
      intensity: 1.25,
      scale: 5,
      turbulence: 0.9,
      edgeSoftness: 0.16,
      chroma: 0.5,
      swirl: 1.1,
      shine: 0.8,
    })

    expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    expect(Array.from(uniforms)).toEqual([
      expect.closeTo(0.35),
      1920,
      1080,
      2,
      1.25,
      5,
      expect.closeTo(0.9),
      expect.closeTo(0.16),
      0.5,
      expect.closeTo(1.1),
      expect.closeTo(0.8),
      0,
    ])
  })

  it('registers lens warp zoom as a GPU transition', () => {
    const def = getGpuTransition('lensWarpZoom')

    expect(getGpuTransitionIds()).toContain('lensWarpZoom')
    expect(def).toMatchObject({
      id: 'lensWarpZoom',
      name: 'Lens Warp Zoom',
      category: 'custom',
      entryPoint: 'lensWarpZoomFragment',
      hasDirection: false,
      uniformSize: 48,
    })
  })

  it('packs lens warp zoom uniforms within its declared buffer size', () => {
    const def = getGpuTransition('lensWarpZoom')

    expect(def).toBeDefined()
    const uniforms = def!.packUniforms(0.42, 1280, 720, 0, {
      zoomStrength: 1.2,
      warpStrength: 0.8,
      blurStrength: 0.7,
      chroma: 0.45,
      vignette: 0.5,
      centerX: 0.4,
      centerY: 0.6,
      glow: 0.9,
    })

    expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    expect(Array.from(uniforms)).toEqual([
      expect.closeTo(0.42),
      1280,
      720,
      expect.closeTo(1.2),
      expect.closeTo(0.8),
      expect.closeTo(0.7),
      expect.closeTo(0.45),
      expect.closeTo(0.5),
      expect.closeTo(0.4),
      expect.closeTo(0.6),
      expect.closeTo(0.9),
      0,
    ])
  })

  it('registers light leak burn as a directional GPU transition', () => {
    const def = getGpuTransition('lightLeakBurn')

    expect(getGpuTransitionIds()).toContain('lightLeakBurn')
    expect(def).toMatchObject({
      id: 'lightLeakBurn',
      name: 'Light Leak Burn',
      category: 'custom',
      entryPoint: 'lightLeakBurnFragment',
      hasDirection: true,
      directions: ['from-left', 'from-right', 'from-top', 'from-bottom'],
      uniformSize: 48,
    })
  })

  it('packs light leak burn uniforms within its declared buffer size', () => {
    const def = getGpuTransition('lightLeakBurn')

    expect(def).toBeDefined()
    const uniforms = def!.packUniforms(0.33, 1920, 1080, 3, {
      intensity: 1.4,
      spread: 0.9,
      warmth: 0.8,
      burn: 1.2,
      edgeSoftness: 0.14,
      grain: 0.35,
    })

    expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    expect(Array.from(uniforms)).toEqual([
      expect.closeTo(0.33),
      1920,
      1080,
      3,
      expect.closeTo(1.4),
      expect.closeTo(0.9),
      expect.closeTo(0.8),
      expect.closeTo(1.2),
      expect.closeTo(0.14),
      expect.closeTo(0.35),
      0,
      0,
    ])
  })

  it('registers film gate slip as a GPU transition', () => {
    const def = getGpuTransition('filmGateSlip')

    expect(getGpuTransitionIds()).toContain('filmGateSlip')
    expect(def).toMatchObject({
      id: 'filmGateSlip',
      name: 'Film Gate Slip',
      category: 'custom',
      entryPoint: 'filmGateSlipFragment',
      hasDirection: false,
      uniformSize: 48,
    })
  })

  it('packs film gate slip uniforms within its declared buffer size', () => {
    const def = getGpuTransition('filmGateSlip')

    expect(def).toBeDefined()
    const uniforms = def!.packUniforms(0.61, 1280, 720, 0, {
      slip: 1.1,
      shake: 0.8,
      exposure: 0.7,
      gateWidth: 0.06,
      grain: 0.5,
      chroma: 0.4,
      roll: 0.9,
    })

    expect(uniforms.byteLength).toBeLessThanOrEqual(def!.uniformSize)
    expect(Array.from(uniforms)).toEqual([
      expect.closeTo(0.61),
      1280,
      720,
      expect.closeTo(1.1),
      expect.closeTo(0.8),
      expect.closeTo(0.7),
      expect.closeTo(0.06),
      expect.closeTo(0.5),
      expect.closeTo(0.4),
      expect.closeTo(0.9),
      0,
      0,
    ])
  })

  it('registers and packs the Magnates-style 3D scene orbit transition', () => {
    const def = getGpuTransition('sceneOrbit')

    expect(getGpuTransitionIds()).toContain('sceneOrbit')
    expect(def).toMatchObject({
      id: 'sceneOrbit',
      name: '3D Scene Orbit',
      entryPoint: 'sceneOrbitFragment',
      hasDirection: true,
      uniformSize: 32,
    })
    expect(Array.from(def!.packUniforms(0.5, 3840, 2160, 1))).toEqual([
      0.5,
      3840,
      2160,
      1,
      expect.closeTo(0.72),
      expect.closeTo(0.64),
      expect.closeTo(0.16),
      expect.closeTo(0.42),
    ])
  })

  it('exposes every transition with shader metadata and valid default uniforms', () => {
    expect(GPU_TRANSITION_REGISTRY.size).toBeGreaterThan(0)

    for (const [id, def] of GPU_TRANSITION_REGISTRY) {
      expect(def.id, id).toBe(id)
      expect(def.name.trim().length, id).toBeGreaterThan(0)
      expect(def.shader.trim().length, id).toBeGreaterThan(0)
      expect(def.entryPoint.trim().length, id).toBeGreaterThan(0)
      // WebGPU requires uniform buffer sizes to be a multiple of 16 bytes.
      expect(def.uniformSize % 16, id).toBe(0)
      expect(def.uniformSize, id).toBeGreaterThan(0)
      if (def.hasDirection) {
        expect(def.directions, id).toBeDefined()
        expect(def.directions!.length, id).toBeGreaterThan(0)
      }
      // packUniforms must produce a buffer that fits inside the declared size,
      // with all finite values, even when no custom properties are provided.
      const uniforms = def.packUniforms(0.5, 1920, 1080, 0, {})
      expect(uniforms, id).toBeInstanceOf(Float32Array)
      expect(uniforms.byteLength, id).toBeLessThanOrEqual(def.uniformSize)
      expect(Array.from(uniforms).every(Number.isFinite), id).toBe(true)
    }
  })

  it('always packs progress as the first float', () => {
    // The pipeline assumes lane 0 is progress so it can update per-frame
    // state without re-packing the full uniform buffer. Lanes 1+ are
    // shader-specific (pixelate, for example, replaces width/height with
    // pre-computed block sizes derived from the resolution).
    for (const [id, def] of GPU_TRANSITION_REGISTRY) {
      const uniforms = def.packUniforms(0.42, 1280, 720, 0, {})
      expect(uniforms[0], `${id} progress`).toBeCloseTo(0.42)
    }
  })

  it('clamps and accepts unknown properties without throwing', () => {
    // packUniforms should be defensive: unknown keys or out-of-range progress
    // values must not crash. This guards against UI passing partial state.
    for (const [id, def] of GPU_TRANSITION_REGISTRY) {
      expect(
        () => def.packUniforms(-0.5, 1920, 1080, 0, { unknownProp: 'ignored' }),
        id,
      ).not.toThrow()
      expect(() => def.packUniforms(1.5, 1920, 1080, 0, { anotherUnknown: 42 }), id).not.toThrow()
    }
  })

  it('registers the basic transition family with stable contract', () => {
    const expected = [
      { id: 'fade', entryPoint: 'fadeFragment', hasDirection: false, category: 'basic' },
      { id: 'wipe', entryPoint: 'wipeFragment', hasDirection: true, category: 'wipe' },
      { id: 'slide', entryPoint: 'slideFragment', hasDirection: true, category: 'slide' },
      { id: 'flip', entryPoint: 'flipFragment', hasDirection: true, category: 'custom' },
      { id: 'clockWipe', entryPoint: 'clockWipeFragment', hasDirection: false, category: 'mask' },
      { id: 'iris', entryPoint: 'irisFragment', hasDirection: false, category: 'iris' },
    ] as const

    for (const expectation of expected) {
      const def = getGpuTransition(expectation.id)
      expect(def, expectation.id).toBeDefined()
      expect(def).toMatchObject(expectation)
    }
  })

  it('packs fade progress/width/height as the canonical 4-float layout', () => {
    const def = getGpuTransition('fade')!
    const uniforms = def.packUniforms(0.25, 1920, 1080, 0, {})
    expect(Array.from(uniforms)).toEqual([0.25, 1920, 1080, 0])
  })

  it('packs wipe with the direction byte in lane 3', () => {
    const def = getGpuTransition('wipe')!
    const uniforms = def.packUniforms(0.6, 1280, 720, 3, {})
    expect(Array.from(uniforms)).toEqual([expect.closeTo(0.6), 1280, 720, 3])
  })

  it('returns undefined for unknown transition ids without throwing', () => {
    expect(getGpuTransition('nope-not-here')).toBeUndefined()
    expect(getGpuTransition('')).toBeUndefined()
  })
})
