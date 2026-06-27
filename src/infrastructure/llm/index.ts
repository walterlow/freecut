/**
 * Public API for the on-device LLM layer. Consumers import the adapter contract
 * and the registry from here — never a concrete worker/adapter module.
 */

export type { LlmAdapter, LlmGenerateOptions, LlmLoadProgress, LlmMessage, LlmRole } from './types'
export {
  DEFAULT_LLM_ADAPTER_ID,
  getDefaultLlmAdapter,
  getLlmAdapter,
  listLlmAdapters,
} from './llm-registry'
