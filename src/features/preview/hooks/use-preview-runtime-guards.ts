import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { PreviewQuality } from '@/shared/state/playback'
import { usePlaybackStore } from '@/shared/state/playback'
import { ADAPTIVE_PREVIEW_QUALITY_ENABLED } from '../utils/preview-constants'
import { createAdaptivePreviewQualityState } from '../utils/adaptive-preview-quality'
import { useGizmoStore } from '../stores/gizmo-store'
import { shouldPreferDomPlayerForGizmo } from '../utils/gizmo-preview-presentation'

interface UsePreviewRuntimeGuardsParams {
  forceFastScrubOverlay: boolean
  isGizmoInteractingRef: MutableRefObject<boolean>
  preferPlayerForDomGizmoRef: MutableRefObject<boolean>
  setAdaptiveQualityCap: Dispatch<SetStateAction<PreviewQuality>>
  adaptiveQualityStateRef: MutableRefObject<ReturnType<typeof createAdaptivePreviewQualityState>>
  adaptiveFrameSampleRef: MutableRefObject<{ frame: number; tsMs: number } | null>
}

function clearPreviewFramePreservingViewedFrame() {
  const playback = usePlaybackStore.getState()
  if (playback.previewFrame === null) return

  if (playback.currentFrame !== playback.previewFrame) {
    playback.setCurrentFrame(playback.previewFrame)
  }
  playback.setPreviewFrame(null)
}

export function usePreviewRuntimeGuards({
  forceFastScrubOverlay,
  isGizmoInteractingRef,
  preferPlayerForDomGizmoRef,
  setAdaptiveQualityCap,
  adaptiveQualityStateRef,
  adaptiveFrameSampleRef,
}: UsePreviewRuntimeGuardsParams) {
  useEffect(() => {
    clearPreviewFramePreservingViewedFrame()
  }, [])

  useEffect(() => {
    let wasInteracting = false
    const syncGizmoState = (state: ReturnType<typeof useGizmoStore.getState>) => {
      const activeGizmo = state.activeGizmo
      const isInteracting = activeGizmo !== null
      isGizmoInteractingRef.current = isInteracting
      preferPlayerForDomGizmoRef.current =
        isInteracting && shouldPreferDomPlayerForGizmo(forceFastScrubOverlay, activeGizmo?.itemType)

      if (isInteracting && !wasInteracting) {
        // Clear stale hover-scrub state without rerendering the large preview
        // tree just to mirror interaction ownership into refs.
        clearPreviewFramePreservingViewedFrame()
      }
      wasInteracting = isInteracting
    }

    syncGizmoState(useGizmoStore.getState())
    return useGizmoStore.subscribe(syncGizmoState)
  }, [forceFastScrubOverlay, isGizmoInteractingRef, preferPlayerForDomGizmoRef])

  useEffect(() => {
    if (!ADAPTIVE_PREVIEW_QUALITY_ENABLED) {
      adaptiveFrameSampleRef.current = null
      adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1)
      setAdaptiveQualityCap((quality) => (quality === 1 ? quality : 1))
      return
    }

    const applyPlaybackState = (isPlaying: boolean) => {
      adaptiveFrameSampleRef.current = null
      if (isPlaying) return

      adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1)
      setAdaptiveQualityCap((quality) => (quality === 1 ? quality : 1))
    }

    applyPlaybackState(usePlaybackStore.getState().isPlaying)
    return usePlaybackStore.subscribe((state, previousState) => {
      if (state.isPlaying !== previousState.isPlaying) {
        applyPlaybackState(state.isPlaying)
      }
    })
  }, [adaptiveFrameSampleRef, adaptiveQualityStateRef, setAdaptiveQualityCap])
}
