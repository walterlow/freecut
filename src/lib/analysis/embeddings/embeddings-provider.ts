/**
 * Singleton sentence-embedding provider built on top of `embeddings-worker`.
 *
 * A single worker instance is reused for the lifetime of the tab —
 * re-instantiating would force another model download. The module-scoped
 * state is intentional; callers should go through the exported
 * {@link embeddingsProvider} rather than constructing anything themselves.
 */

import { createLogger } from '@/shared/logging/logger'
import { createEmbeddingsWorker } from './create-embeddings-worker'
import {
  EMBEDDING_MODEL_DIM,
  EMBEDDING_MODEL_ID,
  type EmbeddingsOptions,
  type EmbeddingsProvider,
} from './types'

const log = createLogger('EmbeddingsProvider')

const INIT_TIMEOUT_MS = 60_000

let worker: Worker | null = null
let readyPromise: Promise<void> | null = null
let nextId = 0

function getWorker(): Worker {
  if (!worker) {
    worker = createEmbeddingsWorker()
    worker.addEventListener('error', (event) => {
      log.error('Embeddings worker errored', event.message)
    })
  }
  return worker
}

function ensureReady(options: EmbeddingsOptions = {}): Promise<void> {
  if (readyPromise) return readyPromise
  const w = getWorker()

  readyPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Embeddings worker init timed out'))
    }, INIT_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      w.removeEventListener('message', onMessage)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(options.signal?.reason ?? new Error('Embedding init aborted'))
    }

    const onMessage = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'ready') {
        cleanup()
        resolve()
        return
      }
      if (message.type === 'progress') {
        options.onProgress?.({ stage: 'loading-model', percent: message.percent ?? 0 })
        return
      }
      if (message.type === 'error' && message.id === undefined) {
        cleanup()
        reject(new Error(message.message ?? 'Embeddings worker init failed'))
      }
    }

    if (options.signal?.aborted) {
      cleanup()
      reject(options.signal.reason)
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    w.addEventListener('message', onMessage)
    w.postMessage({ type: 'init' })
  })

  readyPromise.catch(() => {
    // A failed init should not pin the promise forever — subsequent calls
    // will retry (model might have been offline, transient error, etc.).
    readyPromise = null
  })

  return readyPromise
}

function embedBatch(texts: string[], options: EmbeddingsOptions = {}): Promise<Float32Array[]> {
  if (texts.length === 0) return Promise.resolve([])

  const id = ++nextId
  const w = getWorker()

  return ensureReady(options).then(
    () =>
      new Promise<Float32Array[]>((resolve, reject) => {
        const cleanup = () => {
          w.removeEventListener('message', onMessage)
          options.signal?.removeEventListener('abort', onAbort)
        }

        const onAbort = () => {
          cleanup()
          reject(options.signal?.reason ?? new Error('Embedding aborted'))
        }

        const onMessage = (event: MessageEvent) => {
          const message = event.data
          if (message.id !== id) return
          if (message.type === 'embeddings') {
            cleanup()
            resolve(message.vectors as Float32Array[])
            return
          }
          if (message.type === 'error') {
            cleanup()
            reject(new Error(message.message ?? 'Embedding failed'))
          }
        }

        if (options.signal?.aborted) {
          cleanup()
          reject(options.signal.reason)
          return
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })

        w.addEventListener('message', onMessage)
        w.postMessage({ type: 'embed', id, texts })
      }),
  )
}

export const embeddingsProvider: EmbeddingsProvider = {
  ensureReady,
  async embed(text, options) {
    const [vector] = await embedBatch([text], options)
    if (!vector) throw new Error('Embedding returned no vector')
    return vector
  },
  embedBatch,
  dispose() {
    if (!worker) return
    worker.postMessage({ type: 'dispose' })
    worker.terminate()
    worker = null
    readyPromise = null
  },
}

export { EMBEDDING_MODEL_ID, EMBEDDING_MODEL_DIM }
