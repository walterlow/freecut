/**
 * Live effect-preview engine.
 *
 * Effect thumbnails render through the real WebGPU `EffectsPipeline` — the same
 * shaders playback and export use — over a single bundled sample frame. At rest
 * each thumbnail shows the effect at full "showcase" strength; on hover it
 * sweeps strength 0 → showcase → 0 (a before/after dissolve) by interpolating
 * each effect's params per frame.
 *
 * One pipeline instance is shared across every thumbnail and reuses the globally
 * cached GPU device (see EffectsPipeline.requestCachedDevice), so this adds no
 * device of its own. Rendering is synchronous and only the hovered thumbnail
 * animates per frame, so the shared instance is never accessed concurrently.
 */

import { EffectsPipeline, getGpuEffect } from '@/infrastructure/gpu-effects'
import type { GpuEffectDefinition } from '@/infrastructure/gpu-effects'
import { createLogger } from '@/shared/logging/logger'
import sampleUrl from './sample.svg'

const log = createLogger('EffectPreview')

/** Backing-store size of the preview frame (16:9). CSS scales the canvas down. */
export const PREVIEW_WIDTH = 160
export const PREVIEW_HEIGHT = 90

type EffectParams = Record<string, number | boolean | string>

// --- Shared pipeline -------------------------------------------------------

let pipeline: EffectsPipeline | null = null
let pipelinePromise: Promise<EffectsPipeline | null> | null = null

/**
 * Lazily acquire the shared effect-preview pipeline, reusing the cached GPU
 * device. Resolves to `null` when WebGPU is unavailable — callers fall back to
 * painting the raw sample frame. Safe to call repeatedly; the promise is cached.
 */
export function ensureEffectPreviewPipeline(): Promise<EffectsPipeline | null> {
  if (pipelinePromise) return pipelinePromise
  pipelinePromise = (async () => {
    try {
      pipeline = await EffectsPipeline.create()
      return pipeline
    } catch (error) {
      log.warn('Failed to initialize effect preview pipeline', { error: String(error) })
      return null
    }
  })()
  return pipelinePromise
}

/**
 * Synchronous accessor for the already-initialized pipeline, for the per-frame
 * hover animation hot path. Returns `null` until {@link ensureEffectPreviewPipeline}
 * has resolved (or if WebGPU is unavailable).
 */
export function getReadyEffectPreviewPipeline(): EffectsPipeline | null {
  return pipeline
}

// --- Sample frame ----------------------------------------------------------

let sampleCache: Promise<OffscreenCanvas | null> | null = null

/**
 * Decode the bundled sample frame once and cache the promise. Resolves to
 * `null` when OffscreenCanvas is unavailable or decode fails.
 */
export function getEffectPreviewSample(): Promise<OffscreenCanvas | null> {
  if (sampleCache) return sampleCache
  sampleCache = (async () => {
    if (typeof OffscreenCanvas === 'undefined') return null
    try {
      const img = new Image()
      img.src = sampleUrl
      await img.decode()
      const oc = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT)
      const ctx = oc.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable for sample frame')
      ctx.drawImage(img, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      return oc
    } catch (error) {
      log.warn('Failed to decode effect preview sample', { error: String(error) })
      return null
    }
  })()
  return sampleCache
}

// --- Showcase params -------------------------------------------------------

/**
 * Compute "showcase" params that make an effect visually obvious. Defaults are
 * often identity (no visible effect), so we push numeric params toward a clearly
 * visible value.
 */
export function getShowcaseParams(def: GpuEffectDefinition): EffectParams {
  const params: EffectParams = {}
  for (const [key, param] of Object.entries(def.params)) {
    if (param.type === 'number') {
      const min = param.min ?? 0
      const max = param.max ?? 1
      const dflt = param.default as number
      if (dflt === min) {
        params[key] = min + (max - min) * 0.3
      } else if (dflt === max) {
        params[key] = dflt
      } else {
        params[key] = dflt + (max - dflt) * 0.3
      }
    } else {
      params[key] = param.default
    }
  }
  return params
}

/**
 * Blend an effect's params from identity (its declared defaults) toward a target
 * at sweep position `t` (0 = original, 1 = full target). Numeric params lerp;
 * boolean/string params snap to the target (the numeric sweep carries the
 * visible motion).
 */
export function blendParams(gpuEffectType: string, target: EffectParams, t: number): EffectParams {
  const def = getGpuEffect(gpuEffectType)
  if (!def) return target
  const out: EffectParams = {}
  for (const [key, param] of Object.entries(def.params)) {
    const goal = target[key] ?? param.default
    if (param.type === 'number' && typeof goal === 'number') {
      const base = param.default as number
      out[key] = base + (goal - base) * t
    } else {
      out[key] = goal
    }
  }
  return out
}

/**
 * Warm the preview pipeline and sample frame so the first hover renders
 * instantly. Safe to call on editor mount (e.g. via `requestIdleCallback`).
 */
export function prewarmEffectPreviews(): void {
  void ensureEffectPreviewPipeline()
  void getEffectPreviewSample()
}
