import { describe, expect, it } from 'vite-plus/test'

import { getTimelineWidth, getZoomToFitLevel } from './timeline-layout'

describe('timeline layout helpers', () => {
  it('keeps zoom-to-fit framing unchanged', () => {
    expect(getZoomToFitLevel(1000, 10)).toBeCloseTo(0.95)
  })

  it('keeps extra scroll room after the project end', () => {
    expect(getTimelineWidth({ contentWidth: 950, viewportWidth: 1000 })).toBe(1300)
  })

  it('preserves the same tail room when content already exceeds the viewport', () => {
    expect(getTimelineWidth({ contentWidth: 1500, viewportWidth: 1000 })).toBe(1850)
  })
})
