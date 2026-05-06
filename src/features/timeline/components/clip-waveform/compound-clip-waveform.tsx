import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TiledCanvas } from '../clip-filmstrip/tiled-canvas'
import { WaveformSkeleton } from './waveform-skeleton'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { createLogger } from '@/shared/logging/logger'
import type { SubComposition } from '../../stores/compositions-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { waveformCache, type CachedWaveform } from '../../services/waveform-cache'
import { WAVEFORM_FILL_COLOR, WAVEFORM_STROKE_COLOR } from '../../constants'
import { getCompositionOwnedAudioSources } from '../../utils/composition-clip-summary'
import { mixCompoundClipWaveformPeaks } from '../../utils/compound-clip-waveform'
import { computeWaveformRenderWindow } from './render-window'
import { getPreviewStartupDelayMs, schedulePreviewWork } from '../../hooks/preview-work-budget'
import {
  getWaveformActiveTileCount,
  useAdaptiveWaveformRenderVersion,
} from './adaptive-render-version'

const logger = createLogger('CompoundClipWaveform')
const WAVEFORM_VERTICAL_PADDING_PX = 3

interface CompoundClipWaveformProps {
  composition: SubComposition
  clipWidth: number
  renderWidth?: number
  sourceStart: number
  sourceDuration: number
  isVisible: boolean
  visibleStartRatio?: number
  visibleEndRatio?: number
  pixelsPerSecond: number
}

export const CompoundClipWaveform = memo(function CompoundClipWaveform({
  composition,
  clipWidth,
  renderWidth,
  sourceStart,
  sourceDuration,
  isVisible,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
  pixelsPerSecond,
}: CompoundClipWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const requestTokenRef = useRef(0)
  const pixelsPerSecondRef = useRef(pixelsPerSecond)
  pixelsPerSecondRef.current = pixelsPerSecond
  const amplitudesBufferRef = useRef<Float32Array>(new Float32Array(0))
  const [height, setHeight] = useState(0)
  const [waveformsByMediaId, setWaveformsByMediaId] = useState<Map<string, CachedWaveform>>(
    new Map(),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const compositionById = useCompositionsStore((s) => s.compositionById)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const parent = container.parentElement
      if (parent) {
        setHeight(parent.clientHeight)
      }
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    if (container.parentElement) {
      resizeObserver.observe(container.parentElement)
    }

    return () => resizeObserver.disconnect()
  }, [])

  const mediaFpsById = useMemo<Record<string, number | undefined>>(() => {
    const byId: Record<string, number | undefined> = {}
    for (const [mediaId, media] of Object.entries(mediaById)) {
      byId[mediaId] = media?.fps
    }
    return byId
  }, [mediaById])

  const ownedAudioSources = useMemo(
    () =>
      getCompositionOwnedAudioSources({
        items: composition.items,
        tracks: composition.tracks,
        fps: composition.fps,
        mediaFpsById,
        compositionById,
      }),
    [composition.fps, composition.items, composition.tracks, compositionById, mediaFpsById],
  )
  const mediaIds = useMemo(
    () => Array.from(new Set(ownedAudioSources.map((source) => source.mediaId))).sort(),
    [ownedAudioSources],
  )
  const mediaIdsKey = useMemo(() => mediaIds.join('|'), [mediaIds])
  const visibleClipWidth = clipWidth
  const renderClipWidth = Math.max(visibleClipWidth, renderWidth ?? visibleClipWidth)

  useEffect(() => {
    requestTokenRef.current += 1
    const requestToken = requestTokenRef.current

    if (!isVisible || mediaIds.length === 0) {
      setWaveformsByMediaId(new Map())
      setIsLoading(false)
      setHasError(false)
      return
    }

    const cachedEntries = mediaIds.flatMap((mediaId) => {
      const cached = waveformCache.getFromMemoryCacheSync(mediaId)
      return cached ? [[mediaId, cached] as const] : []
    })
    const cachedMap = new Map<string, CachedWaveform>(cachedEntries)
    setWaveformsByMediaId(cachedMap)

    const missingIds = mediaIds.filter((mediaId) => !cachedMap.has(mediaId))
    if (missingIds.length === 0) {
      setIsLoading(false)
      setHasError(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setHasError(false)

    const cancelScheduledStart = schedulePreviewWork(
      () => {
        void Promise.allSettled(
          missingIds.map(async (mediaId) => {
            const blobUrl = await resolveMediaUrl(mediaId)
            if (!blobUrl) {
              throw new Error(`Missing blob URL for ${mediaId}`)
            }
            const waveform = await waveformCache.getWaveform(mediaId, blobUrl)
            return [mediaId, waveform] as const
          }),
        ).then((results) => {
          if (cancelled || requestToken !== requestTokenRef.current) {
            return
          }

          const resolved = new Map(cachedMap)
          let hadFailure = false
          for (const result of results) {
            if (result.status === 'fulfilled') {
              resolved.set(result.value[0], result.value[1])
            } else {
              hadFailure = true
              logger.warn('Failed to load compound waveform source', result.reason)
            }
          }

          setWaveformsByMediaId(resolved)
          setHasError(hadFailure && resolved.size === 0)
          setIsLoading(false)
        })
      },
      {
        delayMs: getPreviewStartupDelayMs(sourceDuration),
      },
    )

    return () => {
      cancelled = true
      cancelScheduledStart()
    }
  }, [isVisible, mediaIds, mediaIdsKey, sourceDuration])

  const mixedWaveform = useMemo(() => {
    if (ownedAudioSources.length === 0 || waveformsByMediaId.size === 0) {
      return null
    }

    return mixCompoundClipWaveformPeaks({
      sources: ownedAudioSources,
      waveformsByMediaId,
      durationInFrames: composition.durationInFrames,
      fps: composition.fps,
    })
  }, [composition.durationInFrames, composition.fps, ownedAudioSources, waveformsByMediaId])

  const peaks = mixedWaveform?.peaks ?? null
  const sampleRate = mixedWaveform?.sampleRate ?? 0
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
  const normalizationPeak = useMemo(() => {
    if (!peaks || peaks.length === 0) return 1
    let maxPeak = 0
    for (let i = 0; i < peaks.length; i += 1) {
      const value = peaks[i] ?? 0
      if (value > maxPeak) {
        maxPeak = value
      }
    }
    return maxPeak > 0 ? maxPeak : 1
  }, [peaks])

  const renderTile = useCallback(
    (ctx: CanvasRenderingContext2D, _tileIndex: number, tileOffset: number, tileWidth: number) => {
      if (!peaks || peaks.length === 0 || sampleRate <= 0 || sourceDuration <= 0) {
        return
      }

      const currentPps = Math.max(1, pixelsPerSecondRef.current)
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

      for (let x = 0; x < amplitudeCount; x += 1) {
        const timelinePosition = (tileOffset + x) / currentPps
        const compoundTime = sourceStart + timelinePosition

        if (compoundTime < 0 || compoundTime > sourceDuration) {
          continue
        }

        const peakIndex = Math.floor(compoundTime * sampleRate)
        if (peakIndex < 0 || peakIndex >= peaks.length) {
          continue
        }

        const pointWindowSeconds = Math.max(1 / sampleRate, (1 / currentPps) * 0.5)
        const samplesPerPoint = Math.max(1, Math.ceil(pointWindowSeconds * sampleRate))
        const halfWindow = Math.floor(samplesPerPoint / 2)
        const windowStart = Math.max(0, peakIndex - halfWindow)
        const windowEnd = Math.min(peaks.length, peakIndex + halfWindow + 1)

        let max1 = 0
        let max2 = 0
        let windowSum = 0
        let sampleCount = 0
        for (let i = windowStart; i < windowEnd; i += 1) {
          const value = peaks[i] ?? 0
          if (value >= max1) {
            max2 = max1
            max1 = value
          } else if (value > max2) {
            max2 = value
          }
          windowSum += value
          sampleCount += 1
        }

        if (sampleCount === 0) {
          continue
        }

        const normalizedMax1 = Math.min(1, max1 / normalizationPeak)
        const normalizedMax2 = Math.min(1, max2 / normalizationPeak)
        const normalizedMean = Math.min(1, windowSum / sampleCount / normalizationPeak)
        const needle = Math.max(0, normalizedMax1 - normalizedMax2)
        const peakValue = Math.min(1, normalizedMean * 0.38 + normalizedMax2 * 0.34 + needle * 2.35)
        const amp = peakValue <= 0.001 ? 0 : Math.pow(peakValue, 1.05)
        amplitudes[x] = amp * maxWaveHeight
      }

      for (let x = 0; x < amplitudeCount; x += 1) {
        ctx.lineTo(x, centerY - amplitudes[x]!)
      }
      for (let x = amplitudeCount - 1; x >= 0; x -= 1) {
        ctx.lineTo(x, centerY + amplitudes[x]!)
      }
      ctx.closePath()
      ctx.fillStyle = WAVEFORM_FILL_COLOR
      ctx.fill()
      ctx.strokeStyle = WAVEFORM_STROKE_COLOR
      ctx.lineWidth = 0.75
      ctx.stroke()
    },
    [height, normalizationPeak, peaks, sampleRate, sourceDuration, sourceStart],
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
    baseVersion: `${peaks?.length ?? 0}:${height}:${waveformsByMediaId.size}`,
    pixelsPerSecond,
    renderWidth: renderClipWidth,
    activeTileCount,
    phaseKey: mediaIdsKey,
  })

  if (hasError) {
    return (
      <div ref={containerRef} className="absolute inset-0 flex items-center">
        <div className="w-full h-[1px] bg-foreground/20" style={{ marginTop: 0 }} />
      </div>
    )
  }

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
        <WaveformSkeleton clipWidth={visibleClipWidth} height={height || 24} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      {isLoading && <WaveformSkeleton clipWidth={visibleClipWidth} height={height} />}
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
