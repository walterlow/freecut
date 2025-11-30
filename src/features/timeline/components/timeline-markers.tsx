// React and external libraries
import { useCallback, useRef, useState, useEffect, memo } from 'react';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/features/preview/stores/playback-store';
import { useSelectionStore } from '@/features/editor/stores/selection-store';

// Components
import { TimelineInOutMarkers } from './timeline-in-out-markers';
import { TimelineProjectMarkers } from './timeline-project-markers';

// Utilities and hooks
import { useTimelineZoom } from '../hooks/use-timeline-zoom';
import { formatTimecode, secondsToFrames } from '@/utils/time-utils';

// Edge-scrolling configuration
const EDGE_SCROLL_MAX_SPEED = 20; // Max pixels per frame at max distance
const EDGE_SCROLL_ACCELERATION = 0.3; // Speed multiplier per pixel of distance
const EDGE_SCROLL_ZONE = 30; // Pixels from edge to trigger scroll (for when mouse is inside viewport)
const EDGE_ZONE_MULTIPLIER = 2.5; // Scale zone distance to match outside-edge feel
const PLAYHEAD_CLEARANCE = 15; // Pixels to reserve at end so playhead isn't clipped

export interface TimelineMarkersProps {
  duration: number; // Total timeline duration in seconds
  width?: number; // Explicit width in pixels (optional)
}

interface MarkerInterval {
  type: 'frame' | 'second' | 'multi-second' | 'minute';
  intervalInSeconds: number;
  minorTicks: number;
}

// Tile configuration
const TILE_WIDTH = 2000; // Safe width well under browser canvas limits
const LABEL_OVERSCAN = 100; // Extra pixels to draw for labels extending into adjacent tiles

/**
 * Calculate optimal marker interval based on zoom level
 */
function calculateMarkerInterval(pixelsPerSecond: number): MarkerInterval {
  if (pixelsPerSecond >= 3000) {
    return { type: 'frame', intervalInSeconds: 1 / 30, minorTicks: 0 };
  }
  if (pixelsPerSecond >= 1500) {
    return { type: 'frame', intervalInSeconds: 3 / 30, minorTicks: 3 };
  }
  if (pixelsPerSecond >= 750) {
    return { type: 'frame', intervalInSeconds: 5 / 30, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 300) {
    return { type: 'frame', intervalInSeconds: 10 / 30, minorTicks: 10 };
  }
  if (pixelsPerSecond >= 120) {
    return { type: 'second', intervalInSeconds: 1, minorTicks: 10 };
  }
  if (pixelsPerSecond >= 60) {
    return { type: 'multi-second', intervalInSeconds: 2, minorTicks: 4 };
  }
  if (pixelsPerSecond >= 24) {
    return { type: 'multi-second', intervalInSeconds: 5, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 12) {
    return { type: 'multi-second', intervalInSeconds: 10, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 4) {
    return { type: 'multi-second', intervalInSeconds: 30, minorTicks: 6 };
  }
  if (pixelsPerSecond >= 2) {
    return { type: 'minute', intervalInSeconds: 60, minorTicks: 6 };
  }
  if (pixelsPerSecond >= 1) {
    return { type: 'minute', intervalInSeconds: 120, minorTicks: 4 };
  }
  if (pixelsPerSecond >= 0.5) {
    return { type: 'minute', intervalInSeconds: 300, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 0.2) {
    return { type: 'minute', intervalInSeconds: 600, minorTicks: 10 };
  }
  return { type: 'minute', intervalInSeconds: 1800, minorTicks: 6 };
}

/**
 * Draw markers on a single tile canvas
 */
function drawTile(
  canvas: HTMLCanvasElement,
  tileIndex: number,
  tileWidth: number,
  canvasHeight: number,
  pixelsPerSecond: number,
  fps: number,
  timeToPixels: (time: number) => number,
  totalWidth: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const tileOffset = tileIndex * tileWidth;
  const actualTileWidth = Math.min(tileWidth, totalWidth - tileOffset);

  // Set canvas size with DPI scaling
  canvas.width = Math.ceil(actualTileWidth * dpr);
  canvas.height = Math.ceil(canvasHeight * dpr);
  canvas.style.width = `${actualTileWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, actualTileWidth, canvasHeight);

  // Calculate marker interval
  const markerConfig = calculateMarkerInterval(pixelsPerSecond);
  const intervalInSeconds = markerConfig.type === 'frame' ? 1 / fps : markerConfig.intervalInSeconds;
  const markerWidthPx = timeToPixels(intervalInSeconds);

  if (markerWidthPx <= 0) return;

  // Calculate which markers fall within this tile (with overscan for labels)
  const tileStartPx = tileOffset - LABEL_OVERSCAN;
  const tileEndPx = tileOffset + actualTileWidth;

  const startMarkerIndex = Math.max(0, Math.floor(tileStartPx / markerWidthPx));
  const endMarkerIndex = Math.ceil(tileEndPx / markerWidthPx);

  // Performance: skip minor ticks when many markers
  const visibleMarkerCount = endMarkerIndex - startMarkerIndex + 1;
  const showMinorTicks = visibleMarkerCount < 100;

  // Setup text rendering for sharp fonts
  ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.textBaseline = 'top';

  for (let i = startMarkerIndex; i <= endMarkerIndex; i++) {
    const timeInSeconds = i * intervalInSeconds;
    const absoluteX = timeToPixels(timeInSeconds);
    const x = absoluteX - tileOffset; // Convert to tile-relative coordinate

    // Skip if marker line is outside tile (but label might extend in)
    if (x < -LABEL_OVERSCAN || x > actualTileWidth) continue;

    // Major tick line - use integer position for sharp rendering
    const lineX = Math.round(x) + 0.5;
    if (lineX >= 0 && lineX <= actualTileWidth) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, canvasHeight);
      ctx.stroke();
    }

    // Timecode label - use integer positions for sharp text
    const labelX = Math.round(x + 6);
    const labelY = 6;

    if (labelX >= -LABEL_OVERSCAN && labelX <= actualTileWidth + LABEL_OVERSCAN) {
      const frameNumber = secondsToFrames(timeInSeconds, fps);
      const label = formatTimecode(frameNumber, fps);

      // Text shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillText(label, labelX + 1, labelY + 1);
      // Main text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(label, labelX, labelY);
    }

    // Minor ticks - check if any tick might be visible (x + markerWidthPx > 0)
    // The inner loop has its own bounds check for individual ticks
    if (showMinorTicks && markerConfig.minorTicks > 0 && x + markerWidthPx > 0) {
      const tickSpacing = markerWidthPx / markerConfig.minorTicks;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;

      for (let j = 1; j < markerConfig.minorTicks; j++) {
        const tickX = Math.round(x + tickSpacing * j) + 0.5;
        if (tickX < 0 || tickX > actualTileWidth) continue;

        ctx.beginPath();
        ctx.moveTo(tickX, 28);
        ctx.lineTo(tickX, 36);
        ctx.stroke();
      }
    }
  }
}

/**
 * Timeline Markers Component (Tiled Canvas)
 *
 * Uses multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 2000px wide, only visible tiles are rendered.
 */
export const TimelineMarkers = memo(function TimelineMarkers({ duration, width }: TimelineMarkersProps) {
  const { timeToPixels, pixelsPerSecond, pixelsToFrame } = useTimelineZoom();
  const fps = useTimelineStore((s) => s.fps);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const pause = usePlaybackStore((s) => s.pause);
  const selectMarker = useSelectionStore((s) => s.selectMarker);

  const containerRef = useRef<HTMLDivElement>(null);
  const tilesContainerRef = useRef<HTMLDivElement>(null);
  const canvasPoolRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Refs for drag handlers
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const pauseRef = useRef(pause);
  const fpsRef = useRef(fps);
  const durationRef = useRef(duration);
  const widthRef = useRef(width);

  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setCurrentFrameRef.current = setCurrentFrame;
    pauseRef.current = pause;
    fpsRef.current = fps;
    widthRef.current = width;
    durationRef.current = duration;
  }, [pixelsToFrame, setCurrentFrame, pause, fps, duration, width]);

  // Track viewport and scroll
  const scrollLeftRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Edge-scrolling refs
  const edgeScrollIdRef = useRef<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const edgeScrollDirectionRef = useRef<'left' | 'right' | null>(null);
  const edgeScrollDistanceRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current.parentElement;
    if (!container) return;

    const updateViewport = () => {
      if (containerRef.current) {
        setViewportWidth(containerRef.current.getBoundingClientRect().width);
      }
    };

    const updateScroll = () => {
      if (container) {
        const newScrollLeft = container.scrollLeft;
        if (newScrollLeft !== scrollLeftRef.current) {
          scrollLeftRef.current = newScrollLeft;
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(() => {
              rafIdRef.current = null;
              setScrollLeft(scrollLeftRef.current);
            });
          }
        }
      }
    };

    updateViewport();
    setScrollLeft(container.scrollLeft);

    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(containerRef.current);
    container.addEventListener('scroll', updateScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('scroll', updateScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Calculate dimensions
  const timelineContentWidth = timeToPixels(duration);
  const displayWidth = width || Math.max(timelineContentWidth, viewportWidth);
  const canvasHeight = 44;

  // Calculate visible tiles
  const startTile = Math.max(0, Math.floor(scrollLeft / TILE_WIDTH));
  const endTile = Math.min(
    Math.ceil(displayWidth / TILE_WIDTH) - 1,
    Math.ceil((scrollLeft + viewportWidth) / TILE_WIDTH)
  );

  // Tiled canvas rendering effect
  useEffect(() => {
    if (!tilesContainerRef.current) return;

    const tilesContainer = tilesContainerRef.current;
    const canvasPool = canvasPoolRef.current;
    const visibleTileIndices = new Set<number>();

    // Render visible tiles
    for (let tileIndex = startTile; tileIndex <= endTile; tileIndex++) {
      visibleTileIndices.add(tileIndex);

      let canvas = canvasPool.get(tileIndex);

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.pointerEvents = 'none';
        canvasPool.set(tileIndex, canvas);
        tilesContainer.appendChild(canvas);
      }

      // Position tile
      canvas.style.left = `${tileIndex * TILE_WIDTH}px`;

      // Draw tile content
      drawTile(
        canvas,
        tileIndex,
        TILE_WIDTH,
        canvasHeight,
        pixelsPerSecond,
        fps,
        timeToPixels,
        displayWidth
      );
    }

    // Remove tiles that are no longer visible
    canvasPool.forEach((canvas, tileIndex) => {
      if (!visibleTileIndices.has(tileIndex)) {
        canvas.remove();
        canvasPool.delete(tileIndex);
      }
    });
  }, [startTile, endTile, pixelsPerSecond, fps, timeToPixels, displayWidth, canvasHeight]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      canvasPoolRef.current.forEach((canvas) => canvas.remove());
      canvasPoolRef.current.clear();
    };
  }, []);

  // Stop edge scrolling
  const stopEdgeScroll = useCallback(() => {
    if (edgeScrollIdRef.current !== null) {
      cancelAnimationFrame(edgeScrollIdRef.current);
      edgeScrollIdRef.current = null;
    }
    edgeScrollDirectionRef.current = null;
    edgeScrollDistanceRef.current = 0;
  }, []);

  // Edge scroll loop - continuously scrolls while at edge
  const runEdgeScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    const direction = edgeScrollDirectionRef.current;
    const distance = edgeScrollDistanceRef.current;

    if (!scrollContainer || !direction || distance <= 0) {
      stopEdgeScroll();
      return;
    }

    // Calculate speed based on distance past edge (clamped)
    const speed = Math.min(distance * EDGE_SCROLL_ACCELERATION, EDGE_SCROLL_MAX_SPEED);
    const delta = direction === 'left' ? -speed : speed;

    // Apply scroll
    const prevScrollLeft = scrollContainer.scrollLeft;
    scrollContainer.scrollLeft += delta;

    // Check if we actually scrolled (not at boundary)
    const didScroll = scrollContainer.scrollLeft !== prevScrollLeft;

    if (didScroll) {
      // Playhead anchors at visible edge: left edge = scrollLeft, right edge = scrollLeft + viewportWidth
      const edgeX = direction === 'left'
        ? scrollContainer.scrollLeft
        : scrollContainer.scrollLeft + scrollContainer.clientWidth;
      // Clamp to timeline width minus clearance
      const maxFrame = Math.round(pixelsToFrameRef.current(Math.max(0, (widthRef.current ?? 0) - PLAYHEAD_CLEARANCE)));
      const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(edgeX))));
      setCurrentFrameRef.current(frame);

      // Continue scrolling
      edgeScrollIdRef.current = requestAnimationFrame(runEdgeScroll);
    } else {
      // Hit scroll boundary - stop the loop
      stopEdgeScroll();
    }
  }, [stopEdgeScroll]);

  // Scrubbing handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent click from bubbling to container and clearing selection
    if (!containerRef.current) return;

    // Clear marker selection when clicking on ruler (only if a marker is selected)
    // Note: Don't use selectMarker(null) as it also clears item selection
    const { selectedMarkerId } = useSelectionStore.getState();
    if (selectedMarkerId) {
      selectMarker(null);
    }

    // Cache scroll container for edge-scrolling
    scrollContainerRef.current = containerRef.current.closest('.timeline-container') as HTMLDivElement | null;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;

    pauseRef.current();
    // Clamp to timeline width minus playhead clearance (prevents playhead from being cut off at edge)
    const maxFrame = Math.round(pixelsToFrameRef.current(Math.max(0, (widthRef.current ?? 0) - PLAYHEAD_CLEARANCE)));
    const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))));
    setCurrentFrameRef.current(frame);
    setIsDragging(true);
  }, [selectMarker]);

  useEffect(() => {
    if (!isDragging) return;

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const scrollContainer = scrollContainerRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const mouseX = e.clientX;

      // Check for edge scrolling
      if (scrollContainer) {
        const viewportRect = scrollContainer.getBoundingClientRect();

        // Left edge: scroll container's left (after track headers)
        const leftEdge = viewportRect.left;
        // Right edge: scroll container's right edge
        const rightEdge = viewportRect.right;

        // Calculate distance past edges OR into edge zone
        // Past edge = positive distance outside viewport
        // In zone = positive distance into the zone from inside viewport
        const distancePastLeft = leftEdge - mouseX;
        const distanceIntoLeftZone = EDGE_SCROLL_ZONE - (mouseX - leftEdge);
        const distancePastRight = mouseX - rightEdge;
        const distanceIntoRightZone = EDGE_SCROLL_ZONE - (rightEdge - mouseX);

        // Check scroll boundaries to avoid sticky behavior when already at edge
        const canScrollLeft = scrollContainer.scrollLeft > 0;
        const canScrollRight = scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth;

        // Trigger left edge scroll if past edge OR in left zone
        if (distancePastLeft > 0 || distanceIntoLeftZone > 0) {
          // Scale zone distance to feel consistent with outside-edge dragging
          const scaledZoneDistance = distanceIntoLeftZone * EDGE_ZONE_MULTIPLIER;
          const effectiveDistance = Math.max(distancePastLeft, scaledZoneDistance);
          if (canScrollLeft) {
            edgeScrollDirectionRef.current = 'left';
            edgeScrollDistanceRef.current = effectiveDistance;
            if (edgeScrollIdRef.current === null) {
              edgeScrollIdRef.current = requestAnimationFrame(runEdgeScroll);
            }
            return; // Edge scroll loop handles playhead position
          } else {
            // Already at left boundary - just clamp to frame 0
            stopEdgeScroll();
            setCurrentFrameRef.current(0);
            return;
          }
        }

        // Trigger right edge scroll if past edge OR in right zone
        if (distancePastRight > 0 || distanceIntoRightZone > 0) {
          // Scale zone distance to feel consistent with outside-edge dragging
          const scaledZoneDistance = distanceIntoRightZone * EDGE_ZONE_MULTIPLIER;
          const effectiveDistance = Math.max(distancePastRight, scaledZoneDistance);
          if (canScrollRight) {
            edgeScrollDirectionRef.current = 'right';
            edgeScrollDistanceRef.current = effectiveDistance;
            if (edgeScrollIdRef.current === null) {
              edgeScrollIdRef.current = requestAnimationFrame(runEdgeScroll);
            }
            return; // Edge scroll loop handles playhead position
          } else {
            // Already at right boundary - position at rightmost point (clamped to timeline width minus clearance)
            stopEdgeScroll();
            const rightEdgeX = scrollContainer.scrollLeft + scrollContainer.clientWidth;
            const maxFrame = Math.round(pixelsToFrameRef.current(Math.max(0, (widthRef.current ?? 0) - PLAYHEAD_CLEARANCE)));
            const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(rightEdgeX))));
            setCurrentFrameRef.current(frame);
            return;
          }
        }

        // Mouse is inside viewport (not in edge zones) - stop any edge scrolling
        stopEdgeScroll();
      }

      // Normal scrubbing - update playhead based on mouse position
      // Clamp to timeline width minus clearance (prevents playhead from being cut off)
      const rect = containerRef.current.getBoundingClientRect();
      const x = mouseX - rect.left;
      const maxFrame = Math.round(pixelsToFrameRef.current(Math.max(0, (widthRef.current ?? 0) - PLAYHEAD_CLEARANCE)));
      const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))));
      setCurrentFrameRef.current(frame);
    };

    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = originalCursor;
      stopEdgeScroll();
    };
  }, [isDragging, runEdgeScroll, stopEdgeScroll]);

  return (
    <div
      ref={containerRef}
      className="h-11 border-b border-border/80 relative"
      onMouseDown={handleMouseDown}
      style={{
        background: 'linear-gradient(to bottom, oklch(0.22 0 0 / 0.30), oklch(0.22 0 0 / 0.20), oklch(0.22 0 0 / 0.10))',
        userSelect: 'none',
        width: width ? `${width}px` : undefined,
        minWidth: width ? `${width}px` : undefined,
      }}
    >
      {/* Tiled canvas container */}
      <div
        ref={tilesContainerRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'none' }}
      />

      {/* Vignette effects */}
      <div
        className="absolute inset-y-0 left-0 w-8 pointer-events-none"
        style={{ background: 'linear-gradient(to right, oklch(0.15 0 0 / 0.15), transparent)' }}
      />
      <div
        className="absolute inset-y-0 right-0 w-8 pointer-events-none"
        style={{ background: 'linear-gradient(to left, oklch(0.15 0 0 / 0.15), transparent)' }}
      />

      {/* Shaded region between in/out points */}
      {inPoint !== null && outPoint !== null && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${timeToPixels(inPoint / fps)}px`,
            width: `${timeToPixels((outPoint - inPoint) / fps)}px`,
            backgroundColor: 'oklch(0.5 0.1 220 / 0.15)',
            borderLeft: '1px solid color-mix(in oklch, var(--color-timeline-in) 50%, transparent)',
            borderRight: '1px solid color-mix(in oklch, var(--color-timeline-out) 50%, transparent)',
            zIndex: 10,
          }}
        />
      )}

      {/* In/Out markers (DOM - only 2 elements) */}
      <TimelineInOutMarkers />

      {/* Project markers (DOM - minimal count) */}
      <TimelineProjectMarkers />
    </div>
  );
});
