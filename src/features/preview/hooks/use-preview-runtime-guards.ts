import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  ADAPTIVE_PREVIEW_QUALITY_ENABLED,
} from '../utils/preview-constants';
import { createAdaptivePreviewQualityState } from '../utils/adaptive-preview-quality';

interface UsePreviewRuntimeGuardsParams {
  isGizmoInteracting: boolean;
  isGizmoInteractingRef: MutableRefObject<boolean>;
  isPlaying: boolean;
  adaptiveQualityCap: PreviewQuality;
  setAdaptiveQualityCap: Dispatch<SetStateAction<PreviewQuality>>;
  adaptiveQualityStateRef: MutableRefObject<ReturnType<typeof createAdaptivePreviewQualityState>>;
  adaptiveFrameSampleRef: MutableRefObject<{ frame: number; tsMs: number } | null>;
}

function clearPreviewFramePreservingViewedFrame() {
  const playback = usePlaybackStore.getState();
  if (playback.previewFrame === null) return;

  if (playback.currentFrame !== playback.previewFrame) {
    playback.setCurrentFrame(playback.previewFrame);
  }
  playback.setPreviewFrame(null);
}

export function usePreviewRuntimeGuards({
  isGizmoInteracting,
  isGizmoInteractingRef,
  isPlaying,
  adaptiveQualityCap,
  setAdaptiveQualityCap,
  adaptiveQualityStateRef,
  adaptiveFrameSampleRef,
}: UsePreviewRuntimeGuardsParams) {
  isGizmoInteractingRef.current = isGizmoInteracting;

  useEffect(() => {
    clearPreviewFramePreservingViewedFrame();
  }, []);

  useEffect(() => {
    if (!isGizmoInteracting) return;

    // During active transform drags, clear stale hover-scrub state without
    // changing the viewed frame. This avoids a one-frame render source/frame jump.
    clearPreviewFramePreservingViewedFrame();
  }, [isGizmoInteracting]);

  useEffect(() => {
    if (!ADAPTIVE_PREVIEW_QUALITY_ENABLED) {
      adaptiveFrameSampleRef.current = null;
      adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
      if (adaptiveQualityCap !== 1) {
        setAdaptiveQualityCap(1);
      }
      return;
    }

    if (isPlaying) {
      adaptiveFrameSampleRef.current = null;
      return;
    }

    adaptiveFrameSampleRef.current = null;
    adaptiveQualityStateRef.current = createAdaptivePreviewQualityState(1);
    if (adaptiveQualityCap !== 1) {
      setAdaptiveQualityCap(1);
    }
  }, [
    adaptiveFrameSampleRef,
    adaptiveQualityCap,
    adaptiveQualityStateRef,
    isPlaying,
    setAdaptiveQualityCap,
  ]);
}
