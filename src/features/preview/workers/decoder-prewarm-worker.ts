/**
 * Web Worker for background mediabunny decoder pre-seeking.
 *
 * Decodes video frames off the main thread so pre-seeking occluded
 * variable-speed clips doesn't block the render loop's rAF callbacks.
 * Returns decoded ImageBitmaps that the render loop can draw directly.
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry'

const TIMESTAMP_EPSILON = 1e-4
const LOOKAHEAD_TOLERANCE_SECONDS = 0.05
const FORWARD_JUMP_RESTART_SECONDS = 3.0
const MAX_EXTRACTORS_PER_WORKER = 8
const MAX_ACTIVE_PREVIEW_EXTRACTORS = 2
const ACTIVE_PREVIEW_CANCELLED = Symbol('active-preview-cancelled')
const activePreviewGenerationBySrc = new Map<string, number>()

/** Per-source keyframe index received from main thread */
const keyframeIndexBySrc = new Map<string, number[]>()

// Lazy-load mediabunny (same pattern as filmstrip and proxy workers)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mb: any = null
async function getMediabunny() {
  if (!mb) mb = await import('mediabunny')
  return mb
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorkerSample = any

interface ExtractorState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sink: any
  canvas: OffscreenCanvas
  ctx: OffscreenCanvasRenderingContext2D
  sampleIterator: AsyncGenerator<WorkerSample, void, unknown> | null
  currentSample: WorkerSample | null
  nextSample: WorkerSample | null
  iteratorDone: boolean
  lastRequestedTimestamp: number | null
  cachedVideoFrame: VideoFrame | null
  cachedVideoFrameSample: WorkerSample | null
  drawLock: Promise<void> | null
}

const extractors = new Map<string, ExtractorState>()
const initPromises = new Map<string, Promise<ExtractorState | null>>()

interface WorkerSourceOptions {
  blob?: Blob
  sourceMetadata?: ObjectUrlSourceMetadata
  activePreview?: boolean
}

async function getExtractor(
  src: string,
  options?: WorkerSourceOptions,
): Promise<ExtractorState | null> {
  const existing = extractors.get(src)
  if (existing) {
    touchExtractor(src, existing)
    if (options?.activePreview) {
      pruneOldExtractors(src, MAX_ACTIVE_PREVIEW_EXTRACTORS)
    }
    return existing
  }

  const inflight = initPromises.get(src)
  if (inflight) return inflight

  const promise = (async () => {
    const initStartedAt = performance.now()
    const mediabunny = await getMediabunny()
    const source = createMediabunnyInputSource(mediabunny, src, {
      metadata: options?.sourceMetadata,
      fallbackBlob: options?.blob,
    })
    const input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source,
    })

    self.postMessage({ type: 'debug', step: 'init_started' })

    try {
      const videoTrack = await input.getPrimaryVideoTrack()
      if (!videoTrack) {
        input.dispose?.()
        return null
      }

      if (typeof videoTrack.canDecode === 'function' && !(await videoTrack.canDecode())) {
        input.dispose?.()
        return null
      }

      // Lazy-extract a keyframe index for sources that arrive without one.
      // The main thread persists it for other preview/proxy consumers; the
      // VideoSampleSink range path performs its own verified keyframe lookup.
      if (!keyframeIndexBySrc.has(src)) {
        try {
          const eps = new mediabunny.EncodedPacketSink(videoTrack)
          const kfTimestamps: number[] = []
          const metadataOpts = { metadataOnly: true } as const
          let pkt = await eps.getFirstKeyPacket(metadataOpts)
          while (pkt) {
            kfTimestamps.push(pkt.timestamp)
            pkt = await eps.getNextKeyPacket(pkt, metadataOpts)
          }
          eps.dispose?.()
          if (kfTimestamps.length > 0) {
            keyframeIndexBySrc.set(src, kfTimestamps)
            self.postMessage({
              type: 'keyframes_extracted',
              src,
              keyframeTimestamps: kfTimestamps,
            })
          }
        } catch {
          // Non-fatal — falls back to fixed 1s backtrack
        }
      }

      const sink = new mediabunny.VideoSampleSink(
        videoTrack,
        options?.activePreview
          ? {
              hardwareAcceleration: 'prefer-hardware',
              optimizeForLatency: true,
            }
          : undefined,
      )
      const canvas = new OffscreenCanvas(1, 1)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        input.dispose?.()
        return null
      }

      self.postMessage({ type: 'debug', step: 'init_complete' })
      if (options?.activePreview) {
        self.postMessage({
          type: 'debug',
          step: 'active_init_complete',
          ms: performance.now() - initStartedAt,
        })
      }

      const state: ExtractorState = {
        input,
        sink,
        canvas,
        ctx,
        sampleIterator: null,
        currentSample: null,
        nextSample: null,
        iteratorDone: false,
        lastRequestedTimestamp: null,
        cachedVideoFrame: null,
        cachedVideoFrameSample: null,
        drawLock: null,
      }
      extractors.set(src, state)
      pruneOldExtractors(
        src,
        options?.activePreview ? MAX_ACTIVE_PREVIEW_EXTRACTORS : MAX_EXTRACTORS_PER_WORKER,
      )
      if (options?.activePreview) {
        self.postMessage({
          type: 'debug',
          step: 'active_extractors',
          count: extractors.size,
        })
      }
      return state
    } catch (error) {
      input.dispose?.()
      throw error
    }
  })()

  initPromises.set(src, promise)
  try {
    return await promise
  } finally {
    initPromises.delete(src)
  }
}

function touchExtractor(src: string, state: ExtractorState): void {
  extractors.delete(src)
  extractors.set(src, state)
}

function disposeExtractorState(state: ExtractorState): void {
  closeStreamState(state)
  try {
    state.input.dispose?.()
  } catch {
    // Ignore dispose errors.
  }
}

function pruneOldExtractors(activeSrc: string, maxExtractors = MAX_EXTRACTORS_PER_WORKER): void {
  while (extractors.size > maxExtractors) {
    const oldestSrc = extractors.keys().next().value as string | undefined
    if (!oldestSrc) return
    if (oldestSrc === activeSrc) {
      const activeState = extractors.get(oldestSrc)
      if (!activeState) return
      touchExtractor(oldestSrc, activeState)
      continue
    }

    const oldest = extractors.get(oldestSrc)
    extractors.delete(oldestSrc)
    keyframeIndexBySrc.delete(oldestSrc)
    if (oldest) {
      disposeExtractorState(oldest)
    }
  }
}

function closeSample(sample: WorkerSample | null): void {
  if (!sample || typeof sample.close !== 'function') return
  try {
    sample.close()
  } catch {
    // Ignore close errors.
  }
}

function closeCachedVideoFrame(state: ExtractorState): void {
  if (!state.cachedVideoFrame) return
  try {
    state.cachedVideoFrame.close()
  } catch {
    // Ignore close errors.
  }
  state.cachedVideoFrame = null
  state.cachedVideoFrameSample = null
}

function closeStreamState(state: ExtractorState): void {
  if (state.sampleIterator) {
    void state.sampleIterator.return?.()
  }
  state.sampleIterator = null
  state.iteratorDone = true
  state.lastRequestedTimestamp = null
  closeCachedVideoFrame(state)
  closeSample(state.currentSample)
  closeSample(state.nextSample)
  state.currentSample = null
  state.nextSample = null
}

function resetSampleIterator(state: ExtractorState, startTimestamp: number): void {
  closeStreamState(state)
  // MediaBunny already locates and verifies the preceding key packet before
  // decoding a range. Starting at the requested presentation timestamp keeps
  // that necessary GOP decode inside the sink without yielding a keyframe-to-
  // target runway that this worker would only close and discard.
  state.sampleIterator = state.sink.samples(
    Math.max(0, startTimestamp),
    Infinity,
  ) as AsyncGenerator<WorkerSample, void, unknown>
  state.iteratorDone = false
  state.lastRequestedTimestamp = null
}

async function peekNextSample(state: ExtractorState): Promise<WorkerSample | null> {
  if (state.nextSample) {
    return state.nextSample
  }
  if (!state.sampleIterator || state.iteratorDone) {
    return null
  }

  const iterator = state.sampleIterator
  const nextResult = await iterator.next()
  if (iterator !== state.sampleIterator) {
    if (!nextResult.done) closeSample(nextResult.value)
    return null
  }
  if (nextResult.done) {
    state.iteratorDone = true
    return null
  }

  state.nextSample = nextResult.value
  return state.nextSample
}

async function ensureSampleForTimestamp(
  state: ExtractorState,
  timestamp: number,
  shouldContinue?: () => boolean,
): Promise<void> {
  if (shouldContinue && !shouldContinue()) throw ACTIVE_PREVIEW_CANCELLED
  if (!state.sampleIterator) {
    resetSampleIterator(state, timestamp)
  } else if (
    state.lastRequestedTimestamp !== null &&
    timestamp + TIMESTAMP_EPSILON < state.lastRequestedTimestamp &&
    !currentSampleCoversTimestamp(state, timestamp)
  ) {
    resetSampleIterator(state, timestamp)
  } else if (
    state.lastRequestedTimestamp !== null &&
    timestamp - state.lastRequestedTimestamp > FORWARD_JUMP_RESTART_SECONDS
  ) {
    resetSampleIterator(state, timestamp)
  }

  state.lastRequestedTimestamp = timestamp

  while (true) {
    if (shouldContinue && !shouldContinue()) throw ACTIVE_PREVIEW_CANCELLED
    const candidate = await peekNextSample(state)
    if (shouldContinue && !shouldContinue()) throw ACTIVE_PREVIEW_CANCELLED
    if (!candidate) break

    if (candidate.timestamp <= timestamp + TIMESTAMP_EPSILON) {
      closeCachedVideoFrame(state)
      closeSample(state.currentSample)
      state.currentSample = candidate
      state.nextSample = null
      continue
    }

    if (!state.currentSample && candidate.timestamp - timestamp <= LOOKAHEAD_TOLERANCE_SECONDS) {
      state.currentSample = candidate
      state.nextSample = null
    }
    break
  }
}

function currentSampleCoversTimestamp(state: ExtractorState, timestamp: number): boolean {
  const sample = state.currentSample as { timestamp?: number; duration?: number } | null
  if (!sample || typeof sample.timestamp !== 'number') {
    return false
  }

  if (sample.timestamp > timestamp + TIMESTAMP_EPSILON) {
    return false
  }

  if (
    typeof sample.duration !== 'number' ||
    !Number.isFinite(sample.duration) ||
    sample.duration <= 0
  ) {
    return true
  }

  return sample.timestamp + sample.duration >= timestamp - TIMESTAMP_EPSILON
}

function getSampleDisplaySize(sample: WorkerSample): { width: number; height: number } | null {
  const width = Number(sample?.displayWidth ?? 0)
  const height = Number(sample?.displayHeight ?? 0)
  if (Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1) {
    return { width: Math.round(width), height: Math.round(height) }
  }

  const videoFrame =
    typeof sample?.toVideoFrame === 'function' ? sample.toVideoFrame() : (sample?.frame ?? null)
  if (!videoFrame) {
    return null
  }

  try {
    const fallbackWidth = Number(videoFrame.displayWidth ?? videoFrame.width ?? 0)
    const fallbackHeight = Number(videoFrame.displayHeight ?? videoFrame.height ?? 0)
    if (
      Number.isFinite(fallbackWidth) &&
      Number.isFinite(fallbackHeight) &&
      fallbackWidth >= 1 &&
      fallbackHeight >= 1
    ) {
      return { width: Math.round(fallbackWidth), height: Math.round(fallbackHeight) }
    }
    return null
  } finally {
    try {
      videoFrame.close?.()
    } catch {
      // Ignore close errors.
    }
  }
}

function renderSampleToBitmap(
  state: ExtractorState,
  sample: WorkerSample,
  maxDimension?: number,
): ImageBitmap | null {
  const size = getSampleDisplaySize(sample)
  if (!size || typeof sample?.draw !== 'function') {
    return null
  }

  const normalizedMaxDimension =
    Number.isFinite(maxDimension) && Number(maxDimension) >= 1
      ? Math.max(1, Math.round(Number(maxDimension)))
      : null
  const scale =
    normalizedMaxDimension === null
      ? 1
      : Math.min(1, normalizedMaxDimension / Math.max(size.width, size.height))
  const outputWidth = Math.max(1, Math.round(size.width * scale))
  const outputHeight = Math.max(1, Math.round(size.height * scale))

  if (state.canvas.width !== outputWidth) state.canvas.width = outputWidth
  if (state.canvas.height !== outputHeight) state.canvas.height = outputHeight
  sample.draw(state.ctx, 0, 0, outputWidth, outputHeight)
  return state.canvas.transferToImageBitmap()
}

function renderCurrentSampleToBitmap(state: ExtractorState): ImageBitmap | null {
  const sample = state.currentSample
  if (!sample) {
    return null
  }

  return renderSampleToBitmap(state, sample)
}

async function recoverAndPrime(
  state: ExtractorState,
  timestamp: number,
  error: unknown,
): Promise<boolean> {
  const message = error instanceof Error ? error.message : String(error)
  const looksRecoverable = /key frame|configure\(\)|flush\(\)|InvalidStateError|decode/i.test(
    message,
  )
  if (!looksRecoverable) {
    return false
  }

  try {
    resetSampleIterator(state, timestamp)
    await ensureSampleForTimestamp(state, timestamp)
    return state.currentSample !== null
  } catch {
    return false
  }
}

async function preseekWithState(
  state: ExtractorState,
  timestamp: number,
  shouldContinue?: () => boolean,
): Promise<ImageBitmap | null> {
  try {
    await ensureSampleForTimestamp(state, timestamp, shouldContinue)
    if (shouldContinue && !shouldContinue()) return null
    return renderCurrentSampleToBitmap(state)
  } catch (error) {
    if (error === ACTIVE_PREVIEW_CANCELLED) return null
    const recovered = await recoverAndPrime(state, timestamp, error)
    if (!recovered) {
      return null
    }
    return renderCurrentSampleToBitmap(state)
  }
}

async function sparsePreseekWithState(
  state: ExtractorState,
  timestamp: number,
  shouldContinue: () => boolean,
): Promise<ImageBitmap | null> {
  if (!shouldContinue()) return null
  let sample: WorkerSample | null = null
  try {
    // Active held scrubs are sparse random access. Mediabunny's dedicated
    // sparse path seeks/decodes directly to the requested presentation sample.
    // Sink calls are independent, so another generation may decode concurrently;
    // only the shared canvas draw is serialized below.
    sample = await state.sink.getSample(timestamp)
    if (!sample || !shouldContinue()) return null
    const previousDraw = state.drawLock ?? Promise.resolve()
    const draw = previousDraw.then(() =>
      shouldContinue() && sample ? renderSampleToBitmap(state, sample) : null,
    )
    state.drawLock = draw.then(
      () => undefined,
      () => undefined,
    )
    return await draw
  } catch {
    return null
  } finally {
    closeSample(sample)
  }
}

async function preseek(
  src: string,
  timestamp: number,
  blob?: Blob,
  sourceMetadata?: ObjectUrlSourceMetadata,
  shouldContinue?: () => boolean,
): Promise<ImageBitmap | null> {
  const state = await getExtractor(src, {
    blob,
    sourceMetadata,
    activePreview: shouldContinue !== undefined,
  })
  if (!state) return null

  if (shouldContinue) {
    return sparsePreseekWithState(state, timestamp, shouldContinue)
  }

  const previous = state.drawLock ?? Promise.resolve()
  const result = previous.then(() => preseekWithState(state, timestamp))
  state.drawLock = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/**
 * Batch-decode multiple timestamps for the same source using mediabunny's
 * optimized samplesAtTimestamps() pipeline. This decodes each packet at
 * most once (unlike individual getSample/preseek calls which may re-seek
 * the decoder for each timestamp).
 *
 * Timestamps MUST be sorted ascending for the optimization to apply.
 */
async function batchPreseek(
  src: string,
  timestamps: number[],
  blob?: Blob,
  sourceMetadata?: ObjectUrlSourceMetadata,
  shouldContinue: () => boolean = () => true,
  maxDimension?: number,
): Promise<Map<number, ImageBitmap>> {
  const results = new Map<number, ImageBitmap>()
  if (!shouldContinue()) return results
  const state = await getExtractor(src, { blob, sourceMetadata })
  if (!state || timestamps.length === 0 || !shouldContinue()) return results

  // Serialize with the single-frame path via drawLock
  const previous = state.drawLock ?? Promise.resolve()
  const result = previous.then(async () => {
    try {
      // samplesAtTimestamps uses an optimized pipeline that shares decoder
      // state across the batch — each packet decoded at most once.
      const iterator = state.sink.samplesAtTimestamps(timestamps)
      let i = 0
      try {
        for await (const sample of iterator) {
          if (!shouldContinue()) break
          const timestamp = timestamps[i]
          i++

          if (!sample) {
            continue
          }

          try {
            // Defensive: mediabunny should yield at most one sample per requested
            // timestamp, but an over-producing iterator must not leak the extra
            // VideoSample while the stream is being torn down.
            if (timestamp === undefined) continue
            const bitmap = renderSampleToBitmap(state, sample, maxDimension)
            if (bitmap) results.set(timestamp, bitmap)
          } finally {
            sample.close?.()
          }
        }
      } finally {
        await iterator.return?.()
      }
    } catch {
      // Batch decode failed — return whatever we got
    }
    return results
  })
  state.drawLock = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const cancelledBatchRequestIds = new Set<string>()

// Signal worker is alive.
self.postMessage({ type: 'ready' })

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data

  // Eagerly load mediabunny WASM so first preseek doesn't pay the cold start
  if (msg.type === 'warmup') {
    void getMediabunny()
    return
  }

  // Register keyframe index for a source (sent once per source from main thread)
  if (msg.type === 'set_keyframes') {
    if (msg.src && Array.isArray(msg.keyframeTimestamps)) {
      keyframeIndexBySrc.set(msg.src, msg.keyframeTimestamps)
    }
    return
  }

  if (msg.type === 'active_cancel') {
    const src = String(msg.src ?? '')
    if (src) {
      activePreviewGenerationBySrc.set(
        src,
        Math.max(activePreviewGenerationBySrc.get(src) ?? 0, Number(msg.generation) || 0),
      )
    }
    return
  }

  if (msg.type === 'batch_cancel') {
    cancelledBatchRequestIds.add(String(msg.id))
    return
  }

  // Batch preseek: decode multiple timestamps via optimized pipeline
  if (msg.type === 'batch_preseek') {
    if (msg.keyframeTimestamps && !keyframeIndexBySrc.has(msg.src)) {
      keyframeIndexBySrc.set(msg.src, msg.keyframeTimestamps)
    }
    try {
      const sorted = [...msg.timestamps].sort((a: number, b: number) => a - b)
      const requestId = String(msg.id)
      const bitmaps = await batchPreseek(
        msg.src,
        sorted,
        msg.blob,
        msg.sourceMetadata,
        () => !cancelledBatchRequestIds.has(requestId),
        msg.maxDimension,
      )
      const wasCancelled = cancelledBatchRequestIds.delete(requestId)
      const transfer: Transferable[] = []
      const entries: Array<{ timestamp: number; bitmap: ImageBitmap }> = []
      for (const [ts, bitmap] of bitmaps) {
        if (wasCancelled) {
          bitmap.close()
          continue
        }
        entries.push({ timestamp: ts, bitmap })
        transfer.push(bitmap)
      }
      self.postMessage(
        { type: 'batch_preseek_done', id: msg.id, success: !wasCancelled, entries },
        { transfer },
      )
    } catch (error) {
      cancelledBatchRequestIds.delete(String(msg.id))
      self.postMessage({
        type: 'batch_preseek_done',
        id: msg.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }

  if (msg.type !== 'preseek' && msg.type !== 'active_preseek') return

  const isActivePreviewRequest = msg.type === 'active_preseek'
  if (isActivePreviewRequest) {
    activePreviewGenerationBySrc.set(
      msg.src,
      Math.max(activePreviewGenerationBySrc.get(msg.src) ?? 0, Number(msg.generation) || 0),
    )
  }

  // Accept inline keyframe data on first preseek for a source
  if (msg.keyframeTimestamps && !keyframeIndexBySrc.has(msg.src)) {
    keyframeIndexBySrc.set(msg.src, msg.keyframeTimestamps)
  }

  try {
    const decodeStartedAt = performance.now()
    const bitmap = await preseek(
      msg.src,
      msg.timestamp,
      msg.blob,
      msg.sourceMetadata,
      isActivePreviewRequest
        ? () => activePreviewGenerationBySrc.get(msg.src) === Number(msg.generation)
        : undefined,
    )
    if (isActivePreviewRequest) {
      self.postMessage({
        type: 'debug',
        step: 'active_decode_complete',
        ms: performance.now() - decodeStartedAt,
      })
    }
    if (bitmap) {
      self.postMessage(
        { type: 'preseek_done', id: msg.id, success: true, timestamp: msg.timestamp, bitmap },
        { transfer: [bitmap] },
      )
    } else {
      self.postMessage({
        type: 'preseek_done',
        id: msg.id,
        success: false,
        timestamp: msg.timestamp,
      })
    }
  } catch (error) {
    self.postMessage({
      type: 'preseek_done',
      id: msg.id,
      success: false,
      timestamp: msg.timestamp,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
