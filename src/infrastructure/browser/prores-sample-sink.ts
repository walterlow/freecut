/**
 * ProRes decode bridge: raw `EncodedPacketSink` packets → turbores → mediabunny
 * `VideoSample`s.
 *
 * mediabunny does not recognize ProRes as a decodable codec (see
 * {@link ./prores-frame-header}), so `VideoSampleSink`/`CanvasSink`/`Conversion`
 * silently discard ProRes tracks. This sink exposes the same `samples()` /
 * `samplesAtTimestamps()` surface those sinks provide, but decodes via turbores, so it
 * can be dropped into existing consumers (export frame extraction, proxy generation,
 * thumbnail/filmstrip workers) in place of a mediabunny sink.
 *
 * Native pixel format is preserved (no forced downconversion): turbores emits the
 * stream's native format (e.g. `I422P10` for 10-bit 4:2:2) and we tag the resulting
 * `VideoSample` with it plus the decoded color space, so downstream HDR handling has
 * full-fidelity data to work with. ProRes is all-intra, so every packet decodes
 * standalone — `getPacket(ts)` yields an exact, seekable frame for any timestamp.
 */

import type { EncodedPacket, InputVideoTrack, VideoSample } from 'mediabunny'
import type { Decoder, FilledFrame } from 'turbores'
import { createLogger } from '@/shared/logging/logger'
import { parseProResFrameHeader, type ProResFrameInfo } from './prores-frame-header'

type MediabunnyModule = typeof import('mediabunny')

const log = createLogger('ProResSampleSink')

export interface ProResSampleSink {
  /** Yields decoded samples in presentation order within [start, end). */
  samples(
    startTimestamp?: number,
    endTimestamp?: number,
  ): AsyncGenerator<VideoSample, void, unknown>
  /** Yields one sample per requested timestamp (or `null` if before the first frame). */
  samplesAtTimestamps(
    timestamps: Iterable<number> | AsyncIterable<number>,
  ): AsyncGenerator<VideoSample | null, void, unknown>
  /** Releases the turbores decoder and its workers. */
  close(): Promise<void>
}

/**
 * Inspects a track's first packet to determine whether it is ProRes that mediabunny
 * cannot decode natively. Returns the parsed frame info (used to pick the turbores
 * variant) or `null` when the track is not ProRes.
 */
export async function detectProResTrack(
  mb: MediabunnyModule,
  track: InputVideoTrack,
): Promise<ProResFrameInfo | null> {
  const packetSink = new mb.EncodedPacketSink(track)
  const first = await packetSink.getFirstPacket()
  if (!first?.data) {
    return null
  }
  return parseProResFrameHeader(first.data)
}

async function* toAsync<T>(iterable: Iterable<T> | AsyncIterable<T>): AsyncGenerator<T> {
  if (Symbol.asyncIterator in iterable) {
    yield* iterable as AsyncIterable<T>
  } else {
    yield* iterable as Iterable<T>
  }
}

/**
 * Creates a ProRes sample sink for the given track. `frameInfo` comes from
 * {@link detectProResTrack}; it determines the turbores decoder variant.
 */
export function createProResSampleSink(
  mb: MediabunnyModule,
  track: InputVideoTrack,
  frameInfo: ProResFrameInfo,
): ProResSampleSink {
  const packetSink = new mb.EncodedPacketSink(track)
  let decoderPromise: Promise<Decoder> | null = null

  const getDecoder = async (): Promise<Decoder> => {
    if (!decoderPromise) {
      decoderPromise = (async () => {
        const { Decoder } = await import('turbores')
        const useSharedMemory = Decoder.canUseSharedMemory()
        const created = await Decoder.create({
          proresFourCc: frameInfo.fourCc,
          useSharedMemory,
        })
        if (created instanceof Error) {
          throw created
        }
        log.debug('turbores decoder created', {
          fourCc: frameInfo.fourCc,
          chromaFormat: frameInfo.chromaFormat,
          useSharedMemory,
          concurrency: created.concurrency,
        })
        return created
      })()
    }
    return decoderPromise
  }

  const decodePacket = async (packet: EncodedPacket): Promise<VideoSample> => {
    const decoder = await getDecoder()
    const { Frame } = await import('turbores')
    const frame = new Frame()
    try {
      const result = await decoder.decode(packet.data, frame)
      if (result instanceof Error) {
        throw result
      }
      return buildVideoSample(mb, result, packet)
    } finally {
      // turbores reuses frame buffers across decodes; buildVideoSample has already
      // copied the pixel data out, so the frame can be released immediately.
      frame.clear()
    }
  }

  return {
    async *samples(startTimestamp = 0, endTimestamp?: number) {
      const startPacket =
        (await packetSink.getPacket(startTimestamp)) ?? (await packetSink.getFirstPacket())
      if (!startPacket) {
        return
      }
      for await (const packet of packetSink.packets(startPacket)) {
        if (endTimestamp != null && packet.timestamp >= endTimestamp) {
          return
        }
        yield await decodePacket(packet)
      }
    },

    async *samplesAtTimestamps(timestamps) {
      for await (const timestamp of toAsync(timestamps)) {
        const packet = await packetSink.getPacket(timestamp)
        if (!packet) {
          yield null
          continue
        }
        yield await decodePacket(packet)
      }
    },

    async close() {
      if (decoderPromise) {
        const decoder = await decoderPromise.catch(() => null)
        await decoder?.close()
      }
    },
  }
}

function buildVideoSample(
  mb: MediabunnyModule,
  frame: FilledFrame,
  packet: EncodedPacket,
): VideoSample {
  // Construct a WebCodecs VideoFrame from the raw planes and wrap it, rather than
  // building a VideoSample from the buffer directly. The browser's VideoFrame applies
  // the correct plane strides/offsets for the coded format (notably 10-bit 4:2:2,
  // where chroma planes are full coded-height); mediabunny's raw-buffer path
  // mishandles the coded-vs-visible padding and corrupts the top strip of the frame.
  //
  // Color: the VideoFrame is tagged with the source's full color space (BT.2020/HLG
  // for HDR). The browser's compositor then applies a proper color-managed HLG→SDR
  // conversion when the frame is drawn to an sRGB canvas — we deliberately do NOT
  // tone-map ourselves, which produced a worse (too-dark) result than the browser's.
  // VideoFrame timestamps are integer microseconds.
  const videoFrame = new VideoFrame(frame.frameData.slice(), {
    // turbores pixel-format strings are WebCodecs `VideoPixelFormat` compatible.
    format: frame.pixelFormat as VideoPixelFormat,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    // Coded dimensions are padded to multiples of 16; crop to the visible rect.
    visibleRect: { x: 0, y: 0, width: frame.visibleWidth, height: frame.visibleHeight },
    colorSpace: {
      primaries: frame.colorPrimariesString as VideoColorPrimaries | undefined,
      transfer: frame.colorTransferString as VideoTransferCharacteristics | undefined,
      matrix: frame.colorMatrixString as VideoMatrixCoefficients | undefined,
      fullRange: frame.colorRangeFull,
    },
    timestamp: Math.round(packet.timestamp * 1e6),
    duration: packet.duration ? Math.round(packet.duration * 1e6) : undefined,
  })
  return new mb.VideoSample(videoFrame)
}
