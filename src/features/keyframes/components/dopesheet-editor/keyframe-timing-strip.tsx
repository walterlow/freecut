import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/shared/ui/cn';

import {
  getKeyframeNavigatorThumbMetrics,
  type KeyframeNavigatorViewport,
} from './compact-navigator-utils';

const DRAG_THRESHOLD_PX = 2;

interface KeyframeTimingStripMarker {
  id: string;
  frame: number;
  selected: boolean;
  draggable: boolean;
  label: string;
}

interface KeyframeTimingStripProps {
  viewport: KeyframeNavigatorViewport;
  contentFrameMax: number;
  markers: KeyframeTimingStripMarker[];
  previewFrames?: Record<string, number> | null;
  disabled?: boolean;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  onSlideStart?: (selectedIds: string[]) => void;
  onSlideChange?: (deltaFrames: number, selectedIds: string[]) => void;
  onSlideEnd?: (selectedIds: string[]) => void;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  started: boolean;
  selectedIds: string[];
}

function getMarkerLeft(
  frame: number,
  metrics: ReturnType<typeof getKeyframeNavigatorThumbMetrics>
): number {
  const maxFrame = Math.max(1, metrics.contentFrameMax - 1);
  return Math.max(
    metrics.edgeInset,
    Math.min(
      metrics.edgeInset + metrics.usableTrackWidth,
      metrics.edgeInset + (Math.max(0, Math.min(maxFrame, frame)) / maxFrame) * metrics.usableTrackWidth
    )
  );
}

export function KeyframeTimingStrip({
  viewport,
  contentFrameMax,
  markers,
  previewFrames = null,
  disabled = false,
  onSelectionChange,
  onSlideStart,
  onSlideChange,
  onSlideEnd,
}: KeyframeTimingStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  const metrics = getKeyframeNavigatorThumbMetrics({
    viewport,
    contentFrameMax,
    trackWidth,
    minThumbWidth: 0,
  });

  const renderedMarkers = useMemo(
    () =>
      markers.map((marker) => ({
        ...marker,
        frame: previewFrames?.[marker.id] ?? marker.frame,
      })),
    [markers, previewFrames]
  );

  const handleMarkerPointerDown = useCallback(
    (markerId: string, isSelected: boolean) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const selectedIds = isSelected
        ? markers.filter((marker) => marker.selected).map((marker) => marker.id)
        : [markerId];

      onSelectionChange?.(new Set(selectedIds));
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        started: false,
        selectedIds,
      };
    },
    [disabled, markers, onSelectionChange]
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) {
      return;
    }

    const updateWidth = () => {
      setTrackWidth(track.clientWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId || metrics.usableTrackWidth <= 0) {
        return;
      }

      const deltaX = event.clientX - dragState.startClientX;
      if (!dragState.started && Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
        dragState.started = true;
        onSlideStart?.(dragState.selectedIds);
      }

      if (!dragState.started) {
        return;
      }

      const maxFrame = Math.max(1, metrics.contentFrameMax - 1);
      const deltaFrames = Math.round((deltaX / metrics.usableTrackWidth) * maxFrame);
      onSlideChange?.(deltaFrames, dragState.selectedIds);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current = null;
      if (dragState.started) {
        onSlideEnd?.(dragState.selectedIds);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [metrics.contentFrameMax, metrics.usableTrackWidth, onSlideChange, onSlideEnd, onSlideStart]);

  return (
    <div className="h-4 border-t border-border/60 bg-background/90 px-2 py-0.5">
      <div
        ref={trackRef}
        data-testid="keyframe-timing-strip-track"
        className={cn(
          'relative h-full rounded-sm bg-secondary/35',
          disabled && 'opacity-50'
        )}
      >
        <div
          className="pointer-events-none absolute inset-y-[1px] rounded-sm bg-muted-foreground/10"
          style={{
            left: metrics.thumbLeft,
            width: metrics.thumbWidth,
          }}
        />

        {renderedMarkers.map((marker) => {
          const left = getMarkerLeft(marker.frame, metrics);
          const markerStyle = {
            left,
            top: '50%',
          } as const;

          return (
            <button
              key={marker.id}
              type="button"
              data-testid={`keyframe-timing-strip-marker-${marker.id}`}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]',
                disabled
                  ? 'cursor-default'
                  : marker.draggable
                    ? 'cursor-ew-resize'
                    : 'cursor-pointer',
                marker.selected
                  ? 'h-3 w-3 rounded-[2px] border border-orange-200/70 bg-orange-500 rotate-45'
                  : 'h-2 w-2 rounded-full border border-muted-foreground/60 bg-muted-foreground/70'
              )}
              style={markerStyle}
              onPointerDown={handleMarkerPointerDown(marker.id, marker.selected)}
              title={marker.label}
              aria-label={marker.label}
            >
              <span className="sr-only">{marker.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
