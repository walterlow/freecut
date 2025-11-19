import { useMemo, useRef, useEffect, useState, useCallback } from 'react';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';

// Hooks
import { useMarqueeSelection } from '@/hooks/use-marquee-selection';

// Components
import { TimelineMarkers } from './timeline-markers';
import { TimelinePlayhead } from './timeline-playhead';
import { TimelineTrack } from './timeline-track';
import { MarqueeOverlay } from '@/components/marquee-overlay';

export interface TimelineContentProps {
  duration: number; // Total timeline duration in seconds
  scrollRef?: React.RefObject<HTMLDivElement | null>; // Optional ref for scroll syncing
}

/**
 * Timeline Content Component
 *
 * Main timeline rendering area that composes:
 * - TimelineMarkers (time ruler)
 * - TimelinePlayhead (in ruler)
 * - TimelineTracks (all tracks with items)
 * - TimelinePlayhead (through tracks)
 *
 * Dynamically calculates width based on furthest item
 */
export function TimelineContent({ duration, scrollRef }: TimelineContentProps) {
  // Use granular selectors - Zustand v5 best practice
  const tracks = useTimelineStore((s) => s.tracks);
  const items = useTimelineStore((s) => s.items);
  const fps = useTimelineStore((s) => s.fps);
  const { timeToPixels, pixelsToTime, frameToPixels, setZoom, zoomLevel } = useTimelineZoom({
    minZoom: 0.01,
    maxZoom: 2, // Match slider range
  });
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const selectItems = useSelectionStore((s) => s.selectItems);
  const clearItemSelection = useSelectionStore((s) => s.clearItemSelection);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const marqueeWasActiveRef = useRef(false);

  // Merge external scrollRef with internal containerRef
  const mergedRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (scrollRef) {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }
  }, [scrollRef]);

  // Measure container width - run after render and on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    // Measure immediately
    updateWidth();

    // Also measure after a short delay to ensure DOM is ready
    const timer = setTimeout(updateWidth, 0);

    // Measure on resize
    window.addEventListener('resize', updateWidth);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  // Also remeasure when items change (timeline might resize)
  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.clientWidth;
      if (width > 0 && width !== containerWidth) {
        setContainerWidth(width);
      }
    }
  }, [items, containerWidth]);

  // Marquee selection - create items array for getBoundingRect lookups
  const marqueeItems = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        getBoundingRect: () => {
          const element = document.querySelector(`[data-item-id="${item.id}"]`);
          if (!element) {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
          }
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        },
      })),
    [items]
  );

  // Marquee selection hook
  const { marqueeState } = useMarqueeSelection({
    containerRef: containerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    onSelectionChange: (ids) => {
      selectItems(ids);
    },
    enabled: true,
    threshold: 5,
  });

  // Track marquee state to prevent deselection after marquee release
  useEffect(() => {
    if (marqueeState.active) {
      marqueeWasActiveRef.current = true;
    } else if (marqueeWasActiveRef.current) {
      // Reset after a short delay when marquee ends
      const timeout = setTimeout(() => {
        marqueeWasActiveRef.current = false;
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [marqueeState.active]);

  // Click empty space to deselect items (but preserve track selection)
  const handleContainerClick = (e: React.MouseEvent) => {
    // Don't deselect if marquee selection just finished
    if (marqueeWasActiveRef.current) {
      return;
    }

    // Deselect items if NOT clicking on a timeline item
    const target = e.target as HTMLElement;
    const clickedOnItem = target.closest('[data-item-id]');

    if (!clickedOnItem) {
      clearItemSelection();
    }
  };

  // Calculate the actual timeline duration and width based on content
  const { actualDuration, timelineWidth } = useMemo(() => {
    // Find the furthest item end position
    const furthestItemEnd = items.reduce((max, item) => {
      const itemEnd = (item.from + item.durationInFrames) / fps; // Convert to seconds
      return Math.max(max, itemEnd);
    }, duration); // Use duration as minimum

    // Calculate how much duration the viewport represents
    // Use measured containerWidth or fallback to 1920px (typical desktop width)
    const effectiveContainerWidth = containerWidth > 0 ? containerWidth : 1920;
    const viewportDuration = pixelsToTime(effectiveContainerWidth);

    // Add generous padding: at least viewport width + 20 seconds buffer
    // This ensures when scrolled to the end, there's still content visible
    const padding = viewportDuration + 20;
    const totalDuration = Math.max(duration, furthestItemEnd + padding);

    // Convert to pixels and add extra 200px buffer for scrollbar and edge cases
    const width = Math.max(timeToPixels(totalDuration), effectiveContainerWidth) + 200;

    return { actualDuration: totalDuration, timelineWidth: width };
  }, [items, duration, fps, timeToPixels, pixelsToTime, containerWidth]);

  // Handle Ctrl+Scroll zoom with playhead anchoring
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Only handle zoom when Ctrl (Windows/Linux) or Cmd (Mac) is pressed
    if (!event.ctrlKey && !event.metaKey) {
      return; // Allow normal scrolling
    }

    // Note: preventDefault is handled globally in App.tsx
    const container = containerRef.current;
    if (!container) return;

    // Calculate playhead position before zoom
    const playheadPixelsBefore = frameToPixels(currentFrame);
    const scrollLeft = container.scrollLeft;
    const playheadRelativeToViewport = playheadPixelsBefore - scrollLeft;

    // Calculate zoom delta with medium sensitivity
    // Negative deltaY = scroll up = zoom in, Positive deltaY = scroll down = zoom out
    const zoomFactor = 1 - event.deltaY * 0.001;

    // Apply zoom (setZoom handles min/max bounds internally)
    const newZoomLevel = zoomLevel * zoomFactor;
    setZoom(newZoomLevel);

    // Schedule scroll adjustment after zoom is applied and DOM updates
    requestAnimationFrame(() => {
      if (!containerRef.current) return;

      // Calculate new playhead position after zoom
      const playheadPixelsAfter = frameToPixels(currentFrame);

      // Adjust scroll to keep playhead in same visual position
      const newScrollLeft = playheadPixelsAfter - playheadRelativeToViewport;
      containerRef.current.scrollLeft = Math.max(0, newScrollLeft);
    });
  };

  return (
    <div
      ref={mergedRef}
      className="flex-1 overflow-auto relative bg-background/30 timeline-container"
      onWheel={handleWheel}
      onClick={handleContainerClick}
    >
      {/* Marquee selection overlay */}
      <MarqueeOverlay marqueeState={marqueeState} />

      {/* Time Ruler - sticky at top */}
      <div className="sticky top-0 z-30 timeline-ruler bg-background" style={{ width: `${timelineWidth}px` }}>
        <TimelineMarkers duration={actualDuration} width={timelineWidth} />
        <TimelinePlayhead inRuler />
      </div>

      {/* Track lanes */}
      <div className="relative timeline-tracks" style={{ width: `${timelineWidth}px` }}>
        {tracks.map((track) => (
          <TimelineTrack key={track.id} track={track} items={items} timelineWidth={timelineWidth} />
        ))}

        {/* Playhead line through all tracks */}
        <TimelinePlayhead />
      </div>
    </div>
  );
}
