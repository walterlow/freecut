import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { PreviewQuality } from '@/shared/state/playback'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineStore } from '@/features/preview/deps/timeline-store'
import { createLogger } from '@/shared/logging/logger'
import { getDecoderPrewarmMetricsSnapshot } from '../utils/decoder-prewarm'
import { getEffectivePreviewQuality, getFrameBudgetMs } from '../utils/adaptive-preview-quality'
import {
  PREVIEW_PERF_PUBLISH_INTERVAL_MS,
  PREVIEW_PERF_SEEK_TIMEOUT_MS,
  type PreviewPerfSnapshot,
} from '../utils/preview-constants'
import {
  recordSeekLatency,
  recordSeekLatencyTimeout,
  type SeekLatencyStats,
} from '../utils/preview-perf-metrics'
import type {
  TransitionPreviewSessionTrace,
  TransitionPreviewTelemetry,
} from './use-preview-transition-session-controller'

const logger = createLogger('VideoPreview')

interface PreviewPerfStats {
  resolveSamples: number
  resolveTotalMs: number
  resolveTotalIds: number
  resolveLastMs: number
  resolveLastIds: number
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
  sourceWarmTarget: number
  sourceWarmKeep: number
  sourceWarmEvictions: number
  sourcePoolSources: number
  sourcePoolElements: number
  sourcePoolActiveClips: number
  fastScrubPrewarmedSources: number
  fastScrubPrewarmSourceEvictions: number
  staleScrubOverlayDrops: number
  scrubDroppedFrames: number
  scrubUpdates: number
  adaptiveQualityDowngrades: number
  adaptiveQualityRecovers: number
}

interface AdaptiveQualityStateSnapshot {
  qualityCap: PreviewQuality
  frameTimeEmaMs: number
}

interface UsePreviewPerfPublisherParams {
  previewPerfRef: MutableRefObject<PreviewPerfStats>
  adaptiveQualityStateRef: MutableRefObject<AdaptiveQualityStateSnapshot>
  transitionSessionTraceRef: MutableRefObject<TransitionPreviewSessionTrace | null>
  transitionTelemetryRef: MutableRefObject<TransitionPreviewTelemetry>
  transitionSessionBufferedFramesRef: MutableRefObject<Map<number, OffscreenCanvas>>
  renderSourceRef: MutableRefObject<PreviewPerfSnapshot['renderSource']>
  renderSourceSwitchCountRef: MutableRefObject<number>
  renderSourceHistoryRef: MutableRefObject<PreviewPerfSnapshot['renderSourceHistory']>
  getUnresolvedQueueSize: () => number
  getPendingResolveCount: () => number
}

export function usePreviewPerfPublisher({
  previewPerfRef,
  adaptiveQualityStateRef,
  transitionSessionTraceRef,
  transitionTelemetryRef,
  transitionSessionBufferedFramesRef,
  renderSourceRef,
  renderSourceSwitchCountRef,
  renderSourceHistoryRef,
  getUnresolvedQueueSize,
  getPendingResolveCount,
}: UsePreviewPerfPublisherParams) {
  const pendingSeekLatencyRef = useRef<{ targetFrame: number; startedAtMs: number } | null>(null)
  const seekLatencyStatsRef = useRef<SeekLatencyStats>({
    samples: 0,
    totalMs: 0,
    lastMs: 0,
    timeouts: 0,
  })

  const trackPlayerSeek = useCallback((targetFrame: number) => {
    if (!import.meta.env.DEV) return
    pendingSeekLatencyRef.current = {
      targetFrame,
      startedAtMs: performance.now(),
    }
  }, [])

  const resolvePendingSeekLatency = useCallback((frame: number) => {
    if (!import.meta.env.DEV) return
    const pending = pendingSeekLatencyRef.current
    if (!pending || pending.targetFrame !== frame) return

    seekLatencyStatsRef.current = recordSeekLatency(
      seekLatencyStatsRef.current,
      performance.now() - pending.startedAtMs,
    )
    pendingSeekLatencyRef.current = null
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return

    const publish = () => {
      const stats = previewPerfRef.current
      const seekNow = performance.now()
      const playbackState = usePlaybackStore.getState()
      const timelineFps = useTimelineStore.getState().fps
      const adaptiveQualityState = adaptiveQualityStateRef.current
      const frameTimeBudgetMs = getFrameBudgetMs(timelineFps, playbackState.playbackRate)
      const userPreviewQuality = playbackState.previewQuality
      const effectiveQuality = getEffectivePreviewQuality(
        userPreviewQuality,
        adaptiveQualityState.qualityCap,
      )
      const pendingSeek = pendingSeekLatencyRef.current
      if (pendingSeek && seekNow - pendingSeek.startedAtMs >= PREVIEW_PERF_SEEK_TIMEOUT_MS) {
        seekLatencyStatsRef.current = recordSeekLatencyTimeout(seekLatencyStatsRef.current)
        pendingSeekLatencyRef.current = null
      }

      const seekStats = seekLatencyStatsRef.current
      const activeTransitionTrace = transitionSessionTraceRef.current
      const transitionTelemetry = transitionTelemetryRef.current
      const pendingSeekAgeMs = pendingSeekLatencyRef.current
        ? Math.max(0, seekNow - pendingSeekLatencyRef.current.startedAtMs)
        : 0
      const preseekMetrics = getDecoderPrewarmMetricsSnapshot()
      const snapshot: PreviewPerfSnapshot = {
        ts: Date.now(),
        unresolvedQueue: getUnresolvedQueueSize(),
        pendingResolves: getPendingResolveCount(),
        renderSource: renderSourceRef.current,
        renderSourceSwitches: renderSourceSwitchCountRef.current,
        renderSourceHistory: [...renderSourceHistoryRef.current],
        resolveAvgMs: stats.resolveSamples > 0 ? stats.resolveTotalMs / stats.resolveSamples : 0,
        resolveMsPerId:
          stats.resolveTotalIds > 0 ? stats.resolveTotalMs / stats.resolveTotalIds : 0,
        resolveLastMs: stats.resolveLastMs,
        resolveLastIds: stats.resolveLastIds,
        preloadScanAvgMs:
          stats.preloadScanSamples > 0 ? stats.preloadScanTotalMs / stats.preloadScanSamples : 0,
        preloadScanLastMs: stats.preloadScanLastMs,
        preloadBatchAvgMs:
          stats.preloadBatchSamples > 0 ? stats.preloadBatchTotalMs / stats.preloadBatchSamples : 0,
        preloadBatchLastMs: stats.preloadBatchLastMs,
        preloadBatchLastIds: stats.preloadBatchLastIds,
        preloadCandidateIds: stats.preloadCandidateIds,
        preloadBudgetBase: stats.preloadBudgetBase,
        preloadBudgetAdjusted: stats.preloadBudgetAdjusted,
        preloadWindowMaxCost: stats.preloadWindowMaxCost,
        preloadScanBudgetYields: stats.preloadScanBudgetYields,
        preloadContinuations: stats.preloadContinuations,
        preloadScrubDirection: stats.preloadScrubDirection,
        preloadDirectionPenaltyCount: stats.preloadDirectionPenaltyCount,
        sourceWarmTarget: stats.sourceWarmTarget,
        sourceWarmKeep: stats.sourceWarmKeep,
        sourceWarmEvictions: stats.sourceWarmEvictions,
        sourcePoolSources: stats.sourcePoolSources,
        sourcePoolElements: stats.sourcePoolElements,
        sourcePoolActiveClips: stats.sourcePoolActiveClips,
        fastScrubPrewarmedSources: stats.fastScrubPrewarmedSources,
        fastScrubPrewarmSourceEvictions: stats.fastScrubPrewarmSourceEvictions,
        preseekRequests: preseekMetrics.requests,
        preseekCacheHits: preseekMetrics.cacheHits,
        preseekInflightReuses: preseekMetrics.inflightReuses,
        preseekWorkerPosts: preseekMetrics.workerPosts,
        preseekWorkerSuccesses: preseekMetrics.workerSuccesses,
        preseekWorkerFailures: preseekMetrics.workerFailures,
        preseekWaitRequests: preseekMetrics.waitRequests,
        preseekWaitMatches: preseekMetrics.waitMatches,
        preseekWaitResolved: preseekMetrics.waitResolved,
        preseekWaitTimeouts: preseekMetrics.waitTimeouts,
        preseekCachedBitmaps: preseekMetrics.cacheBitmaps,
        staleScrubOverlayDrops: stats.staleScrubOverlayDrops,
        scrubDroppedFrames: stats.scrubDroppedFrames,
        scrubUpdates: stats.scrubUpdates,
        seekLatencyAvgMs: seekStats.samples > 0 ? seekStats.totalMs / seekStats.samples : 0,
        seekLatencyLastMs: seekStats.lastMs,
        seekLatencyPendingMs: pendingSeekAgeMs,
        seekLatencyTimeouts: seekStats.timeouts,
        userPreviewQuality,
        adaptiveQualityCap: adaptiveQualityState.qualityCap,
        effectivePreviewQuality: effectiveQuality,
        frameTimeBudgetMs,
        frameTimeEmaMs: adaptiveQualityState.frameTimeEmaMs,
        adaptiveQualityDowngrades: stats.adaptiveQualityDowngrades,
        adaptiveQualityRecovers: stats.adaptiveQualityRecovers,
        transitionSessionActive: activeTransitionTrace !== null,
        transitionSessionMode: activeTransitionTrace?.mode ?? 'none',
        transitionSessionComplex: activeTransitionTrace?.complex ?? false,
        transitionSessionStartFrame: activeTransitionTrace?.startFrame ?? -1,
        transitionSessionEndFrame: activeTransitionTrace?.endFrame ?? -1,
        transitionBufferedFrames: transitionSessionBufferedFramesRef.current.size,
        transitionPreparedFrame: activeTransitionTrace?.lastPreparedFrame ?? -1,
        transitionLastPrepareMs:
          activeTransitionTrace?.lastPrepareMs ?? transitionTelemetry.lastPrepareMs,
        transitionLastReadyLeadMs:
          activeTransitionTrace &&
          activeTransitionTrace.enteredAtMs !== null &&
          activeTransitionTrace.firstPreparedAtMs !== null
            ? Math.max(
                0,
                activeTransitionTrace.enteredAtMs - activeTransitionTrace.firstPreparedAtMs,
              )
            : transitionTelemetry.lastReadyLeadMs,
        transitionLastEntryMisses:
          activeTransitionTrace?.entryMisses ?? transitionTelemetry.lastEntryMisses,
        transitionLastSessionDurationMs: activeTransitionTrace
          ? Math.max(0, seekNow - activeTransitionTrace.startedAtMs)
          : transitionTelemetry.lastSessionDurationMs,
        transitionSessionCount: transitionTelemetry.sessionCount,
      }

      window.__PREVIEW_PERF__ = snapshot
      if (window.__PREVIEW_PERF_LOG__) {
        logger.warn('PreviewPerf', snapshot)
      }
    }

    publish()
    const intervalId = setInterval(publish, PREVIEW_PERF_PUBLISH_INTERVAL_MS)
    return () => {
      clearInterval(intervalId)
      window.__PREVIEW_PERF__ = undefined
    }
  }, [
    adaptiveQualityStateRef,
    getPendingResolveCount,
    getUnresolvedQueueSize,
    previewPerfRef,
    renderSourceHistoryRef,
    renderSourceRef,
    renderSourceSwitchCountRef,
    transitionSessionBufferedFramesRef,
    transitionSessionTraceRef,
    transitionTelemetryRef,
  ])

  return {
    trackPlayerSeek,
    resolvePendingSeekLatency,
  }
}
