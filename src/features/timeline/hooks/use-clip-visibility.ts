import { useEffect, useState, useRef, RefObject } from 'react';

const PREFETCH_MARGIN_PX = 200;

export interface ClipVisibilityState {
  isVisible: boolean;
  visibleStartRatio: number;
  visibleEndRatio: number;
}

/**
 * Hook to detect when a timeline clip becomes visible using IntersectionObserver
 *
 * Uses the timeline-container as the root element and adds 200px margin
 * for prefetching content before it becomes visible.
 */
export function useClipVisibility(clipRef: RefObject<HTMLElement | null>): ClipVisibilityState {
  const [visibility, setVisibility] = useState<ClipVisibilityState>({
    isVisible: false,
    visibleStartRatio: 0,
    visibleEndRatio: 1,
  });
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const element = clipRef.current;
    if (!element) return;

    // Find the timeline container as the root
    const timelineContainer = element.closest('.timeline-container');

    // Create observer with margin for prefetching
    observerRef.current = new IntersectionObserver(
      (entries) => {
        // We only observe one element, so take the first entry
        const entry = entries[0];
        if (entry) {
          const isVisible = entry.isIntersecting;
          if (!isVisible) {
            setVisibility((prev) => {
              if (!prev.isVisible) return prev;
              return {
                isVisible: false,
                visibleStartRatio: 0,
                visibleEndRatio: 1,
              };
            });
            return;
          }

          const clipRect = entry.boundingClientRect;
          const intersectionRect = entry.intersectionRect;
          const width = clipRect.width;

          let startRatio = 0;
          let endRatio = 1;

          if (width > 0) {
            const startPx = Math.max(0, Math.min(width, intersectionRect.left - clipRect.left));
            const endPx = Math.max(startPx, Math.min(width, intersectionRect.right - clipRect.left));
            startRatio = Math.max(0, Math.min(1, startPx / width));
            endRatio = Math.max(startRatio, Math.min(1, endPx / width));
          }

          setVisibility((prev) => {
            if (
              prev.isVisible === true
              && Math.abs(prev.visibleStartRatio - startRatio) < 0.002
              && Math.abs(prev.visibleEndRatio - endRatio) < 0.002
            ) {
              return prev;
            }
            return {
              isVisible: true,
              visibleStartRatio: startRatio,
              visibleEndRatio: endRatio,
            };
          });
        }
      },
      {
        root: timelineContainer || null, // Use viewport if container not found
        rootMargin: `0px ${PREFETCH_MARGIN_PX}px`, // horizontal margin for prefetching
        threshold: 0, // Trigger as soon as any part is visible
      }
    );

    observerRef.current.observe(element);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [clipRef]);

  // Keep visible range ratios in sync during scroll while clip is visible.
  // IntersectionObserver with threshold=0 is coarse and can leave stale ratios.
  useEffect(() => {
    if (!visibility.isVisible) return;

    const element = clipRef.current;
    if (!element) return;

    const timelineContainer = element.closest('.timeline-container') as HTMLElement | null;
    let rafId: number | null = null;

    const measure = () => {
      const currentElement = clipRef.current;
      if (!currentElement) return;

      const clipRect = currentElement.getBoundingClientRect();
      const rootRect = timelineContainer
        ? timelineContainer.getBoundingClientRect()
        : {
          left: 0,
          right: window.innerWidth,
          top: 0,
          bottom: window.innerHeight,
        };

      const rootLeft = rootRect.left - PREFETCH_MARGIN_PX;
      const rootRight = rootRect.right + PREFETCH_MARGIN_PX;
      const overlapLeft = Math.max(clipRect.left, rootLeft);
      const overlapRight = Math.min(clipRect.right, rootRight);
      const overlapTop = Math.max(clipRect.top, rootRect.top);
      const overlapBottom = Math.min(clipRect.bottom, rootRect.bottom);

      const isVisible = overlapRight > overlapLeft && overlapBottom > overlapTop;
      if (!isVisible) {
        setVisibility((prev) => {
          if (!prev.isVisible) return prev;
          return {
            isVisible: false,
            visibleStartRatio: 0,
            visibleEndRatio: 1,
          };
        });
        return;
      }

      const width = clipRect.width;
      let startRatio = 0;
      let endRatio = 1;
      if (width > 0) {
        const startPx = Math.max(0, Math.min(width, overlapLeft - clipRect.left));
        const endPx = Math.max(startPx, Math.min(width, overlapRight - clipRect.left));
        startRatio = Math.max(0, Math.min(1, startPx / width));
        endRatio = Math.max(startRatio, Math.min(1, endPx / width));
      }

      setVisibility((prev) => {
        if (
          prev.isVisible
          && Math.abs(prev.visibleStartRatio - startRatio) < 0.002
          && Math.abs(prev.visibleEndRatio - endRatio) < 0.002
        ) {
          return prev;
        }
        return {
          isVisible: true,
          visibleStartRatio: startRatio,
          visibleEndRatio: endRatio,
        };
      });
    };

    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    const rootForScroll: Window | HTMLElement = timelineContainer ?? window;
    rootForScroll.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(element);
    if (timelineContainer) {
      resizeObserver.observe(timelineContainer);
    }

    scheduleMeasure();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rootForScroll.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
      resizeObserver.disconnect();
    };
  }, [clipRef, visibility.isVisible]);

  return visibility;
}
