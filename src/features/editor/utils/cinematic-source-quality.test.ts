import { describe, expect, it } from 'vite-plus/test'
import { describeSourceResolution, isNative4kSource } from './cinematic-source-quality'

describe('cinematic source quality', () => {
  it('accepts UHD, DCI 4K, and portrait 4K sources', () => {
    expect(isNative4kSource({ width: 3840, height: 2160 })).toBe(true)
    expect(isNative4kSource({ width: 4096, height: 2160 })).toBe(true)
    expect(isNative4kSource({ width: 2160, height: 3840 })).toBe(true)
  })

  it('rejects HD, cropped short edges, and unknown dimensions', () => {
    expect(isNative4kSource({ width: 1920, height: 1080 })).toBe(false)
    expect(isNative4kSource({ width: 4096, height: 1600 })).toBe(false)
    expect(isNative4kSource({})).toBe(false)
    expect(describeSourceResolution({ width: 1920, height: 1080 })).toBe('1920x1080')
  })
})
