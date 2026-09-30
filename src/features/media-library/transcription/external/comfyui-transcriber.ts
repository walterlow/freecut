import type { TranscriptSegment, TranscribeOptions } from '../types'
import { ExternalTranscribeStream } from './external-transcribe-stream'
import type { MediaTranscriber } from '../adapter-types'
import { useAiSettingsStore } from '@/shared/state/ai-settings-store'
import { useComfyWorkflowStore } from '@/infrastructure/comfyui/workflow-store'
import { injectParametersIntoWorkflow } from '@/infrastructure/comfyui/workflow-parser'

export class ComfyUiTranscriber implements MediaTranscriber {
  constructor(private readonly defaultOptions?: TranscribeOptions) {}

  transcribe(file: File, runtimeOptions?: TranscribeOptions): ExternalTranscribeStream {
    const options = { ...this.defaultOptions, ...runtimeOptions }

    return new ExternalTranscribeStream(async (signal, onProgress) => {
      const baseUrl = useAiSettingsStore.getState().comfyui.baseUrl.replace(/\/+$/, '')
      const slot = useComfyWorkflowStore.getState().getSlot('transcription')

      if (!slot || Object.keys(slot.rawWorkflow || {}).length === 0) {
        throw new Error(
          'No hay ningún workflow de transcripción configurado. Ve a Ajustes > Inteligencia Artificial > Workflows de ComfyUI > Transcripción para configurar tu workflow.',
        )
      }

      onProgress?.({ stage: 'downloading', progress: 0.1 })

      // 1. Check ComfyUI connectivity
      try {
        const statsRes = await fetch(`${baseUrl}/system_stats`, { signal })
        if (!statsRes.ok) throw new Error(`ComfyUI no responde (${statsRes.status})`)
      } catch (err) {
        if (signal.aborted) throw new Error('Transcripción cancelada')
        throw new Error(
          `No se pudo conectar con ComfyUI en ${baseUrl}. Asegúrate de que ComfyUI esté ejecutándose. Detalle: ${err instanceof Error ? err.message : String(err)}`,
        )
      }

      onProgress?.({ stage: 'decoding', progress: 0.25 })

      // 2. Upload audio to ComfyUI
      const formData = new FormData()
      const uploadFileName = `freecut_audio_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      formData.append('image', file, uploadFileName)
      formData.append('overwrite', 'true')

      const uploadRes = await fetch(`${baseUrl}/upload/image`, {
        method: 'POST',
        body: formData,
        signal,
      })

      if (!uploadRes.ok) {
        throw new Error(`Error al subir archivo de audio a ComfyUI (${uploadRes.status})`)
      }

      const uploadData = (await uploadRes.json()) as { name?: string }
      const uploadedName = uploadData.name || uploadFileName

      if (signal.aborted) throw new Error('Transcripción cancelada')
      onProgress?.({ stage: 'transcribing', progress: 0.4 })

      // 3. Inject parameters into workflow
      const clientId = `freecut_${Date.now()}`
      const workflow = injectParametersIntoWorkflow(slot.rawWorkflow, slot.bindings, {
        assetType: 'transcription',
        inputMediaFileName: uploadedName,
        positivePrompt: options.language || 'auto',
      })

      // 4. Submit prompt
      const queueRes = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow, client_id: clientId }),
        signal,
      })

      if (!queueRes.ok) {
        const errText = await queueRes.text().catch(() => '')
        throw new Error(`ComfyUI rechazó la ejecución del workflow (${queueRes.status}): ${errText || queueRes.statusText}`)
      }

      const { prompt_id: promptId } = (await queueRes.json()) as { prompt_id: string }

      // 5. Poll for completion
      const startTime = Date.now()
      const timeoutMs = 300000 // 5 minutes

      while (Date.now() - startTime < timeoutMs) {
        if (signal.aborted) {
          // Interrupt ComfyUI execution on cancel
          void fetch(`${baseUrl}/interrupt`, { method: 'POST' }).catch(() => {})
          throw new Error('Transcripción cancelada')
        }

        await new Promise((r) => setTimeout(r, 1200))

        const historyRes = await fetch(`${baseUrl}/history/${promptId}`, { signal }).catch(() => null)
        if (!historyRes || !historyRes.ok) continue

        const historyData = await historyRes.json()
        const jobData = historyData[promptId]

        if (jobData && jobData.outputs) {
          onProgress?.({ stage: 'transcribing', progress: 0.9 })

          let fullTranscriptText = ''
          let rawOutputSegments: TranscriptSegment[] | null = null

          // Inspect output nodes
          for (const nodeId of Object.keys(jobData.outputs)) {
            const nodeOut = jobData.outputs[nodeId]

            // If node has text / string outputs
            if (nodeOut.text && Array.isArray(nodeOut.text)) {
              fullTranscriptText = nodeOut.text.join('\n')
            } else if (typeof nodeOut.text === 'string') {
              fullTranscriptText = nodeOut.text
            }

            // If node has srt or json or file output
            if (nodeOut.files && Array.isArray(nodeOut.files)) {
              for (const fileMeta of nodeOut.files) {
                if (fileMeta.filename?.endsWith('.srt') || fileMeta.filename?.endsWith('.json')) {
                  const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(fileMeta.filename)}&subfolder=${encodeURIComponent(fileMeta.subfolder || '')}&type=${encodeURIComponent(fileMeta.type || 'output')}`
                  const fileResp = await fetch(viewUrl, { signal }).catch(() => null)
                  if (fileResp && fileResp.ok) {
                    const textContent = await fileResp.text()
                    if (fileMeta.filename.endsWith('.json')) {
                      try {
                        const parsed = JSON.parse(textContent)
                        if (Array.isArray(parsed.segments)) {
                          rawOutputSegments = parsed.segments
                        }
                      } catch {
                        // Ignore
                      }
                    } else if (fileMeta.filename.endsWith('.srt')) {
                      rawOutputSegments = parseSrtToSegments(textContent)
                    }
                  }
                }
              }
            }
          }

          onProgress?.({ stage: 'transcribing', progress: 1.0 })

          if (rawOutputSegments && rawOutputSegments.length > 0) {
            return rawOutputSegments
          }

          if (fullTranscriptText.trim()) {
            return parseSrtOrTextToSegments(fullTranscriptText)
          }

          return [
            {
              start: 0,
              end: 10,
              text: 'Transcripción completada con ComfyUI',
            },
          ]
        }
      }

      throw new Error('Tiempo de espera agotado al transcribir con ComfyUI.')
    })
  }
}

function parseSrtOrTextToSegments(content: string): TranscriptSegment[] {
  const trimmed = content.trim()
  if (trimmed.includes('-->')) {
    return parseSrtToSegments(trimmed)
  }

  // Fallback: split by lines/paragraphs
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.map((line, idx) => ({
    start: idx * 4,
    end: (idx + 1) * 4,
    text: line,
  }))
}

function parseSrtToSegments(srtContent: string): TranscriptSegment[] {
  const blocks = srtContent.replace(/\r\n/g, '\n').split('\n\n')
  const segments: TranscriptSegment[] = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    const timeIndex = lines[0].includes('-->') ? 0 : 1
    const timeLine = lines[timeIndex]
    if (!timeLine || !timeLine.includes('-->')) continue

    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim())
    const start = parseTimestamp(startStr)
    const end = parseTimestamp(endStr)
    const text = lines.slice(timeIndex + 1).join(' ').trim()

    if (text) {
      segments.push({ start, end, text })
    }
  }

  return segments
}

function parseTimestamp(ts: string): number {
  const parts = ts.replace(',', '.').split(':')
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2])
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1])
  }
  return parseFloat(ts) || 0
}
