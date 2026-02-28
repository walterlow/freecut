/**
 * Adapter exports for composition-runtime dependencies.
 * Export modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@/features/composition-runtime/utils/transform-resolver';
export { getShapePath, rotatePath } from '@/features/composition-runtime/utils/shape-path';
