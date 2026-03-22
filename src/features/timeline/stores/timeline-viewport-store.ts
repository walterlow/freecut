import { create } from 'zustand';

interface TimelineViewportState {
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface TimelineViewportActions {
  setViewport: (next: TimelineViewportState) => void;
}

const EPSILON = 0.5;

/**
 * Throttle interval for scroll-only viewport updates. Viewport size changes
 * (resize) always apply immediately; scroll position updates are batched to
 * cut subscriber churn (useClipVisibility, useVisibleItems, etc.) from 60/s
 * to ~20/s. The filmstrip viewport padding (VIEWPORT_PAD_TILES = 2, ~170px)
 * absorbs the 50ms latency at typical scroll speeds without visual gaps.
 */
const SCROLL_THROTTLE_MS = 50;
let lastScrollUpdate = 0;
let pendingViewport: TimelineViewportState | null = null;
let viewportThrottleTimeout: ReturnType<typeof setTimeout> | null = null;

/** Reset throttle state — for tests only. */
export function _resetViewportThrottle() {
  lastScrollUpdate = 0;
  pendingViewport = null;
  if (viewportThrottleTimeout) {
    clearTimeout(viewportThrottleTimeout);
    viewportThrottleTimeout = null;
  }
}

function isOnlyScrollChange(prev: TimelineViewportState, next: TimelineViewportState): boolean {
  return Math.abs(prev.viewportWidth - next.viewportWidth) <= EPSILON
    && Math.abs(prev.viewportHeight - next.viewportHeight) <= EPSILON;
}

function hasMeaningfulChange(prev: TimelineViewportState, next: TimelineViewportState): boolean {
  return Math.abs(prev.scrollLeft - next.scrollLeft) > EPSILON
    || Math.abs(prev.scrollTop - next.scrollTop) > EPSILON
    || Math.abs(prev.viewportWidth - next.viewportWidth) > EPSILON
    || Math.abs(prev.viewportHeight - next.viewportHeight) > EPSILON;
}

export const useTimelineViewportStore = create<TimelineViewportState & TimelineViewportActions>()(
  (set, get) => ({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    setViewport: (next) => {
      const current = get();
      if (!hasMeaningfulChange(current, next)) {
        return;
      }

      // Viewport size changes (resize) always apply immediately
      if (!isOnlyScrollChange(current, next)) {
        lastScrollUpdate = performance.now();
        pendingViewport = null;
        if (viewportThrottleTimeout) {
          clearTimeout(viewportThrottleTimeout);
          viewportThrottleTimeout = null;
        }
        set(next);
        return;
      }

      // Scroll-only: throttle to SCROLL_THROTTLE_MS to reduce subscriber churn
      const now = performance.now();
      pendingViewport = next;

      if (now - lastScrollUpdate >= SCROLL_THROTTLE_MS) {
        lastScrollUpdate = now;
        pendingViewport = null;
        set(next);
        return;
      }

      if (!viewportThrottleTimeout) {
        viewportThrottleTimeout = setTimeout(() => {
          viewportThrottleTimeout = null;
          if (pendingViewport) {
            lastScrollUpdate = performance.now();
            const pending = pendingViewport;
            pendingViewport = null;
            set(pending);
          }
        }, SCROLL_THROTTLE_MS - (now - lastScrollUpdate));
      }
    },
  })
);

