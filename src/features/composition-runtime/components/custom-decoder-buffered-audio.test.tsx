import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { act, render, waitFor } from '@testing-library/react'

const audioDecodeMocks = vi.hoisted(() => ({
  getOrDecodeAudio: vi.fn(),
  getOrDecodeAudioSliceForPlayback: vi.fn(),
  isPreviewAudioDecodePending: vi.fn(() => false),
}))

vi.mock('../utils/audio-decode-cache', () => audioDecodeMocks)

vi.mock('./hooks/use-audio-playback-state', () => ({
  useAudioPlaybackState: vi.fn(() => playbackStateMocks.current),
}))

import { CustomDecoderBufferedAudio } from './custom-decoder-buffered-audio'

const playbackStateMocks = vi.hoisted(() => ({
  current: {
    frame: 0,
    fps: 30,
    playing: false,
    resolvedVolume: 1,
    resolvedAudioEqStages: [],
  },
}))

function makeAudioBuffer(duration: number, sampleRate = 22050): AudioBuffer {
  const length = Math.max(1, Math.round(duration * sampleRate))
  return {
    duration,
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('CustomDecoderBufferedAudio', () => {
  beforeAll(() => {
    class AudioParamMock {
      value = 0
      cancelScheduledValues() {}
      setValueAtTime(value: number) {
        this.value = value
      }
      linearRampToValueAtTime(value: number) {
        this.value = value
      }
    }

    class GainNodeMock {
      gain = new AudioParamMock()
      connect() {}
      disconnect() {}
    }

    class BiquadFilterNodeMock {
      type: BiquadFilterType = 'peaking'
      frequency = new AudioParamMock()
      gain = new AudioParamMock()
      Q = new AudioParamMock()
      connect() {}
      disconnect() {}
    }

    class AudioBufferSourceNodeMock {
      buffer: AudioBuffer | null = null
      playbackRate = new AudioParamMock()
      onended: (() => void) | null = null
      connect() {}
      disconnect() {}
      start() {}
      stop() {}
    }

    class AudioContextMock {
      currentTime = 0
      state: AudioContextState = 'running'
      destination = {}
      createGain() {
        return new GainNodeMock()
      }
      createBiquadFilter() {
        return new BiquadFilterNodeMock()
      }
      createBufferSource() {
        return new AudioBufferSourceNodeMock()
      }
      resume() {
        return Promise.resolve()
      }
    }

    vi.stubGlobal('AudioContext', AudioContextMock)
    vi.stubGlobal('webkitAudioContext', AudioContextMock)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    playbackStateMocks.current = {
      frame: 0,
      fps: 30,
      playing: false,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }
    const pendingDecode = new Promise<AudioBuffer>(() => {})
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValue({
      buffer: makeAudioBuffer(2),
      startTime: 0,
      isComplete: false,
    })
    audioDecodeMocks.getOrDecodeAudio.mockReturnValue(pendingDecode)
  })

  it('starts with partial decode playback and continues full decode in background', async () => {
    vi.useFakeTimers()
    try {
      render(
        <CustomDecoderBufferedAudio
          src="blob:audio"
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={120}
        />,
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledWith(
        'media-1',
        'blob:audio',
        expect.objectContaining({
          minReadySeconds: 1,
          preRollSeconds: 0.25,
          waitTimeoutMs: 6000,
        }),
      )

      expect(
        audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]?.targetTimeSeconds,
      ).toBeLessThan(0.001)
      expect(audioDecodeMocks.getOrDecodeAudio).not.toHaveBeenCalled()

      await act(async () => {
        vi.advanceTimersByTime(1600)
        await Promise.resolve()
      })

      expect(audioDecodeMocks.getOrDecodeAudio).toHaveBeenCalledWith('media-1', 'blob:audio')
    } finally {
      vi.useRealTimers()
    }
  })

  it('prefetches follow-up coverage after a short startup slice', async () => {
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(1),
        startTime: 0,
        isComplete: false,
      })
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(3.5),
        startTime: 0.75,
        isComplete: false,
      })

    render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 3,
        preRollSeconds: 0.25,
        waitTimeoutMs: 6000,
      }),
    )
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
    ).toBeGreaterThan(0.74)
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
    ).toBeLessThan(0.76)
  })

  it('requests another partial slice before the current slice runs out', async () => {
    audioDecodeMocks.isPreviewAudioDecodePending.mockReturnValue(true)
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValueOnce({
      buffer: makeAudioBuffer(4),
      startTime: 0,
      isComplete: false,
    })
    const { rerender } = render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    await act(async () => {
      await Promise.resolve()
    })

    playbackStateMocks.current = {
      frame: 90,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
        volumeMultiplier={1.1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 3,
        preRollSeconds: 0.25,
        waitTimeoutMs: 6000,
      }),
    )
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
    ).toBeGreaterThan(2.9)
  })

  it('reuses an in-flight extension request while 1x playback advances within its coverage', async () => {
    const pendingExtension = createDeferred<{
      buffer: AudioBuffer
      startTime: number
      isComplete: boolean
    }>()

    audioDecodeMocks.isPreviewAudioDecodePending.mockReturnValue(true)
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(4),
        startTime: 0,
        isComplete: false,
      })
      .mockImplementationOnce(() => pendingExtension.promise)

    const { rerender } = render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      frame: 90,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
        volumeMultiplier={1.1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    playbackStateMocks.current = {
      frame: 102,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={300}
        volumeMultiplier={1.2}
      />,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
  })

  it('ignores stale slice responses after seeking again', async () => {
    const olderSeek = createDeferred<{
      buffer: AudioBuffer
      startTime: number
      isComplete: boolean
    }>()
    const latestSeek = createDeferred<{
      buffer: AudioBuffer
      startTime: number
      isComplete: boolean
    }>()

    audioDecodeMocks.isPreviewAudioDecodePending.mockReturnValue(true)
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback
      .mockResolvedValueOnce({
        buffer: makeAudioBuffer(4),
        startTime: 0,
        isComplete: false,
      })
      .mockImplementationOnce(() => olderSeek.promise)
      .mockImplementationOnce(() => latestSeek.promise)

    const { rerender } = render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={1800}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })

    playbackStateMocks.current = {
      frame: 600,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={1800}
        volumeMultiplier={1.1}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)
    })

    playbackStateMocks.current = {
      frame: 900,
      fps: 30,
      playing: true,
      resolvedVolume: 1,
      resolvedAudioEqStages: [],
    }

    rerender(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={1800}
        volumeMultiplier={1.2}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(3)
    })

    await act(async () => {
      latestSeek.resolve({
        buffer: makeAudioBuffer(4),
        startTime: 29,
        isComplete: false,
      })
      await Promise.resolve()
    })

    await act(async () => {
      olderSeek.resolve({
        buffer: makeAudioBuffer(4),
        startTime: 19,
        isComplete: false,
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(3)
  })

  it('prefetches only the latest paused seek target before playback starts', async () => {
    vi.useFakeTimers()
    try {
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValueOnce({
        buffer: makeAudioBuffer(10),
        startTime: 0,
        isComplete: false,
      })

      const { rerender } = render(
        <CustomDecoderBufferedAudio
          src="blob:audio"
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={1800}
        />,
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)

      playbackStateMocks.current = {
        frame: 600,
        fps: 30,
        playing: false,
        resolvedVolume: 1,
        resolvedAudioEqStages: [],
      }

      rerender(
        <CustomDecoderBufferedAudio
          src="blob:audio"
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={1800}
          volumeMultiplier={1.1}
        />,
      )

      playbackStateMocks.current = {
        frame: 900,
        fps: 30,
        playing: false,
        resolvedVolume: 1,
        resolvedAudioEqStages: [],
      }

      rerender(
        <CustomDecoderBufferedAudio
          src="blob:audio"
          mediaId="media-1"
          itemId="item-1"
          durationInFrames={1800}
          volumeMultiplier={1.2}
        />,
      )

      await act(async () => {
        vi.advanceTimersByTime(60)
        await Promise.resolve()
      })

      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(2)

      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]).toEqual(
        expect.objectContaining({
          minReadySeconds: 1,
          preRollSeconds: 0.25,
          waitTimeoutMs: 6000,
        }),
      )
      expect(
        audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
      ).toBeGreaterThan(29.9)
      expect(
        audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[1]?.[2]?.targetTimeSeconds,
      ).toBeLessThan(30.1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('seeds 1x playback from the trimmed start time', async () => {
    audioDecodeMocks.isPreviewAudioDecodePending.mockReturnValue(true)
    audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mockResolvedValueOnce({
      buffer: makeAudioBuffer(10),
      startTime: 0,
      isComplete: false,
    })

    render(
      <CustomDecoderBufferedAudio
        src="blob:audio"
        mediaId="media-1"
        itemId="item-1"
        durationInFrames={600}
        trimBefore={255}
      />,
    )

    await waitFor(() => {
      expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback).toHaveBeenCalledTimes(1)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        minReadySeconds: 1,
        preRollSeconds: 0.25,
        waitTimeoutMs: 6000,
      }),
    )
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]?.targetTimeSeconds,
    ).toBeGreaterThan(8.49)
    expect(
      audioDecodeMocks.getOrDecodeAudioSliceForPlayback.mock.calls[0]?.[2]?.targetTimeSeconds,
    ).toBeLessThan(8.51)
  })
})
