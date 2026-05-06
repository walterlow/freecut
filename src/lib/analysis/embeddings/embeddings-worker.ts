/**
 * Web Worker for sentence-embedding generation using Xenova/all-MiniLM-L6-v2.
 *
 * The model is quantized (~22 MB) and runs via `pipeline('feature-extraction')`
 * from @huggingface/transformers. Loaded lazily on first init, cached in the
 * browser after download.
 *
 * Messages:
 *   → { type: 'init' }                      — preload model
 *   → { type: 'embed', id, texts: string[] } — batch embed
 *   → { type: 'dispose' }                    — release model
 *   ← { type: 'ready', dim: number }         — model loaded; embedding dimension
 *   ← { type: 'progress', percent: number }  — model download progress
 *   ← { type: 'embeddings', id, vectors: Float32Array[] } — batch result
 *   ← { type: 'error', id?, message }        — error
 */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

env.useBrowserCache = true
env.allowLocalModels = false

let extractor: FeatureExtractionPipeline | null = null
let loading = false
let disposed = false
let loadGeneration = 0
let embeddingDim = 384

function post(msg: Record<string, unknown>): void {
  self.postMessage(msg)
}

async function loadModel(): Promise<void> {
  if (extractor) {
    post({ type: 'ready', dim: embeddingDim })
    return
  }
  if (loading) return
  loading = true
  disposed = false
  const thisGen = ++loadGeneration

  try {
    let lastPct = 0
    const loaded = await pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (info: { status?: string; total?: number; loaded?: number }) => {
        if (info.status === 'progress' && info.total && info.loaded) {
          const pct = (info.loaded / info.total) * 100
          if (pct - lastPct > 2) {
            lastPct = pct
            post({ type: 'progress', percent: Math.round(pct) })
          }
        }
      },
    })

    if (disposed || thisGen !== loadGeneration) {
      return
    }

    extractor = loaded as FeatureExtractionPipeline
    // Probe dimension with a one-token warmup so the first real query isn't
    // the one that pays the shape-inference cost.
    const warmup = await extractor('probe', { pooling: 'mean', normalize: true })
    embeddingDim = Array.isArray(warmup.dims) ? Number(warmup.dims[warmup.dims.length - 1]) : 384

    post({ type: 'ready', dim: embeddingDim })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    loading = false
  }
}

async function embedBatch(id: number, texts: string[]): Promise<void> {
  if (!extractor) {
    post({ type: 'error', id, message: 'Embeddings worker not ready' })
    return
  }
  try {
    // Mean-pool + L2-normalize so cosine similarity becomes a dot product
    // at the ranking site — no per-row normalization needed downstream.
    const tensor = await extractor(texts, { pooling: 'mean', normalize: true })
    const flat = tensor.data as Float32Array
    const dim = embeddingDim
    const vectors: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 1) {
      vectors.push(flat.slice(i * dim, (i + 1) * dim))
    }
    post(
      { type: 'embeddings', id, vectors },
      // Transfer underlying buffers when possible — avoids a copy for each
      // 384-dim vector across the worker boundary.
    )
  } catch (error) {
    post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) })
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const message = event.data
  if (!message || typeof message.type !== 'string') return

  if (message.type === 'init') {
    void loadModel()
    return
  }

  if (message.type === 'embed') {
    const id = typeof message.id === 'number' ? message.id : 0
    const texts = Array.isArray(message.texts)
      ? message.texts.filter((t: unknown) => typeof t === 'string')
      : []
    void embedBatch(id, texts)
    return
  }

  if (message.type === 'dispose') {
    disposed = true
    extractor = null
    loading = false
    return
  }
})
