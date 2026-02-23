import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas';
import { WaveformSkeleton } from './waveform-skeleton';
import { useWaveform } from '../../hooks/use-waveform';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { resolveMediaUrl } from '@/features/preview/utils/media-resolver';
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url';
import { needsCustomAudioDecoder } from '@/lib/composition-runtime/utils/audio-codec-detection';
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants';

// Continuous filled-path waveform styling (NLE-style)
const WAVEFORM_VERTICAL_PADDING_PX = 3;

interface ClipWaveformProps {
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
 * Clip Waveform Component
 *
 * Renders audio waveform as a top-half thin-bar visualization for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
 */
export const ClipWaveform = memo(function ClipWaveform({
  mediaId,
  clipWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  fps,
  isVisible,
  pixelsPerSecond,
}: ClipWaveformProps) {
  void fps;
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId);

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

  // Track if audio codec is supported for waveform generation
  const [audioCodecSupported, setAudioCodecSupported] = useState(true);

  // Load blob URL for the media when visible, including post-invalidation retries.
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
        // First check if audio codec is supported
        const media = await mediaLibraryService.getMedia(mediaId);
        if (!mounted) return;

        // AC-3/E-AC-3 can still generate waveform via mediabunny even if old metadata
        // marked codec unsupported before custom decode was added.
        const codecSupported = media
          ? (media.audioCodecSupported !== false || needsCustomAudioDecoder(media.audioCodec))
          : true;
        setAudioCodecSupported(codecSupported);

        if (!codecSupported) {
          // Skip waveform generation for unsupported codecs
          return;
        }

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
  }, [mediaId, isVisible, blobUrlVersion]);

  // Use waveform hook - enabled once we have blobUrl (independent of visibility after that)
  const { peaks, duration, sampleRate, isLoading, progress, error } = useWaveform({
    mediaId,
    blobUrl,
    isVisible: true, // Always consider visible once we start - prevents re-triggers
    enabled: !!blobUrl,
  });

  // Normalize visual scale per clip so low-amplitude sources are still readable.
  const normalizationPeak = useMemo(() => {
    if (!peaks || peaks.length === 0) return 1;
    let maxPeak = 0;
    for (let i = 0; i < peaks.length; i++) {
      const value = peaks[i] ?? 0;
      if (value > maxPeak) {
        maxPeak = value;
      }
    }
    return maxPeak > 0 ? maxPeak : 1;
  }, [peaks]);

  // Render function for tiled canvas — continuous filled path (NLE-style)
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

      const effectiveStart = sourceStart + trimStart;
      const baselineY = height - WAVEFORM_VERTICAL_PADDING_PX;
      const maxWaveHeight = Math.max(1, height - WAVEFORM_VERTICAL_PADDING_PX * 2);

      // Build a single path tracing the peak contour per-pixel
      ctx.beginPath();
      ctx.moveTo(0, baselineY);

      for (let x = 0; x <= tileWidth; x++) {
        const timelinePosition = (tileOffset + x) / pixelsPerSecond;
        const sourceTime = effectiveStart + (timelinePosition * speed);

        if (sourceTime < 0 || sourceTime > sourceDuration || sampleRate <= 0) {
          ctx.lineTo(x, baselineY);
          continue;
        }

        const peakIndex = Math.floor(sourceTime * sampleRate);
        if (peakIndex < 0 || peakIndex >= peaks.length) {
          ctx.lineTo(x, baselineY);
          continue;
        }

        // Window sampling to avoid aliasing
        const pointWindowSeconds = Math.max(
          1 / sampleRate,
          (1 / pixelsPerSecond) * speed * 0.5
        );
        const samplesPerPoint = Math.max(1, Math.ceil(pointWindowSeconds * sampleRate));
        const halfWindow = Math.floor(samplesPerPoint / 2);
        const windowStart = Math.max(0, peakIndex - halfWindow);
        const windowEnd = Math.min(peaks.length, peakIndex + halfWindow + 1);

        let max1 = 0;
        let max2 = 0;
        let windowSum = 0;
        let sampleCount = 0;
        for (let i = windowStart; i < windowEnd; i++) {
          const value = peaks[i] ?? 0;
          if (value >= max1) {
            max2 = max1;
            max1 = value;
          } else if (value > max2) {
            max2 = value;
          }
          windowSum += value;
          sampleCount++;
        }

        if (sampleCount === 0) {
          ctx.lineTo(x, baselineY);
          continue;
        }

        const normalizedMax1 = Math.min(1, max1 / normalizationPeak);
        const normalizedMax2 = Math.min(1, max2 / normalizationPeak);
        const normalizedMean = Math.min(1, (windowSum / sampleCount) / normalizationPeak);
        const needle = Math.max(0, normalizedMax1 - normalizedMax2);
        const peakValue = Math.min(
          1,
          normalizedMean * 0.38 + normalizedMax2 * 0.34 + needle * 2.35
        );
        const amp = peakValue <= 0.001 ? 0 : Math.pow(peakValue, 1.05);
        const waveY = baselineY - amp * maxWaveHeight;
        ctx.lineTo(x, waveY);
      }

      // Close path back along the baseline
      ctx.lineTo(tileWidth, baselineY);
      ctx.closePath();

      ctx.fillStyle = WAVEFORM_FILL_COLOR;
      ctx.fill();

      // Thin stroke along the top contour for definition
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    },
    [peaks, duration, sampleRate, pixelsPerSecond, sourceStart, trimStart, speed, sourceDuration, height, normalizationPeak]
  );

  // Show empty state for unsupported/failed waveforms (no infinite skeleton).
  if (!audioCodecSupported || !!error) {
    return (
      <div ref={containerRef} className="absolute inset-0 flex items-center">
        {/* Flat line to indicate no waveform available */}
        <div
          className="w-full h-[1px] bg-foreground/20"
          style={{ marginTop: 0 }}
        />
      </div>
    );
  }

  // Show skeleton only while actively loading.
  if (!peaks || peaks.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return (
        <div ref={containerRef} className="absolute inset-0 flex items-center">
          <div className="w-full h-[1px] bg-foreground/20" style={{ marginTop: 0 }} />
        </div>
      );
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <WaveformSkeleton clipWidth={clipWidth} height={height || 24} />
      </div>
    );
  }

  // Include quantized pixelsPerSecond in version to force re-render on zoom changes
  // Quantize to steps of 5 to reduce canvas redraws on small zoom changes
  const quantizedPPS = Math.round(pixelsPerSecond / 5) * 5;
  const progressBucket = Math.floor(progress);
  // Include decode progress so tiles repaint as streaming chunks arrive.
  const renderVersion = progressBucket * 10000000 + peaks.length * 10000 + quantizedPPS + height;

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Show shimmer skeleton behind canvas while loading progressively */}
      {isLoading && (
        <WaveformSkeleton clipWidth={clipWidth} height={height} />
      )}
      <TiledCanvas
        width={clipWidth}
        height={height}
        renderTile={renderTile}
        version={renderVersion}
      />
    </div>
  );
});
