import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas'
import { WaveformSkeleton } from './waveform-skeleton'
import { useWaveform } from '../../hooks/use-waveform'
import { importMediaLibraryService } from '@/features/timeline/deps/media-library-service'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { useMediaBlobUrl } from '../../hooks/use-media-blob-url'
import {
  needsCustomAudioDecoder,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@/features/timeline/deps/composition-runtime'
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants'
import { createLogger } from '@/shared/logging/logger'
import { computeWaveformRenderWindow } from './render-window'
import { computeWaveformAmplitude } from './amplitude'
import {
  getWaveformActiveTileCount,
  useAdaptiveWaveformRenderVersion,
} from './adaptive-render-version'
import { observeParentElementHeight } from '../measure-parent-height'

const logger = createLogger('ClipWaveform')

// Continuous filled-path waveform styling (NLE-style)
const WAVEFORM_VERTICAL_PADDING_PX = 3

interface ClipWaveformProps {
  /** Media ID from the timeline item */
  mediaId: string
  /** Visible width of the clip in pixels */
  clipWidth: number
  /** Optional overscan width used to hide trailing-edge width commit lag */
  renderWidth?: number
  /** Source start time in seconds (for trimmed clips) */
  sourceStart: number
  /** Source end time in seconds (for trimmed clips) */
  sourceEnd?: number
  /** Total source duration in seconds */
  sourceDuration: number
  /** Trim start in seconds (how much trimmed from beginning) */
  trimStart: number
  /** Playback speed multiplier */
  speed: number
  /** Whether the clip plays source media in reverse */
  isReversed?: boolean
  /** Frames per second */
  fps: number
  /** Whether the clip is visible (from IntersectionObserver) */
  isVisible: boolean
  /** Visible horizontal range within this clip (0-1 ratios) */
  visibleStartRatio?: number
  visibleEndRatio?: number
  /** Pixels per second from parent (avoids redundant zoom subscription) */
  pixelsPerSecond: number
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
  sourceEnd,
  sourceDuration,
  trimStart,
  speed,
  isReversed = false,
  fps,
  isVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
}: ClipWaveformProps) {
  void fps
  const containerRef = useRef<HTMLDivElement>(null)
  const pixelsPerSecondRef = useRef(pixelsPerSecond)
  pixelsPerSecondRef.current = pixelsPerSecond
  // clipWidth is read via ref inside renderTile so zoom (which changes clipWidth
  // and pps proportionally) doesn't invalidate the callback identity and force
  // TiledCanvas to redraw all visible tiles on every zoom step.
  const clipWidthRef = useRef(clipWidth)
  clipWidthRef.current = clipWidth
  const amplitudesBufferRef = useRef<Float32Array>(new Float32Array(0))
  const [height, setHeight] = useState(0)
  const conformStartedRef = useRef(false)
  const { blobUrl, setBlobUrl, hasStartedLoadingRef, blobUrlVersion } = useMediaBlobUrl(mediaId)

  // Measure container height. useLayoutEffect (not useEffect) so the initial
  // measurement commits before paint: when a clip remounts under a new track
  // (moving a segment across tracks), height would otherwise start at 0 for one
  // painted frame and flash the loading skeleton even though peaks are cached.
  useLayoutEffect(() => {
    return observeParentElementHeight(containerRef.current, setHeight)
  }, [])

  // Track if audio codec is supported for waveform generation
  const [audioCodecSupported, setAudioCodecSupported] = useState(true)
  const visibleClipWidth = clipWidth
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth)
  const visibleSourceWindow = useMemo(() => {
    const effectiveStart = Math.max(0, sourceStart + trimStart)
    const effectiveEnd = Math.min(
      sourceDuration,
      Math.max(
        effectiveStart,
        sourceEnd ?? effectiveStart + (visibleClipWidth / Math.max(1, pixelsPerSecond)) * speed,
      ),
    )
    const visibleStartX = visibleClipWidth * Math.max(0, Math.min(1, visibleStartRatio))
    const visibleEndX = visibleClipWidth * Math.max(0, Math.min(1, visibleEndRatio))
    const startOffset = (visibleStartX / Math.max(1, pixelsPerSecond)) * speed
    const endOffset = (visibleEndX / Math.max(1, pixelsPerSecond)) * speed
    const sourceA = isReversed ? effectiveEnd - endOffset : effectiveStart + startOffset
    const sourceB = isReversed ? effectiveEnd - startOffset : effectiveStart + endOffset
    const padSeconds = Math.max(
      2,
      ((visibleEndX - visibleStartX) / Math.max(1, pixelsPerSecond)) * 0.25,
    )

    return {
      start: Math.max(0, Math.min(sourceA, sourceB) - padSeconds),
      end: Math.min(sourceDuration, Math.max(sourceA, sourceB) + padSeconds),
    }
  }, [
    sourceStart,
    trimStart,
    sourceDuration,
    sourceEnd,
    visibleClipWidth,
    pixelsPerSecond,
    speed,
    visibleStartRatio,
    visibleEndRatio,
    isReversed,
  ])

  useEffect(() => {
    conformStartedRef.current = false
  }, [mediaId])

  // Load blob URL for the media when visible, including post-invalidation retries.
  useEffect(() => {
    // Skip if already started loading (prevents re-triggering on visibility changes)
    if (hasStartedLoadingRef.current) {
      return
    }

    // Only start loading when visible
    if (!isVisible || !mediaId) {
      return
    }

    hasStartedLoadingRef.current = true
    let mounted = true

    const loadBlobUrl = async () => {
      try {
        // First check if audio codec is supported
        const { mediaLibraryService } = await importMediaLibraryService()
        const media = await mediaLibraryService.getMedia(mediaId)
        if (!mounted) return

        // AC-3/E-AC-3 can still generate waveform via mediabunny even if old metadata
        // marked codec unsupported before custom decode was added.
        const previewAudioCodec = media?.mimeType.startsWith('audio/')
          ? media.codec
          : (media?.audioCodec ?? media?.codec)
        const requiresCustomDecode = needsCustomAudioDecoder(previewAudioCodec)
        const codecSupported = media
          ? media.audioCodecSupported !== false || requiresCustomDecode
          : true
        setAudioCodecSupported(codecSupported)

        if (!codecSupported) {
          // Skip waveform generation for unsupported codecs
          return
        }

        const url = await resolveMediaUrl(mediaId)
        if (mounted && url) {
          setBlobUrl(url)
          if (requiresCustomDecode && !conformStartedRef.current) {
            conformStartedRef.current = true
            const startupWarmup = startPreviewAudioStartupWarm(mediaId, url).catch((error) => {
              logger.warn('Failed to warm preview startup audio from waveform load:', error)
            })
            void startupWarmup.finally(() => {
              void startPreviewAudioConform(mediaId, url).catch((error) => {
                logger.warn('Failed to start preview audio conform from waveform load:', error)
              })
            })
          }
        }
      } catch (error) {
        logger.error('Failed to load media blob URL:', error)
      }
    }

    loadBlobUrl()

    return () => {
      mounted = false
    }
  }, [mediaId, isVisible, blobUrlVersion, hasStartedLoadingRef, setBlobUrl])

  // Use waveform hook. It can hydrate persisted waveforms before blobUrl is
  // available; blobUrl is only required when the cache has to generate.
  const { peaks, duration, sampleRate, stereo, maxPeak, loadedSamples, isLoading, error } =
    useWaveform({
      mediaId,
      blobUrl,
      isVisible,
      enabled: audioCodecSupported,
      deferDurationSec: sourceDuration,
      pixelsPerSecond,
      visibleSourceStartSec: visibleSourceWindow.start,
      visibleSourceEndSec: visibleSourceWindow.end,
    })
  const normalizationPeak = maxPeak > 0 ? maxPeak : 1
  const peakSampleCount = useMemo(
    () => (peaks ? (stereo ? Math.floor(peaks.length / 2) : peaks.length) : 0),
    [peaks, stereo],
  )
  const { visibleStartPx, visibleEndPx } = useMemo(
    () =>
      computeWaveformRenderWindow({
        renderWidth: renderClipWidth,
        visibleWidth: visibleClipWidth,
        visibleStartRatio,
        visibleEndRatio,
      }),
    [renderClipWidth, visibleClipWidth, visibleStartRatio, visibleEndRatio],
  )

  // Render function for tiled canvas. Keep the callback stable through zoom
  // changes and use versioning to trigger redraws at the current zoom level.
  const renderTile = useCallback(
    (ctx: CanvasRenderingContext2D, _tileIndex: number, tileOffset: number, tileWidth: number) => {
      if (!peaks || peakSampleCount === 0 || duration === 0) {
        return
      }

      const effectiveStart = sourceStart + trimStart
      const currentPps = Math.max(1, pixelsPerSecondRef.current)
      const effectiveEnd = Math.min(
        sourceDuration,
        Math.max(
          effectiveStart,
          sourceEnd ?? effectiveStart + (clipWidthRef.current / Math.max(1, currentPps)) * speed,
        ),
      )
      const centerY = height / 2
      const maxWaveHeight = Math.max(1, height / 2 - WAVEFORM_VERTICAL_PADDING_PX)
      const amplitudeCount = tileWidth + 1
      if (amplitudesBufferRef.current.length < amplitudeCount) {
        amplitudesBufferRef.current = new Float32Array(amplitudeCount)
      }
      const amplitudes = amplitudesBufferRef.current
      amplitudes.fill(0, 0, amplitudeCount)

      ctx.beginPath()
      ctx.moveTo(0, centerY)

      for (let x = 0; x < amplitudeCount; x++) {
        const timelinePosition = (tileOffset + x) / currentPps
        const sourceOffset = timelinePosition * speed
        const sourceTime = isReversed ? effectiveEnd - sourceOffset : effectiveStart + sourceOffset

        if (sourceTime < 0 || sourceTime > sourceDuration || sampleRate <= 0) {
          continue
        }

        const peakIndex = Math.min(peakSampleCount - 1, Math.floor(sourceTime * sampleRate))
        if (peakIndex < 0 || peakIndex >= peakSampleCount) {
          continue
        }

        // Window sampling to avoid aliasing
        const pointWindowSeconds = Math.max(1 / sampleRate, (1 / currentPps) * speed * 0.5)
        const samplesPerPoint = Math.max(1, Math.ceil(pointWindowSeconds * sampleRate))
        const halfWindow = Math.floor(samplesPerPoint / 2)
        const windowStart = Math.max(0, peakIndex - halfWindow)
        const windowEnd = Math.min(peakSampleCount, peakIndex + halfWindow + 1)

        let windowPeak = 0
        let windowSum = 0
        let sampleCount = 0
        for (let i = windowStart; i < windowEnd; i++) {
          const value = stereo
            ? Math.max(peaks[i * 2] ?? 0, peaks[i * 2 + 1] ?? 0)
            : (peaks[i] ?? 0)
          if (value > windowPeak) {
            windowPeak = value
          }
          windowSum += value
          sampleCount++
        }

        if (sampleCount === 0) {
          continue
        }

        amplitudes[x] =
          computeWaveformAmplitude(windowPeak, windowSum, sampleCount, normalizationPeak) *
          maxWaveHeight
      }

      for (let x = 0; x < amplitudeCount; x++) {
        ctx.lineTo(x, centerY - amplitudes[x]!)
      }
      for (let x = amplitudeCount - 1; x >= 0; x--) {
        ctx.lineTo(x, centerY + amplitudes[x]!)
      }
      ctx.closePath()

      ctx.fillStyle = WAVEFORM_FILL_COLOR
      ctx.fill()

      // Thin stroke along the top contour for definition
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR
      ctx.lineWidth = 0.75
      ctx.stroke()
    },
    [
      peaks,
      peakSampleCount,
      duration,
      sampleRate,
      sourceStart,
      sourceEnd,
      trimStart,
      speed,
      isReversed,
      sourceDuration,
      height,
      normalizationPeak,
      stereo,
    ],
  )

  const activeTileCount = useMemo(
    () =>
      getWaveformActiveTileCount({
        renderWidth: renderClipWidth,
        visibleStartPx,
        visibleEndPx,
      }),
    [renderClipWidth, visibleStartPx, visibleEndPx],
  )
  const renderVersion = useAdaptiveWaveformRenderVersion({
    baseVersion: `${loadedSamples}:${height}`,
    pixelsPerSecond,
    renderWidth: renderClipWidth,
    activeTileCount,
    phaseKey: mediaId,
  })

  // Show empty state for unsupported/failed waveforms (no infinite skeleton).
  if (!audioCodecSupported || !!error) {
    return (
      <div ref={containerRef} className="absolute inset-0 flex items-center">
        {/* Flat line to indicate no waveform available */}
        <div className="w-full h-[1px] bg-foreground/20" style={{ marginTop: 0 }} />
      </div>
    )
  }

  // Show skeleton only while actively loading.
  if (!peaks || peaks.length === 0 || height === 0) {
    if (!isLoading && height > 0) {
      return (
        <div ref={containerRef} className="absolute inset-0 flex items-center">
          <div className="w-full h-[1px] bg-foreground/20" style={{ marginTop: 0 }} />
        </div>
      )
    }
    return (
      <div ref={containerRef} className="absolute inset-0">
        <WaveformSkeleton clipWidth={clipWidth} height={height || 24} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
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
  )
})
