import { LOCAL_INFERENCE_UNLOADED_MESSAGE } from '@/shared/state/local-inference'

export const TRANSCRIPTION_CANCELLED_MESSAGE = 'Transcription cancelled'

export function isTranscriptionCancellationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === TRANSCRIPTION_CANCELLED_MESSAGE ||
      error.message === LOCAL_INFERENCE_UNLOADED_MESSAGE)
  )
}

const OOM_PATTERNS = [
  /out of memory/i,
  /\boom\b/i,
  /insufficient memory/i,
  /allocation failed/i,
  /failed to allocate/i,
  /cannot allocate/i,
  /memory allocation/i,
  /array buffer allocation/i,
  /device lost/i,
  /webgpu.*buffer/i,
  /createbuffer/i,
  /wasm memory/i,
  /maximum.*memory/i,
]

export function isTranscriptionOutOfMemoryError(error: unknown): boolean {
  // RangeError from buffer allocation is the clearest OOM signal from browsers.
  if (error instanceof RangeError) return true

  if (!(error instanceof Error)) {
    if (typeof error === 'string') {
      return OOM_PATTERNS.some((pattern) => pattern.test(error))
    }
    return false
  }

  const message = `${error.message} ${error.name}`
  return OOM_PATTERNS.some((pattern) => pattern.test(message))
}

export const TRANSCRIPTION_OOM_HINT =
  'The model ran out of memory. Try a lower quantization (q8 or q4) or a smaller model in Settings → Whisper, then try again.'
