import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamingPlayback } from './streaming-playback';

class AudioBufferMock {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this.channels = Array.from(
      { length: options.numberOfChannels },
      () => new Float32Array(options.length),
    );
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    this.channels[channelNumber]?.set(source);
  }

  getChannelData(channelNumber: number): Float32Array {
    return this.channels[channelNumber]!;
  }
}

class MockWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly terminate = vi.fn();
  readonly postMessage = vi.fn();

  constructor() {
    queueMicrotask(() => {
      this.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
    });
  }

  dispatch(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

let createdWorkers: MockWorker[] = [];

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  createdWorkers = [];

  class WorkerStub extends MockWorker {
    constructor() {
      super();
      createdWorkers.push(this);
    }
  }

  vi.stubGlobal('Worker', WorkerStub as unknown as typeof Worker);
  vi.stubGlobal('AudioBuffer', AudioBufferMock as unknown as typeof AudioBuffer);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streaming playback audio transport', () => {
  it('buffers worker audio chunks and exposes them by playback window', async () => {
    const playback = createStreamingPlayback();
    playback.startStream('clip-a', 'https://example.com/clip-a.mp4', 1);
    await flushMicrotasks();

    const worker = createdWorkers[0]!;
    worker.dispatch({
      type: 'source_ready',
      streamKey: 'clip-a',
      src: 'https://example.com/clip-a.mp4',
      width: 1920,
      height: 1080,
      duration: 10,
      hasAudio: true,
    });

    worker.dispatch({
      type: 'audio_chunk',
      streamKey: 'clip-a',
      src: 'https://example.com/clip-a.mp4',
      timestamp: 1,
      duration: 0.5,
      sampleRate: 48000,
      frameCount: 4,
      numberOfChannels: 2,
      channelData: [
        new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer,
        new Float32Array([0.5, 0.6, 0.7, 0.8]).buffer,
      ],
    });

    const chunks = playback.getAudioChunks('clip-a', 0.95, 1.55);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.timestamp).toBe(1);
    expect(chunks[0]?.buffer.duration).toBeCloseTo(4 / 48000);
    const leftChannel = Array.from(chunks[0]!.buffer.getChannelData(0));
    const rightChannel = Array.from(chunks[0]!.buffer.getChannelData(1));
    expect(leftChannel).toHaveLength(4);
    expect(rightChannel).toHaveLength(4);
    leftChannel.forEach((value, index) => {
      expect(value).toBeCloseTo([0.1, 0.2, 0.3, 0.4][index]!, 6);
    });
    rightChannel.forEach((value, index) => {
      expect(value).toBeCloseTo([0.5, 0.6, 0.7, 0.8][index]!, 6);
    });
    expect(playback.getSourceInfo('clip-a')).toMatchObject({
      width: 1920,
      height: 1080,
      duration: 10,
      hasAudio: true,
    });
    expect(playback.getMetrics().totalAudioChunksReceived).toBe(1);

    playback.dispose();
  });

  it('drops stale audio chunks when the stream seeks or stops', async () => {
    const playback = createStreamingPlayback();
    playback.startStream('clip-b', 'https://example.com/clip-b.mp4', 0);
    await flushMicrotasks();

    const worker = createdWorkers[0]!;
    worker.dispatch({
      type: 'audio_chunk',
      streamKey: 'clip-b',
      src: 'https://example.com/clip-b.mp4',
      timestamp: 0,
      duration: 0.5,
      sampleRate: 48000,
      frameCount: 2,
      numberOfChannels: 2,
      channelData: [
        new Float32Array([0.1, 0.2]).buffer,
        new Float32Array([0.3, 0.4]).buffer,
      ],
    });

    expect(playback.getAudioChunks('clip-b', 0, 0.5)).toHaveLength(1);

    playback.seekStream('clip-b', 2);
    expect(playback.getAudioChunks('clip-b', 0, 1)).toHaveLength(0);

    worker.dispatch({
      type: 'audio_chunk',
      streamKey: 'clip-b',
      src: 'https://example.com/clip-b.mp4',
      timestamp: 2,
      duration: 0.5,
      sampleRate: 48000,
      frameCount: 2,
      numberOfChannels: 2,
      channelData: [
        new Float32Array([0.9, 1.0]).buffer,
        new Float32Array([1.1, 1.2]).buffer,
      ],
    });

    expect(playback.getAudioChunks('clip-b', 1.9, 2.6)).toHaveLength(1);

    playback.stopStream('clip-b');
    expect(playback.getAudioChunks('clip-b', 1.9, 2.6)).toHaveLength(0);

    playback.dispose();
  });
});
