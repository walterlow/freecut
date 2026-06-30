/**
 * Proxy Generation Worker
 *
 * Transcodes video to a 960x540-bounded proxy using mediabunny's Conversion API
 * and saves the result to OPFS. Used for preview playback optimization
 * — preview uses the proxy while export uses the original full-res source.
 *
 * Storage structure:
 *   proxies/{proxyKey}/
 *     proxy.mp4
 *     meta.json - { width, height, status, createdAt, version, sourceWidth, sourceHeight }
 */

import type { InputVideoTrack } from 'mediabunny'
import type { ProResFrameInfo } from '@/infrastructure/browser/prores-frame-header'
import {
  createProResSampleSink,
  detectProResTrack,
} from '@/infrastructure/browser/prores-sample-sink'
import { PROXY_DIR, PROXY_SCHEMA_VERSION } from '../proxy-constants'

type MediabunnyModule = typeof import('mediabunny')

/**
 * A unit of proxy work that writes to an output target. Implemented either by
 * mediabunny's `Conversion` (decodable codecs) or by a turbores decode→encode loop
 * (ProRes), so the surrounding generation envelope is shared by both.
 */
interface ProxyJob {
  readonly isValid: boolean
  readonly discardedTracks: ReadonlyArray<{ track: { type?: string | null }; reason: string }>
  execute(onProgress: (progress: number) => void): Promise<void>
  cancel(): Promise<void>
}

/**
 * Builds a proxy job that decodes a ProRes track via turbores and re-encodes it to the
 * H.264 proxy. Each decoded frame is drawn to a proxy-sized canvas (downscale) and fed
 * to a mediabunny `CanvasSource`. ProRes is all-intra, so frames decode in order with
 * no GOP handling.
 */
function buildProResProxyJob(
  mb: MediabunnyModule,
  output: InstanceType<MediabunnyModule['Output']>,
  input: InstanceType<MediabunnyModule['Input']>,
  videoTrack: InputVideoTrack,
  proResInfo: ProResFrameInfo,
  proxyDimensions: { width: number; height: number },
): ProxyJob {
  let cancelled = false
  return {
    isValid: true,
    discardedTracks: [],
    cancel: async () => {
      cancelled = true
    },
    async execute(onProgress) {
      const { width, height } = proxyDimensions
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('Failed to acquire 2D context for ProRes proxy generation')
      }
      const source = new mb.CanvasSource(canvas, {
        codec: 'avc',
        bitrate: mb.QUALITY_LOW,
        keyFrameInterval: PROXY_KEYFRAME_INTERVAL_SECONDS,
      })
      output.addVideoTrack(source)
      await output.start()

      const sink = createProResSampleSink(mb, videoTrack, proResInfo)
      const totalDuration = await input.computeDuration().catch(() => 0)
      try {
        for await (const sample of sink.samples()) {
          if (cancelled) {
            sample.close()
            break
          }
          // Draw scales the visible frame into the proxy box (AR-preserved dims).
          sample.draw(ctx, 0, 0, width, height)
          const timestamp = sample.timestamp
          await source.add(timestamp, sample.duration || 1 / 30)
          sample.close()
          if (totalDuration > 0) {
            onProgress(Math.min(1, timestamp / totalDuration))
          }
        }
        if (cancelled) {
          await output.cancel()
          return
        }
        await output.finalize()
      } finally {
        await sink.close()
      }
    },
  }
}

const PROXY_WIDTH = 960
const PROXY_HEIGHT = 540
const PROXY_STREAM_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
const PROXY_KEYFRAME_INTERVAL_SECONDS = 2

// Message types
export interface ProxyGenerateRequest {
  type: 'generate'
  mediaId: string // proxyKey (kept as mediaId for message compatibility)
  source?: Blob
  sourceOpfsPath?: string
  sourceMimeType?: string
  sourceWidth: number
  sourceHeight: number
}

export interface ProxyCancelRequest {
  type: 'cancel'
  mediaId: string // proxyKey (kept as mediaId for message compatibility)
}

export interface ProxyProgressResponse {
  type: 'progress'
  mediaId: string
  progress: number
}

export interface ProxyCompleteResponse {
  type: 'complete'
  mediaId: string
}

export interface ProxyErrorResponse {
  type: 'error'
  mediaId: string
  error: string
}

export interface ProxyCancelledResponse {
  type: 'cancelled'
  mediaId: string
}

export type ProxyWorkerRequest = ProxyGenerateRequest | ProxyCancelRequest
export type ProxyWorkerResponse =
  | ProxyProgressResponse
  | ProxyCompleteResponse
  | ProxyErrorResponse
  | ProxyCancelledResponse

// Track active conversions for cancel support
const activeConversions = new Map<string, { cancel: () => Promise<void> }>()

// Dynamically import mediabunny.
// Proxy generation discards source audio, so AC-3 decoder registration is not required.
const loadMediabunny = async () => import('mediabunny')

/**
 * Get or create OPFS directory for proxy storage
 */
async function getProxyDir(mediaId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  const proxyRoot = await root.getDirectoryHandle(PROXY_DIR, { create: true })
  return proxyRoot.getDirectoryHandle(mediaId, { create: true })
}

async function removeProxyDir(mediaId: string): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const proxyRoot = await root.getDirectoryHandle(PROXY_DIR, { create: true })
  await proxyRoot.removeEntry(mediaId, { recursive: true })
}

async function getSourceBlobFromOpfs(path: string, mimeType?: string): Promise<Blob> {
  const root = await navigator.storage.getDirectory()
  const parts = path.split('/').filter((part) => part)

  if (parts.length === 0) {
    throw new Error('Invalid OPFS source path')
  }

  let dir = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    if (!part) {
      continue
    }
    dir = await dir.getDirectoryHandle(part)
  }

  const fileName = parts[parts.length - 1]
  if (!fileName) {
    throw new Error('Invalid OPFS source path: missing filename')
  }

  const fileHandle = await dir.getFileHandle(fileName)
  const file = await fileHandle.getFile()
  if (!mimeType || file.type) {
    return file
  }

  return new Blob([file], { type: mimeType })
}

/**
 * Save proxy metadata to OPFS
 */
async function saveMetadata(
  dir: FileSystemDirectoryHandle,
  metadata: {
    version: number
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    status: string
    createdAt: number
  },
): Promise<void> {
  const fileHandle = await dir.getFileHandle('meta.json', { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(JSON.stringify(metadata))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    throw error
  }
}

function toEven(value: number): number {
  const rounded = Math.max(2, Math.floor(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

function calculateProxyDimensions(
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth)
  const safeSourceHeight = Math.max(1, sourceHeight)
  const scale = Math.min(PROXY_WIDTH / safeSourceWidth, PROXY_HEIGHT / safeSourceHeight, 1)

  const width = toEven(safeSourceWidth * scale)
  const height = toEven(safeSourceHeight * scale)

  return {
    width,
    height,
  }
}

/**
 * Generate a 960x540-bounded proxy video via mediabunny Conversion
 */
async function generateProxy(request: ProxyGenerateRequest): Promise<void> {
  const { mediaId, source, sourceOpfsPath, sourceMimeType, sourceWidth, sourceHeight } = request

  const mb = await loadMediabunny()
  const {
    Input,
    BlobSource,
    Output,
    Mp4OutputFormat,
    BufferTarget,
    StreamTarget,
    Conversion,
    QUALITY_LOW,
    MP4,
    QTFF,
    WEBM,
    MATROSKA,
  } = mb

  const dir = await getProxyDir(mediaId)
  const proxyDimensions = calculateProxyDimensions(sourceWidth, sourceHeight)
  const createdAt = Date.now()
  let input: InstanceType<typeof Input> | null = null
  const resolvedSource =
    source ?? (sourceOpfsPath ? await getSourceBlobFromOpfs(sourceOpfsPath, sourceMimeType) : null)

  if (!resolvedSource) {
    throw new Error('Proxy source unavailable')
  }

  // Save initial metadata
  await saveMetadata(dir, {
    version: PROXY_SCHEMA_VERSION,
    width: proxyDimensions.width,
    height: proxyDimensions.height,
    sourceWidth,
    sourceHeight,
    status: 'generating',
    createdAt,
  })

  input = new Input({
    source: new BlobSource(resolvedSource),
    formats: [MP4, QTFF, WEBM, MATROSKA],
  })

  // ProRes (and other codecs mediabunny can't decode via WebCodecs) must be decoded
  // through turbores instead of mediabunny's Conversion API.
  const videoTrack = await input.getPrimaryVideoTrack()
  let proResInfo: Awaited<ReturnType<typeof detectProResTrack>> = null
  if (videoTrack && typeof videoTrack.canDecode === 'function') {
    const decodable = await videoTrack.canDecode().catch(() => true)
    if (!decodable) {
      proResInfo = await detectProResTrack(mb, videoTrack)
    }
  }

  let job: ProxyJob | null = null
  let streamedToFile = false
  let bufferTarget: InstanceType<typeof BufferTarget> | null = null
  let writable: FileSystemWritableFileStream | undefined

  try {
    const buildJob = async (
      outputTarget: InstanceType<typeof StreamTarget> | InstanceType<typeof BufferTarget>,
      useInMemoryFastStart: boolean,
    ): Promise<ProxyJob> => {
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: useInMemoryFastStart ? 'in-memory' : false }),
        target: outputTarget,
      })

      if (proResInfo && videoTrack) {
        return buildProResProxyJob(mb, output, input!, videoTrack, proResInfo, proxyDimensions)
      }

      const conversion = await Conversion.init({
        input,
        output,
        video: {
          width: proxyDimensions.width,
          height: proxyDimensions.height,
          fit: 'contain',
          codec: 'avc',
          // Faster proxy generation preset.
          bitrate: QUALITY_LOW,
          hardwareAcceleration: 'prefer-hardware',
          // Keep seeks responsive without forcing every frame to be a keyframe.
          keyFrameInterval: PROXY_KEYFRAME_INTERVAL_SECONDS,
        },
        audio: {
          // Scrub proxy is video-only for faster generation and smaller files.
          discard: true,
        },
      })
      return {
        get isValid() {
          return conversion.isValid
        },
        get discardedTracks() {
          return conversion.discardedTracks
        },
        execute(onProgress) {
          conversion.onProgress = onProgress
          return conversion.execute()
        },
        cancel: () => conversion.cancel(),
      }
    }

    const fileHandle = await dir.getFileHandle('proxy.mp4', { create: true })
    try {
      writable = await fileHandle.createWritable()
      const streamTarget = new StreamTarget(writable, {
        chunked: true,
        chunkSize: PROXY_STREAM_CHUNK_SIZE_BYTES,
      })
      streamedToFile = true
      job = await buildJob(streamTarget, false)
    } catch {
      // Close leaked writable before falling back to buffer target.
      if (writable) {
        try {
          await writable.abort()
        } catch {
          /* best-effort cleanup */
        }
      }
      streamedToFile = false
      bufferTarget = new BufferTarget()
      job = await buildJob(bufferTarget, true)
    }

    if (!job.isValid) {
      const reasons = job.discardedTracks
        .map((d) => `${d.track.type ?? 'unknown'}: ${d.reason}`)
        .join('; ')
      throw new Error(`Proxy conversion invalid: ${reasons || 'no usable tracks'}`)
    }

    // Store cancel handle
    activeConversions.set(mediaId, {
      cancel: () => job!.cancel(),
    })

    try {
      await job.execute((progress: number) => {
        self.postMessage({
          type: 'progress',
          mediaId,
          progress,
        } as ProxyProgressResponse)
      })
    } catch (execError) {
      // If cancel() was invoked, activeConversions entry is already deleted.
      if (!activeConversions.has(mediaId)) {
        await removeProxyDir(mediaId).catch(() => undefined)
        self.postMessage({
          type: 'cancelled',
          mediaId,
        } as ProxyCancelledResponse)
        return
      }
      throw execError
    }

    // Check if cancelled during execution (resolved without throwing)
    if (!activeConversions.has(mediaId)) {
      await removeProxyDir(mediaId).catch(() => undefined)
      self.postMessage({
        type: 'cancelled',
        mediaId,
      } as ProxyCancelledResponse)
      return
    }

    if (!streamedToFile) {
      // Buffer fallback mode: flush conversion result to OPFS.
      const buffer = bufferTarget?.buffer
      if (!buffer) {
        throw new Error('Conversion produced no output buffer')
      }

      const bufferWritable = await fileHandle.createWritable()
      try {
        await bufferWritable.write(buffer)
        await bufferWritable.close()
      } catch (error) {
        await bufferWritable.abort().catch(() => undefined)
        throw error
      }
    }

    // Update metadata
    await saveMetadata(dir, {
      version: PROXY_SCHEMA_VERSION,
      width: proxyDimensions.width,
      height: proxyDimensions.height,
      sourceWidth,
      sourceHeight,
      status: 'ready',
      createdAt,
    })

    self.postMessage({
      type: 'complete',
      mediaId,
    } as ProxyCompleteResponse)
  } catch (error) {
    if (writable) {
      try {
        await writable.abort()
      } catch {
        // best-effort cleanup
      }
      writable = undefined
    }

    await dir.removeEntry('proxy.mp4').catch(() => undefined)
    await saveMetadata(dir, {
      version: PROXY_SCHEMA_VERSION,
      width: proxyDimensions.width,
      height: proxyDimensions.height,
      sourceWidth,
      sourceHeight,
      status: 'error',
      createdAt,
    }).catch(() => undefined)

    throw error
  } finally {
    activeConversions.delete(mediaId)
    if (writable) {
      try {
        await writable.abort()
      } catch {
        /* may already be closed/aborted */
      }
    }
    input?.dispose()
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<ProxyWorkerRequest>) => {
  const { type } = event.data

  try {
    switch (type) {
      case 'generate': {
        await generateProxy(event.data as ProxyGenerateRequest)
        break
      }

      case 'cancel': {
        const { mediaId } = event.data as ProxyCancelRequest
        const active = activeConversions.get(mediaId)
        if (active) {
          activeConversions.delete(mediaId)
          await active.cancel()
        }
        break
      }

      default:
        throw new Error(`Unknown message type: ${type}`)
    }
  } catch (error) {
    const mediaId = (event.data as ProxyGenerateRequest).mediaId
    self.postMessage({
      type: 'error',
      mediaId,
      error: error instanceof Error ? error.message : String(error),
    } as ProxyErrorResponse)
  }
}

export {}
