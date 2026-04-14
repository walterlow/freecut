/**
 * Infrastructure facade for GPU effects.
 * All consumers should import GPU effect utilities from here instead of @/lib/gpu-effects.
 */

export {
  getGpuCategoriesWithEffects,
  getGpuEffect,
  getGpuEffectDefaultParams,
  EffectsPipeline,
} from '@/lib/gpu-effects';

export type {
  GpuEffectInstance,
  GpuEffectDefinition,
} from '@/lib/gpu-effects/types';
