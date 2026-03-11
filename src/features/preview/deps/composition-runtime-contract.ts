/**
 * Adapter exports for composition-runtime dependencies.
 * Preview modules should import composition-runtime modules from here.
 */

export { MainComposition } from '@/features/composition-runtime/compositions/main-composition';
export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export {
  applyTransformOverride,
  resolveItemTransformAtFrame,
  resolveActiveShapeMasksAtFrame,
} from '@/features/composition-runtime/utils/frame-scene';
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout';
export { getBestDomVideoElementForItem } from '@/features/composition-runtime/utils/dom-video-element-registry';
export { getVideoTargetTimeSeconds } from '@/features/composition-runtime/utils/video-timing';
