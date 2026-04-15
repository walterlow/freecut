import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AUDIO_EQ_SETTINGS } from '@/shared/utils/audio-eq';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}));

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedPitchShiftSemitones: 0,
    resolvedAudioEqStages: [],
  },
}));

const previewAudioMocks = vi.hoisted(() => {
  const state: { current: HTMLAudioElement | null } = { current: null };
  const createAudio = () => ({
    volume: 1,
    muted: false,
    playbackRate: 1,
    currentTime: 0,
    readyState: 4,
    paused: true,
    seeking: false,
    play: vi.fn().mockImplementation(function (this: { paused: boolean }) {
      this.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn().mockImplementation(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as HTMLAudioElement;

  return {
    state,
    acquirePreviewAudioElement: vi.fn(() => {
      const audio = createAudio();
      state.current = audio;
      return audio;
    }),
    releasePreviewAudioElement: vi.fn(),
    markPreviewAudioElementUsesWebAudio: vi.fn(),
  };
});

const previewGraphMocks = vi.hoisted(() => {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const graph = {
    context: {
      state: 'running' as const,
      currentTime: 0,
      resume: vi.fn(() => Promise.resolve()),
      createMediaElementSource: vi.fn(() => sourceNode),
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  };

  return {
    graph,
    sourceNode,
    createPreviewClipAudioGraph: vi.fn(() => graph),
    rampPreviewClipEq: vi.fn(),
    rampPreviewClipGain: vi.fn(),
    setPreviewClipGain: vi.fn(),
  };
});

const storeMocks = vi.hoisted(() => {
  const gizmoState = { activeGizmo: null, preview: null };
  const useGizmoStore = Object.assign(
    vi.fn((selector?: (state: typeof gizmoState) => unknown) => (
      selector ? selector(gizmoState) : gizmoState
    )),
    {
      getState: () => gizmoState,
    },
  );

  return {
    useGizmoStore,
    usePlaybackStore: {
      getState: () => ({ isPlaying: false, previewFrame: null }),
    },
  };
});

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

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('../utils/preview-audio-element-pool', () => previewAudioMocks);
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks);
vi.mock('@/features/composition-runtime/deps/stores', () => storeMocks);
vi.mock('@/shared/state/preview-bridge', () => previewBridgeMocks);
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
  }: {
    audioBuffer: AudioBuffer;
    sourceStartOffsetSec?: number;
  }) => (
    <div
      data-testid="pitch"
      data-frames={audioBuffer.length}
      data-offset={sourceStartOffsetSec ?? 0}
    />
  ),
}));
vi.mock('./custom-decoder-buffered-audio', () => ({
  CustomDecoderBufferedAudio: ({
    mediaId,
    playbackRate,
  }: {
    mediaId: string;
    playbackRate?: number;
  }) => (
    <div
      data-testid="decoded-buffered"
      data-media-id={mediaId}
      data-rate={playbackRate ?? 1}
    />
  ),
}));
vi.mock('./streaming-playback-buffered-audio', () => ({
  StreamingPlaybackBufferedAudio: ({
    streamKey,
    fallback,
  }: {
    streamKey: string;
    fallback: React.ReactNode;
  }) => (
    <div data-testid="streaming-buffered" data-stream-key={streamKey}>
      {fallback}
    </div>
  ),
}));
vi.mock('./streaming-soundtouch-worklet-audio', () => ({
  StreamingSoundTouchWorkletAudio: ({
    streamKey,
    fallback,
  }: {
    streamKey: string;
    fallback: React.ReactNode;
  }) => (
    <div data-testid="streaming-soundtouch" data-stream-key={streamKey}>
      {fallback}
    </div>
  ),
}));

import { PitchCorrectedAudio } from './pitch-corrected-audio';

function makeAudioBuffer(durationSeconds = 8): AudioBuffer {
  const sampleRate = 22050;
  const length = sampleRate * durationSeconds;
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

describe('PitchCorrectedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    };
    previewBridgeMocks.state.visualPlaybackMode = 'player';
    previewBridgeMocks.state.streamingAudioProvider = null;
  });

  it('keeps 1x playback on the native preview path', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
      />,
    );

    await waitFor(() => {
      expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledWith('blob:audio');
    });

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).not.toHaveBeenCalled();
    expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull();
  });

  it('keeps the native preview graph alive while EQ stages change', async () => {
    const { rerender } = render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1}
      />,
    );

    await waitFor(() => {
      expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1);
    });

    playbackStateMocks.current = {
      ...playbackStateMocks.current,
      resolvedAudioEqStages: [DEFAULT_AUDIO_EQ_SETTINGS] as typeof playbackStateMocks.current.resolvedAudioEqStages,
    };

    rerender(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        volumeMultiplier={1.01}
      />,
    );

    await waitFor(() => {
      expect(previewGraphMocks.rampPreviewClipEq).toHaveBeenLastCalledWith(
        previewGraphMocks.graph,
        [DEFAULT_AUDIO_EQ_SETTINGS],
      );
    });

    expect(previewGraphMocks.createPreviewClipAudioGraph).toHaveBeenCalledTimes(1);
    expect(previewAudioMocks.acquirePreviewAudioElement).toHaveBeenCalledTimes(1);
  });

  it('can force 1x video playback onto the decoded buffered path', async () => {
    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        preferDecodedBuffering
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="decoded-buffered"]')).toHaveAttribute('data-media-id', 'media-1');
    });

    expect(previewAudioMocks.acquirePreviewAudioElement).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="pitch"]')).toBeNull();
  });

  it('can route 1x video playback through the streaming worker audio bridge', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        preferDecodedBuffering
        streamingAudioStreamKey="item-1"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="streaming-buffered"]')).toHaveAttribute('data-stream-key', 'item-1');
    });

    expect(document.querySelector('[data-testid="decoded-buffered"]')).toBeInTheDocument();
    expect(previewAudioMocks.acquirePreviewAudioElement).not.toHaveBeenCalled();
  });

  it('uses playback-first decode for stretched clips with media ids', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 4,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
      />,
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        {
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
          targetTimeSeconds: 4,
        },
      );
    });

    await waitFor(() => {
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-frames', String(22050 * 2));
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4');
    });

    expect(audioDecodeMocks.getOrDecodeAudio).toHaveBeenCalledWith('media-1', 'blob:audio');
  });

  it('uses a synthetic decode key when pitch correction is needed without a media id', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.25}
      />,
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'legacy-src:blob:audio',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
        }),
      );
    });

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument();
  });

  it('uses the decoded path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={4}
      />,
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1);
    });

    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument();
  });

  it('can route pitch-preserved preview audio through the streaming SoundTouch bridge', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <PitchCorrectedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.25}
        streamingAudioStreamKey="item-1"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="streaming-soundtouch"]')).toHaveAttribute('data-stream-key', 'item-1');
    });
  });
});
