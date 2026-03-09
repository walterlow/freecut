import { useContext, useMemo, type ContextType } from 'react';
import { useSequenceContext } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from './use-player-compat';
import { KeyframesContext } from '../contexts/keyframes-context-core';
import { resolveFrameCompositionScene, type FrameCompositionScene } from '../utils/frame-scene';
import type { CompositionRenderPlan } from '../utils/scene-assembly';

interface FrameSceneCacheEntry {
  key: string;
  value: FrameCompositionScene;
}

const frameSceneCache = new WeakMap<CompositionRenderPlan, WeakMap<object, FrameSceneCacheEntry>>();
const NO_KEYFRAMES_CONTEXT = {};

function getFrameSceneCacheKey({
  frame,
  canvasWidth,
  canvasHeight,
  fps,
}: {
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}): string {
  return `${frame}:${canvasWidth}:${canvasHeight}:${fps}`;
}

function getCachedFrameCompositionScene({
  renderPlan,
  frame,
  canvasWidth,
  canvasHeight,
  fps,
  keyframesCtx,
}: {
  renderPlan: CompositionRenderPlan;
  frame: number;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
  keyframesCtx: ContextType<typeof KeyframesContext>;
}): FrameCompositionScene {
  const contextKey = keyframesCtx ?? NO_KEYFRAMES_CONTEXT;
  const cacheKey = getFrameSceneCacheKey({ frame, canvasWidth, canvasHeight, fps });
  let renderPlanCache = frameSceneCache.get(renderPlan);

  if (!renderPlanCache) {
    renderPlanCache = new WeakMap<object, FrameSceneCacheEntry>();
    frameSceneCache.set(renderPlan, renderPlanCache);
  }

  const cachedScene = renderPlanCache.get(contextKey);
  if (cachedScene?.key === cacheKey) {
    return cachedScene.value;
  }

  const frameScene = resolveFrameCompositionScene({
    renderPlan,
    frame,
    canvas: { width: canvasWidth, height: canvasHeight, fps },
    getKeyframes: (itemId) => keyframesCtx?.getItemKeyframes(itemId),
  });

  renderPlanCache.set(contextKey, {
    key: cacheKey,
    value: frameScene,
  });

  return frameScene;
}

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
    () => getCachedFrameCompositionScene({
      renderPlan,
      frame: globalFrame,
      canvasWidth,
      canvasHeight,
      fps,
      keyframesCtx,
    }),
    [renderPlan, globalFrame, canvasWidth, canvasHeight, fps, keyframesCtx],
  );
}
