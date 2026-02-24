import { useEffect, useState } from 'react';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';

const PREFETCH_MARGIN_PX = 200;
const RATIO_EPSILON = 0.002;

export interface ClipVisibilityState {
  isVisible: boolean;
  visibleStartRatio: number;
  visibleEndRatio: number;
}

/**
 * Hook to detect when a timeline clip is visible in the shared timeline viewport.
 * Uses clip geometry in timeline-content coordinates (left/width) and avoids
 * per-clip scroll listeners/observers.
 */
export function useClipVisibility(
  clipLeftPx: number,
  clipWidthPx: number
): ClipVisibilityState {
  const [visibility, setVisibility] = useState<ClipVisibilityState>(() => {
    const viewport = useTimelineViewportStore.getState();
    return computeVisibility(viewport, clipLeftPx, clipWidthPx);
  });

  useEffect(() => {
    const apply = (viewport: TimelineViewportSnapshot) => {
      const next = computeVisibility(viewport, clipLeftPx, clipWidthPx);
      setVisibility((prev) => {
        if (
          prev.isVisible === next.isVisible
          && Math.abs(prev.visibleStartRatio - next.visibleStartRatio) < RATIO_EPSILON
          && Math.abs(prev.visibleEndRatio - next.visibleEndRatio) < RATIO_EPSILON
        ) {
          return prev;
        }
        return next;
      });
    };

    apply(useTimelineViewportStore.getState());
    const unsubscribe = useTimelineViewportStore.subscribe(apply);
    return unsubscribe;
  }, [clipLeftPx, clipWidthPx]);

  return visibility;
}

interface TimelineViewportSnapshot {
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

function computeVisibility(
  viewport: TimelineViewportSnapshot,
  clipLeftPx: number,
  clipWidthPx: number
): ClipVisibilityState {
  if (clipWidthPx <= 0 || viewport.viewportWidth <= 0) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    };
  }

  const viewLeft = viewport.scrollLeft - PREFETCH_MARGIN_PX;
  const viewRight = viewport.scrollLeft + viewport.viewportWidth + PREFETCH_MARGIN_PX;
  const clipRightPx = clipLeftPx + clipWidthPx;

  const overlapLeft = Math.max(clipLeftPx, viewLeft);
  const overlapRight = Math.min(clipRightPx, viewRight);
  const isVisible = overlapRight > overlapLeft;

  if (!isVisible) {
    return {
      isVisible: false,
      visibleStartRatio: 0,
      visibleEndRatio: 1,
    };
  }

  const startRatio = Math.max(0, Math.min(1, (overlapLeft - clipLeftPx) / clipWidthPx));
  const endRatio = Math.max(startRatio, Math.min(1, (overlapRight - clipLeftPx) / clipWidthPx));

  return {
    isVisible: true,
    visibleStartRatio: startRatio,
    visibleEndRatio: endRatio,
  };
}
