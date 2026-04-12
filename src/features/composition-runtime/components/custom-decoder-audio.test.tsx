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

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks);
vi.mock('@/infrastructure/storage/indexeddb', () => indexedDbMocks);
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
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:partial-wav');
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
});
