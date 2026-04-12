import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
}));

const indexedDbMocks = vi.hoisted(() => ({
  getDecodedPreviewAudio: vi.fn(async () => undefined),
}));

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
  },
}));

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);
vi.mock('@/infrastructure/storage/indexeddb', () => indexedDbMocks);
vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}));
vi.mock('./pitch-corrected-audio', () => ({
  PitchCorrectedAudio: ({ src, sourceStartOffsetSec }: { src: string; sourceStartOffsetSec?: number }) => (
    <div data-testid="pitch" data-src={src} data-offset={sourceStartOffsetSec ?? 0} />
  ),
}));
vi.mock('./custom-decoder-buffered-audio', () => ({
  CustomDecoderBufferedAudio: () => <div data-testid="buffered" />,
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
    };
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:partial-wav')
      .mockReturnValue('blob:partial-wav-next');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
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
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-src', 'blob:partial-wav');
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-offset', '4');
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
      expect(document.querySelector('[data-testid="pitch"]')).toHaveAttribute('data-src', 'blob:partial-wav');
    });

    playbackStateMocks.current = {
      frame: 28,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
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
});
