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
import { TimelineGuidelines } from './timeline-guidelines';
import { TimelineSplitIndicator } from './timeline-split-indicator';
import { MarqueeOverlay } from '@/components/marquee-overlay';

export interface TimelineContentProps {
  duration: number; // Total timeline duration in seconds
  scrollRef?: React.RefObject<HTMLDivElement | null>; // Optional ref for scroll syncing
  onZoomHandlersReady?: (handlers: {
    handleZoomChange: (newZoom: number) => void;
    handleZoomIn: () => void;
    handleZoomOut: () => void;
  }) => void;
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
export function TimelineContent({ duration, scrollRef, onZoomHandlersReady }: TimelineContentProps) {
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
  const dragState = useSelectionStore((s) => s.dragState);
  const activeTool = useSelectionStore((s) => s.activeTool);

  // Track cursor position for razor tool - only when hovering over an item
  const [razorCursorX, setRazorCursorX] = useState<number | null>(null);
  const [isHoveringItem, setIsHoveringItem] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const marqueeWasActiveRef = useRef(false);

  // Use refs to avoid callback recreation on every frame/zoom change
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;

  const frameToPixelsRef = useRef(frameToPixels);
  frameToPixelsRef.current = frameToPixels;

  const fpsRef = useRef(fps);
  fpsRef.current = fps;

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

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

  // Track scroll position with coalesced updates for viewport culling
  // Only update state every 150ms to reduce re-render frequency during rapid scrolling
  const scrollLeftRef = useRef(0);
  const scrollUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollLeftRef.current = container.scrollLeft;

      // Coalesce scroll updates - only update state every 150ms
      if (scrollUpdateTimeoutRef.current === null) {
        scrollUpdateTimeoutRef.current = setTimeout(() => {
          scrollUpdateTimeoutRef.current = null;
          setScrollLeft(scrollLeftRef.current);
        }, 150);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollUpdateTimeoutRef.current !== null) {
        clearTimeout(scrollUpdateTimeoutRef.current);
      }
    };
  }, []);

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

  // Track cursor position for razor tool split indicator - only over items
  const handleMouseMoveForRazor = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'razor') {
      if (razorCursorX !== null) setRazorCursorX(null);
      if (isHoveringItem) setIsHoveringItem(false);
      return;
    }

    // Check if we're hovering over a timeline item
    const target = e.target as HTMLElement;
    const itemElement = target.closest('[data-item-id]');

    if (itemElement) {
      const rect = e.currentTarget.getBoundingClientRect();
      setRazorCursorX(e.clientX - rect.left);
      if (!isHoveringItem) setIsHoveringItem(true);
    } else {
      if (razorCursorX !== null) setRazorCursorX(null);
      if (isHoveringItem) setIsHoveringItem(false);
    }
  }, [activeTool, razorCursorX, isHoveringItem]);

  const handleMouseLeaveForRazor = useCallback(() => {
    setRazorCursorX(null);
    setIsHoveringItem(false);
  }, []);

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

  // Viewport culling: only render items that are visible in the viewport + buffer
  // This significantly improves performance with 50+ items
  const visibleItems = useMemo(() => {
    const buffer = 500; // Extra pixels outside viewport to render (prevents pop-in during scroll)
    const viewportStart = scrollLeft - buffer;
    const viewportEnd = scrollLeft + containerWidth + buffer;

    return items.filter((item) => {
      const itemLeft = timeToPixels(item.from / fps);
      const itemRight = itemLeft + timeToPixels(item.durationInFrames / fps);
      // Item is visible if any part of it overlaps with the viewport
      return itemRight >= viewportStart && itemLeft <= viewportEnd;
    });
  }, [items, scrollLeft, containerWidth, timeToPixels, fps]);

  /**
   * Adjusts scroll position to center the playhead when zoom changes
   * @param newZoomLevel - The new zoom level to apply
   *
   * Uses refs for dynamic values to avoid callback recreation on every render
   */
  const applyZoomWithPlayheadCentering = useCallback((newZoomLevel: number) => {
    const container = containerRef.current;
    if (!container) return;

    const currentFrame = currentFrameRef.current;
    const fps = fpsRef.current;

    // IMPORTANT: Clamp the zoom level to valid range BEFORE calculations
    // setZoom will clamp it, so we need to use the same clamped value for scroll calculations
    const clampedZoom = Math.max(0.01, Math.min(2, newZoomLevel));

    // Calculate playhead position AFTER zoom (using CLAMPED zoom level)
    const timeInSeconds = currentFrame / fps;
    const pixelsPerSecondAfter = 100 * clampedZoom;
    const playheadPixelsAfter = timeInSeconds * pixelsPerSecondAfter;

    // Get viewport dimensions
    const viewportWidth = container.clientWidth;
    const viewportCenter = viewportWidth / 2;

    // Calculate desired scroll position to center the playhead
    const desiredScrollLeft = playheadPixelsAfter - viewportCenter;

    // Apply zoom (this updates the store synchronously, also clamping it)
    setZoom(clampedZoom);

    // Set scroll immediately - we'll clamp it, and browser will handle invalid values
    // The key is to set it BEFORE React renders, so both updates happen together
    container.scrollLeft = Math.max(0, desiredScrollLeft);
  }, [setZoom]); // Only setZoom as dependency, which should be stable

  // Create zoom handlers that include playhead centering
  // These callbacks are stable and don't recreate on every render thanks to refs
  const handleZoomChange = useCallback((newZoom: number) => {
    applyZoomWithPlayheadCentering(newZoom);
  }, [applyZoomWithPlayheadCentering]);

  const handleZoomIn = useCallback(() => {
    // Use standard zoom step (0.1), read from ref to avoid callback recreation
    const newZoomLevel = Math.min(2, zoomLevelRef.current + 0.1);
    applyZoomWithPlayheadCentering(newZoomLevel);
  }, [applyZoomWithPlayheadCentering]);

  const handleZoomOut = useCallback(() => {
    // Use standard zoom step (0.1), read from ref to avoid callback recreation
    const newZoomLevel = Math.max(0.01, zoomLevelRef.current - 0.1);
    applyZoomWithPlayheadCentering(newZoomLevel);
  }, [applyZoomWithPlayheadCentering]);

  // Expose zoom handlers to parent component (only once on mount)
  useEffect(() => {
    if (onZoomHandlersReady) {
      onZoomHandlersReady({
        handleZoomChange,
        handleZoomIn,
        handleZoomOut,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only call once on mount

  // Handle Ctrl+Scroll zoom with playhead anchoring
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Only handle zoom when Ctrl (Windows/Linux) or Cmd (Mac) is pressed
    if (!event.ctrlKey && !event.metaKey) {
      return; // Allow normal scrolling
    }

    // Note: preventDefault is handled globally in App.tsx
    if (!containerRef.current) return;

    // Calculate zoom delta with medium sensitivity
    // Negative deltaY = scroll up = zoom in, Positive deltaY = scroll down = zoom out
    const zoomFactor = 1 - event.deltaY * 0.001;
    const newZoomLevel = zoomLevel * zoomFactor;

    // Apply zoom with playhead centering
    applyZoomWithPlayheadCentering(newZoomLevel);
  };

  return (
    <div
      ref={mergedRef}
      className="flex-1 overflow-auto relative bg-background/30 timeline-container"
      style={{
        scrollBehavior: 'auto', // Disable smooth scrolling for instant zoom response
        willChange: 'scroll-position', // Hint to browser for optimization
      }}
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
      <div
        className="relative timeline-tracks"
        style={{
          width: `${timelineWidth}px`,
          // CSS containment and will-change hints for scroll/paint optimization
          contain: 'layout style paint',
          willChange: 'contents',
        }}
        onMouseMove={handleMouseMoveForRazor}
        onMouseLeave={handleMouseLeaveForRazor}
      >
        {tracks.map((track) => (
          <TimelineTrack key={track.id} track={track} items={visibleItems} timelineWidth={timelineWidth} />
        ))}

        {/* Snap guidelines (shown during drag) */}
        {dragState?.isDragging && (
          <TimelineGuidelines
            activeSnapTarget={dragState.activeSnapTarget ?? null}
          />
        )}

        {/* Split indicator (shown in razor mode when hovering over an item) */}
        {activeTool === 'razor' && isHoveringItem && (
          <TimelineSplitIndicator cursorX={razorCursorX} />
        )}

        {/* Playhead line through all tracks */}
        <TimelinePlayhead />
      </div>
    </div>
  );
}
