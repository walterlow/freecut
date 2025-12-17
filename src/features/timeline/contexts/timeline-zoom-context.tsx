/**
 * Timeline Zoom Utilities
 *
 * Provides zoom-related values and helper functions for timeline components.
 * Uses Zustand stores directly - no context needed since Zustand already
 * optimizes for multiple subscriptions to the same selectors.
 */

import { useMemo } from 'react';
import { useZoomStore } from '../stores/zoom-store';
import { useTimelineStore } from '../stores/timeline-store';

interface TimelineZoomValue {
  zoomLevel: number;
  pixelsPerSecond: number;
  timeToPixels: (timeInSeconds: number) => number;
  pixelsToTime: (pixels: number) => number;
  frameToPixels: (frame: number) => number;
  pixelsToFrame: (pixels: number) => number;
  fps: number;
}

/**
 * Hook to get timeline zoom values and helper functions.
 * Reads directly from Zustand stores.
 */
export function useTimelineZoomContext(): TimelineZoomValue {
  const zoomLevel = useZoomStore((s) => s.level);
  const fps = useTimelineStore((s) => s.fps);
  const pixelsPerSecond = zoomLevel * 100;

  return useMemo(() => ({
    zoomLevel,
    pixelsPerSecond,
    fps,
    timeToPixels: (t: number) => t * pixelsPerSecond,
    pixelsToTime: (p: number) => pixelsPerSecond > 0 ? p / pixelsPerSecond : 0,
    frameToPixels: (f: number) => (f / fps) * pixelsPerSecond,
    pixelsToFrame: (p: number) => Math.round((p / pixelsPerSecond) * fps),
  }), [zoomLevel, pixelsPerSecond, fps]);
}
