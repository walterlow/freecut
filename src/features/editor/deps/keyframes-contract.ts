/**
 * Adapter exports for keyframes dependencies.
 * Editor modules should import keyframes components/utils from here.
 */

export { KeyframeToggle } from '@/features/keyframes/components/keyframe-toggle';
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
export { getPropertyKeyframes, interpolatePropertyValue } from '@/features/keyframes/utils/interpolation';
export {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe';
