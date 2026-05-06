import { useState, useEffect, useRef, useEffectEvent, useMemo } from 'react'
import { filmstripCache, type Filmstrip, type FilmstripFrame } from '../services/filmstrip-cache'
import { getPreviewStartupDelayMs, schedulePreviewWork } from './preview-work-budget'

export type { FilmstripFrame }

interface UseFilmstripOptions {
  /** Media ID from the timeline item */
  mediaId: string
  /** Blob URL for the video file */
  blobUrl: string | null
  /** Total source duration in seconds */
  duration: number
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean
  /** Whether to enable filmstrip (allows conditional disabling) */
  enabled?: boolean
  /** Source window to prioritize for extraction (seconds) */
  priorityWindow?: { startTime: number; endTime: number } | null
  /** Approximate number of frames needed for the current viewport */
  targetFrameCount?: number
  /** Exact 1fps frame indices needed for the current viewport */
  targetFrameIndices?: number[]
}

interface UseFilmstripResult {
  /** Array of frames with URLs for img src */
  frames: FilmstripFrame[] | null
  /** Whether filmstrip is currently loading/extracting */
  isLoading: boolean
  /** Whether extraction is complete */
  isComplete: boolean
  /** Loading progress (0-100) */
  progress: number
  /** Error message if generation failed */
  error: string | null
}

/**
 * Hook for managing filmstrip thumbnails for a video clip
 *
 * Returns object URLs for use in <img src> tags.
 * Progressive loading: updates as frames are extracted.
 * Startup is deferred to idle/interaction budget so timeline creation stays responsive.
 */
export function useFilmstrip({
  mediaId,
  blobUrl,
  duration,
  isVisible,
  enabled = true,
  priorityWindow = null,
  targetFrameCount,
  targetFrameIndices,
}: UseFilmstripOptions): UseFilmstripResult {
  // Initialize from cache to avoid flash on remount
  const [filmstrip, setFilmstrip] = useState<Filmstrip | null>(() => {
    return filmstripCache.getFromCacheSync(mediaId)
  })
  const [isLoading, setIsLoading] = useState(false)
  const [progress, setProgress] = useState(() => {
    const cached = filmstripCache.getFromCacheSync(mediaId)
    return cached?.isComplete ? 100 : (cached?.progress ?? 0)
  })
  const [error, setError] = useState<string | null>(null)

  const isGeneratingRef = useRef(false)
  const hasPendingStartRef = useRef(false)
  const lastMediaIdRef = useRef<string>(mediaId)

  // Reset state when mediaId changes (e.g., after relinking orphaned clip)
  useEffect(() => {
    if (lastMediaIdRef.current !== mediaId) {
      lastMediaIdRef.current = mediaId
      isGeneratingRef.current = false
      hasPendingStartRef.current = false
      const cached = filmstripCache.getFromCacheSync(mediaId)
      setFilmstrip(cached)
      setIsLoading(false)
      setProgress(cached?.isComplete ? 100 : (cached?.progress ?? 0))
      setError(null)
    }
  }, [mediaId])

  const onProgress = useEffectEvent((nextProgress: number) => {
    setProgress(nextProgress)
  })

  // Abort any in-flight extraction when this consumer goes away or switches media.
  useEffect(() => {
    return () => {
      filmstripCache.abort(mediaId)
    }
  }, [mediaId])

  // Filmstrip extraction runs at 1fps, so quantize the requested source
  // window to frame indices before passing it to the cache.
  const priorityRange = useMemo(() => {
    if (!priorityWindow) return null

    const startIndex = Math.max(0, Math.floor(priorityWindow.startTime))
    const endIndex = Math.max(startIndex + 1, Math.ceil(priorityWindow.endTime))
    return { startIndex, endIndex }
  }, [priorityWindow])

  const normalizedTargetFrameCount = useMemo(() => {
    if (
      typeof targetFrameCount !== 'number' ||
      !Number.isFinite(targetFrameCount) ||
      targetFrameCount <= 0
    ) {
      return undefined
    }
    return Math.max(1, Math.ceil(targetFrameCount))
  }, [targetFrameCount])

  const normalizedTargetFrameIndices = useMemo(() => {
    if (!Array.isArray(targetFrameIndices) || targetFrameIndices.length === 0) {
      return undefined
    }

    const indices = new Set<number>()
    for (const index of targetFrameIndices) {
      if (typeof index !== 'number' || !Number.isFinite(index)) {
        continue
      }
      indices.add(Math.max(0, Math.round(index)))
    }

    const normalized = Array.from(indices).sort((a, b) => a - b)
    return normalized.length > 0 ? normalized : undefined
  }, [targetFrameIndices])

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return
    }

    const unsubscribe = filmstripCache.subscribe(mediaId, (updated) => {
      setFilmstrip(updated)
      setProgress(updated.progress)
      setIsLoading(updated.isExtracting)
    })

    return unsubscribe
  }, [mediaId, enabled, blobUrl, duration])

  // Once a clip leaves the active workset, stop spending background decode time on it.
  useEffect(() => {
    if (enabled && blobUrl && duration > 0 && isVisible) {
      return
    }

    filmstripCache.abort(mediaId)
    isGeneratingRef.current = false
    hasPendingStartRef.current = false
    setIsLoading(false)
  }, [mediaId, enabled, blobUrl, duration, isVisible])

  // Load filmstrip when visible
  useEffect(() => {
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return
    }

    if (!isVisible && !isGeneratingRef.current && !hasPendingStartRef.current) {
      return
    }

    const needsPriorityRefinement = filmstripCache.needsPriorityRefinement(
      mediaId,
      duration,
      priorityRange,
      normalizedTargetFrameCount,
      normalizedTargetFrameIndices,
    )

    if (filmstrip?.isComplete && !needsPriorityRefinement) {
      return
    }

    if (isGeneratingRef.current || hasPendingStartRef.current) {
      return
    }

    hasPendingStartRef.current = true
    setIsLoading(true)
    setError(null)

    let cancelled = false
    const requestMediaId = mediaId
    const shouldStartImmediately = !filmstrip?.frames?.length
    const cancelScheduledStart = schedulePreviewWork(
      () => {
        if (cancelled || lastMediaIdRef.current !== requestMediaId) {
          hasPendingStartRef.current = false
          return
        }

        hasPendingStartRef.current = false
        isGeneratingRef.current = true

        filmstripCache
          .getFilmstrip(mediaId, blobUrl, duration, onProgress, priorityRange ?? undefined, {
            targetFrameCount: normalizedTargetFrameCount,
            targetFrameIndices: normalizedTargetFrameIndices,
          })
          .then((result) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            setFilmstrip(result)
            setProgress(result.progress)
            setIsLoading(result.isExtracting)
          })
          .catch((err) => {
            if (cancelled || lastMediaIdRef.current !== requestMediaId) {
              return
            }
            if (err.message !== 'Aborted') {
              setError(err.message || 'Failed to generate filmstrip')
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
        delayMs: shouldStartImmediately ? 0 : getPreviewStartupDelayMs(duration),
        ignoreAudioStartupHold: true,
      },
    )

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
    duration,
    isVisible,
    enabled,
    filmstrip?.frames?.length,
    filmstrip?.isComplete,
    priorityRange,
    normalizedTargetFrameCount,
    normalizedTargetFrameIndices,
  ])

  return {
    frames: filmstrip?.frames || null,
    isLoading: isLoading || (filmstrip?.isExtracting ?? false),
    isComplete: filmstrip?.isComplete ?? false,
    progress,
    error,
  }
}
