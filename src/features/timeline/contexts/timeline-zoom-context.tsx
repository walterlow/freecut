/**
 * Timeline Zoom Context
 *
 * Centralizes zoom state for the timeline subtree to prevent
 * multiple independent store subscriptions from causing parallel re-renders.
 *
 * Instead of each component subscribing to the zoom store independently,
 * this context provides a single subscription point. All consumers update
 * in a single batched render cycle.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useZoomStore } from '../stores/zoom-store';
import { useTimelineStore } from '../stores/timeline-store';

interface TimelineZoomContextValue {
  /** Current zoom level */
  zoomLevel: number;
  /** Pixels per second at current zoom */
  pixelsPerSecond: number;
  /** Convert time in seconds to pixels */
  timeToPixels: (timeInSeconds: number) => number;
  /** Convert pixels to time in seconds */
  pixelsToTime: (pixels: number) => number;
  /** Convert frame number to pixels */
  frameToPixels: (frame: number) => number;
  /** Convert pixels to frame number */
  pixelsToFrame: (pixels: number) => number;
  /** FPS from timeline settings */
  fps: number;
}

// Default values used during HMR/error boundary recovery
// These are reasonable defaults that won't cause crashes
const DEFAULT_FPS = 30;
const DEFAULT_PPS = 100;

const defaultValue: TimelineZoomContextValue = {
  zoomLevel: 1,
  pixelsPerSecond: DEFAULT_PPS,
  fps: DEFAULT_FPS,
  timeToPixels: (t: number) => t * DEFAULT_PPS,
  pixelsToTime: (p: number) => p / DEFAULT_PPS,
  frameToPixels: (f: number) => (f / DEFAULT_FPS) * DEFAULT_PPS,
  pixelsToFrame: (p: number) => Math.round((p / DEFAULT_PPS) * DEFAULT_FPS),
};

const TimelineZoomContext = createContext<TimelineZoomContextValue>(defaultValue);

interface TimelineZoomProviderProps {
  children: ReactNode;
}

/**
 * Provider that wraps timeline components and provides zoom values.
 * Single subscription point prevents multiple independent store subscriptions.
 */
export function TimelineZoomProvider({ children }: TimelineZoomProviderProps) {
  // Single subscription to zoom store
  const zoomLevel = useZoomStore((s) => s.level);
  const fps = useTimelineStore((s) => s.fps);
  const pixelsPerSecond = zoomLevel * 100;

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<TimelineZoomContextValue>(() => ({
    zoomLevel,
    pixelsPerSecond,
    fps,
    timeToPixels: (timeInSeconds: number) => timeInSeconds * pixelsPerSecond,
    pixelsToTime: (pixels: number) => pixelsPerSecond > 0 ? pixels / pixelsPerSecond : 0,
    frameToPixels: (frame: number) => (frame / fps) * pixelsPerSecond,
    pixelsToFrame: (pixels: number) => Math.round((pixels / pixelsPerSecond) * fps),
  }), [zoomLevel, pixelsPerSecond, fps]);

  return (
    <TimelineZoomContext.Provider value={value}>
      {children}
    </TimelineZoomContext.Provider>
  );
}

/**
 * Hook to consume timeline zoom context.
 * Always returns a value - uses defaults during HMR/error recovery.
 */
export function useTimelineZoomContext(): TimelineZoomContextValue {
  return useContext(TimelineZoomContext);
}
