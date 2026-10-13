import { describe, expect, it } from 'vite-plus/test'
import { calculateCropFromDrag } from './crop-gizmo'

const MEDIA_RECT = { x: 0, y: 0, width: 1000, height: 500 }

describe('calculateCropFromDrag', () => {
  it('maps each edge drag to its source-relative crop value', () => {
    expect(
      calculateCropFromDrag({
        edge: 'left',
        startCrop: undefined,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 100, y: 0 },
        rotation: 0,
        mediaRect: MEDIA_RECT,
        sourceDimension: 1000,
      }).left,
    ).toBeCloseTo(0.1)
    expect(
      calculateCropFromDrag({
        edge: 'right',
        startCrop: undefined,
        startPoint: { x: 100, y: 0 },
        currentPoint: { x: 50, y: 0 },
        rotation: 0,
        mediaRect: MEDIA_RECT,
        sourceDimension: 1000,
      }).right,
    ).toBeCloseTo(0.05)
    expect(
      calculateCropFromDrag({
        edge: 'top',
        startCrop: undefined,
        startPoint: { x: 0, y: 0 },
        currentPoint: { x: 0, y: 50 },
        rotation: 0,
        mediaRect: MEDIA_RECT,
        sourceDimension: 500,
      }).top,
    ).toBeCloseTo(0.1)
    expect(
      calculateCropFromDrag({
        edge: 'bottom',
        startCrop: undefined,
        startPoint: { x: 0, y: 100 },
        currentPoint: { x: 0, y: 50 },
        rotation: 0,
        mediaRect: MEDIA_RECT,
        sourceDimension: 500,
      }).bottom,
    ).toBeCloseTo(0.1)
  })

  it('inverse-rotates pointer movement into the item axes', () => {
    const crop = calculateCropFromDrag({
      edge: 'left',
      startCrop: undefined,
      startPoint: { x: 0, y: 0 },
      currentPoint: { x: 0, y: 100 },
      rotation: 90,
      mediaRect: MEDIA_RECT,
      sourceDimension: 1000,
    })

    expect(crop.left).toBeCloseTo(0.1)
  })

  it('keeps a sliver visible and preserves the opposite crop edge', () => {
    const crop = calculateCropFromDrag({
      edge: 'left',
      startCrop: { right: 0.25, softness: 0.2 },
      startPoint: { x: 0, y: 0 },
      currentPoint: { x: 2000, y: 0 },
      rotation: 0,
      mediaRect: MEDIA_RECT,
      sourceDimension: 1000,
    })

    expect(crop.left).toBeCloseTo(0.749)
    expect(crop.right).toBe(0.25)
    expect(crop.softness).toBe(0.2)
  })

  it('clamps outward drags back to zero', () => {
    const crop = calculateCropFromDrag({
      edge: 'top',
      startCrop: { top: 0.2 },
      startPoint: { x: 0, y: 100 },
      currentPoint: { x: 0, y: -100 },
      rotation: 0,
      mediaRect: MEDIA_RECT,
      sourceDimension: 500,
    })

    expect(crop.top).toBe(0)
  })

  it('snaps a gizmo drag to whole intrinsic source pixels', () => {
    const crop = calculateCropFromDrag({
      edge: 'left',
      startCrop: undefined,
      startPoint: { x: 0, y: 0 },
      currentPoint: { x: 10.4, y: 0 },
      rotation: 0,
      mediaRect: { x: 0, y: 0, width: 100, height: 50 },
      sourceDimension: 1920,
    })

    expect(crop.left * 1920).toBe(200)
  })
})
