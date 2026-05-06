/**
 * Main-thread manager for the decoder prewarm Web Worker pool.
 *
 * Sends pre-seek requests to background workers that run mediabunny WASM
 * decode off the main thread. Workers return decoded ImageBitmaps that
 * the render loop can draw directly — zero main-thread WASM work.
 *
 * Pool size scales with hardware concurrency: min 3, max 6.
 * Each worker loads its own mediabunny WASM instance (~2MB), so we cap
 * at 6 to avoid excessive memory pressure. 3 covers transition pairs
 * (left + right clips) plus a spare; extra workers help when multiple
 * transitions or jump preseeks overlap.
 *
 * This eliminates the 300-500ms keyframe seek stall when occluded variable-
 * speed clips become visible mid-playback.
 */

import { createLogger } from '@/shared/logging/logger'
import {
  getObjectUrlBlob,
  getObjectUrlDirectFileMetadata,
} from '@/infrastructure/browser/object-url-registry'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { updateMedia } from '@/infrastructure/storage'
import {
  getKeyframeTimestamps,
  registerKeyframeIndex,
} from '@/shared/utils/keyframe-index-registry'

const log = createLogger('DecoderPrewarm')
const MAX_CACHED_BITMAPS_PER_SOURCE = 6
const PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS = 1 / 240
/** Min 3 (transition pair + spare), max 6 (memory cap ~12MB WASM) */
const WORKER_POOL_SIZE = Math.max(
  3,
  Math.min(6, Math.floor((navigator.hardwareConcurrency ?? 4) / 2)),
)

export interface DecoderPrewarmMetricsSnapshot {
  requests: number
  cacheHits: number
  inflightReuses: number
  workerPosts: number
  workerSuccesses: number
  workerFailures: number
  waitRequests: number
  waitMatches: number
  waitResolved: number
  waitTimeouts: number
  cacheSources: number
  cacheBitmaps: number
  poolSize: number
}

interface PoolWorker {
  worker: Worker
  inflightCount: number
}

let workerPool: PoolWorker[] = []
let poolInitialized = false
let requestId = 0
const pendingRequests = new Map<
  string,
  {
    resolve: (bitmap: ImageBitmap | null) => void
  }
>()
const pendingBatchRequests = new Map<
  string,
  {
    resolve: (bitmaps: Map<number, ImageBitmap>) => void
  }
>()

/** Cache of pre-decoded bitmaps keyed by video source URL. Multiple entries per source. */
type CachedBitmapEntry = { bitmap: ImageBitmap; timestamp: number }
const bitmapCache = new Map<string, CachedBitmapEntry[]>()
const unavailableBlobUrls = new Set<string>()

type InflightPreseek = {
  timestamp: number
  promise: Promise<ImageBitmap | null>
}

const decoderPrewarmMetrics: DecoderPrewarmMetricsSnapshot = {
  requests: 0,
  cacheHits: 0,
  inflightReuses: 0,
  workerPosts: 0,
  workerSuccesses: 0,
  workerFailures: 0,
  waitRequests: 0,
  waitMatches: 0,
  waitResolved: 0,
  waitTimeouts: 0,
  cacheSources: 0,
  cacheBitmaps: 0,
  poolSize: 0,
}

/** In-flight preseek promises keyed by source URL — lets the render engine await
 *  a pending worker decode instead of falling through to a blocking main-thread decode. */
const inflightPreseekBySrc = new Map<string, InflightPreseek[]>()

// Dev: expose cache for debugging
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__PREWARM_CACHE__ = bitmapCache
}

function handleWorkerMessage(event: MessageEvent): void {
  const msg = event.data
  if (msg.type === 'debug') {
    return
  }
  if (msg.type === 'keyframes_extracted') {
    // Worker extracted keyframes for a source that had none.
    // Register in main-thread registry for the export/edit overlay path.
    registerKeyframeIndex(msg.src, msg.keyframeTimestamps)
    keyframesSentForSrc.add(msg.src)
    // Persist to IndexedDB so future sessions don't need re-extraction
    const mediaId = blobUrlManager.getMediaIdByUrl(msg.src)
    if (mediaId) {
      void updateMedia(mediaId, { keyframeTimestamps: msg.keyframeTimestamps })
    }
    return
  }
  if (msg.type === 'preseek_done') {
    const pending = pendingRequests.get(msg.id)
    if (pending) {
      pendingRequests.delete(msg.id)
      pending.resolve(msg.bitmap ?? null)
    }
  } else if (msg.type === 'batch_preseek_done') {
    const pending = pendingBatchRequests.get(msg.id)
    if (pending) {
      pendingBatchRequests.delete(msg.id)
      const results = new Map<number, ImageBitmap>()
      if (msg.success && Array.isArray(msg.entries)) {
        for (const entry of msg.entries) {
          results.set(entry.timestamp, entry.bitmap)
        }
      }
      pending.resolve(results)
    }
  }
}

function createPoolWorker(): PoolWorker | null {
  try {
    const w = new Worker(new URL('../workers/decoder-prewarm-worker.ts', import.meta.url), {
      type: 'module',
    })
    w.onmessage = handleWorkerMessage
    w.onerror = (error) => {
      log.warn('Decoder prewarm worker error', {
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
      })
    }
    w.addEventListener('messageerror', (e) => {
      log.warn('Decoder prewarm worker message error', { data: e.data })
    })
    // Eagerly load mediabunny WASM so first preseek doesn't pay cold start
    w.postMessage({ type: 'warmup' })
    return { worker: w, inflightCount: 0 }
  } catch (error) {
    log.warn('Failed to create decoder prewarm worker', { error })
    return null
  }
}

function ensureWorkerPool(): void {
  if (poolInitialized) return
  poolInitialized = true
  log.info(`Creating decoder prewarm worker pool (size: ${WORKER_POOL_SIZE})`)
  for (let i = 0; i < WORKER_POOL_SIZE; i++) {
    const pw = createPoolWorker()
    if (pw) workerPool.push(pw)
  }
  decoderPrewarmMetrics.poolSize = workerPool.length
}

/** Acquire the least-busy worker from the pool. */
function acquireWorker(): PoolWorker | null {
  ensureWorkerPool()
  if (workerPool.length === 0) return null
  let best = workerPool[0]!
  for (let i = 1; i < workerPool.length; i++) {
    const pw = workerPool[i]!
    if (pw.inflightCount < best.inflightCount) {
      best = pw
    }
  }
  best.inflightCount++
  return best
}

function releaseWorker(pw: PoolWorker): void {
  pw.inflightCount = Math.max(0, pw.inflightCount - 1)
}

function findClosestBitmapEntry(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): CachedBitmapEntry | null {
  const entries = bitmapCache.get(src)
  if (!entries || entries.length === 0) return null

  let best: CachedBitmapEntry | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp)
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }

  return best
}

function findMatchingInflightPreseek(
  src: string,
  timestamp: number,
  toleranceSeconds: number,
): InflightPreseek | null {
  const entries = inflightPreseekBySrc.get(src)
  if (!entries || entries.length === 0) return null

  let best: InflightPreseek | null = null
  let bestDist = Infinity
  for (const entry of entries) {
    const dist = Math.abs(entry.timestamp - timestamp)
    if (dist <= toleranceSeconds && dist < bestDist) {
      bestDist = dist
      best = entry
    }
  }

  return best
}

function cachePredecodedBitmap(src: string, timestamp: number, bitmap: ImageBitmap): void {
  const entries = bitmapCache.get(src) ?? []
  entries.push({ bitmap, timestamp })
  while (entries.length > MAX_CACHED_BITMAPS_PER_SOURCE) {
    const old = entries.shift()
    old?.bitmap.close()
  }
  bitmapCache.set(src, entries)
  decoderPrewarmMetrics.cacheSources = bitmapCache.size
  decoderPrewarmMetrics.cacheBitmaps = [...bitmapCache.values()].reduce(
    (sum, sourceEntries) => sum + sourceEntries.length,
    0,
  )
}

function addInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src) ?? []
  entries.push(entry)
  inflightPreseekBySrc.set(src, entries)
}

function removeInflightPreseek(src: string, entry: InflightPreseek): void {
  const entries = inflightPreseekBySrc.get(src)
  if (!entries || entries.length === 0) return

  const filtered = entries.filter((candidate) => candidate !== entry)
  if (filtered.length === 0) {
    inflightPreseekBySrc.delete(src)
    return
  }

  inflightPreseekBySrc.set(src, filtered)
}

/**
 * Pre-decode a video frame in a background Web Worker.
 * Returns the decoded ImageBitmap or null on failure.
 * The bitmap is also cached by source URL for the render loop to use.
 */
/** Cache of fetched blobs to avoid re-fetching for the same source. */
const blobByUrl = new Map<string, Blob>()

/** Track sources whose keyframe index has been sent to at least one worker */
const keyframesSentForSrc = new Set<string>()

function getDirectSourceMetadata(src: string) {
  return getObjectUrlDirectFileMetadata(src) ?? undefined
}

function getKnownBlobForUrl(src: string): Blob | null {
  const cachedBlob = blobByUrl.get(src)
  if (cachedBlob) {
    unavailableBlobUrls.delete(src)
    return cachedBlob
  }

  const registeredBlob = getObjectUrlBlob(src)
  if (!registeredBlob) {
    return null
  }

  blobByUrl.set(src, registeredBlob)
  unavailableBlobUrls.delete(src)
  return registeredBlob
}

async function resolveBlobForUrl(src: string): Promise<Blob | null> {
  const knownBlob = getKnownBlobForUrl(src)
  if (knownBlob) {
    return knownBlob
  }
  if (!src.startsWith('blob:') || unavailableBlobUrls.has(src)) {
    return null
  }

  // If the URL is a `blob:` URL but not registered with blobUrlManager /
  // object-url-registry, it is structurally unreachable from our JS:
  // `blobUrlManager.acquire()` is the only place we create blob URLs, and
  // it registers every one. Calling `fetch(src)` on an unregistered URL
  // would always fail with ERR_FILE_NOT_FOUND — and Chrome logs that
  // network failure to DevTools *before* our .catch runs, producing a
  // red console line we cannot suppress.
  //
  // This case is almost always a false positive: a timeline item briefly
  // holding a stale `src` from a previous render cycle. The next render
  // pass rebinds to a fresh URL, and prewarm retries then. True "media
  // missing" failures surface on the real playback path via
  // `<video>.onerror`, which knows the mediaId and can present a proper
  // relink / error UI — prewarm is not the right layer to detect them.
  //
  // Track the URL in `unavailableBlobUrls` so we don't re-check the
  // registry repeatedly in the same session for a known-stale URL.
  unavailableBlobUrls.add(src)
  return null
}

export function backgroundPreseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  const pw = acquireWorker()
  if (!pw) return Promise.resolve(null)
  decoderPrewarmMetrics.requests += 1

  const cachedBitmap = getCachedPredecodedBitmap(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (cachedBitmap) {
    decoderPrewarmMetrics.cacheHits += 1
    releaseWorker(pw)
    return Promise.resolve(cachedBitmap)
  }

  const inflightMatch = findMatchingInflightPreseek(
    src,
    timestamp,
    PRESEEK_REQUEST_REUSE_TOLERANCE_SECONDS,
  )
  if (inflightMatch) {
    decoderPrewarmMetrics.inflightReuses += 1
    releaseWorker(pw)
    return inflightMatch.promise
  }

  const id = `preseek-${++requestId}`
  const promise = new Promise<ImageBitmap | null>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      releaseWorker(pw)
      resolve(null)
    }, 5000)

    pendingRequests.set(id, {
      resolve: (bitmap) => {
        clearTimeout(timeout)
        releaseWorker(pw)
        if (bitmap) {
          decoderPrewarmMetrics.workerSuccesses += 1
          cachePredecodedBitmap(src, timestamp, bitmap)
        } else {
          decoderPrewarmMetrics.workerFailures += 1
        }
        resolve(bitmap)
      },
    })

    // Send the blob directly to avoid slow UrlSource fetch in the worker.
    // Blobs are transferred via structured clone — fast and avoids re-fetch.
    const w = pw.worker

    // Include keyframe index on first preseek per source so worker can
    // do adaptive backtracking instead of fixed 1-second backtrack
    let keyframeTimestamps: number[] | undefined
    if (!keyframesSentForSrc.has(src)) {
      keyframeTimestamps = getKeyframeTimestamps(src)
      if (keyframeTimestamps) keyframesSentForSrc.add(src)
    }

    const sourceMetadata = getDirectSourceMetadata(src)
    const postRequest = (blob?: Blob) => {
      if (!pendingRequests.has(id)) {
        return
      }
      decoderPrewarmMetrics.workerPosts += 1
      w.postMessage(
        blob
          ? { type: 'preseek', id, src, timestamp, blob, keyframeTimestamps, sourceMetadata }
          : { type: 'preseek', id, src, timestamp, keyframeTimestamps, sourceMetadata },
      )
    }

    const failRequest = () => {
      const pending = pendingRequests.get(id)
      if (!pending) {
        return
      }
      pendingRequests.delete(id)
      pending.resolve(null)
    }

    if (sourceMetadata) {
      postRequest()
    } else {
      const cachedBlob = getKnownBlobForUrl(src)
      if (cachedBlob) {
        postRequest(cachedBlob)
      } else if (src.startsWith('blob:')) {
        if (unavailableBlobUrls.has(src)) {
          failRequest()
          return
        }

        void resolveBlobForUrl(src).then((blob) => {
          if (blob) {
            postRequest(blob)
            return
          }
          failRequest()
        })
      } else {
        postRequest()
      }
    }
  })
  const inflightEntry: InflightPreseek = { timestamp, promise }
  addInflightPreseek(src, inflightEntry)
  void promise.finally(() => {
    removeInflightPreseek(src, inflightEntry)
  })
  return promise
}

/**
 * Batch pre-decode multiple timestamps for the same source in a single worker call.
 * Uses mediabunny's samplesAtTimestamps() which shares decoder state across the
 * batch — each packet decoded at most once. Much more efficient than individual
 * backgroundPreseek() calls when multiple timestamps are needed for the same source.
 *
 * All returned bitmaps are also cached in the per-source bitmap cache.
 */
export function backgroundBatchPreseek(
  src: string,
  timestamps: number[],
): Promise<Map<number, ImageBitmap>> {
  const uniqueTimestamps = [...new Set(timestamps)].sort((a, b) => a - b)
  if (uniqueTimestamps.length === 0) return Promise.resolve(new Map())
  // For single timestamps, fall back to the simpler path
  if (uniqueTimestamps.length === 1) {
    return backgroundPreseek(src, uniqueTimestamps[0]!).then((bitmap) => {
      const map = new Map<number, ImageBitmap>()
      if (bitmap) map.set(uniqueTimestamps[0]!, bitmap)
      return map
    })
  }

  const pw = acquireWorker()
  if (!pw) return Promise.resolve(new Map())

  const id = `batch-preseek-${++requestId}`

  let keyframeTimestamps: number[] | undefined
  if (!keyframesSentForSrc.has(src)) {
    keyframeTimestamps = getKeyframeTimestamps(src)
    if (keyframeTimestamps) keyframesSentForSrc.add(src)
  }

  const promise = new Promise<Map<number, ImageBitmap>>((resolve) => {
    const timeout = setTimeout(() => {
      pendingBatchRequests.delete(id)
      releaseWorker(pw)
      resolve(new Map())
    }, 8000)

    pendingBatchRequests.set(id, {
      resolve: (bitmaps) => {
        clearTimeout(timeout)
        releaseWorker(pw)
        // Cache all returned bitmaps
        for (const [ts, bitmap] of bitmaps) {
          cachePredecodedBitmap(src, ts, bitmap)
        }
        resolve(bitmaps)
      },
    })

    const w = pw.worker
    const sourceMetadata = getDirectSourceMetadata(src)
    const postRequest = (blob?: Blob) => {
      if (!pendingBatchRequests.has(id)) {
        return
      }
      decoderPrewarmMetrics.workerPosts += 1
      const msg = blob
        ? {
            type: 'batch_preseek',
            id,
            src,
            timestamps: uniqueTimestamps,
            keyframeTimestamps,
            blob,
            sourceMetadata,
          }
        : {
            type: 'batch_preseek',
            id,
            src,
            timestamps: uniqueTimestamps,
            keyframeTimestamps,
            sourceMetadata,
          }
      w.postMessage(msg)
    }

    const failRequest = () => {
      const pending = pendingBatchRequests.get(id)
      if (!pending) {
        return
      }
      pendingBatchRequests.delete(id)
      pending.resolve(new Map())
    }

    if (sourceMetadata) {
      postRequest()
    } else {
      const cachedBlob = getKnownBlobForUrl(src)
      if (cachedBlob) {
        postRequest(cachedBlob)
      } else if (src.startsWith('blob:')) {
        if (unavailableBlobUrls.has(src)) {
          failRequest()
          return
        }

        void resolveBlobForUrl(src).then((blob) => {
          if (blob) {
            postRequest(blob)
            return
          }
          failRequest()
        })
      } else {
        postRequest()
      }
    }
  })

  return promise
}

/**
 * Get a pre-decoded bitmap from the cache for a video source.
 * Returns the bitmap if it exists and is for a nearby timestamp.
 */
export function getCachedPredecodedBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = 0.5,
): ImageBitmap | null {
  return findClosestBitmapEntry(src, timestamp, toleranceSeconds)?.bitmap ?? null
}

/**
 * Get the in-flight preseek promise for a source, if one is pending.
 * The render engine can await this instead of starting a blocking
 * main-thread mediabunny decode — the worker is already doing the work.
 */
export function getInflightPreseek(src: string): Promise<ImageBitmap | null> | null {
  const entries = inflightPreseekBySrc.get(src)
  const lastEntry = entries && entries.length > 0 ? entries[entries.length - 1] : null
  return lastEntry?.promise ?? null
}

export async function waitForInflightPredecodedBitmap(
  src: string,
  timestamp: number,
  toleranceSeconds = 0.5,
  maxWaitMs = 12,
): Promise<ImageBitmap | null> {
  decoderPrewarmMetrics.waitRequests += 1
  const inflight = findMatchingInflightPreseek(src, timestamp, toleranceSeconds)
  if (!inflight) return null
  decoderPrewarmMetrics.waitMatches += 1

  let resolved: ImageBitmap | null = null
  if (maxWaitMs <= 0) {
    resolved = await inflight.promise
    if (resolved) {
      decoderPrewarmMetrics.waitResolved += 1
    }
  } else {
    resolved = await new Promise<ImageBitmap | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        decoderPrewarmMetrics.waitTimeouts += 1
        resolve(null)
      }, maxWaitMs)

      void inflight.promise
        .then((bitmap) => {
          clearTimeout(timeoutId)
          if (bitmap) {
            decoderPrewarmMetrics.waitResolved += 1
          }
          resolve(bitmap)
        })
        .catch(() => {
          clearTimeout(timeoutId)
          resolve(null)
        })
    })
  }

  if (!resolved) {
    return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds)
  }

  return getCachedPredecodedBitmap(src, timestamp, toleranceSeconds) ?? resolved
}

/**
 * Clear cached bitmaps for a source.
 */
export function clearPredecodedCache(src?: string): void {
  if (src) {
    const entries = bitmapCache.get(src)
    if (entries) {
      for (const entry of entries) entry.bitmap.close()
    }
    bitmapCache.delete(src)
    blobByUrl.delete(src)
    unavailableBlobUrls.delete(src)
    keyframesSentForSrc.delete(src)
  } else {
    for (const entries of bitmapCache.values()) {
      for (const entry of entries) entry.bitmap.close()
    }
    bitmapCache.clear()
    blobByUrl.clear()
    unavailableBlobUrls.clear()
    keyframesSentForSrc.clear()
  }
  decoderPrewarmMetrics.cacheSources = bitmapCache.size
  decoderPrewarmMetrics.cacheBitmaps = [...bitmapCache.values()].reduce(
    (sum, sourceEntries) => sum + sourceEntries.length,
    0,
  )
}

/**
 * Dispose all workers in the pool and clean up.
 */
export function disposePrewarmWorker(): void {
  for (const pw of workerPool) {
    pw.worker.terminate()
  }
  workerPool = []
  poolInitialized = false
  decoderPrewarmMetrics.poolSize = 0
  for (const pending of pendingRequests.values()) {
    pending.resolve(null)
  }
  pendingRequests.clear()
  for (const pending of pendingBatchRequests.values()) {
    pending.resolve(new Map())
  }
  pendingBatchRequests.clear()
  inflightPreseekBySrc.clear()
  clearPredecodedCache()
}

export function getDecoderPrewarmMetricsSnapshot(): DecoderPrewarmMetricsSnapshot {
  return { ...decoderPrewarmMetrics }
}
