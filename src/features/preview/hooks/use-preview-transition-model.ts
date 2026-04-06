import { useCallback, useMemo } from 'react';
import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import { resolveTransitionWindows } from '@/domain/timeline/transitions/transition-planner';
import { shouldForceContinuousPreviewOverlay } from '../hooks/use-gpu-effects-overlay';

interface UsePreviewTransitionModelParams {
  fps: number;
  transitions: CompositionInputProps['transitions'];
  fastScrubScaledTracks: CompositionInputProps['tracks'];
  fastScrubPreviewItems: TimelineItem[];
}

export function usePreviewTransitionModel({
  fps,
  transitions,
  fastScrubScaledTracks,
  fastScrubPreviewItems,
}: UsePreviewTransitionModelParams) {
  const playbackTransitionFingerprint = useMemo(() => (
    (transitions ?? [])
      .map((transition) => (
        `${transition.id}:${transition.type}:${transition.leftClipId}:${transition.rightClipId}:${transition.trackId ?? ''}:${transition.durationInFrames}:${transition.presentation ?? ''}:${transition.timing ?? ''}`
      ))
      .join('|')
  ), [transitions]);

  const playbackTransitionWindows = useMemo(() => {
    const clipMap = new Map<string, TimelineItem>();
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        clipMap.set(item.id, item);
      }
    }
    return resolveTransitionWindows(transitions ?? [], clipMap);
  }, [fastScrubScaledTracks, transitions]);

  const playbackTransitionLookaheadFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.25)),
    [fps],
  );
  const playbackTransitionCooldownFrames = useMemo(
    () => Math.max(2, Math.round(fps * 0.1)),
    [fps],
  );
  const pausedTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 3)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playingComplexTransitionPrearmFrames = useMemo(
    () => Math.max(playbackTransitionLookaheadFrames, Math.round(fps * 1.5)),
    [fps, playbackTransitionLookaheadFrames],
  );
  const playbackTransitionPrerenderRunwayFrames = 8;

  const playbackTransitionEffectfulStartFrames = useMemo(() => {
    const hasExpensiveVisuals = (item: TimelineItem) => (
      item.effects?.some((effect) => effect.enabled)
      || (item.blendMode !== undefined && item.blendMode !== 'normal')
    );

    const effectfulStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      if (hasExpensiveVisuals(window.leftClip) || hasExpensiveVisuals(window.rightClip)) {
        effectfulStartFrames.add(window.startFrame);
      }
    }

    return effectfulStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionVariableSpeedStartFrames = useMemo(() => {
    const variableSpeedStartFrames = new Set<number>();
    for (const window of playbackTransitionWindows) {
      const leftSpeed = window.leftClip.speed ?? 1;
      const rightSpeed = window.rightClip.speed ?? 1;
      if (Math.abs(leftSpeed - 1) > 0.001 || Math.abs(rightSpeed - 1) > 0.001) {
        variableSpeedStartFrames.add(window.startFrame);
      }
    }
    return variableSpeedStartFrames;
  }, [playbackTransitionWindows]);

  const playbackTransitionComplexStartFrames = useMemo(() => {
    const complexStartFrames = new Set<number>();
    for (const frame of playbackTransitionEffectfulStartFrames) {
      complexStartFrames.add(frame);
    }
    for (const frame of playbackTransitionVariableSpeedStartFrames) {
      complexStartFrames.add(frame);
    }
    return complexStartFrames;
  }, [playbackTransitionEffectfulStartFrames, playbackTransitionVariableSpeedStartFrames]);

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
      return 0;
    }

    return playbackTransitionCooldownFrames;
  }, [playbackTransitionCooldownFrames]);

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

  const playbackTransitionOverlayWindows = useMemo(
    () => playbackTransitionWindows.map((window) => ({
      startFrame: window.startFrame,
      endFrame: window.endFrame,
      cooldownFrames: getTransitionCooldownForWindow(window),
    })),
    [getTransitionCooldownForWindow, playbackTransitionWindows],
  );

  const shouldPreserveHighFidelityBackwardPreview = useCallback((frame: number | null) => {
    if (frame === null) return false;
    if (getTransitionWindowForFrame(frame) !== null) {
      return true;
    }
    return shouldForceContinuousPreviewOverlay(fastScrubPreviewItems, (transitions ?? []).length, frame);
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
