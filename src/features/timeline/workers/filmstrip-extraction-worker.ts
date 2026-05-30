/**
 * Filmstrip Extraction Worker
 *
 * Extracts video frames using mediabunny's CanvasSink.
 * All heavy decode and JPEG encode work happens in the worker; the
 * main thread persists the resulting blobs into the workspace.
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import type { ObjectUrlSourceMetadata } from '@/infrastructure/browser/object-url-registry'
const IMAGE_FORMAT = 'image/jpeg'
const IMAGE_QUALITY = 0.7 // JPEG is substantially faster to encode for tiny thumbnails
const FRAME_RATE = 1 // 1fps for filmstrip thumbnails

// Message types
export interface ExtractRequest {
  type: 'extract'
  requestId: string
  mediaId: string
  blobUrl: string
  blob?: Blob
  sourceMetadata?: ObjectUrlSourceMetadata
  duration: number
  width: number
  height: number
  skipIndices?: number[] // Indices to skip (already extracted)
  priorityIndices?: number[] // Indices to extract first (within the assigned range)
  targetIndices?: number[] // Optional explicit extraction indices for this worker
  // For parallel extraction - each worker handles a range
  startIndex?: number // Start frame index (inclusive)
  endIndex?: number // End frame index (exclusive)
  totalFrames?: number // Total frames across all workers (for progress)
  workerId?: number // Worker identifier for debugging
  maxParallelSaves?: number // Reserved for future worker-local throttling
}

export interface AbortRequest {
  type: 'abort'
  requestId: string
}

export interface WarmRequest {
  type: 'warm'
  requestId: string
}

export interface WarmedResponse {
  type: 'warmed'
  requestId: string
}

export interface ProgressResponse {
  type: 'progress'
  requestId: string
  frameIndex: number
  frameCount: number
  progress: number
  savedFrames: Array<{
    index: number
    blob: Blob
  }>
  savedIndices: number[]
  /** Transferable ImageBitmaps for instant display (no JPEG encode/decode roundtrip) */
  bitmapFrames?: Array<{
    index: number
    bitmap: ImageBitmap
  }>
}

export interface CompleteResponse {
  type: 'complete'
  requestId: string
  frameCount: number
  unavailableIndices?: number[]
}

export interface ErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type WorkerRequest = ExtractRequest | AbortRequest | WarmRequest
export type WorkerResponse = ProgressResponse | CompleteResponse | ErrorResponse | WarmedResponse

// Track active requests for abort support
const activeRequests = new Map<string, { aborted: boolean }>()

function getRequestIdFromMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return 'unknown'
  const maybe = data as { requestId?: unknown }
  return typeof maybe.requestId === 'string' ? maybe.requestId : 'unknown'
}

// Dynamically import mediabunny
const loadMediabunny = () => import('mediabunny')

/**
 * Extract frames and return encoded JPEG blobs to the main thread.
 */
async function extractAndSave(request: ExtractRequest, state: { aborted: boolean }): Promise<void> {
  const {
    requestId,
    blobUrl,
    blob,
    sourceMetadata,
    duration,
    width,
    height,
    skipIndices,
    priorityIndices,
    targetIndices,
    startIndex,
    endIndex,
    totalFrames: totalFramesOverride,
  } = request

  // Calculate frame range - support both full extraction and chunked
  const allFrames = Math.ceil(duration * FRAME_RATE)
  const rangeStart = startIndex ?? 0
  const rangeEnd = endIndex ?? allFrames
  const totalFrames = totalFramesOverride ?? allFrames
  const skipSet = new Set(skipIndices || [])
  const prioritySet = new Set(priorityIndices || [])

  // Build extraction order: requested priority window first, then background remainder.
  const framesToExtract: { index: number; timestamp: number }[] = []

  const hasExplicitTargets = Array.isArray(targetIndices) && targetIndices.length > 0
  const explicitTargets = hasExplicitTargets
    ? targetIndices.filter((index) => index >= rangeStart && index < rangeEnd).sort((a, b) => a - b)
    : []
  const targetSet = new Set(explicitTargets)
  const initialCompletedCount = hasExplicitTargets
    ? explicitTargets.reduce((count, index) => (skipSet.has(index) ? count + 1 : count), 0)
    : Array.from(skipSet).reduce(
        (count, index) => (index >= rangeStart && index < rangeEnd ? count + 1 : count),
        0,
      )

  for (const index of prioritySet) {
    const inRange = index >= rangeStart && index < rangeEnd
    const inTarget = !hasExplicitTargets || targetSet.has(index)
    if (inRange && inTarget && !skipSet.has(index)) {
      framesToExtract.push({ index, timestamp: index / FRAME_RATE })
    }
  }

  if (hasExplicitTargets) {
    for (const index of explicitTargets) {
      if (!skipSet.has(index) && !prioritySet.has(index)) {
        framesToExtract.push({ index, timestamp: index / FRAME_RATE })
      }
    }
  } else {
    for (let i = rangeStart; i < rangeEnd; i++) {
      if (!skipSet.has(i) && !prioritySet.has(i)) {
        framesToExtract.push({ index: i, timestamp: i / FRAME_RATE })
      }
    }
  }

  // If nothing to extract, we're done
  if (framesToExtract.length === 0) {
    self.postMessage({
      type: 'complete',
      requestId,
      frameCount: initialCompletedCount,
    } as CompleteResponse)
    return
  }

  // Load mediabunny
  const { Input, CanvasSink, ALL_FORMATS } = await loadMediabunny()

  let input: InstanceType<typeof Input> | null = null
  let sink: InstanceType<typeof CanvasSink> | null = null

  try {
    // Create input from blob URL
    input = new Input({
      source: createMediabunnyInputSource(await loadMediabunny(), blobUrl, {
        metadata: sourceMetadata,
        fallbackBlob: blob,
      }),
      formats: ALL_FORMATS,
    })

    // Get primary video track
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) {
      throw new Error('No video track found')
    }

    // Create CanvasSink with poolSize matching our parallel save capacity
    // This keeps VRAM constant and prevents allocation/deallocation churn
    sink = new CanvasSink(videoTrack, {
      width,
      height,
      fit: 'cover',
      poolSize: 4, // Reduced for 1fps extraction
    })

    // Track extracted frames
    let extractedCount = initialCompletedCount
    let frameListIndex = 0
    let savedSinceLastReport: Array<{ index: number; blob: Blob }> = []
    const unavailableIndices: number[] = []

    // Generator for timestamps
    async function* timestampGenerator(): AsyncGenerator<number> {
      for (const frame of framesToExtract) {
        if (state.aborted) return
        yield frame.timestamp
      }
    }

    // Two parallel pipelines per frame:
    // 1. FAST: createImageBitmap -> transfer to main thread (instant display, no encode)
    // 2. SLOW: convertToBlob (JPEG) -> send blob to main thread for persistence
    //
    // Bitmaps are sent immediately on every decoded frame for instant UI updates.
    // JPEG encode runs concurrently, with blobs reported as soon as they are ready.
    let pendingEncode: Promise<{ blob: Blob; frameIndex: number }> | null = null
    let bitmapsSinceLastReport: Array<{ index: number; bitmap: ImageBitmap }> = []

    const flushPendingEncode = async () => {
      if (!pendingEncode) return
      const { blob, frameIndex } = await pendingEncode
      pendingEncode = null
      savedSinceLastReport.push({ index: frameIndex, blob })
    }

    for await (const wrapped of sink.canvasesAtTimestamps(timestampGenerator())) {
      if (state.aborted) break

      const frame = framesToExtract[frameListIndex]
      if (!frame) break

      // Skip if no frame available for this timestamp (mediabunny returns null)
      if (!wrapped) {
        unavailableIndices.push(frame.index)
        frameListIndex++
        continue
      }

      const canvas = wrapped.canvas as OffscreenCanvas
      const frameIndex = frame.index

      // Single bitmap path: copy pool canvas into a fresh OffscreenCanvas,
      // then use that one canvas as both the source for the display bitmap
      // and the source for the JPEG encode. The pool canvas slot is free
      // immediately after drawImage so the next decode can advance.
      const encodeCanvas = new OffscreenCanvas(canvas.width, canvas.height)
      const encodeCtx = encodeCanvas.getContext('2d')!
      encodeCtx.drawImage(canvas, 0, 0)

      // Flush prior encode, then queue display + encode against the new canvas.
      await flushPendingEncode()
      const displayBitmap = await createImageBitmap(encodeCanvas)
      bitmapsSinceLastReport.push({ index: frameIndex, bitmap: displayBitmap })

      pendingEncode = encodeCanvas
        .convertToBlob({
          type: IMAGE_FORMAT,
          quality: IMAGE_QUALITY,
        })
        .then((blob) => ({ blob, frameIndex }))

      extractedCount++
      frameListIndex++

      // Send progress with bitmaps on every frame for instant display.
      // savedFrames/savedIndices lag behind as JPEG encode completes.
      const shouldReport =
        extractedCount <= 3 || extractedCount % 10 === 0 || bitmapsSinceLastReport.length > 0
      if (shouldReport) {
        const progress = Math.round((extractedCount / totalFrames) * 100)
        const savedFrames = savedSinceLastReport
        savedSinceLastReport = []
        const savedIndices = savedFrames.map((entry) => entry.index)
        const bitmapFrames = bitmapsSinceLastReport
        bitmapsSinceLastReport = []

        // Transfer bitmaps to main thread (zero-copy via transferable)
        const transferables = bitmapFrames.map((bf) => bf.bitmap)
        self.postMessage(
          {
            type: 'progress',
            requestId,
            frameIndex,
            frameCount: extractedCount,
            progress: Math.min(progress, 99),
            savedFrames,
            savedIndices,
            bitmapFrames,
          } as ProgressResponse,
          { transfer: transferables as unknown as Transferable[] },
        )
      }
    }

    // Flush the last pipelined encode
    await flushPendingEncode()

    // Emit any saved frames that completed after the final progress report.
    if (savedSinceLastReport.length > 0) {
      const progress = Math.round((extractedCount / totalFrames) * 100)
      const savedFrames = savedSinceLastReport
      const savedIndices = savedFrames.map((entry) => entry.index)
      self.postMessage({
        type: 'progress',
        requestId,
        frameIndex: framesToExtract[Math.max(0, frameListIndex - 1)]?.index ?? rangeStart,
        frameCount: extractedCount,
        progress: Math.min(progress, 99),
        savedFrames,
        savedIndices,
      } as ProgressResponse)
      savedSinceLastReport = []
    }

    // Main thread is responsible for writing final "isComplete=true" metadata once
    // all workers finish to avoid cross-worker completion races.
    if (!state.aborted) {
      self.postMessage({
        type: 'complete',
        requestId,
        frameCount: extractedCount,
        unavailableIndices,
      } as CompleteResponse)
    }
  } finally {
    // Clean up mediabunny resources to free memory
    ;(sink as unknown as { dispose?: () => void } | null)?.dispose?.()
    input?.dispose()
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type } = event.data

  try {
    switch (type) {
      case 'extract': {
        const request = event.data as ExtractRequest
        const { requestId } = request

        const state = { aborted: false }
        activeRequests.set(requestId, state)

        try {
          await extractAndSave(request, state)
        } finally {
          activeRequests.delete(requestId)
        }
        break
      }

      case 'abort': {
        const { requestId } = event.data as AbortRequest
        const state = activeRequests.get(requestId)
        if (state) {
          state.aborted = true
        }
        break
      }

      case 'warm': {
        // Eagerly load mediabunny so the first real extraction skips ~100-300ms
        // of dynamic-import + parse cost. The module is cached in the worker
        // realm for subsequent extractAndSave() calls.
        const { requestId } = event.data as WarmRequest
        await loadMediabunny()
        self.postMessage({ type: 'warmed', requestId } as WarmedResponse)
        break
      }

      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  } catch (error) {
    const requestId = getRequestIdFromMessage(event.data)
    self.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    } as ErrorResponse)
  }
}

export {}
