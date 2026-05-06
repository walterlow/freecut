import { describe, expect, it } from 'vite-plus/test'
import {
  calculateContainedRect,
  calculateMediaCropLayout,
  cropPixelsToRatio,
  cropSignedPixelsToRatio,
  cropSignedRatioToPixels,
  cropRatioToPixels,
  getCropSoftnessReferenceDimension,
  hasMediaCrop,
  normalizeCropSettings,
  resolveCropSettings,
} from './media-crop'

describe('media-crop', () => {
  it('normalizes empty crop objects to undefined', () => {
    expect(normalizeCropSettings({ left: 0, right: 0, top: 0, bottom: 0 })).toBeUndefined()
  })

  it('normalizes softness-only crop objects to undefined', () => {
    expect(normalizeCropSettings({ softness: 0.5 })).toBeUndefined()
    expect(normalizeCropSettings({ softness: -0.5 })).toBeUndefined()
  })

  it('clamps opposing edges so they never fully collapse the visible area', () => {
    const resolved = resolveCropSettings({ left: 0.8, right: 0.5 })
    expect(resolved.left).toBeCloseTo(0.6147692308)
    expect(resolved.right).toBeCloseTo(0.3842307692)
    expect(resolved.top).toBe(0)
    expect(resolved.bottom).toBe(0)
    expect(resolved.softness).toBe(0)
  })

  it('calculates a contained media rect inside the item box', () => {
    expect(calculateContainedRect(1920, 1080, 400, 400)).toEqual({
      x: 0,
      y: 87.5,
      width: 400,
      height: 225,
    })
  })

  it('derives a cropped viewport from the contained media rect', () => {
    const layout = calculateMediaCropLayout(1920, 1080, 400, 400, {
      left: 0.1,
      right: 0.05,
      top: 0.2,
      bottom: 0,
    })

    expect(layout.mediaRect).toEqual({
      x: 0,
      y: 87.5,
      width: 400,
      height: 225,
    })
    // viewportRect is rounded to pixel boundaries
    expect(layout.viewportRect).toEqual({
      x: 40,
      y: 132,
      width: 340,
      height: 181,
    })
    expect(layout.softnessPixels).toBe(0)
    expect(layout.featherPixels).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    })
  })

  it('round-trips crop ratios through source pixels', () => {
    expect(cropRatioToPixels(0.125, 1920)).toBe(240)
    expect(cropPixelsToRatio(240, 1920)).toBeCloseTo(0.125)
    expect(cropSignedRatioToPixels(-0.125, 1920)).toBe(-240)
    expect(cropSignedPixelsToRatio(-240, 1920)).toBeCloseTo(-0.125)
  })

  it('uses the smaller source dimension when converting softness', () => {
    expect(getCropSoftnessReferenceDimension(1920, 1080)).toBe(1080)
    expect(getCropSoftnessReferenceDimension(1080, 1920)).toBe(1080)
  })

  it('derives inner feather pixels for negative softness', () => {
    const layout = calculateMediaCropLayout(1920, 1080, 400, 400, {
      left: 0.1,
      softness: -0.1,
    })

    expect(layout.softnessPixels).toBeCloseTo(22.5)
    // Negative softness: no outer expansion, so cropViewportRect and
    // viewportRect differ only by pixel-boundary rounding.
    expect(layout.viewportRect.x).toBe(Math.floor(layout.cropViewportRect.x))
    expect(layout.viewportRect.y).toBe(Math.floor(layout.cropViewportRect.y))
    expect(layout.featherPixels.left).toBeCloseTo(22.5, 0)
    expect(layout.featherPixels.right).toBe(0)
    expect(layout.featherPixels.top).toBe(0)
    expect(layout.featherPixels.bottom).toBe(0)
  })

  it('expands the viewport outward for positive softness before feathering', () => {
    const layout = calculateMediaCropLayout(1920, 1080, 400, 400, {
      left: 0.1,
      softness: 0.1,
    })

    expect(layout.cropViewportRect).toEqual({
      x: 40,
      y: 87.5,
      width: 360,
      height: 225,
    })
    // viewportRect is rounded to pixel boundaries to prevent sub-pixel seams
    expect(layout.viewportRect).toEqual({
      x: 17,
      y: 87,
      width: 383,
      height: 226,
    })
    expect(layout.featherPixels.left).toBeCloseTo(22.5, 0)
    expect(layout.featherPixels.right).toBe(0)
    expect(layout.featherPixels.top).toBe(0)
    expect(layout.featherPixels.bottom).toBe(0)
  })

  it('clamps opposing feather widths so they do not exceed the viewport', () => {
    const layout = calculateMediaCropLayout(1920, 1080, 400, 400, {
      left: 0.1,
      right: 0.1,
      softness: -1,
    })

    expect(layout.viewportRect.width).toBe(320)
    expect(layout.featherPixels.left).toBeCloseTo(160)
    expect(layout.featherPixels.right).toBeCloseTo(160)
  })

  it('detects when any crop edge is active', () => {
    expect(hasMediaCrop()).toBe(false)
    expect(hasMediaCrop({ bottom: 0.01 })).toBe(true)
  })
})
