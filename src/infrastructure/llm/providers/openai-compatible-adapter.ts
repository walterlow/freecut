import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '../types'
import { useAiSettingsStore, type AiProviderId } from '@/shared/state/ai-settings-store'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('OpenAiCompatibleLlmAdapter')

export class OpenAiCompatibleLlmAdapter implements LlmAdapter {
  constructor(
    readonly id: AiProviderId,
    readonly label: string,
    private readonly defaultBaseUrl: string,
    private readonly defaultModel: string,
  ) {}

  isSupported(): boolean {
    return true
  }

  async load(): Promise<void> {
    return Promise.resolve()
  }

  async generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    const { providers } = useAiSettingsStore.getState()
    const config = providers[this.id]
    const apiKey = config?.apiKey?.trim()
    const model = (config?.model || this.defaultModel).trim()
    const baseUrl = (config?.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')

    if (!apiKey && this.id !== 'ollama') {
      throw new Error(
        `Clave de API no configurada para ${this.label}. Ve a Ajustes > IA para configurar tu API Key.`
      )
    }

    const payload = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      top_p: options?.topP ?? 0.95,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    if (this.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://freecut.net'
      headers['X-Title'] = 'FreeCut Web Editor'
    }

    const url = `${baseUrl}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      logger.error(`${this.label} error response:`, errText)
      throw new Error(`Error en ${this.label} (${response.status}): ${errText || response.statusText}`)
    }

    if (!response.body) {
      throw new Error(`La respuesta de ${this.label} no incluye flujo de datos.`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let accumulated = ''
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const jsonStr = trimmed.slice(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') continue

          try {
            const data = JSON.parse(jsonStr)
            const delta = data.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta.length > 0) {
              accumulated += delta
              options?.onToken?.(delta, accumulated)
            }
          } catch {
            // Ignore incomplete stream chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return accumulated
  }

  dispose(): void {}
}

export const openaiLlmAdapter = new OpenAiCompatibleLlmAdapter(
  'openai',
  'OpenAI (GPT-5 / o3 / GPT-4o)',
  'https://api.openai.com/v1',
  'gpt-5',
)

export const deepseekLlmAdapter = new OpenAiCompatibleLlmAdapter(
  'deepseek',
  'DeepSeek API (V3 / R1)',
  'https://api.deepseek.com/v1',
  'deepseek-v3',
)

export const openrouterLlmAdapter = new OpenAiCompatibleLlmAdapter(
  'openrouter',
  'OpenRouter (Multi-Model Cloud)',
  'https://openrouter.ai/api/v1',
  'openrouter/auto',
)

export const groqLlmAdapter = new OpenAiCompatibleLlmAdapter(
  'groq',
  'Groq (Llama / Ultra-Fast)',
  'https://api.groq.com/openai/v1',
  'llama-3.3-70b-versatile',
)

export async function fetchOpenAiCompatibleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const cleanKey = apiKey.trim()
  const cleanUrl = baseUrl.replace(/\/+$/, '')
  if (!cleanKey) return []
  try {
    const res = await fetch(`${cleanUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    if (Array.isArray(data?.data)) {
      return data.data
        .map((m: { id?: string }) => m.id || '')
        .filter((id: string) => id.length > 0)
    }
    return []
  } catch {
    return []
  }
}
