import type { MediaTranscriptModel } from '@/types/storage'
import { BrowserTranscriber } from './browser-transcriber'
import {
  BROWSER_WHISPER_MODEL_LABELS,
  BROWSER_WHISPER_MODEL_OPTIONS,
  DEFAULT_BROWSER_WHISPER_MODEL,
} from '@/shared/utils/browser-whisper-models'
import type { MediaTranscriptionAdapter, MediaTranscriber } from './adapter-types'
import type { TranscribeOptions } from './types'

export const BROWSER_WHISPER_TRANSCRIPTION_ADAPTER_ID = 'browser-whisper'

export const browserWhisperTranscriptionAdapter: MediaTranscriptionAdapter = {
  id: BROWSER_WHISPER_TRANSCRIPTION_ADAPTER_ID,
  label: 'Browser Whisper',
  defaultModel: DEFAULT_BROWSER_WHISPER_MODEL,
  modelOptions: BROWSER_WHISPER_MODEL_OPTIONS,
  getModelLabel(model: MediaTranscriptModel): string {
    return BROWSER_WHISPER_MODEL_LABELS[model] ?? model
  },
  createTranscriber(options?: TranscribeOptions): MediaTranscriber {
    return new BrowserTranscriber(options)
  },
}
