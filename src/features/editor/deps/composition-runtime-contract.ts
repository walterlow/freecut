/**
 * Adapter exports for composition-runtime dependencies.
 * Editor modules should import composition-runtime modules from here.
 */

export {
  type AudioSegment,
  type CompoundAudioSegment,
  type VideoAudioSegment,
} from '@/runtime/composition-runtime/utils/audio-scene'
export {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
} from '@/runtime/composition-runtime/utils/audio-scene'
export { resolveCompositionRenderPlan } from '@/runtime/composition-runtime/utils/scene-assembly'
export {
  resolveTransform,
  getSourceDimensions,
} from '@/runtime/composition-runtime/utils/transform-resolver'
export {
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  withCornerPinReferenceSize,
} from '@/runtime/composition-runtime/utils/corner-pin'
export { clearPreviewAudioCache } from '@/runtime/composition-runtime/utils/audio-decode-cache'
export { deletePreviewAudioConform } from '@/runtime/composition-runtime/utils/preview-audio-conform'
export { audioBufferToWavBlob } from '@/runtime/composition-runtime/utils/audio-buffer-wav'
