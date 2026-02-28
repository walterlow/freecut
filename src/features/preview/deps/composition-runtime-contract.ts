/**
 * Adapter exports for composition-runtime dependencies.
 * Preview modules should import composition-runtime modules from here.
 */

export { MainComposition } from '@/features/composition-runtime/compositions/main-composition';
export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { getVideoTargetTimeSeconds } from '@/features/composition-runtime/utils/video-timing';
