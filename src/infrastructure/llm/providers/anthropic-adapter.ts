import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '../types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('AnthropicLlmAdapter')

export class AnthropicLlmAdapter implements LlmAdapter {
  readonly id = 'anthropic'
  readonly label = 'Anthropic Claude (Cloud API)'

  isSupported(): boolean {
    return true
  }

  async load(): Promise<void> {
    return Promise.resolve()
  }

  async generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    const { providers, activeModel } = useAiSettingsStore.getState()
    const config = providers.anthropic
    const apiKey = config?.apiKey?.trim()
    const model = (config?.model || activeModel || 'claude-4-sonnet-latest').trim()
    const baseUrl = (config?.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '')

    if (!apiKey) {
      throw new Error('Anthropic API Key no configurada. Ve a Ajustes > IA para ingresar tu clave de Claude.')
    }

    const systemMessages = messages.filter((m) => m.role === 'system')
    const chatMessages = messages.filter((m) => m.role !== 'system')

    const system = systemMessages.length > 0 ? systemMessages.map((m) => m.content).join('\n\n') : undefined

    const payload = {
      model,
      ...(system ? { system } : {}),
      messages: chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens ?? 2048,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    }

    const url = `${baseUrl}/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-browser': 'true',
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      logger.error('Anthropic error response:', errText)
      throw new Error(`Error en Anthropic Claude (${response.status}): ${errText || response.statusText}`)
    }

    if (!response.body) {
      throw new Error('La respuesta de Anthropic no incluye flujo de datos.')
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
          if (!jsonStr) continue

          try {
            const data = JSON.parse(jsonStr)
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
              const delta = data.delta.text
              if (typeof delta === 'string' && delta.length > 0) {
                accumulated += delta
                options?.onToken?.(delta, accumulated)
              }
            }
          } catch {
            // Ignore incomplete chunks
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

export const anthropicLlmAdapter = new AnthropicLlmAdapter()
