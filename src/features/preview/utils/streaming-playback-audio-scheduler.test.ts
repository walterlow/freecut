import { describe, expect, it, vi } from 'vitest';
import { createStreamingPlaybackAudioScheduler } from './streaming-playback-audio-scheduler';
import type { StreamingAudioChunk, StreamingPlayback } from './streaming-playback';

class AudioBufferMock {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;

  constructor(duration: number, sampleRate = 48000) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.length = Math.round(duration * sampleRate);
  }
}

class AudioBufferSourceNodeMock {
  buffer: AudioBuffer | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly start = vi.fn();
  readonly stop = vi.fn();
}

class AudioContextMock {
  currentTime = 10;
  readonly createBufferSource = vi.fn(() => new AudioBufferSourceNodeMock());
}

function createChunk(timestamp: number, duration: number): StreamingAudioChunk {
  return {
    timestamp,
    duration,
    buffer: new AudioBufferMock(duration) as unknown as AudioBuffer,
  };
}

function createPlaybackMock(chunks: StreamingAudioChunk[]): StreamingPlayback {
  return {
    startStream: vi.fn(),
    seekStream: vi.fn(),
    stopStream: vi.fn(),
    stopAll: vi.fn(),
    getFrame: vi.fn(() => null),
    getAudioChunks: vi.fn(() => chunks),
    getSourceInfo: vi.fn(() => null),
    isStreaming: vi.fn(() => true),
    updatePosition: vi.fn(),
    enableIdleSweep: vi.fn(),
    disableIdleSweep: vi.fn(),
    dispose: vi.fn(),
    getMetrics: vi.fn(() => ({
      activeStreams: 1,
      totalFramesReceived: 0,
      totalFramesDrawn: 0,
      totalFramesMissed: 0,
      totalAudioChunksReceived: chunks.length,
      audioStartupSamples: 0,
      audioStartupLastMs: 0,
      audioStartupAvgMs: 0,
      audioSeekSamples: 0,
      audioSeekLastMs: 0,
      audioSeekAvgMs: 0,
      pendingAudioWarmups: 0,
      frameBufferSizes: new Map(),
      audioBufferSizes: new Map(),
    })),
  };
}

describe('streaming playback audio scheduler', () => {
  it('schedules current and upcoming chunks against the preview graph', () => {
    const scheduler = createStreamingPlaybackAudioScheduler();
    const ctx = new AudioContextMock();
    const graph = {
      context: ctx,
      sourceInputNode: {},
      outputGainNode: { gain: { value: 1 } },
      eqStageNodes: [],
      dispose: vi.fn(),
    };
    const playback = createPlaybackMock([
      createChunk(0, 0.5),
      createChunk(0.5, 0.5),
    ]);

    scheduler.sync({
      playback,
      streamKey: 'clip-a',
      targetTime: 0.25,
      graph: graph as never,
      playing: true,
    });

    const firstSource = ctx.createBufferSource.mock.results[0]?.value as AudioBufferSourceNodeMock;
    const secondSource = ctx.createBufferSource.mock.results[1]?.value as AudioBufferSourceNodeMock;

    expect(playback.getAudioChunks).toHaveBeenCalledWith('clip-a', 0.15, 1);
    expect(firstSource.connect).toHaveBeenCalledWith(graph.sourceInputNode);
    expect(firstSource.start).toHaveBeenCalledWith(10, 0.25);
    expect(secondSource.start).toHaveBeenCalledWith(10.25, 0);
    expect(scheduler.getMetrics()).toEqual({
      syncCalls: 1,
      resyncs: 0,
      chunksScheduled: 2,
      scheduledSources: 2,
    });
  });

  it('hard-resyncs scheduled chunks on a large seek jump', () => {
    const scheduler = createStreamingPlaybackAudioScheduler();
    const ctx = new AudioContextMock();
    const graph = {
      context: ctx,
      sourceInputNode: {},
      outputGainNode: { gain: { value: 1 } },
      eqStageNodes: [],
      dispose: vi.fn(),
    };
    const playback = createPlaybackMock([createChunk(0, 0.5)]);

    scheduler.sync({
      playback,
      streamKey: 'clip-b',
      targetTime: 0.1,
      graph: graph as never,
      playing: true,
    });

    const firstSource = ctx.createBufferSource.mock.results[0]?.value as AudioBufferSourceNodeMock;
    playback.getAudioChunks = vi.fn(() => [createChunk(2, 0.5)]);

    scheduler.sync({
      playback,
      streamKey: 'clip-b',
      targetTime: 2,
      graph: graph as never,
      playing: true,
    });

    const secondSource = ctx.createBufferSource.mock.results[1]?.value as AudioBufferSourceNodeMock;
    expect(firstSource.stop).toHaveBeenCalled();
    expect(secondSource.start).toHaveBeenCalledWith(10, 0);
    expect(scheduler.getMetrics().resyncs).toBe(1);
  });

  it('stops scheduled sources when playback pauses', () => {
    const scheduler = createStreamingPlaybackAudioScheduler();
    const ctx = new AudioContextMock();
    const graph = {
      context: ctx,
      sourceInputNode: {},
      outputGainNode: { gain: { value: 1 } },
      eqStageNodes: [],
      dispose: vi.fn(),
    };
    const playback = createPlaybackMock([createChunk(0, 0.5)]);

    scheduler.sync({
      playback,
      streamKey: 'clip-c',
      targetTime: 0,
      graph: graph as never,
      playing: true,
    });

    const source = ctx.createBufferSource.mock.results[0]?.value as AudioBufferSourceNodeMock;
    scheduler.sync({
      playback,
      streamKey: 'clip-c',
      targetTime: 0.1,
      graph: graph as never,
      playing: false,
    });

    expect(source.stop).toHaveBeenCalled();
    expect(scheduler.getMetrics().scheduledSources).toBe(0);
  });
});
