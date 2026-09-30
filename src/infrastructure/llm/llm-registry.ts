/**
 * Registry of LLM adapters (local on-device, local servers like Ollama, and Cloud APIs).
 * Callers resolve adapters by id or request the active default according to user settings.
 */

import { ProviderRegistry } from '@/shared/utils/provider-registry'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { gemmaLlmAdapter } from './gemma-llm-adapter'
import { ollamaLlmAdapter } from './providers/ollama-adapter'
import { geminiLlmAdapter } from './providers/gemini-adapter'
import {
  openaiLlmAdapter,
  deepseekLlmAdapter,
  openrouterLlmAdapter,
  groqLlmAdapter,
} from './providers/openai-compatible-adapter'
import { anthropicLlmAdapter } from './providers/anthropic-adapter'
import type { LlmAdapter } from './types'

export const DEFAULT_LLM_ADAPTER_ID = 'gemini'

const allAdapters: LlmAdapter[] = [
  geminiLlmAdapter,
  ollamaLlmAdapter,
  openaiLlmAdapter,
  anthropicLlmAdapter,
  deepseekLlmAdapter,
  openrouterLlmAdapter,
  groqLlmAdapter,
  gemmaLlmAdapter,
]

const llmAdapterRegistry = new ProviderRegistry<LlmAdapter>(
  allAdapters,
  DEFAULT_LLM_ADAPTER_ID,
)

export function getDefaultLlmAdapter(): LlmAdapter {
  const activeId = useAiSettingsStore.getState().activeProvider
  try {
    return llmAdapterRegistry.get(activeId)
  } catch {
    return llmAdapterRegistry.getDefault()
  }
}

export function getLlmAdapter(id: string): LlmAdapter {
  return llmAdapterRegistry.get(id)
}

export function listLlmAdapters(): readonly LlmAdapter[] {
  return llmAdapterRegistry.list()
}
