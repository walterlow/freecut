import { describe, expect, it } from 'vite-plus/test'
import { getWhisperWebGpuBatchSize } from './whisper-runtime-options'

describe('getWhisperWebGpuBatchSize', () => {
  it('runs Large Turbo windows serially to bound WebGPU memory', () => {
    expect(getWhisperWebGpuBatchSize('onnx-community/whisper-large-v3-turbo_timestamped')).toBe(1)
  })

  it('uses a conservative batch for Whisper Small', () => {
    expect(getWhisperWebGpuBatchSize('onnx-community/whisper-small_timestamped')).toBe(4)
  })

  it('keeps the fast batch for smaller Whisper models', () => {
    expect(getWhisperWebGpuBatchSize('onnx-community/whisper-base_timestamped')).toBe(8)
    expect(getWhisperWebGpuBatchSize('onnx-community/whisper-tiny_timestamped')).toBe(8)
  })
})
