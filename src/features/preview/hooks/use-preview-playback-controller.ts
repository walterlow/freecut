import { useCallback, useState, type MutableRefObject } from 'react'
import type { PreviewQuality } from '@/shared/state/playback'
import { usePlaybackStore } from '@/shared/state/playback'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  type AdaptivePreviewQualityState,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality'
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard'
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator'
import { usePreviewRuntimeGuards } from './use-preview-runtime-guards'
import type { PreviewPerfStats } from './use-preview-diagnostics'

interface UsePreviewPlaybackControllerParams {
  fps: number
  combinedTracks: TimelineTrack[]
  keyframes: ItemKeyframes[]
  activeGizmoItemType: TimelineItem['type'] | null
  isGizmoInteracting: boolean
  isPlaying: boolean
  forceFastScrubOverlay: boolean
  previewPerfRef: MutableRefObject<PreviewPerfStats>
  isGizmoInteractingRef: MutableRefObject<boolean>
  preferPlayerForTextGizmoRef: MutableRefObject<boolean>
  preferPlayerForStyledTextScrubRef: MutableRefObject<boolean>
  adaptiveQualityStateRef: MutableRefObject<AdaptivePreviewQualityState>
  adaptiveFrameSampleRef: MutableRefObject<{ frame: number; tsMs: number } | null>
  ignorePlayerUpdatesRef: MutableRefObject<boolean>
  resolvePendingSeekLatency: (frame: number) => void
}

export function usePreviewPlaybackController({
  fps,
  combinedTracks,
  keyframes,
  activeGizmoItemType,
  isGizmoInteracting,
  isPlaying,
  forceFastScrubOverlay,
  previewPerfRef,
  isGizmoInteractingRef,
  preferPlayerForTextGizmoRef,
  preferPlayerForStyledTextScrubRef,
  adaptiveQualityStateRef,
  adaptiveFrameSampleRef,
  ignorePlayerUpdatesRef,
  resolvePendingSeekLatency,
}: UsePreviewPlaybackControllerParams) {
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1)

  usePreviewRuntimeGuards({
    isGizmoInteracting,
    isGizmoInteractingRef,
    isPlaying,
    adaptiveQualityCap,
    setAdaptiveQualityCap,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
  })

  const preferPlayerForStyledTextScrub =
    !forceFastScrubOverlay && shouldPreferPlayerForStyledTextScrubGuard(combinedTracks, keyframes)
  const preferPlayerForTextGizmo =
    !forceFastScrubOverlay && isGizmoInteracting && activeGizmoItemType === 'text'
  preferPlayerForTextGizmoRef.current = preferPlayerForTextGizmo
  preferPlayerForStyledTextScrubRef.current = preferPlayerForStyledTextScrub

  const shouldPreferPlayerForPreview = useCallback(
    (previewFrame: number | null) => {
      return (
        preferPlayerForTextGizmoRef.current ||
        (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
      )
    },
    [preferPlayerForStyledTextScrubRef, preferPlayerForTextGizmoRef],
  )

  const handleFrameChange = useCallback(
    (frame: number) => {
      const nextFrame = Math.round(frame)
      resolvePendingSeekLatency(nextFrame)
      if (ignorePlayerUpdatesRef.current) return
      const playbackState = usePlaybackStore.getState()
      const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
        playbackState,
        isGizmoInteractingRef.current,
      )
      const interactionMode = runtimeSnapshot.mode
      if (interactionMode === 'scrubbing') return

      if (interactionMode === 'playing') {
        const nowMs = performance.now()
        const previousSample = adaptiveFrameSampleRef.current
        if (previousSample && nextFrame !== previousSample.frame) {
          const frameDelta = Math.max(1, Math.abs(nextFrame - previousSample.frame))
          const elapsedMs = nowMs - previousSample.tsMs
          if (elapsedMs > 0) {
            const result = updateAdaptivePreviewQuality({
              state: adaptiveQualityStateRef.current,
              sampleMsPerFrame: elapsedMs / frameDelta,
              frameBudgetMs: getFrameBudgetMs(fps, playbackState.playbackRate),
              userQuality: playbackState.previewQuality,
              nowMs,
              allowRecovery: false,
            })
            adaptiveQualityStateRef.current = result.state
            if (result.qualityChanged) {
              if (result.qualityChangeDirection === 'degrade') {
                previewPerfRef.current.adaptiveQualityDowngrades += 1
              } else if (result.qualityChangeDirection === 'recover') {
                previewPerfRef.current.adaptiveQualityRecovers += 1
              }
              setAdaptiveQualityCap(result.state.qualityCap)
            }
          }
        }
        adaptiveFrameSampleRef.current = { frame: nextFrame, tsMs: nowMs }
      } else {
        adaptiveFrameSampleRef.current = null
        if (
          adaptiveQualityStateRef.current.overBudgetSamples !== 0 ||
          adaptiveQualityStateRef.current.underBudgetSamples !== 0
        ) {
          adaptiveQualityStateRef.current = {
            ...adaptiveQualityStateRef.current,
            overBudgetSamples: 0,
            underBudgetSamples: 0,
          }
        }
      }

      const { currentFrame, setCurrentFrame } = playbackState
      if (currentFrame === nextFrame) return
      setCurrentFrame(nextFrame)
    },
    [
      adaptiveFrameSampleRef,
      adaptiveQualityStateRef,
      fps,
      ignorePlayerUpdatesRef,
      isGizmoInteractingRef,
      previewPerfRef,
      resolvePendingSeekLatency,
    ],
  )

  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play()
    } else {
      usePlaybackStore.getState().pause()
    }
  }, [])

  return {
    adaptiveQualityCap,
    shouldPreferPlayerForPreview,
    handleFrameChange,
    handlePlayStateChange,
  }
}
