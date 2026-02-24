import { memo, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip';
import { resolveMediaUrl } from '@/features/preview/utils/media-resolver';
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url';
import { THUMBNAIL_WIDTH } from '../../services/filmstrip-cache';

const ZOOM_SETTLE_MS = 80;
const PRIORITY_PAD_SECONDS = 0.75;
const MAX_PRIORITY_WINDOW_SECONDS = 60;
const MAX_TILES_DURING_ZOOM = 64;
const MAX_TILES_IDLE = 220;

interface ClipFilmstripProps {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Width of the clip in pixels */
  clipWidth: number;
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
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number;
  /** Disable deferred width/zoom while active edit previews are running */
  preferImmediateRendering?: boolean;
}

/**
 * Find closest frame using binary search
 */
function findClosestFrame(frames: FilmstripFrame[], targetTime: number): FilmstripFrame | null {
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

  return bestFrame;
}

function getTileStep(tileCount: number, maxTiles: number): number {
  if (tileCount <= maxTiles) return 1;
  return Math.ceil(tileCount / maxTiles);
}

/**
 * Simple filmstrip tile - memoized to prevent unnecessary re-renders
 * Hides itself on error to avoid broken image icons
 */
const FilmstripTile = memo(function FilmstripTile({
  src,
  x,
  height,
  width,
  sourceWidth,
}: {
  src: string;
  x: number;
  height: number;
  width: number;
  sourceWidth: number;
}) {
  const [errorSrc, setErrorSrc] = useState<string | null>(null);

  const handleError = useCallback(() => {
    setErrorSrc(src);
  }, [src]);

  // Hide if this specific src failed, but allow new src to try again
  if (errorSrc === src) {
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
      />
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
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  isVisible,
  pixelsPerSecond,
  preferImmediateRendering = false,
}: ClipFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId);
  const [isZooming, setIsZooming] = useState(false);
  const zoomSettleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const renderClipWidth = clipWidth;
  const effectiveStart = Math.max(0, sourceStart + trimStart);

  // Track active zoom interaction from pps changes and drop defer shortly
  // after changes stop to avoid visible catch-up.
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

  // During active edit previews, prioritize extracting the currently requested
  // source window first so expanding clips show thumbnails sooner.
  const priorityWindow = useMemo(() => {
    if (sourceDuration <= 0 || renderPixelsPerSecond <= 0 || renderClipWidth <= 0) {
      return null;
    }

    const visibleSpanSeconds = (renderClipWidth / renderPixelsPerSecond) * speed;
    const prioritySpanSeconds = Math.min(
      visibleSpanSeconds + PRIORITY_PAD_SECONDS * 2,
      MAX_PRIORITY_WINDOW_SECONDS
    );
    const startTime = Math.max(0, effectiveStart - PRIORITY_PAD_SECONDS);
    const endTime = Math.min(sourceDuration, startTime + prioritySpanSeconds);

    if (endTime <= startTime) {
      return null;
    }

    return { startTime, endTime };
  }, [
    sourceDuration,
    renderPixelsPerSecond,
    renderClipWidth,
    speed,
    effectiveStart,
  ]);

  // Load blob URL lazily when visible, and retry after global invalidation.
  useEffect(() => {
    if (!isVisible || !mediaId || hasStartedLoadingRef.current) {
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
        console.error('Failed to load media blob URL:', error);
      }
    };

    loadBlobUrl();

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible, blobUrlVersion, setBlobUrl]);

  // Use filmstrip hook
  const { frames, isLoading, isComplete, error } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDuration,
    isVisible,
    enabled: !!blobUrl && sourceDuration > 0,
    priorityWindow,
  });

  const frameByIndex = useMemo(() => {
    if (!frames || frames.length === 0) return null;
    const map = new Map<number, FilmstripFrame>();
    for (const frame of frames) {
      map.set(frame.index, frame);
    }
    return map;
  }, [frames]);

  // Calculate tiles - maps each tile position to the best frame
  // During active zoom, reduce tile density so we keep UI fluid without
  // deferring zoom updates.
  const tiles = useMemo(() => {
    if (!frames || frames.length === 0 || thumbnailWidth === 0 || renderPixelsPerSecond <= 0) return [];

    const tileCount = Math.ceil(renderClipWidth / thumbnailWidth);
    if (tileCount <= 0) return [];

    const maxTiles = !preferImmediateRendering && isZooming
      ? MAX_TILES_DURING_ZOOM
      : MAX_TILES_IDLE;
    const tileStep = getTileStep(tileCount, maxTiles);
    const result: { tileIndex: number; frame: FilmstripFrame; x: number; width: number }[] = [];

    for (let tile = 0; tile < tileCount; tile += tileStep) {
      const tileX = tile * thumbnailWidth;
      const tileWidth = Math.min(renderClipWidth - tileX, thumbnailWidth * tileStep);
      const tileCenterX = tileX + tileWidth * 0.5;
      const tileTime = effectiveStart + (tileCenterX / renderPixelsPerSecond) * speed;
      const nearestFrameIndex = Math.max(0, Math.round(tileTime));
      const frame = frameByIndex?.get(nearestFrameIndex) ?? findClosestFrame(frames, tileTime);

      if (frame) {
        result.push({ tileIndex: tile, frame, x: tileX, width: tileWidth });
      }
    }

    return result;
  }, [
    frames,
    frameByIndex,
    renderClipWidth,
    renderPixelsPerSecond,
    effectiveStart,
    speed,
    thumbnailWidth,
    isZooming,
    preferImmediateRendering,
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
        <FilmstripSkeleton clipWidth={clipWidth} height={height || 40} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Show shimmer skeleton behind while loading */}
      {!isComplete && (
        <FilmstripSkeleton clipWidth={clipWidth} height={height} />
      )}
      <div
        className="absolute left-0 top-0 overflow-hidden pointer-events-none"
        style={{
          width: renderClipWidth,
          height,
          contentVisibility: 'auto',
          containIntrinsicSize: `${renderClipWidth}px ${height}px`,
        }}
      >
        {tiles.map(({ tileIndex, frame, x, width }) => (
          <FilmstripTile
            key={tileIndex}
            src={frame.url}
            x={x}
            height={height}
            width={width}
            sourceWidth={thumbnailWidth}
          />
        ))}
      </div>
    </div>
  );
});
