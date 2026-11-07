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
export { countTrimmedKeyframes } from '@/features/keyframes/utils/trimmed-keyframes'
export {
  getAutoKeyframeOperation,
  type AutoKeyframeOperation,
} from '@/features/keyframes/utils/auto-keyframe'
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
export { resolveTextCounterValue } from '@/features/keyframes/utils/animated-text-item'
export {
  VECTOR_PROPERTY_PAIRS,
  findStoredVectorKeyframe,
  getEditorVectorKeyframeId,
  getStoredVectorKeyframeId,
  getVectorPropertyProxy,
  toVectorScalePercent,
  type VectorPropertyPair,
} from '@/features/keyframes/utils/vector-proxy'
export { getAnimatablePropertyBaseValue } from '@/features/keyframes/utils/animatable-property-base-value'
export { hasPathVertexKeyframes } from '@/features/keyframes/utils/path-animatable-properties'
export { getKeyframePropertyLabel } from '@/features/keyframes/utils/property-i18n'
export {
  MOTION_PRESETS,
  MOTION_PRESET_CATEGORIES,
  getMotionPresetAnchorFrame,
  motionPresetScalesBox,
  type MotionPreset,
  type MotionPresetCategory,
  type MotionThumbnail,
} from '@/features/keyframes/utils/motion-presets'
export {
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  applyMotionGeneratorSettings,
  type MotionGeneratorSettings,
} from '@/features/keyframes/utils/motion-generator'
export {
  MOTION_MODULATORS,
  type MotionModulator,
} from '@/features/keyframes/utils/motion-modulators'
export {
  createMotionModifier,
  getMotionModifierSettings,
  updateMotionModifierSettings,
} from '@/features/keyframes/utils/motion-modifier-eval'
export { createMotionAnimationLayer } from '@/features/keyframes/utils/motion-layer-eval'
export { buildBakeMotionPlan } from '@/features/keyframes/utils/bake-motion'
