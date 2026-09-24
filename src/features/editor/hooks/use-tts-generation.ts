import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KokoroTtsModel } from '../services/kokoro-tts-service'
import type { SupertonicTtsLanguageSelection } from '../services/supertonic-tts-service'
import {
  generateTtsAudio,
  type TtsGenerateInput,
  type TtsGenerateOutput,
} from '../services/tts-generate-request'
import {
  getTtsInsertRequest,
  insertTtsResult,
  resolveTtsInsertNotification,
  type TtsInsertOutcome,
} from '../services/tts-insert-result'
import {
  resolveTtsGenerateError,
  TTS_MODEL_LABEL_BY_ENGINE,
  TTS_RESULT_TAGS_BY_ENGINE,
} from '../utils/tts-generate-options'
import type { StoredTtsEngine } from '@/shared/utils/tts-settings'

interface TtsGenerationResult {
  file: File
  objectUrl: string
  duration: number
  voice: string
  model: string
  tags: string[]
}

export interface TtsGenerationParams {
  projectId: string | null
  sourceItemId: string | null
  /** Script text with surrounding whitespace already removed. */
  text: string
  engine: StoredTtsEngine
  voice: string
  voiceLabel: string
  language: SupertonicTtsLanguageSelection
  /** Effective speed: 1 for engines that ignore the slider. */
  speed: number
  model: KokoroTtsModel
  isSupported: boolean
  loadMediaItems: () => Promise<void>
  showNotification: (notification: { type: 'success' | 'warning'; message: string }) => void
}

/**
 * Request/progress state machine for the TTS dialog: synthesizes the script, keeps the
 * result blob URL alive exactly as long as the dialog does, and inserts the clip.
 */
export function useTtsGeneration(params: TtsGenerationParams) {
  const { t } = useTranslation()
  const { projectId, sourceItemId, text, engine, voice, voiceLabel, language, speed, model } =
    params
  const { isSupported, loadMediaItems, showNotification } = params

  const [isGenerating, setIsGenerating] = useState(false)
  const [isInserting, setIsInserting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TtsGenerationResult | null>(null)
  const [inserted, setInserted] = useState(false)

  const resultUrlRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
  const insertedRef = useRef(inserted)
  insertedRef.current = inserted

  const busy = isGenerating || isInserting
  const canGenerate = [
    isGenerating,
    isInserting,
    text.length === 0,
    projectId === null,
    !isSupported,
  ].every((isBlocked) => !isBlocked)

  /** Drop the previous result's blob URL unless its clip already went to the timeline. */
  const releasePendingResult = useCallback(() => {
    if (!resultUrlRef.current || insertedRef.current) return

    URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = null
  }, [])

  /** Invalidate the in-flight session, then clear every piece of result state. */
  const resetSession = useCallback(() => {
    sessionIdRef.current++
    releasePendingResult()
    setError(null)
    setProgress(null)
    setResult(null)
    setInserted(false)
  }, [releasePendingResult])

  /** Dialog close: the timeline item keeps its URL when the clip was inserted. */
  const releaseResult = useCallback((keepInserted: boolean) => {
    if (!resultUrlRef.current) return
    if (!keepInserted) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = null
  }, [])

  const beginGeneration = useCallback(() => {
    setError(null)
    setResult(null)
    setInserted(false)
    setIsGenerating(true)
    setProgress(t('editor.tts.progressPreparing'))
    return sessionIdRef.current
  }, [t])

  const applyResult = useCallback(
    (output: TtsGenerateOutput) => {
      const objectUrl = URL.createObjectURL(output.blob)
      resultUrlRef.current = objectUrl

      setResult({
        file: output.file,
        objectUrl,
        duration: output.duration,
        voice: voiceLabel,
        model: TTS_MODEL_LABEL_BY_ENGINE[engine],
        tags: TTS_RESULT_TAGS_BY_ENGINE[engine](voice, model),
      })
      setProgress(null)
    },
    [engine, model, voice, voiceLabel],
  )

  const generate = useCallback(async () => {
    const failure = resolveTtsGenerateError(
      { hasProject: Boolean(projectId), trimmedText: text, engine, isSupported },
      t,
    )
    if (failure) {
      setError(failure)
      return
    }

    const session = beginGeneration()
    const input: TtsGenerateInput = {
      engine,
      text,
      voice,
      language,
      speed,
      model,
      onProgress: (message) => {
        if (sessionIdRef.current === session) setProgress(message)
      },
    }
    const outcome = await generateTtsAudio(input, t('editor.tts.errors.generateFailed'))

    // Dialog was closed/reopened — discard the stale result
    if (sessionIdRef.current !== session) return

    setIsGenerating(false)
    if (outcome.ok) {
      applyResult(outcome.output)
      return
    }

    setError(outcome.message)
    setProgress(null)
  }, [
    applyResult,
    beginGeneration,
    engine,
    isSupported,
    language,
    model,
    projectId,
    speed,
    t,
    text,
    voice,
  ])

  const finishInsert = useCallback(
    (outcome: TtsInsertOutcome) => {
      if (!outcome.ok) {
        setError(outcome.message)
        return
      }

      setInserted(outcome.inserted)
      showNotification(resolveTtsInsertNotification(outcome.inserted, outcome.fileName, t))
    },
    [showNotification, t],
  )

  const insert = useCallback(async () => {
    const request = getTtsInsertRequest(result, projectId, sourceItemId)
    if (request === null) return

    setIsInserting(true)
    setError(null)

    const outcome = await insertTtsResult(
      request,
      loadMediaItems,
      t('editor.tts.errors.insertFailed'),
    )
    setIsInserting(false)
    finishInsert(outcome)
  }, [result, projectId, sourceItemId, loadMediaItems, t, finishInsert])

  return {
    isGenerating,
    isInserting,
    busy,
    canGenerate,
    progress,
    error,
    result,
    inserted,
    generate,
    insert,
    resetSession,
    releaseResult,
  }
}
