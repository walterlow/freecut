import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { PreviewQuality } from '@/shared/state/playback';
import { usePlaybackStore } from '@/shared/state/playback';
import type { PreviewVisualPlaybackMode } from '@/shared/state/preview-bridge';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import { getSharedPreviewAudioContext } from '@/features/preview/deps/composition-runtime';
import {
  type AdaptivePreviewQualityState,
  getFrameBudgetMs,
  updateAdaptivePreviewQuality,
} from '../utils/adaptive-preview-quality';
import { shouldPreferPlayerForStyledTextScrub as shouldPreferPlayerForStyledTextScrubGuard } from '../utils/text-render-guard';
import { getPreviewRuntimeSnapshotFromPlaybackState } from '../utils/preview-state-coordinator';
import { usePreviewRuntimeGuards } from './use-preview-runtime-guards';
import type { PreviewPerfStats } from './use-preview-diagnostics';

interface UsePreviewPlaybackControllerParams {
  fps: number;
  combinedTracks: TimelineTrack[];
  keyframes: ItemKeyframes[];
  activeGizmoItemType: TimelineItem['type'] | null;
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  totalFrames: number;
  visualPlaybackMode: PreviewVisualPlaybackMode;
  forceFastScrubOverlay: boolean;
  previewPerfRef: MutableRefObject<PreviewPerfStats>;
  isGizmoInteractingRef: MutableRefObject<boolean>;
  preferPlayerForTextGizmoRef: MutableRefObject<boolean>;
  preferPlayerForStyledTextScrubRef: MutableRefObject<boolean>;
  adaptiveQualityStateRef: MutableRefObject<AdaptivePreviewQualityState>;
  adaptiveFrameSampleRef: MutableRefObject<{ frame: number; tsMs: number } | null>;
  ignorePlayerUpdatesRef: MutableRefObject<boolean>;
  playerSeekTargetRef: MutableRefObject<number | null>;
  resolvePendingSeekLatency: (frame: number) => void;
  visualPlaybackModeRef: MutableRefObject<PreviewVisualPlaybackMode>;
}

export function usePreviewPlaybackController({
  fps,
  combinedTracks,
  keyframes,
  activeGizmoItemType,
  isGizmoInteracting,
  isPlaying,
  totalFrames,
  visualPlaybackMode,
  forceFastScrubOverlay,
  previewPerfRef,
  isGizmoInteractingRef,
  preferPlayerForTextGizmoRef,
  preferPlayerForStyledTextScrubRef,
  adaptiveQualityStateRef,
  adaptiveFrameSampleRef,
  ignorePlayerUpdatesRef,
  playerSeekTargetRef,
  resolvePendingSeekLatency,
  visualPlaybackModeRef,
}: UsePreviewPlaybackControllerParams) {
  const [adaptiveQualityCap, setAdaptiveQualityCap] = useState<PreviewQuality>(1);
  const streamingClockRafRef = useRef<number | null>(null);
  const streamingClockActiveRef = useRef(false);
  const streamingClockAnchorFrameRef = useRef(0);
  const streamingClockAnchorTimeRef = useRef(0);
  const streamingClockWriteDepthRef = useRef(0);

  usePreviewRuntimeGuards({
    isGizmoInteracting,
    isGizmoInteractingRef,
    isPlaying,
    adaptiveQualityCap,
    setAdaptiveQualityCap,
    adaptiveQualityStateRef,
    adaptiveFrameSampleRef,
  });

  const preferPlayerForStyledTextScrub = (
    !forceFastScrubOverlay
    && shouldPreferPlayerForStyledTextScrubGuard(combinedTracks, keyframes)
  );
  const preferPlayerForTextGizmo = (
    !forceFastScrubOverlay
    && isGizmoInteracting
    && activeGizmoItemType === 'text'
  );
  preferPlayerForTextGizmoRef.current = preferPlayerForTextGizmo;
  preferPlayerForStyledTextScrubRef.current = preferPlayerForStyledTextScrub;

  const shouldPreferPlayerForPreview = useCallback((previewFrame: number | null) => {
    return (
      preferPlayerForTextGizmoRef.current
      || (preferPlayerForStyledTextScrubRef.current && previewFrame !== null)
    );
  }, [preferPlayerForStyledTextScrubRef, preferPlayerForTextGizmoRef]);

  const stopStreamingClock = useCallback(() => {
    streamingClockActiveRef.current = false;
    if (streamingClockRafRef.current !== null) {
      cancelAnimationFrame(streamingClockRafRef.current);
      streamingClockRafRef.current = null;
    }
  }, []);

  const startStreamingClock = useCallback(() => {
    const ctx = getSharedPreviewAudioContext();
    if (!ctx || ctx.state !== 'running') {
      stopStreamingClock();
      return false;
    }

    streamingClockActiveRef.current = true;
    streamingClockAnchorFrameRef.current = usePlaybackStore.getState().currentFrame;
    streamingClockAnchorTimeRef.current = ctx.currentTime;

    if (streamingClockRafRef.current !== null) {
      cancelAnimationFrame(streamingClockRafRef.current);
      streamingClockRafRef.current = null;
    }

    const tick = () => {
      const playbackState = usePlaybackStore.getState();
      if (!playbackState.isPlaying || visualPlaybackModeRef.current !== 'streaming') {
        stopStreamingClock();
        return;
      }

      const activeCtx = getSharedPreviewAudioContext();
      if (!activeCtx || activeCtx.state !== 'running') {
        streamingClockRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const elapsedSeconds = Math.max(0, activeCtx.currentTime - streamingClockAnchorTimeRef.current);
      const rawFrame = streamingClockAnchorFrameRef.current + elapsedSeconds * fps * playbackState.playbackRate;
      let nextFrame = Math.max(streamingClockAnchorFrameRef.current, Math.floor(rawFrame + 1e-4));
      if (totalFrames > 0) {
        nextFrame = Math.min(totalFrames - 1, nextFrame);
      }

      if (playbackState.currentFrame !== nextFrame) {
        streamingClockWriteDepthRef.current += 1;
        playbackState.setCurrentFrame(nextFrame);
        streamingClockWriteDepthRef.current -= 1;
      }

      if (totalFrames > 0 && nextFrame >= totalFrames - 1 && !playbackState.loop) {
        playbackState.pause();
        stopStreamingClock();
        return;
      }

      streamingClockRafRef.current = requestAnimationFrame(tick);
    };

    streamingClockRafRef.current = requestAnimationFrame(tick);
    return true;
  }, [fps, stopStreamingClock, totalFrames, visualPlaybackModeRef]);

  useEffect(() => {
    if (isPlaying && visualPlaybackMode === 'streaming') {
      startStreamingClock();
      return stopStreamingClock;
    }

    stopStreamingClock();
    return stopStreamingClock;
  }, [isPlaying, startStreamingClock, stopStreamingClock, visualPlaybackMode]);

  useEffect(() => {
    return usePlaybackStore.subscribe((state, prevState) => {
      if (visualPlaybackModeRef.current !== 'streaming') {
        stopStreamingClock();
        return;
      }
      if (state.isPlaying && !prevState.isPlaying) {
        startStreamingClock();
        return;
      }
      if (!state.isPlaying) {
        stopStreamingClock();
        return;
      }
      if (state.playbackRate !== prevState.playbackRate) {
        startStreamingClock();
        return;
      }
      if (
        state.currentFrame !== prevState.currentFrame
        && streamingClockWriteDepthRef.current === 0
      ) {
        startStreamingClock();
      }
    });
  }, [startStreamingClock, stopStreamingClock, visualPlaybackModeRef]);

  const handleFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.round(frame);
    resolvePendingSeekLatency(nextFrame);
    if (ignorePlayerUpdatesRef.current) return;
    const playbackState = usePlaybackStore.getState();
    const visualPlaybackMode = visualPlaybackModeRef.current;
    if (playbackState.isPlaying && visualPlaybackMode === 'streaming' && streamingClockActiveRef.current) {
      return;
    }
    if (!playbackState.isPlaying && visualPlaybackMode !== 'player') {
      return;
    }
    if (!playbackState.isPlaying && playbackState.previewFrame === null) {
      const expectedPlayerFrame = playerSeekTargetRef.current;
      if (
        expectedPlayerFrame !== null
        && playbackState.currentFrame === expectedPlayerFrame
        && nextFrame !== expectedPlayerFrame
      ) {
        // The hidden Player can finish an older seek after the rendered preview
        // has already claimed the paused frame. Ignore that stale callback so
        // the store doesn't jump backward and flash an outdated frame.
        return;
      }
    }
    const runtimeSnapshot = getPreviewRuntimeSnapshotFromPlaybackState(
      playbackState,
      isGizmoInteractingRef.current,
    );
    const interactionMode = runtimeSnapshot.mode;
    if (interactionMode === 'scrubbing') return;

    if (interactionMode === 'playing') {
      const nowMs = performance.now();
      const previousSample = adaptiveFrameSampleRef.current;
      if (previousSample && nextFrame !== previousSample.frame) {
        const frameDelta = Math.max(1, Math.abs(nextFrame - previousSample.frame));
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
      adaptiveFrameSampleRef.current = { frame: nextFrame, tsMs: nowMs };
    } else {
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

    const { currentFrame, setCurrentFrame } = playbackState;
    if (currentFrame === nextFrame) return;
    setCurrentFrame(nextFrame);
  }, [
    adaptiveFrameSampleRef,
    adaptiveQualityStateRef,
    fps,
    ignorePlayerUpdatesRef,
    isGizmoInteractingRef,
    playerSeekTargetRef,
    previewPerfRef,
    resolvePendingSeekLatency,
    stopStreamingClock,
    visualPlaybackModeRef,
  ]);

  const handlePlayStateChange = useCallback((playing: boolean) => {
    if (playing) {
      usePlaybackStore.getState().play();
    } else {
      usePlaybackStore.getState().pause();
    }
  }, []);

  return {
    adaptiveQualityCap,
    shouldPreferPlayerForPreview,
    handleFrameChange,
    handlePlayStateChange,
  };
}
