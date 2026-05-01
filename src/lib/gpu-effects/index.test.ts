import { describe, expect, it } from 'vite-plus/test'
import { GPU_EFFECT_REGISTRY, getGpuEffect, getGpuEffectDefaultParams } from './index'

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
})
