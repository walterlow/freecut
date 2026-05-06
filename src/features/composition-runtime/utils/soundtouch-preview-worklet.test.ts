import { describe, expect, it } from 'vite-plus/test'
import { serializeAudioBufferForSoundTouchPreview } from './soundtouch-preview-worklet'

function makeAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? channels[0] ?? new Float32Array(0),
  } as unknown as AudioBuffer
}

describe('serializeAudioBufferForSoundTouchPreview', () => {
  it('copies stereo channels without resampling when sample rate already matches', () => {
    const buffer = makeAudioBuffer(
      [new Float32Array([0, 0.25, 0.5]), new Float32Array([1, 0.75, 0.5])],
      48000,
    )

    const serialized = serializeAudioBufferForSoundTouchPreview(buffer, 48000)

    expect(serialized.sampleRate).toBe(48000)
    expect(serialized.frameCount).toBe(3)
    expect(Array.from(serialized.leftChannel)).toEqual([0, 0.25, 0.5])
    expect(Array.from(serialized.rightChannel)).toEqual([1, 0.75, 0.5])
  })

  it('resamples mono buffers to the target sample rate and duplicates the channel', () => {
    const buffer = makeAudioBuffer([new Float32Array([0, 1, 0, -1])], 4)

    const serialized = serializeAudioBufferForSoundTouchPreview(buffer, 8)

    expect(serialized.sampleRate).toBe(8)
    expect(serialized.frameCount).toBe(8)
    expect(serialized.leftChannel.length).toBe(8)
    expect(serialized.rightChannel.length).toBe(8)
    expect(serialized.rightChannel[3]).toBeCloseTo(serialized.leftChannel[3] ?? 0, 5)
  })
})
