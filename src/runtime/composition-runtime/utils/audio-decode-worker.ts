/**
 * Audio Decode Worker
 *
 * Runs the expensive full-audio decode off the main thread: mediabunny decode →
 * downmix to stereo → downsample → Int16. Decoded bins are streamed back as
 * transferable Int16 PCM so the main thread only has to persist them and wrap
 * the assembled result in an AudioBuffer (a cheap memcpy).
 *
 * AudioBuffer / OfflineAudioContext are unavailable in workers, so all DSP runs
 * on plain TypedArrays via the shared audio-decode-dsp module.
 */

import { createMediabunnyInputSource } from '@/infrastructure/browser/mediabunny-input-source'
import { writeDecodedPreviewAudioToRoot } from '@/infrastructure/storage/workspace-fs/decoded-preview-audio'
import { createLogger } from '@/shared/logging/logger'
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/utils/ac3-decoder'
import {
  buildDownsampledStereo,
  downmixToStereo,
  int16ToFloat32Into,
  produceDecodedBin,
  type DecodedAudioBinData,
} from './audio-decode-dsp'
import type {
  AudioAssembleBinsRequest,
  AudioAssembledResponse,
  AudioDecodeBinResponse,
  AudioDecodeCompleteResponse,
  AudioDecodeErrorResponse,
  AudioDecodeWindowResponse,
  AudioDecodeWorkerMessage,
} from './audio-decode-worker.types'

const log = createLogger('AudioDecodeWorker')

interface DecodeSampleData {
  numberOfFrames?: number
  numberOfChannels?: number
  sampleRate?: number
  timestamp?: number
  duration?: number
  copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void
  close: () => void
}

function extractStereoChunk(sample: DecodeSampleData): {
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

async function persistBinToWorkspace(
  root: FileSystemDirectoryHandle,
  mediaId: string,
  bin: DecodedAudioBinData,
): Promise<void> {
  await writeDecodedPreviewAudioToRoot(root, {
    id: `${mediaId}:bin:${bin.binIndex}`,
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

async function decode(
  message: Extract<AudioDecodeWorkerMessage, { type: 'decode' }>,
): Promise<void> {
  const {
    requestId,
    mediaId,
    src,
    sourceMetadata,
    fallbackBlob,
    binDurationSec,
    storageSampleRate,
    workspaceRoot,
  } = message

  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: createMediabunnyInputSource(mb, src, {
      metadata: sourceMetadata ?? null,
      fallbackBlob: fallbackBlob ?? null,
    }),
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) {
      throw new Error(`No audio track found for media ${mediaId}`)
    }

    const audioCodec = typeof audioTrack.codec === 'string' ? audioTrack.codec : undefined
    if (isAc3AudioCodec(audioCodec)) {
      await ensureAc3DecoderRegistered()
    }

    const sink = new mb.AudioSampleSink(audioTrack)

    let sampleRate = 48000
    let binLeftChunks: Float32Array[] = []
    let binRightChunks: Float32Array[] = []
    let binAccumFrames = 0
    let binIndex = 0

    // Persist the bin (when we own the workspace handle) BEFORE transferring its
    // buffers to the main thread — transfer neuters the ArrayBuffers, so the
    // write must read them first.
    const flushBin = async () => {
      const bin = produceDecodedBin(
        binIndex,
        binLeftChunks,
        binRightChunks,
        binAccumFrames,
        sampleRate,
        storageSampleRate,
      )
      binIndex++
      binLeftChunks = []
      binRightChunks = []
      binAccumFrames = 0

      if (workspaceRoot) {
        await persistBinToWorkspace(workspaceRoot, mediaId, bin)
      }

      const response: AudioDecodeBinResponse = {
        type: 'bin',
        requestId,
        binIndex: bin.binIndex,
        frames: bin.frames,
        sampleRate: bin.sampleRate,
        left: bin.left.buffer as ArrayBuffer,
        right: bin.right.buffer as ArrayBuffer,
      }
      self.postMessage(response, { transfer: [response.left, response.right] })
    }

    for await (const sample of sink.samples() as AsyncIterable<DecodeSampleData>) {
      try {
        if (sample.sampleRate && sample.sampleRate > 0) {
          sampleRate = sample.sampleRate
        }

        const chunk = extractStereoChunk(sample)
        if (!chunk) {
          continue
        }

        binLeftChunks.push(chunk.left)
        binRightChunks.push(chunk.right)
        binAccumFrames += chunk.frameCount

        const binFramesAtSource = binDurationSec * sampleRate
        if (binAccumFrames >= binFramesAtSource) {
          await flushBin()
        }
      } finally {
        sample.close()
      }
    }

    if (binAccumFrames > 0) {
      await flushBin()
    }

    const complete: AudioDecodeCompleteResponse = {
      type: 'complete',
      requestId,
      totalBins: binIndex,
    }
    self.postMessage(complete)
  } finally {
    input.dispose()
  }
}

/**
 * Decode a single playback window for fast preview start. Mirrors the
 * main-thread decodeAudioWindow but uses AudioSampleSink (AudioBuffer is not
 * available in workers) and returns Float32 stereo for direct playback.
 */
function getDecodeSampleEndTime(sample: DecodeSampleData): number | null {
  if (
    !Number.isFinite(sample.timestamp) ||
    !Number.isFinite(sample.duration) ||
    Number(sample.duration) <= 0
  ) {
    return null
  }
  return Number(sample.timestamp) + Number(sample.duration)
}

async function decodeWindow(
  message: Extract<AudioDecodeWorkerMessage, { type: 'decode-window' }>,
): Promise<void> {
  const {
    requestId,
    mediaId,
    src,
    sourceMetadata,
    fallbackBlob,
    startTime,
    durationSeconds,
    storageSampleRate,
    mode = 'targeted',
  } = message

  const mb = await import('mediabunny')
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: createMediabunnyInputSource(mb, src, {
      metadata: sourceMetadata ?? null,
      fallbackBlob: fallbackBlob ?? null,
    }),
  })

  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) {
      throw new Error(`No audio track found for media ${mediaId}`)
    }

    const audioCodec = typeof audioTrack.codec === 'string' ? audioTrack.codec : undefined
    if (isAc3AudioCodec(audioCodec)) {
      await ensureAc3DecoderRegistered()
    }

    const safeStartTime = Math.max(0, startTime)
    const targetCoverageEndTime = safeStartTime + Math.max(0.5, durationSeconds)
    const sink = new mb.AudioSampleSink(audioTrack)

    let sliceStartTime: number | null = null
    let coverageEndTime = safeStartTime
    let sampleRate = 48000
    let totalFrames = 0
    const leftChunks: Float32Array[] = []
    const rightChunks: Float32Array[] = []
    const seenSampleKeys = new Set<string>()

    const append = (sample: DecodeSampleData) => {
      const timestamp = Number.isFinite(sample.timestamp)
        ? (sample.timestamp as number)
        : coverageEndTime
      const duration = Number.isFinite(sample.duration) ? (sample.duration as number) : 0

      const dedupeKey = `${timestamp}:${duration}`
      if (seenSampleKeys.has(dedupeKey)) {
        return
      }
      const chunk = extractStereoChunk(sample)
      if (!chunk) {
        return
      }
      seenSampleKeys.add(dedupeKey)

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
      // Some custom decoders can only advance from the beginning. Decode and
      // discard early samples, retaining Float32 chunks only for this window.
      for await (const sample of sink.samples() as AsyncIterable<DecodeSampleData>) {
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
          append(sample)
        } finally {
          sample.close()
        }
        if (coverageEndTime >= targetCoverageEndTime) {
          break
        }
      }
    } else {
      const initialSample = (await sink.getSample(safeStartTime)) as DecodeSampleData | null
      let initialSampleEndTime: number | null = null
      if (initialSample) {
        try {
          append(initialSample)
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
        ) as AsyncIterable<DecodeSampleData>) {
          try {
            append(sample)
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

    const ds = buildDownsampledStereo(
      leftChunks,
      rightChunks,
      totalFrames,
      sampleRate,
      storageSampleRate,
    )
    const response: AudioDecodeWindowResponse = {
      type: 'window',
      requestId,
      startTime: sliceStartTime,
      frames: ds.frames,
      sampleRate: ds.sampleRate,
      left: ds.left.buffer as ArrayBuffer,
      right: ds.right.buffer as ArrayBuffer,
    }
    self.postMessage(response, { transfer: [response.left, response.right] })
  } finally {
    input.dispose()
  }
}

/** Reassemble persisted Int16 bins into Float32 stereo channels off-thread. */
function assembleBins(message: AudioAssembleBinsRequest): void {
  const { requestId, totalFrames, bins } = message
  const left = new Float32Array(totalFrames)
  const right = new Float32Array(totalFrames)

  let offset = 0
  for (const bin of bins) {
    int16ToFloat32Into(new Int16Array(bin.left), left, offset)
    int16ToFloat32Into(new Int16Array(bin.right), right, offset)
    offset += bin.frames
  }

  const response: AudioAssembledResponse = {
    type: 'assembled',
    requestId,
    frames: totalFrames,
    left: left.buffer as ArrayBuffer,
    right: right.buffer as ArrayBuffer,
  }
  self.postMessage(response, { transfer: [response.left, response.right] })
}

self.onmessage = async (event: MessageEvent<AudioDecodeWorkerMessage>) => {
  const message = event.data

  try {
    if (message.type === 'decode') {
      await decode(message)
    } else if (message.type === 'decode-window') {
      await decodeWindow(message)
    } else if (message.type === 'assemble-bins') {
      assembleBins(message)
    }
  } catch (err) {
    log.warn('Audio decode worker failed', {
      mediaId: 'mediaId' in message ? message.mediaId : undefined,
      type: message.type,
      err,
    })
    const response: AudioDecodeErrorResponse = {
      type: 'error',
      requestId: message.requestId,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(response)
  }
}

export {}
