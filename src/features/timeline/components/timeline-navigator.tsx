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

type DragTarget = 'thumb' | 'left' | 'right' | null;

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
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartThumbLeft, setDragStartThumbLeft] = useState(0);
  const [dragStartThumbWidth, setDragStartThumbWidth] = useState(0);

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

  const setScrollLeftOnContainer = useCallback((nextScrollLeft: number) => {
    const node = scrollContainerRef.current;
    if (!node) return;
    node.scrollLeft = nextScrollLeft;
  }, [scrollContainerRef]);

  const handleMouseDown = useCallback((event: React.MouseEvent, target: Exclude<DragTarget, null>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(target);
    setDragStartX(event.clientX);
    setDragStartThumbLeft(thumbLeft);
    setDragStartThumbWidth(thumbWidth);
  }, [thumbLeft, thumbWidth]);

  const handleTrackClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || dragTarget || maxScrollLeft <= 0 || thumbTravel <= 0) {
      return;
    }

    const rect = trackRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const desiredThumbLeft = Math.max(0, Math.min(thumbTravel, clickX - thumbWidth / 2));
    const nextScrollLeft = (desiredThumbLeft / thumbTravel) * maxScrollLeft;
    setScrollLeftOnContainer(nextScrollLeft);
  }, [dragTarget, maxScrollLeft, setScrollLeftOnContainer, thumbTravel, thumbWidth]);

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
    };
  }, []);

  useEffect(() => {
    if (!dragTarget) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!trackRef.current) return;

      const nextTrackWidth = trackRef.current.clientWidth;
      if (nextTrackWidth <= 0) return;

      const deltaX = event.clientX - dragStartX;

      if (dragTarget === 'thumb') {
        if (thumbTravel <= 0 || maxScrollLeft <= 0) return;
        const nextThumbLeft = Math.max(0, Math.min(thumbTravel, dragStartThumbLeft + deltaX));
        const nextScrollLeft = (nextThumbLeft / thumbTravel) * maxScrollLeft;
        setScrollLeftOnContainer(nextScrollLeft);
        return;
      }

      if (contentDuration <= 0) return;

      const { nextZoom, nextScrollLeft } = getNavigatorResizeDragResult({
        dragTarget,
        deltaX,
        dragStartThumbLeft,
        dragStartThumbWidth,
        trackWidth: nextTrackWidth,
        viewportWidth,
        contentDuration,
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

    const handleMouseUp = () => {
      setDragTarget(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    contentDuration,
    dragStartThumbLeft,
    dragStartThumbWidth,
    dragStartX,
    dragTarget,
    maxScrollLeft,
    setZoomImmediate,
    setScrollLeftOnContainer,
    thumbTravel,
    viewportWidth,
  ]);

  return (
    <div className="h-5 border-t border-border bg-background/80 px-2 py-1">
      <div
        ref={trackRef}
        className="relative h-full rounded-sm bg-secondary/70"
        onClick={handleTrackClick}
      >
        <div
          className={cn(
            'absolute top-0 flex h-full items-center justify-between rounded-sm bg-muted-foreground/55 transition-colors',
            dragTarget ? 'cursor-grabbing bg-muted-foreground/75' : 'cursor-grab hover:bg-muted-foreground/70'
          )}
          style={{
            left: thumbLeft,
            width: thumbWidth,
          }}
          onMouseDown={(event) => handleMouseDown(event, 'thumb')}
          onClick={(event) => event.stopPropagation()}
          data-testid="timeline-navigator-thumb"
        >
          <div
            className="flex h-full w-3 items-center justify-center cursor-ew-resize"
            onMouseDown={(event) => handleMouseDown(event, 'left')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
          <div className="h-2 w-8 rounded-full bg-background/20" />
          <div
            className="flex h-full w-3 items-center justify-center cursor-ew-resize"
            onMouseDown={(event) => handleMouseDown(event, 'right')}
          >
            <div className="h-1.5 w-1.5 rounded-full bg-background/90" />
          </div>
        </div>
      </div>
    </div>
  );
}
