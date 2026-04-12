import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundTouchWorkletAudio } from './soundtouch-worklet-audio';

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedAudioEqStages: [],
  },
}));

const previewGraphMocks = vi.hoisted(() => ({
  createPreviewClipAudioGraph: vi.fn(() => ({
    context: {
      state: 'running' as const,
      currentTime: 0,
      sampleRate: 48000,
      resume: vi.fn(() => Promise.resolve()),
      audioWorklet: {},
    },
    sourceInputNode: {},
    outputGainNode: {
      gain: {
        value: 1,
      },
    },
    eqStageNodes: [],
    dispose: vi.fn(),
  })),
  rampPreviewClipEq: vi.fn(),
  rampPreviewClipGain: vi.fn(),
}));

const soundTouchWorkletMocks = vi.hoisted(() => ({
  ensureSoundTouchPreviewWorkletLoaded: vi.fn(),
  serializeAudioBufferForSoundTouchPreview: vi.fn(() => ({
    leftChannel: new Float32Array(0),
    rightChannel: new Float32Array(0),
    frameCount: 0,
    sampleRate: 48000,
  })),
}));

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('../utils/preview-audio-graph', () => ({
  createPreviewClipAudioGraph: previewGraphMocks.createPreviewClipAudioGraph,
  rampPreviewClipEq: previewGraphMocks.rampPreviewClipEq,
  rampPreviewClipGain: previewGraphMocks.rampPreviewClipGain,
}));
vi.mock('../utils/soundtouch-preview-worklet', () => ({
  ensureSoundTouchPreviewWorkletLoaded: soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded,
  serializeAudioBufferForSoundTouchPreview: soundTouchWorkletMocks.serializeAudioBufferForSoundTouchPreview,
  SOUND_TOUCH_PREVIEW_PROCESSOR_NAME: 'soundtouch-preview-processor',
}));
vi.mock('@/features/composition-runtime/deps/stores', () => ({
  useGizmoStore: {
    getState: () => ({ activeGizmo: null }),
  },
  usePlaybackStore: {
    getState: () => ({ isPlaying: false, previewFrame: null }),
  },
}));

function makeAudioBuffer(durationSeconds = 2): AudioBuffer {
  const sampleRate = 48000;
  const length = sampleRate * durationSeconds;
  return {
    duration: durationSeconds,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

describe('SoundTouchWorkletAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    };
  });

  it('does not render fallback while the worklet is still loading', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockReturnValue(
      new Promise<boolean>(() => {}),
    );

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    );

    await waitFor(() => {
      expect(soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('renders fallback after the worklet path fails', async () => {
    soundTouchWorkletMocks.ensureSoundTouchPreviewWorkletLoaded.mockResolvedValue(false);

    render(
      <SoundTouchWorkletAudio
        audioBuffer={makeAudioBuffer()}
        itemId="item-1"
        durationInFrames={120}
        playbackRate={1.5}
        fallback={<div data-testid="fallback" />}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });
});
