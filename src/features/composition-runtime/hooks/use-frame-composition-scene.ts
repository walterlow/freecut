import { useContext, useMemo } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from './use-player-compat';
import { KeyframesContext } from '../contexts/keyframes-context-core';
import { resolveFrameCompositionScene, type FrameCompositionScene } from '../utils/frame-scene';
import type { CompositionRenderPlan } from '../utils/scene-assembly';

export function useFrameCompositionScene(
  renderPlan: CompositionRenderPlan,
  {
    canvasWidth,
    canvasHeight,
  }: {
    canvasWidth: number;
    canvasHeight: number;
  },
): FrameCompositionScene {
  const sequenceCtx = useSequenceContext();
  const globalFrame = (sequenceCtx?.from ?? 0) + (sequenceCtx?.localFrame ?? 0);
  const { fps } = useVideoConfig();
  const keyframesCtx = useContext(KeyframesContext);

  return useMemo(
    () => resolveFrameCompositionScene({
      renderPlan,
      frame: globalFrame,
      canvas: { width: canvasWidth, height: canvasHeight, fps },
      getKeyframes: (itemId) => keyframesCtx?.getItemKeyframes(itemId),
    }),
    [renderPlan, globalFrame, canvasWidth, canvasHeight, fps, keyframesCtx],
  );
}
