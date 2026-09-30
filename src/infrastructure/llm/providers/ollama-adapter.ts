import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '../types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('OllamaLlmAdapter')

export class OllamaLlmAdapter implements LlmAdapter {
  readonly id = 'ollama'
  readonly label = 'Ollama (Local LLM Server)'

  isSupported(): boolean {
    return true
  }

  async load(): Promise<void> {
    return Promise.resolve()
  }

  async generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    const { providers, activeModel } = useAiSettingsStore.getState()
    const config = providers.ollama
    const model = (config?.model || activeModel || 'llama3.1').trim()
    const baseUrl = (config?.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')

    const payload = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: options?.temperature ?? 0.7,
        num_predict: options?.maxTokens ?? 2048,
        top_p: options?.topP ?? 0.95,
      },
    }

    const url = `${baseUrl}/api/chat`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      logger.error('Ollama error response:', errText)
      throw new Error(`Error conectando con Ollama en ${baseUrl} (${response.status}): ${errText || 'Verifica que Ollama esté ejecutándose con ollama serve'}`)
    }

    if (!response.body) {
      throw new Error('La respuesta de Ollama no incluye flujo de datos.')
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
          if (!trimmed) continue

          try {
            const data = JSON.parse(trimmed)
            const token = data.message?.content
            if (typeof token === 'string' && token.length > 0) {
              accumulated += token
              options?.onToken?.(token, accumulated)
            }
          } catch {
            // Ignore incomplete JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return accumulated
  }

  async fetchInstalledModels(baseUrl?: string): Promise<string[]> {
    const targetUrl = (baseUrl || useAiSettingsStore.getState().providers.ollama?.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
    try {
      const res = await fetch(`${targetUrl}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) {
        throw new Error(`Ollama returned status ${res.status}`)
      }
      const data = await res.json()
      if (!Array.isArray(data?.models)) {
        return []
      }
      // Return models, prioritizing completion/chat models
      return data.models
        .map((m: { name?: string }) => m.name || '')
        .filter((name: string) => name.length > 0)
    } catch (err) {
      logger.warn('Failed to fetch installed Ollama models:', err)
      return []
    }
  }

  dispose(): void {}
}

export const ollamaLlmAdapter = new OllamaLlmAdapter()

export async function fetchOllamaModels(baseUrl?: string): Promise<string[]> {
  return ollamaLlmAdapter.fetchInstalledModels(baseUrl)
}

