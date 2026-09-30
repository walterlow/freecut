import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export type WhisperModel = MediaTranscriptModel
export type QuantizationType = MediaTranscriptQuantization

// Which on-device ASR backend handles a job. Resolved per-job from the selected model +
// language + WebGPU availability (see `transcription-engine.ts`).
export type TranscriptionEngine = 'whisper' | 'parakeet'

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

/**
 * `downloading` and `preparing` are separate because they fail differently for the user: a
 * download reports bytes and can take minutes on a cold cache, while the ONNX graph compile
 * that follows reports nothing at all and can sit for ~20 s. Collapsing them into one
 * "loading" stage left the bar frozen mid-compile, which reads as a hang.
 */
export interface TranscribeProgress {
  stage: 'downloading' | 'preparing' | 'decoding' | 'transcribing'
  progress: number
  /** Bytes streamed so far across every model file. Only set while `downloading`. */
  receivedBytes?: number
  /** Total bytes expected across every model file. Only set while `downloading`. */
  totalBytes?: number
  /** True when every model file came from Cache Storage — nothing touched the network. */
  fromCache?: boolean
  /**
   * True when the stage cannot report a fraction, so `progress` only marks the band's floor.
   * Set while transcribing audio whose duration the decoder never reported.
   */
  indeterminate?: boolean
  /**
   * True when this event opens a transfer that was not part of the original download, so the
   * merge is allowed to rewind the bar back out of `preparing`.
   */
  restarted?: boolean
}

export interface TranscribeRuntimeInfo {
  backend?: 'webgpu' | 'wasm'
  estimatedBytes?: number
}

export interface TranscribeOptions {
  model?: WhisperModel
  language?: string
  quantization?: QuantizationType
  mediaId?: string
  fileName?: string
  workspaceName?: string
  onSegment?: (segment: TranscriptSegment) => void
  onProgress?: (event: TranscribeProgress) => void
  onRuntimeInfo?: (info: TranscribeRuntimeInfo) => void
}

export interface PCMChunk {
  samples: Float32Array
  timestamp: number
  final: boolean
  /**
   * Duration of the whole audio in seconds, so the ASR worker can report an absolute position
   * rather than per-chunk progress. `0` when the producer could not determine it (mediabunny
   * reports no duration for some containers).
   */
  totalDuration: number
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
  // Parakeet resolves its own ONNX assets inside the worker; this entry is the source repo
  // for reference and to satisfy the exhaustive model map.
  'parakeet-tdt-v3': 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx',
  'whisper-tiny': 'onnx-community/whisper-tiny_timestamped',
  'whisper-base': 'onnx-community/whisper-base_timestamped',
  'whisper-small': 'onnx-community/whisper-small_timestamped',
  'whisper-large': 'onnx-community/whisper-large-v3-turbo_timestamped',
}
