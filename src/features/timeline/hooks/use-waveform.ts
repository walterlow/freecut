import { useState, useEffect, useRef, useEffectEvent } from 'react'
import { waveformCache, type CachedWaveform } from '../services/waveform-cache'
import { getPreviewStartupDelayMs, schedulePreviewWork } from './preview-work-budget'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('useWaveform')

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
 * Hook for managing waveform data for an audio clip
 *
 * - Only generates when visible and has valid blobUrl
 * - Subscribes to progressive updates for streaming loading
 * - Caches results in memory and OPFS
 * - Defers startup until interaction/idle budget allows so new clips do not
 *   block creation gestures
 * - Sync cache check on mount to avoid skeleton flash when moving clips
 */
export function useWaveform({
  mediaId,
  blobUrl,
  isVisible,
  enabled = true,
  deferDurationSec = 0,
}: UseWaveformOptions): UseWaveformResult {
  // State for waveform data - initialize from memory cache to avoid skeleton flash
  // This is important when clips move across tracks (component remounts but cache persists)
  const [waveform, setWaveform] = useState<CachedWaveform | null>(() => {
    return waveformCache.getFromMemoryCacheSync(mediaId)
  })
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(() => {
    // If we have cached data, start at 100%
    const cached = waveformCache.getFromMemoryCacheSync(mediaId)
    return cached?.isComplete ? 100 : 0
  })
  const [error, setError] = useState<string | null>(null)

  // Refs to avoid duplicate starts when visibility/layout churns.
  const isGeneratingRef = useRef(false)
  const hasPendingStartRef = useRef(false)
  const lastMediaIdRef = useRef<string>(mediaId)

  // Reset state when mediaId changes (e.g., after relinking orphaned clip)
  useEffect(() => {
    if (lastMediaIdRef.current !== mediaId) {
      lastMediaIdRef.current = mediaId
      isGeneratingRef.current = false
      hasPendingStartRef.current = false
      setWaveform(waveformCache.getFromMemoryCacheSync(mediaId))
      setIsLoading(false)
      setProgress(waveformCache.getFromMemoryCacheSync(mediaId)?.isComplete ? 100 : 0)
      setError(null)
    }
  }, [mediaId])

  // Progress callback - using useEffectEvent so it doesn't need to be in effect deps
  const onProgress = useEffectEvent((nextProgress: number) => {
    setProgress(nextProgress)
  })

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl) {
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
  }, [mediaId, enabled, blobUrl])

  // Load waveform when visible and conditions are met
  useEffect(() => {
    if (!enabled || !blobUrl) {
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
        setProgress(0)

        waveformCache
          .getWaveform(mediaId, blobUrl, onProgress)
          .then((result) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
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
  }, [mediaId, blobUrl, isVisible, enabled, waveform?.isComplete, deferDurationSec])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      waveformCache.abort(mediaId)
    }
  }, [mediaId])

  return {
    peaks: waveform?.peaks ?? null,
    duration: waveform?.duration || 0,
    sampleRate: waveform?.sampleRate || 100,
    channels: waveform?.channels || 1,
    stereo: waveform?.stereo ?? false,
    maxPeak: waveform?.maxPeak ?? 1,
    loadedSamples: waveform?.loadedSamples ?? 0,
    isLoading,
    progress,
    error,
  }
}
