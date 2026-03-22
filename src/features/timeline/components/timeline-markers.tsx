// React and external libraries
import { useCallback, useRef, useState, useEffect, memo } from 'react';

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSelectionStore } from '@/shared/state/selection';

// Components
import { TimelineInOutMarkers } from './timeline-in-out-markers';
import { TimelineProjectMarkers } from './timeline-project-markers';
import { useSettingsStore } from '@/features/timeline/deps/settings';

// Utilities and hooks
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { formatTimecode, secondsToFrames } from '@/utils/time-utils';
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle';
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/shared/ui/editor-layout';

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
const MAX_VISIBLE_MINOR_MARKERS = 72;
const MIN_MINOR_TICK_SPACING_PX = 14;

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
    return { type: 'frame', intervalInSeconds: 15 / 30, minorTicks: 3 };
  }
  if (pixelsPerSecond >= 120) {
    // ~100px apart - show every 25 frames (~0.83 sec)
    return { type: 'frame', intervalInSeconds: 25 / 30, minorTicks: 3 };
  }
  if (pixelsPerSecond >= 80) {
    // 1 second intervals with frame subdivisions
    return { type: 'second', intervalInSeconds: 1, minorTicks: 4 };
  }
  if (pixelsPerSecond >= 50) {
    // 2 second intervals
    return { type: 'multi-second', intervalInSeconds: 2, minorTicks: 2 };
  }
  if (pixelsPerSecond >= 24) {
    return { type: 'multi-second', intervalInSeconds: 5, minorTicks: 2 };
  }
  if (pixelsPerSecond >= 12) {
    return { type: 'multi-second', intervalInSeconds: 10, minorTicks: 2 };
  }
  if (pixelsPerSecond >= 4) {
    return { type: 'multi-second', intervalInSeconds: 30, minorTicks: 3 };
  }
  if (pixelsPerSecond >= 2) {
    return { type: 'minute', intervalInSeconds: 60, minorTicks: 3 };
  }
  if (pixelsPerSecond >= 1) {
    return { type: 'minute', intervalInSeconds: 120, minorTicks: 2 };
  }
  if (pixelsPerSecond >= 0.5) {
    return { type: 'minute', intervalInSeconds: 300, minorTicks: 2 };
  }
  if (pixelsPerSecond >= 0.2) {
    return { type: 'minute', intervalInSeconds: 600, minorTicks: 3 };
  }
  return { type: 'minute', intervalInSeconds: 1800, minorTicks: 2 };
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
  const minorTickTop = canvasHeight - 16;
  const minorTickBottom = canvasHeight - 8;

  if (markerWidthPx <= 0) return;

  // Calculate which markers fall within this tile
  // Include one extra marker before tile start to catch minor ticks that extend into the tile
  const startMarkerIndex = Math.max(0, Math.floor(tileOffset / markerWidthPx) - 1);
  const endMarkerIndex = Math.ceil((tileOffset + actualTileWidth) / markerWidthPx);

  // Keep the ruler readable by hiding sub-markers when spacing gets too tight.
  const visibleMarkerCount = endMarkerIndex - startMarkerIndex + 1;
  const tickSpacing = markerConfig.minorTicks > 0
    ? markerWidthPx / markerConfig.minorTicks
    : 0;
  const showMinorTicks = (
    markerConfig.minorTicks > 0
    && visibleMarkerCount < MAX_VISIBLE_MINOR_MARKERS
    && tickSpacing >= MIN_MINOR_TICK_SPACING_PX
  );

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
    if (showMinorTicks) {
      // Skip if all minor ticks would be outside tile
      const lastTickX = x + tickSpacing * (markerConfig.minorTicks - 1);
      if (lastTickX < 0 || x > actualTileWidth) continue;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;

      for (let j = 1; j < markerConfig.minorTicks; j++) {
        const tickX = Math.round(x + tickSpacing * j) + 0.5;
        if (tickX < 0 || tickX > actualTileWidth) continue;

        ctx.beginPath();
        ctx.moveTo(tickX, minorTickTop);
        ctx.lineTo(tickX, minorTickBottom);
        ctx.stroke();
      }
    }
  }
}

/**
 * DOM labels for timeline ruler - uses quantized PPS to stay in sync with canvas ticks
 * Renders only visible labels with buffer for smooth scrolling
 */
const LABEL_BUFFER = 100; // Extra pixels to render labels outside viewport
const MAX_LABELS = 100;

/**
 * Tracks the config that was used to position existing pooled labels.
 * When PPS/FPS haven't changed, labels are absolutely positioned within
 * the scrolling container — their position is stable across scroll. We
 * only need to add/remove labels at the viewport edges, not update all
 * existing ones. When PPS or FPS changes we must update every label.
 */
let _labelConfigPPS = 0;
let _labelConfigFPS = 0;

/**
 * Imperative label pool — manages timecode `<span>` elements via direct DOM
 * manipulation instead of React reconciliation. Labels are absolutely positioned
 * within the scrolling container so the browser handles scroll offset natively;
 * the pool only adds/removes elements as they enter/leave the visible range.
 *
 * Called from the scroll RAF callback (zero React re-renders on scroll).
 * Also called on zoom/fps changes to rebuild with new intervals.
 *
 * Optimization: during pure scroll (no zoom/fps change), existing labels
 * keep their position — only edge additions/removals mutate the DOM.
 * This cuts ~60 DOM mutations per scroll frame to ~2-4.
 */
function syncLabels(
  container: HTMLDivElement,
  pool: Map<number, HTMLSpanElement>,
  scrollLeft: number,
  viewportWidth: number,
  quantizedPPS: number,
  fps: number
) {
  const markerConfig = calculateMarkerInterval(quantizedPPS);
  const intervalInSeconds = markerConfig.intervalInSeconds;
  const markerWidthPx = intervalInSeconds * quantizedPPS;

  if (markerWidthPx <= 0) return;

  const configChanged = quantizedPPS !== _labelConfigPPS || fps !== _labelConfigFPS;
  if (configChanged) {
    _labelConfigPPS = quantizedPPS;
    _labelConfigFPS = fps;
  }

  const effectiveViewport = viewportWidth || 1000;
  const startPx = Math.max(0, scrollLeft - LABEL_BUFFER);
  const endPx = scrollLeft + effectiveViewport + LABEL_BUFFER;

  const startIndex = Math.max(0, Math.floor(startPx / markerWidthPx));
  const endIndex = Math.min(
    Math.ceil(endPx / markerWidthPx),
    startIndex + MAX_LABELS
  );

  const visibleIndices = new Set<number>();

  for (let i = startIndex; i <= endIndex; i++) {
    visibleIndices.add(i);

    let span = pool.get(i);
    const isNew = !span;
    if (!span) {
      span = document.createElement('span');
      span.className = 'absolute text-xs text-white/60 select-none whitespace-nowrap';
      span.style.top = '2px';
      span.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      span.style.fontFeatureSettings = '"tnum"';
      span.style.textShadow = '1px 1px 0 rgba(0, 0, 0, 0.5)';
      span.style.zIndex = '24';
      container.appendChild(span);
      pool.set(i, span);
    }

    // Only set position + text when necessary:
    // - New labels always need it
    // - Config change (PPS/FPS) means existing labels have stale positions
    // During pure scroll, labels are absolutely positioned in the scrolling
    // container so their coordinates are stable — no DOM writes needed.
    if (isNew || configChanged) {
      const timeInSeconds = i * intervalInSeconds;
      span.style.left = `${timeInSeconds * quantizedPPS + 6}px`;
      span.textContent = formatTimecode(secondsToFrames(timeInSeconds, fps), fps);
    }
  }

  // Remove labels that scrolled out of range
  pool.forEach((span, index) => {
    if (!visibleIndices.has(index)) {
      span.remove();
      pool.delete(index);
    }
  });
}

/** Clear all pooled labels (called on zoom/fps change before rebuilding). */
function clearLabelPool(pool: Map<number, HTMLSpanElement>) {
  pool.forEach((span) => span.remove());
  pool.clear();
}

/**
 * Timeline Markers Component (Tiled Canvas)
 *
 * Uses multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 2000px wide, only visible tiles are rendered.
 */
export const TimelineMarkers = memo(function TimelineMarkers({ duration, width }: TimelineMarkersProps) {
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);
  const { timeToPixels, pixelsPerSecond, pixelsToFrame } = useTimelineZoomContext();
  const fps = useTimelineStore((s) => s.fps);
  const inPoint = useTimelineStore((s) => s.inPoint);
  const outPoint = useTimelineStore((s) => s.outPoint);
  const markDirty = useTimelineStore((s) => s.markDirty);
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame);
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame);
  const pause = usePlaybackStore((s) => s.pause);
  const selectMarker = useSelectionStore((s) => s.selectMarker);

  const containerRef = useRef<HTMLDivElement>(null);
  const tilesContainerRef = useRef<HTMLDivElement>(null);
  const canvasPoolRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  // Bitmap cache keyed by "tileIndex-pps-fps-displayWidth" for instant reuse
  const tileCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const tileCacheVersionRef = useRef(0);
  const labelsContainerRef = useRef<HTMLDivElement>(null);
  const labelPoolRef = useRef<Map<number, HTMLSpanElement>>(new Map());
  const [viewportWidth, setViewportWidth] = useState(0);
  // scrollLeft is ref-only — never React state. Tile + label updates are
  // driven imperatively from the scroll RAF callback, bypassing React render.
  const [isDragging, setIsDragging] = useState(false);
  const [isRangeDragging, setIsRangeDragging] = useState(false);

  // Refs for drag handlers
  const pixelsToFrameRef = useRef(pixelsToFrame);
  const setCurrentFrameRef = useRef(setCurrentFrame);
  const setScrubFrameRef = useRef(setScrubFrame);
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame);
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame;
    });
  }, []);
  const markDirtyRef = useRef(markDirty);
  const pauseRef = useRef(pause);
  const fpsRef = useRef(fps);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
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
    setScrubFrameRef.current = setScrubFrame;
    markDirtyRef.current = markDirty;
    pauseRef.current = pause;
    fpsRef.current = fps;
    pixelsPerSecondRef.current = pixelsPerSecond;
    durationRef.current = duration;
    inPointRef.current = inPoint;
    outPointRef.current = outPoint;
  }, [pixelsToFrame, setCurrentFrame, setScrubFrame, markDirty, pause, fps, pixelsPerSecond, duration, inPoint, outPoint]);

  // Track viewport and scroll
  const scrollLeftRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  // Unified scrubbing refs (scroll + playhead in same RAF frame)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrubMouseClientXRef = useRef<number>(0);
  const scrubRAFIdRef = useRef<number | null>(null);
  const isScrubActiveRef = useRef(false);
  const scrubThrottleStateRef = useRef(createScrubThrottleState());

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
            syncRulerScroll();
          });
        }
      }
    };

    updateViewport();
    scrollLeftRef.current = scrollContainer.scrollLeft;
    // Initial sync is deferred to the config-change effect (runs after first render)

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
  const canvasHeight = editorLayout.timelineRulerHeight;

  // Quantize PPS for cache keys - allows cache reuse across similar zoom levels
  // This dramatically reduces redraws during continuous zoom
  const quantizedPPS = quantizePPSForCache(pixelsPerSecond);

  // Cache key uses quantized PPS for better hit rate during zoom
  const cacheKey = `${quantizedPPS.toFixed(4)}-${fps}`;

  // Store config in refs so the imperative scroll handler can access them
  const displayWidthRef = useRef(displayWidth);
  const canvasHeightRef = useRef(canvasHeight);
  const quantizedPPSRef = useRef(quantizedPPS);
  const cacheKeyRef = useRef(cacheKey);
  const viewportWidthRef = useRef(viewportWidth);
  displayWidthRef.current = displayWidth;
  canvasHeightRef.current = canvasHeight;
  quantizedPPSRef.current = quantizedPPS;
  cacheKeyRef.current = cacheKey;
  viewportWidthRef.current = viewportWidth;

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

  /**
   * Imperative scroll sync — manages canvas tiles AND labels without any
   * React state or re-renders. Called from:
   *  - scroll RAF callback (every scroll frame)
   *  - config change effect (zoom / fps / width)
   *  - initial mount
   */
  const syncRulerScroll = useCallback(() => {
    const tilesContainer = tilesContainerRef.current;
    const labelsContainer = labelsContainerRef.current;
    if (!tilesContainer) return;

    const sl = scrollLeftRef.current;
    const vw = viewportWidthRef.current;
    const dw = displayWidthRef.current;
    const ch = canvasHeightRef.current;
    const qPPS = quantizedPPSRef.current;
    const ck = cacheKeyRef.current;

    // ── Tile visibility ──
    const startTile = Math.max(0, Math.floor(sl / TILE_WIDTH));
    const endTile = Math.min(
      Math.ceil(dw / TILE_WIDTH) - 1,
      Math.ceil((sl + vw) / TILE_WIDTH)
    );

    const canvasPool = canvasPoolRef.current;
    const tileCache = tileCacheRef.current;
    const visibleTileIndices = new Set<number>();
    const dpr = window.devicePixelRatio || 1;
    const renderTimeToPixels = (time: number) => time * qPPS;
    const markerConfig = calculateMarkerInterval(qPPS);

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
        canvas.style.transform = `translateX(${tileIndex * TILE_WIDTH}px)`;
        canvasPool.set(tileIndex, canvas);
        tilesContainer.appendChild(canvas);
      }
      // Existing canvases keep their transform — tileIndex is stable per pool entry

      const tileCacheKey = `${tileIndex}-${ck}`;

      // Skip redraw if this canvas already shows the correct content.
      // data-ck tracks the cache key used for the last successful paint.
      if (canvas.dataset.ck === tileCacheKey) continue;

      const cachedBitmap = tileCache.get(tileCacheKey);

      if (cachedBitmap) {
        const tileOffset = tileIndex * TILE_WIDTH;
        const actualTileWidth = Math.min(TILE_WIDTH, dw - tileOffset);
        canvas.width = Math.ceil(actualTileWidth * dpr);
        canvas.height = Math.ceil(ch * dpr);
        canvas.style.width = `${actualTileWidth}px`;
        canvas.style.height = `${ch}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(cachedBitmap, 0, 0);
        canvas.dataset.ck = tileCacheKey;
      } else {
        drawTile(canvas, tileIndex, TILE_WIDTH, ch, markerConfig, renderTimeToPixels, dw);
        canvas.dataset.ck = tileCacheKey;
        createImageBitmap(canvas)
          .then((bitmap) => {
            if (tileCacheRef.current === tileCache) {
              tileCache.set(tileCacheKey, bitmap);
            } else {
              bitmap.close();
            }
          })
          .catch(() => {});
      }
    }

    // Remove tiles that scrolled out of range
    canvasPool.forEach((canvas, tileIndex) => {
      if (!visibleTileIndices.has(tileIndex)) {
        canvas.remove();
        canvasPool.delete(tileIndex);
      }
    });

    // Pre-render adjacent tiles during idle
    const maxTile = Math.ceil(dw / TILE_WIDTH) - 1;
    const adjacentTiles = [startTile - 1, endTile + 1].filter(
      (t) => t >= 0 && t <= maxTile && !tileCache.has(`${t}-${ck}`)
    );
    if (adjacentTiles.length > 0) {
      requestIdleCallback(
        (deadline) => {
          for (const adj of adjacentTiles) {
            if (deadline.timeRemaining() < 10 || tileCacheRef.current !== tileCache) break;
            const adjKey = `${adj}-${ck}`;
            if (tileCache.has(adjKey)) continue;
            const offscreen = document.createElement('canvas');
            drawTile(offscreen, adj, TILE_WIDTH, ch, markerConfig, renderTimeToPixels, dw);
            createImageBitmap(offscreen)
              .then((bitmap) => {
                if (tileCacheRef.current === tileCache) tileCache.set(adjKey, bitmap);
                else bitmap.close();
              })
              .catch(() => {});
          }
        },
        { timeout: 500 }
      );
    }

    // ── Labels ──
    if (labelsContainer) {
      syncLabels(labelsContainer, labelPoolRef.current, sl, vw, qPPS, fpsRef.current);
    }
  }, []);

  // Trigger sync on config changes (zoom, fps, width, height).
  // Labels update in-place (position + text) — no clear needed.
  useEffect(() => {
    syncRulerScroll();
  }, [quantizedPPS, fps, displayWidth, canvasHeight, viewportWidth, syncRulerScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      canvasPoolRef.current.forEach((canvas) => canvas.remove());
      canvasPoolRef.current.clear();
      // Clean up cached bitmaps
      tileCacheRef.current.forEach((bitmap) => bitmap.close());
      tileCacheRef.current.clear();
      // Clean up label pool
      clearLabelPool(labelPoolRef.current);
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

    const nowMs = performance.now();
    if (shouldCommitScrubFrame({
      state: scrubThrottleStateRef.current,
      pointerX: x,
      targetFrame: frame,
      pixelsPerSecond: pixelsPerSecondRef.current,
      nowMs,
    })) {
      setScrubFrameRef.current(frame);
    }

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
    setScrubFrameRef.current(frame);
    scrubThrottleStateRef.current = createScrubThrottleState({
      pointerX: x,
      frame,
      nowMs: performance.now(),
    });

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
      className="border-b border-border/80 relative"
      onMouseDown={handleMouseDown}
      style={{
        background: 'linear-gradient(to bottom, oklch(0.22 0 0 / 0.30), oklch(0.22 0 0 / 0.20), oklch(0.22 0 0 / 0.10))',
        userSelect: 'none',
        height: EDITOR_LAYOUT_CSS_VALUES.timelineRulerHeight,
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

      {/* Imperative label pool — managed by syncRulerScroll, zero React re-renders on scroll */}
      <div
        ref={labelsContainerRef}
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ contain: 'layout style paint' }}
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
          className="absolute cursor-move"
          onMouseDown={handleRangeMouseDown}
          style={{
            left: `${timeToPixels(inPoint / fps)}px`,
            bottom: '0px',
            height: '14px',
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
