import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { useMediaDependencyStore } from '@/features/preview/deps/timeline-store'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { proxyService, useMediaLibraryStore } from '@/features/preview/deps/media-library'
import { createLogger } from '@/shared/logging/logger'
import { resolveMediaUrl } from '../utils/media-resolver'
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator'
import {
  PRELOAD_AHEAD_SECONDS,
  RESOLVE_DEFER_DURING_SCRUB_MS,
  RESOLVE_MAX_CONCURRENCY,
  RESOLVE_RETRY_MAX_MS,
  RESOLVE_RETRY_MIN_MS,
  getCostAdjustedBudget,
  getResolvePassBudget,
} from '../utils/preview-constants'
import type { TimelineTrack } from '@/types/timeline'

const logger = createLogger('VideoPreview')

type ResolveMediaBatchResult = {
  resolvedEntries: Array<{ mediaId: string; url: string }>
  failedIds: string[]
}

interface UsePreviewMediaResolutionParams {
  fps: number
  combinedTracks: TimelineTrack[]
  mediaResolveCostById: Map<string, number>
  mediaDependencyVersion: number
  blobUrlVersion: number
  brokenMediaCount: number
  previewPerfRef: MutableRefObject<{
    resolveSamples: number
    resolveTotalMs: number
    resolveTotalIds: number
    resolveLastMs: number
    resolveLastIds: number
  }>
  isGizmoInteractingRef: MutableRefObject<boolean>
}

export function usePreviewMediaResolution({
  fps,
  combinedTracks,
  mediaResolveCostById,
  mediaDependencyVersion,
  blobUrlVersion,
  brokenMediaCount,
  previewPerfRef,
  isGizmoInteractingRef,
}: UsePreviewMediaResolutionParams) {
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(new Map())
  const [isResolving, setIsResolving] = useState(false)
  const [urlRefreshVersion, setUrlRefreshVersion] = useState(0)
  const [resolveRetryTick, setResolveRetryTick] = useState(0)

  const unresolvedMediaIdsRef = useRef<string[]>([])
  const unresolvedMediaIdSetRef = useRef<Set<string>>(new Set())
  const pendingResolvePromisesRef = useRef<Map<string, Promise<string | null>>>(new Map())
  const preloadResolveInFlightRef = useRef(false)
  const preloadBurstRemainingRef = useRef(0)
  const preloadScanTrackCursorRef = useRef(0)
  const preloadScanItemCursorRef = useRef(0)
  const preloadLastAnchorFrameRef = useRef<number | null>(null)
  const resolveFailureCountRef = useRef<Map<string, number>>(new Map())
  const resolveRetryAfterRef = useRef<Map<string, number>>(new Map())
  const resolveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvePassInFlightRef = useRef(false)
  const lastSyncedMediaDependencyVersionRef = useRef<number>(-1)

  const rebuildUnresolvedMediaIds = useCallback((resolvedMap: Map<string, string>) => {
    const mediaIds = useMediaDependencyStore.getState().mediaIds
    const unresolvedSet = new Set<string>()
    for (const mediaId of mediaIds) {
      if (!resolvedMap.has(mediaId)) {
        unresolvedSet.add(mediaId)
      }
    }
    unresolvedMediaIdSetRef.current = unresolvedSet
    unresolvedMediaIdsRef.current = [...unresolvedSet]
    return unresolvedMediaIdsRef.current
  }, [])

  const addUnresolvedMediaIds = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return
    const activeMediaIds = useMediaDependencyStore.getState().mediaIds
    const activeMediaIdSet = new Set(activeMediaIds)
    const unresolvedSet = unresolvedMediaIdSetRef.current
    let changed = false

    for (const mediaId of mediaIds) {
      if (!activeMediaIdSet.has(mediaId)) continue
      if (!unresolvedSet.has(mediaId)) {
        unresolvedSet.add(mediaId)
        changed = true
      }
    }

    if (changed) {
      unresolvedMediaIdsRef.current = [...unresolvedSet]
    }
  }, [])

  const removeUnresolvedMediaIds = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return
    const unresolvedSet = unresolvedMediaIdSetRef.current
    let changed = false

    for (const mediaId of mediaIds) {
      if (unresolvedSet.delete(mediaId)) {
        changed = true
      }
    }

    if (changed) {
      unresolvedMediaIdsRef.current = [...unresolvedSet]
    }
  }, [])

  const clearResolveRetryState = useCallback((mediaIds: string[]) => {
    if (mediaIds.length === 0) return
    for (const mediaId of mediaIds) {
      resolveFailureCountRef.current.delete(mediaId)
      resolveRetryAfterRef.current.delete(mediaId)
    }
  }, [])

  const pruneResolveRetryState = useCallback((activeMediaIdSet: Set<string>) => {
    for (const mediaId of resolveFailureCountRef.current.keys()) {
      if (!activeMediaIdSet.has(mediaId)) {
        resolveFailureCountRef.current.delete(mediaId)
      }
    }
    for (const mediaId of resolveRetryAfterRef.current.keys()) {
      if (!activeMediaIdSet.has(mediaId)) {
        resolveRetryAfterRef.current.delete(mediaId)
      }
    }
  }, [])

  const markResolveFailures = useCallback((mediaIds: string[]): number | null => {
    if (mediaIds.length === 0) return null
    const now = Date.now()
    let earliestRetryAt: number | null = null

    for (const mediaId of mediaIds) {
      const nextFailures = (resolveFailureCountRef.current.get(mediaId) ?? 0) + 1
      resolveFailureCountRef.current.set(mediaId, nextFailures)

      const exponent = Math.min(nextFailures - 1, 6)
      const retryDelayMs = Math.min(
        RESOLVE_RETRY_MAX_MS,
        RESOLVE_RETRY_MIN_MS * Math.pow(2, exponent),
      )
      const retryAt = now + retryDelayMs
      resolveRetryAfterRef.current.set(mediaId, retryAt)
      if (earliestRetryAt === null || retryAt < earliestRetryAt) {
        earliestRetryAt = retryAt
      }
    }

    return earliestRetryAt
  }, [])

  const getResolveRetryAt = useCallback((mediaId: string): number => {
    return resolveRetryAfterRef.current.get(mediaId) ?? 0
  }, [])

  const resolveRetryTimerAtRef = useRef<number | null>(null)

  const scheduleResolveRetryWake = useCallback((retryAt: number | null) => {
    if (retryAt === null) {
      if (resolveRetryTimerRef.current) {
        clearTimeout(resolveRetryTimerRef.current)
        resolveRetryTimerRef.current = null
      }
      resolveRetryTimerAtRef.current = null
      return
    }

    if (
      resolveRetryTimerRef.current &&
      resolveRetryTimerAtRef.current !== null &&
      resolveRetryTimerAtRef.current <= retryAt
    ) {
      return
    }

    if (resolveRetryTimerRef.current) {
      clearTimeout(resolveRetryTimerRef.current)
    }
    resolveRetryTimerAtRef.current = retryAt
    const delayMs = Math.max(0, retryAt - Date.now())
    resolveRetryTimerRef.current = setTimeout(() => {
      resolveRetryTimerRef.current = null
      resolveRetryTimerAtRef.current = null
      setResolveRetryTick((v) => v + 1)
    }, delayMs)
  }, [])

  const resetResolveRetryState = useCallback(() => {
    resolveFailureCountRef.current.clear()
    resolveRetryAfterRef.current.clear()
    if (resolveRetryTimerRef.current) {
      clearTimeout(resolveRetryTimerRef.current)
      resolveRetryTimerRef.current = null
    }
    resolveRetryTimerAtRef.current = null
  }, [])

  const kickResolvePass = useCallback(() => {
    if (resolvePassInFlightRef.current) return
    setResolveRetryTick((tick) => tick + 1)
  }, [])

  const getUnresolvedQueueSize = useCallback(() => {
    return unresolvedMediaIdSetRef.current.size
  }, [])

  const getPendingResolveCount = useCallback(() => {
    return pendingResolvePromisesRef.current.size
  }, [])

  const resolveMediaUrlDeduped = useCallback((mediaId: string): Promise<string | null> => {
    const pendingMap = pendingResolvePromisesRef.current
    const existingPromise = pendingMap.get(mediaId)
    if (existingPromise) {
      return existingPromise
    }

    const promise = resolveMediaUrl(mediaId)
      .then((url) => url ?? null)
      .catch(() => null)
      .finally(() => {
        pendingMap.delete(mediaId)
      })

    pendingMap.set(mediaId, promise)
    return promise
  }, [])

  const resolveMediaBatch = useCallback(
    async (mediaIds: string[]): Promise<ResolveMediaBatchResult> => {
      if (mediaIds.length === 0) {
        return { resolvedEntries: [], failedIds: [] }
      }

      const resolvedEntries: Array<{ mediaId: string; url: string }> = []
      const failedIds: string[] = []
      let cursor = 0
      const workerCount = Math.min(RESOLVE_MAX_CONCURRENCY, mediaIds.length)

      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const index = cursor
            cursor += 1
            if (index >= mediaIds.length) break
            const mediaId = mediaIds[index]!
            const url = await resolveMediaUrlDeduped(mediaId)
            if (url) {
              resolvedEntries.push({ mediaId, url })
            } else {
              failedIds.push(mediaId)
            }
          }
        }),
      )

      return { resolvedEntries, failedIds }
    },
    [resolveMediaUrlDeduped],
  )

  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds)
  const prevBrokenRef = useRef<string[]>([])

  useEffect(() => {
    const prev = prevBrokenRef.current
    prevBrokenRef.current = brokenMediaIds
    const relinkedIds = prev.filter((id) => !brokenMediaIds.includes(id))
    if (relinkedIds.length > 0) {
      clearResolveRetryState(relinkedIds)
      addUnresolvedMediaIds(relinkedIds)
      setResolvedUrls((prevUrls) => {
        const next = new Map(prevUrls)
        let changed = false
        for (const id of relinkedIds) {
          if (next.delete(id)) changed = true
        }
        return changed ? next : prevUrls
      })
    }
  }, [addUnresolvedMediaIds, brokenMediaIds, clearResolveRetryState])

  useEffect(() => {
    if (resolvedUrls.size === 0) {
      return
    }

    const activeMediaIds = useMediaDependencyStore.getState().mediaIds
    if (activeMediaIds.length === 0) {
      return
    }

    const activeMediaIdSet = new Set(activeMediaIds)
    const staleMediaIds: string[] = []

    for (const [mediaId, resolvedUrl] of resolvedUrls.entries()) {
      if (!activeMediaIdSet.has(mediaId)) continue
      const latestBlobUrl = blobUrlManager.get(mediaId)
      if (latestBlobUrl !== resolvedUrl) {
        staleMediaIds.push(mediaId)
      }
    }

    if (staleMediaIds.length === 0) {
      return
    }

    clearResolveRetryState(staleMediaIds)
    addUnresolvedMediaIds(staleMediaIds)
    setResolvedUrls((prevUrls) => {
      const nextUrls = new Map(prevUrls)
      let changed = false
      for (const mediaId of staleMediaIds) {
        if (nextUrls.delete(mediaId)) {
          changed = true
        }
      }
      return changed ? nextUrls : prevUrls
    })
    kickResolvePass()
  }, [addUnresolvedMediaIds, blobUrlVersion, clearResolveRetryState, kickResolvePass, resolvedUrls])

  useEffect(() => {
    let isCancelled = false

    async function resolve() {
      resolvePassInFlightRef.current = true
      try {
        const mediaIds = useMediaDependencyStore.getState().mediaIds

        if (mediaIds.length === 0) {
          unresolvedMediaIdSetRef.current.clear()
          unresolvedMediaIdsRef.current = []
          resetResolveRetryState()
          setResolvedUrls((prevUrls) => (prevUrls.size === 0 ? prevUrls : new Map()))
          setIsResolving(false)
          return
        }

        const activeMediaIdSet = new Set(mediaIds)
        pruneResolveRetryState(activeMediaIdSet)
        let effectiveResolvedUrls = resolvedUrls
        let unresolved = unresolvedMediaIdsRef.current

        if (lastSyncedMediaDependencyVersionRef.current !== mediaDependencyVersion) {
          lastSyncedMediaDependencyVersionRef.current = mediaDependencyVersion
          if (resolvedUrls.size > 0) {
            const prunedUrls = new Map<string, string>()
            for (const [mediaId, url] of resolvedUrls.entries()) {
              if (activeMediaIdSet.has(mediaId)) {
                prunedUrls.set(mediaId, url)
              }
            }
            effectiveResolvedUrls = prunedUrls
            if (prunedUrls.size !== resolvedUrls.size) {
              setResolvedUrls(prunedUrls)
            }
          }
          unresolved = rebuildUnresolvedMediaIds(effectiveResolvedUrls)
        } else if (unresolved.length === 0) {
          unresolved = rebuildUnresolvedMediaIds(effectiveResolvedUrls)
        }

        if (unresolved.length === 0) {
          scheduleResolveRetryWake(null)
          setIsResolving(false)
          return
        }

        const unresolvedSet = new Set(unresolved)
        const now = Date.now()
        let earliestRetryAt: number | null = null
        const playbackState = usePlaybackStore.getState()
        const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
          playbackState,
          isGizmoInteractingRef.current,
        )
        const interactionMode = runtimeSnapshot.mode
        const anchorFrame = runtimeSnapshot.anchorFrame
        if (interactionMode === 'scrubbing' && effectiveResolvedUrls.size > 0) {
          scheduleResolveRetryWake(Date.now() + RESOLVE_DEFER_DURING_SCRUB_MS)
          setIsResolving(false)
          return
        }
        const costPenaltyFrames = Math.max(12, Math.round(fps * 0.6))
        const activeWindowFrames = Math.max(24, Math.round(fps * PRELOAD_AHEAD_SECONDS))
        const minActiveWindowFrame = anchorFrame - activeWindowFrames
        const maxActiveWindowFrame = anchorFrame + activeWindowFrames
        const priorityByMediaId = new Map<string, number>()
        let maxActiveWindowCost = 0

        for (const track of combinedTracks) {
          for (const item of track.items) {
            if (!item.mediaId || !unresolvedSet.has(item.mediaId)) continue
            const itemEndFrame = item.from + item.durationInFrames
            const distanceToAnchor =
              anchorFrame < item.from
                ? item.from - anchorFrame
                : anchorFrame > itemEndFrame
                  ? anchorFrame - itemEndFrame
                  : 0
            const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1
            const score = distanceToAnchor + mediaCost * costPenaltyFrames
            const previousScore = priorityByMediaId.get(item.mediaId)
            if (previousScore === undefined || score < previousScore) {
              priorityByMediaId.set(item.mediaId, score)
            }
            if (!(itemEndFrame < minActiveWindowFrame || item.from > maxActiveWindowFrame)) {
              if (mediaCost > maxActiveWindowCost) {
                maxActiveWindowCost = mediaCost
              }
            }
          }
        }

        const readyCandidates: Array<{ mediaId: string; score: number }> = []
        for (const mediaId of unresolved) {
          const retryAt = getResolveRetryAt(mediaId)
          if (retryAt > now) {
            if (earliestRetryAt === null || retryAt < earliestRetryAt) {
              earliestRetryAt = retryAt
            }
            continue
          }

          const mediaCost = mediaResolveCostById.get(mediaId) ?? 1
          const fallbackScore = activeWindowFrames * 4 + mediaCost * costPenaltyFrames
          readyCandidates.push({
            mediaId,
            score: priorityByMediaId.get(mediaId) ?? fallbackScore,
          })
        }

        if (readyCandidates.length === 0) {
          scheduleResolveRetryWake(earliestRetryAt)
          setIsResolving(false)
          return
        }

        const resolvePassBudget = getCostAdjustedBudget(
          getResolvePassBudget(interactionMode),
          maxActiveWindowCost,
        )
        const readyToResolve = readyCandidates
          .toSorted((a, b) => a.score - b.score)
          .slice(0, resolvePassBudget)
          .map((candidate) => candidate.mediaId)
        const hasMoreReadyCandidates = readyCandidates.length > readyToResolve.length

        scheduleResolveRetryWake(null)

        if (effectiveResolvedUrls.size === 0) {
          setIsResolving(true)
          await new Promise((r) => setTimeout(r, 150))
        }

        if (isCancelled) {
          setIsResolving(false)
          return
        }

        try {
          const newUrls = new Map(effectiveResolvedUrls)
          const resolveBatchStartMs = performance.now()
          const { resolvedEntries, failedIds } = await resolveMediaBatch(readyToResolve)
          const resolveBatchDurationMs = performance.now() - resolveBatchStartMs
          previewPerfRef.current.resolveSamples += 1
          previewPerfRef.current.resolveTotalMs += resolveBatchDurationMs
          previewPerfRef.current.resolveTotalIds += readyToResolve.length
          previewPerfRef.current.resolveLastMs = resolveBatchDurationMs
          previewPerfRef.current.resolveLastIds = readyToResolve.length
          const resolvedNow = resolvedEntries.map((entry) => entry.mediaId)
          for (const entry of resolvedEntries) {
            newUrls.set(entry.mediaId, entry.url)
          }
          clearResolveRetryState(resolvedNow)
          const retryAt = markResolveFailures(failedIds)
          if (retryAt !== null) {
            scheduleResolveRetryWake(retryAt)
          }
          if (hasMoreReadyCandidates) {
            scheduleResolveRetryWake(Date.now() + 16)
          }
          removeUnresolvedMediaIds(resolvedNow)

          if (!isCancelled) {
            setResolvedUrls(newUrls)
          }
        } catch (error) {
          logger.error('Failed to resolve media URLs:', error)
        } finally {
          setIsResolving(false)
        }
      } finally {
        resolvePassInFlightRef.current = false
      }
    }

    void resolve()

    return () => {
      isCancelled = true
    }
  }, [
    clearResolveRetryState,
    combinedTracks,
    fps,
    getResolveRetryAt,
    markResolveFailures,
    mediaResolveCostById,
    pruneResolveRetryState,
    rebuildUnresolvedMediaIds,
    removeUnresolvedMediaIds,
    resetResolveRetryState,
    resolveMediaBatch,
    resolveRetryTick,
    scheduleResolveRetryWake,
    mediaDependencyVersion,
    brokenMediaCount,
    urlRefreshVersion,
    resolvedUrls,
    isGizmoInteractingRef,
    previewPerfRef,
  ])

  useEffect(() => {
    let lastHiddenAt = 0
    const STALE_THRESHOLD_MS = 30_000

    const handleVisibilityChange = async () => {
      if (document.hidden) {
        lastHiddenAt = Date.now()
        return
      }

      if (lastHiddenAt === 0 || Date.now() - lastHiddenAt < STALE_THRESHOLD_MS) {
        return
      }

      try {
        await proxyService.refreshAllBlobUrls()
      } catch {
        // Best effort.
      }

      blobUrlManager.invalidateAll()

      const clearedUrls = new Map<string, string>()
      resetResolveRetryState()
      setResolvedUrls(clearedUrls)
      rebuildUnresolvedMediaIds(clearedUrls)
      setUrlRefreshVersion((v) => v + 1)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [rebuildUnresolvedMediaIds, resetResolveRetryState])

  return {
    resolvedUrls,
    setResolvedUrls,
    isResolving,
    unresolvedMediaIdSetRef,
    preloadResolveInFlightRef,
    preloadBurstRemainingRef,
    preloadScanTrackCursorRef,
    preloadScanItemCursorRef,
    preloadLastAnchorFrameRef,
    getUnresolvedQueueSize,
    getPendingResolveCount,
    getResolveRetryAt,
    resolveMediaBatch,
    clearResolveRetryState,
    removeUnresolvedMediaIds,
    markResolveFailures,
    scheduleResolveRetryWake,
    kickResolvePass,
    resetResolveRetryState,
  }
}
