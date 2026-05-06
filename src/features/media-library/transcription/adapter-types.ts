import type { MediaTranscriptModel } from '@/types/storage'
import type { TranscribeOptions } from './types'
import type { TranscribeStream } from './browser-transcriber'

export interface MediaTranscriptionModelOption {
  value: MediaTranscriptModel
  label: string
}

export interface MediaTranscriber {
  transcribe(file: File, runtimeOptions?: TranscribeOptions): TranscribeStream
}

export interface MediaTranscriptionAdapter {
  id: string
  label: string
  defaultModel: MediaTranscriptModel
  modelOptions: readonly MediaTranscriptionModelOption[]
  getModelLabel(model: MediaTranscriptModel): string
  createTranscriber(options?: TranscribeOptions): MediaTranscriber
}
