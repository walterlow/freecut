import { memo, useEffect, useState, useMemo, useCallback, useRef, type SyntheticEvent } from 'react';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { THUMBNAIL_WIDTH } from '../../services/filmstrip-cache';

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

/**
 * Simple filmstrip tile - memoized to prevent unnecessary re-renders
 * Hides itself on error to avoid broken image icons
 */
const FilmstripTile = memo(function FilmstripTile({
  src,
  x,
  height,
  width,
}: {
  src: string;
  x: number;
  height: number;
  width: number;
}) {
  const [displayedSrc, setDisplayedSrc] = useState(src);
  const [pendingSrc, setPendingSrc] = useState<{ src: string; epoch: number } | null>(null);
  const [displayError, setDisplayError] = useState(false);
  const epochRef = useRef(0);

  // Queue incoming src for atomic swap once it has loaded.
  useEffect(() => {
    if (src === displayedSrc) {
      if (pendingSrc) {
        setPendingSrc(null);
      }
      return;
    }
    if (pendingSrc && pendingSrc.src === src) return;
    const nextEpoch = epochRef.current + 1;
    epochRef.current = nextEpoch;
    setPendingSrc({ src, epoch: nextEpoch });
  }, [src, displayedSrc, pendingSrc]);

  const handleDisplayedError = useCallback(() => {
    setDisplayError(true);
  }, []);

  const handlePendingLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    if (!pendingSrc) return;
    const loadedEpoch = Number(e.currentTarget.dataset.epoch || '0');
    // Ignore stale async loads from older pending requests.
    if (loadedEpoch !== pendingSrc.epoch || loadedEpoch !== epochRef.current) return;
    setDisplayedSrc(pendingSrc.src);
    setDisplayError(false);
    setPendingSrc(null);
  }, [pendingSrc]);

  const handlePendingError = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    if (!pendingSrc) return;
    const failedEpoch = Number(e.currentTarget.dataset.epoch || '0');
    if (failedEpoch !== pendingSrc.epoch || failedEpoch !== epochRef.current) return;
    // Keep showing current frame if next src fails.
    setPendingSrc(null);
  }, [pendingSrc]);

  return (
    <div
      className="absolute top-0"
      style={{
        left: x,
        width,
        height,
        overflow: 'hidden',
      }}
    >
      {!displayError && (
        <img
          src={displayedSrc}
          alt=""
          decoding="async"
          className="absolute inset-0"
          onError={handleDisplayedError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
      {pendingSrc && pendingSrc.src !== displayedSrc && (
        <img
          src={pendingSrc.src}
          alt=""
          decoding="async"
          className="absolute inset-0 opacity-0 pointer-events-none"
          data-epoch={pendingSrc.epoch}
          onLoad={handlePendingLoad}
          onError={handlePendingError}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      )}
      {displayError && (
        <div className="absolute inset-0 bg-zinc-900" />
      )}
    </div>
  );
});

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a tiled filmstrip.
 * Updates immediately with zoom so thumbnails stay visually in sync with clip width.
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
}: ClipFilmstripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

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

  // Load blob URL for the media
  useEffect(() => {
    let mounted = true;

    // Reset blob URL when mediaId changes to force fresh load
    setBlobUrl(null);

    const loadBlobUrl = async () => {
      try {
        const url = await mediaLibraryService.getMediaBlobUrl(mediaId);
        if (mounted && url) {
          setBlobUrl(url);
        }
      } catch (error) {
        console.error('Failed to load media blob URL:', error);
      }
    };

    if (isVisible && mediaId) {
      loadBlobUrl();
    }

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible]);

  // Use filmstrip hook
  const { frames, isComplete, error } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDuration,
    isVisible,
    enabled: isVisible && sourceDuration > 0,
  });

  // Calculate tiles - maps each tile position to the best frame
  // Browser's native loading="lazy" handles performance optimization
  const tiles = useMemo(() => {
    if (!frames || frames.length === 0 || thumbnailWidth === 0) return [];

    const effectiveStart = sourceStart + trimStart;
    // Overscan one tile on the right so we never expose clip background during fast resizes.
    const tileCount = Math.ceil(clipWidth / thumbnailWidth) + 1;
    const result: { tileIndex: number; frame: FilmstripFrame; x: number }[] = [];

    for (let tile = 0; tile < tileCount; tile++) {
      const tileX = tile * thumbnailWidth;
      const tileTime = effectiveStart + (tileX / pixelsPerSecond) * speed;
      const frame = findClosestFrame(frames, tileTime);

      if (frame) {
        result.push({ tileIndex: tile, frame, x: tileX });
      }
    }

    return result;
  }, [frames, clipWidth, pixelsPerSecond, sourceStart, trimStart, speed, thumbnailWidth]);

  if (error) {
    return null;
  }

  // Show skeleton while actively loading.
  if (!frames || frames.length === 0 || height === 0) {
    return (
      <div ref={containerRef} className="absolute inset-0">
        <div className="absolute inset-0 bg-zinc-900" />
        <FilmstripSkeleton clipWidth={clipWidth} height={height || 40} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0 bg-zinc-900">
      {/* Show shimmer skeleton behind while loading */}
      {!isComplete && (
        <FilmstripSkeleton clipWidth={clipWidth} height={height} />
      )}
      <div
        className="absolute left-0 top-0 overflow-hidden pointer-events-none"
        style={{
          width: clipWidth,
          height,
        }}
      >
        {tiles.map(({ tileIndex, frame, x }) => (
          <FilmstripTile key={tileIndex} src={frame.url} x={x} height={height} width={thumbnailWidth} />
        ))}
      </div>
    </div>
  );
});
