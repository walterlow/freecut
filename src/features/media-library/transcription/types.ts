import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';

export type WhisperModel = MediaTranscriptModel;
export type QuantizationType = MediaTranscriptQuantization;

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeProgress {
  stage: 'loading' | 'decoding' | 'transcribing';
  progress: number;
}

export interface TranscribeRuntimeInfo {
  backend?: 'webgpu' | 'wasm';
  estimatedBytes?: number;
}

export interface TranscribeOptions {
  model?: WhisperModel;
  language?: string;
  quantization?: QuantizationType;
  onSegment?: (segment: TranscriptSegment) => void;
  onProgress?: (event: TranscribeProgress) => void;
  onRuntimeInfo?: (info: TranscribeRuntimeInfo) => void;
}

export interface PCMChunk {
  samples: Float32Array;
  timestamp: number;
  final: boolean;
}

export type MainThreadMessage =
  | { type: 'ready' }
  | { type: 'done' }
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'progress'; event: TranscribeProgress }
  | { type: 'runtime'; info: TranscribeRuntimeInfo }
  | { type: 'error'; message: string };

export type WhisperWorkerMessage =
  | { type: 'port'; port: MessagePort }
  | {
      type: 'init';
      modelId: string;
      language?: string;
      quantization?: QuantizationType;
    };

export const MODEL_IDS: Record<WhisperModel, string> = {
  'whisper-tiny': 'onnx-community/whisper-tiny',
  'whisper-base': 'onnx-community/whisper-base',
  'whisper-small': 'onnx-community/whisper-small',
  'whisper-large': 'onnx-community/whisper-large-v3-turbo',
};
