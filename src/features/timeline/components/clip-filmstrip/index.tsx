import { memo, useCallback, useEffect, useState } from 'react';
import { TiledCanvas } from './tiled-canvas';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip } from '../../hooks/use-filmstrip';
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
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a filmstrip background for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
 * Matches extracted frames to display slots by timestamp for correct visual mapping.
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

  // Use filmstrip hook - extracts frames for full source duration
  const { frames, timestamps, error } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDuration,
    isVisible,
    enabled: isVisible && !!blobUrl && sourceDuration > 0,
  });

  // Render function for tiled canvas - matches frames to slots by timestamp
  // Uses a proximity threshold to only render slots with nearby frames (progressive fill-in)
  const renderTile = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _tileIndex: number,
      tileOffset: number,
      tileWidth: number
    ) => {
      if (!frames || !timestamps || frames.length === 0) {
        return;
      }

      // Calculate which slots are visible in this tile
      const startSlot = Math.floor(tileOffset / THUMBNAIL_WIDTH);
      const endSlot = Math.ceil((tileOffset + tileWidth) / THUMBNAIL_WIDTH);

      // The effective start in source video (accounting for trim)
      const effectiveStart = sourceStart + trimStart;

      // Calculate the time span each slot represents for proximity threshold
      // A slot is only rendered if a frame exists within half a slot's time span
      const slotTimeSpan = THUMBNAIL_WIDTH / pixelsPerSecond * speed;
      const proximityThreshold = slotTimeSpan * 0.6; // 60% of slot time span

      for (let slot = startSlot; slot <= endSlot; slot++) {
        const slotX = slot * THUMBNAIL_WIDTH - tileOffset;

        if (slotX + THUMBNAIL_WIDTH < 0 || slotX > tileWidth) continue;

        // Calculate the source time for the LEFT edge of this slot
        // IMPORTANT: Using left edge (not center) because when users look at a thumbnail
        // at position X, they expect to see what's AT that position, not what's at
        // position X + half a thumbnail width. This provides more accurate visual mapping
        // especially at lower zoom levels where each thumbnail covers several seconds.
        const slotLeftPixel = slot * THUMBNAIL_WIDTH;
        const timelineSeconds = slotLeftPixel / pixelsPerSecond;
        const sourceTime = effectiveStart + timelineSeconds * speed;

        // Find the closest frame by timestamp using binary search
        let bestFrameIndex = 0;
        let left = 0;
        let right = timestamps.length - 1;

        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          const midTime = timestamps[mid] ?? 0;

          if (midTime === sourceTime) {
            bestFrameIndex = mid;
            break;
          } else if (midTime < sourceTime) {
            bestFrameIndex = mid;
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        }

        // Check if the next frame is actually closer
        if (bestFrameIndex < timestamps.length - 1) {
          const currentDiff = Math.abs((timestamps[bestFrameIndex] ?? 0) - sourceTime);
          const nextDiff = Math.abs((timestamps[bestFrameIndex + 1] ?? 0) - sourceTime);
          if (nextDiff < currentDiff) {
            bestFrameIndex++;
          }
        }

        // Only render if the closest frame is within proximity threshold
        // This creates the progressive fill-in effect as frames arrive
        const closestTime = timestamps[bestFrameIndex] ?? 0;
        const timeDiff = Math.abs(closestTime - sourceTime);
        if (timeDiff > proximityThreshold) {
          continue; // Skip this slot - no close enough frame yet
        }

        const frame = frames[bestFrameIndex];
        if (!frame) continue;

        try {
          ctx.drawImage(
            frame,
            Math.round(slotX),
            0,
            THUMBNAIL_WIDTH,
            THUMBNAIL_HEIGHT
          );
        } catch {
          // ImageBitmap may have been closed
        }
      }
    },
    [frames, timestamps, pixelsPerSecond, sourceStart, trimStart, speed]
  );

  if (error) {
    return null;
  }

  // Show skeleton only if no frames yet
  if (!frames || frames.length === 0) {
    return <FilmstripSkeleton clipWidth={clipWidth} height={height} className={className} />;
  }

  // Include quantized pixelsPerSecond in version to force re-render on zoom changes
  // Quantize to steps of 5 to reduce canvas redraws on small zoom changes
  const quantizedPPS = Math.round(pixelsPerSecond / 5) * 5;
  const renderVersion = frames.length * 10000 + quantizedPPS;

  // Calculate if filmstrip is complete (all frames loaded)
  // At 24fps extraction rate, complete when we have ~duration * 24 frames
  const expectedFrames = Math.ceil(sourceDuration * 24);
  const isComplete = frames.length >= expectedFrames * 0.95; // 95% threshold

  return (
    <>
      {/* Show shimmer skeleton behind canvas while loading */}
      {!isComplete && (
        <FilmstripSkeleton clipWidth={clipWidth} height={height} className={className} />
      )}
      <TiledCanvas
        width={clipWidth}
        height={height}
        renderTile={renderTile}
        version={renderVersion}
        className={className}
      />
    </>
  );
});
