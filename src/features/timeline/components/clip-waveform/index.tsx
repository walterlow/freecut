import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas';
import { WaveformSkeleton } from './waveform-skeleton';
import { useWaveform } from '../../hooks/use-waveform';
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service';
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver';
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url';
import {
  needsCustomAudioDecoder,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@/features/timeline/deps/composition-runtime';
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants';
import { createLogger } from '@/shared/logging/logger';
import { computeWaveformRenderWindow } from './render-window';
import {
  getWaveformActiveTileCount,
  useAdaptiveWaveformRenderVersion,
} from './adaptive-render-version';

const logger = createLogger('ClipWaveform');

// Continuous filled-path waveform styling (NLE-style)
const WAVEFORM_VERTICAL_PADDING_PX = 3;

interface ClipWaveformProps {
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
}

/**
 * Clip Waveform Component
 *
 * Renders audio waveform as a symmetrical mirrored visualization for timeline clips.
 * Uses tiled canvas for large clips and shows skeleton while loading.
 */
export const ClipWaveform = memo(function ClipWaveform({
  mediaId,
  clipWidth,
  renderWidth,
  sourceStart,
  sourceDuration,
  trimStart,
  speed,
  fps,
  isVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
}: ClipWaveformProps) {
  void fps;
  const containerRef = useRef<HTMLDivElement>(null);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  pixelsPerSecondRef.current = pixelsPerSecond;
  const [height, setHeight] = useState(0);
  const conformStartedRef = useRef(false);
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
  const visibleClipWidth = clipWidth;
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth);

  useEffect(() => {
    conformStartedRef.current = false;
  }, [mediaId]);

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
        const previewAudioCodec = media?.mimeType.startsWith('audio/')
          ? media.codec
          : (media?.audioCodec ?? media?.codec);
        const requiresCustomDecode = needsCustomAudioDecoder(previewAudioCodec);
        const codecSupported = media
          ? (media.audioCodecSupported !== false || requiresCustomDecode)
          : true;
        setAudioCodecSupported(codecSupported);

        if (!codecSupported) {
          // Skip waveform generation for unsupported codecs
          return;
        }

        const url = await resolveMediaUrl(mediaId);
        if (mounted && url) {
          setBlobUrl(url);
          if (requiresCustomDecode && !conformStartedRef.current) {
            conformStartedRef.current = true;
            const startupWarmup = startPreviewAudioStartupWarm(mediaId, url).catch((error) => {
              logger.warn('Failed to warm preview startup audio from waveform load:', error);
            });
            void startupWarmup.finally(() => {
              void startPreviewAudioConform(mediaId, url).catch((error) => {
                logger.warn('Failed to start preview audio conform from waveform load:', error);
              });
            });
          }
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error);
      }
    };

    loadBlobUrl();

    return () => {
      mounted = false;
    };
  }, [mediaId, isVisible, blobUrlVersion]);

  // Use waveform hook - enabled once we have blobUrl (independent of visibility after that)
  const { peaks, duration, sampleRate, stereo, maxPeak, loadedSamples, isLoading, error } = useWaveform({
    mediaId,
    blobUrl,
    isVisible: true, // Always consider visible once we start - prevents re-triggers
    enabled: !!blobUrl,
    deferDurationSec: sourceDuration,
  });
  const normalizationPeak = maxPeak > 0 ? maxPeak : 1;
  const peakSampleCount = useMemo(
    () => (peaks ? (stereo ? Math.floor(peaks.length / 2) : peaks.length) : 0),
    [peaks, stereo]
  );
  const { visibleStartPx, visibleEndPx } = useMemo(
    () => computeWaveformRenderWindow({
      renderWidth: renderClipWidth,
      visibleWidth: visibleClipWidth,
      visibleStartRatio,
      visibleEndRatio,
    }),
    [renderClipWidth, visibleClipWidth, visibleStartRatio, visibleEndRatio]
  );

  // Render function for tiled canvas. Keep the callback stable through zoom
  // changes and use versioning to trigger redraws at the current zoom level.
  const renderTile = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _tileIndex: number,
      tileOffset: number,
      tileWidth: number
    ) => {
      if (!peaks || peakSampleCount === 0 || duration === 0) {
        return;
      }

      const effectiveStart = sourceStart + trimStart;
      const currentPps = Math.max(1, pixelsPerSecondRef.current);
      const centerY = height / 2;
      const maxWaveHeight = Math.max(1, (height / 2) - WAVEFORM_VERTICAL_PADDING_PX);
      const amplitudes = new Array<number>(tileWidth + 1).fill(0);

      ctx.beginPath();
      ctx.moveTo(0, centerY);

      for (let x = 0; x <= tileWidth; x++) {
        const timelinePosition = (tileOffset + x) / currentPps;
        const sourceTime = effectiveStart + (timelinePosition * speed);

        if (sourceTime < 0 || sourceTime > sourceDuration || sampleRate <= 0) {
          continue;
        }

        const peakIndex = Math.floor(sourceTime * sampleRate);
        if (peakIndex < 0 || peakIndex >= peakSampleCount) {
          continue;
        }

        // Window sampling to avoid aliasing
        const pointWindowSeconds = Math.max(
          1 / sampleRate,
          (1 / currentPps) * speed * 0.5
        );
        const samplesPerPoint = Math.max(1, Math.ceil(pointWindowSeconds * sampleRate));
        const halfWindow = Math.floor(samplesPerPoint / 2);
        const windowStart = Math.max(0, peakIndex - halfWindow);
        const windowEnd = Math.min(peakSampleCount, peakIndex + halfWindow + 1);

        let max1 = 0;
        let max2 = 0;
        let windowSum = 0;
        let sampleCount = 0;
        for (let i = windowStart; i < windowEnd; i++) {
          const value = stereo
            ? Math.max(peaks[i * 2] ?? 0, peaks[i * 2 + 1] ?? 0)
            : (peaks[i] ?? 0);
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
        amplitudes[x] = amp * maxWaveHeight;
      }

      for (let x = 0; x <= tileWidth; x++) {
        ctx.lineTo(x, centerY - amplitudes[x]!);
      }
      for (let x = tileWidth; x >= 0; x--) {
        ctx.lineTo(x, centerY + amplitudes[x]!);
      }
      ctx.closePath();

      ctx.fillStyle = WAVEFORM_FILL_COLOR;
      ctx.fill();

      // Thin stroke along the top contour for definition
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    },
    [
      peaks,
      peakSampleCount,
      duration,
      sampleRate,
      sourceStart,
      trimStart,
      speed,
      sourceDuration,
      height,
      normalizationPeak,
      stereo,
    ]
  );

  const activeTileCount = useMemo(() => getWaveformActiveTileCount({
    renderWidth: renderClipWidth,
    visibleStartPx,
    visibleEndPx,
  }), [renderClipWidth, visibleStartPx, visibleEndPx]);
  const renderVersion = useAdaptiveWaveformRenderVersion({
    baseVersion: `${loadedSamples}:${height}`,
    pixelsPerSecond,
    activeTileCount,
  });

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

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Show shimmer skeleton behind canvas while loading progressively */}
      {isLoading && (
        <WaveformSkeleton clipWidth={clipWidth} height={height} />
      )}
      <TiledCanvas
        width={renderClipWidth}
        height={height}
        renderTile={renderTile}
        version={renderVersion}
        visibleStartPx={visibleStartPx}
        visibleEndPx={visibleEndPx}
        overscanTiles={1}
      />
    </div>
  );
});
