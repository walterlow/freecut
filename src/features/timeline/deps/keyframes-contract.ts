/**
 * Adapter exports for keyframes dependencies.
 * Timeline modules should import keyframe components/utilities from here.
 */

export type { AutoKeyframeOperation } from '@/features/keyframes/utils/auto-keyframe'
export { getCropPropertyValue } from '@/features/keyframes/utils/animated-crop-resolver'
export { interpolatePropertyValue } from '@/features/keyframes/utils/interpolation'
export {
  getTextAnimatableBaseValue,
  isTextAnimatableProperty,
} from '@/features/keyframes/utils/animated-text-item'
export { getBezierPresetForEasing } from '@/features/keyframes/utils/easing-presets'
export {
  getTransitionBlockedRanges,
  isFrameInTransitionRegion,
} from '@/features/keyframes/utils/transition-region'
export { DopesheetEditor } from '@/features/keyframes/components/dopesheet-editor'
export { getAnimatablePropertiesForItem } from '@/features/keyframes/utils/animatable-properties'
export type { ProceduralPreviewInput } from '@/features/keyframes/utils/procedural-preview'
export { buildBakeMotionPlan } from '@/features/keyframes/utils/bake-motion'
export { getEffectPropertyBaseValue } from '@/features/keyframes/utils/effect-animatable-properties'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@/features/keyframes/utils/animation-preset-compat'
export type { PresetIncompatibilityReason } from '@/features/keyframes/utils/animation-preset-compat'
