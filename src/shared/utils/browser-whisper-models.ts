import type { MediaTranscriptModel } from '@/types/storage'

export const DEFAULT_BROWSER_WHISPER_MODEL: MediaTranscriptModel = 'whisper-small'

export const BROWSER_WHISPER_MODEL_LABELS: Record<MediaTranscriptModel, string> = {
  'whisper-tiny': 'Tiny',
  'whisper-base': 'Base',
  'whisper-small': 'Small',
  'whisper-large': 'Large v3 Turbo',
}

export const BROWSER_WHISPER_MODEL_OPTIONS = [
  { value: 'whisper-base', label: BROWSER_WHISPER_MODEL_LABELS['whisper-base'] },
  { value: 'whisper-small', label: BROWSER_WHISPER_MODEL_LABELS['whisper-small'] },
  { value: 'whisper-large', label: BROWSER_WHISPER_MODEL_LABELS['whisper-large'] },
] as const satisfies ReadonlyArray<{
  value: MediaTranscriptModel
  label: string
}>

const SELECTABLE_BROWSER_WHISPER_MODELS = new Set<MediaTranscriptModel>(
  BROWSER_WHISPER_MODEL_OPTIONS.map((option) => option.value),
)

export function normalizeSelectableBrowserWhisperModel(
  model: MediaTranscriptModel | undefined,
): MediaTranscriptModel {
  if (!model) {
    return DEFAULT_BROWSER_WHISPER_MODEL
  }

  return SELECTABLE_BROWSER_WHISPER_MODELS.has(model) ? model : DEFAULT_BROWSER_WHISPER_MODEL
}
