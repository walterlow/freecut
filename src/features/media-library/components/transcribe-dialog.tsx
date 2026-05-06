import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Square } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Combobox } from '@/components/ui/combobox'
import { useEditorStore } from '@/app/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsStore } from '@/features/media-library/deps/settings-contract'
import { getMediaTranscriptionModelOptions } from '../transcription/registry'
import {
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  normalizeSelectableWhisperModel,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_QUANTIZATION_OPTIONS,
} from '@/shared/utils/whisper-settings'
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage'

export interface TranscribeDialogValues {
  model: MediaTranscriptModel
  quantization: MediaTranscriptQuantization
  language: string
}

interface TranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  hasTranscript: boolean
  isRunning: boolean
  progressPercent: number | null
  progressLabel: string
  errorMessage?: string | null
  onStart: (values: TranscribeDialogValues) => void
  onCancel: () => void
}

export function TranscribeDialog({
  open,
  onOpenChange,
  fileName,
  hasTranscript,
  isRunning,
  progressPercent,
  progressLabel,
  errorMessage,
  onStart,
  onCancel,
}: TranscribeDialogProps) {
  const defaultModel = useSettingsStore((s) => s.defaultWhisperModel)
  const defaultQuantization = useSettingsStore((s) => s.defaultWhisperQuantization)
  const defaultLanguage = useSettingsStore((s) => s.defaultWhisperLanguage)
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview)
  const clearCompoundClipSkimPreview = useEditorStore((s) => s.clearCompoundClipSkimPreview)
  const beginTranscriptionDialog = useEditorStore((s) => s.beginTranscriptionDialog)
  const endTranscriptionDialog = useEditorStore((s) => s.endTranscriptionDialog)

  const modelOptions = useMemo(() => getMediaTranscriptionModelOptions(), [])

  const [model, setModel] = useState<MediaTranscriptModel>(() =>
    normalizeSelectableWhisperModel(defaultModel),
  )
  const [quantization, setQuantization] = useState<MediaTranscriptQuantization>(defaultQuantization)
  const [languageValue, setLanguageValue] = useState<string>(() =>
    getWhisperLanguageSelectValue(defaultLanguage),
  )

  useEffect(() => {
    if (!open) return
    setModel(normalizeSelectableWhisperModel(defaultModel))
    setQuantization(defaultQuantization)
    setLanguageValue(getWhisperLanguageSelectValue(defaultLanguage))
  }, [open, defaultLanguage, defaultModel, defaultQuantization])

  useEffect(() => {
    if (!open) return
    beginTranscriptionDialog()
    clearMediaSkimPreview()
    clearCompoundClipSkimPreview()
    usePlaybackStore.getState().setPreviewFrame(null)
    usePlaybackStore.getState().pause()

    return () => {
      endTranscriptionDialog()
    }
  }, [
    beginTranscriptionDialog,
    clearCompoundClipSkimPreview,
    clearMediaSkimPreview,
    endTranscriptionDialog,
    open,
  ])

  const handleStart = () => {
    onStart({
      model,
      quantization,
      language: getWhisperLanguageSettingValue(languageValue),
    })
  }

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isRunning && !nextOpen) {
        return
      }
      onOpenChange(nextOpen)
    },
    [isRunning, onOpenChange],
  )

  const title = hasTranscript ? 'Refresh Transcript' : 'Generate Transcript'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        className="sm:max-w-md"
        hideCloseButton={isRunning}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (isRunning) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="truncate">{fileName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">Model</Label>
            <Select
              value={model}
              onValueChange={(value) => setModel(value as MediaTranscriptModel)}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Quantization</Label>
            <Select
              value={quantization}
              onValueChange={(value) => setQuantization(value as MediaTranscriptQuantization)}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WHISPER_QUANTIZATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Language</Label>
            <Combobox
              value={languageValue}
              onValueChange={setLanguageValue}
              options={WHISPER_LANGUAGE_OPTIONS}
              placeholder="Auto-detect"
              searchPlaceholder="Search languages..."
              emptyMessage="No languages match that search."
              disabled={isRunning}
            />
          </div>

          {errorMessage && !isRunning && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </div>
          )}

          {isRunning && (
            <div className="space-y-1.5 rounded-md border border-border bg-secondary/40 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="truncate">{progressLabel}</span>
              </div>
              {progressPercent !== null && (
                <div
                  role="progressbar"
                  aria-label="Transcription progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                  className="h-1 overflow-hidden rounded-full bg-secondary"
                >
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {isRunning ? (
            <Button variant="destructive" onClick={onCancel}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleStart}>Start Transcription</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
