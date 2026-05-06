/**
 * Adapter exports for composition-runtime dependencies.
 * Keyframes modules should import transform helpers from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver'
export { expandTextTransformToFitContent } from '@/features/composition-runtime/utils/text-layout'
