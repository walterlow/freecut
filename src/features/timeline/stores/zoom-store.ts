import { create } from 'zustand';

interface ZoomState {
  level: number;
  pixelsPerSecond: number;
}

interface ZoomActions {
  setZoomLevel: (level: number) => void;
  setZoomLevelImmediate: (level: number) => void; // Bypasses throttle for smooth momentum zoom
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (containerWidth: number, contentDurationSeconds: number) => void;
}

// Throttle zoom updates to reduce re-render frequency during rapid zoom
// Set to 50ms to match typical render time - prevents queueing renders faster than they complete
const ZOOM_THROTTLE_MS = 50;
let lastZoomUpdate = 0;
let pendingZoomLevel: number | null = null;
let zoomThrottleTimeout: ReturnType<typeof setTimeout> | null = null;

export const useZoomStore = create<ZoomState & ZoomActions>((set) => ({
  level: 1,
  pixelsPerSecond: 100,

  setZoomLevel: (level) => {
    const now = performance.now();
    pendingZoomLevel = level;

    // If enough time has passed, update immediately
    if (now - lastZoomUpdate >= ZOOM_THROTTLE_MS) {
      lastZoomUpdate = now;
      set({ level, pixelsPerSecond: level * 100 });
      pendingZoomLevel = null;
      return;
    }

    // Otherwise, schedule update for next throttle window
    if (!zoomThrottleTimeout) {
      zoomThrottleTimeout = setTimeout(() => {
        zoomThrottleTimeout = null;
        if (pendingZoomLevel !== null) {
          lastZoomUpdate = performance.now();
          set({ level: pendingZoomLevel, pixelsPerSecond: pendingZoomLevel * 100 });
          pendingZoomLevel = null;
        }
      }, ZOOM_THROTTLE_MS - (now - lastZoomUpdate));
    }
  },

  // Immediate zoom update - bypasses throttle for synchronized scroll calculations
  setZoomLevelImmediate: (level) => {
    // Clear any pending throttled update
    if (zoomThrottleTimeout) {
      clearTimeout(zoomThrottleTimeout);
      zoomThrottleTimeout = null;
    }
    pendingZoomLevel = null;
    lastZoomUpdate = performance.now();
    set({ level, pixelsPerSecond: level * 100 });
  },
  zoomIn: () =>
    set((state) => {
      const newLevel = Math.min(state.level * 1.1, 50); // 10% per step for finer control
      return { level: newLevel, pixelsPerSecond: newLevel * 100 };
    }),
  zoomOut: () =>
    set((state) => {
      const newLevel = Math.max(state.level / 1.1, 0.01);
      return { level: newLevel, pixelsPerSecond: newLevel * 100 };
    }),
  zoomToFit: (containerWidth, contentDurationSeconds) => {
    // Calculate zoom level needed to fit content in viewport
    // pixelsPerSecond = zoomLevel * 100
    // contentWidth = contentDuration * pixelsPerSecond = contentDuration * zoomLevel * 100
    // We want: contentWidth = containerWidth (with some padding)
    // So: zoomLevel = containerWidth / (contentDuration * 100)
    const padding = 50; // Leave some padding on the right
    const targetWidth = containerWidth - padding;
    const duration = Math.max(10, contentDurationSeconds); // Minimum 10 seconds
    const newLevel = Math.max(0.01, Math.min(2, targetWidth / (duration * 100)));
    set({ level: newLevel, pixelsPerSecond: newLevel * 100 });
  },
}));

// Non-reactive handler registration — avoids unnecessary subscriber notifications
let _zoomTo100Handler: ((centerFrame: number) => void) | null = null;

export function registerZoomTo100(handler: ((centerFrame: number) => void) | null) {
  _zoomTo100Handler = handler;
}

export function getZoomTo100Handler() {
  return _zoomTo100Handler;
}
