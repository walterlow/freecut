// React and external libraries
import { useMemo, useCallback, useRef, useState, useEffect, memo } from 'react';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';

// Components
import { TimelineInOutMarkers } from './timeline-in-out-markers';

// Utilities and hooks
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { formatTimecode, secondsToFrames } from '@/utils/time-utils';

export interface TimelineMarkersProps {
  duration: number; // Total timeline duration in seconds
  width?: number; // Explicit width in pixels (optional)
}

interface MarkerInterval {
  type: 'frame' | 'second' | 'multi-second' | 'minute';
  intervalInSeconds: number;
  minorTicks: number; // Number of minor ticks between major markers
}

/**
 * Calculate optimal marker interval based on zoom level
 * Goal: Keep markers 120+ pixels apart for readability
 * Dynamically adjusts to ensure timecode labels never overlap
 */
function calculateMarkerInterval(pixelsPerSecond: number): MarkerInterval {
  // At very high zoom (>= 3000 pps): Show individual frames
  // Only when each frame is at least 120px apart (3000 * 1/30 = 100px, close enough)
  if (pixelsPerSecond >= 3000) {
    return {
      type: 'frame',
      intervalInSeconds: 1 / 30, // Will use actual fps from store
      minorTicks: 0,
    };
  }

  // High zoom (1500-3000 pps): Show every 3 frames
  if (pixelsPerSecond >= 1500) {
    return {
      type: 'frame',
      intervalInSeconds: 3 / 30,
      minorTicks: 3,
    };
  }

  // Medium-high zoom (750-1500 pps): Show every 5 frames
  if (pixelsPerSecond >= 750) {
    return {
      type: 'frame',
      intervalInSeconds: 5 / 30,
      minorTicks: 5,
    };
  }

  // Medium-high zoom (300-750 pps): Show every 10 frames
  if (pixelsPerSecond >= 300) {
    return {
      type: 'frame',
      intervalInSeconds: 10 / 30,
      minorTicks: 10,
    };
  }

  // Medium zoom (120-300 pps): Show seconds
  if (pixelsPerSecond >= 120) {
    return {
      type: 'second',
      intervalInSeconds: 1,
      minorTicks: 10,
    };
  }

  // Medium-low zoom (30-120 pps): Show 2-second intervals
  if (pixelsPerSecond >= 60) {
    return {
      type: 'multi-second',
      intervalInSeconds: 2,
      minorTicks: 4,
    };
  }

  // Low zoom (15-60 pps): Show 5-second intervals
  if (pixelsPerSecond >= 24) {
    return {
      type: 'multi-second',
      intervalInSeconds: 5,
      minorTicks: 5,
    };
  }

  // Very low zoom (6-15 pps): Show 10-second intervals
  if (pixelsPerSecond >= 12) {
    return {
      type: 'multi-second',
      intervalInSeconds: 10,
      minorTicks: 5,
    };
  }

  // Very low zoom (4-6 pps): Show 30-second intervals
  if (pixelsPerSecond >= 4) {
    return {
      type: 'multi-second',
      intervalInSeconds: 30,
      minorTicks: 6,
    };
  }

  // Extremely low zoom (2-4 pps): Show minute intervals
  if (pixelsPerSecond >= 2) {
    return {
      type: 'minute',
      intervalInSeconds: 60,
      minorTicks: 6,
    };
  }

  // Ultra low zoom (1-2 pps): Show 2-minute intervals
  if (pixelsPerSecond >= 1) {
    return {
      type: 'minute',
      intervalInSeconds: 120,
      minorTicks: 4,
    };
  }

  // Ultra low zoom (0.5-1 pps): Show 5-minute intervals
  if (pixelsPerSecond >= 0.5) {
    return {
      type: 'minute',
      intervalInSeconds: 300,
      minorTicks: 5,
    };
  }

  // Ultra low zoom (0.2-0.5 pps): Show 10-minute intervals
  if (pixelsPerSecond >= 0.2) {
    return {
      type: 'minute',
      intervalInSeconds: 600,
      minorTicks: 10,
    };
  }

  // Ultra low zoom (<0.2 pps): Show 30-minute intervals
  return {
    type: 'minute',
    intervalInSeconds: 1800,
    minorTicks: 6,
  };
}

/**
 * Timeline Markers Component
 *
 * Renders adaptive time ruler with:
 * - Smart interval calculation based on zoom level
 * - Timecode labels (HH:MM:SS:FF) with enhanced typography
 * - Major and minor tick marks
 * - Viewport-aware rendering (extends to full width)
 * - Responsive to zoom changes
 */
export const TimelineMarkers = memo(function TimelineMarkers({ duration, width }: TimelineMarkersProps) {
  const { timeToPixels, pixelsPerSecond, pixelsToFrame } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const pause = usePlaybackStore((s) => s.pause);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Use refs to avoid stale closures in drag handler
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const pauseRef = useRef(pause);

  // Update refs when functions change
  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setCurrentFrameRef.current = setCurrentFrame;
    pauseRef.current = pause;
  }, [pixelsToFrame, setCurrentFrame, pause]);

  // Track viewport width and scroll position with coalesced updates
  const scrollLeftRef = useRef(0);
  const scrollUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!rulerRef.current) return;

    const container = rulerRef.current.parentElement; // Timeline container
    if (!container) return;

    const updateViewport = () => {
      if (rulerRef.current) {
        setViewportWidth(rulerRef.current.getBoundingClientRect().width);
      }
    };

    const updateScroll = () => {
      if (container) {
        scrollLeftRef.current = container.scrollLeft;

        // Coalesce scroll updates to reduce re-renders
        if (scrollUpdateTimeoutRef.current === null) {
          scrollUpdateTimeoutRef.current = setTimeout(() => {
            scrollUpdateTimeoutRef.current = null;
            setScrollLeft(scrollLeftRef.current);
          }, 100);
        }
      }
    };

    // Initial measurements
    updateViewport();
    setScrollLeft(container.scrollLeft);

    // Setup ResizeObserver for viewport changes
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(rulerRef.current);

    // Track scroll position
    container.addEventListener('scroll', updateScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', updateScroll);
      if (scrollUpdateTimeoutRef.current !== null) {
        clearTimeout(scrollUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Calculate optimal marker interval based on zoom
  const markerConfig = useMemo(
    () => calculateMarkerInterval(pixelsPerSecond),
    [pixelsPerSecond]
  );

  // Adjust interval for frame-based markers to use actual fps
  const intervalInSeconds = markerConfig.type === 'frame'
    ? 1 / fps
    : markerConfig.intervalInSeconds;

  // Calculate timeline content width and display width
  // If explicit width is provided, use it; otherwise calculate based on duration/viewport
  const timelineContentWidth = timeToPixels(duration);
  const displayWidth = width || Math.max(timelineContentWidth, viewportWidth);

  // Calculate number of markers to fill the display width
  const displayDuration = displayWidth / pixelsPerSecond;
  const numMarkers = Math.ceil(displayDuration / intervalInSeconds) + 1;
  const markerWidthPx = timeToPixels(intervalInSeconds);

  // Viewport culling with minimal overscan (0.5x viewport width on each side)
  // Reduced from 2x to improve performance at high zoom
  const overscan = viewportWidth * 0.5;
  const visibleStart = scrollLeft - overscan;
  const visibleEnd = scrollLeft + viewportWidth + overscan;

  // Calculate which marker indices are visible
  const startMarkerIndex = Math.max(0, Math.floor(visibleStart / markerWidthPx));
  const endMarkerIndex = Math.min(numMarkers - 1, Math.ceil(visibleEnd / markerWidthPx));

  // Performance optimization: skip minor ticks when many markers are visible
  const visibleMarkerCount = endMarkerIndex - startMarkerIndex + 1;
  const showMinorTicks = visibleMarkerCount < 50; // Only show minor ticks when < 50 markers visible

  // Handle scrubbing - mousedown to start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (!rulerRef.current) return;

    const rect = rulerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Pause playback when clicking on ruler
    pauseRef.current();

    // Convert pixel position to frame number and update immediately
    const frame = Math.max(0, pixelsToFrameRef.current(x));
    setCurrentFrameRef.current(frame);

    setIsDragging(true);
  }, []);

  // Handle drag movement
  useEffect(() => {
    if (!isDragging) return;

    // Apply grabbing cursor globally to prevent flickering
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      if (!rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;

      // Convert pixel position to frame number using ref to avoid stale closure
      const frame = Math.max(0, pixelsToFrameRef.current(x));
      setCurrentFrameRef.current(frame);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Restore original cursor
      document.body.style.cursor = originalCursor;
    };
  }, [isDragging]);

  return (
    <div
      ref={rulerRef}
      className="h-11 bg-gradient-to-b from-secondary/30 via-secondary/20 to-secondary/10 border-b border-border/80 relative transition-all duration-200 ease-out"
      onMouseDown={handleMouseDown}
      style={{
        background: 'linear-gradient(to bottom, oklch(0.22 0 0 / 0.30), oklch(0.22 0 0 / 0.20), oklch(0.22 0 0 / 0.10))',
        userSelect: 'none', // Prevent text selection during drag
        width: width ? `${width}px` : undefined,
        minWidth: width ? `${width}px` : undefined,
      }}
    >
      {/* Markers - only render visible markers with overscan */}
      <div
        className="absolute inset-0"
        style={{
          pointerEvents: isDragging ? 'none' : 'auto', // Disable pointer events on children during drag
          contain: 'layout style', // CSS containment for better rendering performance
        }}
      >
        {Array.from({ length: endMarkerIndex - startMarkerIndex + 1 }).map((_, index) => {
          const i = startMarkerIndex + index;
          const timeInSeconds = i * intervalInSeconds;
          const frameNumber = secondsToFrames(timeInSeconds, fps);
          const leftPosition = timeToPixels(timeInSeconds);

          // If explicit width is provided, skip markers whose children would overflow
          if (width && leftPosition + markerWidthPx > width) {
            return null;
          }

          return (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{ left: `${leftPosition}px` }}
            >
              {/* Major marker line */}
              <div className="w-px h-full bg-border/70" />

              {/* Timecode label with enhanced typography */}
              <span
                className="absolute top-1.5 left-1.5 font-mono text-[13px] text-muted-foreground tabular-nums whitespace-nowrap"
                style={{
                  textShadow: '0 1px 2px rgba(0,0,0,0.4)',
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: '0.02em',
                }}
              >
                {formatTimecode(frameNumber, fps)}
              </span>

              {/* Minor tick marks - only rendered when few markers visible for performance */}
              {showMinorTicks && markerConfig.minorTicks > 0 && (
                <div className="absolute top-7 left-0 flex" style={{ width: `${markerWidthPx}px` }}>
                  {Array.from({ length: markerConfig.minorTicks }).map((_, j) => {
                    if (j === 0) return null; // Skip first tick (overlaps with major marker)

                    const tickOffset = (markerWidthPx / markerConfig.minorTicks) * j;

                    return (
                      <div
                        key={j}
                        className="absolute w-px h-2"
                        style={{
                          left: `${tickOffset}px`,
                          backgroundColor: 'oklch(0.25 0 0 / 0.3)',
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Subtle vignette effect at edges */}
      <div
        className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background/20 to-transparent pointer-events-none"
        style={{
          background: 'linear-gradient(to right, oklch(0.15 0 0 / 0.15), transparent)',
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background/20 to-transparent pointer-events-none"
        style={{
          background: 'linear-gradient(to left, oklch(0.15 0 0 / 0.15), transparent)',
        }}
      />

      {/* Shaded region between in/out points */}
      {inPoint !== null && outPoint !== null && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${timeToPixels(inPoint / fps)}px`,
            width: `${timeToPixels((outPoint - inPoint) / fps)}px`,
            backgroundColor: 'oklch(0.5 0.1 220 / 0.15)',
            borderLeft: '1px solid oklch(0.65 0.18 142 / 0.5)',
            borderRight: '1px solid oklch(0.61 0.22 29 / 0.5)',
            zIndex: 10,
          }}
        />
      )}

      {/* In/Out markers */}
      <TimelineInOutMarkers />
    </div>
  );
});
