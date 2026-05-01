import { describe, expect, it } from 'vite-plus/test'
import { calculatePlayerContentLayout } from './player-layout'

describe('calculatePlayerContentLayout', () => {
  it('keeps fractional container dimensions instead of rounding through clientWidth', () => {
    const layout = calculatePlayerContentLayout(986.65625, 555, 1920, 1080)

    expect(layout.width).toBeCloseTo(986.65625, 5)
    expect(layout.height).toBeCloseTo(554.99414, 5)
    expect(layout.scale).toBeCloseTo(0.51388346, 8)
  })
})
