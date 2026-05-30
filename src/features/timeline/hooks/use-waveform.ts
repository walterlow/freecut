import { useState, useEffect, useRef, useEffectEvent } from 'react'
import {
  waveformCache,
  type CachedWaveform,
  type CachedWaveformLevel,
} from '../services/waveform-cache'
import { chooseDisplayLevelForZoom } from '../services/waveform-opfs-storage'
import { getPreviewStartupDelayMs, schedulePreviewWork } from './preview-work-budget'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('useWaveform')
const RANGE_FIRST_MIN_DURATION_SEC = 5 * 60

interface UseWaveformOptions {
  /** Media ID from the timeline item */
  mediaId: string
  /** Blob URL for the audio file */
  blobUrl: string | null
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean
  /** Whether to enable waveform (allows conditional disabling) */
  enabled?: boolean
  /** Source/media duration used to size the deferred startup budget */
  deferDurationSec?: number
  /**
   * Current timeline zoom (pixels/sec). Selects which downsampled resolution
   * level to render so memory stays bounded regardless of clip length. Omit to
   * render the full-resolution peaks (legacy behavior).
   */
  pixelsPerSecond?: number
  /** Visible source window in seconds, used for range-first generation. */
  visibleSourceStartSec?: number
  visibleSourceEndSec?: number
}

interface UseWaveformResult {
  /** Peak amplitude data (raw mono or stereo-interleaved waveform) */
  peaks: Float32Array | null
  /** Audio duration in seconds */
  duration: number
  /** Samples per second in peaks data */
  sampleRate: number
  /** Number of audio channels */
  channels: number
  /** Whether peak data is stereo interleaved [L0, R0, L1, R1, ...] */
  stereo: boolean
  /** Highest peak observed so far */
  maxPeak: number
  /** Number of decoded peak entries available so far */
  loadedSamples: number
  /** Whether waveform is currently loading */
  isLoading: boolean
  /** Loading progress (0-100) */
  progress: number
  /** Error message if generation failed */
  error: string | null
}

/**
 * Hook for managing waveform data for an audio clip.
 *
 * Rendering source priority:
 * 1. A zoom-appropriate downsampled level from the persisted OPFS
 *    multi-resolution file (small, bounded memory) — preferred when available.
 * 2. The full-resolution peaks (memory cache → IndexedDB/OPFS → worker
 *    generation) — used while a waveform is still being generated, or for media
 *    that has no persisted multi-resolution file yet.
 *
 * Loading a level instead of the full-res peaks keeps only a fraction of the
 * data resident when zoomed out, so a long clip no longer pins tens of MB in
 * memory — and a clip that remounts (e.g. dragged to another track) renders
 * from the synchronously-cached level without a skeleton flash.
 */
export function useWaveform({
  mediaId,
  blobUrl,
  isVisible,
  enabled = true,
  deferDurationSec = 0,
  pixelsPerSecond,
  visibleSourceStartSec,
  visibleSourceEndSec,
}: UseWaveformOptions): UseWaveformResult {
  // Which downsampled level the current zoom wants. When pixelsPerSecond is
  // omitted, force the full-res path by treating the level as unavailable.
  const useLevels = pixelsPerSecond !== undefined
  const levelIndex = chooseDisplayLevelForZoom(pixelsPerSecond ?? 0)

  // Preferred display source: a single downsampled level. Seeded synchronously
  // so a remount with an already-loaded level shows no skeleton.
  const [displayLevel, setDisplayLevel] = useState<CachedWaveformLevel | null>(() =>
    useLevels && enabled ? waveformCache.getDisplayLevelSync(mediaId, levelIndex) : null,
  )
  // Whether we've checked OPFS for a persisted level for the current media.
  // Generation is gated on this so we never regenerate a clip that already has
  // a persisted multi-resolution file.
  const [levelProbed, setLevelProbed] = useState<boolean>(
    () =>
      !useLevels || (enabled && waveformCache.getDisplayLevelSync(mediaId, levelIndex) !== null),
  )

  // Full-resolution fallback state (generation + progressive streaming).
  const [waveform, setWaveform] = useState<CachedWaveform | null>(() => {
    return waveformCache.getFromMemoryCacheSync(mediaId)
  })
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(() => {
    const cached = waveformCache.getFromMemoryCacheSync(mediaId)
    return cached?.isComplete ? 100 : 0
  })
  const [error, setError] = useState<string | null>(null)

  // Refs to avoid duplicate starts when visibility/layout churns.
  const isGeneratingRef = useRef(false)
  const ownsGenerationRef = useRef(false)
  const hasPendingStartRef = useRef(false)
  const rangeRequestKeyRef = useRef<string | null>(null)
  const lastMediaIdRef = useRef<string>(mediaId)

  // Reset state when mediaId changes (e.g., after relinking orphaned clip)
  useEffect(() => {
    if (lastMediaIdRef.current !== mediaId) {
      lastMediaIdRef.current = mediaId
      isGeneratingRef.current = false
      ownsGenerationRef.current = false
      hasPendingStartRef.current = false
      rangeRequestKeyRef.current = null
      setWaveform(waveformCache.getFromMemoryCacheSync(mediaId))
      setIsLoading(false)
      setProgress(waveformCache.getFromMemoryCacheSync(mediaId)?.isComplete ? 100 : 0)
      setError(null)
      const seededLevel =
        useLevels && enabled ? waveformCache.getDisplayLevelSync(mediaId, levelIndex) : null
      setDisplayLevel(seededLevel)
      setLevelProbed(!useLevels || seededLevel !== null)
    }
  }, [mediaId, useLevels, enabled, levelIndex])

  // Load the zoom-appropriate display level. Re-runs when the level changes
  // (zoom crossing a resolution threshold). The previous level stays visible
  // until the new one loads, so zooming never flashes a skeleton.
  useEffect(() => {
    if (!useLevels || !enabled || !isVisible) {
      return
    }

    const sync = waveformCache.getDisplayLevelSync(mediaId, levelIndex)
    if (sync) {
      setDisplayLevel(sync)
      setLevelProbed(true)
      return
    }

    let cancelled = false
    const requestMediaId = mediaId
    waveformCache
      .getDisplayLevel(mediaId, levelIndex)
      .then((level) => {
        if (cancelled || lastMediaIdRef.current !== requestMediaId) return
        // A null result means this zoom's level isn't persisted: clear any
        // previously-shown (now stale) level so `needsFullRes` flips true and
        // the full-resolution generation path takes over. Leaving a stale
        // coarser level in place would keep `needsFullRes` false forever and
        // permanently strand the clip on the wrong level's peaks.
        setDisplayLevel(level)
        setLevelProbed(true)
      })
      .catch((err) => {
        if (cancelled || lastMediaIdRef.current !== requestMediaId) return
        logger.warn(`Failed to load waveform display level for ${mediaId}`, err)
        setLevelProbed(true)
      })

    return () => {
      cancelled = true
    }
  }, [mediaId, levelIndex, isVisible, enabled, useLevels])

  // Progress callback - using useEffectEvent so it doesn't need to be in effect deps
  const onProgress = useEffectEvent((nextProgress: number) => {
    setProgress(nextProgress)
  })

  // Subscribe to progressive updates and storage hydration. This intentionally
  // does not require blobUrl: persisted waveforms can hydrate before the media
  // source is resolved.
  useEffect(() => {
    if (!enabled) {
      return
    }

    const unsubscribe = waveformCache.subscribe(mediaId, (updated) => {
      setWaveform(updated)
      if (updated.isComplete) {
        setIsLoading(false)
        setProgress(100)
      }
    })

    return unsubscribe
  }, [mediaId, enabled])

  // Generate the full-resolution waveform — only when no persisted display
  // level exists (levelProbed && !displayLevel) or when levels are disabled.
  // A clip with a persisted multi-resolution file renders from its level and
  // never reaches this path, so its full-res peaks stay off the heap.
  const needsFullRes = !useLevels || (levelProbed && !displayLevel)
  const canUseVisibleRange =
    useLevels &&
    enabled &&
    isVisible &&
    !!blobUrl &&
    needsFullRes &&
    deferDurationSec >= RANGE_FIRST_MIN_DURATION_SEC &&
    typeof visibleSourceStartSec === 'number' &&
    typeof visibleSourceEndSec === 'number' &&
    Number.isFinite(visibleSourceStartSec) &&
    Number.isFinite(visibleSourceEndSec) &&
    visibleSourceEndSec > visibleSourceStartSec

  useEffect(() => {
    if (!canUseVisibleRange || !blobUrl) {
      return
    }

    if (waveform?.isComplete) {
      return
    }

    const requestStart = Math.max(0, visibleSourceStartSec as number)
    const requestEnd = Math.max(requestStart + 0.25, visibleSourceEndSec as number)
    const requestKey = `${mediaId}:${levelIndex}:${Math.floor(requestStart * 10)}:${Math.ceil(
      requestEnd * 10,
    )}`
    if (rangeRequestKeyRef.current === requestKey && waveform) {
      return
    }

    rangeRequestKeyRef.current = requestKey
    setIsLoading(true)
    setError(null)

    let cancelled = false
    const requestMediaId = mediaId
    const cancelScheduledStart = schedulePreviewWork(
      () => {
        waveformCache
          .prepareVisibleWaveformRange(
            mediaId,
            blobUrl,
            requestStart,
            requestEnd,
            pixelsPerSecond ?? 0,
            onProgress,
          )
          .then((result) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            if (!result) {
              setIsLoading(false)
              return
            }
            setWaveform(result)
            setIsLoading(false)
            setProgress(100)
          })
          .catch((err) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            logger.warn(`Visible waveform range failed for ${mediaId}`, err)
            setError(err.message || 'Failed to generate waveform range')
            setIsLoading(false)
          })
      },
      {
        delayMs: getPreviewStartupDelayMs(deferDurationSec),
      },
    )

    return () => {
      cancelled = true
      cancelScheduledStart()
    }
  }, [
    mediaId,
    blobUrl,
    canUseVisibleRange,
    visibleSourceStartSec,
    visibleSourceEndSec,
    pixelsPerSecond,
    levelIndex,
    deferDurationSec,
    waveform,
  ])

  useEffect(() => {
    if (!enabled || !needsFullRes) {
      return
    }

    if (canUseVisibleRange) {
      return
    }

    if (isGeneratingRef.current || hasPendingStartRef.current) {
      return
    }

    if (!isVisible) {
      return
    }

    if (waveform?.isComplete) {
      return
    }

    hasPendingStartRef.current = true
    setIsLoading(true)
    setError(null)

    let cancelled = false
    const requestMediaId = mediaId
    const cancelScheduledStart = schedulePreviewWork(
      () => {
        if (cancelled || lastMediaIdRef.current !== requestMediaId) {
          hasPendingStartRef.current = false
          return
        }

        hasPendingStartRef.current = false
        isGeneratingRef.current = true
        ownsGenerationRef.current = false

        waveformCache
          .getCachedWaveform(mediaId)
          .then((result) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return null
            }
            if (result?.isComplete) {
              setWaveform(result)
              setIsLoading(false)
              setProgress(100)
              return null
            }
            if (result) {
              setWaveform(result)
            }
            if (!blobUrl) {
              setIsLoading(false)
              setProgress(0)
              return null
            }

            setProgress(0)
            ownsGenerationRef.current = !waveformCache.hasPendingGeneration(mediaId)
            return waveformCache.getWaveform(mediaId, blobUrl, onProgress)
          })
          .then((result) => {
            if (!result || cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            setWaveform(result)
            setIsLoading(false)
            setProgress(100)
          })
          .catch((err) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            if (err.message !== 'Aborted') {
              logger.warn(`Waveform generation failed for ${mediaId}`, err)
              setError(err.message || 'Failed to generate waveform')
            }
            setIsLoading(false)
          })
          .finally(() => {
            if (lastMediaIdRef.current === requestMediaId) {
              isGeneratingRef.current = false
              ownsGenerationRef.current = false
              hasPendingStartRef.current = false
            }
          })
      },
      {
        delayMs: getPreviewStartupDelayMs(deferDurationSec),
      },
    )

    // Don't abort on effect re-runs - let generation continue in background.
    // The cache will hold the result for when we need it.
    return () => {
      cancelled = true
      if (!isGeneratingRef.current) {
        hasPendingStartRef.current = false
      }
      cancelScheduledStart()
    }
  }, [
    mediaId,
    blobUrl,
    isVisible,
    enabled,
    waveform?.isComplete,
    deferDurationSec,
    needsFullRes,
    canUseVisibleRange,
  ])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (ownsGenerationRef.current) {
        waveformCache.abort(mediaId)
      }
    }
  }, [mediaId])

  // Prefer the downsampled display level; fall back to full-resolution peaks
  // while generating or for media without a persisted multi-resolution file.
  if (displayLevel) {
    return {
      peaks: displayLevel.peaks,
      duration: displayLevel.duration,
      sampleRate: displayLevel.sampleRate,
      channels: displayLevel.channels,
      stereo: displayLevel.stereo,
      maxPeak: displayLevel.maxPeak,
      loadedSamples: displayLevel.loadedSamples,
      isLoading: false,
      progress: 100,
      error: null,
    }
  }

  // No level yet: show full-res if present, otherwise report loading until the
  // OPFS probe (and any generation) resolves.
  const loadingUntilResolved = useLevels && !levelProbed && isVisible && enabled && !waveform
  return {
    peaks: waveform?.peaks ?? null,
    duration: waveform?.duration || 0,
    sampleRate: waveform?.sampleRate || 100,
    channels: waveform?.channels || 1,
    stereo: waveform?.stereo ?? false,
    maxPeak: waveform?.maxPeak ?? 1,
    loadedSamples: waveform?.loadedSamples ?? 0,
    isLoading: isLoading || loadingUntilResolved,
    progress,
    error,
  }
}
