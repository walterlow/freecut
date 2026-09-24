import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WandSparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { SliderInput } from '@/shared/ui/property-controls'
import {
  getStoredTtsEngine,
  setStoredTtsEngine,
  type StoredTtsEngine,
} from '@/shared/utils/tts-settings'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@/features/editor/deps/media-library'
import {
  addItem,
  useItemsStore,
  useTimelineSettingsStore,
} from '@/features/editor/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  linkItems,
} from '@/features/editor/deps/timeline-utils'
import { useTtsGenerateDialogStore } from '@/shared/state/tts-generate-dialog'
import type { AudioItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import {
  getMossTtsVoiceOption,
  mossTtsService,
  type MossTtsVoice,
} from '@/features/editor/services/moss-tts-service'
import {
  KOKORO_TTS_BEST_MODEL,
  KOKORO_TTS_VOICE_OPTIONS,
  kokoroTtsService,
  type KokoroTtsModel,
  type KokoroTtsVoice,
} from '@/features/editor/services/kokoro-tts-service'
import {
  supertonicTtsService,
  SUPERTONIC_TTS_VOICE_OPTIONS,
  type SupertonicTtsLanguageSelection,
  type SupertonicTtsVoice,
} from '@/features/editor/services/supertonic-tts-service'
import { TtsDialogActions } from './tts-dialog-actions'
import { TtsErrorNotice, TtsProgressNotice, TtsUnsupportedNotice } from './tts-dialog-notices'
import { TtsEngineVoiceFields } from './tts-engine-voice-fields'
import { TtsResultPreview } from './tts-result-preview'
import { TtsTextPanel } from './tts-text-panel'
import {
  NATIVE_SPEED_ENGINES,
  TTS_SPEED_RANGE_BY_ENGINE,
  TTS_VOICE_CHANGE_HANDLERS,
  TTS_VOICE_KEY_BY_ENGINE,
  TTS_VOICE_OPTION_RESOLVERS,
  TTS_VOICE_OPTIONS_BY_ENGINE,
  type TtsVoiceSelection,
} from '../utils/tts-generate-options'

/**
 * Insert an audio item aligned to the source text item's position,
 * then link the two together.
 */
function insertAndLinkAudioAtTextItem(
  media: MediaMetadata,
  blobUrl: string,
  sourceItemId: string,
): { inserted: boolean; audioItemId: string | null } {
  const { tracks, items } = useItemsStore.getState()
  const { fps } = useTimelineSettingsStore.getState()
  const sourceItem = items.find((i) => i.id === sourceItemId)
  if (!sourceItem) return { inserted: false, audioItemId: null }

  const targetTrack = findCompatibleTrackForItemType({
    tracks,
    items,
    itemType: 'audio',
    preferredTrackId: null,
  })

  if (!targetTrack) return { inserted: false, audioItemId: null }

  const sourceFps = media.fps || fps
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const sourceDurationFrames = Math.round(media.duration * sourceFps)

  // Place at the text item's start position, nudging if occupied
  const finalPosition =
    findNearestAvailableSpace(sourceItem.from, durationInFrames, targetTrack.id, items) ??
    sourceItem.from

  const audioItemId = crypto.randomUUID()
  const audioItem: AudioItem = {
    id: audioItemId,
    type: 'audio',
    trackId: targetTrack.id,
    from: finalPosition,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: sourceDurationFrames,
    sourceDuration: sourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  }

  addItem(audioItem)

  const added = useItemsStore.getState().items.some((i) => i.id === audioItemId)
  if (!added) return { inserted: false, audioItemId: null }

  // Link the text item and audio item (linkItems also updates selection)
  linkItems([sourceItemId, audioItemId])

  return { inserted: true, audioItemId }
}

interface GenerationResult {
  file: File
  objectUrl: string
  duration: number
  voice: string
  model: string
  tags: string[]
}

export const TtsGenerateDialog = memo(function TtsGenerateDialog() {
  const { t } = useTranslation()
  const isOpen = useTtsGenerateDialogStore((s) => s.isOpen)
  const initialText = useTtsGenerateDialogStore((s) => s.initialText)
  const sourceItemId = useTtsGenerateDialogStore((s) => s.sourceItemId)
  const close = useTtsGenerateDialogStore((s) => s.close)

  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId)
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems)
  const showNotification = useMediaLibraryStore((state) => state.showNotification)

  const [text, setText] = useState('')
  const [engine, setEngine] = useState<StoredTtsEngine>(() => getStoredTtsEngine())
  const [kokoroVoice, setKokoroVoice] = useState<KokoroTtsVoice>('af_heart')
  const [mossVoice, setMossVoice] = useState<MossTtsVoice>('Xiaoyu')
  const [supertonicVoice, setSupertonicVoice] = useState<SupertonicTtsVoice>('M3')
  const [supertonicLanguage, setSupertonicLanguage] =
    useState<SupertonicTtsLanguageSelection>('auto')
  const model: KokoroTtsModel = KOKORO_TTS_BEST_MODEL
  const [speed, setSpeed] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isInserting, setIsInserting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [inserted, setInserted] = useState(false)

  const resultUrlRef = useRef<string | null>(null)
  const sessionIdRef = useRef(0)
  const insertedRef = useRef(inserted)
  insertedRef.current = inserted

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      sessionIdRef.current++
      // Revoke previous result URL if not inserted
      if (resultUrlRef.current && !insertedRef.current) {
        URL.revokeObjectURL(resultUrlRef.current)
        resultUrlRef.current = null
      }
      setText(initialText)
      setEngine(getStoredTtsEngine())
      setError(null)
      setProgress(null)
      setResult(null)
      setInserted(false)
    }
  }, [isOpen, initialText])

  useEffect(() => {
    setStoredTtsEngine(engine)
  }, [engine])

  // Cleanup blob URL when dialog closes
  useEffect(() => {
    if (!isOpen && resultUrlRef.current) {
      // Don't revoke if we inserted — the timeline item references it
      if (!inserted) {
        URL.revokeObjectURL(resultUrlRef.current)
      }
      resultUrlRef.current = null
    }
  }, [isOpen, inserted])

  const isKokoroSupported = kokoroTtsService.isSupported()
  const isMossSupported = mossTtsService.isSupported()
  const isSupertonicSupported = supertonicTtsService.isSupported()
  const engineSupport: Record<StoredTtsEngine, boolean> = {
    kokoro: isKokoroSupported,
    moss: isMossSupported,
    supertonic: isSupertonicSupported,
  }
  const supportsNativeSpeed = NATIVE_SPEED_ENGINES.includes(engine)
  const { min: speedMin, max: speedMax } = TTS_SPEED_RANGE_BY_ENGINE[engine]

  useEffect(() => {
    setSpeed((current) => Math.min(speedMax, Math.max(speedMin, current)))
  }, [speedMax, speedMin])

  const effectiveSpeed = supportsNativeSpeed ? speed : 1
  const isTtsSupported = engineSupport[engine]
  const trimmedText = text.trim()
  const voices: TtsVoiceSelection = {
    kokoro: kokoroVoice,
    moss: mossVoice,
    supertonic: supertonicVoice,
  }
  const voice = TTS_VOICE_OPTION_RESOLVERS[engine](voices[TTS_VOICE_KEY_BY_ENGINE[engine]]).value
  const voiceOptions = TTS_VOICE_OPTIONS_BY_ENGINE[engine]
  const busy = isGenerating || isInserting

  const handleGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setError(t('editor.tts.errors.openProject'))
      return
    }
    if (!trimmedText) {
      setError(t('editor.tts.errors.enterText'))
      return
    }
    if (!isTtsSupported) {
      setError(
        engine === 'kokoro'
          ? t('editor.tts.errors.kokoroUnsupported')
          : engine === 'moss'
            ? t('editor.tts.errors.mossUnsupported')
            : t('editor.tts.errors.supertonicUnsupported', {
                defaultValue:
                  'This browser cannot run the local Supertonic TTS runtime. Try a recent Chrome or Edge browser.',
              }),
      )
      return
    }

    // Clean up previous result
    if (resultUrlRef.current && !inserted) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }

    setError(null)
    setResult(null)
    setInserted(false)
    setIsGenerating(true)
    setProgress(t('editor.tts.progressPreparing'))

    const thisSession = sessionIdRef.current

    try {
      const onProgress = (msg: string) => {
        if (sessionIdRef.current === thisSession) setProgress(msg)
      }
      const result =
        engine === 'kokoro'
          ? await kokoroTtsService.generateSpeechFile({
              text: trimmedText,
              voice: kokoroVoice,
              speed: effectiveSpeed,
              model,
              onProgress,
            })
          : engine === 'moss'
            ? await mossTtsService.generateSpeechFile({
                text: trimmedText,
                voice: mossVoice,
                speed: effectiveSpeed,
                onProgress,
              })
            : await supertonicTtsService.generateSpeechFile({
                text: trimmedText,
                voice: supertonicVoice,
                language: supertonicLanguage,
                speed: effectiveSpeed,
                onProgress,
              })

      const { blob, file, duration } = result

      if (sessionIdRef.current !== thisSession) {
        // Dialog was closed/reopened — discard stale result
        return
      }

      const objectUrl = URL.createObjectURL(blob)
      resultUrlRef.current = objectUrl

      const voiceLabel =
        engine === 'kokoro'
          ? (KOKORO_TTS_VOICE_OPTIONS.find((option) => option.value === kokoroVoice)?.label ??
            kokoroVoice)
          : engine === 'moss'
            ? getMossTtsVoiceOption(mossVoice).label
            : (SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === supertonicVoice)
                ?.label ?? supertonicVoice)
      const modelLabel =
        engine === 'kokoro' ? 'Best' : engine === 'moss' ? 'Multilingual Nano' : 'Supertonic 3'
      const tags =
        engine === 'kokoro'
          ? [
              'ai-generated',
              'kokoro-tts',
              'tts-engine:kokoro',
              `kokoro-quality:${model}`,
              `kokoro-voice:${kokoroVoice}`,
            ]
          : engine === 'moss'
            ? ['ai-generated', 'moss-tts', 'tts-engine:moss', `moss-voice:${mossVoice}`]
            : [
                'ai-generated',
                'supertonic-tts',
                'tts-engine:supertonic',
                `supertonic-voice:${supertonicVoice}`,
              ]

      setResult({ file, objectUrl, duration, voice: voiceLabel, model: modelLabel, tags })
      setProgress(null)
    } catch (generationError) {
      if (sessionIdRef.current !== thisSession) return
      setError(
        generationError instanceof Error
          ? generationError.message
          : t('editor.tts.errors.generateFailed'),
      )
      setProgress(null)
    } finally {
      if (sessionIdRef.current === thisSession) {
        setIsGenerating(false)
      }
    }
  }, [
    currentProjectId,
    effectiveSpeed,
    engine,
    inserted,
    isTtsSupported,
    kokoroVoice,
    model,
    mossVoice,
    supertonicLanguage,
    supertonicVoice,
    trimmedText,
    t,
  ])

  const handleInsert = useCallback(async () => {
    if (!result || !currentProjectId || !sourceItemId) return

    setIsInserting(true)
    setError(null)

    try {
      const { mediaLibraryService } = await importMediaLibraryService()
      const media = await mediaLibraryService.importGeneratedAudio(result.file, currentProjectId, {
        tags: result.tags,
      })

      await loadMediaItems()

      const { inserted: didInsert } = insertAndLinkAudioAtTextItem(
        media,
        result.objectUrl,
        sourceItemId,
      )

      if (didInsert) {
        setInserted(true)
        showNotification({
          type: 'success',
          message: t('editor.tts.notifications.addedAndLinked', { fileName: media.fileName }),
        })
      } else {
        showNotification({
          type: 'warning',
          message: t('editor.tts.notifications.savedNoTrack', { fileName: media.fileName }),
        })
      }
    } catch (insertError) {
      setError(
        insertError instanceof Error ? insertError.message : t('editor.tts.errors.insertFailed'),
      )
    } finally {
      setIsInserting(false)
    }
  }, [result, currentProjectId, sourceItemId, loadMediaItems, showNotification, t])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) close()
    },
    [close],
  )

  const handleVoiceChange = useCallback(
    (value: string) => {
      TTS_VOICE_CHANGE_HANDLERS[engine](value, {
        kokoro: setKokoroVoice,
        moss: setMossVoice,
        supertonic: setSupertonicVoice,
      })
    },
    [engine],
  )

  const handleGenerateClick = useCallback(() => {
    void handleGenerate()
  }, [handleGenerate])

  const handleInsertClick = useCallback(() => {
    void handleInsert()
  }, [handleInsert])

  const canGenerate = [
    isGenerating,
    isInserting,
    !trimmedText,
    !currentProjectId,
    !isTtsSupported,
  ].every((isBlocked) => !isBlocked)

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <WandSparkles className="h-4 w-4" />
            {t('editor.tts.dialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('editor.tts.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isTtsSupported && <TtsUnsupportedNotice engine={engine} t={t} />}

          <TtsEngineVoiceFields
            engine={engine}
            onEngineChange={setEngine}
            voice={voice}
            voiceOptions={voiceOptions}
            onVoiceChange={handleVoiceChange}
            language={supertonicLanguage}
            onLanguageChange={setSupertonicLanguage}
            busy={busy}
            t={t}
          />

          <TtsTextPanel engine={engine} text={text} onTextChange={setText} busy={busy} t={t} />

          {supportsNativeSpeed && (
            <SliderInput
              label={t('editor.tts.speed')}
              value={speed}
              onChange={setSpeed}
              min={speedMin}
              max={speedMax}
              step={0.05}
              unit="x"
              disabled={busy}
            />
          )}

          {progress && <TtsProgressNotice progress={progress} />}

          {error && <TtsErrorNotice error={error} />}

          {result && <TtsResultPreview result={result} inserted={inserted} t={t} />}

          <TtsDialogActions
            isGenerating={isGenerating}
            isInserting={isInserting}
            hasResult={result !== null}
            inserted={inserted}
            canGenerate={canGenerate}
            onGenerate={handleGenerateClick}
            onInsert={handleInsertClick}
            t={t}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
})
