/**
 * Animated transform resolver.
 * Merges keyframe-animated values with base transform properties.
 */

import type { ResolvedTransform } from '@/types/transform'
import type { ItemKeyframes, TransformAnimatableProperty } from '@/types/keyframe'
import { getPropertyKeyframes, interpolatePropertyValue } from './interpolation'

/**
 * All animatable transform properties (excludes non-spatial props like volume).
 */
const ANIMATABLE_TRANSFORM_PROPERTIES: TransformAnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
]

/**
 * Resolve an animated transform at a specific frame.
 * Merges keyframe-animated values with the base resolved transform.
 *
 * @param baseResolved - The base resolved transform (without animation)
 * @param itemKeyframes - All keyframes for the item
 * @param frame - Current frame relative to item start
 * @returns ResolvedTransform with animated values applied
 */
export function resolveAnimatedTransform(
  baseResolved: ResolvedTransform,
  itemKeyframes: ItemKeyframes | undefined,
  frame: number,
): ResolvedTransform {
  // No keyframes - return base transform unchanged
  if (!itemKeyframes || itemKeyframes.properties.length === 0) {
    return baseResolved
  }

  // Start with base transform
  const result = { ...baseResolved }

  // Apply animated values for each property that has keyframes
  for (const property of ANIMATABLE_TRANSFORM_PROPERTIES) {
    const keyframes = getPropertyKeyframes(itemKeyframes, property)
    if (keyframes.length > 0) {
      const baseValue = baseResolved[property]
      result[property] = interpolatePropertyValue(keyframes, frame, baseValue)
    }
  }

  return result
}

/**
 * Check if an item has any keyframe animations.
 *
 * @param itemKeyframes - All keyframes for the item
 * @returns True if the item has at least one keyframe
 */
export function hasKeyframeAnimation(itemKeyframes: ItemKeyframes | undefined): boolean {
  if (!itemKeyframes) return false
  return itemKeyframes.properties.some((p) => p.keyframes.length > 0)
}
