/**
 * Durable Cache Storage layer for models loaded directly through onnxruntime-web.
 *
 * Models that go through transformers.js get cached automatically (`env.useBrowserCache`).
 * Models we hand to `InferenceSession.create()` ourselves do NOT — onnxruntime-web fetches
 * the weights with a plain network request and relies only on the volatile browser HTTP
 * cache, which evicts multi-hundred-MB/GB files. These helpers mirror the transformers.js
 * behaviour: check Cache Storage first, fetch + persist on a miss, keyed by URL. The bucket
 * is inspectable/clearable from Settings via `local-model-cache.ts`.
 *
 * Worker-safe: depends only on `caches`/`fetch`/`Response`, all available in workers.
 */

export const ONNX_MODEL_CACHE_NAME = 'onnx-model-cache'

function getCacheStorage(): CacheStorage | null {
  if (typeof globalThis === 'undefined' || !('caches' in globalThis)) {
    return null
  }
  try {
    return globalThis.caches
  } catch {
    // Accessing `caches` throws in insecure contexts (non-HTTPS, non-localhost).
    return null
  }
}

async function openCache(): Promise<Cache | null> {
  const storage = getCacheStorage()
  if (!storage) {
    return null
  }
  try {
    return await storage.open(ONNX_MODEL_CACHE_NAME)
  } catch {
    return null
  }
}

async function readWithProgress(
  response: Response,
  onBytes?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  if (!response.body || !onBytes) {
    return response.arrayBuffer()
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onBytes(received, total)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

/**
 * Fetch model weights as an ArrayBuffer, serving from (and populating) Cache Storage.
 * Progress is reported on both the network and the cache-hit path so the loading bar
 * behaves identically whether or not the model was already downloaded.
 */
export async function fetchOnnxModelBytes(
  url: string,
  onBytes?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await openCache()
  const cached = cache ? await cache.match(url).catch(() => undefined) : undefined

  if (cached) {
    return readWithProgress(cached, onBytes)
  }

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch ${url} (${response.status} ${response.statusText})`)
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const bytes = await readWithProgress(response, onBytes)

  if (cache) {
    // Rebuild a Response from the downloaded bytes; the original stream is already consumed.
    // content-length is set so the Settings cache inspector can report the on-disk size.
    const cacheable = new Response(bytes, {
      headers: {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
      },
    })
    await cache.put(url, cacheable).catch(() => {})
  }

  return bytes
}

/** Fetch a small text asset (vocab, etc.), serving from / populating Cache Storage. */
export async function fetchOnnxModelText(url: string): Promise<string> {
  const cache = await openCache()
  const cached = cache ? await cache.match(url).catch(() => undefined) : undefined
  if (cached) {
    return cached.text()
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status} ${response.statusText})`)
  }
  if (cache) {
    await cache.put(url, response.clone()).catch(() => {})
  }
  return response.text()
}

/** Fetch a small JSON asset (config, tokenizer, voice style), with the same caching. */
export async function fetchOnnxModelJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchOnnxModelText(url)) as T
}
