/**
 * Shared WebGPU pipeline for transition-picker previews.
 *
 * The picker's Canvas 2D fallbacks are faithful for geometric transitions
 * (wipe/slide/iris/shape) but only rough approximations of the shader-driven
 * ones (sparkles/glitch/pixelate/chromatic/…). For those, previewing through
 * the real `TransitionPipeline` — the same WebGPU shaders playback and export
 * use — is the only way to show what the transition actually looks like.
 *
 * One pipeline instance is shared across every preview card and reuses the
 * globally cached GPU device (see EffectsPipeline.requestCachedDevice), so this
 * adds no device of its own. Rendering is synchronous and only the hovered card
 * draws per frame, so a single instance is never accessed concurrently.
 */

import type { TransitionPipeline } from '@/infrastructure/gpu-transitions'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('GpuTransitionPreview')

let initPromise: Promise<TransitionPipeline | null> | null = null
let pipeline: TransitionPipeline | null = null

/**
 * Lazily acquire the shared transition pipeline, reusing the cached GPU device.
 * Resolves to `null` when WebGPU is unavailable — callers fall back to the
 * renderer's Canvas 2D path. Safe to call repeatedly; the promise is cached.
 */
export function ensureGpuTransitionPipeline(): Promise<TransitionPipeline | null> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const { EffectsPipeline } = await import('@/infrastructure/gpu-effects')
      const device = await EffectsPipeline.requestCachedDevice()
      if (!device) return null
      const { TransitionPipeline } = await import('@/infrastructure/gpu-transitions')
      pipeline = TransitionPipeline.create(device)
      return pipeline
    } catch (error) {
      log.warn('Failed to initialize GPU transition preview pipeline', { error: String(error) })
      return null
    }
  })()
  return initPromise
}

/**
 * Synchronous accessor for the already-initialized pipeline, for the per-frame
 * hover animation hot path. Returns `null` until {@link ensureGpuTransitionPipeline}
 * has resolved (or if WebGPU is unavailable).
 */
export function getReadyGpuTransitionPipeline(): TransitionPipeline | null {
  return pipeline
}
