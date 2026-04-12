import { act, render, waitFor } from '@testing-library/react';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
  isPreviewAudioDecodePending: vi.fn(() => false),
}));

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedAudioEqStages: [],
  },
}));

const audioContextStateMocks = vi.hoisted(() => ({
  createdSources: [] as Array<{
    startCalls: Array<{ when?: number; offset?: number }>;
  }>,
}));

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));

import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';

function makeAudioBuffer(duration: number, sampleRate = 22050): AudioBuffer {
  const length = Math.max(1, Math.round(duration * sampleRate));
  return {
    duration,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CustomDecoderBufferedAudio queued handoff', () => {
  beforeAll(() => {
    class AudioParamMock {
      value = 0;
      cancelScheduledValues() {}
      setValueAtTime(value: number) {
        this.value = value;
      }
      linearRampToValueAtTime(value: number) {
        this.value = value;
      }
    }

    class GainNodeMock {
      gain = new AudioParamMock();
      connect() {}
      disconnect() {}
    }

    class BiquadFilterNodeMock {
      type: BiquadFilterType = 'peaking';
      frequency = new AudioParamMock();
      gain = new AudioParamMock();
      Q = new AudioParamMock();
      connect() {}
      disconnect() {}
    }

    class AudioBufferSourceNodeMock {
      buffer: AudioBuffer | null = null;
      playbackRate = new AudioParamMock();
      onended: (() => void) | null = null;
      startCalls: Array<{ when?: number; offset?: number }> = [];
      connect() {}
      disconnect() {}
      start(when?: number, offset?: number) {
        this.startCalls.push({ when, offset });
      }
      stop() {}
    }

    class AudioContextMock {
      currentTime = 0;
      state: AudioContextState = 'running';
      destination = {};
      createGain() {
        return new GainNodeMock();
      }
      createBiquadFilter() {
        return new BiquadFilterNodeMock();
      }
      createBufferSource() {
        const source = new AudioBufferSourceNodeMock();
        audioContextStateMocks.createdSources.push(source);
        return source;
      }
      resume() {
        return Promise.resolve();
      }
    }

    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('webkitAudioContext', AudioContextMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    audioContextStateMocks.createdSources.length = 0;
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    };
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(new Promise<AudioBuffer>(() => {}));
  });

  it('queues the next overlapping slice on the audio clock before the current slice ends', async () => {
    const pendingExtension = createDeferred<{
      buffer: AudioBuffer;
      startTime: number;
      isComplete: boolean;
    }>();

    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(4),
        startTime: 0,
        isComplete: false,
      })
      .mockImplementationOnce(() => pendingExtension.promise);

    const { rerender } = render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
      />
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    playbackStateMocks.current = {
      frame: 90,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    };

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
        volumeMultiplier={1.1}
      />
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2);
      expect(audioContextStateMocks.createdSources).toHaveLength(1);
    });

    await act(async () => {
      pendingExtension.resolve({
        buffer: makeAudioBuffer(3.5),
        startTime: 2.75,
        isComplete: false,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(audioContextStateMocks.createdSources).toHaveLength(2);
    });

    expect(audioContextStateMocks.createdSources[0]?.startCalls[0]?.when).toBeCloseTo(0, 6);
    expect(audioContextStateMocks.createdSources[0]?.startCalls[0]?.offset).toBeCloseTo(3, 5);
    expect(audioContextStateMocks.createdSources[1]?.startCalls[0]?.when).toBeCloseTo(1, 5);
    expect(audioContextStateMocks.createdSources[1]?.startCalls[0]?.offset).toBeCloseTo(1.25, 5);
  });
});
