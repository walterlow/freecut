/**
 * Adapter exports for composition-runtime dependencies.
 * Editor modules should import composition-runtime modules from here.
 */

export {
  type AudioSegment,
  type CompoundAudioSegment,
  type VideoAudioSegment,
} from '@/features/composition-runtime/utils/audio-scene';
export {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
} from '@/features/composition-runtime/utils/audio-scene';
export {
  resolveCompositionRenderPlan,
} from '@/features/composition-runtime/utils/scene-assembly';
export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { clearPreviewAudioCache } from '@/features/composition-runtime/utils/audio-decode-cache';
export { deletePreviewAudioConform } from '@/features/composition-runtime/utils/preview-audio-conform';
