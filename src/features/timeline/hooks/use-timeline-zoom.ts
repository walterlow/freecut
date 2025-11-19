import { useCallback } from 'react';
import { useTimelineStore } from '../stores/timeline-store';
import { useZoomStore } from '../stores/zoom-store';

export interface UseTimelineZoomOptions {
  initialZoom?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Timeline zoom hook with utilities for converting between time and pixels
 *
 * Uses granular Zustand selectors for optimal performance
 */
export function useTimelineZoom(options: UseTimelineZoomOptions = {}) {
  const {
    minZoom = 0.01,
    maxZoom = 10,
  } = options;

  // Use granular selectors - Zustand v5 best practice
  const zoomLevel = useZoomStore((s) => s.level);
  const setZoomLevel = useZoomStore((s) => s.setZoomLevel);
  const zoomInAction = useZoomStore((s) => s.zoomIn);
  const zoomOutAction = useZoomStore((s) => s.zoomOut);
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond);
  const fps = useTimelineStore((s) => s.fps);

  /**
   * Convert time (in seconds) to pixels at current zoom level
   */
  const timeToPixels = useCallback(
    (timeInSeconds: number) => {
      return timeInSeconds * pixelsPerSecond;
    },
    [pixelsPerSecond]
  );

  /**
   * Convert pixels to time (in seconds) at current zoom level
   */
  const pixelsToTime = useCallback(
    (pixels: number) => {
      if (pixelsPerSecond <= 0) {
        console.warn('pixelsPerSecond is zero or negative, returning 0');
        return 0;
      }
      return pixels / pixelsPerSecond;
    },
    [pixelsPerSecond]
  );

  /**
   * Convert frame number to pixels
   */
  const frameToPixels = useCallback(
    (frame: number) => {
      const timeInSeconds = frame / fps;
      return timeToPixels(timeInSeconds);
    },
    [fps, timeToPixels]
  );

  /**
   * Convert pixels to frame number
   */
  const pixelsToFrame = useCallback(
    (pixels: number) => {
      const timeInSeconds = pixelsToTime(pixels);
      return Math.round(timeInSeconds * fps);
    },
    [fps, pixelsToTime]
  );

  /**
   * Reset zoom to 1x
   */
  const resetZoom = useCallback(() => {
    setZoomLevel(1);
  }, [setZoomLevel]);

  return {
    zoomLevel,
    pixelsPerSecond,
    timeToPixels,
    pixelsToTime,
    frameToPixels,
    pixelsToFrame,
    zoomIn: zoomInAction, // Direct reference - store actions are stable
    zoomOut: zoomOutAction, // Direct reference - store actions are stable
    resetZoom,
    setZoom: (level: number) => setZoomLevel(Math.max(minZoom, Math.min(maxZoom, level))),
  };
}
