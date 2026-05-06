import { useCallback } from 'react'
import { useTimelineStore } from '../stores/timeline-store'
import { useZoomStore } from '../stores/zoom-store'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('TimelineZoom')

interface UseTimelineZoomOptions {
  initialZoom?: number
  minZoom?: number
  maxZoom?: number
}

interface ZoomSelectors {
  zoomLevel: (state: ReturnType<typeof useZoomStore.getState>) => number
  pixelsPerSecond: (state: ReturnType<typeof useZoomStore.getState>) => number
}

/**
 * Timeline zoom hook with utilities for converting between time and pixels
 *
 * Uses granular Zustand selectors for optimal performance
 */
function useTimelineZoomInternal(options: UseTimelineZoomOptions, selectors: ZoomSelectors) {
  const { minZoom = 0.01, maxZoom = 10 } = options

  // Use granular selectors - Zustand v5 best practice
  const zoomLevel = useZoomStore(selectors.zoomLevel)
  const setZoomLevel = useZoomStore((s) => s.setZoomLevel)
  const setZoomLevelImmediate = useZoomStore((s) => s.setZoomLevelImmediate)
  const setZoomLevelSynchronized = useZoomStore((s) => s.setZoomLevelSynchronized)
  const zoomInAction = useZoomStore((s) => s.zoomIn)
  const zoomOutAction = useZoomStore((s) => s.zoomOut)
  const pixelsPerSecond = useZoomStore(selectors.pixelsPerSecond)
  const fps = useTimelineStore((s) => s.fps)

  /**
   * Convert time (in seconds) to pixels at current zoom level
   */
  const timeToPixels = useCallback(
    (timeInSeconds: number) => {
      return timeInSeconds * pixelsPerSecond
    },
    [pixelsPerSecond],
  )

  /**
   * Convert pixels to time (in seconds) at current zoom level
   */
  const pixelsToTime = useCallback(
    (pixels: number) => {
      if (pixelsPerSecond <= 0) {
        logger.warn('pixelsPerSecond is zero or negative, returning 0')
        return 0
      }
      return pixels / pixelsPerSecond
    },
    [pixelsPerSecond],
  )

  /**
   * Convert frame number to pixels
   */
  const frameToPixels = useCallback(
    (frame: number) => {
      const timeInSeconds = frame / fps
      return timeToPixels(timeInSeconds)
    },
    [fps, timeToPixels],
  )

  /**
   * Convert pixels to frame number
   */
  const pixelsToFrame = useCallback(
    (pixels: number) => {
      const timeInSeconds = pixelsToTime(pixels)
      return Math.round(timeInSeconds * fps)
    },
    [fps, pixelsToTime],
  )

  const pixelsToFramePrecise = useCallback(
    (pixels: number) => {
      const timeInSeconds = pixelsToTime(pixels)
      return timeInSeconds * fps
    },
    [fps, pixelsToTime],
  )

  /**
   * Reset zoom to 1x
   */
  const resetZoom = useCallback(() => {
    setZoomLevel(1)
  }, [setZoomLevel])

  return {
    zoomLevel,
    pixelsPerSecond,
    timeToPixels,
    pixelsToTime,
    frameToPixels,
    pixelsToFrame,
    pixelsToFramePrecise,
    zoomIn: zoomInAction, // Direct reference - store actions are stable
    zoomOut: zoomOutAction, // Direct reference - store actions are stable
    resetZoom,
    setZoom: (level: number) => setZoomLevel(Math.max(minZoom, Math.min(maxZoom, level))),
    setZoomImmediate: (level: number) =>
      setZoomLevelImmediate(Math.max(minZoom, Math.min(maxZoom, level))),
    setZoomSynchronized: (level: number) =>
      setZoomLevelSynchronized(Math.max(minZoom, Math.min(maxZoom, level))),
  }
}

export function useTimelineZoom(options: UseTimelineZoomOptions = {}) {
  return useTimelineZoomInternal(options, {
    zoomLevel: (s) => s.level,
    pixelsPerSecond: (s) => s.pixelsPerSecond,
  })
}

export function useTimelineContentZoom(options: UseTimelineZoomOptions = {}) {
  return useTimelineZoomInternal(options, {
    zoomLevel: (s) => s.contentLevel,
    pixelsPerSecond: (s) => s.contentPixelsPerSecond,
  })
}
