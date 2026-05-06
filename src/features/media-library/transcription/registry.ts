import { ProviderRegistry } from '@/shared/utils/provider-registry'
import type { MediaTranscriptModel } from '@/types/storage'
import { browserWhisperTranscriptionAdapter } from './browser-whisper-adapter'
import type { MediaTranscriptionAdapter, MediaTranscriptionModelOption } from './adapter-types'

export const DEFAULT_MEDIA_TRANSCRIPTION_ADAPTER_ID = browserWhisperTranscriptionAdapter.id

export const mediaTranscriptionAdapterRegistry = new ProviderRegistry<MediaTranscriptionAdapter>(
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

export function getMediaTranscriptionModelLabel(model: MediaTranscriptModel): string {
  return getDefaultMediaTranscriptionAdapter().getModelLabel(model)
}
