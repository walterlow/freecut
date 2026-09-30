import type { TranscribeOptions } from '../types'
import { ExternalTranscribeStream } from './external-transcribe-stream'
import type { MediaTranscriber } from '../adapter-types'

export class WhisperLocalTranscriber implements MediaTranscriber {
  constructor(private readonly defaultOptions?: TranscribeOptions) {}

  transcribe(file: File, runtimeOptions?: TranscribeOptions): ExternalTranscribeStream {
    const options = { ...this.defaultOptions, ...runtimeOptions }

    return new ExternalTranscribeStream(async (signal, onProgress) => {
      let rawModel = (options.model as string) || 'large-v3-turbo'
      if (rawModel.startsWith('whisper-local:')) {
        rawModel = rawModel.slice(14)
      }
      const model = rawModel.trim() || 'large-v3-turbo'
      const language = options.language?.trim() || 'auto'

      onProgress?.({ stage: 'downloading', progress: 0.1 })

      // Check status of local service
      try {
        const statusRes = await fetch('/api/whisper/status', { signal })
        if (!statusRes.ok) {
          throw new Error(
            `El servicio local de Whisper no respondió correctamente (${statusRes.status}).`,
          )
        }
        const statusData = (await statusRes.json()) as { available?: boolean }
        if (!statusData?.available) {
          throw new Error('El servicio local de Whisper no está disponible.')
        }
      } catch (err) {
        if (signal.aborted) throw new Error('Transcripción cancelada')
        throw new Error(
          `No se pudo conectar con el servicio local de Whisper de FreeCut: ${err instanceof Error ? err.message : String(err)}. Asegúrate de que el servidor de FreeCut esté en ejecución.`,
        )
      }

      onProgress?.({ stage: 'decoding', progress: 0.25 })

      // Abort controller listener to cancel server job immediately if user cancels
      const abortHandler = () => {
        void fetch('/api/whisper/cancel', { method: 'POST' }).catch(() => {})
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      try {
        onProgress?.({ stage: 'transcribing', progress: 0.4 })

        const mediaId = options.mediaId
        const fileName = options.fileName || file.name
        const workspaceName = options.workspaceName

        let res: Response | null = null

        // 1. Try direct in-place local file transcription if mediaId & fileName are known
        if (mediaId && fileName) {
          try {
            const directRes = await fetch('/api/whisper/transcribe', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                mediaId,
                fileName,
                workspaceName,
                model,
                language,
                device: 'auto',
              }),
              signal,
            })

            if (directRes.ok) {
              res = directRes
            } else {
              const errData = await directRes.json().catch(() => ({}))
              if (!errData?.notFound) {
                const errorMsg = (errData as { error?: string })?.error || directRes.statusText
                throw new Error(`Error en Whisper Local (${directRes.status}): ${errorMsg}`)
              }
            }
          } catch (directErr) {
            if (signal.aborted) throw directErr
            if (directErr instanceof Error && !directErr.message.includes('404')) {
              throw directErr
            }
          }
        }

        // 2. Fall back to streaming upload if direct file was not used or not found
        if (!res) {
          res = await fetch('/api/whisper/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-whisper-model': model,
              'x-whisper-language': language,
              'x-whisper-device': 'auto',
              'x-media-filename': encodeURIComponent(fileName || 'media.mp4'),
            },
            body: file,
            signal,
          })
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          const errorMsg = (errData as { error?: string })?.error || res.statusText
          throw new Error(`Error en Whisper Local (${res.status}): ${errorMsg}`)
        }

        onProgress?.({ stage: 'transcribing', progress: 0.9 })

        const data = await res.json()
        const rawSegments = Array.isArray(data?.segments) ? data.segments : []

        onProgress?.({ stage: 'transcribing', progress: 1.0 })

        return rawSegments.map((seg: Record<string, unknown>) => ({
          text: (typeof seg.text === 'string' ? seg.text : '').trim(),
          start: typeof seg.start === 'number' ? seg.start : 0,
          end: typeof seg.end === 'number' ? seg.end : 0,
          words: Array.isArray(seg.words)
            ? (seg.words as Array<Record<string, unknown>>).map((w) => ({
                text: (typeof w.word === 'string'
                  ? w.word
                  : typeof w.text === 'string'
                    ? w.text
                    : ''
                ).trim(),
                start: typeof w.start === 'number' ? w.start : 0,
                end: typeof w.end === 'number' ? w.end : 0,
                confidence: typeof w.probability === 'number' ? w.probability : undefined,
              }))
            : undefined,
        }))
      } finally {
        signal.removeEventListener('abort', abortHandler)
      }
    })
  }
}
