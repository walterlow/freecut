import type { TranscriptSegment, TranscribeOptions } from '../types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { extract16kHzMonoWav } from './audio-encoder'
import { ExternalTranscribeStream } from './external-transcribe-stream'
import type { MediaTranscriber } from '../adapter-types'

export class GroqTranscriber implements MediaTranscriber {
  constructor(private readonly defaultOptions?: TranscribeOptions) {}

  transcribe(file: File, runtimeOptions?: TranscribeOptions): ExternalTranscribeStream {
    const options = { ...this.defaultOptions, ...runtimeOptions }

    return new ExternalTranscribeStream(async (signal, onProgress) => {
      const { providers } = useAiSettingsStore.getState()
      const groqConfig = providers.groq
      const apiKey = groqConfig?.apiKey?.trim()
      if (!apiKey) {
        throw new Error(
          'API Key de Groq no configurada. Ve a Ajustes > IA para ingresar tu clave de Groq (o usa el modelo del navegador).',
        )
      }

      const baseUrl = (groqConfig?.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')
      let rawModel = (options.model as string) || 'whisper-large-v3-turbo'
      if (rawModel.startsWith('groq:')) {
        rawModel = rawModel.slice(5)
      }
      const model = rawModel.trim() || 'whisper-large-v3-turbo'

      onProgress?.({ stage: 'decoding', progress: 0.1 })

      // Extract lightweight mono WAV
      const audioBlob = await extract16kHzMonoWav(file)
      if (signal.aborted) throw new Error('Transcripción cancelada')

      onProgress?.({ stage: 'downloading', progress: 0.3 })

      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.wav')
      formData.append('model', model)
      formData.append('response_format', 'verbose_json')
      formData.append('timestamp_granularities[]', 'segment')
      formData.append('timestamp_granularities[]', 'word')

      const lang = options.language?.trim().toLowerCase()
      if (lang && lang !== 'auto') {
        formData.append('language', lang)
      }

      onProgress?.({ stage: 'transcribing', progress: 0.5 })

      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Error en API Groq (${res.status}): ${errText || res.statusText}`)
      }

      onProgress?.({ stage: 'transcribing', progress: 0.9 })

      const data = await res.json()

      const segments: TranscriptSegment[] = []
      if (Array.isArray(data.segments) && data.segments.length > 0) {
        for (const seg of data.segments) {
          segments.push({
            text: (seg.text || '').trim(),
            start: typeof seg.start === 'number' ? seg.start : 0,
            end: typeof seg.end === 'number' ? seg.end : 0,
            words: Array.isArray(seg.words)
              ? seg.words.map((w: { word?: string; text?: string; start: number; end: number }) => ({
                  text: (w.word ?? w.text ?? '').trim(),
                  start: w.start,
                  end: w.end,
                }))
              : undefined,
          })
        }
      } else if (typeof data.text === 'string' && data.text.trim()) {
        segments.push({
          text: data.text.trim(),
          start: 0,
          end: typeof data.duration === 'number' ? data.duration : 10,
        })
      }

      onProgress?.({ stage: 'transcribing', progress: 1 })
      return segments
    }, options.onProgress)
  }
}
