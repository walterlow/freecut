/**
 * Adapter exports for composition-runtime dependencies.
 * Timeline modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { resolveCornerPinTargetRect } from '@/features/composition-runtime/utils/corner-pin';
export { needsCustomAudioDecoder } from '@/features/composition-runtime/utils/audio-codec-detection';
export {
  getOrDecodeAudioSliceForPlayback,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@/features/composition-runtime/utils/audio-decode-cache';
export { prewarmPreviewAudioElement } from '@/features/composition-runtime/utils/preview-audio-element-pool';
