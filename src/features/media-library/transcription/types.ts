import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export type WhisperModel = MediaTranscriptModel
export type QuantizationType = MediaTranscriptQuantization

export interface TranscriptSegment {
  text: string
  start: number
  end: number
  words?: TranscriptWord[]
}

export interface TranscriptWord {
  text: string
  start: number
  end: number
  confidence?: number
}

export interface TranscribeProgress {
  stage: 'loading' | 'decoding' | 'transcribing'
  progress: number
}

export interface TranscribeRuntimeInfo {
  backend?: 'webgpu' | 'wasm'
  estimatedBytes?: number
}

export interface TranscribeOptions {
  model?: WhisperModel
  language?: string
  quantization?: QuantizationType
  onSegment?: (segment: TranscriptSegment) => void
  onProgress?: (event: TranscribeProgress) => void
  onRuntimeInfo?: (info: TranscribeRuntimeInfo) => void
}

export interface PCMChunk {
  samples: Float32Array
  timestamp: number
  final: boolean
}

export type MainThreadMessage =
  | { type: 'ready' }
  | { type: 'done' }
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'progress'; event: TranscribeProgress }
  | { type: 'runtime'; info: TranscribeRuntimeInfo }
  | { type: 'error'; message: string }

export type WhisperWorkerMessage =
  | { type: 'port'; port: MessagePort }
  | {
      type: 'init'
      modelId: string
      language?: string
      quantization?: QuantizationType
    }
  | { type: 'pause' }
  | { type: 'resume' }

export const MODEL_IDS: Record<WhisperModel, string> = {
  'whisper-tiny': 'onnx-community/whisper-tiny_timestamped',
  'whisper-base': 'onnx-community/whisper-base_timestamped',
  'whisper-small': 'onnx-community/whisper-small_timestamped',
  'whisper-large': 'onnx-community/whisper-large-v3-turbo_timestamped',
}
