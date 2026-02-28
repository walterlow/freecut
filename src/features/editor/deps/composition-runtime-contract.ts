/**
 * Adapter exports for composition-runtime dependencies.
 * Editor modules should import composition-runtime modules from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { clearPreviewAudioCache } from '@/features/composition-runtime/utils/audio-decode-cache';
