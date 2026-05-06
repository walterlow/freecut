import { useCallback, useRef, type MutableRefObject } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import type { PreviewPerfSnapshot } from '../utils/preview-constants'

let devJitterMonitor: import('@/shared/logging/frame-jitter-monitor').FrameJitterMonitor | null =
  null
if (import.meta.env.DEV) {
  void import('@/shared/logging/frame-jitter-monitor').then((module) => {
    devJitterMonitor = module.getFrameJitterMonitor()
  })
}

export interface PreviewPerfStats {
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

interface UsePreviewDiagnosticsParams {
  renderSourceRef: MutableRefObject<PreviewPerfSnapshot['renderSource']>
}

export function usePreviewDiagnostics({ renderSourceRef }: UsePreviewDiagnosticsParams) {
  const previewPerfRef = useRef<PreviewPerfStats>({
    resolveSamples: 0,
    resolveTotalMs: 0,
    resolveTotalIds: 0,
    resolveLastMs: 0,
    resolveLastIds: 0,
    preloadScanSamples: 0,
    preloadScanTotalMs: 0,
    preloadScanLastMs: 0,
    preloadBatchSamples: 0,
    preloadBatchTotalMs: 0,
    preloadBatchLastMs: 0,
    preloadBatchLastIds: 0,
    preloadCandidateIds: 0,
    preloadBudgetBase: 0,
    preloadBudgetAdjusted: 0,
    preloadWindowMaxCost: 0,
    preloadScanBudgetYields: 0,
    preloadContinuations: 0,
    preloadScrubDirection: 0,
    preloadDirectionPenaltyCount: 0,
    sourceWarmTarget: 0,
    sourceWarmKeep: 0,
    sourceWarmEvictions: 0,
    sourcePoolSources: 0,
    sourcePoolElements: 0,
    sourcePoolActiveClips: 0,
    fastScrubPrewarmedSources: 0,
    fastScrubPrewarmSourceEvictions: 0,
    staleScrubOverlayDrops: 0,
    scrubDroppedFrames: 0,
    scrubUpdates: 0,
    adaptiveQualityDowngrades: 0,
    adaptiveQualityRecovers: 0,
  })

  const pushTransitionTrace = useCallback(
    (phase: string, data: Record<string, unknown> = {}) => {
      if (!import.meta.env.DEV) return

      const nextEntry: Record<string, unknown> = {
        ts: Date.now(),
        phase,
        renderSource: renderSourceRef.current,
        currentFrame: usePlaybackStore.getState().currentFrame,
        ...data,
      }
      const history = window.__PREVIEW_TRANSITIONS__ ?? []
      window.__PREVIEW_TRANSITIONS__ = [...history.slice(-99), nextEntry]
    },
    [renderSourceRef],
  )

  const recordRenderFrameJitter = useCallback(
    (
      frame: number,
      renderMs: number,
      inTransition: boolean,
      transitionId: string | null,
      progress: number | null,
    ) => {
      devJitterMonitor?.recordRenderFrame(frame, renderMs, inTransition, transitionId, progress)
    },
    [],
  )

  return {
    previewPerfRef,
    pushTransitionTrace,
    recordRenderFrameJitter,
  }
}
