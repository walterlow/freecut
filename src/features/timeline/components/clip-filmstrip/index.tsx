import { memo, useCallback, useEffect, useState } from 'react';
import { TiledCanvas, useTiledCanvasRenderer } from './tiled-canvas';
import { FilmstripSkeleton } from './filmstrip-skeleton';
import { useFilmstrip } from '../../hooks/use-filmstrip';
import { useZoomStore } from '../../stores/zoom-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';

// Thumbnail dimensions (matching filmstrip-cache defaults)
const THUMBNAIL_WIDTH = 71;
const THUMBNAIL_HEIGHT = 40;

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
}

/**
 * Clip Filmstrip Component
 *
 * Renders video frame thumbnails as a filmstrip background for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
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
}: ClipFilmstripProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond);

  // Load blob URL for the media
  useEffect(() => {
    let mounted = true;
    let url: string | null = null;

    const loadBlobUrl = async () => {
      try {
        url = await mediaLibraryService.getMediaBlobUrl(mediaId);
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
  const { frames, timestamps, error } = useFilmstrip({
    mediaId,
    blobUrl,
    duration: sourceDuration,
    clipWidth,
    isVisible,
    enabled: isVisible && !!blobUrl && sourceDuration > 0,
  });

  // Render function for tiled canvas - draws frames edge-to-edge (no gaps)
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

      // Account for trim and speed
      const effectiveStart = sourceStart + trimStart;

      // Calculate how many thumbnail slots fit in the clip
      const startSlot = Math.floor(tileOffset / THUMBNAIL_WIDTH);
      const endSlot = Math.ceil((tileOffset + tileWidth) / THUMBNAIL_WIDTH);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        const slotX = slot * THUMBNAIL_WIDTH - tileOffset;

        if (slotX + THUMBNAIL_WIDTH < 0 || slotX > tileWidth) continue;

        const slotCenterPixel = slot * THUMBNAIL_WIDTH + THUMBNAIL_WIDTH / 2;
        const timelinePosition = slotCenterPixel / pixelsPerSecond;
        const sourceTime = effectiveStart + timelinePosition * speed;

        // Find the closest frame to this source time
        let bestFrameIndex = 0;
        let bestTimeDiff = Infinity;

        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i];
          if (timestamp === undefined) continue;
          const timeDiff = Math.abs(timestamp - sourceTime);
          if (timeDiff < bestTimeDiff) {
            bestTimeDiff = timeDiff;
            bestFrameIndex = i;
          }
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
        } catch (err) {
          // ImageBitmap may have been closed
        }
      }
    },
    [frames, timestamps, pixelsPerSecond, sourceStart, trimStart, speed]
  );

  // Create stable renderer
  const stableRenderer = useTiledCanvasRenderer(renderTile, [
    frames,
    timestamps,
    pixelsPerSecond,
    sourceStart,
    trimStart,
    speed,
  ]);

  // Show skeleton only if no frames yet
  if (!frames || frames.length === 0) {
    return <FilmstripSkeleton clipWidth={clipWidth} height={THUMBNAIL_HEIGHT} />;
  }

  if (error) {
    return null;
  }

  return (
    <TiledCanvas
      width={clipWidth}
      height={THUMBNAIL_HEIGHT}
      renderTile={stableRenderer}
      version={frames.length}
      className="top-1"
    />
  );
});
