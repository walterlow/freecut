import { describe, expect, it } from 'vite-plus/test'
import { projection360 } from './projection-360'
import {
  applyFovPreset,
  DEFAULT_PROJECTION_360_SETTINGS,
  is360Filename,
  isEquirectangularDimensions,
} from '@/types/projection360'

describe('projection-360 GPU effect & presets', () => {
  it('registers correct metadata and category', () => {
    expect(projection360.id).toBe('gpu-projection-360')
    expect(projection360.category).toBe('distort')
    expect(projection360.uniformSize).toBe(64)
    expect(projection360.shader).toContain('fn projection360Fragment')
  })

  it('correctly packs uniforms into Float32Array', () => {
    const packed = projection360.packUniforms(
      {
        enabled: true,
        fov: 110,
        distance: 1.2,
        distortion: 0.3,
        yaw: 45,
        pitch: -15,
        roll: 10,
        horizonLock: '45',
        horizonOffset: 2.5,
      },
      1920,
      1080,
    )

    expect(packed).toBeInstanceOf(Float32Array)
    expect(packed?.length).toBe(16)
    expect(packed?.[0]).toBe(1920) // outputWidth
    expect(packed?.[1]).toBe(1080) // outputHeight
    expect(packed?.[4]).toBe(110) // fov
    expect(packed?.[5]).toBeCloseTo(1.2) // distance
    expect(packed?.[6]).toBeCloseTo(0.3) // distortion
    expect(packed?.[7]).toBe(45) // yaw
    expect(packed?.[8]).toBe(-15) // pitch
    expect(packed?.[9]).toBe(10) // roll
    expect(packed?.[10]).toBe(1.0) // horizonLock 45 -> 1.0
    expect(packed?.[11]).toBeCloseTo(2.5) // horizonOffset
    expect(packed?.[12]).toBe(1.0) // enabled -> 1.0
  })

  it('applies UltraWide preset correctly and isolates dewarpMode to 0.0', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'ultra-wide')
    expect(updated.preset).toBe('ultra-wide')
    expect(updated.fov).toBe(110)
    expect(updated.distortion).toBe(0.0)

    const packed = projection360.packUniforms(
      updated as unknown as Record<string, string | number | boolean>,
      1920,
      1080,
    )
    expect(packed?.[14]).toBe(0.0) // Submode A: Native lens optics untouched
  })

  it('applies Wide preset correctly and isolates dewarpMode to 0.0', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'wide')
    expect(updated.preset).toBe('wide')
    expect(updated.fov).toBe(102)

    const packed = projection360.packUniforms(
      updated as unknown as Record<string, string | number | boolean>,
      1920,
      1080,
    )
    expect(packed?.[14]).toBe(0.0) // Submode A: Native lens optics untouched
  })

  it('applies Linear preset correctly with rectilinear dewarp distortion and dewarpMode 1.0', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'linear')
    expect(updated.preset).toBe('linear')
    expect(updated.fov).toBe(88.5)
    expect(updated.distortion).toBe(1.0)

    const packed = projection360.packUniforms(
      updated as unknown as Record<string, string | number | boolean>,
      1920,
      1080,
    )
    expect(packed?.[14]).toBe(1.0) // Submode B: Optical rectilinear dewarp active
  })

  it('applies Narrow preset correctly with rectilinear dewarp and dewarpMode 1.0', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'narrow')
    expect(updated.preset).toBe('narrow')
    expect(updated.fov).toBe(64.0)

    const packed = projection360.packUniforms(
      updated as unknown as Record<string, string | number | boolean>,
      1920,
      1080,
    )
    expect(packed?.[14]).toBe(1.0) // Submode B: Optical rectilinear dewarp active
  })

  it('applies 360° Horizont preset with 360 horizonLock', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'horizon-360')
    expect(updated.preset).toBe('horizon-360')
    expect(updated.horizonLock).toBe('360')
  })

  it('applies 45° Horizont preset with 45 horizonLock', () => {
    const updated = applyFovPreset(DEFAULT_PROJECTION_360_SETTINGS, 'horizon-45')
    expect(updated.preset).toBe('horizon-45')
    expect(updated.horizonLock).toBe('45')
  })

  it('detects equirectangular 2:1 dimensions', () => {
    expect(isEquirectangularDimensions(5760, 2880)).toBe(true)
    expect(isEquirectangularDimensions(3840, 1920)).toBe(true)
    expect(isEquirectangularDimensions(1920, 960)).toBe(true)
    expect(isEquirectangularDimensions(1920, 1080)).toBe(false)
    expect(isEquirectangularDimensions(1080, 1920)).toBe(false)
  })

  it('detects 360 filenames', () => {
    expect(is360Filename('VID_20260925_120000.insv')).toBe(true)
    expect(is360Filename('IMG_20260925_120000.insp')).toBe(true)
    expect(is360Filename('drone_360_footage.mp4')).toBe(true)
    expect(is360Filename('standard_clip.mp4')).toBe(false)
  })
})
