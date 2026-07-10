import { describe, expect, it } from 'vitest'
import {
  cinematic4KResolution,
  scaleDimension,
  scaledResolution,
} from './export-resolution-presets'

describe('export resolution presets', () => {
  it('rounds scaled dimensions to even encoder-safe values', () => {
    expect(scaleDimension(853, 1)).toBe(854)
    expect(scaleDimension(1920, 0.5)).toBe(960)
    expect(scaledResolution(1280, 720, 0.666)).toEqual({ width: 852, height: 480 })
  })

  it('builds a cinematic 4K target while preserving landscape aspect ratio', () => {
    expect(cinematic4KResolution(1920, 1080)).toEqual({ width: 3840, height: 2160 })
    expect(cinematic4KResolution(854, 480)).toEqual({ width: 3844, height: 2160 })
  })

  it('builds a cinematic 4K target for portrait and square projects', () => {
    expect(cinematic4KResolution(1080, 1920)).toEqual({ width: 2160, height: 3840 })
    expect(cinematic4KResolution(1024, 1024)).toEqual({ width: 2160, height: 2160 })
  })
})
