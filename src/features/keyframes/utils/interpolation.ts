/**
 * Keyframe interpolation utilities.
 * Provides functions to calculate property values at any frame.
 */

import type { Keyframe, ItemKeyframes, AnimatableProperty } from '@/types/keyframe';
import { applyEasing } from './easing';

/**
 * Interpolate a value between two keyframes at a given frame.
 * Uses the easing function from the "from" keyframe.
 *
 * @param prevKf - The keyframe before or at the current frame
 * @param nextKf - The keyframe after the current frame
 * @param frame - The current frame (relative to item start)
 * @returns The interpolated value
 */
function interpolateBetweenKeyframes(
  prevKf: Keyframe,
  nextKf: Keyframe,
  frame: number
): number {
  // Calculate progress between keyframes (0 to 1)
  const frameRange = nextKf.frame - prevKf.frame;
  if (frameRange <= 0) return prevKf.value;

  const progress = (frame - prevKf.frame) / frameRange;

  // Apply easing (uses the "from" keyframe's easing)
  const easedProgress = applyEasing(progress, prevKf.easing);

  // Linear interpolation with eased progress
  return prevKf.value + (nextKf.value - prevKf.value) * easedProgress;
}

/**
 * Get the interpolated value for a property at a specific frame.
 *
 * @param keyframes - Sorted array of keyframes for this property
 * @param frame - Current frame (relative to item start)
 * @param baseValue - Default value if no keyframes exist
 * @returns The interpolated value at this frame
 */
export function interpolatePropertyValue(
  keyframes: Keyframe[],
  frame: number,
  baseValue: number
): number {
  // No keyframes - use base value
  if (keyframes.length === 0) return baseValue;

  // Get first and last keyframes (guaranteed to exist since length > 0)
  const firstKf = keyframes[0]!;

  // Single keyframe - use that value for all frames
  if (keyframes.length === 1) return firstKf.value;

  // Before first keyframe - hold first value
  if (frame <= firstKf.frame) return firstKf.value;

  // After last keyframe - hold last value
  const lastKf = keyframes[keyframes.length - 1]!;
  if (frame >= lastKf.frame) return lastKf.value;

  // Find surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const prevKf = keyframes[i]!;
    const nextKf = keyframes[i + 1]!;

    if (prevKf.frame <= frame && nextKf.frame > frame) {
      return interpolateBetweenKeyframes(prevKf, nextKf, frame);
    }
  }

  // Fallback (shouldn't reach here with valid keyframes)
  return baseValue;
}

/**
 * Get keyframes for a specific property from an ItemKeyframes object.
 *
 * @param itemKeyframes - All keyframes for an item
 * @param property - The property to get keyframes for
 * @returns Array of keyframes for the property, or empty array if none
 */
export function getPropertyKeyframes(
  itemKeyframes: ItemKeyframes | undefined,
  property: AnimatableProperty
): Keyframe[] {
  if (!itemKeyframes) return [];

  const propKeyframes = itemKeyframes.properties.find((p) => p.property === property);
  return propKeyframes?.keyframes ?? [];
}
