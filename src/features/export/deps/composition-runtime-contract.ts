/**
 * Adapter exports for composition-runtime dependencies.
 * Export modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export {
  applyTransformOverride,
  resolveItemTransformAtFrame,
  resolveActiveShapeMasksAtFrame,
  resolveFrameCompositionScene,
} from '@/features/composition-runtime/utils/frame-scene';
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout';
export {
  resolveTrackRenderState,
  resolveCompositionRenderPlan,
  collectTransitionClipItems,
  buildItemIdMap,
  resolveTransitionWindowsForItems,
  collectVisibleAdjustmentLayers,
  buildFrameRenderTasks,
  collectFrameVideoCandidates,
  groupTransitionsByTrackOrder,
  resolveOcclusionCutoffOrder,
  resolveFrameRenderScene,
} from '@/features/composition-runtime/utils/scene-assembly';
export {
  calculateTransitionProgress,
  resolveTransitionFrameState,
} from '@/features/composition-runtime/utils/transition-scene';
export { getShapePath, rotatePath } from '@/features/composition-runtime/utils/shape-path';
export { hasCornerPin, drawCornerPinImage } from '@/features/composition-runtime/utils/corner-pin';
