import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
  isPreviewAudioDecodePending: vi.fn(() => false),
}));

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));

import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio';

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
  },
}));

describe('CustomDecoderBufferedAudio', () => {
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

    class AudioBufferSourceNodeMock {
      buffer: AudioBuffer | null = null;
      playbackRate = new AudioParamMock();
      onended: (() => void) | null = null;
      connect() {}
      disconnect() {}
      start() {}
      stop() {}
    }

    class AudioContextMock {
      currentTime = 0;
      state: AudioContextState = 'running';
      destination = {};
      createGain() {
        return new GainNodeMock();
      }
      createBufferSource() {
        return new AudioBufferSourceNodeMock();
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
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
    };
    const pendingDecode = new Promise<AudioBuffer>(() => {});
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: {
        duration: 2,
        numberOfChannels: 2,
        length: 22050 * 2,
        sampleRate: 22050,
        getChannelData: () => new Float32Array(22050 * 2),
      } as unknown as AudioBuffer,
      startTime: 0,
      isComplete: false,
    });
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(pendingDecode);
  });

  it('starts with partial decode playback and continues full decode in background', async () => {
    render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={120}
      />
    );

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 2,
          waitTimeoutMs: 6000,
        }),
      );
    });

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]?.targetTimeSeconds).toBeLessThan(0.001);

    expect(audioDecodeMocks.getOrDecodeAudio).toHaveBeenCalledWith('media-1', 'blob:audio');
  });

  it('requests another partial slice before the current slice runs out', async () => {
    audioDecodeMocks.isPreviewAudioDecodePending.mockReturnValue(true);
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
      frame: 28,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
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
    });

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 3,
        waitTimeoutMs: 6000,
      }),
    );
    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds).toBeGreaterThan(0.9);
  });
});
