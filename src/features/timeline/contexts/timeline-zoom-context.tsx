/**
 * Timeline Zoom Utilities
 *
 * Provides zoom-related values and helper functions for timeline components.
 * Uses Zustand stores directly - no context needed since Zustand already
 * optimizes for multiple subscriptions to the same selectors.
 */

import { useMemo } from 'react'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineStore } from '../stores/timeline-store'

interface TimelineZoomValue {
  zoomLevel: number
  pixelsPerSecond: number
  timeToPixels: (timeInSeconds: number) => number
  pixelsToTime: (pixels: number) => number
  frameToPixels: (frame: number) => number
  pixelsToFrame: (pixels: number) => number
  fps: number
}

function useTimelineZoomValue(
  zoomLevelSelector: (state: ReturnType<typeof useZoomStore.getState>) => number,
  pixelsPerSecondSelector: (state: ReturnType<typeof useZoomStore.getState>) => number,
): TimelineZoomValue {
  const zoomLevel = useZoomStore(zoomLevelSelector)
  const pixelsPerSecond = useZoomStore(pixelsPerSecondSelector)
  const fps = useTimelineStore((s) => s.fps)

  return useMemo(
    () => ({
      zoomLevel,
      pixelsPerSecond,
      fps,
      timeToPixels: (t: number) => t * pixelsPerSecond,
      pixelsToTime: (p: number) => (pixelsPerSecond > 0 ? p / pixelsPerSecond : 0),
      frameToPixels: (f: number) => (f / fps) * pixelsPerSecond,
      pixelsToFrame: (p: number) => Math.round((p / pixelsPerSecond) * fps),
    }),
    [zoomLevel, pixelsPerSecond, fps],
  )
}

/**
 * Hook to get timeline zoom values and helper functions.
 *
 * Reads directly from Zustand stores.
 */
export function useTimelineZoomContext(): TimelineZoomValue {
  return useTimelineZoomValue(
    (s) => s.level,
    (s) => s.pixelsPerSecond,
  )
}

export function useTimelineContentZoomContext(): TimelineZoomValue {
  return useTimelineZoomValue(
    (s) => s.contentLevel,
    (s) => s.contentPixelsPerSecond,
  )
}
