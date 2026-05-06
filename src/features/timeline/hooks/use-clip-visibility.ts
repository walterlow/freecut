import { useEffect, useState } from 'react'
import { useTimelineViewportStore } from '../stores/timeline-viewport-store'
import { useZoomStore } from '../stores/zoom-store'

/**
 * Pixels of margin beyond the viewport for considering a clip "visible".
 * Increased from 200 to 600 to absorb the 50ms viewport store throttle —
 * at fast scroll speeds (~200px/frame × 3 frames), tiles stay pre-rendered
 * 600px ahead, preventing blank flashes at the leading edge.
 */
const PREFETCH_MARGIN_PX = 600
const RATIO_EPSILON = 0.002

/** Stable reference returned during zoom interaction to avoid per-clip re-renders. */
const FULLY_VISIBLE: ClipVisibilityState = {
  isVisible: true,
  visibleStartRatio: 0,
  visibleEndRatio: 1,
}

export interface ClipVisibilityState {
  isVisible: boolean
  visibleStartRatio: number
  visibleEndRatio: number
}

/**
 * Hook to detect when a timeline clip is visible in the shared timeline viewport.
 * Uses clip geometry in timeline-content coordinates (left/width) and avoids
 * per-clip scroll listeners/observers.
 *
 * During zoom interaction, clip pixel positions are in the "settled" coordinate
 * space (contentPixelsPerSecond) while the viewport scroll uses the live zoom.
 * This coordinate space mismatch would cause visible clips to be marked invisible,
 * so we force `isVisible: true` while zooming.  The `isZoomInteracting` selector
 * only transitions twice per gesture (start → end), so this does NOT cause
 * per-tick re-renders.
 */
export function useClipVisibility(clipLeftPx: number, clipWidthPx: number): ClipVisibilityState {
  // Only re-renders on false→true and true→false transitions (not every tick)
  const isZoomInteracting = useZoomStore((s) => s.isZoomInteracting)

  const [visibility, setVisibility] = useState<ClipVisibilityState>(() => {
    if (useZoomStore.getState().isZoomInteracting) return FULLY_VISIBLE
    const viewport = useTimelineViewportStore.getState()
    return computeVisibility(viewport, clipLeftPx, clipWidthPx)
  })

  useEffect(() => {
    const apply = (viewport: TimelineViewportSnapshot) => {
      // During zoom, clip pixel positions (settled pps) and viewport scroll
      // (live pps) are in different coordinate spaces — skip the check.
      if (useZoomStore.getState().isZoomInteracting) {
        setVisibility((prev) => (prev.isVisible ? prev : FULLY_VISIBLE))
        return
      }

      const next = computeVisibility(viewport, clipLeftPx, clipWidthPx)
      setVisibility((prev) => {
        if (
          prev.isVisible === next.isVisible &&
          Math.abs(prev.visibleStartRatio - next.visibleStartRatio) < RATIO_EPSILON &&
          Math.abs(prev.visibleEndRatio - next.visibleEndRatio) < RATIO_EPSILON
        ) {
          return prev
        }
        return next
      })
    }

    apply(useTimelineViewportStore.getState())
    const unsubViewport = useTimelineViewportStore.subscribe(apply)
    // Recompute when zoom interaction ends — the FULLY_VISIBLE override
    // leaves stale ratios that won't refresh until the next viewport change.
    const unsubZoom = useZoomStore.subscribe((curr, prev) => {
      if (prev.isZoomInteracting && !curr.isZoomInteracting) {
        apply(useTimelineViewportStore.getState())
      }
    })
    return () => {
      unsubViewport()
      unsubZoom()
    }
  }, [clipLeftPx, clipWidthPx])

  // Force visible during zoom — coordinate spaces are mismatched
  if (isZoomInteracting) return FULLY_VISIBLE

  return visibility
}

interface TimelineViewportSnapshot {
  scrollLeft: number
  scrollTop: number
  viewportWidth: number
  viewportHeight: number
}

function computeVisibility(
  viewport: TimelineViewportSnapshot,
  clipLeftPx: number,
  clipWidthPx: number,
  prefetchMarginPx = PREFETCH_MARGIN_PX,
): ClipVisibilityState {
  if (clipWidthPx <= 0 || viewport.viewportWidth <= 0) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const viewLeft = viewport.scrollLeft - prefetchMarginPx
  const viewRight = viewport.scrollLeft + viewport.viewportWidth + prefetchMarginPx
  const clipRightPx = clipLeftPx + clipWidthPx

  const overlapLeft = Math.max(clipLeftPx, viewLeft)
  const overlapRight = Math.min(clipRightPx, viewRight)
  const isVisible = overlapRight > overlapLeft

  if (!isVisible) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    }
  }

  const startRatio = Math.max(0, Math.min(1, (overlapLeft - clipLeftPx) / clipWidthPx))
  const endRatio = Math.max(startRatio, Math.min(1, (overlapRight - clipLeftPx) / clipWidthPx))

  return {
    isVisible: true,
    visibleStartRatio: startRatio,
    visibleEndRatio: endRatio,
  }
}
