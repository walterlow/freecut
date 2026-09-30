import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiProviderId =
  | 'gemma'
  | 'ollama'
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'openrouter'
  | 'groq'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface ComfyUiConfig {
  baseUrl: string
}

export interface AiSettingsState {
  activeProvider: AiProviderId
  activeModel: string
  providers: Record<AiProviderId, ProviderConfig>
  comfyui: ComfyUiConfig
  discoveredModels: Record<string, string[]>

  // Actions
  setActiveProvider: (provider: AiProviderId) => void
  setActiveModel: (model: string) => void
  setProviderConfig: (provider: AiProviderId, config: Partial<ProviderConfig>) => void
  setDiscoveredModels: (provider: string, models: string[]) => void
  setComfyUiBaseUrl: (baseUrl: string) => void
  getActiveConfig: () => { provider: AiProviderId; config: ProviderConfig }
}

export const DEFAULT_AI_SETTINGS: Omit<
  AiSettingsState,
  'setActiveProvider' | 'setActiveModel' | 'setProviderConfig' | 'setDiscoveredModels' | 'setComfyUiBaseUrl' | 'getActiveConfig'
> = {
  activeProvider: 'gemini',
  activeModel: 'gemini-3.8-flash',
  discoveredModels: {},
  providers: {
    gemma: {
      model: 'gemma-4-on-device',
      baseUrl: '',
      apiKey: '',
    },
    ollama: {
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3.6:27b',
      apiKey: '',
    },
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.8-flash',
      apiKey: '',
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      apiKey: '',
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-4-sonnet-latest',
      apiKey: '',
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-v3',
      apiKey: '',
    },
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/auto',
      apiKey: '',
    },
    groq: {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      apiKey: '',
    },
  },
  comfyui: {
    baseUrl: 'http://127.0.0.1:8188',
  },
}

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_AI_SETTINGS,

      setActiveProvider: (provider) =>
        set((state) => ({
          activeProvider: provider,
          activeModel: state.providers[provider]?.model || DEFAULT_AI_SETTINGS.providers[provider]?.model || '',
        })),

      setActiveModel: (model) =>
        set((state) => ({
          activeModel: model,
          providers: {
            ...state.providers,
            [state.activeProvider]: {
              ...state.providers[state.activeProvider],
              model,
            },
          },
        })),

      setProviderConfig: (provider, config) =>
        set((state) => ({
          providers: {
            ...state.providers,
            [provider]: {
              ...state.providers[provider],
              ...config,
            },
          },
          ...(state.activeProvider === provider && config.model
            ? { activeModel: config.model }
            : {}),
        })),

      setDiscoveredModels: (provider, models) =>
        set((state) => ({
          discoveredModels: {
            ...state.discoveredModels,
            [provider]: models,
          },
        })),

      setComfyUiBaseUrl: (baseUrl) =>
        set((state) => ({
          comfyui: {
            ...state.comfyui,
            baseUrl: baseUrl.trim().replace(/\/+$/, ''),
          },
        })),

      getActiveConfig: () => {
        const state = get()
        return {
          provider: state.activeProvider,
          config: state.providers[state.activeProvider] ?? {},
        }
      },
    }),
    {
      name: 'freecut-ai-settings-v1',
    },
  ),
)
