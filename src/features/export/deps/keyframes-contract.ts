/**
 * Adapter exports for keyframes dependencies.
 * Export modules should import keyframe utilities from here.
 */

export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/features/keyframes/utils/interpolation'
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver'
export { resolveAnimatedCrop } from '@/features/keyframes/utils/animated-crop-resolver'
export { resolveAnimatedColorEffects } from '@/features/keyframes/utils/effect-animatable-properties'
export { resolveAnimatedTextItem } from '@/features/keyframes/utils/animated-text-item'
