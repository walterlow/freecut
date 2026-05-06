import { describe, expect, it } from 'vite-plus/test'

import {
  getKeyframeNavigatorResizeDragResult,
  getKeyframeNavigatorThumbMetrics,
  normalizeKeyframeNavigatorViewport,
} from './compact-navigator-utils'

describe('compact keyframe navigator math', () => {
  it('calculates thumb metrics from the current frame viewport', () => {
    const metrics = getKeyframeNavigatorThumbMetrics({
      viewport: { startFrame: 20, endFrame: 40 },
      contentFrameMax: 100,
      trackWidth: 200,
    })

    expect(metrics.thumbWidth).toBeCloseTo(36.4)
    expect(metrics.thumbLeft).toBeCloseTo(45.4)
    expect(metrics.visibleFrameRange).toBe(20)
  })

  it('keeps the thumb slightly inset from the right edge at clip end', () => {
    const metrics = getKeyframeNavigatorThumbMetrics({
      viewport: { startFrame: 80, endFrame: 100 },
      contentFrameMax: 100,
      trackWidth: 200,
    })

    expect(metrics.thumbLeft + metrics.thumbWidth).toBeCloseTo(191)
  })

  it('keeps the viewport pinned to frame zero when expanding from the far left', () => {
    const nextViewport = getKeyframeNavigatorResizeDragResult({
      dragTarget: 'right',
      deltaX: 30,
      dragStartThumbWidth: 60,
      trackWidth: 200,
      viewport: { startFrame: 0, endFrame: 30 },
      contentFrameMax: 120,
      minVisibleFrames: 20,
    })

    expect(nextViewport.startFrame).toBe(0)
  })

  it('keeps the right edge fixed when resizing from the left handle', () => {
    const nextViewport = getKeyframeNavigatorResizeDragResult({
      dragTarget: 'left',
      deltaX: 20,
      dragStartThumbWidth: 80,
      trackWidth: 200,
      viewport: { startFrame: 30, endFrame: 78 },
      contentFrameMax: 120,
      minVisibleFrames: 20,
    })

    expect(nextViewport.endFrame).toBe(78)
  })

  it('clamps the viewport so it cannot move past the clip end', () => {
    expect(
      normalizeKeyframeNavigatorViewport({ startFrame: 900, endFrame: 1300 }, 1200, 20),
    ).toEqual({ startFrame: 800, endFrame: 1200 })
  })
})
