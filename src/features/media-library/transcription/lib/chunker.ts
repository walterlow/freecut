import type { PCMChunk } from '../types';

const SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 30;
const SAMPLES_PER_CHUNK = SAMPLE_RATE * CHUNK_SECONDS;

export class Chunker {
  private readonly emit: (chunk: PCMChunk) => void;
  private readonly buffered: Float32Array[] = [];
  private bufferedLength = 0;
  private emittedSamples = 0;

  constructor(emit: (chunk: PCMChunk) => void) {
    this.emit = emit;
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }

    this.buffered.push(samples);
    this.bufferedLength += samples.length;

    while (this.bufferedLength >= SAMPLES_PER_CHUNK) {
      this.emitChunk(this.takeSamples(SAMPLES_PER_CHUNK), false);
    }
  }

  flush(): void {
    if (this.bufferedLength > 0) {
      this.emitChunk(this.takeSamples(this.bufferedLength), true);
      return;
    }

    this.emit({
      samples: new Float32Array(0),
      timestamp: this.emittedSamples / SAMPLE_RATE,
      final: true,
    });
  }

  private emitChunk(samples: Float32Array, final: boolean): void {
    const timestamp = this.emittedSamples / SAMPLE_RATE;
    this.emittedSamples += samples.length;
    this.emit({ samples, timestamp, final });
  }

  private takeSamples(targetLength: number): Float32Array {
    const out = new Float32Array(targetLength);
    let offset = 0;

    while (offset < targetLength && this.buffered.length > 0) {
      const next = this.buffered[0];
      if (!next) {
        break;
      }

      const remaining = targetLength - offset;
      const take = Math.min(remaining, next.length);
      out.set(next.subarray(0, take), offset);
      offset += take;

      if (take === next.length) {
        this.buffered.shift();
      } else {
        this.buffered[0] = next.subarray(take);
      }

      this.bufferedLength -= take;
    }

    return out;
  }
}
