import { describe, expect, it } from 'vite-plus/test'
import {
  computeCornerPinHomography,
  invertCornerPinHomography,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  withCornerPinReferenceSize,
} from '@/features/preview/deps/composition-runtime'

const baseCornerPin = {
  topLeft: [10, 20] as [number, number],
  topRight: [30, 40] as [number, number],
  bottomRight: [50, 60] as [number, number],
  bottomLeft: [70, 80] as [number, number],
  referenceWidth: 200,
  referenceHeight: 100,
}

describe('corner pin reference sizing', () => {
  it('targets the contained media rect instead of the full item box', () => {
    const rect = resolveCornerPinTargetRect(500, 500, {
      sourceWidth: 1920,
      sourceHeight: 1080,
    })
    expect(rect.x).toBeCloseTo(0)
    expect(rect.y).toBeCloseTo(109.375)
    expect(rect.width).toBeCloseTo(500)
    expect(rect.height).toBeCloseTo(281.25)
  })

  it('scales authored offsets against the current render size', () => {
    expect(resolveCornerPinForSize(baseCornerPin, 400, 50)).toEqual({
      topLeft: [20, 10],
      topRight: [60, 20],
      bottomRight: [100, 30],
      bottomLeft: [140, 40],
    })
  })

  it('rewrites resolved offsets with a new reference size', () => {
    expect(
      withCornerPinReferenceSize(
        {
          topLeft: [15, 30],
          topRight: [45, 60],
          bottomRight: [75, 90],
          bottomLeft: [105, 120],
        },
        300,
        150,
      ),
    ).toEqual({
      topLeft: [15, 30],
      topRight: [45, 60],
      bottomRight: [75, 90],
      bottomLeft: [105, 120],
      referenceWidth: 300,
      referenceHeight: 150,
    })
  })

  it('computes an invertible homography for GPU and canvas corner-pin rendering', () => {
    const pin = resolveCornerPinForSize(baseCornerPin, 400, 200)
    expect(pin).toBeDefined()

    const homography = computeCornerPinHomography(400, 200, pin!)
    const inverse = invertCornerPinHomography(homography)

    expect(inverse).not.toBeNull()
    expect(homography).toHaveLength(9)
    expect(inverse).toHaveLength(9)

    const project = (m: number[], x: number, y: number) => {
      const w = m[6]! * x + m[7]! * y + m[8]!
      return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w]
    }
    const warped = project(homography, 123, 87)
    const unwarped = project(inverse!, warped[0]!, warped[1]!)

    expect(unwarped[0]).toBeCloseTo(123)
    expect(unwarped[1]).toBeCloseTo(87)
  })
})
