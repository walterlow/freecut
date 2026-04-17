/**
 * Adapter exports for composition-runtime dependencies.
 * Media-library modules should import composition-runtime modules from here.
 */

export { needsCustomAudioDecoder } from '@/features/composition-runtime/utils/audio-codec-detection';
export {
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@/features/composition-runtime/utils/audio-decode-cache';
export {
  deletePreviewAudioConform,
  resolvePreviewAudioConformUrl,
} from '@/features/composition-runtime/utils/preview-audio-conform';
