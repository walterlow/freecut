import type { TranscriptSegment, TranscribeOptions } from '../types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { extract16kHzMonoWav, blobToBase64 } from './audio-encoder'
import { ExternalTranscribeStream } from './external-transcribe-stream'
import type { MediaTranscriber } from '../adapter-types'

export class GeminiTranscriber implements MediaTranscriber {
  constructor(private readonly defaultOptions?: TranscribeOptions) {}

  transcribe(file: File, runtimeOptions?: TranscribeOptions): ExternalTranscribeStream {
    const options = { ...this.defaultOptions, ...runtimeOptions }

    return new ExternalTranscribeStream(async (signal, onProgress) => {
      const { providers } = useAiSettingsStore.getState()
      const geminiConfig = providers.gemini
      const apiKey = geminiConfig?.apiKey?.trim()
      if (!apiKey) {
        throw new Error(
          'API Key de Google Gemini no configurada. Ve a Ajustes > IA para ingresar tu clave de Gemini.',
        )
      }

      const baseUrl = (
        geminiConfig?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'
      ).replace(/\/+$/, '')

      let rawModel = (options.model as string) || 'gemini-3.8-flash'
      if (rawModel.startsWith('gemini:')) {
        rawModel = rawModel.slice(7)
      }
      const model = rawModel.trim() || 'gemini-3.8-flash'

      onProgress?.({ stage: 'decoding', progress: 0.1 })

      const audioBlob = await extract16kHzMonoWav(file)
      if (signal.aborted) throw new Error('Transcripción cancelada')

      onProgress?.({ stage: 'downloading', progress: 0.3 })

      const base64Data = await blobToBase64(audioBlob)
      if (signal.aborted) throw new Error('Transcripción cancelada')

      onProgress?.({ stage: 'transcribing', progress: 0.5 })

      const langInstruction =
        options.language && options.language !== 'auto'
          ? `The spoken language is '${options.language}'. Transcribe accurately in that language.`
          : 'Detect the spoken language automatically.'

      const prompt = `You are a professional audio transcriber for video subtitling.
${langInstruction}
Transcribe the speech in this audio file verbatim with accurate start and end timestamps in seconds.
Return strictly a valid JSON array of objects representing subtitle segments.
Each object MUST have:
- "start": number in seconds (e.g. 0.0)
- "end": number in seconds (e.g. 2.45)
- "text": string (the transcribed words for this segment)
- "words": optional array of {"text": string, "start": number, "end": number}

Format example:
[
  { "start": 0.0, "end": 2.4, "text": "Bienvenido a FreeCut" },
  { "start": 2.5, "end": 4.8, "text": "Edición de video con inteligencia artificial" }
]
Output ONLY the JSON array. Do not include markdown codeblocks or commentary.`

      const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`

      const payload = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Data,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Error en API Google Gemini (${res.status}): ${errText || res.statusText}`)
      }

      onProgress?.({ stage: 'transcribing', progress: 0.9 })

      const data = await res.json()
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim()

      let parsed: unknown
      try {
        parsed = JSON.parse(cleanJson)
      } catch {
        // Fallback if parsing fails: create single segment with raw text
        return [
          {
            text: rawText.trim() || 'Audio transcrito',
            start: 0,
            end: 10,
          },
        ]
      }

      const rawSegments = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)?.segments)
          ? ((parsed as Record<string, unknown>).segments as unknown[])
          : []

      const segments: TranscriptSegment[] = []
      for (const item of rawSegments) {
        if (!item || typeof item !== 'object') continue
        const seg = item as Record<string, unknown>
        const text = typeof seg.text === 'string' ? seg.text.trim() : ''
        const start = typeof seg.start === 'number' ? seg.start : 0
        const end = typeof seg.end === 'number' ? seg.end : start + 2

        if (text) {
          segments.push({
            text,
            start,
            end,
            words: Array.isArray(seg.words)
              ? (seg.words as Array<Record<string, unknown>>).map((w) => ({
                  text: typeof w.text === 'string' ? w.text.trim() : '',
                  start: typeof w.start === 'number' ? w.start : start,
                  end: typeof w.end === 'number' ? w.end : end,
                }))
              : undefined,
          })
        }
      }

      onProgress?.({ stage: 'transcribing', progress: 1 })
      return segments
    }, options.onProgress)
  }
}
