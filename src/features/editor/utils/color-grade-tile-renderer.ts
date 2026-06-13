/**
 * Color-page film-tile grade renderer.
 *
 * Bakes a clip's real GPU color grade onto its thumbnail frame, reusing the
 * shared (globally cached) WebGPU device through a dedicated EffectsPipeline —
 * the same primitive the Add-Effect picker uses for its preview thumbnails
 * (`use-effect-previews.ts`). Tiles are tiny (≈118×80) so each render is a
 * sub-millisecond GPU pass plus one readback; work runs off the playback loop.
 *
 * The pipeline's non-pool output canvas is reused per call, so GPU draws + the
 * snapshot readback must be serialized — concurrent callers would clobber each
 * other's output. A small promise queue enforces that; image decoding stays
 * parallel since only the GPU section needs ordering.
 */

import { EffectsPipeline, type GpuEffectInstance } from '@/infrastructure/gpu-effects'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ColorGradeTileRenderer')

// `undefined` = not yet attempted; `null` = attempted and WebGPU unavailable
// (cached so we don't re-fire EffectsPipeline.create() on every render/drag).
let pipeline: EffectsPipeline | null | undefined = undefined
let pipelinePromise: Promise<EffectsPipeline | null> | null = null

async function getPipeline(): Promise<EffectsPipeline | null> {
  if (pipeline !== undefined) return pipeline
  if (!pipelinePromise) pipelinePromise = EffectsPipeline.create()
  pipeline = await pipelinePromise
  pipelinePromise = null
  return pipeline
}

// Decode each frame URL once; tiles that share a source frame reuse the bitmap.
// Bounded LRU so retained decoded bitmaps don't accumulate across a long session
// as filmstrip evictions / poster rotations mint fresh blob URLs. Map insertion
// order is the recency order: touched entries are re-inserted at the tail.
const IMAGE_CACHE_MAX = 64
const imageCache = new Map<string, Promise<HTMLImageElement | null>>()

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(url)
  if (cached) {
    imageCache.delete(url)
    imageCache.set(url, cached)
    return cached
  }
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
  imageCache.set(url, promise)
  while (imageCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageCache.keys().next().value
    if (oldest === undefined) break
    imageCache.delete(oldest)
  }
  return promise
}

// Serialize the GPU draw + readback section (shared reusable output canvas).
let queueTail: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(task, task)
  queueTail = run.catch(() => undefined)
  return run
}

/**
 * Render `frameUrl` with `instances` applied and return a JPEG blob, or null
 * when there is nothing to grade / the GPU is unavailable (caller falls back).
 * The output preserves the source frame's aspect ratio (capped to
 * `maxDimension`) so the tile's `object-cover` crops it identically to the raw
 * frame. The caller owns the returned blob's object-URL lifecycle.
 */
export async function renderGradedTileFrame(
  frameUrl: string,
  instances: GpuEffectInstance[],
  maxDimension: number,
): Promise<Blob | null> {
  if (instances.length === 0 || maxDimension < 2) return null

  const pipe = await getPipeline()
  if (!pipe) return null

  const img = await loadImage(frameUrl)
  if (!img || img.naturalWidth < 2 || img.naturalHeight < 2) return null

  const scale = Math.min(1, maxDimension / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(2, Math.round(img.naturalWidth * scale))
  const height = Math.max(2, Math.round(img.naturalHeight * scale))

  return enqueue(async () => {
    try {
      const source = new OffscreenCanvas(width, height)
      const ctx = source.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, width, height)

      const result = pipe.applyEffectsToCanvas(source, instances)
      if (!result) return null

      // Snapshot before the next queued call overwrites the shared output.
      const bitmap = await createImageBitmap(result)
      const out = new OffscreenCanvas(width, height)
      const outCtx = out.getContext('2d')
      if (!outCtx) {
        bitmap.close()
        return null
      }
      outCtx.drawImage(bitmap, 0, 0)
      bitmap.close()

      return await out.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    } catch (error) {
      logger.warn('Failed to render graded tile frame', error)
      return null
    }
  })
}
