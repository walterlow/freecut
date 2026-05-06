const TTS_ENGINE_STORAGE_KEY = 'editor:ttsEngine'
export type StoredTtsEngine = 'kokoro' | 'moss'

const DEFAULT_TTS_ENGINE: StoredTtsEngine = 'kokoro'

function isStoredTtsEngine(value: string): value is StoredTtsEngine {
  return value === 'kokoro' || value === 'moss'
}

export function getStoredTtsEngine(): StoredTtsEngine {
  try {
    const value = localStorage.getItem(TTS_ENGINE_STORAGE_KEY)
    return value && isStoredTtsEngine(value) ? value : DEFAULT_TTS_ENGINE
  } catch {
    return DEFAULT_TTS_ENGINE
  }
}

export function setStoredTtsEngine(engine: StoredTtsEngine): void {
  try {
    localStorage.setItem(TTS_ENGINE_STORAGE_KEY, engine)
  } catch {
    // ignore persistence failures
  }
}
