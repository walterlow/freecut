import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { TimelineTrack } from '@/types/timeline'
import { usePlaybackStore } from '@/shared/state/playback'
import { getPreloadWindowRange } from '../utils/preload-window'
import {
  getPreviewRuntimeSnapshotFromPlaybackState,
  resolvePreviewTransitionFromPlaybackStates,
} from '../utils/preview-state-coordinator'
import {
  PRELOAD_AHEAD_SECONDS,
  PRELOAD_BACKWARD_SCRUB_EXTRA_IDS,
  PRELOAD_BACKWARD_SCRUB_THROTTLE_MS,
  PRELOAD_BURST_EXTRA_IDS,
  PRELOAD_BURST_MAX_IDS_PER_TICK,
  PRELOAD_BURST_PASSES,
  PRELOAD_FORWARD_SCRUB_THROTTLE_MS,
  PRELOAD_SCAN_TIME_BUDGET_MS,
  PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS,
  PRELOAD_SKIP_ON_BACKWARD_SCRUB,
  getCostAdjustedBudget,
  getDirectionalScrubStartIndex,
  getFrameDirection,
  getPreloadBudget,
} from '../utils/preview-constants'

type ResolveMediaBatchResult = {
  resolvedEntries: Array<{ mediaId: string; url: string }>
  failedIds: string[]
}

export interface PreviewPreloadPerfState {
  preloadScanSamples: number
  preloadScanTotalMs: number
  preloadScanLastMs: number
  preloadBatchSamples: number
  preloadBatchTotalMs: number
  preloadBatchLastMs: number
  preloadBatchLastIds: number
  preloadCandidateIds: number
  preloadBudgetBase: number
  preloadBudgetAdjusted: number
  preloadWindowMaxCost: number
  preloadScanBudgetYields: number
  preloadContinuations: number
  preloadScrubDirection: -1 | 0 | 1
  preloadDirectionPenaltyCount: number
}

interface UsePreviewMediaPreloadParams {
  fps: number
  combinedTracks: TimelineTrack[]
  mediaResolveCostById: Map<string, number>
  previewPerfRef: MutableRefObject<PreviewPreloadPerfState>
  setResolvedUrls: Dispatch<SetStateAction<Map<string, string>>>
  isGizmoInteractingRef: MutableRefObject<boolean>
  unresolvedMediaIdSetRef: MutableRefObject<Set<string>>
  preloadResolveInFlightRef: MutableRefObject<boolean>
  preloadBurstRemainingRef: MutableRefObject<number>
  preloadScanTrackCursorRef: MutableRefObject<number>
  preloadScanItemCursorRef: MutableRefObject<number>
  preloadLastAnchorFrameRef: MutableRefObject<number | null>
  lastForwardScrubPreloadAtRef: MutableRefObject<number>
  lastBackwardScrubPreloadAtRef: MutableRefObject<number>
  getResolveRetryAt: (mediaId: string) => number
  resolveMediaBatch: (mediaIds: string[]) => Promise<ResolveMediaBatchResult>
  clearResolveRetryState: (mediaIds: string[]) => void
  removeUnresolvedMediaIds: (mediaIds: string[]) => void
  markResolveFailures: (mediaIds: string[]) => number | null
  scheduleResolveRetryWake: (retryAt: number | null) => void
  kickResolvePass: () => void
}

export function usePreviewMediaPreload({
  fps,
  combinedTracks,
  mediaResolveCostById,
  previewPerfRef,
  setResolvedUrls,
  isGizmoInteractingRef,
  unresolvedMediaIdSetRef,
  preloadResolveInFlightRef,
  preloadBurstRemainingRef,
  preloadScanTrackCursorRef,
  preloadScanItemCursorRef,
  preloadLastAnchorFrameRef,
  lastForwardScrubPreloadAtRef,
  lastBackwardScrubPreloadAtRef,
  getResolveRetryAt,
  resolveMediaBatch,
  clearResolveRetryState,
  removeUnresolvedMediaIds,
  markResolveFailures,
  scheduleResolveRetryWake,
  kickResolvePass,
}: UsePreviewMediaPreloadParams) {
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null
    let continuationTimeoutId: ReturnType<typeof setTimeout> | null = null

    const schedulePreloadContinuation = () => {
      if (continuationTimeoutId !== null) return
      previewPerfRef.current.preloadContinuations += 1
      continuationTimeoutId = setTimeout(() => {
        continuationTimeoutId = null
        void preloadMedia()
      }, 16)
    }

    const preloadMedia = async () => {
      if (preloadResolveInFlightRef.current) return
      if (combinedTracks.length === 0) return
      const burstActive = preloadBurstRemainingRef.current > 0
      if (burstActive) {
        preloadBurstRemainingRef.current = Math.max(0, preloadBurstRemainingRef.current - 1)
      }

      const playbackState = usePlaybackStore.getState()
      const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
        playbackState,
        isGizmoInteractingRef.current,
      )
      const interactionMode = runtimeSnapshot.mode
      const anchorFrame = runtimeSnapshot.anchorFrame
      const previousAnchorFrame = preloadLastAnchorFrameRef.current
      preloadLastAnchorFrameRef.current = anchorFrame
      const scrubDirection: -1 | 0 | 1 =
        interactionMode === 'scrubbing' && previousAnchorFrame !== null
          ? getFrameDirection(previousAnchorFrame, anchorFrame)
          : 0
      if (PRELOAD_SKIP_ON_BACKWARD_SCRUB && interactionMode === 'scrubbing' && scrubDirection < 0) {
        previewPerfRef.current.preloadCandidateIds = 0
        previewPerfRef.current.preloadBudgetBase = getPreloadBudget(interactionMode)
        previewPerfRef.current.preloadBudgetAdjusted = 0
        previewPerfRef.current.preloadWindowMaxCost = 0
        previewPerfRef.current.preloadScrubDirection = scrubDirection
        previewPerfRef.current.preloadDirectionPenaltyCount = 0
        return
      }
      const { startFrame: preloadStartFrame, endFrame: preloadEndFrame } = getPreloadWindowRange({
        mode: interactionMode,
        anchorFrame,
        scrubDirection,
        fps,
        aheadSeconds: PRELOAD_AHEAD_SECONDS,
      })
      const baseMaxIdsPerTick = getPreloadBudget(interactionMode)
      const backwardScrubExtraIds =
        interactionMode === 'scrubbing' && scrubDirection < 0 ? PRELOAD_BACKWARD_SCRUB_EXTRA_IDS : 0
      const boostedBaseMaxIdsPerTick = burstActive
        ? Math.min(
            PRELOAD_BURST_MAX_IDS_PER_TICK,
            baseMaxIdsPerTick + PRELOAD_BURST_EXTRA_IDS + backwardScrubExtraIds,
          )
        : baseMaxIdsPerTick + backwardScrubExtraIds
      const now = Date.now()
      const unresolvedSet = unresolvedMediaIdSetRef.current
      const costPenaltyFrames = Math.max(8, Math.round(fps * 0.6))
      const scrubDirectionBiasFrames = Math.max(
        8,
        Math.round(fps * PRELOAD_SCRUB_DIRECTION_BIAS_SECONDS),
      )
      const scanStartTime = performance.now()
      let maxActiveWindowCost = 0
      let directionPenaltyCount = 0
      let reachedScanTimeBudget = false
      let trackIndex =
        ((preloadScanTrackCursorRef.current % combinedTracks.length) + combinedTracks.length) %
        combinedTracks.length
      let itemIndex = Math.max(0, preloadScanItemCursorRef.current)

      const mediaToPreloadScores = new Map<string, number>()
      if (interactionMode === 'scrubbing') {
        for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
          const currentTrackIndex = (trackIndex + trackCount) % combinedTracks.length
          const track = combinedTracks[currentTrackIndex]!
          const trackItems = track.items
          if (trackItems.length === 0) continue

          const step = scrubDirection < 0 ? -1 : 1
          let localItemIndex = getDirectionalScrubStartIndex(
            trackItems,
            anchorFrame,
            scrubDirection,
          )

          while (localItemIndex >= 0 && localItemIndex < trackItems.length) {
            const item = trackItems[localItemIndex]!
            if (!item.mediaId) {
              localItemIndex += step
              continue
            }

            const itemEnd = item.from + item.durationInFrames
            if (item.from <= preloadEndFrame && itemEnd >= preloadStartFrame) {
              if (unresolvedSet.has(item.mediaId) && getResolveRetryAt(item.mediaId) <= now) {
                const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1
                if (mediaCost > maxActiveWindowCost) {
                  maxActiveWindowCost = mediaCost
                }
                const distanceToPlayhead =
                  anchorFrame < item.from
                    ? item.from - anchorFrame
                    : anchorFrame > itemEnd
                      ? anchorFrame - itemEnd
                      : 0
                let score = distanceToPlayhead + mediaCost * costPenaltyFrames
                if (scrubDirection !== 0) {
                  const itemCenterFrame = item.from + item.durationInFrames * 0.5
                  const isDirectionAligned =
                    scrubDirection > 0
                      ? itemCenterFrame >= anchorFrame
                      : itemCenterFrame <= anchorFrame
                  if (!isDirectionAligned) {
                    score += scrubDirectionBiasFrames
                    directionPenaltyCount += 1
                  }
                }
                const previousScore = mediaToPreloadScores.get(item.mediaId)
                if (previousScore === undefined || score < previousScore) {
                  mediaToPreloadScores.set(item.mediaId, score)
                }
              }
            }

            if (performance.now() - scanStartTime >= PRELOAD_SCAN_TIME_BUDGET_MS) {
              preloadScanTrackCursorRef.current = currentTrackIndex
              preloadScanItemCursorRef.current = 0
              reachedScanTimeBudget = true
              break
            }

            localItemIndex += step
          }

          if (reachedScanTimeBudget) break
        }

        if (!reachedScanTimeBudget) {
          preloadScanTrackCursorRef.current = (trackIndex + 1) % combinedTracks.length
          preloadScanItemCursorRef.current = 0
        }
      } else {
        for (let trackCount = 0; trackCount < combinedTracks.length; trackCount++) {
          const track = combinedTracks[trackIndex]!
          const trackItems = track.items
          const startItemIndex = trackCount === 0 ? itemIndex : 0

          for (
            let localItemIndex = startItemIndex;
            localItemIndex < trackItems.length;
            localItemIndex++
          ) {
            const item = trackItems[localItemIndex]!
            if (!item.mediaId) continue
            const itemEnd = item.from + item.durationInFrames
            if (item.from <= preloadEndFrame && itemEnd >= preloadStartFrame) {
              if (unresolvedSet.has(item.mediaId) && getResolveRetryAt(item.mediaId) <= now) {
                const mediaCost = mediaResolveCostById.get(item.mediaId) ?? 1
                if (mediaCost > maxActiveWindowCost) {
                  maxActiveWindowCost = mediaCost
                }
                const distanceToPlayhead =
                  anchorFrame < item.from
                    ? item.from - anchorFrame
                    : anchorFrame > itemEnd
                      ? anchorFrame - itemEnd
                      : 0
                let score = distanceToPlayhead + mediaCost * costPenaltyFrames
                if (scrubDirection !== 0) {
                  const itemCenterFrame = item.from + item.durationInFrames * 0.5
                  const isDirectionAligned =
                    scrubDirection > 0
                      ? itemCenterFrame >= anchorFrame
                      : itemCenterFrame <= anchorFrame
                  if (!isDirectionAligned) {
                    score += scrubDirectionBiasFrames
                    directionPenaltyCount += 1
                  }
                }
                const previousScore = mediaToPreloadScores.get(item.mediaId)
                if (previousScore === undefined || score < previousScore) {
                  mediaToPreloadScores.set(item.mediaId, score)
                }
              }
            }

            if (performance.now() - scanStartTime >= PRELOAD_SCAN_TIME_BUDGET_MS) {
              let nextTrackIndex = trackIndex
              let nextItemIndex = localItemIndex + 1
              if (nextItemIndex >= trackItems.length) {
                nextTrackIndex = (trackIndex + 1) % combinedTracks.length
                nextItemIndex = 0
              }
              preloadScanTrackCursorRef.current = nextTrackIndex
              preloadScanItemCursorRef.current = nextItemIndex
              reachedScanTimeBudget = true
              break
            }
          }

          if (reachedScanTimeBudget) break

          trackIndex = (trackIndex + 1) % combinedTracks.length
          itemIndex = 0
        }

        if (!reachedScanTimeBudget) {
          preloadScanTrackCursorRef.current = trackIndex
          preloadScanItemCursorRef.current = 0
        }
      }

      const scanDurationMs = performance.now() - scanStartTime
      previewPerfRef.current.preloadScanSamples += 1
      previewPerfRef.current.preloadScanTotalMs += scanDurationMs
      previewPerfRef.current.preloadScanLastMs = scanDurationMs
      if (reachedScanTimeBudget) {
        previewPerfRef.current.preloadScanBudgetYields += 1
      }

      const maxIdsPerTick = getCostAdjustedBudget(boostedBaseMaxIdsPerTick, maxActiveWindowCost)
      previewPerfRef.current.preloadCandidateIds = mediaToPreloadScores.size
      previewPerfRef.current.preloadBudgetBase = baseMaxIdsPerTick
      previewPerfRef.current.preloadBudgetAdjusted = maxIdsPerTick
      previewPerfRef.current.preloadWindowMaxCost = maxActiveWindowCost
      previewPerfRef.current.preloadScrubDirection = scrubDirection
      previewPerfRef.current.preloadDirectionPenaltyCount = directionPenaltyCount

      if (mediaToPreloadScores.size === 0) {
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation()
        }
        return
      }

      const mediaToPreload = [...mediaToPreloadScores.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, maxIdsPerTick)
        .map(([mediaId]) => mediaId)

      preloadResolveInFlightRef.current = true
      try {
        const preloadBatchStartMs = performance.now()
        const { resolvedEntries, failedIds } = await resolveMediaBatch(mediaToPreload)
        const preloadBatchDurationMs = performance.now() - preloadBatchStartMs
        previewPerfRef.current.preloadBatchSamples += 1
        previewPerfRef.current.preloadBatchTotalMs += preloadBatchDurationMs
        previewPerfRef.current.preloadBatchLastMs = preloadBatchDurationMs
        previewPerfRef.current.preloadBatchLastIds = mediaToPreload.length
        if (resolvedEntries.length > 0) {
          const resolvedNow: string[] = []
          const applicableEntries: Array<{ mediaId: string; url: string }> = []
          for (const entry of resolvedEntries) {
            if (!unresolvedMediaIdSetRef.current.has(entry.mediaId)) continue
            resolvedNow.push(entry.mediaId)
            applicableEntries.push(entry)
          }
          setResolvedUrls((prevUrls) => {
            const nextUrls = new Map(prevUrls)
            let changed = false
            for (const entry of applicableEntries) {
              if (nextUrls.get(entry.mediaId) === entry.url) continue
              nextUrls.set(entry.mediaId, entry.url)
              changed = true
            }
            return changed ? nextUrls : prevUrls
          })
          clearResolveRetryState(resolvedNow)
          removeUnresolvedMediaIds(resolvedNow)
        }
        if (failedIds.length > 0) {
          const retryAt = markResolveFailures(failedIds)
          if (retryAt !== null) {
            scheduleResolveRetryWake(retryAt)
          }
        }
      } finally {
        preloadResolveInFlightRef.current = false
        if (reachedScanTimeBudget || preloadBurstRemainingRef.current > 0) {
          schedulePreloadContinuation()
        }
      }
    }

    const startPreloadBurst = () => {
      preloadBurstRemainingRef.current = Math.max(
        preloadBurstRemainingRef.current,
        PRELOAD_BURST_PASSES,
      )
      void preloadMedia()
    }

    void preloadMedia()

    const unsubscribe = usePlaybackStore.subscribe((state, prevState) => {
      const transition = resolvePreviewTransitionFromPlaybackStates({
        prev: prevState,
        next: state,
        isGizmoInteracting: isGizmoInteractingRef.current,
        fps,
      })
      const interactionMode = transition.next.mode
      const burstTrigger = transition.preloadBurstTrigger

      if (transition.enteredPlaying) {
        lastForwardScrubPreloadAtRef.current = 0
        lastBackwardScrubPreloadAtRef.current = 0
        void preloadMedia()
        intervalId = setInterval(() => {
          void preloadMedia()
        }, 1000)
      } else if (burstTrigger === 'scrub_enter') {
        lastForwardScrubPreloadAtRef.current = 0
        lastBackwardScrubPreloadAtRef.current = 0
        startPreloadBurst()
        kickResolvePass()
      } else if (interactionMode === 'scrubbing' && transition.previewFrameChanged) {
        const previewDelta = (state.previewFrame ?? 0) - (prevState.previewFrame ?? 0)
        if (previewDelta < 0) {
          if (PRELOAD_SKIP_ON_BACKWARD_SCRUB) {
            return
          }
          const nowMs = performance.now()
          if (nowMs - lastBackwardScrubPreloadAtRef.current < PRELOAD_BACKWARD_SCRUB_THROTTLE_MS) {
            return
          }
          lastBackwardScrubPreloadAtRef.current = nowMs
        } else if (previewDelta > 0) {
          const nowMs = performance.now()
          if (nowMs - lastForwardScrubPreloadAtRef.current < PRELOAD_FORWARD_SCRUB_THROTTLE_MS) {
            return
          }
          lastForwardScrubPreloadAtRef.current = nowMs
        }
        void preloadMedia()
      } else if (
        interactionMode !== 'playing' &&
        interactionMode !== 'scrubbing' &&
        transition.currentFrameChanged
      ) {
        lastForwardScrubPreloadAtRef.current = 0
        lastBackwardScrubPreloadAtRef.current = 0
        if (burstTrigger === 'paused_short_seek') {
          startPreloadBurst()
        } else {
          void preloadMedia()
        }
        kickResolvePass()
      } else if (transition.exitedPlaying) {
        lastForwardScrubPreloadAtRef.current = 0
        lastBackwardScrubPreloadAtRef.current = 0
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      }
    })

    return () => {
      unsubscribe()
      if (intervalId) {
        clearInterval(intervalId)
      }
      if (continuationTimeoutId !== null) {
        clearTimeout(continuationTimeoutId)
      }
      lastForwardScrubPreloadAtRef.current = 0
      lastBackwardScrubPreloadAtRef.current = 0
      preloadBurstRemainingRef.current = 0
    }
  }, [
    clearResolveRetryState,
    combinedTracks,
    fps,
    getResolveRetryAt,
    isGizmoInteractingRef,
    kickResolvePass,
    lastBackwardScrubPreloadAtRef,
    lastForwardScrubPreloadAtRef,
    markResolveFailures,
    mediaResolveCostById,
    preloadBurstRemainingRef,
    preloadLastAnchorFrameRef,
    preloadResolveInFlightRef,
    preloadScanItemCursorRef,
    preloadScanTrackCursorRef,
    previewPerfRef,
    removeUnresolvedMediaIds,
    resolveMediaBatch,
    scheduleResolveRetryWake,
    setResolvedUrls,
    unresolvedMediaIdSetRef,
  ])
}
