import { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';

// Hooks
import { useMarqueeSelection } from '@/hooks/use-marquee-selection';

// Constants
import {
  SCROLL_SENSITIVITY,
  SCROLL_FRICTION,
  SCROLL_MIN_VELOCITY,
  SCROLL_SMOOTHING,
  SCROLL_GESTURE_TIMEOUT,
  ZOOM_SENSITIVITY,
  ZOOM_FRICTION,
  ZOOM_MIN_VELOCITY,
  ZOOM_SMOOTHING,
} from '../constants/momentum';

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
    handleZoomToFit: () => void;
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
  const fps = useTimelineStore((s) => s.fps);

  // PERFORMANCE: Don't subscribe to items directly - it causes ALL tracks to re-render
  // when ANY item changes. Instead, use derived selectors for specific needs.

  // Derived selector: only returns the furthest item end frame (for timeline width)
  // This only triggers re-render when the timeline's actual end position changes
  const furthestItemEndFrame = useTimelineStore((s) =>
    s.items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0)
  );
  const { timeToPixels, pixelsToTime, frameToPixels, setZoom, setZoomImmediate, zoomLevel } = useTimelineZoom({
    minZoom: 0.01,
    maxZoom: 2, // Match slider range
  });
  // NOTE: Don't subscribe to currentFrame here - it would cause re-renders every frame!
  // Use refs to access it in callbacks instead (see currentFrameRef below)
  const selectItems = useSelectionStore((s) => s.selectItems);
  const selectMarker = useSelectionStore((s) => s.selectMarker);
  const clearItemSelection = useSelectionStore((s) => s.clearItemSelection);
  // Granular selectors for drag state - avoid subscribing to entire dragState object
  const isDragging = useSelectionStore((s) => !!s.dragState?.isDragging);
  const activeSnapTarget = useSelectionStore((s) => s.dragState?.activeSnapTarget ?? null);
  const activeTool = useSelectionStore((s) => s.activeTool);

  // Track cursor position for razor tool - only when hovering over an item
  const [razorCursorX, setRazorCursorX] = useState<number | null>(null);
  const [hoveredItemElement, setHoveredItemElement] = useState<HTMLElement | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Use ref for activeTool to avoid callback recreation on mode changes
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const marqueeWasActiveRef = useRef(false);
  const dragWasActiveRef = useRef(false);
  const scrubWasActiveRef = useRef(false);

  // Use refs to avoid callback recreation on every frame/zoom change
  // Access currentFrame via store subscription (no re-renders) instead of hook
  const currentFrameRef = useRef(usePlaybackStore.getState().currentFrame);
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      currentFrameRef.current = state.currentFrame;
    });
  }, []);

  // Clear selection when the playhead leaves the selected clip's time range
  // Only clears if the playhead moves outside the selected item(s), not when crossing other clips' boundaries
  useEffect(() => {
    let prevFrame = usePlaybackStore.getState().currentFrame;

    return usePlaybackStore.subscribe((state) => {
      const currentFrame = state.currentFrame;
      if (currentFrame === prevFrame) return;

      const { selectedItemIds } = useSelectionStore.getState();
      if (selectedItemIds.length === 0) {
        prevFrame = currentFrame;
        return;
      }

      // Get the selected items - read on-demand to avoid subscription
      const items = useTimelineStore.getState().items;
      const selectedItems = items.filter(item => selectedItemIds.includes(item.id));
      if (selectedItems.length === 0) {
        prevFrame = currentFrame;
        return;
      }

      // Check if playhead is still within ANY of the selected items
      const isWithinSelectedItems = selectedItems.some(item => {
        const itemStart = item.from;
        const itemEnd = item.from + item.durationInFrames;
        return currentFrame >= itemStart && currentFrame < itemEnd;
      });

      // If playhead moved outside all selected items, clear selection
      if (!isWithinSelectedItems) {
        useSelectionStore.getState().clearItemSelection();
      }

      prevFrame = currentFrame;
    });
  }, []); // No dependencies - reads items on-demand


  const frameToPixelsRef = useRef(frameToPixels);
  frameToPixelsRef.current = frameToPixels;

  const fpsRef = useRef(fps);
  fpsRef.current = fps;

  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const actualDurationRef = useRef(10); // Initialize with minimum duration

  // NOTE: itemsRef removed - use getState() on-demand or actualDurationRef for duration

  // Momentum scrolling state
  const velocityXRef = useRef(0);
  const velocityYRef = useRef(0);
  const velocityZoomRef = useRef(0);
  const momentumIdRef = useRef<number | null>(null);
  const lastWheelTimeRef = useRef(0);
  const zoomCursorXRef = useRef(0); // Cursor X position (relative to container) for zoom anchor
  const lastZoomWheelTimeRef = useRef(0); // Track zoom gesture separately
  const pendingScrollRef = useRef<number | null>(null); // Queued scroll to apply after render

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

  // Also remeasure when timeline content changes (might resize)
  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.clientWidth;
      if (width > 0 && width !== containerWidth) {
        setContainerWidth(width);
      }
    }
  }, [furthestItemEndFrame, containerWidth]); // Depends on content end, not full items array

  // Track scroll position with coalesced updates for viewport culling
  // Throttle at 50ms to match zoom throttle rate - prevents width jitter during zoom+scroll
  const scrollLeftRef = useRef(0);
  const scrollUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SCROLL_THROTTLE_MS = 50; // Match zoom throttle for synchronized updates

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      scrollLeftRef.current = container.scrollLeft;

      // Coalesce scroll updates at same rate as zoom throttle
      if (scrollUpdateTimeoutRef.current === null) {
        scrollUpdateTimeoutRef.current = setTimeout(() => {
          scrollUpdateTimeoutRef.current = null;
          setScrollLeft(scrollLeftRef.current);
        }, SCROLL_THROTTLE_MS);
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

  // Apply pending scroll AFTER render when DOM has updated width
  // This ensures zoom anchor works correctly even when timeline extends beyond content
  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && containerRef.current) {
      containerRef.current.scrollLeft = pendingScrollRef.current;
      pendingScrollRef.current = null;
    }
  });

  // Marquee selection - create items array for getBoundingRect lookups
  // Use derived selector for item IDs only (doesn't re-render when positions change)
  // useShallow prevents infinite loops from array reference changes
  const itemIds = useTimelineStore(useShallow((s) => s.items.map((item) => item.id)));

  const marqueeItems = useMemo(
    () =>
      itemIds.map((id) => ({
        id,
        getBoundingRect: () => {
          const element = document.querySelector(`[data-item-id="${id}"]`);
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
    [itemIds]
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

  // Track drag state to prevent deselection after drop
  useEffect(() => {
    if (isDragging) {
      dragWasActiveRef.current = true;
    } else if (dragWasActiveRef.current) {
      // Reset after a short delay when drag ends
      const timeout = setTimeout(() => {
        dragWasActiveRef.current = false;
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [isDragging]);

  // Track playhead/ruler scrubbing to prevent deselection after scrub ends
  useEffect(() => {
    const handleScrubStart = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if mousedown is on a playhead handle or timeline ruler
      if (target.closest('[data-playhead-handle]') || target.closest('.timeline-ruler')) {
        scrubWasActiveRef.current = true;
      }
    };

    const handleScrubEnd = () => {
      if (scrubWasActiveRef.current) {
        // Reset after a short delay when scrub ends
        setTimeout(() => {
          scrubWasActiveRef.current = false;
        }, 100);
      }
    };

    document.addEventListener('mousedown', handleScrubStart, true);
    document.addEventListener('mouseup', handleScrubEnd);

    return () => {
      document.removeEventListener('mousedown', handleScrubStart, true);
      document.removeEventListener('mouseup', handleScrubEnd);
    };
  }, []);

  // Click empty space to deselect items and markers (but preserve track selection)
  const handleContainerClick = (e: React.MouseEvent) => {
    // Don't deselect if marquee selection, drag, or scrubbing just finished
    if (marqueeWasActiveRef.current || dragWasActiveRef.current || scrubWasActiveRef.current) {
      return;
    }

    // Deselect items and markers if NOT clicking on a timeline item
    const target = e.target as HTMLElement;
    const clickedOnItem = target.closest('[data-item-id]');

    if (!clickedOnItem) {
      clearItemSelection();
      selectMarker(null); // Also clear marker selection
    }
  };

  // Track cursor position for razor tool split indicator - only over items
  // Use refs to avoid callback recreation on every mode/state change (prevents playback lag)
  const razorCursorXRef = useRef(razorCursorX);
  razorCursorXRef.current = razorCursorX;
  const hoveredItemElementRef = useRef(hoveredItemElement);
  hoveredItemElementRef.current = hoveredItemElement;

  const handleMouseMoveForRazor = useCallback((e: React.MouseEvent) => {
    if (activeToolRef.current !== 'razor') {
      if (razorCursorXRef.current !== null) setRazorCursorX(null);
      if (hoveredItemElementRef.current) setHoveredItemElement(null);
      return;
    }

    // Check if we're hovering over a timeline item
    const target = e.target as HTMLElement;
    const itemElement = target.closest('[data-item-id]') as HTMLElement | null;

    if (itemElement) {
      const rect = e.currentTarget.getBoundingClientRect();
      setRazorCursorX(e.clientX - rect.left);
      if (hoveredItemElementRef.current !== itemElement) setHoveredItemElement(itemElement);
    } else {
      if (razorCursorXRef.current !== null) setRazorCursorX(null);
      if (hoveredItemElementRef.current) setHoveredItemElement(null);
    }
  }, []); // Stable callback - reads from refs

  const handleMouseLeaveForRazor = useCallback(() => {
    setRazorCursorX(null);
    setHoveredItemElement(null);
  }, []);

  // Calculate the actual timeline duration and width based on content
  // Uses derived furthestItemEndFrame selector instead of full items array
  const { actualDuration, timelineWidth } = useMemo(() => {
    // Convert furthest item end from frames to seconds
    const furthestItemEnd = furthestItemEndFrame / fps;

    // Use actual content end, with minimum of 10 seconds for empty timelines
    const contentDuration = Math.max(furthestItemEnd, 10);

    // Calculate width: content width + buffer only when content exceeds viewport
    const effectiveContainerWidth = containerWidth > 0 ? containerWidth : 1920;
    const contentWidth = timeToPixels(contentDuration);

    // Use the most up-to-date scroll position (ref is updated immediately, state is throttled)
    // This ensures timeline doesn't shrink during zoom before state updates
    const currentScroll = Math.max(scrollLeft, scrollLeftRef.current);
    const currentViewEnd = currentScroll + effectiveContainerWidth;

    // Only add buffer when content is wider than viewport (for smooth scroll to end)
    // When content fits, use exact viewport width to avoid unnecessary scrollbar
    const baseWidth = contentWidth > effectiveContainerWidth
      ? contentWidth + 50
      : effectiveContainerWidth;

    // Timeline must be at least as wide as current view to maintain zoom anchor
    const width = Math.max(baseWidth, currentViewEnd);

    return { actualDuration: contentDuration, timelineWidth: width };
  }, [furthestItemEndFrame, fps, timeToPixels, containerWidth, scrollLeft]);

  actualDurationRef.current = actualDuration;

  // NOTE: itemsByTrack removed - TimelineTrack now fetches its own items
  // This prevents cascade re-renders when only one track's items change

  /**
   * Adjusts scroll position to keep cursor position stable when zoom changes
   * (Anchor zooming - cursor stays visually fixed, content scales around it)
   *
   * Uses refs for dynamic values to avoid callback recreation on every render
   */
  const applyZoomWithPlayheadCentering = useCallback((newZoomLevel: number) => {
    const container = containerRef.current;
    if (!container) return;

    const fps = fpsRef.current;
    const currentZoom = zoomLevelRef.current;

    // Clamp zoom to valid range
    const clampedZoom = Math.max(0.01, Math.min(2, newZoomLevel));
    if (clampedZoom === currentZoom) return;

    // Cursor's screen position (relative to container's visible left edge)
    const cursorScreenX = zoomCursorXRef.current;

    // Calculate cursor's position in CONTENT coordinates (timeline space)
    const cursorContentX = container.scrollLeft + cursorScreenX;

    // Convert to time using current zoom, clamped to actual content duration
    const currentPixelsPerSecond = currentZoom * 100;
    const cursorTime = Math.min(
      cursorContentX / currentPixelsPerSecond,
      actualDurationRef.current
    );

    // Calculate where that same time point will be at the new zoom
    const newPixelsPerSecond = clampedZoom * 100;
    const newCursorContentX = cursorTime * newPixelsPerSecond;

    // Calculate scroll needed to keep cursor at same screen position
    // cursor should stay at cursorScreenX, so:
    // newScrollLeft + cursorScreenX = newCursorContentX
    // newScrollLeft = newCursorContentX - cursorScreenX
    const newScrollLeft = newCursorContentX - cursorScreenX;

    // Only clamp to prevent negative scroll (left boundary)
    const clampedScrollLeft = Math.max(0, newScrollLeft);

    // Queue scroll to be applied AFTER render (so DOM has correct width)
    // Update ref immediately so timelineWidth calculation can use it
    pendingScrollRef.current = clampedScrollLeft;
    scrollLeftRef.current = clampedScrollLeft;

    // Apply zoom - this triggers re-render, after which useLayoutEffect applies scroll
    setZoomImmediate(clampedZoom);
  }, [setZoomImmediate]);

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

  // Keep a ref to containerWidth for use in stable callbacks
  const containerWidthRef = useRef(containerWidth);
  containerWidthRef.current = containerWidth;

  const handleZoomToFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Use refs for dynamic values to keep callback stable
    const effectiveContainerWidth = containerWidthRef.current > 0 ? containerWidthRef.current : container.clientWidth;

    // Use actualDurationRef which is kept in sync with timeline content
    const contentDuration = actualDurationRef.current;

    // Calculate zoom level needed to fit content in viewport
    // pixelsPerSecond = zoomLevel * 100
    // contentWidth = contentDuration * pixelsPerSecond = contentDuration * zoomLevel * 100
    // We want: contentWidth = effectiveContainerWidth (with some padding)
    // So: zoomLevel = effectiveContainerWidth / (contentDuration * 100)
    const padding = 50; // Leave some padding on the right
    const targetWidth = effectiveContainerWidth - padding;
    const newZoomLevel = Math.max(0.01, Math.min(2, targetWidth / (contentDuration * 100)));

    // Apply zoom and reset scroll to start
    setZoom(newZoomLevel);
    container.scrollLeft = 0;
  }, [setZoom]);

  // Expose zoom handlers to parent component (only once on mount)
  useEffect(() => {
    if (onZoomHandlersReady) {
      onZoomHandlersReady({
        handleZoomChange,
        handleZoomIn,
        handleZoomOut,
        handleZoomToFit,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only call once on mount

  // Momentum scroll/zoom loop using requestAnimationFrame
  const startMomentumScroll = useCallback(() => {
    if (momentumIdRef.current !== null) {
      cancelAnimationFrame(momentumIdRef.current);
    }

    const momentumLoop = () => {
      if (!containerRef.current) return;

      let hasScrollMomentum = false;
      let hasZoomMomentum = false;

      // Apply velocity to scroll position
      if (Math.abs(velocityXRef.current) > SCROLL_MIN_VELOCITY) {
        containerRef.current.scrollLeft += velocityXRef.current;
        velocityXRef.current *= SCROLL_FRICTION;
        hasScrollMomentum = true;
      } else {
        velocityXRef.current = 0;
      }

      if (Math.abs(velocityYRef.current) > SCROLL_MIN_VELOCITY) {
        containerRef.current.scrollTop += velocityYRef.current;
        velocityYRef.current *= SCROLL_FRICTION;
        hasScrollMomentum = true;
      } else {
        velocityYRef.current = 0;
      }

      // Apply velocity to zoom using logarithmic scale for symmetric feel
      // This makes zoom in and zoom out feel equally fast
      if (Math.abs(velocityZoomRef.current) > ZOOM_MIN_VELOCITY) {
        const currentZoom = zoomLevelRef.current;
        // Work in log space: add velocity to log(zoom), then exponentiate
        const logZoom = Math.log(currentZoom);
        const newLogZoom = logZoom - velocityZoomRef.current * 1.2; // Scale factor for feel
        const newZoomLevel = Math.exp(newLogZoom);
        applyZoomWithPlayheadCentering(newZoomLevel);
        velocityZoomRef.current *= ZOOM_FRICTION;
        hasZoomMomentum = true;
      } else {
        velocityZoomRef.current = 0;
      }

      // Continue loop if still moving
      if (hasScrollMomentum || hasZoomMomentum) {
        momentumIdRef.current = requestAnimationFrame(momentumLoop);
      } else {
        momentumIdRef.current = null;
      }
    };

    momentumIdRef.current = requestAnimationFrame(momentumLoop);
  }, [applyZoomWithPlayheadCentering]);

  // Cleanup momentum on unmount
  useEffect(() => {
    return () => {
      if (momentumIdRef.current !== null) {
        cancelAnimationFrame(momentumIdRef.current);
      }
    };
  }, []);

  // Attach non-passive wheel event listener to allow preventDefault
  // React's onWheel is passive by default in modern browsers
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const wheelHandler = (event: WheelEvent) => {
      // Prevent native scroll/zoom behavior for all cases we handle
      event.preventDefault();

      const now = performance.now();
      const timeDelta = now - lastWheelTimeRef.current;
      lastWheelTimeRef.current = now;

      // If a new gesture starts (after pause), reset all velocities
      if (timeDelta > SCROLL_GESTURE_TIMEOUT) {
        velocityXRef.current = 0;
        velocityYRef.current = 0;
        velocityZoomRef.current = 0;
      }

      // Ctrl/Cmd + scroll = zoom with momentum (anchored to cursor position)
      if (event.ctrlKey || event.metaKey) {
        velocityXRef.current = 0;
        velocityYRef.current = 0;

        // Only capture cursor position at START of zoom gesture (not during continuous zoom)
        // Use longer timeout (500ms) to avoid anchor jumping during natural gesture pauses
        const zoomTimeDelta = now - lastZoomWheelTimeRef.current;
        const isNewZoomGesture = zoomTimeDelta > 500;
        if (isNewZoomGesture) {
          const rect = container.getBoundingClientRect();
          zoomCursorXRef.current = event.clientX - rect.left;
        }
        lastZoomWheelTimeRef.current = now;

        const zoomSmoothingFactor = 1 - ZOOM_SMOOTHING;
        const delta = event.deltaY * ZOOM_SENSITIVITY;
        velocityZoomRef.current = velocityZoomRef.current * zoomSmoothingFactor + delta * ZOOM_SMOOTHING;
        startMomentumScroll();
        return;
      }

      // Reset zoom velocity for scroll operations
      velocityZoomRef.current = 0;
      const smoothingFactor = 1 - SCROLL_SMOOTHING;

      // Shift + scroll = vertical scroll ONLY
      if (event.shiftKey) {
        velocityXRef.current = 0;
        const delta = (event.deltaX || event.deltaY) * SCROLL_SENSITIVITY;
        velocityYRef.current = velocityYRef.current * smoothingFactor + delta * SCROLL_SMOOTHING;
      } else {
        // Default scroll = horizontal scroll ONLY
        velocityYRef.current = 0;
        const delta = (event.deltaY || event.deltaX) * SCROLL_SENSITIVITY;
        velocityXRef.current = velocityXRef.current * smoothingFactor + delta * SCROLL_SMOOTHING;
      }

      startMomentumScroll();
    };

    // Add with { passive: false } to allow preventDefault
    container.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', wheelHandler);
    };
  }, [applyZoomWithPlayheadCentering, startMomentumScroll]);

  return (
    <div
      ref={mergedRef}
      className="flex-1 overflow-auto relative bg-background/30 timeline-container"
      style={{
        scrollBehavior: 'auto', // Disable smooth scrolling for instant zoom response
        willChange: 'scroll-position', // Hint to browser for optimization
      }}
      onClick={handleContainerClick}
    >
      {/* Marquee selection overlay */}
      <MarqueeOverlay marqueeState={marqueeState} />

      {/* Time Ruler - sticky at top */}
      <div className="sticky top-0 z-30 timeline-ruler bg-background" style={{ width: `${timelineWidth}px` }}>
        <TimelineMarkers duration={actualDuration} width={timelineWidth} />
        <TimelinePlayhead inRuler maxFrame={Math.floor(actualDuration * fps)} />
      </div>

      {/* Track lanes */}
      <div
        ref={tracksContainerRef}
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
          <TimelineTrack key={track.id} track={track} timelineWidth={timelineWidth} />
        ))}

        {/* Snap guidelines (shown during drag) */}
        {isDragging && (
          <TimelineGuidelines
            activeSnapTarget={activeSnapTarget}
          />
        )}

        {/* Split indicator (shown in razor mode when hovering over an item) */}
        {activeTool === 'razor' && hoveredItemElement && (
          <TimelineSplitIndicator
            cursorX={razorCursorX}
            hoveredElement={hoveredItemElement}
            tracksContainerRef={tracksContainerRef}
          />
        )}

        {/* Playhead line through all tracks */}
        <TimelinePlayhead maxFrame={Math.floor(actualDuration * fps)} />
      </div>
    </div>
  );
}
