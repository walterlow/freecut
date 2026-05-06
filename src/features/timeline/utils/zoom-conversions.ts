/**
 * Imperative zoom conversion utilities.
 *
 * These read the current zoom/fps from stores at call-time without creating
 * React subscriptions.  Use them inside event handlers (mousedown, mousemove,
 * etc.) where a subscription would cause unnecessary re-renders.
 */

import { useZoomStore } from '@/features/timeline/stores/zoom-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'

export function getPixelsPerSecondNow(): number {
  return useZoomStore.getState().pixelsPerSecond
}

export function getZoomLevelNow(): number {
  return useZoomStore.getState().level
}

export function getFpsNow(): number {
  return useTimelineSettingsStore.getState().fps
}

export function pixelsToTimeNow(pixels: number): number {
  const pps = getPixelsPerSecondNow()
  return pps > 0 ? pixels / pps : 0
}

export function timeToPixelsNow(timeInSeconds: number): number {
  return timeInSeconds * getPixelsPerSecondNow()
}

export function frameToPixelsNow(frame: number): number {
  const fps = getFpsNow()
  return fps > 0 ? (frame / fps) * getPixelsPerSecondNow() : 0
}

export function pixelsToFrameNow(pixels: number): number {
  const fps = getFpsNow()
  const pps = getPixelsPerSecondNow()
  return fps > 0 && pps > 0 ? Math.round((pixels / pps) * fps) : 0
}

export function pixelsToFramePreciseNow(pixels: number): number {
  const fps = getFpsNow()
  return pixelsToTimeNow(pixels) * fps
}
