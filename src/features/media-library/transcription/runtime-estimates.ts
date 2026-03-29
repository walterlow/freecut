import { WHISPER_MODEL_LABELS } from '@/shared/utils/whisper-settings';
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';

const MIB = 1024 * 1024;

const WHISPER_MODEL_BASE_ESTIMATES_MIB: Record<MediaTranscriptModel, number> = {
  'whisper-tiny': 220,
  'whisper-base': 420,
  'whisper-small': 900,
  'whisper-large': 2_600,
};

const QUANTIZATION_MULTIPLIER: Record<MediaTranscriptQuantization, number> = {
  hybrid: 0.65,
  fp32: 1,
  fp16: 0.62,
  q8: 0.58,
  q4: 0.38,
};

const QUANTIZATION_LABELS: Record<MediaTranscriptQuantization, string> = {
  hybrid: 'Hybrid',
  fp32: 'FP32',
  fp16: 'FP16',
  q8: 'Q8',
  q4: 'Q4',
};

export function estimateWhisperRuntimeBytes(
  model: MediaTranscriptModel,
  quantization: MediaTranscriptQuantization,
): number {
  return Math.round(
    WHISPER_MODEL_BASE_ESTIMATES_MIB[model] * QUANTIZATION_MULTIPLIER[quantization] * MIB
  );
}

export function formatWhisperRuntimeModelLabel(
  model: MediaTranscriptModel,
  quantization: MediaTranscriptQuantization,
): string {
  return `${WHISPER_MODEL_LABELS[model]} · ${QUANTIZATION_LABELS[quantization]}`;
}
