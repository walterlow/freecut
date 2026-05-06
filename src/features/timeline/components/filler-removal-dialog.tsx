import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useTimelineStore } from '../stores/timeline-store'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useFillerRemovalDialogStore } from '../stores/filler-removal-dialog-store'
import {
  analyzeFillerWordsForItems,
  applyFillerPreviewOverlays,
  clearFillerPreviewOverlays,
  FILLER_REMOVAL_PRESETS,
  SUGGESTED_EXTRA_FILLER_WORDS,
  type FillerAudioConfidenceLevel,
  type FillerPreviewSummary,
  type FillerRange,
  type FillerRangesByMediaId,
  type FillerRemovalSettings,
} from '../utils/filler-word-removal-preview'
import { scoreFillerRangesWithClap } from '../utils/filler-audio-confidence'
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from '../utils/media-item-frames'
import type { RemoveSilenceResult } from '../stores/actions/item-edit-actions'
import { createLogger } from '@/shared/logging/logger'

const FILLER_REMOVAL_PANEL_STORAGE_KEY = 'timeline:fillerRemovalPanelBounds'
const FILLER_REMOVAL_PANEL_DEFAULT_BOUNDS = { x: -1, y: -1, width: 460, height: 520 }
const DRAFT_HISTORY_LIMIT = 50
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

function cloneSettings(settings: FillerRemovalSettings): FillerRemovalSettings {
  return {
    fillerWords: [...settings.fillerWords],
    fillerPhrases: [...settings.fillerPhrases],
    paddingMs: settings.paddingMs,
    maxSimpleFillerMs: settings.maxSimpleFillerMs,
    maxPhraseFillerMs: settings.maxPhraseFillerMs,
  }
}

function areEntriesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function areSettingsEqual(left: FillerRemovalSettings, right: FillerRemovalSettings): boolean {
  return (
    left.paddingMs === right.paddingMs &&
    left.maxSimpleFillerMs === right.maxSimpleFillerMs &&
    left.maxPhraseFillerMs === right.maxPhraseFillerMs &&
    areEntriesEqual(left.fillerWords, right.fillerWords) &&
    areEntriesEqual(left.fillerPhrases, right.fillerPhrases)
  )
}

function getRangeId(mediaId: string, range: FillerRange, index: number): string {
  return `${mediaId}:${range.start.toFixed(3)}:${range.end.toFixed(3)}:${range.text}:${index}`
}

function createSelectedRangeIds(rangesByMediaId: FillerRangesByMediaId): Set<string> {
  const selectedIds = new Set<string>()
  for (const [mediaId, ranges] of Object.entries(rangesByMediaId)) {
    ranges.forEach((range, index) => {
      selectedIds.add(getRangeId(mediaId, range, index))
    })
  }
  return selectedIds
}

function createHighConfidenceSelectedRangeIds(rangesByMediaId: FillerRangesByMediaId): Set<string> {
  const selectedIds = new Set<string>()
  for (const [mediaId, ranges] of Object.entries(rangesByMediaId)) {
    ranges.forEach((range, index) => {
      if (range.audioConfidence?.level === 'high') {
        selectedIds.add(getRangeId(mediaId, range, index))
      }
    })
  }
  return selectedIds
}

function filterRangesBySelectedIds(
  rangesByMediaId: FillerRangesByMediaId,
  selectedRangeIds: ReadonlySet<string>,
): FillerRangesByMediaId {
  const selectedRangesByMediaId: FillerRangesByMediaId = {}
  for (const [mediaId, ranges] of Object.entries(rangesByMediaId)) {
    const selectedRanges = ranges.filter((range, index) =>
      selectedRangeIds.has(getRangeId(mediaId, range, index)),
    )
    if (selectedRanges.length > 0) {
      selectedRangesByMediaId[mediaId] = selectedRanges
    }
  }
  return selectedRangesByMediaId
}

function summarizeRanges(rangesByMediaId: FillerRangesByMediaId): FillerPreviewSummary {
  let rangeCount = 0
  let totalSeconds = 0
  for (const ranges of Object.values(rangesByMediaId)) {
    rangeCount += ranges.length
    totalSeconds += ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0)
  }
  return { rangeCount, totalSeconds }
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
  const [draftValue, setDraftValue] = useState(String(value))
  const skipNextBlurRef = useRef(false)

  useEffect(() => {
    setDraftValue(String(value))
  }, [value])

  const commit = useCallback(() => {
    if (skipNextBlurRef.current) {
      skipNextBlurRef.current = false
      return
    }
    const parsed = Number(draftValue)
    const nextValue = clampNumber(parsed, min, max)
    setDraftValue(String(nextValue))
    if (nextValue !== value) {
      onChange(nextValue)
    }
  }, [draftValue, max, min, onChange, value])

  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      <div className="flex items-center gap-1">
        <Input
          id={id}
          type="number"
          value={draftValue}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
              return
            }
            if (event.key === 'Escape') {
              skipNextBlurRef.current = true
              setDraftValue(String(value))
              event.currentTarget.blur()
            }
          }}
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
              className="inline-flex overflow-hidden rounded border bg-background text-xs hover:bg-muted"
              title="Remove"
            >
              <span className="px-2 py-1">{entry}</span>
              <span className="border-l border-border px-1.5 py-1 font-medium text-destructive">
                x
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

function UndoRedoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canUndo}
        onClick={onUndo}
        className="h-6 px-2 text-xs"
        title="Undo tag/settings edit"
      >
        Undo
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canRedo}
        onClick={onRedo}
        className="h-6 px-2 text-xs"
        title="Redo tag/settings edit"
      >
        Redo
      </Button>
    </div>
  )
}

function FillerMatchList({
  itemIds,
  rangesByMediaId,
  selectedRangeIds,
  onToggleRange,
}: {
  itemIds: readonly string[]
  rangesByMediaId: Record<string, FillerRange[]>
  selectedRangeIds: ReadonlySet<string>
  onToggleRange: (id: string) => void
}) {
  const mediaById = useMediaLibraryStore((state) => state.mediaById)
  const itemsById = useItemsStore((state) => state.itemById)
  const timelineFps = useTimelineSettingsStore((state) => state.fps)
  const matches = Object.entries(rangesByMediaId)
    .flatMap(([mediaId, ranges]) =>
      ranges.map((range, index) => ({
        id: getRangeId(mediaId, range, index),
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
            <div
              key={id}
              className="flex items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0 hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selectedRangeIds.has(id)}
                onChange={() => onToggleRange(id)}
                className="h-4 w-4 shrink-0"
                aria-label={`Include ${range.text || 'filler range'}`}
              />
              <button
                type="button"
                onClick={() => handlePlayRange(mediaId, range)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
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
            </div>
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
  const updatePreview = useFillerRemovalDialogStore((state) => state.updatePreview)
  const close = useFillerRemovalDialogStore((state) => state.close)
  const [draft, setDraft] = useState<FillerRemovalSettings>(settings)
  const [draftPast, setDraftPast] = useState<FillerRemovalSettings[]>([])
  const [draftFuture, setDraftFuture] = useState<FillerRemovalSettings[]>([])
  const [reviewRangesByMediaId, setReviewRangesByMediaId] =
    useState<FillerRangesByMediaId>(rangesByMediaId)
  const [selectedRangeIds, setSelectedRangeIds] = useState<Set<string>>(() =>
    createSelectedRangeIds(rangesByMediaId),
  )
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isScoringAudio, setIsScoringAudio] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)
  const wasOpenRef = useRef(false)
  const isOpenRef = useRef(isOpen)
  const draftPastRef = useRef(draftPast)
  const draftFutureRef = useRef(draftFuture)
  const draftVersionRef = useRef(0)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const selectedRangesByMediaId = useMemo(
    () => filterRangesBySelectedIds(reviewRangesByMediaId, selectedRangeIds),
    [reviewRangesByMediaId, selectedRangeIds],
  )
  const totalReviewedRangeCount = useMemo(
    () => Object.values(reviewRangesByMediaId).reduce((sum, ranges) => sum + ranges.length, 0),
    [reviewRangesByMediaId],
  )
  const selectedSummary = useMemo(
    () => summarizeRanges(selectedRangesByMediaId),
    [selectedRangesByMediaId],
  )

  useEffect(() => {
    draftPastRef.current = draftPast
  }, [draftPast])

  useEffect(() => {
    draftFutureRef.current = draftFuture
  }, [draftFuture])

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      draftVersionRef.current += 1
      setDraft(cloneSettings(settings))
      setDraftPast([])
      setDraftFuture([])
      setReviewRangesByMediaId(rangesByMediaId)
      setSelectedRangeIds(createSelectedRangeIds(rangesByMediaId))
      setHasApplied(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen, rangesByMediaId, settings])

  const updateDraft = useCallback(
    (
      updater: FillerRemovalSettings | ((current: FillerRemovalSettings) => FillerRemovalSettings),
    ) => {
      setDraft((current) => {
        const next =
          typeof updater === 'function'
            ? (updater as (current: FillerRemovalSettings) => FillerRemovalSettings)(current)
            : updater
        if (areSettingsEqual(current, next)) {
          return current
        }

        draftVersionRef.current += 1
        setDraftPast((past) => [...past, cloneSettings(current)].slice(-DRAFT_HISTORY_LIMIT))
        setDraftFuture([])
        setHasApplied(false)
        return cloneSettings(next)
      })
    },
    [],
  )

  const undoDraft = useCallback(() => {
    setDraftPast((past) => {
      const previous = past.at(-1)
      if (!previous) return past
      draftVersionRef.current += 1
      setDraft((current) => {
        setDraftFuture((future) =>
          [cloneSettings(current), ...future].slice(0, DRAFT_HISTORY_LIMIT),
        )
        return cloneSettings(previous)
      })
      setHasApplied(false)
      return past.slice(0, -1)
    })
  }, [])

  const redoDraft = useCallback(() => {
    setDraftFuture((future) => {
      const next = future[0]
      if (!next) return future
      draftVersionRef.current += 1
      setDraft((current) => {
        setDraftPast((past) => [...past, cloneSettings(current)].slice(-DRAFT_HISTORY_LIMIT))
        return cloneSettings(next)
      })
      setHasApplied(false)
      return future.slice(1)
    })
  }, [])

  const handleClose = useCallback(() => {
    isOpenRef.current = false
    draftVersionRef.current += 1
    clearFillerPreviewOverlays(itemIds)
    setIsAnalyzing(false)
    setIsScoringAudio(false)
    close()
  }, [close, itemIds])

  useEffect(() => {
    if (!isOpen) return

    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      if (target.getAttribute('role') === 'textbox') return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        const canRedo = event.shiftKey && draftFutureRef.current.length > 0
        const canUndo = !event.shiftKey && draftPastRef.current.length > 0
        if (!canUndo && !canRedo) return

        event.preventDefault()
        event.stopPropagation()
        if (canRedo) {
          redoDraft()
        } else {
          undoDraft()
        }
        return
      }

      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleClose, isOpen, redoDraft, undoDraft])

  const handleUpdatePreview = useCallback(() => {
    const startedVersion = draftVersionRef.current
    const isStale = () => !isOpenRef.current || draftVersionRef.current !== startedVersion
    const run = async () => {
      setIsAnalyzing(true)
      try {
        const nextRangesByMediaId = await analyzeFillerWordsForItems(itemIds, draft)
        if (isStale()) return
        const nextSelectedRangeIds = createSelectedRangeIds(nextRangesByMediaId)
        const selectedRanges = filterRangesBySelectedIds(nextRangesByMediaId, nextSelectedRangeIds)
        const nextSummary = applyFillerPreviewOverlays(itemIds, selectedRanges)
        setReviewRangesByMediaId(nextRangesByMediaId)
        setSelectedRangeIds(nextSelectedRangeIds)
        updatePreview({
          settings: draft,
          rangesByMediaId: selectedRanges,
          summary: nextSummary,
        })
        setHasApplied(false)
        if (nextSummary.rangeCount === 0) {
          toast.info('No removable filler words detected with these settings')
        }
      } catch (error) {
        if (isStale()) return
        logger.warn('Filler preview failed', error)
        toast.error(error instanceof Error ? error.message : 'Failed to preview filler words')
      } finally {
        if (!isStale()) setIsAnalyzing(false)
      }
    }

    void run()
  }, [draft, itemIds, updatePreview])

  const handleScoreAudio = useCallback(() => {
    const startedVersion = draftVersionRef.current
    const isStale = () => !isOpenRef.current || draftVersionRef.current !== startedVersion
    const run = async () => {
      setIsScoringAudio(true)
      try {
        const scoredRangesByMediaId = await scoreFillerRangesWithClap(reviewRangesByMediaId)
        if (isStale()) return
        const nextSelectedRangeIds = createHighConfidenceSelectedRangeIds(scoredRangesByMediaId)
        const selectedRanges = filterRangesBySelectedIds(
          scoredRangesByMediaId,
          nextSelectedRangeIds,
        )
        const nextSummary = applyFillerPreviewOverlays(itemIds, selectedRanges)
        setReviewRangesByMediaId(scoredRangesByMediaId)
        setSelectedRangeIds(nextSelectedRangeIds)
        updatePreview({
          settings: draft,
          rangesByMediaId: selectedRanges,
          summary: nextSummary,
        })
        toast.success('Audio confidence scored. High-confidence entries are selected.')
      } catch (error) {
        if (isStale()) return
        logger.warn('Audio confidence scoring failed', error)
        toast.error(error instanceof Error ? error.message : 'Failed to score audio confidence')
      } finally {
        if (!isStale()) setIsScoringAudio(false)
      }
    }

    void run()
  }, [draft, itemIds, reviewRangesByMediaId, updatePreview])

  const handleApply = useCallback(() => {
    let result: RemoveSilenceResult | null = null
    try {
      result = useTimelineStore
        .getState()
        .removeFillerWordsFromItems(itemIds, selectedRangesByMediaId)
    } catch (error) {
      logger.warn('Filler removal failed', error)
      toast.error(error instanceof Error ? error.message : 'Failed to remove filler words')
      return
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
  }, [itemIds, selectedRangesByMediaId])

  const handleToggleRange = useCallback(
    (id: string) => {
      setSelectedRangeIds((current) => {
        const next = new Set(current)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        const selectedRanges = filterRangesBySelectedIds(reviewRangesByMediaId, next)
        const nextSummary = applyFillerPreviewOverlays(itemIds, selectedRanges)
        updatePreview({ settings, rangesByMediaId: selectedRanges, summary: nextSummary })
        setHasApplied(false)
        return next
      })
    },
    [itemIds, reviewRangesByMediaId, settings, updatePreview],
  )

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
      headerExtra={
        <UndoRedoControls
          canUndo={draftPast.length > 0}
          canRedo={draftFuture.length > 0}
          onUndo={undoDraft}
          onRedo={redoDraft}
        />
      }
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
              {selectedSummary.rangeCount} filler range
              {selectedSummary.rangeCount === 1 ? '' : 's'} selected
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              About {formatSeconds(selectedSummary.totalSeconds)} will be removed.
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <div className="flex rounded-md border bg-muted/20 p-1">
              {FILLER_REMOVAL_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 px-2 text-xs"
                  onClick={() =>
                    updateDraft({
                      fillerWords: [...preset.settings.fillerWords],
                      fillerPhrases: [...preset.settings.fillerPhrases],
                      paddingMs: preset.settings.paddingMs,
                      maxSimpleFillerMs: preset.settings.maxSimpleFillerMs,
                      maxPhraseFillerMs: preset.settings.maxPhraseFillerMs,
                    })
                  }
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="space-y-2 rounded-md border bg-muted/20 p-2">
              <NumberSetting
                id="filler-padding"
                label="Cut padding"
                value={draft.paddingMs}
                min={0}
                max={500}
                step={5}
                suffix="ms"
                onChange={(paddingMs) => updateDraft((current) => ({ ...current, paddingMs }))}
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
                  updateDraft((current) => ({ ...current, maxSimpleFillerMs }))
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
                  updateDraft((current) => ({ ...current, maxPhraseFillerMs }))
                }
              />
            </div>
            <FillerMatchList
              itemIds={itemIds}
              rangesByMediaId={reviewRangesByMediaId}
              selectedRangeIds={selectedRangeIds}
              onToggleRange={handleToggleRange}
            />
            <FillerEntryEditor
              id="filler-words"
              label="Words"
              entries={draft.fillerWords}
              placeholder="Add word"
              onChange={(fillerWords) => updateDraft((current) => ({ ...current, fillerWords }))}
            />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_EXTRA_FILLER_WORDS.map((word) => (
                <button
                  key={word}
                  type="button"
                  className="inline-flex overflow-hidden rounded border bg-background text-xs hover:bg-muted"
                  onClick={() =>
                    updateDraft((current) => ({
                      ...current,
                      fillerWords: addEntry(current.fillerWords, word),
                    }))
                  }
                >
                  <span className="px-2 py-1">{word}</span>
                  <span className="border-l border-border px-1.5 py-1 font-medium text-foreground">
                    +
                  </span>
                </button>
              ))}
            </div>
            <FillerEntryEditor
              id="filler-phrases"
              label="Phrases"
              entries={draft.fillerPhrases}
              placeholder="Add phrase"
              onChange={(fillerPhrases) =>
                updateDraft((current) => ({ ...current, fillerPhrases }))
              }
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
            disabled={isAnalyzing || isScoringAudio || totalReviewedRangeCount === 0}
          >
            {isScoringAudio ? 'Scoring...' : 'Score Audio'}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={
              isAnalyzing || isScoringAudio || hasApplied || selectedSummary.rangeCount === 0
            }
          >
            {hasApplied ? 'Removed' : 'Remove'}
          </Button>
        </div>
      </section>
    </FloatingPanel>
  )
}
