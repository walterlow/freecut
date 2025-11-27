import { memo, useCallback, useEffect, useState } from 'react';
import { TiledCanvas, useTiledCanvasRenderer } from '../clip-filmstrip/tiled-canvas';
import { WaveformSkeleton } from './waveform-skeleton';
import { useWaveform } from '../../hooks/use-waveform';
import { useZoomStore } from '../../stores/zoom-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';

// Waveform dimensions
const WAVEFORM_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

// Waveform colors (matching theme.css --color-timeline-audio)
const WAVEFORM_FILL_COLOR = 'rgba(168, 85, 247, 0.6)'; // oklch(0.7 0.1209 301.76) approximation
const WAVEFORM_STROKE_COLOR = 'rgba(168, 85, 247, 1)';

export interface ClipWaveformProps {
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
 * Clip Waveform Component
 *
 * Renders audio waveform as a mirrored bar visualization for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
 */
export const ClipWaveform = memo(function ClipWaveform({
  mediaId,
  clipWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  fps: _fps,
  isVisible,
}: ClipWaveformProps) {
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

  // Use waveform hook
  const { peaks, duration, sampleRate, isLoading, error } = useWaveform({
    mediaId,
    blobUrl,
    isVisible,
    enabled: isVisible && !!blobUrl,
  });

  // Render function for tiled canvas
  const renderTile = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _tileIndex: number,
      tileOffset: number,
      tileWidth: number
    ) => {
      if (!peaks || peaks.length === 0 || duration === 0) {
        return;
      }

      ctx.fillStyle = WAVEFORM_FILL_COLOR;
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR;
      ctx.lineWidth = 0.5;

      // Calculate the time range visible in this tile
      const effectiveStart = sourceStart + trimStart;

      // Calculate bar positions
      const barSpacing = BAR_WIDTH + BAR_GAP;
      const centerY = WAVEFORM_HEIGHT / 2;
      const maxBarHeight = (WAVEFORM_HEIGHT / 2) - 2; // Leave some padding

      // Iterate through bars that should be in this tile
      for (let x = 0; x < tileWidth; x += barSpacing) {
        // Calculate timeline position for this bar
        const timelinePosition = (tileOffset + x) / pixelsPerSecond;

        // Convert to source time
        // sourceTime = effectiveStart + (timelinePosition * speed)
        const sourceTime = effectiveStart + (timelinePosition * speed);

        // Skip if outside source duration
        if (sourceTime < 0 || sourceTime > sourceDuration) {
          continue;
        }

        // Find the corresponding peak value
        // peaks index = sourceTime * sampleRate
        const peakIndex = Math.floor(sourceTime * sampleRate);
        if (peakIndex < 0 || peakIndex >= peaks.length) {
          continue;
        }

        const peakValue = peaks[peakIndex] ?? 0;

        // Calculate bar height (mirrored from center)
        const barHeight = Math.max(2, peakValue * maxBarHeight);

        // Draw mirrored bar (extends both up and down from center)
        const barX = Math.round(x);
        const barY = Math.round(centerY - barHeight);
        const fullBarHeight = Math.round(barHeight * 2);

        // Fill
        ctx.fillRect(barX, barY, BAR_WIDTH, fullBarHeight);

        // Optional: stroke for sharper edges
        // ctx.strokeRect(barX, barY, BAR_WIDTH, fullBarHeight);
      }
    },
    [peaks, duration, sampleRate, pixelsPerSecond, sourceStart, trimStart, speed, sourceDuration]
  );

  // Create stable renderer that updates with dependencies
  const stableRenderer = useTiledCanvasRenderer(renderTile, [
    peaks,
    duration,
    sampleRate,
    pixelsPerSecond,
    sourceStart,
    trimStart,
    speed,
    sourceDuration,
  ]);

  // Show skeleton while loading or if no peaks yet
  if (isLoading || !peaks || peaks.length === 0) {
    return <WaveformSkeleton clipWidth={clipWidth} height={WAVEFORM_HEIGHT} />;
  }

  // Show nothing on error (clip color will show through)
  if (error) {
    return null;
  }

  return (
    <TiledCanvas
      width={clipWidth}
      height={WAVEFORM_HEIGHT}
      renderTile={stableRenderer}
      className="top-2" // Offset from clip top to leave room for label
    />
  );
});
