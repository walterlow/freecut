import { memo, useEffect, useState, useMemo, useCallback, useRef, type RefCallback } from 'react';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip';
import { resolveMediaUrl, resolveProxyUrl } from '@/features/timeline/deps/media-library-resolver';
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url';
import { filmstripCache, THUMBNAIL_WIDTH } from '../../services/filmstrip-cache';
import { createLogger } from '@/shared/logging/logger';
import { computeFilmstripRenderWindow } from './render-window';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';

const logger = createLogger('ClipFilmstrip');

const ZOOM_SETTLE_MS = 80;
const PRIORITY_PAD_SECONDS = 0.75;
const MAX_PRIORITY_WINDOW_SECONDS = 60;
const MAX_TILES_DURING_ZOOM = 32;
const MAX_TILES_DURING_ZOOM_MID = 24;
const MAX_TILES_DURING_ZOOM_HIGH = 16;
const MAX_TILES_IDLE = 260;
const VIEWPORT_PAD_TILES = 2;
const VIEWPORT_PAD_TILES_INTERACTION = 1;
const VIEWPORT_PAD_PX = 600;
const MID_INTERACTION_PPS = 120;
const HIGH_INTERACTION_PPS = 170;

interface ClipFilmstripProps {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Visible width of the clip in pixels */
  clipWidth: number;
  /** Optional overscan width used to hide trailing-edge width commit lag */
  renderWidth?: number;
  /** Source start time in seconds (for trimmed clips) */
  sourceStart: number;
  /** Total source duration in seconds */
  sourceDuration: number;
  /** Trim start in seconds (how much trimmed from beginning) */
  trimStart: number;
  /** Playback speed multiplier */
  speed: number;
  /** Frames per second */
  fps: number;
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean;
  /** Visible horizontal range within this clip (0-1 ratios) */
  visibleStartRatio?: number;
  visibleEndRatio?: number;
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number;
  /** Disable deferred width/zoom while active edit previews are running */
  preferImmediateRendering?: boolean;
}

/**
 * Find closest frame using binary search
 */
function findClosestFrame(
  frames: FilmstripFrame[],
  targetTime: number,
  maxDistance = Number.POSITIVE_INFINITY,
): FilmstripFrame | null {
  if (frames.length === 0) return null;

  let left = 0;
  let right = frames.length - 1;
  let bestFrame = frames[0]!;
  let bestDiff = Math.abs(bestFrame.timestamp - targetTime);

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const frame = frames[mid]!;
    const diff = Math.abs(frame.timestamp - targetTime);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestFrame = frame;
    }

    if (frame.timestamp < targetTime) {
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return bestDiff <= maxDistance ? bestFrame : null;
}

function getTileStep(tileCount: number, maxTiles: number): number {
  if (tileCount <= maxTiles) return 1;
  return Math.ceil(tileCount / maxTiles);
}

function getInteractionMaxTiles(pixelsPerSecond: number): number {
  if (pixelsPerSecond >= HIGH_INTERACTION_PPS) return MAX_TILES_DURING_ZOOM_HIGH;
  if (pixelsPerSecond >= MID_INTERACTION_PPS) return MAX_TILES_DURING_ZOOM_MID;
  return MAX_TILES_DURING_ZOOM;
}

/**
 * Simple filmstrip tile - memoized to prevent unnecessary re-renders.
 * Renders from ImageBitmap via canvas when available (instant, no JPEG decode),
 * falls back to <img> for blob URL sources (OPFS-loaded frames).
 */
const FilmstripTile = memo(function FilmstripTile({
  src,
  bitmap,
  x,
  height,
  width,
  sourceWidth,
  frameIndex,
  onSourceError,
}: {
  src: string;
  bitmap?: ImageBitmap;
  x: number;
  height: number;
  width: number;
  sourceWidth: number;
  frameIndex: number;
  onSourceError?: (frameIndex: number) => void;
}) {
  const [errorSrc, setErrorSrc] = useState<string | null>(null);

  // Draw bitmap to canvas when ref is attached or bitmap changes
  const canvasRefCallback: RefCallback<HTMLCanvasElement> = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas || !bitmap || bitmap.width === 0 || bitmap.height === 0) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    try {
      if (ctx) ctx.drawImage(bitmap, 0, 0);
    } catch {
      // Bitmap may have been closed/detached by the time React renders
    }
  }, [bitmap]);

  const handleError = useCallback(() => {
    setErrorSrc(src);
    onSourceError?.(frameIndex);
  }, [frameIndex, onSourceError, src]);

  // Bitmap path: render to canvas (instant, no JPEG decode)
  if (bitmap) {
    return (
      <canvas
        ref={canvasRefCallback}
        className="absolute top-0"
        style={{
          left: x,
          width,
          height,
          objectFit: 'cover',
        }}
      />
    );
  }

  // Hide if this specific src failed, but allow new src to try again
  if (!src || errorSrc === src) {
    return null;
  }

  const shouldRepeat = width > sourceWidth + 1;
  if (shouldRepeat) {
    return (
      <div
        aria-hidden
        className="absolute top-0"
        style={{
          left: x,
          width,
          height,
          backgroundImage: `url(${src})`,
          backgroundRepeat: 'repeat-x',
          backgroundSize: `${sourceWidth}px ${height}px`,
          backgroundPosition: 'left top',
        }}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute h-px w-px opacity-0 pointer-events-none"
          onError={handleError}
          style={{ left: 0, top: 0 }}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className="absolute top-0"
      onError={handleError}
      style={{
        left: x,
        width,
        height,
        objectFit: 'cover',
      }}
    />
  );
});

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a tiled filmstrip.
 * Uses adaptive tile density during active zoom to keep interactions responsive
 * without deferring the zoom state itself.
 * Auto-fills container height.
 */
export const ClipFilmstrip = memo(function ClipFilmstrip({
  mediaId,
  clipWidth,
  renderWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  isVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
  preferImmediateRendering = false,
}: ClipFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId);
  const [isZooming, setIsZooming] = useState(false);
  const zoomSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingFrameIndicesRef = useRef<Set<number>>(new Set());
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(mediaId) ?? null);

  const proxyBlobUrl = useMemo(() => {
    if (proxyStatus !== 'ready') {
      return null;
    }
    return resolveProxyUrl(mediaId);
  }, [mediaId, proxyStatus]);
  const filmstripSourceUrl = proxyBlobUrl ?? blobUrl;

  // Measure container height
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const parent = container.parentElement;
      if (parent) {
        setHeight(parent.clientHeight);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(measure);
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Calculate thumbnail width based on height (16:9 aspect ratio)
  const thumbnailWidth = Math.round(height * (16 / 9)) || THUMBNAIL_WIDTH;

  const renderPixelsPerSecond = pixelsPerSecond;
  const visibleClipWidth = clipWidth;
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth);
  const effectiveStart = Math.max(0, sourceStart + trimStart);
  const isInteractionLod = !preferImmediateRendering && isZooming;
  const viewportPadTiles = isInteractionLod ? VIEWPORT_PAD_TILES_INTERACTION : VIEWPORT_PAD_TILES;

  // Track active zoom interaction from pps changes. While active, keep
  // extraction density conservative without decoupling visible tile geometry
  // from the clip itself.
  const lastPpsRef = useRef(pixelsPerSecond);
  useEffect(() => {
    if (preferImmediateRendering) return;
    if (lastPpsRef.current === pixelsPerSecond) return;
    lastPpsRef.current = pixelsPerSecond;

    setIsZooming(true);
    if (zoomSettleTimeoutRef.current) {
      clearTimeout(zoomSettleTimeoutRef.current);
    }
    zoomSettleTimeoutRef.current = setTimeout(() => {
      setIsZooming(false);
      zoomSettleTimeoutRef.current = null;
    }, ZOOM_SETTLE_MS);
  }, [pixelsPerSecond, preferImmediateRendering]);

  // Keep unmount cleanup separate: the zoom-tracking effect above intentionally
  // handles dependency-change behavior (including early returns), and returning
  // cleanup there would run on every change. This effect only clears a pending
  // timeout on unmount so it cannot leak during a settle window.
  useEffect(() => {
    return () => {
      if (zoomSettleTimeoutRef.current) {
        clearTimeout(zoomSettleTimeoutRef.current);
      }
    };
  }, []);

  const renderWindow = useMemo(() => computeFilmstripRenderWindow({
    renderWidth: renderClipWidth,
    visibleWidth: visibleClipWidth,
    tileWidth: thumbnailWidth,
    visibleStartRatio,
    visibleEndRatio,
    minimumPadTiles: viewportPadTiles,
    minimumPadPx: VIEWPORT_PAD_PX,
  }), [
    renderClipWidth,
    visibleClipWidth,
    thumbnailWidth,
    visibleStartRatio,
    visibleEndRatio,
    viewportPadTiles,
  ]);

  // During active edit previews, prioritize the source window that actually
  // maps to the current padded render window, not always the clip's left edge.
  const priorityWindow = useMemo(() => {
    if (isInteractionLod) {
      return null;
    }
    if (sourceDuration <= 0 || renderPixelsPerSecond <= 0 || renderClipWidth <= 0) {
      return null;
    }
    if (renderWindow.paddedEndX <= renderWindow.paddedStartX) {
      return null;
    }

    const unclampedStartTime = Math.max(
      0,
      effectiveStart + (renderWindow.paddedStartX / renderPixelsPerSecond) * speed - PRIORITY_PAD_SECONDS,
    );
    const unclampedEndTime = Math.min(
      sourceDuration,
      effectiveStart + (renderWindow.paddedEndX / renderPixelsPerSecond) * speed + PRIORITY_PAD_SECONDS,
    );
    if (unclampedEndTime <= unclampedStartTime) {
      return null;
    }

    const unclampedSpan = unclampedEndTime - unclampedStartTime;
    if (unclampedSpan <= MAX_PRIORITY_WINDOW_SECONDS) {
      return { startTime: unclampedStartTime, endTime: unclampedEndTime };
    }

    const halfWindow = MAX_PRIORITY_WINDOW_SECONDS * 0.5;
    const centerTime = (unclampedStartTime + unclampedEndTime) * 0.5;
    const maxStartTime = Math.max(0, sourceDuration - MAX_PRIORITY_WINDOW_SECONDS);
    const startTime = Math.min(
      maxStartTime,
      Math.max(0, centerTime - halfWindow),
    );
    const endTime = Math.min(sourceDuration, startTime + MAX_PRIORITY_WINDOW_SECONDS);
    return endTime > startTime ? { startTime, endTime } : null;
  }, [
    sourceDuration,
    renderPixelsPerSecond,
    renderClipWidth,
    speed,
    effectiveStart,
    isInteractionLod,
    renderWindow,
  ]);

  const targetFrameIndices = useMemo(() => {
    if (thumbnailWidth === 0 || renderPixelsPerSecond <= 0) {
      return undefined;
    }

    const { startTile, endTile, paddedEndX } = renderWindow;
    const visibleTileCount = Math.max(0, endTile - startTile);
    if (visibleTileCount <= 0) {
      return undefined;
    }

    const maxTiles = isInteractionLod
      ? getInteractionMaxTiles(renderPixelsPerSecond)
      : MAX_TILES_IDLE;
    const tileStep = getTileStep(visibleTileCount, maxTiles);
    const indices = new Set<number>();

    for (let tile = startTile; tile < endTile; tile += tileStep) {
      const tileX = tile * thumbnailWidth;
      if (tileX >= paddedEndX) {
        break;
      }

      const tileWidth = Math.max(
        1,
        Math.min(renderClipWidth, Math.min((tile + tileStep) * thumbnailWidth, paddedEndX)) - tileX,
      );
      const tileCenterX = tileX + tileWidth * 0.5;
      const tileTime = Math.min(
        sourceDuration,
        Math.max(0, effectiveStart + (tileCenterX / renderPixelsPerSecond) * speed),
      );

      indices.add(Math.max(0, Math.round(tileTime)));
    }

    const normalized = Array.from(indices).sort((a, b) => a - b);
    return normalized.length > 0 ? normalized : undefined;
  }, [
    thumbnailWidth,
    renderPixelsPerSecond,
    renderWindow,
    isInteractionLod,
    renderClipWidth,
    sourceDuration,
    effectiveStart,
    speed,
  ]);

  const targetFrameCount = targetFrameIndices?.length;

  // Load blob URL lazily when visible, and retry after global invalidation.
  useEffect(() => {
    if (!isVisible || !mediaId || proxyBlobUrl || hasStartedLoadingRef.current) {
      return;
    }
    hasStartedLoadingRef.current = true;

    let mounted = true;
    const loadBlobUrl = async () => {
      try {
        const url = await resolveMediaUrl(mediaId);
        if (mounted && url) {
          setBlobUrl(url);
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error);
      }
    };

    loadBlobUrl();

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible, proxyBlobUrl, blobUrlVersion, setBlobUrl]);

  // Use filmstrip hook
  const { frames, isLoading, isComplete, error } = useFilmstrip({
    mediaId,
    blobUrl: filmstripSourceUrl,
    duration: sourceDuration,
    isVisible,
    enabled: !!filmstripSourceUrl && sourceDuration > 0,
    priorityWindow,
    targetFrameCount,
    targetFrameIndices,
  });

  const frameByIndex = useMemo(() => {
    if (!frames || frames.length === 0) return null;
    const map = new Map<number, FilmstripFrame>();
    for (const frame of frames) {
      map.set(frame.index, frame);
    }
    return map;
  }, [frames]);

  const handleFrameSourceError = useCallback((frameIndex: number) => {
    if (!mediaId || refreshingFrameIndicesRef.current.has(frameIndex)) {
      return;
    }

    refreshingFrameIndicesRef.current.add(frameIndex);
    void filmstripCache.refreshFrames(mediaId, [frameIndex])
      .catch((refreshError) => {
        logger.warn('Failed to refresh stale filmstrip frame URL:', refreshError);
      })
      .finally(() => {
        refreshingFrameIndicesRef.current.delete(frameIndex);
      });
  }, [mediaId]);

  // Calculate tiles - maps each tile position to the best frame
  // Visible tiles stay locked to the clip geometry even during zoom; only the
  // extraction request density above is reduced while interaction is active.
  const tiles = useMemo(() => {
    if (!frames || frames.length === 0 || thumbnailWidth === 0 || renderPixelsPerSecond <= 0) return [];

    const tileCount = Math.ceil(renderClipWidth / thumbnailWidth);
    if (tileCount <= 0) return [];

    const { paddedEndX, startTile, endTile } = renderWindow;
    const visibleTileCount = Math.max(0, endTile - startTile);
    if (visibleTileCount <= 0) return [];

    const tileStep = getTileStep(visibleTileCount, MAX_TILES_IDLE);
    const tileDurationSeconds = (thumbnailWidth / renderPixelsPerSecond) * speed;
    const candidateWindowPadSeconds = Math.max(1, tileDurationSeconds * Math.max(2, tileStep));
    const renderStartTime = Math.max(
      0,
      effectiveStart + (renderWindow.paddedStartX / renderPixelsPerSecond) * speed - candidateWindowPadSeconds,
    );
    const renderEndTime = Math.min(
      sourceDuration,
      effectiveStart + (renderWindow.paddedEndX / renderPixelsPerSecond) * speed + candidateWindowPadSeconds,
    );
    const candidateFrames = frames.filter((frame) => (
      frame.timestamp >= renderStartTime && frame.timestamp <= renderEndTime
    ));
    const candidateFrameByIndex = candidateFrames.length === frames.length
      ? frameByIndex
      : new Map(candidateFrames.map((frame) => [frame.index, frame] as const));
    const result: { tileIndex: number; frame: FilmstripFrame; x: number; width: number }[] = [];

    for (let tile = startTile; tile < endTile; tile += tileStep) {
      const tileX = tile * thumbnailWidth;
      if (tileX >= paddedEndX) break;
      const tileWidth = Math.max(
        1,
        Math.min(renderClipWidth, Math.min((tile + tileStep) * thumbnailWidth, paddedEndX)) - tileX
      );
      const tileCenterX = tileX + tileWidth * 0.5;
      const tileTime = effectiveStart + (tileCenterX / renderPixelsPerSecond) * speed;
      const nearestFrameIndex = Math.max(0, Math.round(tileTime));
      const frame = candidateFrameByIndex?.get(nearestFrameIndex)
        ?? findClosestFrame(candidateFrames, tileTime);

      if (frame) {
        result.push({ tileIndex: tile, frame, x: tileX, width: tileWidth });
      }
    }

    return result;
  }, [
    frames,
    frameByIndex,
    renderPixelsPerSecond,
    renderClipWidth,
    visibleClipWidth,
    sourceDuration,
    renderPixelsPerSecond,
    effectiveStart,
    speed,
    thumbnailWidth,
    renderWindow,
  ]);

  if (error) {
    return null;
  }

  // Show skeleton while actively loading.
  if (!frames || frames.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return <div ref={containerRef} className="absolute inset-0" />;
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <FilmstripSkeleton clipWidth={visibleClipWidth} height={height || 40} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Show shimmer skeleton behind while loading */}
      {!isComplete && (
        <FilmstripSkeleton clipWidth={visibleClipWidth} height={height} />
      )}
      <div
        className="absolute inset-0 overflow-hidden pointer-events-none"
      >
        {tiles.map(({ tileIndex, frame, x, width }) => (
          <FilmstripTile
            key={tileIndex}
            src={frame.url}
            bitmap={frame.bitmap}
            x={x}
            height={height}
            width={width}
            sourceWidth={thumbnailWidth}
            frameIndex={frame.index}
            onSourceError={handleFrameSourceError}
          />
        ))}
      </div>
    </div>
  );
});
