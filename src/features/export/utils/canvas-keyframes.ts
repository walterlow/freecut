/**
 * Canvas Keyframe Animation System
 *
 * Provides keyframe interpolation for client-side rendering.
 * Re-exports and adapts existing keyframe utilities for canvas rendering.
 */

import type { TimelineItem } from '@/types/timeline';
import type { ItemKeyframes } from '@/types/keyframe';
import type { ResolvedTransform, CanvasSettings } from '@/types/transform';
import { resolveTransform, getSourceDimensions } from '@/lib/remotion/utils/transform-resolver';
import { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';

/**
 * Canvas settings for transform resolution
 */
export interface CanvasRenderSettings {
  width: number;
  height: number;
  fps: number;
}

/**
 * Get the animated transform for an item at a specific frame.
 *
 * @param item - The timeline item
 * @param keyframes - Keyframes for this item (optional)
 * @param frame - Current frame (global timeline frame)
 * @param canvas - Canvas settings
 * @returns ResolvedTransform with keyframe animations applied
 */
export function getAnimatedTransform(
  item: TimelineItem,
  keyframes: ItemKeyframes | undefined,
  frame: number,
  canvas: CanvasRenderSettings
): ResolvedTransform {
  // Get source dimensions for proper fit-to-canvas calculation
  const sourceDimensions = getSourceDimensions(item);

  // Get base resolved transform (without animation)
  const canvasSettings: CanvasSettings = {
    width: canvas.width,
    height: canvas.height,
    fps: canvas.fps,
  };
  const baseResolved = resolveTransform(item, canvasSettings, sourceDimensions);

  // Calculate local frame relative to item start
  const localFrame = frame - item.from;

  // Apply keyframe animation if any
  return resolveAnimatedTransform(baseResolved, keyframes, localFrame);
}

/**
 * Build a map of item ID to keyframes for efficient lookup
 */
export function buildKeyframesMap(
  keyframes: ItemKeyframes[] | undefined
): Map<string, ItemKeyframes> {
  const map = new Map<string, ItemKeyframes>();
  if (!keyframes) return map;

  for (const itemKeyframes of keyframes) {
    map.set(itemKeyframes.itemId, itemKeyframes);
  }

  return map;
}

/**
 * Check if an item has any active keyframe animations
 */
export function hasKeyframes(keyframes: ItemKeyframes | undefined): boolean {
  if (!keyframes) return false;
  return keyframes.properties.some((p) => p.keyframes.length > 0);
}

// Re-export utilities for direct use
export { resolveTransform, getSourceDimensions } from '@/lib/remotion/utils/transform-resolver';
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
export { interpolatePropertyValue, getPropertyKeyframes } from '@/features/keyframes/utils/interpolation';
export { applyEasing, springEasing, cubicBezier } from '@/features/keyframes/utils/easing';
