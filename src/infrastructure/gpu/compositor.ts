/**
 * Infrastructure facade for GPU compositor.
 * All consumers should import compositor utilities from here instead of @/lib/gpu-compositor.
 */

export {
  CompositorPipeline,
  DEFAULT_LAYER_PARAMS,
} from '@/lib/gpu-compositor';

export type { CompositeLayer } from '@/lib/gpu-compositor';
