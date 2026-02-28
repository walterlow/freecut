/**
 * Adapter exports for composition-runtime dependencies.
 * Timeline modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { needsCustomAudioDecoder } from '@/features/composition-runtime/utils/audio-codec-detection';
