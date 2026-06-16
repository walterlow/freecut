/**
 * Adapter exports for keyframes dependencies.
 * Editor modules should import keyframes components/utils from here.
 */

export { KeyframeToggle } from '@/features/keyframes/components/keyframe-toggle'
export { resolveAnimatedTransform } from '@/features/keyframes/utils/animated-transform-resolver'
export {
  getCropPropertyValue,
  resolveAnimatedCrop,
} from '@/features/keyframes/utils/animated-crop-resolver'
export {
  getPropertyKeyframes,
  interpolatePropertyValue,
} from '@/features/keyframes/utils/interpolation'
export {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe'
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
export {
  animationWindowFrames,
  clamp,
  EASE_IN_SOFT,
  EASE_OUT_SOFT,
  SPRING_SETTLE,
} from '@/features/keyframes/utils/animation-easing'
export {
  MOTION_PRESETS,
  MOTION_PRESETS_BY_ID,
  MOTION_PRESET_CATEGORIES,
  getMotionPresetAnchorFrame,
  motionPresetScalesBox,
  type MotionPreset,
  type MotionPresetId,
  type MotionPresetCategory,
  type MotionThumbnail,
} from '@/features/keyframes/utils/motion-presets'
