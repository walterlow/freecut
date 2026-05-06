import { describe, it, expect } from 'vite-plus/test'
import { computeHistogram, chiSquaredDistance } from './histogram-scene-detection'

describe('computeHistogram', () => {
  it('returns a Float32Array of correct length', () => {
    // 2x2 image, 4 channels per pixel
    const pixels = new Uint8ClampedArray(2 * 2 * 4)
    const hist = computeHistogram(pixels)
    // 32 bins per channel * 3 channels = 96
    expect(hist).toBeInstanceOf(Float32Array)
    expect(hist.length).toBe(96)
  })

  it('produces normalized histogram summing to ~1.0 per channel', () => {
    // All red pixels: R=255, G=0, B=0
    const size = 10 * 10
    const pixels = new Uint8ClampedArray(size * 4)
    for (let i = 0; i < size; i++) {
      pixels[i * 4] = 255 // R
      pixels[i * 4 + 1] = 0 // G
      pixels[i * 4 + 2] = 0 // B
      pixels[i * 4 + 3] = 255 // A
    }

    const hist = computeHistogram(pixels)

    // Sum each channel
    let rSum = 0,
      gSum = 0,
      bSum = 0
    for (let i = 0; i < 32; i++) {
      rSum += hist[i]!
      gSum += hist[32 + i]!
      bSum += hist[64 + i]!
    }

    expect(rSum).toBeCloseTo(1.0, 5)
    expect(gSum).toBeCloseTo(1.0, 5)
    expect(bSum).toBeCloseTo(1.0, 5)
  })

  it('concentrates mass in the correct bin for uniform color', () => {
    const size = 4
    const pixels = new Uint8ClampedArray(size * 4)
    // Mid-green: R=0, G=128, B=0
    for (let i = 0; i < size; i++) {
      pixels[i * 4] = 0
      pixels[i * 4 + 1] = 128
      pixels[i * 4 + 2] = 0
      pixels[i * 4 + 3] = 255
    }

    const hist = computeHistogram(pixels)

    // R channel: all in bin 0
    expect(hist[0]).toBe(1.0)
    // G channel: 128 / 256 * 32 = 16 → bin 16
    expect(hist[32 + 16]).toBe(1.0)
    // B channel: all in bin 0
    expect(hist[64]).toBe(1.0)
  })
})

describe('chiSquaredDistance', () => {
  it('returns 0 for identical histograms', () => {
    const hist = new Float32Array(96)
    hist[0] = 0.5
    hist[15] = 0.5
    const distance = chiSquaredDistance(hist, hist)
    expect(distance).toBe(0)
  })

  it('returns a positive value for different histograms', () => {
    const a = new Float32Array(96)
    const b = new Float32Array(96)
    // Opposite distributions
    a[0] = 1.0
    b[31] = 1.0
    const distance = chiSquaredDistance(a, b)
    expect(distance).toBeGreaterThan(0)
  })

  it('returns higher distance for more different histograms', () => {
    const base = new Float32Array(96)
    base[0] = 0.5
    base[1] = 0.5

    const similar = new Float32Array(96)
    similar[0] = 0.4
    similar[1] = 0.6

    const different = new Float32Array(96)
    different[0] = 0.0
    different[31] = 1.0

    const dSimilar = chiSquaredDistance(base, similar)
    const dDifferent = chiSquaredDistance(base, different)

    expect(dDifferent).toBeGreaterThan(dSimilar)
  })

  it('is symmetric', () => {
    const a = new Float32Array(96)
    const b = new Float32Array(96)
    a[0] = 0.7
    a[5] = 0.3
    b[0] = 0.3
    b[5] = 0.7

    expect(chiSquaredDistance(a, b)).toBeCloseTo(chiSquaredDistance(b, a), 10)
  })
})
