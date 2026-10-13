/**
 * Preview Audio Decode Cache
 *
 * Caches decoded AudioBuffers for custom-decoded audio tracks so that
 * split clips from the same source share a single decode.
 *
 * Storage: Decoded audio is persisted to workspace-backed files in 10-second bins
 * (Int16 @ 22050 Hz stereo ~ 0.84 MB/bin). This avoids large single
 * records and allows progressive persistence during decode.
 *
 * On refresh, bins are loaded from the workspace cache in parallel and
 * reassembled into an AudioBuffer with no re-decode needed.
 *
 * Surround (5.1/7.1) sources are downmixed to stereo during decode
 * to keep memory reasonable.
 */

import { createLogger } from '@/shared/logging/logger'
import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import {
  getObjectUrlBlob,
  getObjectUrlSourceMetadata,
  type ObjectUrlSourceMetadata,
} from '@/infrastructure/browser/object-url-registry'
import {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
  getMedia,
} from '@/infrastructure/storage'
import { getWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import { createManagedWorker, type ManagedWorker } from '@/shared/utils/managed-worker'
import type { DecodedPreviewAudioMeta, DecodedPreviewAudioBin } from '@/types/storage'
import {
  isPreviewAudioConformed,
  persistPreviewAudioConform,
  persistPreviewAudioConformFromInt16,
} from './preview-audio-conform'
import {
  buildDownsampledStereo,
  downmixToStereo,
  int16ToFloat32Into,
  produceDecodedBin,
  type DecodedAudioBinData,
} from './audio-decode-dsp'
import type { AudioDecodeWorkerResponse } from './audio-decode-worker.types'

const log = createLogger('PreviewAudioCache')
export type PreviewAudioSource = string | Blob

const cache = new Map<string, AudioBuffer>()
const playbackSliceCache = new Map<string, PlaybackAudioSlice>()
const pendingDecodes = new Map<string, Promise<AudioBuffer>>()
const pendingPlaybackSliceDecodes = new Map<
  string,
  {
    requestedStartTime: number
    requestedCoverageEndTime: number
    promise: Promise<PlaybackAudioSlice>
  }
>()
/** LRU access order — most recently accessed at the end. */
const accessOrder: string[] = []

/** Max audio cache memory budget in bytes (~200MB). */
const MAX_CACHE_BYTES = 200 * 1024 * 1024
let currentCacheBytes = 0

function estimateBufferBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * 4 // Float32 = 4 bytes per sample
}

function touchCacheEntry(mediaId: string): void {
  const idx = accessOrder.indexOf(mediaId)
  if (idx >= 0) accessOrder.splice(idx, 1)
  accessOrder.push(mediaId)
}

function evictIfNeeded(): void {
  while (currentCacheBytes > MAX_CACHE_BYTES && accessOrder.length > 0) {
    const evictId = accessOrder.shift()!
    const buffer = cache.get(evictId)
    if (buffer) {
      currentCacheBytes -= estimateBufferBytes(buffer)
      cache.delete(evictId)
      log.debug('LRU evicted audio cache entry', {
        mediaId: evictId,
        freedMB: (estimateBufferBytes(buffer) / (1024 * 1024)).toFixed(1),
      })
    }
  }
}
const DEFAULT_PLAYABLE_PARTIAL_READY_SECONDS = 2
const PLAYABLE_PARTIAL_PREROLL_SECONDS = 0.25
const STARTUP_PLAYABLE_PARTIAL_READY_SECONDS = 1
const PENDING_PLAYBACK_SLICE_REUSE_HEADROOM_SECONDS = 1

/** Sample rate for persisted preview-audio bins; 22050 Hz is sufficient for preview. */
const STORAGE_SAMPLE_RATE = 22050

/** Bin duration in seconds for chunked persisted storage. */
const BIN_DURATION_SEC = 10

export interface PlaybackAudioSlice {
  buffer: AudioBuffer
  startTime: number
  isComplete: boolean
}

type AudioWindowDecodeMode = 'targeted' | 'sequential'

interface DecodeAudioSampleData {
  numberOfFrames?: number
  numberOfChannels?: number
  sampleRate?: number
  timestamp?: number
  duration?: number
  copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void
  close: () => void
}

function extractDecodeSampleStereoChunk(sample: DecodeAudioSampleData): {
  left: Float32Array
  right: Float32Array
  frameCount: number
} | null {
  const frameCount = Math.max(0, sample.numberOfFrames ?? 0)
  const channelCount = Math.max(1, sample.numberOfChannels ?? 1)
  if (frameCount === 0) {
    return null
  }

  const channels: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) {
    const channelData = new Float32Array(frameCount)
    sample.copyTo(channelData, { planeIndex: c, format: 'f32-planar' })
    channels.push(channelData)
  }
  const { left, right } = downmixToStereo(channels, frameCount)
  return { left, right, frameCount }
}

function getDecodeSampleEndTime(sample: DecodeAudioSampleData): number | null {
  if (
    !Number.isFinite(sample.timestamp) ||
    !Number.isFinite(sample.duration) ||
    Number(sample.duration) <= 0
  ) {
    return null
  }
  return Number(sample.timestamp) + Number(sample.duration)
}

function getPlaybackSliceCoverageEnd(slice: PlaybackAudioSlice): number {
  return slice.startTime + slice.buffer.duration
}

function playbackSliceCoversTarget(
  slice: PlaybackAudioSlice,
  targetTimeSeconds: number,
  minReadySeconds: number,
): boolean {
  return (
    targetTimeSeconds >= slice.startTime - 0.05 &&
    getPlaybackSliceCoverageEnd(slice) >= targetTimeSeconds + minReadySeconds - 0.05
  )
}

function pendingPlaybackSliceCoversTarget(
  request: {
    requestedStartTime: number
    requestedCoverageEndTime: number
  },
  targetTimeSeconds: number,
  minReadySeconds: number,
): boolean {
  const reusableHeadroomSeconds = Math.min(
    minReadySeconds,
    PENDING_PLAYBACK_SLICE_REUSE_HEADROOM_SECONDS,
  )

  return (
    request.requestedStartTime <= targetTimeSeconds + 0.05 &&
    request.requestedCoverageEndTime >= targetTimeSeconds + reusableHeadroomSeconds - 0.05
  )
}

function rememberPlaybackSlice(mediaId: string, slice: PlaybackAudioSlice): void {
  if (slice.isComplete) {
    playbackSliceCache.delete(mediaId)
    return
  }

  const existing = playbackSliceCache.get(mediaId)
  if (!existing) {
    playbackSliceCache.set(mediaId, slice)
    return
  }

  const existingCoverageEnd = getPlaybackSliceCoverageEnd(existing)
  const nextCoverageEnd = getPlaybackSliceCoverageEnd(slice)
  if (nextCoverageEnd > existingCoverageEnd + 0.05 || slice.startTime < existing.startTime - 0.05) {
    playbackSliceCache.set(mediaId, slice)
  }
}

// ---------------------------------------------------------------------------
// Bin key helpers
// ---------------------------------------------------------------------------

function binKey(mediaId: string, binIndex: number): string {
  return `${mediaId}:bin:${binIndex}`
}

function createInputSource(mb: Awaited<typeof import('mediabunny')>, src: PreviewAudioSource) {
  return createMediabunnyInputSource(mb, src)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a cached AudioBuffer or decode one via mediabunny.
 * Checks: memory cache -> persisted bins -> decode (persists bins progressively).
 * Concurrent calls for the same mediaId share a single promise.
 */
function ensureDecodeStarted(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  const pending = pendingDecodes.get(mediaId)
  if (pending) return pending

  const promise = loadOrDecodeAudio(mediaId, src)
    .then((buffer) => {
      cache.set(mediaId, buffer)
      playbackSliceCache.delete(mediaId)
      currentCacheBytes += estimateBufferBytes(buffer)
      touchCacheEntry(mediaId)
      evictIfNeeded()
      return buffer
    })
    .finally(() => {
      pendingDecodes.delete(mediaId)
    })

  pendingDecodes.set(mediaId, promise)
  return promise
}

export async function getOrDecodeAudio(
  mediaId: string,
  src: PreviewAudioSource,
): Promise<AudioBuffer> {
  const cached = cache.get(mediaId)
  if (cached) {
    touchCacheEntry(mediaId)
    return cached
  }
  return ensureDecodeStarted(mediaId, src)
}

export async function startPreviewAudioConform(
  mediaId: string,
  src: PreviewAudioSource,
): Promise<void> {
  // Bail before the decode/AudioBuffer rebuild when the conform asset already
  // exists. Otherwise every time the clip scrolls back into view we pay the
  // full `loadFromBins` Int16→Float32 reconstruction (~hundreds of ms, on the
  // main thread) just to feed a WAV that is already persisted.
  if (await isPreviewAudioConformed(mediaId)) {
    return
  }
  const buffer = await ensureDecodeStarted(mediaId, src)
  await persistPreviewAudioConform(mediaId, buffer)
}

export async function startPreviewAudioStartupWarm(
  mediaId: string,
  src: PreviewAudioSource,
  options?: {
    targetTimeSeconds?: number
    minReadySeconds?: number
  },
): Promise<void> {
  await getOrDecodeAudioSliceForPlayback(mediaId, src, {
    targetTimeSeconds: Math.max(0, options?.targetTimeSeconds ?? 0),
    minReadySeconds: Math.max(
      0.25,
      options?.minReadySeconds ?? STARTUP_PLAYABLE_PARTIAL_READY_SECONDS,
    ),
    waitTimeoutMs: 0,
  })
}

/** Returns true when a full decode/rebuild is currently in progress. */
export function isPreviewAudioDecodePending(mediaId: string): boolean {
  return pendingDecodes.has(mediaId)
}

async function loadPartialFromBins(
  mediaId: string,
  targetTimeSeconds: number,
  minReadySeconds: number,
  preRollSeconds: number,
): Promise<PlaybackAudioSlice | null> {
  const metaRecord = await getDecodedPreviewAudio(mediaId)
  let storedSampleRate =
    metaRecord &&
    'kind' in metaRecord &&
    metaRecord.kind === 'meta' &&
    Number.isFinite(metaRecord.sampleRate) &&
    metaRecord.sampleRate > 0
      ? metaRecord.sampleRate
      : 0
  const binDurationSec =
    metaRecord &&
    'kind' in metaRecord &&
    metaRecord.kind === 'meta' &&
    Number.isFinite(metaRecord.binDurationSec) &&
    metaRecord.binDurationSec > 0
      ? metaRecord.binDurationSec
      : BIN_DURATION_SEC
  const requestedStartTime = Math.max(0, targetTimeSeconds - preRollSeconds)
  const requestedCoverageEndTime = targetTimeSeconds + minReadySeconds
  const startBinIndex = Math.max(0, Math.floor(requestedStartTime / binDurationSec))
  const bins: DecodedPreviewAudioBin[] = []
  let totalFrames = 0
  const sliceStartTime = startBinIndex * binDurationSec
  let coverageEndTime = sliceStartTime
  // Load contiguous bins around the requested target until we cover the
  // desired playback headroom or hit a gap in persisted decode bins.
  for (let i = startBinIndex; i < startBinIndex + 512; i++) {
    const record = await getDecodedPreviewAudio(binKey(mediaId, i))
    if (!(record && 'kind' in record && record.kind === 'bin')) {
      break
    }
    const bin = record as DecodedPreviewAudioBin
    if (bin.binIndex !== i || bin.frames <= 0) {
      break
    }
    // Derive sample rate from first bin when meta is unavailable.
    if (
      storedSampleRate <= 0 &&
      bin.sampleRate &&
      Number.isFinite(bin.sampleRate) &&
      bin.sampleRate > 0
    ) {
      storedSampleRate = bin.sampleRate
    }
    bins.push(bin)
    totalFrames += bin.frames
    if (storedSampleRate > 0) {
      coverageEndTime = sliceStartTime + totalFrames / storedSampleRate
    }
    if (coverageEndTime >= requestedCoverageEndTime - 0.05) {
      break
    }
  }
  if (storedSampleRate <= 0) {
    storedSampleRate = STORAGE_SAMPLE_RATE
  }
  if (bins.length === 0 || totalFrames <= 0) {
    return null
  }
  const offlineCtx = new OfflineAudioContext(2, totalFrames, storedSampleRate)
  const buffer = offlineCtx.createBuffer(2, totalFrames, storedSampleRate)
  const leftChannel = buffer.getChannelData(0)
  const rightChannel = buffer.getChannelData(1)
  let offset = 0
  for (const bin of bins) {
    const left = new Int16Array(bin.left)
    const right = new Int16Array(bin.right)
    const frames = Math.min(bin.frames, left.length, right.length)
    if (frames <= 0) continue
    int16ToFloat32Into(left.subarray(0, frames), leftChannel, offset)
    int16ToFloat32Into(right.subarray(0, frames), rightChannel, offset)
    offset += frames
  }
  if (offset <= 0) {
    return null
  }
  return {
    buffer,
    startTime: sliceStartTime,
    isComplete: false,
  }
}
async function decodeAudioWindow(
  mediaId: string,
  src: PreviewAudioSource,
  startTime: number,
  durationSeconds: number,
  mode: AudioWindowDecodeMode = 'targeted',
  ac3RetryAttempted: boolean = false,
): Promise<PlaybackAudioSlice> {
  const shouldRegisterAc3 = ac3RetryAttempted || (await shouldPreRegisterAc3Decoder(mediaId))

  try {
    if (shouldRegisterAc3) {
      await ensureAc3DecoderRegistered()
    }

    const mb = await import('mediabunny')
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createInputSource(mb, src),
    })

    try {
      const audioTrack = await input.getPrimaryAudioTrack()
      if (!audioTrack) {
        throw new Error(`No audio track found for media ${mediaId}`)
      }

      const safeStartTime = Math.max(0, startTime)
      const targetCoverageEndTime = safeStartTime + Math.max(0.5, durationSeconds)
      // Use AudioSampleSink here as well as in the proven full-decode path.
      // AudioBufferSink can fail for custom codecs even after their decoder is
      // registered, which used to turn a small playback-window request into a
      // slow full decode and leave transport advancing without audio.
      const sink = new mb.AudioSampleSink(audioTrack)

      let sliceStartTime: number | null = null
      let coverageEndTime = safeStartTime
      let sampleRate = 48000
      let totalFrames = 0
      const leftChunks: Float32Array[] = []
      const rightChunks: Float32Array[] = []
      const seenBufferKeys = new Set<string>()

      const appendSample = (sample: DecodeAudioSampleData) => {
        const chunk = extractDecodeSampleStereoChunk(sample)
        if (!chunk) {
          return
        }

        const timestamp = Number.isFinite(sample.timestamp)
          ? Number(sample.timestamp)
          : coverageEndTime
        const duration =
          Number.isFinite(sample.duration) && Number(sample.duration) > 0
            ? Number(sample.duration)
            : chunk.frameCount / Math.max(1, sample.sampleRate ?? sampleRate)

        const dedupeKey = `${timestamp}:${duration}`
        if (seenBufferKeys.has(dedupeKey)) {
          return
        }
        seenBufferKeys.add(dedupeKey)

        if (sliceStartTime === null) {
          sliceStartTime = timestamp
        }
        coverageEndTime = Math.max(coverageEndTime, timestamp + duration)
        if (sample.sampleRate && sample.sampleRate > 0) {
          sampleRate = sample.sampleRate
        }

        leftChunks.push(chunk.left)
        rightChunks.push(chunk.right)
        totalFrames += chunk.frameCount
      }

      if (mode === 'sequential') {
        // A custom decoder may support only forward decoding from the start.
        // Discard early samples and retain chunks only for the requested window.
        for await (const sample of sink.samples() as AsyncIterable<DecodeAudioSampleData>) {
          try {
            const sampleStartTime = Number.isFinite(sample.timestamp)
              ? Number(sample.timestamp)
              : null
            const sampleEndTime = getDecodeSampleEndTime(sample)
            if (sampleEndTime !== null && sampleEndTime <= safeStartTime) {
              continue
            }
            if (sampleStartTime !== null && sampleStartTime >= targetCoverageEndTime) {
              break
            }
            appendSample(sample)
          } finally {
            sample.close()
          }
          if (coverageEndTime >= targetCoverageEndTime) {
            break
          }
        }
      } else {
        const initialSample = (await sink.getSample(safeStartTime)) as DecodeAudioSampleData | null
        let initialSampleEndTime: number | null = null
        if (initialSample) {
          try {
            appendSample(initialSample)
            initialSampleEndTime = getDecodeSampleEndTime(initialSample)
          } finally {
            initialSample.close()
          }
        }

        const iteratorStartTime =
          initialSampleEndTime === null
            ? safeStartTime
            : Math.max(safeStartTime, initialSampleEndTime)
        if (coverageEndTime < targetCoverageEndTime) {
          for await (const sample of sink.samples(
            iteratorStartTime,
            targetCoverageEndTime,
          ) as AsyncIterable<DecodeAudioSampleData>) {
            try {
              appendSample(sample)
            } finally {
              sample.close()
            }
            if (coverageEndTime >= targetCoverageEndTime) {
              break
            }
          }
        }
      }

      if (totalFrames <= 0 || sliceStartTime === null) {
        throw new Error(`Audio window decode produced no output for media ${mediaId}`)
      }

      const buffer = await buildPreviewStereoBuffer(
        leftChunks,
        rightChunks,
        totalFrames,
        sampleRate,
      )
      return {
        buffer,
        startTime: sliceStartTime,
        isComplete: false,
      }
    } finally {
      input.dispose()
    }
  } catch (err) {
    if (!ac3RetryAttempted && !shouldRegisterAc3) {
      try {
        return await decodeAudioWindow(mediaId, src, startTime, durationSeconds, mode, true)
      } catch {
        // Keep original error as primary failure.
      }
    }
    throw err
  }
}

/**
 * Playback-first helper for custom-decoded audio:
 * returns a bounded buffer around the requested playback position. This path
 * deliberately never starts a whole-file decode: callers retain the returned
 * AudioBuffer, so a long source would otherwise defeat the shared cache budget.
 */
export async function getOrDecodeAudioSliceForPlayback(
  mediaId: string,
  src: PreviewAudioSource,
  options?: {
    minReadySeconds?: number
    /** @deprecated Retained for call-site compatibility; window decoding no longer escalates. */
    waitTimeoutMs?: number
    targetTimeSeconds?: number
    preRollSeconds?: number
  },
): Promise<PlaybackAudioSlice> {
  const cached = cache.get(mediaId)
  if (cached) {
    touchCacheEntry(mediaId)
    return {
      buffer: cached,
      startTime: 0,
      isComplete: true,
    }
  }

  const minReadySeconds = Math.max(
    1,
    options?.minReadySeconds ?? DEFAULT_PLAYABLE_PARTIAL_READY_SECONDS,
  )
  const targetTimeSeconds = Math.max(0, options?.targetTimeSeconds ?? 0)
  const preRollSeconds = Math.max(0, options?.preRollSeconds ?? PLAYABLE_PARTIAL_PREROLL_SECONDS)

  const cachedPlaybackSlice = playbackSliceCache.get(mediaId)
  if (
    cachedPlaybackSlice &&
    playbackSliceCoversTarget(cachedPlaybackSlice, targetTimeSeconds, minReadySeconds)
  ) {
    return cachedPlaybackSlice
  }

  const pendingPlaybackSlice = pendingPlaybackSliceDecodes.get(mediaId)
  if (
    pendingPlaybackSlice &&
    pendingPlaybackSliceCoversTarget(pendingPlaybackSlice, targetTimeSeconds, minReadySeconds)
  ) {
    return pendingPlaybackSlice.promise
  }

  const partialStartTime = Math.max(0, targetTimeSeconds - preRollSeconds)
  const partialDurationSeconds = minReadySeconds + preRollSeconds
  const requiredCoverageEnd = targetTimeSeconds + minReadySeconds
  const partialPromise = (async (): Promise<PlaybackAudioSlice> => {
    // If bins are already present from a previous run/decode, use them immediately
    // only when they cover the current target plus enough headroom to keep
    // playback continuous. Returning a slice that merely contains the current
    // position can strand the preview path at the tail of the rebuilt bins.
    const immediatePartial = await loadPartialFromBins(
      mediaId,
      targetTimeSeconds,
      minReadySeconds,
      preRollSeconds,
    )
    if (
      immediatePartial &&
      playbackSliceCoversTarget(immediatePartial, targetTimeSeconds, minReadySeconds)
    ) {
      rememberPlaybackSlice(mediaId, immediatePartial)
      return immediatePartial
    }

    try {
      const slice = await decodeAudioWindowPreferWorker(
        mediaId,
        src,
        partialStartTime,
        partialDurationSeconds,
      )
      rememberPlaybackSlice(mediaId, slice)
      return slice
    } catch (windowError) {
      log.warn('Targeted preview audio window decode failed, retrying sequentially', {
        mediaId,
        targetTimeSeconds,
        error: windowError,
      })
      try {
        const slice = await decodeAudioWindowPreferWorker(
          mediaId,
          src,
          partialStartTime,
          partialDurationSeconds,
          'sequential',
        )
        rememberPlaybackSlice(mediaId, slice)
        return slice
      } catch (sequentialError) {
        log.warn('Sequential preview audio window decode failed', {
          mediaId,
          targetTimeSeconds,
          targetedError: windowError,
          error: sequentialError,
        })
        throw sequentialError
      }
    }
  })()

  pendingPlaybackSliceDecodes.set(mediaId, {
    requestedStartTime: partialStartTime,
    requestedCoverageEndTime: requiredCoverageEnd,
    promise: partialPromise,
  })

  try {
    return await partialPromise
  } finally {
    const pendingSlice = pendingPlaybackSliceDecodes.get(mediaId)
    if (pendingSlice?.promise === partialPromise) {
      pendingPlaybackSliceDecodes.delete(mediaId)
    }
  }
}

/** Clear all cached preview audio buffers (call on project unload). */
export function clearPreviewAudioCache(): void {
  cache.clear()
  playbackSliceCache.clear()
  pendingPlaybackSliceDecodes.clear()
  accessOrder.length = 0
  currentCacheBytes = 0
  log.debug('Preview audio cache cleared')
}

// ---------------------------------------------------------------------------
// Off-thread full decode (worker)
// ---------------------------------------------------------------------------

// Two lanes so a foreground playback-window decode is never stuck behind a slow
// background full decode on the same worker thread.
let audioDecodeWorkerManager: ManagedWorker | null = null
let audioWindowWorkerManager: ManagedWorker | null = null
let audioDecodeRequestCounter = 0

function canUseAudioDecodeWorker(): boolean {
  return typeof Worker !== 'undefined'
}

function createAudioDecodeWorker(): Worker {
  return new Worker(new URL('./audio-decode-worker.ts', import.meta.url), { type: 'module' })
}

/** Background lane for full decodes. */
function getAudioDecodeWorker(): Worker {
  if (!audioDecodeWorkerManager) {
    audioDecodeWorkerManager = createManagedWorker({ createWorker: createAudioDecodeWorker })
  }
  return audioDecodeWorkerManager.getWorker()
}

/** Foreground lane for latency-sensitive playback-window decodes. */
function getAudioWindowWorker(): Worker {
  if (!audioWindowWorkerManager) {
    audioWindowWorkerManager = createManagedWorker({ createWorker: createAudioDecodeWorker })
  }
  return audioWindowWorkerManager.getWorker()
}

/**
 * Resolve a preview-audio source into a form the worker can use. Blobs cross the
 * worker boundary directly; object-URL strings carry along their registry
 * metadata (file handle / fallback blob) so the worker can stream from disk.
 */
function prepareWorkerSource(src: PreviewAudioSource): {
  src: string | Blob
  sourceMetadata: ObjectUrlSourceMetadata | null
  fallbackBlob: Blob | null
} {
  if (src instanceof Blob) {
    return { src, sourceMetadata: null, fallbackBlob: null }
  }
  return {
    src,
    sourceMetadata: getObjectUrlSourceMetadata(src),
    fallbackBlob: getObjectUrlBlob(src),
  }
}

function decodeFullAudioViaWorker(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const worker = getAudioDecodeWorker()
    const requestId = `audio-decode-${++audioDecodeRequestCounter}`
    // When the worker is handed the workspace root it persists bins itself, so
    // the main thread only accumulates them for AudioBuffer assembly.
    const workspaceRoot = getWorkspaceRoot()
    const workerPersistsBins = workspaceRoot !== null
    const persistedBins: DecodedAudioBinData[] = []
    const persistPromises: Array<Promise<void>> = []

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent<AudioDecodeWorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) {
        return
      }

      if (message.type === 'bin') {
        const bin: DecodedAudioBinData = {
          binIndex: message.binIndex,
          frames: message.frames,
          sampleRate: message.sampleRate,
          left: new Int16Array(message.left),
          right: new Int16Array(message.right),
        }
        persistedBins.push(bin)
        if (!workerPersistsBins) {
          persistPromises.push(
            saveDecodedBin(mediaId, bin).catch((err) => {
              log.warn('Failed to persist decoded audio bin from worker', {
                mediaId,
                binIndex: bin.binIndex,
                err,
              })
            }),
          )
        }
      } else if (message.type === 'complete') {
        cleanup()
        const totalBins = message.totalBins
        void Promise.all(persistPromises).then(() => {
          try {
            resolve(finalizeDecodedAudio(mediaId, persistedBins, totalBins))
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      } else if (message.type === 'error') {
        cleanup()
        reject(new Error(message.error))
      }
    }

    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(event.error instanceof Error ? event.error : new Error('Audio decode worker error'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    const prepared = prepareWorkerSource(src)
    worker.postMessage({
      type: 'decode',
      requestId,
      mediaId,
      src: prepared.src,
      sourceMetadata: prepared.sourceMetadata,
      fallbackBlob: prepared.fallbackBlob,
      binDurationSec: BIN_DURATION_SEC,
      storageSampleRate: STORAGE_SAMPLE_RATE,
      workspaceRoot,
    })
  })
}

interface AssembleBinInput {
  frames: number
  left: ArrayBuffer
  right: ArrayBuffer
}

/**
 * Reassemble persisted Int16 bins into Float32 stereo channels on the decode
 * worker so the (potentially ~second-long) dequant loop stays off the main
 * thread. Bin buffers are copied (not transferred) so the caller can fall back
 * to the synchronous main-thread path if the worker errors.
 */
function assembleBinsViaWorker(
  totalFrames: number,
  bins: AssembleBinInput[],
): Promise<{ left: Float32Array; right: Float32Array }> {
  return new Promise((resolve, reject) => {
    const worker = getAudioDecodeWorker()
    const requestId = `audio-assemble-${++audioDecodeRequestCounter}`

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent<AudioDecodeWorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) return

      if (message.type === 'assembled') {
        cleanup()
        resolve({ left: new Float32Array(message.left), right: new Float32Array(message.right) })
      } else if (message.type === 'error') {
        cleanup()
        reject(new Error(message.error))
      }
    }

    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(event.error instanceof Error ? event.error : new Error('Audio assemble worker error'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    worker.postMessage({ type: 'assemble-bins', requestId, totalFrames, bins })
  })
}

function decodeAudioWindowViaWorker(
  mediaId: string,
  src: PreviewAudioSource,
  startTime: number,
  durationSeconds: number,
  mode: AudioWindowDecodeMode = 'targeted',
): Promise<PlaybackAudioSlice> {
  return new Promise<PlaybackAudioSlice>((resolve, reject) => {
    const worker = getAudioWindowWorker()
    const requestId = `audio-window-${++audioDecodeRequestCounter}`

    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent<AudioDecodeWorkerResponse>) => {
      const message = event.data
      if (message.requestId !== requestId) {
        return
      }

      if (message.type === 'window') {
        cleanup()
        try {
          const ctx = new OfflineAudioContext(2, message.frames, message.sampleRate)
          const buffer = ctx.createBuffer(2, message.frames, message.sampleRate)
          buffer.getChannelData(0).set(new Float32Array(message.left))
          buffer.getChannelData(1).set(new Float32Array(message.right))
          resolve({ buffer, startTime: message.startTime, isComplete: false })
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      } else if (message.type === 'error') {
        cleanup()
        reject(new Error(message.error))
      }
    }

    const onError = (event: ErrorEvent) => {
      cleanup()
      reject(event.error instanceof Error ? event.error : new Error('Audio window worker error'))
    }

    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    const prepared = prepareWorkerSource(src)
    worker.postMessage({
      type: 'decode-window',
      requestId,
      mediaId,
      src: prepared.src,
      sourceMetadata: prepared.sourceMetadata,
      fallbackBlob: prepared.fallbackBlob,
      startTime,
      durationSeconds,
      storageSampleRate: STORAGE_SAMPLE_RATE,
      mode,
    })
  })
}

/** Prefer an off-thread window decode; fall back to the main thread on failure. */
async function decodeAudioWindowPreferWorker(
  mediaId: string,
  src: PreviewAudioSource,
  startTime: number,
  durationSeconds: number,
  mode: AudioWindowDecodeMode = 'targeted',
): Promise<PlaybackAudioSlice> {
  if (canUseAudioDecodeWorker()) {
    try {
      return await decodeAudioWindowViaWorker(mediaId, src, startTime, durationSeconds, mode)
    } catch (err) {
      log.warn('Worker window decode failed, falling back to main-thread window decode', {
        mediaId,
        mode,
        err,
      })
    }
  }
  return decodeAudioWindow(mediaId, src, startTime, durationSeconds, mode)
}

// ---------------------------------------------------------------------------
// Load from persisted bins
// ---------------------------------------------------------------------------

async function loadOrDecodeAudio(mediaId: string, src: PreviewAudioSource): Promise<AudioBuffer> {
  // Try persisted workspace cache
  try {
    const cached = await getDecodedPreviewAudio(mediaId)
    if (cached && 'kind' in cached && cached.kind === 'meta') {
      try {
        return await loadFromBins(cached as DecodedPreviewAudioMeta)
      } catch (err) {
        log.warn('Cached decoded audio is incomplete/invalid, re-decoding', { mediaId, err })
        await deleteDecodedPreviewAudio(mediaId).catch(() => undefined)
      }
    } else if (cached) {
      // Legacy single-record cache format - remove and re-decode.
      await deleteDecodedPreviewAudio(mediaId).catch(() => undefined)
    }
  } catch (err) {
    log.warn('Failed to load persisted decoded audio, will decode', { mediaId, err })
  }

  // Full decode with progressive bin persistence. Prefer the worker so the
  // decode + DSP stays off the main thread; fall back to a main-thread decode
  // when workers are unavailable (e.g. tests) or the worker errors.
  if (canUseAudioDecodeWorker()) {
    try {
      return await decodeFullAudioViaWorker(mediaId, src)
    } catch (err) {
      log.warn('Worker audio decode failed, falling back to main-thread decode', { mediaId, err })
    }
  }
  return decodeFullAudio(mediaId, src)
}

async function loadFromBins(meta: DecodedPreviewAudioMeta): Promise<AudioBuffer> {
  const { mediaId, sampleRate, totalFrames, binCount } = meta

  if (
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(totalFrames) ||
    totalFrames <= 0 ||
    binCount <= 0
  ) {
    throw new Error('Invalid decoded preview audio meta')
  }

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate)
  const buffer = offlineCtx.createBuffer(2, totalFrames, sampleRate)
  const leftChannel = buffer.getChannelData(0)
  const rightChannel = buffer.getChannelData(1)

  // Load all bins in parallel
  const binPromises = Array.from({ length: binCount }, (_, i) =>
    getDecodedPreviewAudio(binKey(mediaId, i)),
  )
  const bins = await Promise.all(binPromises)

  let offset = 0
  const validatedBins: AssembleBinInput[] = []
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i]
    if (!(bin && 'kind' in bin && bin.kind === 'bin')) {
      throw new Error(`Missing decoded audio bin ${i}`)
    }

    const b = bin as DecodedPreviewAudioBin
    if (b.frames <= 0) {
      throw new Error(`Invalid frame count in decoded audio bin ${i}`)
    }
    if (b.left.byteLength / 2 !== b.frames || b.right.byteLength / 2 !== b.frames) {
      throw new Error(`Corrupt decoded audio bin ${i}`)
    }
    if (offset + b.frames > totalFrames) {
      throw new Error(`Decoded audio bins exceed expected frame length (${mediaId})`)
    }

    validatedBins.push({ frames: b.frames, left: b.left, right: b.right })
    offset += b.frames
  }

  if (offset !== totalFrames) {
    throw new Error(`Decoded audio bins incomplete: ${offset}/${totalFrames} frames`)
  }

  // Reassemble off the main thread when possible — the Int16→Float32 dequant is
  // O(totalFrames) and blocks the main thread for ~hundreds of ms on long clips.
  // Falls back to the synchronous loop when the worker is unavailable or errors.
  let assembledViaWorker = false
  if (canUseAudioDecodeWorker()) {
    try {
      const assembled = await assembleBinsViaWorker(totalFrames, validatedBins)
      leftChannel.set(assembled.left)
      rightChannel.set(assembled.right)
      assembledViaWorker = true
    } catch (err) {
      log.warn('Worker bin assembly failed, falling back to main-thread assembly', {
        mediaId,
        err,
      })
    }
  }

  if (!assembledViaWorker) {
    let writeOffset = 0
    for (const b of validatedBins) {
      int16ToFloat32Into(new Int16Array(b.left), leftChannel, writeOffset)
      int16ToFloat32Into(new Int16Array(b.right), rightChannel, writeOffset)
      writeOffset += b.frames
    }
  }

  log.info('Loaded decoded audio from workspace cache', {
    mediaId,
    binCount,
    sampleRate,
    duration: buffer.duration.toFixed(2),
    sizeMB: ((totalFrames * 2 * 2) / (1024 * 1024)).toFixed(1),
  })

  return buffer
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildPreviewStereoBuffer(
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  totalFrames: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const ds = buildDownsampledStereo(
    leftChunks,
    rightChunks,
    totalFrames,
    sampleRate,
    STORAGE_SAMPLE_RATE,
  )
  const ctx = new OfflineAudioContext(2, ds.frames, ds.sampleRate)
  const buffer = ctx.createBuffer(2, ds.frames, ds.sampleRate)
  buffer.getChannelData(0).set(ds.left)
  buffer.getChannelData(1).set(ds.right)
  return buffer
}

async function saveDecodedBin(mediaId: string, bin: DecodedAudioBinData): Promise<void> {
  await saveDecodedPreviewAudio({
    id: binKey(mediaId, bin.binIndex),
    mediaId,
    kind: 'bin',
    binIndex: bin.binIndex,
    left: bin.left.buffer as ArrayBuffer,
    right: bin.right.buffer as ArrayBuffer,
    frames: bin.frames,
    sampleRate: bin.sampleRate,
    createdAt: Date.now(),
  })
}

/**
 * Downsample, convert to Int16, and persist one bin to workspace-backed storage.
 * Returns persisted Int16 data so playback can be assembled without
 * retaining a massive full-resolution decode in memory.
 */
async function persistBin(
  mediaId: string,
  binIdx: number,
  leftChunks: Float32Array[],
  rightChunks: Float32Array[],
  frames: number,
  sampleRate: number,
): Promise<DecodedAudioBinData> {
  const bin = produceDecodedBin(
    binIdx,
    leftChunks,
    rightChunks,
    frames,
    sampleRate,
    STORAGE_SAMPLE_RATE,
  )
  await saveDecodedBin(mediaId, bin)
  return bin
}

/**
 * Assemble persisted Int16 bins into a playback AudioBuffer, then fire-and-forget
 * the WAV conform asset and the decode-complete meta marker. Shared by the
 * main-thread and worker decode paths so their output stays identical.
 */
function finalizeDecodedAudio(
  mediaId: string,
  persistedBins: DecodedAudioBinData[],
  totalBins: number,
): AudioBuffer {
  persistedBins.sort((a, b) => a.binIndex - b.binIndex)

  const storedTotalFrames = persistedBins.reduce((sum, b) => sum + b.frames, 0)
  if (persistedBins.length === 0 || storedTotalFrames === 0) {
    throw new Error(`Audio decode produced no output for media ${mediaId}`)
  }

  const storedSampleRate = persistedBins[0]?.sampleRate ?? STORAGE_SAMPLE_RATE
  const outCtx = new OfflineAudioContext(2, storedTotalFrames, storedSampleRate)
  const combined = outCtx.createBuffer(2, storedTotalFrames, storedSampleRate)
  const outLeft = combined.getChannelData(0)
  const outRight = combined.getChannelData(1)

  // Assemble the playback float buffer and a planar Int16 copy in one pass. The
  // Int16 copy feeds the conform WAV directly, avoiding a redundant
  // Float32→Int16 re-quantization of the whole buffer.
  const wavLeft = new Int16Array(storedTotalFrames)
  const wavRight = new Int16Array(storedTotalFrames)
  let offset = 0
  for (const bin of persistedBins) {
    int16ToFloat32Into(bin.left, outLeft, offset)
    int16ToFloat32Into(bin.right, outRight, offset)
    wavLeft.set(bin.left, offset)
    wavRight.set(bin.right, offset)
    offset += bin.frames
  }
  if (offset !== storedTotalFrames) {
    throw new Error(`Decoded audio assembly mismatch: ${offset}/${storedTotalFrames} frames`)
  }

  log.info('Audio decoded for preview', {
    mediaId,
    sampleRate: storedSampleRate,
    duration: combined.duration.toFixed(2),
    bins: totalBins,
    sizeMB: ((storedTotalFrames * 2 * 2) / (1024 * 1024)).toFixed(1),
  })

  void persistPreviewAudioConformFromInt16(mediaId, wavLeft, wavRight, storedSampleRate)

  // Save meta last as the decode-complete marker.
  void saveDecodedPreviewAudio({
    id: mediaId,
    mediaId,
    kind: 'meta',
    sampleRate: storedSampleRate,
    totalFrames: storedTotalFrames,
    binCount: totalBins,
    binDurationSec: BIN_DURATION_SEC,
    createdAt: Date.now(),
  })
    .then(() => {
      log.info('All bins persisted to workspace cache', { mediaId, binCount: totalBins })
    })
    .catch((err) => {
      log.warn('Failed to persist bins to workspace cache', { mediaId, err })
    })

  return combined
}

// ---------------------------------------------------------------------------
// Full decode with progressive bin persistence
// ---------------------------------------------------------------------------

async function shouldPreRegisterAc3Decoder(mediaId: string): Promise<boolean> {
  try {
    const media = await getMedia(mediaId)
    if (!media) return false

    const codec = media.mimeType.startsWith('audio/') ? media.codec : media.audioCodec
    return isAc3AudioCodec(codec)
  } catch (err) {
    log.debug('Failed to load media metadata for AC-3 decoder pre-check', { mediaId, err })
    return false
  }
}

async function decodeFullAudio(
  mediaId: string,
  src: PreviewAudioSource,
  ac3RetryAttempted: boolean = false,
): Promise<AudioBuffer> {
  log.info('Decoding audio for preview', {
    mediaId,
    src:
      typeof src === 'string'
        ? src.substring(0, 50)
        : `[blob:${src.type || 'application/octet-stream'} size=${src.size}]`,
  })
  const shouldRegisterAc3 = ac3RetryAttempted || (await shouldPreRegisterAc3Decoder(mediaId))

  try {
    if (shouldRegisterAc3) {
      await ensureAc3DecoderRegistered()
    }

    const mb = await import('mediabunny')
    const input = new mb.Input({
      formats: mb.ALL_FORMATS,
      source: createInputSource(mb, src),
    })
    const audioTrack = await input.getPrimaryAudioTrack()
    try {
      if (!audioTrack) {
        throw new Error(`No audio track found for media ${mediaId}`)
      }

      const sink = new mb.AudioSampleSink(audioTrack)

      let sampleRate = 48000

      // Per-bin accumulation for progressive persistence
      let binLeftChunks: Float32Array[] = []
      let binRightChunks: Float32Array[] = []
      let binAccumFrames = 0
      let binIndex = 0
      const binFlushPromises: Array<Promise<DecodedAudioBinData>> = []

      for await (const sample of sink.samples()) {
        try {
          const sampleData = sample as DecodeAudioSampleData
          const chunk = extractDecodeSampleStereoChunk(sampleData)
          if (!chunk) {
            continue
          }
          if (sampleData.sampleRate && sampleData.sampleRate > 0) {
            sampleRate = sampleData.sampleRate
          }

          // Accumulate for current bin
          binLeftChunks.push(chunk.left)
          binRightChunks.push(chunk.right)
          binAccumFrames += chunk.frameCount

          // Flush bin when it reaches the target duration
          const binFramesAtSource = BIN_DURATION_SEC * sampleRate
          if (binAccumFrames >= binFramesAtSource) {
            binFlushPromises.push(
              persistBin(
                mediaId,
                binIndex,
                binLeftChunks,
                binRightChunks,
                binAccumFrames,
                sampleRate,
              ),
            )
            binIndex++
            binLeftChunks = []
            binRightChunks = []
            binAccumFrames = 0
          }
        } finally {
          sample.close()
        }
      }

      // Flush final partial bin
      if (binAccumFrames > 0) {
        binFlushPromises.push(
          persistBin(mediaId, binIndex, binLeftChunks, binRightChunks, binAccumFrames, sampleRate),
        )
        binIndex++
      }

      // Wait for all bins and assemble playback buffer from downsampled bins.
      const totalBins = binIndex
      const persistedBins = await Promise.all(binFlushPromises)
      return finalizeDecodedAudio(mediaId, persistedBins, totalBins)
    } finally {
      input.dispose()
    }
  } catch (err) {
    if (!ac3RetryAttempted && !shouldRegisterAc3) {
      try {
        return await decodeFullAudio(mediaId, src, true)
      } catch {
        // Keep original decode error as the primary failure signal.
      }
    }
    throw err
  }
}
