import { memo, useCallback, useEffect, useState } from 'react'
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
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import {
  KOKORO_TTS_BEST_MODEL,
  kokoroTtsService,
  type KokoroTtsModel,
  type KokoroTtsVoice,
} from '@/features/editor/services/kokoro-tts-service'
import { mossTtsService, type MossTtsVoice } from '@/features/editor/services/moss-tts-service'
import {
  supertonicTtsService,
  type SupertonicTtsLanguageSelection,
  type SupertonicTtsVoice,
} from '@/features/editor/services/supertonic-tts-service'
import { useTtsGenerateDialogStore } from '@/shared/state/tts-generate-dialog'
import { useTtsGeneration } from '../hooks/use-tts-generation'
import {
  NATIVE_SPEED_ENGINES,
  TTS_SPEED_RANGE_BY_ENGINE,
  TTS_VOICE_CHANGE_HANDLERS,
  TTS_VOICE_KEY_BY_ENGINE,
  TTS_VOICE_OPTION_RESOLVERS,
  TTS_VOICE_OPTIONS_BY_ENGINE,
  type TtsVoiceSelection,
} from '../utils/tts-generate-options'
import { TtsDialogActions } from './tts-dialog-actions'
import { TtsErrorNotice, TtsProgressNotice, TtsUnsupportedNotice } from './tts-dialog-notices'
import { TtsEngineVoiceFields } from './tts-engine-voice-fields'
import { TtsResultPreview } from './tts-result-preview'
import { TtsTextPanel } from './tts-text-panel'

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

  const isKokoroSupported = kokoroTtsService.isSupported()
  const isMossSupported = mossTtsService.isSupported()
  const isSupertonicSupported = supertonicTtsService.isSupported()
  const engineSupport: Record<StoredTtsEngine, boolean> = {
    kokoro: isKokoroSupported,
    moss: isMossSupported,
    supertonic: isSupertonicSupported,
  }
  const isTtsSupported = engineSupport[engine]
  const supportsNativeSpeed = NATIVE_SPEED_ENGINES.includes(engine)
  const { min: speedMin, max: speedMax } = TTS_SPEED_RANGE_BY_ENGINE[engine]
  const effectiveSpeed = supportsNativeSpeed ? speed : 1
  const trimmedText = text.trim()
  const voices: TtsVoiceSelection = {
    kokoro: kokoroVoice,
    moss: mossVoice,
    supertonic: supertonicVoice,
  }
  const { value: voice, label: voiceLabel } = TTS_VOICE_OPTION_RESOLVERS[engine](
    voices[TTS_VOICE_KEY_BY_ENGINE[engine]],
  )
  const voiceOptions = TTS_VOICE_OPTIONS_BY_ENGINE[engine]

  const {
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
  } = useTtsGeneration({
    projectId: currentProjectId,
    sourceItemId,
    text: trimmedText,
    engine,
    voice,
    voiceLabel,
    language: supertonicLanguage,
    speed: effectiveSpeed,
    model,
    isSupported: isTtsSupported,
    loadMediaItems,
    showNotification,
  })

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      resetSession()
      setText(initialText)
      setEngine(getStoredTtsEngine())
    }
  }, [isOpen, initialText, resetSession])

  useEffect(() => {
    setStoredTtsEngine(engine)
  }, [engine])

  // Cleanup blob URL when dialog closes
  useEffect(() => {
    if (!isOpen) releaseResult(inserted)
  }, [isOpen, inserted, releaseResult])

  useEffect(() => {
    setSpeed((current) => Math.min(speedMax, Math.max(speedMin, current)))
  }, [speedMax, speedMin])

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
    void generate()
  }, [generate])

  const handleInsertClick = useCallback(() => {
    void insert()
  }, [insert])

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
