import { memo, useEffect, useState, useMemo } from 'react';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip, type FilmstripFrame } from '../../hooks/use-filmstrip';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '../../services/filmstrip-cache';

export interface ClipFilmstripProps {
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
  /** Optional height override */
  height?: number;
  /** Optional className for positioning */
  className?: string;
}

/**
 * Find the closest frame by timestamp using binary search
 */
function findClosestFrame(
  frames: FilmstripFrame[],
  targetTime: number
): FilmstripFrame | null {
  if (frames.length === 0) return null;

  let left = 0;
  let right = frames.length - 1;
  let bestIndex = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = frames[mid]!.timestamp;

    if (midTime === targetTime) {
      return frames[mid]!;
    } else if (midTime < targetTime) {
      bestIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  // Check if next frame is closer
  if (bestIndex < frames.length - 1) {
    const currentDiff = Math.abs(frames[bestIndex]!.timestamp - targetTime);
    const nextDiff = Math.abs(frames[bestIndex + 1]!.timestamp - targetTime);
    if (nextDiff < currentDiff) {
      return frames[bestIndex + 1]!;
    }
  }

  return frames[bestIndex]!;
}

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails using img tags with object URLs.
 * Simple approach: position each thumbnail based on its timestamp.
 */
export const ClipFilmstrip = memo(function ClipFilmstrip({
  mediaId,
  clipWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  fps: _fps,
  isVisible,
  pixelsPerSecond,
  height = THUMBNAIL_HEIGHT,
  className = 'top-1',
}: ClipFilmstripProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Load blob URL for the media
  useEffect(() => {
    let mounted = true;

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
    enabled: isVisible && !!blobUrl && sourceDuration > 0,
  });

  // Calculate which slots need thumbnails and map frames to slots
  const visibleFrames = useMemo(() => {
    if (!frames || frames.length === 0) return [];

    const effectiveStart = sourceStart + trimStart;
    const slotCount = Math.ceil(clipWidth / THUMBNAIL_WIDTH);
    const slotTimeSpan = (THUMBNAIL_WIDTH / pixelsPerSecond) * speed;
    const proximityThreshold = slotTimeSpan * 0.6;

    const result: { slot: number; frame: FilmstripFrame; x: number }[] = [];
    let lastGoodFrame: FilmstripFrame | null = null;

    for (let slot = 0; slot < slotCount; slot++) {
      const slotLeftPixel = slot * THUMBNAIL_WIDTH;
      const timelineSeconds = slotLeftPixel / pixelsPerSecond;
      const sourceTime = effectiveStart + timelineSeconds * speed;

      const closestFrame = findClosestFrame(frames, sourceTime);

      // Check if we have a good frame for this slot
      const timeDiff = closestFrame ? Math.abs(closestFrame.timestamp - sourceTime) : Infinity;
      const hasGoodFrame = closestFrame && timeDiff <= proximityThreshold;

      if (hasGoodFrame) {
        lastGoodFrame = closestFrame;
        result.push({
          slot,
          frame: closestFrame,
          x: slotLeftPixel,
        });
      } else if (lastGoodFrame) {
        // No good frame yet - repeat the last good frame as placeholder
        result.push({
          slot,
          frame: lastGoodFrame,
          x: slotLeftPixel,
        });
      }
      // If no lastGoodFrame yet, slot stays empty (will be filled by skeleton)
    }

    return result;
  }, [frames, clipWidth, pixelsPerSecond, sourceStart, trimStart, speed]);

  if (error) {
    return null;
  }

  // Show skeleton only if no frames yet
  if (!frames || frames.length === 0) {
    return <FilmstripSkeleton clipWidth={clipWidth} height={height} className={className} />;
  }

  return (
    <>
      {/* Show shimmer skeleton behind while loading */}
      {!isComplete && (
        <FilmstripSkeleton clipWidth={clipWidth} height={height} className={className} />
      )}
      <div
        className={`absolute left-0 ${className} overflow-hidden pointer-events-none`}
        style={{ width: clipWidth, height }}
      >
        {visibleFrames.map(({ slot, frame, x }) => (
          <img
            key={slot}
            src={frame.url}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute top-0 transition-opacity duration-150"
            style={{
              left: x,
              width: THUMBNAIL_WIDTH,
              height: THUMBNAIL_HEIGHT,
              objectFit: 'cover',
            }}
          />
        ))}
      </div>
    </>
  );
});

export { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT };
