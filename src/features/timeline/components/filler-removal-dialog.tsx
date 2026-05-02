import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useFillerRemovalDialogStore } from '../stores/filler-removal-dialog-store'
import {
  analyzeFillerWordsForItems,
  applyFillerPreviewOverlays,
  clearFillerPreviewOverlays,
  SUGGESTED_EXTRA_FILLER_WORDS,
  type FillerAudioConfidenceLevel,
  type FillerRange,
  type FillerRemovalSettings,
} from '../utils/filler-word-removal-preview'
import { scoreFillerRangesWithClap } from '../utils/filler-audio-confidence'
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from '../utils/media-item-frames'
import type { RemoveSilenceResult } from '../stores/actions/item-edit-actions'
import { createLogger } from '@/shared/logging/logger'

const FILLER_REMOVAL_PANEL_STORAGE_KEY = 'timeline:fillerRemovalPanelBounds'
const FILLER_REMOVAL_PANEL_DEFAULT_BOUNDS = { x: -1, y: -1, width: 460, height: 520 }
const logger = createLogger('FillerRemovalDialog')

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0s'
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.0'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds - minutes * 60
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
}

function getConfidenceClass(level: FillerAudioConfidenceLevel): string {
  switch (level) {
    case 'high':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
    case 'medium':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600'
    case 'low':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
  }
}

function normalizeEntry(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function removeEntry(entries: readonly string[], entry: string): string[] {
  return entries.filter((value) => value !== entry)
}

function addEntry(entries: readonly string[], value: string): string[] {
  const normalized = normalizeEntry(value)
  if (!normalized || entries.includes(normalized)) {
    return [...entries]
  }
  return [...entries, normalized].toSorted((left, right) => left.localeCompare(right))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function NumberSetting({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
          className="h-7 w-20 px-2 text-right text-xs"
        />
        <span className="w-7 text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  )
}

function FillerEntryEditor({
  id,
  label,
  entries,
  placeholder,
  onChange,
}: {
  id: string
  label: string
  entries: readonly string[]
  placeholder: string
  onChange: (entries: string[]) => void
}) {
  const [value, setValue] = useState('')

  const commit = useCallback(() => {
    const nextEntries = addEntry(entries, value)
    if (nextEntries !== entries) {
      onChange(nextEntries)
    }
    setValue('')
  }, [entries, onChange, value])

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commit()
          }}
          className="h-8 text-xs"
        />
        <Button type="button" variant="secondary" size="sm" onClick={commit}>
          Add
        </Button>
      </div>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-md border bg-muted/20 p-2">
        {entries.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          entries.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(removeEntry(entries, entry))}
              className="rounded border bg-background px-2 py-1 text-xs hover:bg-muted"
              title="Remove"
            >
              {entry} x
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function UndoRedoControls() {
  const canUndo = useTimelineCommandStore((state) => state.canUndo)
  const canRedo = useTimelineCommandStore((state) => state.canRedo)
  const undoLabel = useTimelineCommandStore((state) => state.getUndoLabel())
  const redoLabel = useTimelineCommandStore((state) => state.getRedoLabel())

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canUndo}
        onClick={() => useTimelineCommandStore.getState().undo()}
        className="h-6 px-2 text-xs"
        title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
      >
        Undo
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canRedo}
        onClick={() => useTimelineCommandStore.getState().redo()}
        className="h-6 px-2 text-xs"
        title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
      >
        Redo
      </Button>
    </div>
  )
}

function FillerMatchList({
  itemIds,
  rangesByMediaId,
}: {
  itemIds: readonly string[]
  rangesByMediaId: Record<string, FillerRange[]>
}) {
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const itemsById = useItemsStore((state) => state.itemById)
  const timelineFps = useTimelineSettingsStore((state) => state.fps)
  const matches = Object.entries(rangesByMediaId)
    .flatMap(([mediaId, ranges]) =>
      ranges.map((range, index) => ({
        id: `${mediaId}:${range.start}:${range.end}:${index}`,
        mediaId,
        range,
        media: mediaById[mediaId],
      })),
    )
    .toSorted((left, right) => {
      const mediaCompare = (left.media?.fileName ?? left.mediaId).localeCompare(
        right.media?.fileName ?? right.mediaId,
      )
      return mediaCompare !== 0 ? mediaCompare : left.range.start - right.range.start
    })

  const handlePlayRange = useCallback(
    (mediaId: string, range: FillerRange) => {
      const item = itemIds
        .map((id) => itemsById[id])
        .find((candidate) => {
          if (!candidate || (candidate.type !== 'video' && candidate.type !== 'audio')) {
            return false
          }
          if (candidate.mediaId !== mediaId) return false
          const span = getItemSourceSpanSeconds(candidate, timelineFps)
          return span !== null && range.start < span.end && range.end > span.start
        })

      if (!item) return

      const playback = usePlaybackStore.getState()
      const startFrame = sourceSecondsToTimelineFrame(item, range.start, timelineFps)
      const endFrame = sourceSecondsToTimelineFrame(item, range.end, timelineFps)
      const durationMs = Math.max(
        300,
        Math.min(3000, (Math.max(1, endFrame - startFrame) / timelineFps) * 1000 + 180),
      )

      playback.setCurrentFrame(startFrame)
      playback.play()
      window.setTimeout(() => {
        const current = usePlaybackStore.getState()
        if (current.currentFrame >= startFrame && current.currentFrame <= endFrame + 2) {
          current.pause()
        }
      }, durationMs)
    },
    [itemIds, itemsById, timelineFps],
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Found</Label>
        <span className="text-xs text-muted-foreground">{matches.length}</span>
      </div>
      <div className="max-h-36 overflow-y-auto rounded-md border bg-muted/20">
        {matches.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">No entries found</div>
        ) : (
          matches.map(({ id, mediaId, media, range }) => (
            <button
              key={id}
              type="button"
              onClick={() => handlePlayRange(mediaId, range)}
              className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted"
              title="Play this range"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{range.text || 'Filler'}</span>
                  {range.audioConfidence && (
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${getConfidenceClass(
                        range.audioConfidence.level,
                      )}`}
                    >
                      {range.audioConfidence.level}
                    </span>
                  )}
                </span>
                <span className="block truncate text-muted-foreground">
                  {media?.fileName ?? mediaId}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatTimestamp(range.start)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export function FillerRemovalDialog() {
  const isOpen = useFillerRemovalDialogStore((state) => state.isOpen)
  const itemIds = useFillerRemovalDialogStore((state) => state.itemIds)
  const settings = useFillerRemovalDialogStore((state) => state.settings)
  const rangesByMediaId = useFillerRemovalDialogStore((state) => state.rangesByMediaId)
  const summary = useFillerRemovalDialogStore((state) => state.summary)
  const updatePreview = useFillerRemovalDialogStore((state) => state.updatePreview)
  const close = useFillerRemovalDialogStore((state) => state.close)
  const [draft, setDraft] = useState<FillerRemovalSettings>(settings)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isScoringAudio, setIsScoringAudio] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setDraft(settings)
      setHasApplied(false)
    }
  }, [isOpen, settings])

  const handleClose = useCallback(() => {
    clearFillerPreviewOverlays(itemIds)
    close()
  }, [close, itemIds])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleClose, isOpen])

  const handleUpdatePreview = useCallback(() => {
    const run = async () => {
      setIsAnalyzing(true)
      try {
        const nextRangesByMediaId = await analyzeFillerWordsForItems(itemIds, draft)
        const nextSummary = applyFillerPreviewOverlays(itemIds, nextRangesByMediaId)
        updatePreview({
          settings: draft,
          rangesByMediaId: nextRangesByMediaId,
          summary: nextSummary,
        })
        setHasApplied(false)
        if (nextSummary.rangeCount === 0) {
          toast.info('No removable filler words detected with these settings')
        }
      } catch (error) {
        logger.warn('Filler preview failed', error)
        toast.error(error instanceof Error ? error.message : 'Failed to preview filler words')
      } finally {
        setIsAnalyzing(false)
      }
    }

    void run()
  }, [draft, itemIds, updatePreview])

  const handleScoreAudio = useCallback(() => {
    const run = async () => {
      setIsScoringAudio(true)
      try {
        const scoredRangesByMediaId = await scoreFillerRangesWithClap(rangesByMediaId)
        const nextSummary = applyFillerPreviewOverlays(itemIds, scoredRangesByMediaId)
        updatePreview({
          settings,
          rangesByMediaId: scoredRangesByMediaId,
          summary: nextSummary,
        })
        toast.success('Audio confidence scored')
      } catch (error) {
        logger.warn('Audio confidence scoring failed', error)
        toast.error(error instanceof Error ? error.message : 'Failed to score audio confidence')
      } finally {
        setIsScoringAudio(false)
      }
    }

    void run()
  }, [itemIds, rangesByMediaId, settings, updatePreview])

  const handleApply = useCallback(() => {
    let result: RemoveSilenceResult | null = null
    try {
      result = useTimelineStore.getState().removeFillerWordsFromItems(itemIds, rangesByMediaId)
    } finally {
      clearFillerPreviewOverlays(itemIds)
    }

    if (!result || result.removedItemCount === 0) {
      toast.info('No filler words found inside the selected clips')
      return
    }

    toast.success(
      `Removed ${result.removedItemCount} filler segment${result.removedItemCount === 1 ? '' : 's'}`,
    )
    setHasApplied(true)
  }, [itemIds, rangesByMediaId])

  if (!isOpen) {
    return null
  }

  return (
    <FloatingPanel
      title="Remove Filler Words"
      defaultBounds={FILLER_REMOVAL_PANEL_DEFAULT_BOUNDS}
      minWidth={340}
      minHeight={220}
      storageKey={FILLER_REMOVAL_PANEL_STORAGE_KEY}
      onClose={handleClose}
      headerExtra={<UndoRedoControls />}
      resizable={false}
      autoHeight
      className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90"
    >
      <section
        role="dialog"
        aria-label="Remove Filler Words"
        aria-modal="false"
        className="flex flex-col"
      >
        <div className="p-3">
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm leading-tight">
            <div className="font-medium">
              {summary.rangeCount} filler range{summary.rangeCount === 1 ? '' : 's'} selected
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              About {formatSeconds(summary.totalSeconds)} will be removed.
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-2 rounded-md border bg-muted/20 p-2">
              <NumberSetting
                id="filler-padding"
                label="Cut padding"
                value={draft.paddingMs}
                min={0}
                max={500}
                step={5}
                suffix="ms"
                onChange={(paddingMs) => setDraft((current) => ({ ...current, paddingMs }))}
              />
              <NumberSetting
                id="filler-word-duration"
                label="Max word"
                value={draft.maxSimpleFillerMs}
                min={100}
                max={3000}
                step={50}
                suffix="ms"
                onChange={(maxSimpleFillerMs) =>
                  setDraft((current) => ({ ...current, maxSimpleFillerMs }))
                }
              />
              <NumberSetting
                id="filler-phrase-duration"
                label="Max phrase"
                value={draft.maxPhraseFillerMs}
                min={250}
                max={5000}
                step={50}
                suffix="ms"
                onChange={(maxPhraseFillerMs) =>
                  setDraft((current) => ({ ...current, maxPhraseFillerMs }))
                }
              />
            </div>
            <FillerMatchList itemIds={itemIds} rangesByMediaId={rangesByMediaId} />
            <FillerEntryEditor
              id="filler-words"
              label="Words"
              entries={draft.fillerWords}
              placeholder="um"
              onChange={(fillerWords) => setDraft((current) => ({ ...current, fillerWords }))}
            />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_EXTRA_FILLER_WORDS.map((word) => (
                <Button
                  key={word}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      fillerWords: addEntry(current.fillerWords, word),
                    }))
                  }
                >
                  + {word}
                </Button>
              ))}
            </div>
            <FillerEntryEditor
              id="filler-phrases"
              label="Phrases"
              entries={draft.fillerPhrases}
              placeholder="you know"
              onChange={(fillerPhrases) => setDraft((current) => ({ ...current, fillerPhrases }))}
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/10 p-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={isAnalyzing}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUpdatePreview}
            disabled={isAnalyzing || isScoringAudio}
          >
            {isAnalyzing ? 'Updating...' : 'Update Preview'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleScoreAudio}
            disabled={isAnalyzing || isScoringAudio || summary.rangeCount === 0}
          >
            {isScoringAudio ? 'Scoring...' : 'Score Audio'}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isAnalyzing || isScoringAudio || hasApplied || summary.rangeCount === 0}
          >
            {hasApplied ? 'Removed' : 'Remove'}
          </Button>
        </div>
      </section>
    </FloatingPanel>
  )
}
