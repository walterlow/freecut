import type { ItemKeyframes } from '@/types/keyframe';
import type { ShapeItem, TimelineItem } from '@/types/timeline';
import type { CanvasSettings, ResolvedTransform } from '@/types/transform';
import type { CompositionRenderPlan } from './scene-assembly';
import type { ShapeMaskWithTrackOrder } from './scene-assembly';
import {
  resolveTransform,
  getSourceDimensions,
} from './transform-resolver';
import {
  applyPreviewPathVerticesToShape,
  type PreviewPathVerticesOverride,
} from './preview-path-override';
import { expandTextTransformToFitContent } from './text-layout';
import {
  resolveAnimatedTransform,
  hasKeyframeAnimation,
} from '../deps/keyframes';
import {
  resolveTransitionFrameState,
  type TransitionFrameState,
} from './transition-scene';
import {
  hasFrameInvalidation,
  isFrameInRanges,
  type FrameInvalidationRequest,
} from '@/shared/utils/frame-invalidation';

export type TransformOverride = Partial<ResolvedTransform> | undefined;

export interface ResolvedShapeMask {
  shape: ShapeItem;
  transform: ResolvedTransform;
  trackOrder: number;
}

export interface FrameCompositionScene<TItem extends TimelineItem = TimelineItem> {
  frame: number;
  activeShapeMasks: ResolvedShapeMask[];
  transitionFrameState: TransitionFrameState<TItem>;
}

export interface FrameCompositionSceneCache {
  resolve(
    params: Parameters<typeof resolveFrameCompositionScene>[0],
    revision?: unknown,
  ): FrameCompositionScene;
  invalidate(request?: FrameInvalidationRequest): void;
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
  masks: Array<ShapeItem | ShapeMaskWithTrackOrder>,
  {
    canvas,
    frame,
    getKeyframes,
    getPreviewTransform,
    getPreviewPathVertices,
  }: {
    canvas: CanvasSettings;
    frame: number;
    getKeyframes?: (itemId: string) => ItemKeyframes | undefined;
    getPreviewTransform?: (itemId: string) => TransformOverride;
    getPreviewPathVertices?: PreviewPathVerticesOverride;
  }
): ResolvedShapeMask[] {
  if (masks.length === 0) return [];

  return masks
    .map((maskSource) => (
      'mask' in maskSource
        ? maskSource
        : { mask: maskSource, trackOrder: 0 }
    ))
    .filter(({ mask }) => {
      const start = mask.from;
      const end = mask.from + mask.durationInFrames;
      return frame >= start && frame < end;
    })
    .map(({ mask, trackOrder }) => {
      const shape = applyPreviewPathVerticesToShape(mask, getPreviewPathVertices);

      return {
        shape,
        trackOrder,
        transform: resolveItemTransformAtFrame(shape, {
        canvas,
        frame,
          keyframes: getKeyframes?.(mask.id),
          previewTransform: getPreviewTransform?.(mask.id),
        }),
      };
    });
}

export function resolveFrameCompositionScene({
  renderPlan,
  frame,
  canvas,
  getKeyframes,
  getPreviewTransform,
  getPreviewPathVertices,
}: {
  renderPlan: CompositionRenderPlan;
  frame: number;
  canvas: CanvasSettings;
  getKeyframes?: (itemId: string) => ItemKeyframes | undefined;
  getPreviewTransform?: (itemId: string) => TransformOverride;
  getPreviewPathVertices?: PreviewPathVerticesOverride;
}): FrameCompositionScene {
  return {
    frame,
    activeShapeMasks: resolveActiveShapeMasksAtFrame(renderPlan.visibleShapeMasks, {
      canvas,
      frame,
      getKeyframes,
      getPreviewTransform,
      getPreviewPathVertices,
    }),
    transitionFrameState: resolveTransitionFrameState({
      transitionWindows: renderPlan.transitionWindows,
      frame,
    }),
  };
}

/**
 * Create a renderer-scoped scene cache.
 * Cache hits require the same frame, revision token, render plan, canvas,
 * and preview callback identities.
 */
export function createFrameCompositionSceneCache(): FrameCompositionSceneCache {
  let cachedScene: FrameCompositionScene | null = null;
  let cachedFrame = -1;
  let cachedRevision: unknown = undefined;
  let cachedRenderPlan: CompositionRenderPlan | null = null;
  let cachedCanvasWidth = -1;
  let cachedCanvasHeight = -1;
  let cachedCanvasFps = -1;
  let cachedGetKeyframes: ((itemId: string) => ItemKeyframes | undefined) | undefined;
  let cachedGetPreviewTransform: ((itemId: string) => TransformOverride) | undefined;
  let cachedGetPreviewPathVertices: PreviewPathVerticesOverride | undefined;

  return {
    resolve(params, revision) {
      const canvasMatches = (
        cachedCanvasWidth === params.canvas.width
        && cachedCanvasHeight === params.canvas.height
        && cachedCanvasFps === params.canvas.fps
      );
      const callbacksMatch = (
        cachedGetKeyframes === params.getKeyframes
        && cachedGetPreviewTransform === params.getPreviewTransform
        && cachedGetPreviewPathVertices === params.getPreviewPathVertices
      );

      if (
        cachedScene
        && cachedFrame === params.frame
        && cachedRevision === revision
        && cachedRenderPlan === params.renderPlan
        && canvasMatches
        && callbacksMatch
      ) {
        return cachedScene;
      }

      cachedScene = resolveFrameCompositionScene(params);
      cachedFrame = params.frame;
      cachedRevision = revision;
      cachedRenderPlan = params.renderPlan;
      cachedCanvasWidth = params.canvas.width;
      cachedCanvasHeight = params.canvas.height;
      cachedCanvasFps = params.canvas.fps;
      cachedGetKeyframes = params.getKeyframes;
      cachedGetPreviewTransform = params.getPreviewTransform;
      cachedGetPreviewPathVertices = params.getPreviewPathVertices;
      return cachedScene;
    },
    invalidate(request) {
      if (
        cachedScene
        && request
        && hasFrameInvalidation(request)
      ) {
        const isMatchingFrame = request.frames?.includes(cachedFrame) ?? false;
        const isMatchingRange = request.ranges ? isFrameInRanges(cachedFrame, request.ranges) : false;
        if (!isMatchingFrame && !isMatchingRange) {
          return;
        }
      }

      cachedScene = null;
      cachedFrame = -1;
      cachedRevision = undefined;
      cachedRenderPlan = null;
      cachedCanvasWidth = -1;
      cachedCanvasHeight = -1;
      cachedCanvasFps = -1;
      cachedGetKeyframes = undefined;
      cachedGetPreviewTransform = undefined;
      cachedGetPreviewPathVertices = undefined;
    },
  };
}

const defaultFrameSceneCache = createFrameCompositionSceneCache();

export function resolveFrameCompositionSceneCached(
  params: Parameters<typeof resolveFrameCompositionScene>[0],
  revision?: unknown,
): FrameCompositionScene {
  return defaultFrameSceneCache.resolve(params, revision);
}

/** Invalidate the default cached scene (call when composition structure changes). */
export function invalidateFrameSceneCache(): void {
  defaultFrameSceneCache.invalidate();
}
