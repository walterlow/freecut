import { kokoroTtsService, type KokoroTtsModel, type KokoroTtsVoice } from './kokoro-tts-service'
import { mossTtsService, type MossTtsVoice } from './moss-tts-service'
import {
  supertonicTtsService,
  type SupertonicTtsLanguageSelection,
  type SupertonicTtsVoice,
} from './supertonic-tts-service'
import type { StoredTtsEngine } from '@/shared/utils/tts-settings'

export interface TtsGenerateInput {
  engine: StoredTtsEngine
  text: string
  /** Voice id selected for `engine`; each generator narrows it to its own voice union. */
  voice: string
  language: SupertonicTtsLanguageSelection
  speed: number
  model: KokoroTtsModel
  onProgress: (message: string) => void
}

export interface TtsGenerateOutput {
  blob: Blob
  file: File
  duration: number
}

export type TtsGenerationOutcome =
  | { ok: true; output: TtsGenerateOutput }
  | { ok: false; message: string }

const ENGINE_GENERATORS: Record<
  StoredTtsEngine,
  (input: TtsGenerateInput) => Promise<TtsGenerateOutput>
> = {
  kokoro: ({ text, voice, speed, model, onProgress }) =>
    kokoroTtsService.generateSpeechFile({
      text,
      voice: voice as KokoroTtsVoice,
      speed,
      model,
      onProgress,
    }),
  moss: ({ text, voice, speed, onProgress }) =>
    mossTtsService.generateSpeechFile({
      text,
      voice: voice as MossTtsVoice,
      speed,
      onProgress,
    }),
  supertonic: ({ text, voice, language, speed, onProgress }) =>
    supertonicTtsService.generateSpeechFile({
      text,
      voice: voice as SupertonicTtsVoice,
      language,
      speed,
      onProgress,
    }),
}

/**
 * Synthesize `input` with the engine's service, reporting failures as a value so the
 * caller can keep its own progress/session bookkeeping in one place.
 */
export async function generateTtsAudio(
  input: TtsGenerateInput,
  fallbackMessage: string,
): Promise<TtsGenerationOutcome> {
  try {
    return { ok: true, output: await ENGINE_GENERATORS[input.engine](input) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : fallbackMessage,
    }
  }
}
