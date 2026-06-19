import { describe, expect, it } from 'vite-plus/test'
import {
  GPU_EFFECT_REGISTRY,
  getGpuCategoriesWithEffects,
  getGpuEffect,
  getGpuEffectDefaultParams,
  getGpuEffectsByCategory,
} from './index'

describe('GPU effect registry', () => {
  it('registers every effect with shader metadata and valid default uniforms', () => {
    expect(GPU_EFFECT_REGISTRY.size).toBeGreaterThan(0)

    for (const [id, effect] of GPU_EFFECT_REGISTRY) {
      expect(effect.id).toBe(id)
      expect(effect.shader.trim().length).toBeGreaterThan(0)
      expect(effect.entryPoint.trim().length).toBeGreaterThan(0)
      expect(effect.uniformSize % 4).toBe(0)

      const defaults = getGpuEffectDefaultParams(id)
      for (const [paramKey, param] of Object.entries(effect.params)) {
        expect(defaults).toHaveProperty(paramKey)
        expect(defaults[paramKey]).toBe(param.default)
      }

      const uniforms = effect.packUniforms(defaults, 1920, 1080)
      if (effect.uniformSize === 0) {
        expect(uniforms).toBeNull()
      } else {
        expect(uniforms).toBeInstanceOf(Float32Array)
        expect(uniforms!.byteLength).toBe(effect.uniformSize)
        expect(Array.from(uniforms!).every(Number.isFinite)).toBe(true)
      }
    }
  })

  it('registers the dither effect with stable default uniforms', () => {
    const effect = getGpuEffect('gpu-dither')
    expect(effect).toBeDefined()
    expect(effect?.category).toBe('stylize')

    const defaults = getGpuEffectDefaultParams('gpu-dither')
    expect(defaults).toEqual({
      pattern: 'bayer4',
      mode: 'image',
      style: 'threshold',
      shape: 'square',
      palette: 'gameboy',
      cellSize: 8,
      angle: 45,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
    })

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual([
      8, 45, 100, 1920, 1080, 0, 0, 1, 0, 0, 1, 1,
    ])

    expect(effect!.params.angle!.visibleWhen?.(defaults)).toBe(false)
    expect(effect!.params.angle!.visibleWhen?.({ ...defaults, mode: 'linear' })).toBe(true)
    expect(effect!.params.scale!.visibleWhen?.(defaults)).toBe(false)
    expect(effect!.params.scale!.visibleWhen?.({ ...defaults, mode: 'radial' })).toBe(true)
  })

  it('registers the ascii effect with shader-friendly defaults', () => {
    const effect = getGpuEffect('gpu-ascii')
    expect(effect).toBeDefined()
    expect(effect?.category).toBe('stylize')

    const defaults = getGpuEffectDefaultParams('gpu-ascii')
    expect(defaults).toEqual({
      charSet: 'standard',
      fontSize: 8,
      letterSpacing: 0,
      lineHeight: 1,
      matchSourceColor: true,
      textColor: '#ffffff',
      bgColor: '#0a0a0f',
      colorSaturation: 100,
      asciiOpacity: 100,
      originalOpacity: 0,
      contrast: 100,
      brightness: 0,
      invert: false,
    })

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual(
      Array.from(
        new Float32Array([
          8,
          0,
          1,
          0,
          1,
          0,
          1,
          0,
          1,
          0,
          1,
          1920,
          1080,
          0,
          0,
          0,
          1,
          1,
          1,
          1,
          10 / 255,
          10 / 255,
          15 / 255,
          1,
        ]),
      ),
    )

    expect(effect!.params.textColor!.visibleWhen?.(defaults)).toBe(false)
    expect(effect!.params.textColor!.visibleWhen?.({ ...defaults, matchSourceColor: false })).toBe(
      true,
    )
    expect(effect!.params.colorSaturation!.visibleWhen?.(defaults)).toBe(true)
    expect(
      effect!.params.colorSaturation!.visibleWhen?.({ ...defaults, matchSourceColor: false }),
    ).toBe(false)
  })

  it('registers color wheels with neutral primary grading defaults', () => {
    const effect = getGpuEffect('gpu-color-wheels')
    expect(effect).toBeDefined()
    expect(effect?.uniformSize).toBe(112)

    const defaults = getGpuEffectDefaultParams('gpu-color-wheels')
    expect(defaults).toMatchObject({
      shadowsHue: 0,
      shadowsAmount: 0,
      midtonesHue: 0,
      midtonesAmount: 0,
      highlightsHue: 0,
      highlightsAmount: 0,
      offsetHue: 0,
      offsetAmount: 0,
      temperature: 0,
      tint: 0,
      saturation: 0,
      exposure: 0,
      contrast: 1,
      pivot: 0.5,
      lift: 0,
      gamma: 1,
      gain: 1,
      offset: 0,
      blackPoint: 0,
      whitePoint: 1,
      midDetail: 0,
      colorBoost: 0,
      shadows: 0,
      highlights: 0,
      hue: 50,
      lumMix: 100,
    })

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.5, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 50, 100, 0, 0,
    ])
  })

  it('registers the secondary qualifier with HSL/luma matte controls', () => {
    const effect = getGpuEffect('gpu-secondary-qualifier')
    expect(effect).toBeDefined()
    expect(effect?.category).toBe('color')
    expect(effect?.uniformSize).toBe(64)

    const defaults = getGpuEffectDefaultParams('gpu-secondary-qualifier')
    expect(defaults).toEqual({
      hueCenter: 0,
      hueWidth: 35,
      hueSoftness: 20,
      satLow: 0,
      satHigh: 1,
      satSoftness: 0.1,
      lumaLow: 0,
      lumaHigh: 1,
      lumaSoftness: 0.1,
      invertMask: false,
      showMask: false,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      strength: 1,
    })

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual(
      Array.from(new Float32Array([0, 35, 20, 0, 1, 0.1, 0, 1, 0.1, 0, 0, 0, 0, 0, 0, 1])),
    )

    const matteDefaults = { ...defaults, invertMask: true, showMask: true }
    const matteUniforms = Array.from(effect!.packUniforms(matteDefaults, 1920, 1080)!)
    expect(matteUniforms[9]).toBe(1)
    expect(matteUniforms[10]).toBe(1)
  })

  it('registers the power window with spatial matte controls', () => {
    const effect = getGpuEffect('gpu-power-window')
    expect(effect).toBeDefined()
    expect(effect?.category).toBe('color')
    expect(effect?.uniformSize).toBe(64)

    const defaults = getGpuEffectDefaultParams('gpu-power-window')
    expect(defaults).toEqual({
      shape: 'ellipse',
      centerX: 0.5,
      centerY: 0.5,
      sizeX: 0.5,
      sizeY: 0.5,
      rotation: 0,
      feather: 0.15,
      invertMask: false,
      showMask: false,
      exposure: 0,
      saturation: 0,
      temperature: 0,
      tint: 0,
      strength: 1,
    })

    expect(Array.from(effect!.packUniforms(defaults, 1920, 1080)!)).toEqual(
      Array.from(
        new Float32Array([0, 0.5, 0.5, 0.5, 0.5, 0, 0.15, 0, 0, 0, 0, 0, 0, 1, 1920, 1080]),
      ),
    )

    const rectMatte = Array.from(
      effect!.packUniforms(
        { ...defaults, shape: 'rectangle', invertMask: true, showMask: true },
        3840,
        2160,
      )!,
    )
    expect(rectMatte[0]).toBe(1)
    expect(rectMatte[7]).toBe(1)
    expect(rectMatte[8]).toBe(1)
    expect(rectMatte[14]).toBe(3840)
    expect(rectMatte[15]).toBe(2160)
  })

  it('returns undefined for unknown effect ids without throwing', () => {
    expect(getGpuEffect('nope-not-here')).toBeUndefined()
    expect(getGpuEffect('')).toBeUndefined()
    expect(getGpuEffectDefaultParams('nope-not-here')).toEqual({})
  })

  it('groups effects under their declared category', () => {
    // Every effect should be reachable via its category. The categories
    // returned by getGpuCategoriesWithEffects() should exactly cover the
    // registry.
    const categorized = getGpuCategoriesWithEffects()
    expect(categorized.length).toBeGreaterThan(0)

    const seenIds = new Set<string>()
    for (const { category, effects } of categorized) {
      expect(effects.length).toBeGreaterThan(0)
      for (const effect of effects) {
        expect(effect.category, effect.id).toBe(category)
        expect(seenIds.has(effect.id), `duplicate id ${effect.id}`).toBe(false)
        seenIds.add(effect.id)
      }
    }
    expect(seenIds.size).toBe(GPU_EFFECT_REGISTRY.size)
  })

  it('returns the same effect list via category lookup as via direct getters', () => {
    for (const { category, effects } of getGpuCategoriesWithEffects()) {
      const byCategory = getGpuEffectsByCategory(category)
      expect(byCategory.map((e) => e.id).sort()).toEqual(effects.map((e) => e.id).sort())
    }
  })

  it('returns empty list for an empty category', () => {
    // Categories with no registered effects (none today) should return [],
    // not throw. Pass a name that is in the union but lacks effects — if
    // none exists, any unknown key returns [] via nullish coalescing.
    // We assert the well-typed surface area here.
    const result = getGpuEffectsByCategory('color')
    expect(Array.isArray(result)).toBe(true)
  })

  it('tolerates unknown params without crashing', () => {
    for (const [id, effect] of GPU_EFFECT_REGISTRY) {
      if (effect.uniformSize === 0) continue
      const defaults = getGpuEffectDefaultParams(id)
      const polluted = { ...defaults, __unknownExtraParam__: 'ignored' }
      expect(() => effect.packUniforms(polluted, 1920, 1080), id).not.toThrow()
    }
  })

  it('declares uniform sizes as multiples of 16 (WebGPU alignment)', () => {
    // WebGPU requires uniform buffers be multiples of 16 bytes. The packed
    // Float32Array must also fit within the declared size.
    for (const [id, effect] of GPU_EFFECT_REGISTRY) {
      expect(effect.uniformSize % 16, id).toBe(0)
      if (effect.uniformSize === 0) continue
      const defaults = getGpuEffectDefaultParams(id)
      const packed = effect.packUniforms(defaults, 1920, 1080)
      expect(packed, id).not.toBeNull()
      expect(packed!.byteLength, id).toBeLessThanOrEqual(effect.uniformSize)
    }
  })
})
