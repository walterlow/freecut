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
  getSharedPreviewAudioContext,
  createPreviewClipAudioGraph,
} from '@/features/composition-runtime/utils/preview-audio-graph';
export type { PreviewClipAudioGraph } from '@/features/composition-runtime/utils/preview-audio-graph';
export {
  applyTransformOverride,
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
  resolveActiveShapeMasksAtFrame,
} from '@/features/composition-runtime/utils/frame-scene';
export type { PreviewPathVerticesOverride } from '@/features/composition-runtime/utils/preview-path-override';
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout';
export { getVideoTargetTimeSeconds, snapSourceTime } from '@/features/composition-runtime/utils/video-timing';
