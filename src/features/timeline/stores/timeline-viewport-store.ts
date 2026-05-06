import { create } from 'zustand'

interface TimelineViewportMeasurements {
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

interface TimelineViewportState extends TimelineViewportMeasurements {
  pendingScrollToFrame: number | null
}

interface TimelineViewportActions {
  setViewport: (next: TimelineViewportMeasurements) => void
  /** Request the timeline container to scroll so `frame` is visible. */
  requestScrollToFrame: (frame: number) => void
  clearScrollToFrame: () => void
}

const EPSILON = 0.5

/**
 * Throttle interval for scroll-only viewport updates. Viewport size changes
 * (resize) always apply immediately; scroll position updates are batched to
 * cut subscriber churn (useClipVisibility, useVisibleItems, etc.) from 60/s
 * to ~20/s. Filmstrip rendering keeps a minimum ~600px overscan window so the
 * throttled viewport can lag briefly without exposing blank leading/trailing edges.
 */
const SCROLL_THROTTLE_MS = 50
let lastScrollUpdate = 0
let pendingViewport: TimelineViewportState | null = null
let viewportThrottleTimeout: ReturnType<typeof setTimeout> | null = null

/** Reset throttle state — for tests only. */
export function _resetViewportThrottle() {
  lastScrollUpdate = 0
  pendingViewport = null
  if (viewportThrottleTimeout) {
    clearTimeout(viewportThrottleTimeout)
    viewportThrottleTimeout = null
  }
}

function isOnlyScrollChange(
  prev: TimelineViewportMeasurements,
  next: TimelineViewportMeasurements,
): boolean {
  return (
    Math.abs(prev.viewportWidth - next.viewportWidth) <= EPSILON &&
    Math.abs(prev.viewportHeight - next.viewportHeight) <= EPSILON
  )
}

function hasMeaningfulChange(
  prev: TimelineViewportMeasurements,
  next: TimelineViewportMeasurements,
): boolean {
  return (
    Math.abs(prev.scrollLeft - next.scrollLeft) > EPSILON ||
    Math.abs(prev.scrollTop - next.scrollTop) > EPSILON ||
    Math.abs(prev.viewportWidth - next.viewportWidth) > EPSILON ||
    Math.abs(prev.viewportHeight - next.viewportHeight) > EPSILON
  )
}

export const useTimelineViewportStore = create<TimelineViewportState & TimelineViewportActions>()(
  (set, get) => ({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
    pendingScrollToFrame: null,
    requestScrollToFrame: (frame: number) => set({ pendingScrollToFrame: frame }),
    clearScrollToFrame: () => set({ pendingScrollToFrame: null }),
    setViewport: (next) => {
      const current = get()
      if (!hasMeaningfulChange(current, next)) {
        return
      }

      // Viewport size changes (resize) always apply immediately
      if (!isOnlyScrollChange(current, next)) {
        lastScrollUpdate = performance.now()
        pendingViewport = null
        if (viewportThrottleTimeout) {
          clearTimeout(viewportThrottleTimeout)
          viewportThrottleTimeout = null
        }
        set(next)
        return
      }

      // Scroll-only: throttle to SCROLL_THROTTLE_MS to reduce subscriber churn
      const now = performance.now()
      pendingViewport = { ...next, pendingScrollToFrame: current.pendingScrollToFrame }

      if (now - lastScrollUpdate >= SCROLL_THROTTLE_MS) {
        lastScrollUpdate = now
        pendingViewport = null
        set(next)
        return
      }

      if (!viewportThrottleTimeout) {
        viewportThrottleTimeout = setTimeout(
          () => {
            viewportThrottleTimeout = null
            if (pendingViewport) {
              lastScrollUpdate = performance.now()
              const pending = pendingViewport
              pendingViewport = null
              set(pending)
            }
          },
          SCROLL_THROTTLE_MS - (now - lastScrollUpdate),
        )
      }
    },
  }),
)
