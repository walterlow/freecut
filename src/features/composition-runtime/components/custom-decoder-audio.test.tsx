import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const soundTouchMocks = vi.hoisted(() => ({
  renderFallback: false,
}));

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

  return { useGizmoStore };
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

vi.mock('@/features/composition-runtime/deps/stores', () => storeMocks);
vi.mock('@/shared/state/preview-bridge', () => previewBridgeMocks);
vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('./soundtouch-worklet-audio', () => ({
  SoundTouchWorkletAudio: ({
    audioBuffer,
    sourceStartOffsetSec,
    isComplete,
    fallback,
  }: {
    audioBuffer: AudioBuffer;
    sourceStartOffsetSec?: number;
    isComplete?: boolean;
    fallback?: React.ReactNode;
  }) => (
    soundTouchMocks.renderFallback && fallback ? (
      <>{fallback}</>
    ) : (
      <div
        data-testid="pitch"
        data-frames={audioBuffer.length}
        data-offset={sourceStartOffsetSec ?? 0}
        data-complete={isComplete ? 'true' : 'false'}
        data-has-fallback={fallback ? 'true' : 'false'}
      />
    )
  ),
}));
vi.mock('./custom-decoder-buffered-audio', () => ({
  CustomDecoderBufferedAudio: () => <div data-testid="buffered" />,
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

import { CustomDecoderAudio } from './custom-decoder-audio';

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

describe('CustomDecoderAudio', () => {
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
    soundTouchMocks.renderFallback = false;
    previewBridgeMocks.state.visualPlaybackMode = 'player';
    previewBridgeMocks.state.streamingAudioProvider = null;
  });

  it('uses playback-first partial decode for pitch-preserved custom audio', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 4,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <CustomDecoderAudio
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
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-frames', String(22050 * 8));
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4');
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-complete', 'false');
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-has-fallback', 'true');
    });
  });

  it('requests another pitch-preserved partial slice before the current one runs out', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(2),
        startTime: 4,
        isComplete: false,
      })
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(3),
        startTime: 5.4,
        isComplete: false,
      });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    const { rerender } = render(
      <CustomDecoderAudio
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
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-frames', String(22050 * 2));
    });

    playbackStateMocks.current = {
      frame: 28,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedPitchShiftSemitones: 0,
      resolvedAudioEqStages: [],
    };

    rerender(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={240}
        playbackRate={1.5}
        trimBefore={120}
        sourceFps={30}
        volumeMultiplier={1.1}
      />,
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2);
    });

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 3,
        waitTimeoutMs: 6000,
      }),
    );
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds).toBeGreaterThan(5.39);
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds).toBeLessThan(5.41);
  });

  it('renders the buffered fallback path when the SoundTouch worklet cannot be used', async () => {
    soundTouchMocks.renderFallback = true;
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 4,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <CustomDecoderAudio
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
      expect(document.querySelector('[data-testid="buffered"]')).toBeInTheDocument();
    });
  });

  it('switches to the SoundTouch path for pitch-only shifts at 1x playback', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(),
      startTime: 0,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        audioPitchSemitones={3}
      />,
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1);
    });

    expect(document.querySelector('[data-testid="buffered"]')).toBeNull();
    expect(document.querySelector('[data-testid="pitch"]')).toBeInTheDocument();
  });

  it('can route buffered custom-decoder playback through the streaming worker bridge', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1}
        streamingAudioStreamKey="item-1"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="streaming-buffered"]')).toHaveAttribute('data-stream-key', 'item-1');
    });

    expect(document.querySelector('[data-testid="buffered"]')).toBeInTheDocument();
  });

  it('can route pitch-preserved custom-decoder playback through the streaming SoundTouch bridge', async () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <CustomDecoderAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        streamingAudioStreamKey="item-1"
      />,
    );

    await waitFor(() => {
      expect(document.querySelector('[data-testid="streaming-soundtouch"]')).toHaveAttribute('data-stream-key', 'item-1');
    });
  });
});
