import { describe, expect, it } from 'vite-plus/test'
import { calculatePlayerContentLayout } from './player-layout'

describe('calculatePlayerContentLayout', () => {
  it('keeps fractional container dimensions instead of rounding through clientWidth', () => {
    const layout = calculatePlayerContentLayout(986.65625, 555, 1920, 1080)

    expect(layout.width).toBeCloseTo(986.65625, 5)
    expect(layout.height).toBeCloseTo(555, 5)
    expect(layout.scale).toBeCloseTo(0.51388346, 8)
    expect(layout.scaleX).toBeCloseTo(0.51388346, 8)
    expect(layout.scaleY).toBeCloseTo(0.51388889, 8)
  })

  it('keeps real letterboxing when the container is not a near-exact aspect fit', () => {
    const layout = calculatePlayerContentLayout(1000, 500, 1920, 1080)

    expect(layout.width).toBeCloseTo(888.88889, 5)
    expect(layout.height).toBeCloseTo(500, 5)
    expect(layout.scaleX).toBeCloseTo(layout.scale, 8)
    expect(layout.scaleY).toBeCloseTo(layout.scale, 8)
  })
})
