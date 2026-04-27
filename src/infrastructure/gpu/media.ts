/**
 * Infrastructure facade for GPU media rendering.
 * All consumers should import GPU media utilities from here instead of @/lib/gpu-media.
 */

export { MediaBlendPipeline, MediaRenderPipeline } from '@/lib/gpu-media'
export type { GpuMediaRect, GpuMediaRenderParams } from '@/lib/gpu-media'
