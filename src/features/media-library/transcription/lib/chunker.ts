import type { PCMChunk } from '../types'

const SAMPLE_RATE = 16_000
const CHUNK_SECONDS = 30
const OVERLAP_SECONDS = 5
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS
const OVERLAP_SAMPLES = SAMPLE_RATE * OVERLAP_SECONDS
const ADVANCE_SAMPLES = SAMPLES_PER_CHUNK - OVERLAP_SAMPLES

export class Chunker {
  private readonly emit: (chunk: PCMChunk) => void
  private readonly buffered: Float32Array[] = []
  private bufferedLength = 0
  private emittedSamples = 0

  constructor(emit: (chunk: PCMChunk) => void) {
    this.emit = emit
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) {
      return
    }

    this.buffered.push(samples)
    this.bufferedLength += samples.length

    while (this.bufferedLength >= SAMPLES_PER_CHUNK) {
      this.emitChunk(this.copySamples(SAMPLES_PER_CHUNK), false, ADVANCE_SAMPLES)
    }
  }

  flush(): void {
    if (this.bufferedLength > 0) {
      if (this.emittedSamples > 0 && this.bufferedLength <= OVERLAP_SAMPLES) {
        this.dropSamples(this.bufferedLength)
        this.emit({
          samples: new Float32Array(0),
          timestamp: this.emittedSamples / SAMPLE_RATE,
          final: true,
        })
        return
      }

      this.emitChunk(this.copySamples(this.bufferedLength), true, this.bufferedLength)
      return
    }

    this.emit({
      samples: new Float32Array(0),
      timestamp: this.emittedSamples / SAMPLE_RATE,
      final: true,
    })
  }

  private emitChunk(samples: Float32Array, final: boolean, advanceSamples: number): void {
    const timestamp = this.emittedSamples / SAMPLE_RATE
    this.dropSamples(advanceSamples)
    this.emittedSamples += advanceSamples
    this.emit({ samples, timestamp, final })
  }

  private copySamples(targetLength: number): Float32Array {
    const out = new Float32Array(targetLength)
    let offset = 0
    let bufferIndex = 0
    let sourceOffset = 0

    while (offset < targetLength && bufferIndex < this.buffered.length) {
      const next = this.buffered[bufferIndex]
      if (!next) {
        break
      }

      const remaining = targetLength - offset
      const available = next.length - sourceOffset
      const take = Math.min(remaining, available)
      out.set(next.subarray(sourceOffset, sourceOffset + take), offset)
      offset += take

      if (take === available) {
        bufferIndex += 1
        sourceOffset = 0
      } else {
        sourceOffset += take
      }
    }

    return out
  }

  private dropSamples(targetLength: number): void {
    let remaining = targetLength

    while (remaining > 0 && this.buffered.length > 0) {
      const next = this.buffered[0]
      if (!next) {
        break
      }

      const take = Math.min(remaining, next.length)

      if (take === next.length) {
        this.buffered.shift()
      } else {
        this.buffered[0] = next.subarray(take)
      }

      this.bufferedLength -= take
      remaining -= take
    }
  }
}
