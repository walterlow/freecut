import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewBridgeMocks = vi.hoisted(() => {
  const state = {
    visualPlaybackMode: 'player' as 'player' | 'rendered_preview' | 'streaming',
    streamingAudioProvider: null as null | {
      getAudioChunks: ReturnType<typeof vi.fn>;
      getSourceInfo: ReturnType<typeof vi.fn>;
      isStreaming: ReturnType<typeof vi.fn>;
    },
  };

  return {
    state,
    usePreviewBridgeStore: vi.fn((selector?: (value: typeof state) => unknown) => (
      selector ? selector(state) : state
    )),
  };
});

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 12,
    fps: 30,
    playing: true,
    resolvedVolume: 0.8,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [],
  },
}));

const schedulerMocks = vi.hoisted(() => {
  const scheduler = {
    sync: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    getMetrics: vi.fn(() => ({
      syncCalls: 0,
      resyncs: 0,
      chunksScheduled: 0,
      scheduledSources: 0,
    })),
  };

  return {
    scheduler,
    createStreamingPlaybackAudioScheduler: vi.fn(() => scheduler),
  };
});

const storeMocks = vi.hoisted(() => {
  const playbackState = {
    isPlaying: true,
  };

  return {
    playbackState,
    usePlaybackStore: vi.fn((selector?: (value: typeof playbackState) => unknown) => (
      selector ? selector(playbackState) : playbackState
    )),
  };
});

const previewGraphMocks = vi.hoisted(() => {
  const graph = {
    context: {
      state: 'running' as const,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createBufferSource: vi.fn(),
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: { value: 1 },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  };

  return {
    graph,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
  };
});

vi.mock('@/shared/state/preview-bridge', () => previewBridgeMocks);
vi.mock('@/features/composition-runtime/deps/stores', () => storeMocks);
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('@/features/composition-runtime/deps/streaming-playback-audio-scheduler', () => schedulerMocks);
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks);

import { StreamingPlaybackBufferedAudio } from './streaming-playback-buffered-audio';

describe('StreamingPlaybackBufferedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewBridgeMocks.state.visualPlaybackMode = 'player';
    previewBridgeMocks.state.streamingAudioProvider = null;
    storeMocks.playbackState.isPlaying = true;
    playbackStateMocks.current = {
      frame: 12,
      fps: 30,
      playing: true,
      resolvedVolume: 0.8,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    };
  });

  it('renders the fallback when streaming playback is inactive', () => {
    const { getByTestId } = render(
      <StreamingPlaybackBufferedAudio
        itemId="item-1"
        streamKey="item-1"
        durationInFrames={120}
        fallback={<div data-testid="fallback" />}
      />,
    );

    expect(getByTestId('fallback')).toBeInTheDocument();
    expect(schedulerMocks.scheduler.sync).not.toHaveBeenCalled();
  });

  it('renders the fallback while paused even if the canvas owns visuals', () => {
    storeMocks.playbackState.isPlaying = false;
    previewBridgeMocks.state.visualPlaybackMode = 'rendered_preview';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    const { getByTestId } = render(
      <StreamingPlaybackBufferedAudio
        itemId="item-1"
        streamKey="item-1"
        durationInFrames={120}
        fallback={<div data-testid="fallback" />}
      />,
    );

    expect(getByTestId('fallback')).toBeInTheDocument();
    expect(previewGraphMocks.createPreviewClipAudioGraph).not.toHaveBeenCalled();
    expect(schedulerMocks.scheduler.sync).not.toHaveBeenCalled();
  });

  it('schedules worker audio chunks when streaming playback owns the clip', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <StreamingPlaybackBufferedAudio
        itemId="item-1"
        streamKey="item-1"
        durationInFrames={120}
        trimBefore={30}
        sourceFps={30}
        playbackRate={1}
        fallback={<div data-testid="fallback" />}
      />,
    );

    await waitFor(() => {
      expect(schedulerMocks.scheduler.sync).toHaveBeenCalledTimes(1);
    });

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1);
    expect(previewGraphMocks.rampPreviewClipGain).toHaveBeenCalled();
  });
});
