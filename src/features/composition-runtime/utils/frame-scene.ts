import type { ItemKeyframes } from '@/types/keyframe';
import type { ShapeItem, TimelineItem } from '@/types/timeline';
import type { CanvasSettings, ResolvedTransform } from '@/types/transform';
import type { CompositionRenderPlan } from './scene-assembly';
import {
  resolveTransform,
  getSourceDimensions,
} from './transform-resolver';
import { expandTextTransformToFitContent } from './text-layout';
import {
  resolveAnimatedTransform,
  hasKeyframeAnimation,
} from '../deps/keyframes';
import {
  resolveTransitionFrameState,
  type TransitionFrameState,
} from './transition-scene';

export type TransformOverride = Partial<ResolvedTransform> | undefined;

export interface ResolvedShapeMask {
  shape: ShapeItem;
  transform: ResolvedTransform;
}

export interface FrameCompositionScene<TItem extends TimelineItem = TimelineItem> {
  frame: number;
  activeShapeMasks: ResolvedShapeMask[];
  transitionFrameState: TransitionFrameState<TItem>;
}

export function applyTransformOverride(
  baseTransform: ResolvedTransform,
  override?: TransformOverride,
): ResolvedTransform {
  if (!override) return baseTransform;

  return {
    ...baseTransform,
    ...override,
    opacity: override.opacity ?? baseTransform.opacity,
    cornerRadius: override.cornerRadius ?? baseTransform.cornerRadius,
  };
}

export function resolveItemTransformAtRelativeFrame(
  item: TimelineItem,
  {
    canvas,
    relativeFrame,
    keyframes,
    previewTransform,
  }: {
    canvas: CanvasSettings;
    relativeFrame: number;
    keyframes?: ItemKeyframes;
    previewTransform?: TransformOverride;
  }
): ResolvedTransform {
  const baseResolved = resolveTransform(item, canvas, getSourceDimensions(item));
  const animatedResolved = keyframes && hasKeyframeAnimation(keyframes)
    ? resolveAnimatedTransform(baseResolved, keyframes, relativeFrame)
    : baseResolved;

  const resolved = applyTransformOverride(animatedResolved, previewTransform);

  return item.type === 'text'
    ? expandTextTransformToFitContent(item, resolved)
    : resolved;
}

export function resolveItemTransformAtFrame(
  item: TimelineItem,
  {
    canvas,
    frame,
    keyframes,
    previewTransform,
  }: {
    canvas: CanvasSettings;
    frame: number;
    keyframes?: ItemKeyframes;
    previewTransform?: TransformOverride;
  }
): ResolvedTransform {
  return resolveItemTransformAtRelativeFrame(item, {
    canvas,
    relativeFrame: frame - item.from,
    keyframes,
    previewTransform,
  });
}

export function resolveActiveShapeMasksAtFrame(
  masks: ShapeItem[],
  {
    canvas,
    frame,
    getKeyframes,
    getPreviewTransform,
  }: {
    canvas: CanvasSettings;
    frame: number;
    getKeyframes?: (itemId: string) => ItemKeyframes | undefined;
    getPreviewTransform?: (itemId: string) => TransformOverride;
  }
): ResolvedShapeMask[] {
  if (masks.length === 0) return [];

  return masks
    .filter((mask) => {
      const start = mask.from;
      const end = mask.from + mask.durationInFrames;
      return frame >= start && frame < end;
    })
    .map((mask) => ({
      shape: mask,
      transform: resolveItemTransformAtFrame(mask, {
        canvas,
        frame,
        keyframes: getKeyframes?.(mask.id),
        previewTransform: getPreviewTransform?.(mask.id),
      }),
    }));
}

export function resolveFrameCompositionScene({
  renderPlan,
  frame,
  canvas,
  getKeyframes,
  getPreviewTransform,
}: {
  renderPlan: CompositionRenderPlan;
  frame: number;
  canvas: CanvasSettings;
  getKeyframes?: (itemId: string) => ItemKeyframes | undefined;
  getPreviewTransform?: (itemId: string) => TransformOverride;
}): FrameCompositionScene {
  return {
    frame,
    activeShapeMasks: resolveActiveShapeMasksAtFrame(
      renderPlan.visibleShapeMasks.map(({ mask }) => mask),
      {
        canvas,
        frame,
        getKeyframes,
        getPreviewTransform,
      },
    ),
    transitionFrameState: resolveTransitionFrameState({
      transitionWindows: renderPlan.transitionWindows,
      frame,
    }),
  };
}
