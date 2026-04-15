import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 12,
    fps: 30,
    playing: false,
    resolvedVolume: 0.8,
    resolvedPitchShiftSemitones: 2,
    resolvedAudioEqStages: [],
  },
}));

const previewBridgeMocks = vi.hoisted(() => {
  const state = {
    visualPlaybackMode: 'player' as 'player' | 'streaming',
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

const storeMocks = vi.hoisted(() => {
  const playbackState = { isPlaying: false };

  return {
    playbackState,
    usePlaybackStore: vi.fn((selector?: (value: typeof playbackState) => unknown) => (
      selector ? selector(playbackState) : playbackState
    )),
    useGizmoStore: {
      getState: () => ({ activeGizmo: null }),
    },
  };
});

const previewGraphMocks = vi.hoisted(() => ({
  createPreviewClipAudioGraph: vi.fn(),
  rampPreviewClipEq: vi.fn(),
  rampPreviewClipGain: vi.fn(),
}));

const workletMocks = vi.hoisted(() => ({
  ensureSoundTouchPreviewWorkletLoaded: vi.fn(),
  serializeAudioBufferForSoundTouchPreview: vi.fn(),
}));

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('@/shared/state/preview-bridge', () => previewBridgeMocks);
vi.mock('@/features/composition-runtime/deps/stores', () => storeMocks);
vi.mock('../utils/preview-audio-graph', () => previewGraphMocks);
vi.mock('../utils/soundtouch-preview-worklet', () => ({
  ensureSoundTouchPreviewWorkletLoaded: workletMocks.ensureSoundTouchPreviewWorkletLoaded,
  serializeAudioBufferForSoundTouchPreview: workletMocks.serializeAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME: 'soundtouch-preview-processor',
}));

import { StreamingSoundTouchWorkletAudio } from './streaming-soundtouch-worklet-audio';

describe('StreamingSoundTouchWorkletAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playbackStateMocks.current = {
      frame: 12,
      fps: 30,
      playing: false,
      resolvedVolume: 0.8,
      resolvedPitchShiftSemitones: 2,
      resolvedAudioEqStages: [],
    };
    previewBridgeMocks.state.visualPlaybackMode = 'player';
    previewBridgeMocks.state.streamingAudioProvider = null;
    storeMocks.playbackState.isPlaying = false;
  });

  it('renders fallback while paused even if canvas preview owns visuals', () => {
    previewBridgeMocks.state.visualPlaybackMode = 'streaming';
    previewBridgeMocks.state.streamingAudioProvider = {
      getAudioChunks: vi.fn(() => []),
      getSourceInfo: vi.fn(() => ({ hasAudio: true })),
      isStreaming: vi.fn(() => true),
    };

    render(
      <StreamingSoundTouchWorkletAudio
        itemId="item-1"
        streamKey="item-1"
        durationInFrames={120}
        playbackRate={1.25}
        fallback={<div data-testid="fallback" />}
      />,
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(previewGraphMocks.createPreviewClipAudioGraph).not.toHaveBeenCalled();
    expect(workletMocks.ensureSoundTouchPreviewWorkletLoaded).not.toHaveBeenCalled();
  });
});
