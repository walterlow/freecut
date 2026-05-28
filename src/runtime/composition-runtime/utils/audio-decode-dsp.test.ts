import { describe, expect, it } from 'vite-plus/test'
import {
  assembleChannelChunks,
  downmixToStereo,
  downsampleStereo,
  float32ToInt16,
  int16ToFloat32,
  int16ToFloat32Into,
  produceDecodedBin,
} from './audio-decode-dsp'

describe('audio-decode-dsp', () => {
  it('round-trips Float32 -> Int16 -> Float32 within quantization error', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1, 0.123, -0.987])
    const back = int16ToFloat32(float32ToInt16(input))
    for (let i = 0; i < input.length; i++) {
      expect(Math.abs(back[i]! - input[i]!)).toBeLessThan(1 / 0x7fff + 1e-6)
    }
  })

  it('int16ToFloat32Into writes the same values as int16ToFloat32 at an offset', () => {
    const int16 = float32ToInt16(new Float32Array([0, 0.5, -0.5, 1, -1, 0.123]))
    const expected = int16ToFloat32(int16)
    const dst = new Float32Array(int16.length + 3)
    int16ToFloat32Into(int16, dst, 3)
    for (let i = 0; i < int16.length; i++) {
      expect(dst[3 + i]).toBe(expected[i])
    }
    expect(dst[0]).toBe(0)
  })

  it('clamps out-of-range float samples before Int16 conversion', () => {
    const int16 = float32ToInt16(new Float32Array([2, -2]))
    expect(int16[0]).toBe(0x7fff)
    expect(int16[1]).toBe(-0x8000)
  })

  it('passes mono/stereo through downmix unchanged', () => {
    const left = new Float32Array([0.1, 0.2])
    const right = new Float32Array([0.3, 0.4])
    const mono = downmixToStereo([left], 2)
    expect(mono.left).toBe(left)
    expect(mono.right).toBe(left)

    const stereo = downmixToStereo([left, right], 2)
    expect(stereo.left).toBe(left)
    expect(stereo.right).toBe(right)
  })

  it('downmixes 5.1 with ITU center/surround coefficients', () => {
    const frames = 1
    const L = new Float32Array([1])
    const R = new Float32Array([1])
    const C = new Float32Array([1])
    const LFE = new Float32Array([1])
    const Ls = new Float32Array([1])
    const Rs = new Float32Array([1])
    const { left, right } = downmixToStereo([L, R, C, LFE, Ls, Rs], frames)
    // L + C*0.7071 + Ls*0.7071 (LFE discarded)
    expect(left[0]).toBeCloseTo(1 + 0.7071 + 0.7071, 5)
    expect(right[0]).toBeCloseTo(1 + 0.7071 + 0.7071, 5)
  })

  it('returns inputs unchanged when source rate is at or below target', () => {
    const left = new Float32Array([0.1, 0.2, 0.3])
    const right = new Float32Array([0.4, 0.5, 0.6])
    const result = downsampleStereo(left, right, 22050, 22050)
    expect(result.left).toBe(left)
    expect(result.right).toBe(right)
    expect(result.frames).toBe(3)
    expect(result.sampleRate).toBe(22050)
  })

  it('downsamples by the rate ratio with linear interpolation', () => {
    const left = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7])
    const right = new Float32Array(left)
    const result = downsampleStereo(left, right, 48000, 24000)
    expect(result.sampleRate).toBe(24000)
    expect(result.frames).toBe(4)
    // ratio 0.5 -> output[i] samples input at 2i: 0, 2, 4, 6
    expect(Array.from(result.left)).toEqual([0, 2, 4, 6])
  })

  it('assembles chunks into a contiguous channel', () => {
    const out = assembleChannelChunks([new Float32Array([1, 2]), new Float32Array([3, 4, 5])], 5)
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5])
  })

  it('produces an Int16 bin from accumulated chunks', () => {
    const bin = produceDecodedBin(
      2,
      [new Float32Array([0.5, -0.5])],
      [new Float32Array([0.25, -0.25])],
      2,
      22050,
      22050,
    )
    expect(bin.binIndex).toBe(2)
    expect(bin.frames).toBe(2)
    expect(bin.sampleRate).toBe(22050)
    expect(bin.left).toBeInstanceOf(Int16Array)
    expect(bin.left.length).toBe(2)
    expect(bin.right.length).toBe(2)
    expect(bin.left[0]).toBe(new Int16Array([0.5 * 0x7fff])[0])
  })
})
