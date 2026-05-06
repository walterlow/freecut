/**
 * Adapter exports for composition-runtime dependencies.
 * Preview modules should import composition-runtime modules from here.
 */

export { MainComposition } from '@/features/composition-runtime/compositions/main-composition'
export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver'
export {
  applyTransformOverride,
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
  resolveActiveShapeMasksAtFrame,
} from '@/features/composition-runtime/utils/frame-scene'
export type { PreviewPathVerticesOverride } from '@/features/composition-runtime/utils/preview-path-override'
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout'
export {
  computeCornerPinHomography,
  invertCornerPinHomography,
  hasCornerPin,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  withCornerPinReferenceSize,
} from '@/features/composition-runtime/utils/corner-pin'
export { getBestDomVideoElementForItem } from '@/features/composition-runtime/utils/dom-video-element-registry'
export {
  getVideoTargetTimeSeconds,
  snapSourceTime,
} from '@/features/composition-runtime/utils/video-timing'
export {
  transitionSafePlay,
  muteTransitionElement,
  unmuteTransitionElement,
} from '@/features/composition-runtime/components/video-audio-context'
