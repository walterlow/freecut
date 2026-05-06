import { describe, expect, it } from 'vite-plus/test'
import { calculatePlayerContentLayout } from './player-layout'

describe('calculatePlayerContentLayout', () => {
  it('preserves uniform scale for fractional near-exact fits', () => {
    const layout = calculatePlayerContentLayout(986.65625, 555, 1920, 1080)

    expect(layout.width).toBeCloseTo(986.65625, 5)
    expect(layout.height).toBeCloseTo(554.99414, 5)
    expect(layout.scale).toBeCloseTo(0.51388346, 8)
    expect(layout.scaleX).toBeCloseTo(layout.scale, 8)
    expect(layout.scaleY).toBeCloseTo(layout.scale, 8)
  })

  it('preserves uniform scale for near-exact aspect-ratio fits instead of stretching one axis', () => {
    const layout = calculatePlayerContentLayout(1281, 720, 1280, 720)

    expect(layout.scaleX).toBe(layout.scale)
    expect(layout.scaleY).toBe(layout.scale)
    expect(layout.width).toBe(1280)
    expect(layout.height).toBe(720)
  })

  it('keeps real letterboxing when the container is not a near-exact aspect fit', () => {
    const layout = calculatePlayerContentLayout(1000, 500, 1920, 1080)

    expect(layout.width).toBeCloseTo(888.88889, 5)
    expect(layout.height).toBeCloseTo(500, 5)
    expect(layout.scaleX).toBeCloseTo(layout.scale, 8)
    expect(layout.scaleY).toBeCloseTo(layout.scale, 8)
  })
})
