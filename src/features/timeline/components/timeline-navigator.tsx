import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTimelineViewportStore } from '../stores/timeline-viewport-store';
import { useTimelineStore } from '../stores/timeline-store';
import { useZoomStore } from '../stores/zoom-store';
import { cn } from '@/shared/ui/cn';
import { getNavigatorResizeDragResult, getNavigatorThumbMetrics } from './timeline-navigator-utils';

interface TimelineNavigatorProps {
  actualDuration: number;
  timelineWidth: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

type DragTarget = 'thumb' | 'left' | 'right';

export function TimelineNavigator({
  actualDuration,
  timelineWidth,
  scrollContainerRef,
}: TimelineNavigatorProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollAfterZoomRafRef = useRef<number | null>(null);
  const fps = useTimelineStore((s) => s.fps);
  const setZoomImmediate = useZoomStore((s) => s.setZoomLevelImmediate);
  const scrollLeft = useTimelineViewportStore((s) => s.scrollLeft);
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth);

  const [trackWidth, setTrackWidth] = useState(0);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);

  const maxFrame = useTimelineStore((s) =>
    s.items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  );

  const contentDuration = useMemo(() => {
    const furthestEndSeconds = maxFrame / fps;
    return Math.max(actualDuration, furthestEndSeconds, 10);
  }, [actualDuration, fps, maxFrame]);

  const { maxScrollLeft, thumbWidth, thumbTravel, thumbLeft } = getNavigatorThumbMetrics({
    timelineWidth,
    viewportWidth,
    trackWidth,
    scrollLeft,
  });

  const metricsRef = useRef({
    thumbTravel,
    maxScrollLeft,
    thumbWidth,
    thumbLeft,
    viewportWidth,
    contentDuration,
  });
  metricsRef.current = {
    thumbTravel,
    maxScrollLeft,
    thumbWidth,
    thumbLeft,
    viewportWidth,
    contentDuration,
  };

  const setScrollLeftOnContainer = useCallback((nextScrollLeft: number) => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollLeft = nextScrollLeft;
  }, [scrollContainerRef]);

  const dragSessionRef = useRef<{
    target: DragTarget;
    pointerId: number;
    captureEl: HTMLElement;
    startClientX: number;
    startThumbLeft: number;
    startThumbWidth: number;
  } | null>(null);

  const activePointerListenersRef = useRef<{
    onMove: (event: PointerEvent) => void;
    onUp: (event: PointerEvent) => void;
  } | null>(null);

  const removePointerWindowListeners = useCallback(() => {
    const L = activePointerListenersRef.current;
    if (L) {
      window.removeEventListener('pointermove', L.onMove);
      window.removeEventListener('pointerup', L.onUp);
      window.removeEventListener('pointercancel', L.onUp);
      activePointerListenersRef.current = null;
    }
  }, []);

  const endPointerDrag = useCallback(() => {
    removePointerWindowListeners();
    const session = dragSessionRef.current;
    if (session) {
      try {
        session.captureEl.releasePointerCapture(session.pointerId);
      } catch {
        // capture may already be released
      }
      dragSessionRef.current = null;
    }
    setDragTarget(null);
  }, [removePointerWindowListeners]);

  const attachPointerDragListeners = useCallback(
    (session: NonNullable<typeof dragSessionRef.current>) => {
      removePointerWindowListeners();

      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== session.pointerId) return;

        const track = trackRef.current;
        if (!track) return;

        const nextTrackWidth = track.clientWidth;
        if (nextTrackWidth <= 0) return;

        const m = metricsRef.current;
        const deltaX = event.clientX - session.startClientX;

        if (session.target === 'thumb') {
          if (m.thumbTravel <= 0 || m.maxScrollLeft <= 0) return;
          const nextThumbLeft = Math.max(0, Math.min(m.thumbTravel, session.startThumbLeft + deltaX));
          const nextScrollLeft = (nextThumbLeft / m.thumbTravel) * m.maxScrollLeft;
          setScrollLeftOnContainer(nextScrollLeft);
          return;
        }

        if (m.contentDuration <= 0) return;

        const { nextZoom, nextScrollLeft } = getNavigatorResizeDragResult({
          dragTarget: session.target,
          deltaX,
          dragStartThumbLeft: session.startThumbLeft,
          dragStartThumbWidth: session.startThumbWidth,
          trackWidth: nextTrackWidth,
          viewportWidth: m.viewportWidth,
          contentDuration: m.contentDuration,
        });

        setZoomImmediate(nextZoom);

        if (scrollAfterZoomRafRef.current !== null) {
          cancelAnimationFrame(scrollAfterZoomRafRef.current);
        }
        scrollAfterZoomRafRef.current = requestAnimationFrame(() => {
          scrollAfterZoomRafRef.current = null;
          setScrollLeftOnContainer(nextScrollLeft);
        });
      };

      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== session.pointerId) return;
        endPointerDrag();
      };

      activePointerListenersRef.current = { onMove, onUp };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [endPointerDrag, removePointerWindowListeners, setScrollLeftOnContainer, setZoomImmediate]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, target: DragTarget) => {
      event.preventDefault();
      event.stopPropagation();

      const el = event.currentTarget;
      el.setPointerCapture(event.pointerId);

      const m = metricsRef.current;
      dragSessionRef.current = {
        target,
        pointerId: event.pointerId,
        captureEl: el,
        startClientX: event.clientX,
        startThumbLeft: m.thumbLeft,
        startThumbWidth: m.thumbWidth,
      };
      setDragTarget(target);
      attachPointerDragListeners(dragSessionRef.current);
    },
    [attachPointerDragListeners]
  );

  const handleTrackClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!trackRef.current || dragTarget || maxScrollLeft <= 0 || thumbTravel <= 0) {
        return;
      }

      const rect = trackRef.current.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const desiredThumbLeft = Math.max(0, Math.min(thumbTravel, clickX - thumbWidth / 2));
      const nextScrollLeft = (desiredThumbLeft / thumbTravel) * maxScrollLeft;
      setScrollLeftOnContainer(nextScrollLeft);
    },
    [dragTarget, maxScrollLeft, setScrollLeftOnContainer, thumbTravel, thumbWidth]
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    setTrackWidth(track.clientWidth);

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setTrackWidth(entry.contentRect.width);
      }
    });

    observer.observe(track);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrollAfterZoomRafRef.current !== null) {
        cancelAnimationFrame(scrollAfterZoomRafRef.current);
      }
      endPointerDrag();
    };
  }, [endPointerDrag]);

  return (
    <div className="h-6 border-t border-border bg-background/80 px-2 py-1 md:h-5">
      <div
        ref={trackRef}
        className="relative h-full rounded-sm bg-secondary/70"
        onClick={handleTrackClick}
      >
        <div
          className={cn(
            'absolute top-0 flex h-full touch-none items-center justify-between rounded-sm bg-muted-foreground/55 transition-colors',
            dragTarget ? 'cursor-grabbing bg-muted-foreground/75' : 'cursor-grab hover:bg-muted-foreground/70'
          )}
          style={{
            left: thumbLeft,
            width: thumbWidth,
          }}
          onPointerDown={(event) => handlePointerDown(event, 'thumb')}
          onClick={(event) => event.stopPropagation()}
          data-testid="timeline-navigator-thumb"
        >
          <div
            className="flex h-full w-3 cursor-ew-resize items-center justify-center touch-none"
            onPointerDown={(event) => handlePointerDown(event, 'left')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
          <div className="h-2 w-8 rounded-full bg-background/20" />
          <div
            className="flex h-full w-3 cursor-ew-resize items-center justify-center touch-none"
            onPointerDown={(event) => handlePointerDown(event, 'right')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
        </div>
      </div>
    </div>
  );
}
