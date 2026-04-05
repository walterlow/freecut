import { useCallback, type MutableRefObject } from 'react';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import {
  getFrameBudgetMs,
  type AdaptivePreviewQualityState,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import { ADAPTIVE_PREVIEW_QUALITY_ENABLED } from '../utils/preview-constants';
import { resolvePreviewTransportFrameChangeDecision } from '../utils/preview-transport-controller';

type AdaptiveFrameSample = { frame: number; tsMs: number };

interface PreviewAdaptiveQualityPerfCounters {
  adaptiveQualityDowngrades: number;
  adaptiveQualityRecovers: number;
}

export interface UsePreviewTransportFrameControllerInput {
  fps: number;
  ignoreTransportUpdatesRef: MutableRefObject<boolean>;
  isGizmoInteractingRef: MutableRefObject<boolean>;
  adaptiveQualityStateRef: MutableRefObject<AdaptivePreviewQualityState>;
  adaptiveFrameSampleRef: MutableRefObject<AdaptiveFrameSample | null>;
  previewPerfRef: MutableRefObject<PreviewAdaptiveQualityPerfCounters>;
  setAdaptiveQualityCap: (quality: PreviewQuality) => void;
  resolvePendingSeekLatency: (frame: number) => void;
}

function resetAdaptivePreviewSampling(
  adaptiveQualityStateRef: MutableRefObject<AdaptivePreviewQualityState>,
  adaptiveFrameSampleRef: MutableRefObject<AdaptiveFrameSample | null>,
): void {
  adaptiveFrameSampleRef.current = null;
  if (
    adaptiveQualityStateRef.current.overBudgetSamples !== 0
    || adaptiveQualityStateRef.current.underBudgetSamples !== 0
  ) {
    adaptiveQualityStateRef.current = {
      ...adaptiveQualityStateRef.current,
      overBudgetSamples: 0,
      underBudgetSamples: 0,
    };
  }
}

export function usePreviewTransportFrameController(
  input: UsePreviewTransportFrameControllerInput,
): (frame: number) => void {
  const {
    fps,
    ignoreTransportUpdatesRef,
    isGizmoInteractingRef,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
    previewPerfRef,
    setAdaptiveQualityCap,
    resolvePendingSeekLatency,
  } = input;

  return useCallback((frame: number) => {
    const playbackState = usePlaybackStore.getState();
    const decision = resolvePreviewTransportFrameChangeDecision({
      frame,
      currentFrame: playbackState.currentFrame,
      previewFrame: playbackState.previewFrame,
      isPlaying: playbackState.isPlaying,
      isGizmoInteracting: isGizmoInteractingRef.current,
      shouldIgnoreTransportUpdates: ignoreTransportUpdatesRef.current,
    });

    resolvePendingSeekLatency(decision.nextFrame);

    if (
      decision.kind === 'ignore'
      && (decision.reason === 'transport_sync' || decision.reason === 'scrubbing')
    ) {
      return;
    }

    if (ADAPTIVE_PREVIEW_QUALITY_ENABLED && decision.interactionMode === 'playing') {
      const nowMs = performance.now();
      const previousSample = adaptiveFrameSampleRef.current;
      if (previousSample && decision.nextFrame !== previousSample.frame) {
        const frameDelta = Math.max(1, Math.abs(decision.nextFrame - previousSample.frame));
        const elapsedMs = nowMs - previousSample.tsMs;
        if (elapsedMs > 0) {
          const result = updateAdaptivePreviewQuality({
            state: adaptiveQualityStateRef.current,
            sampleMsPerFrame: elapsedMs / frameDelta,
            frameBudgetMs: getFrameBudgetMs(fps, playbackState.playbackRate),
            userQuality: playbackState.previewQuality,
            nowMs,
            allowRecovery: false,
          });
          adaptiveQualityStateRef.current = result.state;
          if (result.qualityChanged) {
            if (result.qualityChangeDirection === 'degrade') {
              previewPerfRef.current.adaptiveQualityDowngrades += 1;
            } else if (result.qualityChangeDirection === 'recover') {
              previewPerfRef.current.adaptiveQualityRecovers += 1;
            }
            setAdaptiveQualityCap(result.state.qualityCap);
          }
        }
      }
      adaptiveFrameSampleRef.current = { frame: decision.nextFrame, tsMs: nowMs };
    } else {
      resetAdaptivePreviewSampling(adaptiveQualityStateRef, adaptiveFrameSampleRef);
    }

    if (decision.kind === 'sync') {
      playbackState.setCurrentFrame(decision.nextFrame);
    }
  }, [
    adaptiveFrameSampleRef,
    adaptiveQualityStateRef,
    fps,
    ignoreTransportUpdatesRef,
    isGizmoInteractingRef,
    previewPerfRef,
    resolvePendingSeekLatency,
    setAdaptiveQualityCap,
  ]);
}
