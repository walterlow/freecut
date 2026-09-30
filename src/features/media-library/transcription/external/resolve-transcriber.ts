import type { MediaTranscriptModel } from '@/types/storage'
import type { MediaTranscriber } from '../adapter-types'
import type { TranscribeOptions } from '../types'
import { BrowserTranscriber } from '../browser-transcriber'
import { GroqTranscriber } from './groq-transcriber'
import { OpenAiTranscriber } from './openai-transcriber'
import { GeminiTranscriber } from './gemini-transcriber'
import { WhisperLocalTranscriber } from './whisper-local-transcriber'
import { ComfyUiTranscriber } from './comfyui-transcriber'

export function resolveMediaTranscriber(
  model?: MediaTranscriptModel,
  options?: TranscribeOptions,
): MediaTranscriber {
  const modelStr = (model || '') as string

  if (modelStr.startsWith('whisper-local:') || modelStr.startsWith('ollama:')) {
    return new WhisperLocalTranscriber(options)
  }
  if (modelStr.startsWith('comfyui:')) {
    return new ComfyUiTranscriber(options)
  }
  if (modelStr.startsWith('groq:')) {
    return new GroqTranscriber(options)
  }
  if (modelStr.startsWith('openai:')) {
    return new OpenAiTranscriber(options)
  }
  if (modelStr.startsWith('gemini:')) {
    return new GeminiTranscriber(options)
  }

  return new BrowserTranscriber(options)
}

export function formatMediaTranscriptionModelLabel(model: MediaTranscriptModel): string {
  const modelStr = model as string
  if (modelStr.startsWith('whisper-local:')) {
    return `Whisper Local (${modelStr.slice(14)})`
  }
  if (modelStr.startsWith('comfyui:')) {
    return `ComfyUI (${modelStr.slice(8)})`
  }
  if (modelStr.startsWith('groq:')) {
    return `Groq (${modelStr.slice(5)})`
  }
  if (modelStr.startsWith('openai:')) {
    return `OpenAI (${modelStr.slice(7)})`
  }
  if (modelStr.startsWith('gemini:')) {
    return `Gemini (${modelStr.slice(7)})`
  }
  return modelStr
}
