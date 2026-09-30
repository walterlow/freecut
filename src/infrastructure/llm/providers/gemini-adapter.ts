import type { LlmAdapter, LlmGenerateOptions, LlmMessage } from '../types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('GeminiLlmAdapter')

export class GeminiLlmAdapter implements LlmAdapter {
  readonly id = 'gemini'
  readonly label = 'Google Gemini (Cloud API)'

  isSupported(): boolean {
    return true
  }

  async load(): Promise<void> {
    // Cloud adapter has zero initial weight download
    return Promise.resolve()
  }

  async generate(messages: LlmMessage[], options?: LlmGenerateOptions): Promise<string> {
    const { providers, activeModel } = useAiSettingsStore.getState()
    const config = providers.gemini
    const apiKey = config?.apiKey?.trim()
    const model = (config?.model || activeModel || 'gemini-3.8-flash').trim()
    const baseUrl = (config?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')

    if (!apiKey) {
      throw new Error('Gemini API Key no configurada. Ve a Ajustes > IA para ingresar tu clave de Google Gemini.')
    }

    // Separate system messages from conversation history
    const systemMessages = messages.filter((m) => m.role === 'system')
    const chatMessages = messages.filter((m) => m.role !== 'system')

    const systemInstruction = systemMessages.length > 0
      ? { parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }] }
      : undefined

    const contents = chatMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`
    const payload = {
      ...(systemInstruction ? { systemInstruction } : {}),
      contents,
      generationConfig: {
        temperature: options?.temperature ?? 0.7,
        maxOutputTokens: options?.maxTokens ?? 2048,
        topP: options?.topP ?? 0.95,
      },
    }

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
      logger.error('Gemini error response:', errText)
      throw new Error(`Error en API de Gemini (${response.status}): ${errText || response.statusText}`)
    }

    if (!response.body) {
      throw new Error('La respuesta de Gemini no incluye cuerpo de datos.')
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
            const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text
            if (typeof textPart === 'string' && textPart.length > 0) {
              accumulated += textPart
              options?.onToken?.(textPart, accumulated)
            }
          } catch {
            // Ignore incomplete chunks in stream
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return accumulated
  }

  dispose(): void {
    // Cloud adapter has no persistent worker
  }
}

export const geminiLlmAdapter = new GeminiLlmAdapter()

export async function fetchGeminiModels(apiKey: string, baseUrl = 'https://generativelanguage.googleapis.com/v1beta'): Promise<string[]> {
  const cleanKey = apiKey.trim()
  if (!cleanKey) return []
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models?key=${cleanKey}`)
    if (!res.ok) return []
    const data = await res.json()
    if (Array.isArray(data?.models)) {
      return data.models
        .map((m: { name?: string }) => m.name?.replace(/^models\//, '') || '')
        .filter((n: string) => n.length > 0 && !n.includes('embedding') && !n.includes('aqa') && !n.includes('imagen'))
    }
    return []
  } catch {
    return []
  }
}
