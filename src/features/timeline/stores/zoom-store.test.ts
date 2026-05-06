import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { _resetZoomStoreForTest, useZoomStore } from './zoom-store'

describe('zoom-store interaction split', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetZoomStoreForTest()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    _resetZoomStoreForTest()
  })

  it('updates visual zoom immediately and settles content zoom after interaction stops', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.4)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      pixelsPerSecond: 140,
      contentLevel: 1,
      contentPixelsPerSecond: 100,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(99)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(1)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.4,
      pixelsPerSecond: 140,
      contentLevel: 1.4,
      contentPixelsPerSecond: 140,
      isZoomInteracting: false,
    })
  })

  it('keeps only the latest interaction zoom target before settling', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.2)
    useZoomStore.getState().setZoomLevelImmediate(1.6)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    vi.advanceTimersByTime(100)
    expect(useZoomStore.getState()).toMatchObject({
      level: 1.6,
      contentLevel: 1.6,
      isZoomInteracting: false,
    })
  })

  it('applies discrete zoom actions synchronously to both visual and content zoom', () => {
    useZoomStore.getState().zoomIn()

    const state = useZoomStore.getState()
    expect(state.level).toBeCloseTo(1.1)
    expect(state.pixelsPerSecond).toBeCloseTo(110)
    expect(state.contentLevel).toBeCloseTo(1.1)
    expect(state.contentPixelsPerSecond).toBeCloseTo(110)
    expect(state.isZoomInteracting).toBe(false)
  })

  it('can synchronize a direct zoom level update without leaving content behind', () => {
    useZoomStore.getState().setZoomLevelImmediate(1.8)

    expect(useZoomStore.getState()).toMatchObject({
      level: 1.8,
      contentLevel: 1,
      isZoomInteracting: true,
    })

    useZoomStore.getState().setZoomLevelSynchronized(0.75)

    expect(useZoomStore.getState()).toMatchObject({
      level: 0.75,
      pixelsPerSecond: 75,
      contentLevel: 0.75,
      contentPixelsPerSecond: 75,
      isZoomInteracting: false,
    })

    vi.advanceTimersByTime(100)
    expect(useZoomStore.getState()).toMatchObject({
      level: 0.75,
      contentLevel: 0.75,
      isZoomInteracting: false,
    })
  })
})
