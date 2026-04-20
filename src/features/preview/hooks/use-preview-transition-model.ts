import { useCallback, useMemo } from 'react';
import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/core/timeline/transitions/transition-planner';
import { resolveTransitionWindows } from '@/core/timeline/transitions/transition-planner';
import { shouldForceContinuousPreviewOverlay } from '../hooks/use-gpu-effects-overlay';
import { useCompositionsStore } from '@/features/preview/deps/timeline-store';

interface UsePreviewTransitionModelParams {
  fps: number;
  transitions: CompositionInputProps['transitions'];
  fastScrubScaledTracks: CompositionInputProps['tracks'];
  fastScrubPreviewItems: TimelineItem[];
}

interface BuildPreviewTransitionDataParams {
  fps: number;
  transitions: CompositionInputProps['transitions'];
  fastScrubScaledTracks: CompositionInputProps['tracks'];
}

export function usePreviewTransitionModel({
  fps,
  transitions,
  fastScrubScaledTracks,
  fastScrubPreviewItems,
}: UsePreviewTransitionModelParams) {
  const {
    playbackTransitionFingerprint,
    playbackTransitionWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionComplexStartFrames,
    playbackTransitionOverlayWindows,
  } = useMemo(() => {
    return buildPreviewTransitionData({
      fps,
      transitions,
      fastScrubScaledTracks,
    });
  }, [fastScrubScaledTracks, fps, transitions]);

  const transitionWindowUsesDomProvider = useCallback((window: ResolvedTransitionWindow<TimelineItem> | null) => {
    if (!window) return true;
    return !playbackTransitionComplexStartFrames.has(window.startFrame);
  }, [playbackTransitionComplexStartFrames]);

  const getTransitionWindowByStartFrame = useCallback((startFrame: number | null) => {
    if (startFrame === null) return null;
    return playbackTransitionWindows.find((window) => window.startFrame === startFrame) ?? null;
  }, [playbackTransitionWindows]);

  const getTransitionCooldownForWindow = useCallback((window: ResolvedTransitionWindow<TimelineItem>) => {
    const leftOriginId = window.leftClip.originId;
    const rightOriginId = window.rightClip.originId;

    if (leftOriginId && rightOriginId && leftOriginId === rightOriginId) {
      return Math.max(12, Math.round(fps * 0.5));
    }

    return playbackTransitionCooldownFrames;
  }, [fps, playbackTransitionCooldownFrames]);

  const getTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame + getTransitionCooldownForWindow(window)
    )) ?? null;
  }, [getTransitionCooldownForWindow, playbackTransitionWindows]);

  const getActiveTransitionWindowForFrame = useCallback((frame: number) => {
    return playbackTransitionWindows.find((window) => (
      frame >= window.startFrame && frame < window.endFrame
    )) ?? null;
  }, [playbackTransitionWindows]);

  const shouldPreserveHighFidelityBackwardPreview = useCallback((frame: number | null) => {
    if (frame === null) return false;
    if (getTransitionWindowForFrame(frame) !== null) {
      return true;
    }
    const compositionById = useCompositionsStore.getState().compositionById;
    return shouldForceContinuousPreviewOverlay(
      fastScrubPreviewItems,
      (transitions ?? []).length,
      frame,
      undefined,
      compositionById,
    );
  }, [fastScrubPreviewItems, getTransitionWindowForFrame, transitions]);

  return {
    playbackTransitionFingerprint,
    playbackTransitionWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionComplexStartFrames,
    transitionWindowUsesDomProvider,
    getTransitionWindowByStartFrame,
    getTransitionCooldownForWindow,
    getTransitionWindowForFrame,
    getActiveTransitionWindowForFrame,
    playbackTransitionOverlayWindows,
    shouldPreserveHighFidelityBackwardPreview,
  };
}

export function buildPreviewTransitionData({
  fps,
  transitions,
  fastScrubScaledTracks,
}: BuildPreviewTransitionDataParams) {
  const safeTransitions = transitions ?? [];
  const playbackTransitionFingerprint = safeTransitions
    .map((transition) => (
      `${transition.id}:${transition.type}:${transition.leftClipId}:${transition.rightClipId}:${transition.trackId ?? ''}:${transition.durationInFrames}:${transition.presentation ?? ''}:${transition.timing ?? ''}`
    ))
    .join('|');

  const clipMap = new Map<string, TimelineItem>();
  for (const track of fastScrubScaledTracks) {
    for (const item of track.items as TimelineItem[]) {
      clipMap.set(item.id, item);
    }
  }
  const playbackTransitionWindows = resolveTransitionWindows(safeTransitions, clipMap);
  const playbackTransitionLookaheadFrames = Math.max(2, Math.round(fps * 0.25));
  const playbackTransitionCooldownFrames = Math.max(2, Math.round(fps * 0.1));
  const pausedTransitionPrearmFrames = Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 3));
  const playingComplexTransitionPrearmFrames = Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 1.5));
  const playbackTransitionPrerenderRunwayFrames = 8;

  const hasExpensiveVisuals = (item: TimelineItem) => (
    item.effects?.some((effect) => effect.enabled)
    || (item.blendMode !== undefined && item.blendMode !== 'normal')
  );

  const playbackTransitionComplexStartFrames = new Set<number>();
  const playbackTransitionOverlayWindows = playbackTransitionWindows.map((window) => {
    const leftSpeed = window.leftClip.speed ?? 1;
    const rightSpeed = window.rightClip.speed ?? 1;
    if (
      hasExpensiveVisuals(window.leftClip)
      || hasExpensiveVisuals(window.rightClip)
      || Math.abs(leftSpeed - 1) > 0.001
      || Math.abs(rightSpeed - 1) > 0.001
    ) {
      playbackTransitionComplexStartFrames.add(window.startFrame);
    }

    const leftOriginId = window.leftClip.originId;
    const rightOriginId = window.rightClip.originId;
    const isSameOrigin = leftOriginId && rightOriginId && leftOriginId === rightOriginId;
    const cooldownFrames = isSameOrigin
      ? Math.max(12, Math.round(fps * 0.5))
      : playbackTransitionCooldownFrames;

    return {
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      cooldownFrames,
    };
  });

  return {
    playbackTransitionFingerprint,
    playbackTransitionWindows,
    playbackTransitionLookaheadFrames,
    playbackTransitionCooldownFrames,
    pausedTransitionPrearmFrames,
    playingComplexTransitionPrearmFrames,
    playbackTransitionPrerenderRunwayFrames,
    playbackTransitionComplexStartFrames,
    playbackTransitionOverlayWindows,
  };
}
