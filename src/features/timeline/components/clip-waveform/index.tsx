import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas';
import { WaveformSkeleton } from './waveform-skeleton';
import { useWaveform } from '../../hooks/use-waveform';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants';

// Waveform dimensions
const DEFAULT_WAVEFORM_HEIGHT = 32;
const BAR_WIDTH = 2;
const BAR_GAP = 1;

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
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number;
  /** Optional height override (default 32px) */
  height?: number;
  /** Optional className for positioning override */
  className?: string;
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
  pixelsPerSecond,
  height = DEFAULT_WAVEFORM_HEIGHT,
  className = 'top-2',
}: ClipWaveformProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const hasStartedLoadingRef = useRef(false);

  // Load blob URL for the media - only once when first visible
  useEffect(() => {
    // Skip if already started loading (prevents re-triggering on visibility changes)
    if (hasStartedLoadingRef.current) {
      return;
    }

    // Only start loading when visible
    if (!isVisible || !mediaId) {
      return;
    }

    hasStartedLoadingRef.current = true;
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

    loadBlobUrl();

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible]);

  // Use waveform hook - enabled once we have blobUrl (independent of visibility after that)
  const { peaks, duration, sampleRate, isLoading } = useWaveform({
    mediaId,
    blobUrl,
    isVisible: true, // Always consider visible once we start - prevents re-triggers
    enabled: !!blobUrl,
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
      const centerY = height / 2;
      const maxBarHeight = (height / 2) - 2; // Leave some padding

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
    [peaks, duration, sampleRate, pixelsPerSecond, sourceStart, trimStart, speed, sourceDuration, height]
  );

  // Show skeleton while loading or on error (better than showing nothing)
  if (!peaks || peaks.length === 0) {
    return <WaveformSkeleton clipWidth={clipWidth} height={height} className={className} />;
  }

  // Include quantized pixelsPerSecond in version to force re-render on zoom changes
  // Quantize to steps of 5 to reduce canvas redraws on small zoom changes
  const quantizedPPS = Math.round(pixelsPerSecond / 5) * 5;
  const renderVersion = peaks.length * 10000 + quantizedPPS;

  return (
    <>
      {/* Show shimmer skeleton behind canvas while loading progressively */}
      {isLoading && (
        <WaveformSkeleton clipWidth={clipWidth} height={height} className={className} />
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
