import { describe, expect, it } from 'vite-plus/test'
import { deltaE2000, deltaE76, rgbToLab } from './lab-color'

describe('rgbToLab', () => {
  it('maps pure white to L=100, a=0, b=0', () => {
    const { l, a, b } = rgbToLab(255, 255, 255)
    expect(l).toBeCloseTo(100, 1)
    expect(a).toBeCloseTo(0, 1)
    expect(b).toBeCloseTo(0, 1)
  })

  it('maps pure black to L=0', () => {
    const { l, a, b } = rgbToLab(0, 0, 0)
    expect(l).toBeCloseTo(0, 1)
    expect(a).toBeCloseTo(0, 1)
    expect(b).toBeCloseTo(0, 1)
  })

  it('maps pure sRGB red to the canonical Lab red region', () => {
    // Reference values from Bruce Lindbloom's sRGB calculator.
    const lab = rgbToLab(255, 0, 0)
    expect(lab.l).toBeCloseTo(53.24, 0)
    expect(lab.a).toBeCloseTo(80.09, 0)
    expect(lab.b).toBeCloseTo(67.2, 0)
  })

  it('maps pure sRGB green to its known Lab coordinates', () => {
    const lab = rgbToLab(0, 255, 0)
    expect(lab.l).toBeCloseTo(87.73, 0)
    expect(lab.a).toBeCloseTo(-86.18, 0)
    expect(lab.b).toBeCloseTo(83.18, 0)
  })

  it('maps pure sRGB blue to its known Lab coordinates', () => {
    const lab = rgbToLab(0, 0, 255)
    expect(lab.l).toBeCloseTo(32.3, 0)
    expect(lab.a).toBeCloseTo(79.19, 0)
    expect(lab.b).toBeCloseTo(-107.86, 0)
  })
})

describe('deltaE76', () => {
  it('returns 0 for identical colors', () => {
    const red = rgbToLab(255, 0, 0)
    expect(deltaE76(red, red)).toBeCloseTo(0, 5)
  })

  it('is larger between red and blue than between red and dark red', () => {
    const red = rgbToLab(255, 0, 0)
    const darkRed = rgbToLab(180, 0, 0)
    const blue = rgbToLab(0, 0, 255)
    expect(deltaE76(red, blue)).toBeGreaterThan(deltaE76(red, darkRed))
  })
})

describe('deltaE2000', () => {
  it('returns 0 for identical colors', () => {
    const red = rgbToLab(255, 0, 0)
    expect(deltaE2000(red, red)).toBeCloseTo(0, 5)
  })

  it('gives a small delta for near-duplicate reds', () => {
    const red = rgbToLab(255, 0, 0)
    const nearRed = rgbToLab(250, 5, 5)
    expect(deltaE2000(red, nearRed)).toBeLessThan(3)
  })

  it('gives a large delta for red vs blue', () => {
    const red = rgbToLab(255, 0, 0)
    const blue = rgbToLab(0, 0, 255)
    expect(deltaE2000(red, blue)).toBeGreaterThan(40)
  })

  it('ranks "orange vs red" closer than "orange vs blue"', () => {
    const orange = rgbToLab(255, 128, 0)
    const red = rgbToLab(255, 0, 0)
    const blue = rgbToLab(0, 0, 255)
    expect(deltaE2000(orange, red)).toBeLessThan(deltaE2000(orange, blue))
  })
})
