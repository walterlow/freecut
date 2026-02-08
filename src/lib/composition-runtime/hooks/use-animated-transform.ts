/**
 * Hook for resolving animated transforms in Composition components.
 * Combines base transform resolution with keyframe interpolation.
 */

import { useMemo } from 'react';
import { useSequenceContext } from '@/features/player/composition';
import type { TimelineItem } from '@/types/timeline';
import type { CanvasSettings, ResolvedTransform } from '@/types/transform';
import type { ItemKeyframes } from '@/types/keyframe';
import { resolveTransform, getSourceDimensions } from '../utils/transform-resolver';
import { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';

/**
 * Hook to get the animated transform for an item at the current frame.
 *
 * @param item - The timeline item
 * @param canvas - Canvas settings (width, height, fps)
 * @param itemKeyframes - Keyframes for this item (optional)
 * @param sequenceFrameOffset - Offset for shared sequences (e.g., split clips)
 * @returns ResolvedTransform with keyframe animations applied
 */
export function useAnimatedTransform(
  item: TimelineItem,
  canvas: CanvasSettings,
  itemKeyframes: ItemKeyframes | undefined,
  sequenceFrameOffset: number = 0
): ResolvedTransform {
  // Get local frame from Sequence context (0-based within this Sequence)
  const sequenceContext = useSequenceContext();
  const sequenceFrame = sequenceContext?.localFrame ?? 0;

  // Calculate item-relative frame (accounting for shared sequence offsets)
  const frame = sequenceFrame - sequenceFrameOffset;

  return useMemo(() => {
    // Get base resolved transform (without animation)
    const sourceDimensions = getSourceDimensions(item);
    const baseResolved = resolveTransform(item, canvas, sourceDimensions);

    // Apply keyframe animation if any
    return resolveAnimatedTransform(baseResolved, itemKeyframes, frame);
  }, [item, canvas, itemKeyframes, frame]);
}

/**
 * Hook to get the animated transform with gizmo preview support.
 * Gizmo preview takes precedence over keyframe animation for responsive dragging.
 *
 * @param item - The timeline item
 * @param canvas - Canvas settings
 * @param itemKeyframes - Keyframes for this item
 * @param previewTransform - Preview transform from gizmo (takes precedence)
 * @param sequenceFrameOffset - Offset for shared sequences
 * @returns ResolvedTransform with either preview or keyframe animation
 */
export function useAnimatedTransformWithPreview(
  item: TimelineItem,
  canvas: CanvasSettings,
  itemKeyframes: ItemKeyframes | undefined,
  previewTransform: Partial<ResolvedTransform> | null,
  sequenceFrameOffset: number = 0
): ResolvedTransform {
  // Get animated transform
  const animatedTransform = useAnimatedTransform(
    item,
    canvas,
    itemKeyframes,
    sequenceFrameOffset
  );

  // If preview is active, merge it (preview takes precedence)
  return useMemo(() => {
    if (!previewTransform) return animatedTransform;

    return {
      ...animatedTransform,
      ...previewTransform,
    };
  }, [animatedTransform, previewTransform]);
}

/**
 * Hook to get the transform value for a specific property at the current frame.
 * Useful for displaying current animated value in UI.
 *
 * @param item - The timeline item
 * @param canvas - Canvas settings
 * @param itemKeyframes - Keyframes for this item
 * @param property - The property to get
 * @param sequenceFrameOffset - Offset for shared sequences
 * @returns The current value of the property
 */
export function useAnimatedPropertyValue(
  item: TimelineItem,
  canvas: CanvasSettings,
  itemKeyframes: ItemKeyframes | undefined,
  property: keyof ResolvedTransform,
  sequenceFrameOffset: number = 0
): number {
  const animatedTransform = useAnimatedTransform(
    item,
    canvas,
    itemKeyframes,
    sequenceFrameOffset
  );

  return animatedTransform[property];
}
