/**
 * Adapter exports for keyframes dependencies.
 * Preview modules should import keyframe hooks/utilities from here.
 */

export {
  useAnimatedTransform,
  useAnimatedTransforms,
} from '@/features/keyframes/hooks/use-animated-transform';
export {
  getAutoKeyframeOperation,
  GIZMO_ANIMATABLE_PROPS,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe';
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver';
