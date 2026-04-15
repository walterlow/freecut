import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import type { TimelineTrack } from '@/types/timeline';
import { useStreamingPlaybackController } from './use-streaming-playback-controller';

const originalSrc = 'blob:original';
const proxySrc = 'blob:proxy';

const createStreamingPlaybackMock = vi.hoisted(() => vi.fn());
const mainThreadAudioSourceMocks = vi.hoisted(() => {
  const source = {
    warmup: vi.fn(),
    start: vi.fn(),
    seek: vi.fn(),
    stop: vi.fn(),
    stopAll: vi.fn(),
    updatePosition: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    source,
    createMainThreadAudioSource: vi.fn(() => source),
  };
});

vi.mock('@/features/preview/utils/streaming-playback', () => ({
  createStreamingPlayback: createStreamingPlaybackMock,
}));
vi.mock('@/features/preview/utils/main-thread-audio-source', () => mainThreadAudioSourceMocks);

vi.mock('@/infrastructure/browser/blob-url-manager', () => ({
  blobUrlManager: {
    get: (mediaId: string) => (mediaId === 'media-1' ? originalSrc : null),
  },
}));

vi.mock('@/features/preview/deps/media-library-contract', () => ({
  resolveProxyUrl: (mediaId: string) => (mediaId === 'media-1' ? proxySrc : null),
}));

type FakeStreamingPlayback = ReturnType<typeof createFakeStreamingPlayback>;

function createFakeStreamingPlayback() {
  const streamingKeys = new Set<string>();
  const framesByKey = new Map<string, ImageBitmap | null>();
  const audioByKey = new Map<string, Array<{ key: string }>>();
  const sourceInfoByKey = new Map<string, { hasAudio: boolean }>();

  return {
    framesByKey,
    audioByKey,
    sourceInfoByKey,
    startStream: vi.fn((streamKey: string) => {
      streamingKeys.add(streamKey);
    }),
    seekStream: vi.fn(),
    stopStream: vi.fn((streamKey: string) => {
      streamingKeys.delete(streamKey);
    }),
    stopAll: vi.fn(() => {
      streamingKeys.clear();
    }),
    getFrame: vi.fn((streamKey: string) => framesByKey.get(streamKey) ?? null),
    getAudioChunks: vi.fn((streamKey: string) => audioByKey.get(streamKey) ?? []),
    getSourceInfo: vi.fn((streamKey: string) => sourceInfoByKey.get(streamKey) ?? { hasAudio: true }),
    isStreaming: vi.fn((streamKey: string) => streamingKeys.has(streamKey)),
    updatePosition: vi.fn(),
    pushAudioChunk: vi.fn(),
    getStreamGeneration: vi.fn(() => 0),
    setSourceHasAudio: vi.fn((streamKey: string, hasAudio: boolean) => {
      sourceInfoByKey.set(streamKey, { hasAudio });
    }),
    enableIdleSweep: vi.fn(),
    disableIdleSweep: vi.fn(),
    dispose: vi.fn(),
    getMetrics: vi.fn(() => ({
      activeStreams: streamingKeys.size,
      totalFramesReceived: 0,
      totalFramesDrawn: 0,
      totalFramesMissed: 0,
      totalAudioChunksReceived: 0,
      audioStartupSamples: 0,
      audioStartupLastMs: 0,
      audioStartupAvgMs: 0,
      audioSeekSamples: 0,
      audioSeekLastMs: 0,
      audioSeekAvgMs: 0,
      pendingAudioWarmups: 0,
      frameBufferSizes: new Map<string, number>(),
      audioBufferSizes: new Map<string, number>(),
    })),
  };
}

let latestFrameProvider: ((streamKey: string, src: string, sourceTime: number) => ImageBitmap | null) | null = null;
let latestAudioProvider:
  | ReturnType<typeof useStreamingPlaybackController>['streamingAudioProvider']
  | null = null;

function Harness({ tracks }: { tracks: TimelineTrack[] }) {
  const { streamingFrameProviderRef, streamingAudioProvider } = useStreamingPlaybackController({
    fps: 30,
    combinedTracks: tracks,
  });

  useEffect(() => {
    latestFrameProvider = streamingFrameProviderRef.current;
    latestAudioProvider = streamingAudioProvider;
  });

  return null;
}

function createTracks(): TimelineTrack[] {
  return [{
    id: 'track-1',
    name: 'Video',
    height: 120,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [{
      id: 'clip-1',
      trackId: 'track-1',
      type: 'video',
      from: 0,
      durationInFrames: 120,
      label: 'Clip 1',
      mediaId: 'media-1',
      src: 'fallback.mp4',
    }],
  }];
}

describe('useStreamingPlaybackController proxy handoff', () => {
  let playback: FakeStreamingPlayback;

  beforeEach(() => {
    cleanup();
    latestFrameProvider = null;
    latestAudioProvider = null;
    playback = createFakeStreamingPlayback();
    createStreamingPlaybackMock.mockReturnValue(playback);
    usePlaybackStore.setState({
      currentFrame: 0,
      isPlaying: false,
      useProxy: false,
      previewFrame: null,
      previewItemId: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('keeps the active stream alive until the toggled proxy stream is ready', async () => {
    const oldStreamKey = `clip-1::${originalSrc}`;
    const newStreamKey = `clip-1::${proxySrc}`;
    const oldFrame = { label: 'old-frame' } as unknown as ImageBitmap;
    const newFrame = { label: 'new-frame' } as unknown as ImageBitmap;
    playback.framesByKey.set(oldStreamKey, oldFrame);
    playback.framesByKey.set(newStreamKey, null);
    playback.audioByKey.set(oldStreamKey, [{ key: 'old-audio' }]);
    playback.audioByKey.set(newStreamKey, [{ key: 'new-audio' }]);

    render(<Harness tracks={createTracks()} />);

    await waitFor(() => {
      expect(playback.startStream).toHaveBeenCalledWith(oldStreamKey, originalSrc, 0);
      expect(playback.startStream).toHaveBeenCalledWith(newStreamKey, proxySrc, 0);
    });

    expect(latestFrameProvider?.('clip-1', originalSrc, 0)).toBe(oldFrame);

    act(() => {
      usePlaybackStore.setState({ useProxy: true });
    });

    expect(playback.stopAll).not.toHaveBeenCalled();
    expect(playback.startStream).toHaveBeenCalledTimes(2);
    expect(latestFrameProvider?.('clip-1', proxySrc, 0)).toBe(oldFrame);
    expect(playback.stopStream).not.toHaveBeenCalledWith(oldStreamKey);

    expect(latestAudioProvider?.getAudioChunks('clip-1', 0, 0.5)).toEqual([{ key: 'old-audio' }]);
    expect(playback.getAudioChunks).toHaveBeenLastCalledWith(oldStreamKey, 0, 0.5);

    playback.framesByKey.set(newStreamKey, newFrame);

    expect(latestFrameProvider?.('clip-1', proxySrc, 0)).toBe(newFrame);
    expect(playback.stopStream).toHaveBeenCalledWith(oldStreamKey);

    expect(latestAudioProvider?.getAudioChunks('clip-1', 0, 0.5)).toEqual([{ key: 'new-audio' }]);
    expect(playback.getAudioChunks).toHaveBeenLastCalledWith(newStreamKey, 0, 0.5);
  });

  it('does not tear down the warmed stream when playback stops', async () => {
    render(<Harness tracks={createTracks()} />);

    await waitFor(() => {
      expect(playback.startStream).toHaveBeenCalledWith(`clip-1::${originalSrc}`, originalSrc, 0);
    });

    act(() => {
      usePlaybackStore.setState({ isPlaying: true, currentFrame: 15 });
    });

    await waitFor(() => {
      expect(playback.enableIdleSweep).toHaveBeenCalled();
    });

    act(() => {
      usePlaybackStore.setState({ isPlaying: false, currentFrame: 18 });
    });

    await waitFor(() => {
      expect(playback.disableIdleSweep).toHaveBeenCalled();
    });

    expect(playback.stopAll).not.toHaveBeenCalled();
  });

  it('uses alternate worker audio before falling back to main-thread decode', async () => {
    usePlaybackStore.setState({
      currentFrame: 0,
      isPlaying: false,
      useProxy: true,
      previewFrame: null,
      previewItemId: null,
    });
    playback.sourceInfoByKey.set(`clip-1::${proxySrc}`, { hasAudio: false });
    playback.sourceInfoByKey.set(`clip-1::${originalSrc}`, { hasAudio: true });

    render(<Harness tracks={createTracks()} />);

    await waitFor(() => {
      expect(playback.startStream).toHaveBeenCalledWith(`clip-1::${proxySrc}`, proxySrc, 0);
      expect(playback.startStream).toHaveBeenCalledWith(`clip-1::${originalSrc}`, originalSrc, 0);
    });

    act(() => {
      usePlaybackStore.setState({ isPlaying: true, currentFrame: 5 });
    });

    await waitFor(() => {
      expect(playback.enableIdleSweep).toHaveBeenCalled();
    });

    expect(mainThreadAudioSourceMocks.source.start).not.toHaveBeenCalled();

    playback.audioByKey.set(`clip-1::${originalSrc}`, [{ key: 'original-audio' }]);
    expect(latestAudioProvider?.getAudioChunks('clip-1', 0, 0.5)).toEqual([{ key: 'original-audio' }]);
    expect(playback.getAudioChunks).toHaveBeenLastCalledWith(`clip-1::${originalSrc}`, 0, 0.5);
  });

  it('prewarms main-thread fallback audio while paused when neither worker stream has audio', async () => {
    usePlaybackStore.setState({
      currentFrame: 0,
      isPlaying: false,
      useProxy: true,
      previewFrame: null,
      previewItemId: null,
    });
    playback.sourceInfoByKey.set(`clip-1::${proxySrc}`, { hasAudio: false });
    playback.sourceInfoByKey.set(`clip-1::${originalSrc}`, { hasAudio: false });

    render(<Harness tracks={createTracks()} />);

    await waitFor(() => {
      expect(mainThreadAudioSourceMocks.source.warmup).toHaveBeenCalled();
      expect(mainThreadAudioSourceMocks.source.start).toHaveBeenCalledWith(`clip-1::${proxySrc}`, originalSrc, 0);
    });
  });

});
