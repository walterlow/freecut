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
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { formatTimecode, secondsToFrames } from '@/utils/time-utils';

// Edge-scrolling configuration
const EDGE_SCROLL_MAX_SPEED = 20; // Max pixels per frame at max distance
const EDGE_SCROLL_ACCELERATION = 0.3; // Speed multiplier per pixel of distance
const EDGE_SCROLL_ZONE = 30; // Pixels from edge to trigger scroll (inside viewport)

interface TimelineMarkersProps {
  duration: number; // Total timeline duration in seconds
  width?: number; // Explicit width in pixels (optional)
}

interface MarkerInterval {
  type: 'frame' | 'second' | 'multi-second' | 'minute';
  intervalInSeconds: number;
  minorTicks: number;
}

// Tile configuration - 1000px tiles for faster individual renders and better cache granularity
const TILE_WIDTH = 1000;

// Quantize pixelsPerSecond for cache keys to avoid redrawing on every minor zoom change
// Uses logarithmic steps for perceptually uniform quantization across zoom range
function quantizePPSForCache(pps: number): number {
  // Use log2 steps of ~5% (factor of 1.05) for smooth visual transitions
  // This gives ~14 cache levels per octave of zoom
  const logStep = Math.log2(1.05);
  const quantizedLog = Math.round(Math.log2(pps) / logStep) * logStep;
  return Math.pow(2, quantizedLog);
}

/**
 * Calculate optimal marker interval based on zoom level
 *
 * Thresholds are calibrated for the zoom range (1-200 pps).
 * Labels need ~100px minimum spacing to display timecodes clearly.
 */
function calculateMarkerInterval(pixelsPerSecond: number): MarkerInterval {
  // Frame-level markers (for high zoom levels)
  // At 200 pps: 5 frames = 33px, 10 frames = 67px, 15 frames = 100px
  if (pixelsPerSecond >= 180) {
    // ~100px apart at max zoom - show every 15 frames (0.5 sec at 30fps)
    return { type: 'frame', intervalInSeconds: 15 / 30, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 120) {
    // ~100px apart - show every 25 frames (~0.83 sec)
    return { type: 'frame', intervalInSeconds: 25 / 30, minorTicks: 5 };
  }
  if (pixelsPerSecond >= 80) {
    // 1 second intervals with frame subdivisions
    return { type: 'second', intervalInSeconds: 1, minorTicks: 10 };
  }
  if (pixelsPerSecond >= 50) {
    // 2 second intervals
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
 * Draw tick lines on a single tile canvas (labels rendered separately in DOM for crisp text)
 * Takes pre-computed markerConfig to avoid redundant calculations across tiles
 */
function drawTile(
  canvas: HTMLCanvasElement,
  tileIndex: number,
  tileWidth: number,
  canvasHeight: number,
  markerConfig: MarkerInterval,
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

  // Use pre-computed marker interval (intervalInSeconds is already set correctly in config)
  const intervalInSeconds = markerConfig.intervalInSeconds;
  const markerWidthPx = timeToPixels(intervalInSeconds);

  if (markerWidthPx <= 0) return;

  // Calculate which markers fall within this tile
  // Include one extra marker before tile start to catch minor ticks that extend into the tile
  const startMarkerIndex = Math.max(0, Math.floor(tileOffset / markerWidthPx) - 1);
  const endMarkerIndex = Math.ceil((tileOffset + actualTileWidth) / markerWidthPx);

  // Performance: skip minor ticks when many markers
  const visibleMarkerCount = endMarkerIndex - startMarkerIndex + 1;
  const showMinorTicks = visibleMarkerCount < 100;

  for (let i = startMarkerIndex; i <= endMarkerIndex; i++) {
    const timeInSeconds = i * intervalInSeconds;
    const absoluteX = timeToPixels(timeInSeconds);
    const x = absoluteX - tileOffset; // Convert to tile-relative coordinate

    // Major tick line - only draw if within tile bounds
    if (x >= 0 && x <= actualTileWidth) {
      const lineX = Math.round(x) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, canvasHeight);
      ctx.stroke();
    }

    // Minor ticks - check each tick individually (they may extend from markers outside tile)
    if (showMinorTicks && markerConfig.minorTicks > 0) {
      const tickSpacing = markerWidthPx / markerConfig.minorTicks;

      // Skip if all minor ticks would be outside tile
      const lastTickX = x + tickSpacing * (markerConfig.minorTicks - 1);
      if (lastTickX < 0 || x > actualTileWidth) continue;

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
 * DOM labels for timeline ruler - uses quantized PPS to stay in sync with canvas ticks
 * Renders only visible labels with buffer for smooth scrolling
 */
interface TimelineMarkerLabelsProps {
  scrollLeft: number;
  viewportWidth: number;
  quantizedPPS: number; // Use quantized PPS to match canvas rendering
  fps: number;
}

const LABEL_BUFFER = 100; // Extra pixels to render labels outside viewport

const TimelineMarkerLabels = memo(function TimelineMarkerLabels({
  scrollLeft,
  viewportWidth,
  quantizedPPS,
  fps,
}: TimelineMarkerLabelsProps) {
  // Use quantized PPS directly (same as canvas) - no deferred value needed
  const timeToPixels = (time: number) => time * quantizedPPS;

  const markerConfig = calculateMarkerInterval(quantizedPPS);
  const intervalInSeconds = markerConfig.intervalInSeconds;
  const markerWidthPx = timeToPixels(intervalInSeconds);

  // Fallback for zero viewport (initial render)
  const effectiveViewport = viewportWidth || 1000;

  if (markerWidthPx <= 0) return null;

  // Use actual scroll position - don't clamp too aggressively
  // The scroll position from parent is authoritative; displayWidth may be stale during zoom
  const effectiveScrollLeft = Math.max(0, scrollLeft);

  // Calculate visible range with buffer
  // Start from 0 if scroll is near start, otherwise use scroll position minus buffer
  const startPx = Math.max(0, effectiveScrollLeft - LABEL_BUFFER);
  // End at scroll position + viewport + buffer (labels outside range will just be positioned off-screen)
  const endPx = effectiveScrollLeft + effectiveViewport + LABEL_BUFFER;

  const startIndex = Math.max(0, Math.floor(startPx / markerWidthPx));
  const endIndex = Math.ceil(endPx / markerWidthPx);

  // Early exit if no valid range
  if (endIndex < startIndex) return null;

  // Limit max labels to prevent performance issues at high zoom
  const maxLabels = 100;
  const actualEndIndex = Math.min(endIndex, startIndex + maxLabels);

  const labels: { time: number; x: number; label: string }[] = [];

  for (let i = startIndex; i <= actualEndIndex; i++) {
    const timeInSeconds = i * intervalInSeconds;
    const x = timeToPixels(timeInSeconds);
    const frameNumber = secondsToFrames(timeInSeconds, fps);
    const label = formatTimecode(frameNumber, fps);
    labels.push({ time: timeInSeconds, x, label });
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ contain: 'layout style paint' }}
    >
      {labels.map(({ time, x, label }) => (
        <span
          key={time}
          className="absolute text-[13px] text-white/60 select-none whitespace-nowrap"
          style={{
            left: `${x + 6}px`,
            top: '2px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontFeatureSettings: '"tnum"',
            textShadow: '1px 1px 0 rgba(0, 0, 0, 0.5)',
            transform: 'translateZ(0)', // Force GPU layer for smoother scrolling
            zIndex: 24,
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
})

/**
 * Timeline Markers Component (Tiled Canvas)
 *
 * Uses multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 2000px wide, only visible tiles are rendered.
 */
export const TimelineMarkers = memo(function TimelineMarkers({ duration, width }: TimelineMarkersProps) {
  const { timeToPixels, pixelsPerSecond, pixelsToFrame } = useTimelineZoomContext();
  const fps = useTimelineStore((s) => s.fps);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const markDirty = useTimelineStore((s) => s.markDirty);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const pause = usePlaybackStore((s) => s.pause);
  const selectMarker = useSelectionStore((s) => s.selectMarker);

  const containerRef = useRef<HTMLDivElement>(null);
  const tilesContainerRef = useRef<HTMLDivElement>(null);
  const canvasPoolRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // Bitmap cache keyed by "tileIndex-pps-fps-displayWidth" for instant reuse
  const tileCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const tileCacheVersionRef = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isRangeDragging, setIsRangeDragging] = useState(false);

  // Refs for drag handlers
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame);
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame;
    });
  }, []);
  const markDirtyRef = useRef(markDirty);
  const pauseRef = useRef(pause);
  const fpsRef = useRef(fps);
  const durationRef = useRef(duration);
  const inPointRef = useRef(inPoint);
  const outPointRef = useRef(outPoint);
  const rangeDragStartTimelineXRef = useRef(0);
  const rangeDragStartInRef = useRef(0);
  const rangeDragStartOutRef = useRef(0);
  const rangeDragLastInRef = useRef(0);
  const rangeDragLastOutRef = useRef(0);

  useEffect(() => {
    pixelsToFrameRef.current = pixelsToFrame;
    setCurrentFrameRef.current = setCurrentFrame;
    markDirtyRef.current = markDirty;
    pauseRef.current = pause;
    fpsRef.current = fps;
    durationRef.current = duration;
    inPointRef.current = inPoint;
    outPointRef.current = outPoint;
  }, [pixelsToFrame, setCurrentFrame, markDirty, pause, fps, duration, inPoint, outPoint]);

  // Track viewport and scroll
  const scrollLeftRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Unified scrubbing refs (scroll + playhead in same RAF frame)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrubMouseClientXRef = useRef<number>(0);
  const scrubRAFIdRef = useRef<number | null>(null);
  const isScrubActiveRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Find the actual scroll container (not the sticky parent)
    const scrollContainer = containerRef.current.closest('.timeline-container') as HTMLElement;
    if (!scrollContainer) return;

    const updateViewport = () => {
      // Measure scroll container - that's the actual viewport
      setViewportWidth(scrollContainer.clientWidth);
    };

    const updateScroll = () => {
      const newScrollLeft = scrollContainer.scrollLeft;
      if (newScrollLeft !== scrollLeftRef.current) {
        scrollLeftRef.current = newScrollLeft;
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            setScrollLeft(scrollLeftRef.current);
          });
        }
      }
    };

    updateViewport();
    setScrollLeft(scrollContainer.scrollLeft);

    // Observe scroll container for viewport size changes
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scrollContainer);
    scrollContainer.addEventListener('scroll', updateScroll, { passive: true });

    return () => {
      resizeObserver.disconnect();
      scrollContainer.removeEventListener('scroll', updateScroll);
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

  // Quantize PPS for cache keys - allows cache reuse across similar zoom levels
  // This dramatically reduces redraws during continuous zoom
  const quantizedPPS = quantizePPSForCache(pixelsPerSecond);

  // Cache key uses quantized PPS for better hit rate during zoom
  const cacheKey = `${quantizedPPS.toFixed(4)}-${fps}`;

  // Only clear cache when fps changes (rare) - not on zoom changes
  // Individual tiles are keyed by quantized PPS so old tiles naturally become unused
  const prevFpsRef = useRef(fps);
  useEffect(() => {
    if (prevFpsRef.current !== fps) {
      prevFpsRef.current = fps;
      tileCacheVersionRef.current++;
      const cache = tileCacheRef.current;
      cache.forEach((bitmap) => bitmap.close());
      cache.clear();
    }
  }, [fps]);

  // Limit cache size to prevent memory bloat (LRU-style: clear oldest when over limit)
  // Reduced from 100 to 50 for memory savings
  const MAX_CACHED_TILES = 50;
  useEffect(() => {
    const cache = tileCacheRef.current;
    if (cache.size > MAX_CACHED_TILES) {
      // Remove oldest entries (first in map iteration order)
      const entriesToRemove = cache.size - MAX_CACHED_TILES;
      let removed = 0;
      for (const [key, bitmap] of cache) {
        if (removed >= entriesToRemove) break;
        bitmap.close();
        cache.delete(key);
        removed++;
      }
    }
  });

  // Tiled canvas rendering effect with caching
  useEffect(() => {
    if (!tilesContainerRef.current) return;

    const tilesContainer = tilesContainerRef.current;
    const canvasPool = canvasPoolRef.current;
    const tileCache = tileCacheRef.current;
    const visibleTileIndices = new Set<number>();
    const dpr = window.devicePixelRatio || 1;

    // Use quantized values for rendering so tiles match cache keys
    const renderPPS = quantizedPPS;
    const renderTimeToPixels = (time: number) => time * renderPPS;

    // Pre-compute marker config once for all tiles (avoids redundant calculations)
    const markerConfig = calculateMarkerInterval(renderPPS);

    // Render visible tiles
    for (let tileIndex = startTile; tileIndex <= endTile; tileIndex++) {
      visibleTileIndices.add(tileIndex);

      let canvas = canvasPool.get(tileIndex);

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.willChange = 'transform';
        canvasPool.set(tileIndex, canvas);
        tilesContainer.appendChild(canvas);
      }

      // Position tile using transform (compositor-only, avoids layout recalculation)
      canvas.style.transform = `translateX(${tileIndex * TILE_WIDTH}px)`;

      // Check cache for pre-rendered bitmap
      const tileCacheKey = `${tileIndex}-${cacheKey}`;
      const cachedBitmap = tileCache.get(tileCacheKey);

      if (cachedBitmap) {
        // Use cached bitmap - much faster than redrawing
        const tileOffset = tileIndex * TILE_WIDTH;
        const actualTileWidth = Math.min(TILE_WIDTH, displayWidth - tileOffset);
        canvas.width = Math.ceil(actualTileWidth * dpr);
        canvas.height = Math.ceil(canvasHeight * dpr);
        canvas.style.width = `${actualTileWidth}px`;
        canvas.style.height = `${canvasHeight}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(cachedBitmap, 0, 0);
        }
      } else {
        // Draw and cache the tile using quantized PPS for cache consistency
        drawTile(
          canvas,
          tileIndex,
          TILE_WIDTH,
          canvasHeight,
          markerConfig,
          renderTimeToPixels,
          displayWidth
        );

        // Cache the rendered tile as ImageBitmap (async, non-blocking)
        createImageBitmap(canvas).then((bitmap) => {
          // Only cache if parameters haven't changed
          if (tileCacheRef.current === tileCache) {
            tileCache.set(tileCacheKey, bitmap);
          } else {
            bitmap.close();
          }
        }).catch(() => {
          // Ignore errors (e.g., if canvas is empty or too small)
        });
      }
    }

    // Remove tiles that are no longer visible
    canvasPool.forEach((canvas, tileIndex) => {
      if (!visibleTileIndices.has(tileIndex)) {
        canvas.remove();
        canvasPool.delete(tileIndex);
      }
    });

    // Pre-render adjacent tiles during idle time for smoother scrolling
    const maxTile = Math.ceil(displayWidth / TILE_WIDTH) - 1;
    const adjacentTiles = [startTile - 1, endTile + 1].filter(
      (t) => t >= 0 && t <= maxTile && !tileCache.has(`${t}-${cacheKey}`)
    );

    if (adjacentTiles.length > 0) {
      const idleCallback = requestIdleCallback(
        (deadline) => {
          for (const tileIndex of adjacentTiles) {
            // Check if we still have time and cache hasn't changed
            if (deadline.timeRemaining() < 10) break;
            if (tileCacheRef.current !== tileCache) break;

            const tileCacheKey = `${tileIndex}-${cacheKey}`;
            if (tileCache.has(tileCacheKey)) continue;

            // Create offscreen canvas for pre-rendering (use quantized values)
            const offscreen = document.createElement('canvas');
            drawTile(
              offscreen,
              tileIndex,
              TILE_WIDTH,
              canvasHeight,
              markerConfig,
              renderTimeToPixels,
              displayWidth
            );

            // Cache the pre-rendered tile
            createImageBitmap(offscreen)
              .then((bitmap) => {
                if (tileCacheRef.current === tileCache) {
                  tileCache.set(tileCacheKey, bitmap);
                } else {
                  bitmap.close();
                }
              })
              .catch(() => {});
          }
        },
        { timeout: 500 }
      );

      return () => cancelIdleCallback(idleCallback);
    }
  }, [startTile, endTile, quantizedPPS, fps, displayWidth, canvasHeight, cacheKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      canvasPoolRef.current.forEach((canvas) => canvas.remove());
      canvasPoolRef.current.clear();
      // Clean up cached bitmaps
      tileCacheRef.current.forEach((bitmap) => bitmap.close());
      tileCacheRef.current.clear();
    };
  }, []);

  /**
   * Unified scrub loop - handles BOTH edge scroll AND playhead in same RAF frame
   * This ensures scroll and playhead are always perfectly synchronized
   */
  const runUnifiedScrubLoop = useCallback(() => {
    if (!isScrubActiveRef.current || !containerRef.current) {
      scrubRAFIdRef.current = null;
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    const mouseClientX = scrubMouseClientXRef.current;

    // --- STEP 1: Calculate and apply edge scroll ---
    if (scrollContainer) {
      const viewportRect = scrollContainer.getBoundingClientRect();
      const leftEdge = viewportRect.left;
      const rightEdge = viewportRect.right;

      // Distance calculations
      const distancePastLeft = leftEdge - mouseClientX;
      const distancePastRight = mouseClientX - rightEdge;
      const distanceFromLeftEdge = mouseClientX - leftEdge;
      const distanceFromRightEdge = rightEdge - mouseClientX;

      // Check scroll boundaries
      const canScrollLeft = scrollContainer.scrollLeft > 0;
      const canScrollRight = scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth;

      // Left edge: past edge OR in zone
      const inLeftZone = distanceFromLeftEdge >= 0 && distanceFromLeftEdge < EDGE_SCROLL_ZONE;
      const pastLeftEdge = distancePastLeft > 0;

      if ((pastLeftEdge || inLeftZone) && canScrollLeft) {
        const distance = pastLeftEdge
          ? distancePastLeft
          : (EDGE_SCROLL_ZONE - distanceFromLeftEdge) * 0.5;
        const speed = Math.min(distance * EDGE_SCROLL_ACCELERATION, EDGE_SCROLL_MAX_SPEED);
        scrollContainer.scrollLeft -= speed;
      }

      // Right edge: past edge OR in zone
      const inRightZone = distanceFromRightEdge >= 0 && distanceFromRightEdge < EDGE_SCROLL_ZONE;
      const pastRightEdge = distancePastRight > 0;

      if ((pastRightEdge || inRightZone) && canScrollRight) {
        const distance = pastRightEdge
          ? distancePastRight
          : (EDGE_SCROLL_ZONE - distanceFromRightEdge) * 0.5;
        const speed = Math.min(distance * EDGE_SCROLL_ACCELERATION, EDGE_SCROLL_MAX_SPEED);
        scrollContainer.scrollLeft += speed;
      }
    }

    // --- STEP 2: Update playhead with FRESH position ---
    // Calculate position relative to scroll container + scroll offset
    // This correctly handles when mouse is over track headers (left of timeline)
    let x: number;

    if (scrollContainer) {
      const scrollContainerRect = scrollContainer.getBoundingClientRect();
      // Position relative to visible viewport left edge + scroll offset = timeline position
      x = (mouseClientX - scrollContainerRect.left) + scrollContainer.scrollLeft;
    } else {
      // Fallback to container rect
      const containerRect = containerRef.current.getBoundingClientRect();
      x = mouseClientX - containerRect.left;
    }

    // Calculate frame (pixel-perfect: round to whole frames)
    const maxFrame = Math.floor(durationRef.current * fpsRef.current);
    const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))));

    // Update playhead and gray playhead
    setCurrentFrameRef.current(frame);
    setPreviewFrameRef.current(frame);

    // --- STEP 3: Continue loop while scrubbing ---
    scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop);
  }, []);

  const getTimelineXFromClientX = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0;

    const scrollContainer = containerRef.current.closest('.timeline-container') as HTMLDivElement | null;
    if (scrollContainer) {
      const scrollContainerRect = scrollContainer.getBoundingClientRect();
      return (clientX - scrollContainerRect.left) + scrollContainer.scrollLeft;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    return clientX - containerRect.left;
  }, []);

  const handleRangeMouseDown = useCallback((e: React.MouseEvent) => {
    if (inPointRef.current === null || outPointRef.current === null) return;

    e.preventDefault();
    e.stopPropagation();

    rangeDragStartTimelineXRef.current = getTimelineXFromClientX(e.clientX);
    rangeDragStartInRef.current = inPointRef.current;
    rangeDragStartOutRef.current = outPointRef.current;
    rangeDragLastInRef.current = inPointRef.current;
    rangeDragLastOutRef.current = outPointRef.current;

    setIsRangeDragging(true);
  }, [getTimelineXFromClientX]);

  // Scrubbing handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent click from bubbling to container and clearing selection
    if (!containerRef.current) return;

    // Clear marker selection when clicking on ruler (only if a marker is selected)
    const { selectedMarkerId } = useSelectionStore.getState();
    if (selectedMarkerId) {
      selectMarker(null);
    }

    // Cache scroll container for edge-scrolling
    scrollContainerRef.current = containerRef.current.closest('.timeline-container') as HTMLDivElement | null;

    // Initialize unified scrub state
    scrubMouseClientXRef.current = e.clientX;
    isScrubActiveRef.current = true;

    pauseRef.current();

    // Immediate frame update on click (instant response)
    // Use scroll container position + scroll offset for accurate timeline position
    let x: number;
    if (scrollContainerRef.current) {
      const scrollContainerRect = scrollContainerRef.current.getBoundingClientRect();
      x = (e.clientX - scrollContainerRect.left) + scrollContainerRef.current.scrollLeft;
    } else {
      const rect = containerRef.current.getBoundingClientRect();
      x = e.clientX - rect.left;
    }
    const maxFrame = Math.floor(durationRef.current * fpsRef.current);
    const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))));
    setCurrentFrameRef.current(frame);
    setPreviewFrameRef.current(frame);

    setIsDragging(true);

    // Start unified RAF loop
    if (scrubRAFIdRef.current === null) {
      scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop);
    }
  }, [selectMarker, runUnifiedScrubLoop]);

  useEffect(() => {
    if (!isDragging) return;

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'grabbing';

    const handleMouseMove = (e: MouseEvent) => {
      // Just store position - the unified RAF loop handles everything else
      scrubMouseClientXRef.current = e.clientX;
    };

    const handleMouseUp = () => {
      // Stop the unified scrub loop
      isScrubActiveRef.current = false;
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current);
        scrubRAFIdRef.current = null;
      }
      setIsDragging(false);
      setPreviewFrameRef.current(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = originalCursor;
      // Ensure cleanup
      isScrubActiveRef.current = false;
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current);
        scrubRAFIdRef.current = null;
      }
    };
  }, [isDragging]);

  // Drag entire in/out range together (preserves selected span length)
  useEffect(() => {
    if (!isRangeDragging) return;

    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = 'move';

    const handleMouseMove = (e: MouseEvent) => {
      const currentTimelineX = getTimelineXFromClientX(e.clientX);
      const deltaFrames = Math.round(
        pixelsToFrameRef.current(currentTimelineX) - pixelsToFrameRef.current(rangeDragStartTimelineXRef.current)
      );

      const startIn = rangeDragStartInRef.current;
      const startOut = rangeDragStartOutRef.current;
      const span = Math.max(1, startOut - startIn);
      const maxFrame = Math.floor(durationRef.current * fpsRef.current);
      const maxIn = Math.max(0, maxFrame - span);
      const nextIn = Math.max(0, Math.min(startIn + deltaFrames, maxIn));
      const nextOut = nextIn + span;

      // Skip redundant writes while dragging
      if (nextIn === rangeDragLastInRef.current && nextOut === rangeDragLastOutRef.current) {
        return;
      }

      useTimelineStore.setState({ inPoint: nextIn, outPoint: nextOut });
      rangeDragLastInRef.current = nextIn;
      rangeDragLastOutRef.current = nextOut;
    };

    const handleMouseUp = () => {
      setIsRangeDragging(false);
      markDirtyRef.current();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = originalCursor;
    };
  }, [isRangeDragging, getTimelineXFromClientX]);

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
      {/* Tiled canvas container (tick lines only) */}
      <div
        ref={tilesContainerRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'none' }}
      />

      {/* DOM labels layer - uses same quantized PPS as canvas for sync */}
      <TimelineMarkerLabels
        scrollLeft={scrollLeft}
        viewportWidth={viewportWidth}
        quantizedPPS={quantizedPPS}
        fps={fps}
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

      {/* Full ruler highlight between in/out points */}
      {inPoint !== null && outPoint !== null && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none"
          style={{
            left: `${timeToPixels(inPoint / fps)}px`,
            width: `${Math.max(2, timeToPixels((outPoint - inPoint) / fps))}px`,
            backgroundColor: 'oklch(0.50 0.10 220 / 0.16)',
            borderLeft: '1px solid color-mix(in oklch, var(--color-timeline-io-range-border) 45%, transparent)',
            borderRight: '1px solid color-mix(in oklch, var(--color-timeline-io-range-border) 45%, transparent)',
            zIndex: 9,
          }}
        />
      )}

      {/* Draggable in/out strip */}
      {inPoint !== null && outPoint !== null && (
        <div
          className="absolute top-0 bottom-0 cursor-move"
          onMouseDown={handleRangeMouseDown}
          style={{
            left: `${timeToPixels(inPoint / fps)}px`,
            top: '23px',
            height: '20px',
            width: `${Math.max(2, timeToPixels((outPoint - inPoint) / fps))}px`,
            background:
              'linear-gradient(to bottom, var(--color-timeline-io-range-fill), color-mix(in oklch, var(--color-timeline-io-range-fill) 82%, black))',
            border: '1px solid var(--color-timeline-io-range-border)',
            borderRadius: '2px',
            boxShadow:
              'inset 0 1px 0 color-mix(in oklch, white 22%, transparent), 0 0 8px var(--color-timeline-io-range-glow)',
            zIndex: 11,
            pointerEvents: 'auto',
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
