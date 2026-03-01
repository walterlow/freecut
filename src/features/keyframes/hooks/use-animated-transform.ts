import { useMemo, useCallback } from 'react';
import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { useTimelineStore } from '@/features/keyframes/deps/timeline';
import { usePlaybackStore } from '@/shared/state/playback';
import { getResolvedPlaybackFrame } from '@/shared/state/playback/frame-resolution';
import {
  resolveTransform,
  getSourceDimensions,
} from '@/features/keyframes/deps/composition-runtime-contract';
import { resolveAnimatedTransform } from '../utils/animated-transform-resolver';

interface AnimatedTransformResult {
  /** The fully resolved transform with keyframe animation applied */
  transform: ResolvedTransform;
  /** Whether this item has any keyframes */
  hasKeyframes: boolean;
  /** The current frame relative to the item's start */
  relativeFrame: number;
}

interface ProjectSize {
  width: number;
  height: number;
}

/**
 * Hook to get the animated transform for a single item.
 * Handles keyframe interpolation automatically.
 *
 * Use this in gizmo/preview components. For Composition components,
 * use the inline logic with useCurrentFrame() since it's already
 * relative to the item's Sequence.
 */
export function useAnimatedTransform(
  item: TimelineItem,
  projectSize: ProjectSize
): AnimatedTransformResult {
  // Get keyframes for this item (granular selector)
  const itemKeyframes = useTimelineStore(
    useCallback((s) => s.keyframes.find((k) => k.itemId === item.id), [item.id])
  );

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch);
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch);
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  });

  // Calculate relative frame
  const relativeFrame = animationFrame - item.from;

  // Resolve the animated transform
  const transform = useMemo(() => {
    const sourceDimensions = getSourceDimensions(item);
    const baseResolved = resolveTransform(
      item,
      { width: projectSize.width, height: projectSize.height, fps: 30 },
      sourceDimensions
    );

    // Apply keyframe animation if item has keyframes
    if (itemKeyframes) {
      return resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame);
    }

    return baseResolved;
  }, [item, projectSize, itemKeyframes, relativeFrame]);

  return {
    transform,
    hasKeyframes: !!itemKeyframes,
    relativeFrame,
  };
}

/**
 * Hook to get animated transforms for multiple items.
 * More efficient than calling useAnimatedTransform multiple times
 * as it shares the store subscriptions.
 */
export function useAnimatedTransforms(
  items: TimelineItem[],
  projectSize: ProjectSize
): Map<string, ResolvedTransform> {
  // Get all keyframes
  const allKeyframes = useTimelineStore((s) => s.keyframes);

  // Get current frame from playback store
  const currentFrame = usePlaybackStore((s) => s.currentFrame);
  const previewFrame = usePlaybackStore((s) => s.previewFrame);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch);
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch);
  const animationFrame = getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  });

  // Resolve transforms for all items
  return useMemo(() => {
    const transforms = new Map<string, ResolvedTransform>();

    for (const item of items) {
      const sourceDimensions = getSourceDimensions(item);
      const baseResolved = resolveTransform(
        item,
        { width: projectSize.width, height: projectSize.height, fps: 30 },
        sourceDimensions
      );

      // Apply keyframe animation if item has keyframes
      const itemKeyframes = allKeyframes.find((k) => k.itemId === item.id);
      if (itemKeyframes) {
        const relativeFrame = animationFrame - item.from;
        transforms.set(
          item.id,
          resolveAnimatedTransform(baseResolved, itemKeyframes, relativeFrame)
        );
      } else {
        transforms.set(item.id, baseResolved);
      }
    }

    return transforms;
  }, [items, projectSize, allKeyframes, animationFrame]);
}
