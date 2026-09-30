import { ProviderRegistry } from '@/shared/utils/provider-registry'
import type { MediaTranscriptModel } from '@/types/storage'
import { browserWhisperTranscriptionAdapter } from './browser-whisper-adapter'
import type { MediaTranscriptionAdapter, MediaTranscriptionModelOption } from './adapter-types'

const DEFAULT_MEDIA_TRANSCRIPTION_ADAPTER_ID = browserWhisperTranscriptionAdapter.id

const mediaTranscriptionAdapterRegistry = new ProviderRegistry<MediaTranscriptionAdapter>(
  [browserWhisperTranscriptionAdapter],
  DEFAULT_MEDIA_TRANSCRIPTION_ADAPTER_ID,
)

export function getDefaultMediaTranscriptionAdapter(): MediaTranscriptionAdapter {
  return mediaTranscriptionAdapterRegistry.getDefault()
}

export function getMediaTranscriptionModelOptions(): readonly MediaTranscriptionModelOption[] {
  return getDefaultMediaTranscriptionAdapter().modelOptions
}

export function getDefaultMediaTranscriptionModel(): MediaTranscriptModel {
  return getDefaultMediaTranscriptionAdapter().defaultModel
}

import { formatMediaTranscriptionModelLabel } from './external/resolve-transcriber'

export function getMediaTranscriptionModelLabel(model: MediaTranscriptModel): string {
  const modelStr = model as string
  if (
    modelStr.startsWith('ollama:') ||
    modelStr.startsWith('groq:') ||
    modelStr.startsWith('openai:') ||
    modelStr.startsWith('gemini:')
  ) {
    return formatMediaTranscriptionModelLabel(model)
  }
  return getDefaultMediaTranscriptionAdapter().getModelLabel(model)
}
