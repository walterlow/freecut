import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Captions, ChevronDown, ChevronUp, Loader2, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/shared/logging/logger'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import type { MediaTranscript } from '@/types/storage'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useTimelineStore } from '../../stores/timeline-store'
import {
  mediaTranscriptionService,
  runMediaTranscriptionJob,
} from '../../deps/media-transcription-service'
import {
  buildRemovalRangesByMediaId,
  buildTranscriptTokens,
  findActiveTokenIndex,
  getSelectedTokenSlice,
  isTranscriptableItem,
} from '../../utils/transcript-edit-model'

const logger = createLogger('TranscriptEditorPanel')

type MediaStatus = 'loading' | 'ready' | 'needs' | 'error' | 'transcribing'

interface MediaEntry {
  status: MediaStatus
  transcript?: MediaTranscript
}

function hasWordTimings(
  transcript: MediaTranscript | null | undefined,
): transcript is MediaTranscript {
  return !!transcript && transcript.segments.some((segment) => (segment.words?.length ?? 0) > 0)
}

export interface TranscriptEditorPanelProps {
  /** Only fetch/transcribe while the tab is actually visible. */
  active: boolean
}

export function TranscriptEditorPanel({ active }: TranscriptEditorPanelProps) {
  const { t } = useTranslation()
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const itemById = useItemsStore((s) => s.itemById)
  const timelineFps = useTimelineSettingsStore((s) => s.fps)
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  const [mediaState, setMediaState] = useState<Record<string, MediaEntry>>({})
  const [anchorIndex, setAnchorIndex] = useState(-1)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [query, setQuery] = useState('')
  const [matchCursor, setMatchCursor] = useState(0)
  // Bumped when a stored transcript changes externally (e.g. deleted from the media
  // library) to force the load effect to re-fetch instead of serving the stale cache.
  const [refreshNonce, setRefreshNonce] = useState(0)

  const isSelectingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // mediaIds we've already kicked off a load for — keeps the load effect from
  // depending on `mediaState` (which would re-run it and cancel its own fetch).
  const requestedRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  const transcriptableItems = useMemo(
    () => selectedItemIds.map((id) => itemById[id]).filter(isTranscriptableItem),
    [selectedItemIds, itemById],
  )

  const uniqueMediaIds = useMemo(
    () => Array.from(new Set(transcriptableItems.map((item) => item.mediaId))).sort(),
    [transcriptableItems],
  )

  const transcriptsByMediaId = useMemo(() => {
    const map: Record<string, MediaTranscript | undefined> = {}
    for (const id of uniqueMediaIds) map[id] = mediaState[id]?.transcript
    return map
  }, [uniqueMediaIds, mediaState])

  const tokens = useMemo(
    () => buildTranscriptTokens(transcriptableItems, transcriptsByMediaId, timelineFps),
    [transcriptableItems, transcriptsByMediaId, timelineFps],
  )

  const activeIndex = useMemo(
    () => findActiveTokenIndex(tokens, currentFrame),
    [tokens, currentFrame],
  )

  const selectedKeys = useMemo(() => {
    const slice = getSelectedTokenSlice(tokens, anchorIndex, focusIndex)
    return new Set(slice.map((token) => token.key))
  }, [tokens, anchorIndex, focusIndex])

  const normalizedQuery = query.trim().toLowerCase()
  const matchIndices = useMemo(() => {
    if (!normalizedQuery) return [] as number[]
    return tokens.flatMap((token, index) =>
      token.text.toLowerCase().includes(normalizedQuery) ? [index] : [],
    )
  }, [tokens, normalizedQuery])

  const matchKeys = useMemo(
    () => new Set(matchIndices.map((index) => tokens[index]?.key)),
    [matchIndices, tokens],
  )

  // Reset transient UI when the selected clips change.
  useEffect(() => {
    setAnchorIndex(-1)
    setFocusIndex(-1)
    setMatchCursor(0)
  }, [uniqueMediaIds])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Invalidate our cached transcript when the stored one changes elsewhere (deleted from
  // the media library, or (re)generated). Drop it from the dedup set + local state and
  // nudge the load effect so it re-fetches the current state instead of the stale copy.
  useEffect(() => {
    return mediaTranscriptionService.onTranscriptChanged((mediaId) => {
      if (!requestedRef.current.has(mediaId)) return
      requestedRef.current.delete(mediaId)
      setMediaState((prev) => {
        if (!(mediaId in prev)) return prev
        const next = { ...prev }
        delete next[mediaId]
        return next
      })
      setRefreshNonce((nonce) => nonce + 1)
    })
  }, [])

  // Load transcripts for any selected media we haven't requested yet. Dedupe is
  // tracked in a ref so this effect never depends on `mediaState` — depending on
  // it would re-run the effect after the `loading` write and strand the fetch.
  useEffect(() => {
    if (!active) return
    const missing = uniqueMediaIds.filter((id) => !requestedRef.current.has(id))
    if (missing.length === 0) return

    for (const id of missing) requestedRef.current.add(id)
    setMediaState((prev) => {
      const next = { ...prev }
      for (const id of missing) next[id] = { status: 'loading' }
      return next
    })

    void Promise.all(
      missing.map(async (mediaId) => {
        try {
          const transcript = await mediaTranscriptionService.getTranscript(mediaId)
          if (!mountedRef.current) return
          setMediaState((prev) => ({
            ...prev,
            [mediaId]: hasWordTimings(transcript)
              ? { status: 'ready', transcript }
              : { status: 'needs' },
          }))
        } catch (error) {
          if (!mountedRef.current) return
          logger.warn('Failed to load transcript', { mediaId, error })
          setMediaState((prev) => ({ ...prev, [mediaId]: { status: 'error' } }))
        }
      }),
    )
  }, [active, uniqueMediaIds, refreshNonce])

  // Keep the active word in view during playback.
  useEffect(() => {
    if (!isPlaying || activeIndex < 0) return
    const key = tokens[activeIndex]?.key
    if (!key) return
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-token-key="${CSS.escape(key)}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [isPlaying, activeIndex, tokens])

  useEffect(() => {
    const stop = () => {
      isSelectingRef.current = false
    }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  const seekToToken = useCallback((frame: number) => {
    usePlaybackStore.getState().setCurrentFrame(frame)
  }, [])

  const handlePointerDown = useCallback(
    (index: number, shiftKey: boolean) => {
      const token = tokens[index]
      if (!token) return
      if (shiftKey && anchorIndex >= 0) {
        setFocusIndex(index)
      } else {
        isSelectingRef.current = true
        setAnchorIndex(index)
        setFocusIndex(index)
      }
      seekToToken(token.startFrame)
    },
    [tokens, anchorIndex, seekToToken],
  )

  const handlePointerEnter = useCallback((index: number) => {
    if (isSelectingRef.current) setFocusIndex(index)
  }, [])

  const handleDelete = useCallback(() => {
    const slice = getSelectedTokenSlice(tokens, anchorIndex, focusIndex)
    if (slice.length === 0) return

    const rangesByMediaId = buildRemovalRangesByMediaId(slice)
    const affectedOrigins = new Set(
      slice.map((token) => itemById[token.itemId]?.originId ?? token.itemId),
    )
    const itemIds = Array.from(new Set(slice.map((token) => token.itemId)))

    let result: { removedItemCount: number } | null = null
    try {
      result = useTimelineStore.getState().removeTranscriptRangesFromItems(itemIds, rangesByMediaId)
    } catch (error) {
      logger.warn('Transcript removal failed', error)
      toast.error(t('transcript.toastRemoveFailed'))
      return
    }

    setAnchorIndex(-1)
    setFocusIndex(-1)

    if (!result || result.removedItemCount === 0) {
      toast.info(t('transcript.toastNothingRemoved'))
      return
    }

    // Re-select every surviving piece of the edited clips so the document stays whole.
    const survivors = useItemsStore
      .getState()
      .items.filter((item) => affectedOrigins.has(item.originId ?? item.id))
      .map((item) => item.id)
    if (survivors.length > 0) {
      useSelectionStore.getState().selectItems(survivors)
    }

    toast.success(t('transcript.toastRemoved', { count: result.removedItemCount }))
  }, [tokens, anchorIndex, focusIndex, itemById, t])

  const handleSearchSubmit = useCallback(() => {
    if (matchIndices.length === 0) return
    const cursor = matchCursor % matchIndices.length
    const tokenIndex = matchIndices[cursor]
    if (tokenIndex === undefined) return
    const token = tokens[tokenIndex]
    if (!token) return
    setAnchorIndex(tokenIndex)
    setFocusIndex(tokenIndex)
    seekToToken(token.startFrame)
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-token-key="${CSS.escape(token.key)}"]`,
    )
    el?.scrollIntoView({ block: 'center' })
    setMatchCursor((prev) => prev + 1)
  }, [matchIndices, matchCursor, tokens, seekToToken])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedKeys.size === 0) return
        event.preventDefault()
        handleDelete()
      } else if (event.key === 'Escape') {
        setAnchorIndex(-1)
        setFocusIndex(-1)
      }
    },
    [selectedKeys.size, handleDelete],
  )

  const needsTranscription = uniqueMediaIds.filter(
    (id) => mediaState[id]?.status === 'needs' || mediaState[id]?.status === 'error',
  )
  const isBusy = uniqueMediaIds.some((id) => {
    const status = mediaState[id]?.status
    return status === 'loading' || status === 'transcribing'
  })

  const handleTranscribe = useCallback(() => {
    const targets = uniqueMediaIds.filter((id) => {
      const status = mediaState[id]?.status
      return status === 'needs' || status === 'error'
    })
    if (targets.length === 0) return

    for (const id of targets) requestedRef.current.add(id)
    setMediaState((prev) => {
      const next = { ...prev }
      for (const id of targets) next[id] = { status: 'transcribing' }
      return next
    })

    void Promise.all(
      targets.map(async (mediaId) => {
        try {
          const result = await runMediaTranscriptionJob(mediaId)
          if (result.status === 'cancelled') {
            setMediaState((prev) => ({ ...prev, [mediaId]: { status: 'needs' } }))
            return
          }
          const { transcript } = result
          setMediaState((prev) => ({
            ...prev,
            [mediaId]: hasWordTimings(transcript)
              ? { status: 'ready', transcript }
              : { status: 'needs' },
          }))
        } catch (error) {
          logger.warn('Transcription failed', { mediaId, error })
          setMediaState((prev) => ({ ...prev, [mediaId]: { status: 'error' } }))
          toast.error(t('transcript.toastTranscribeFailed'))
        }
      }),
    )
  }, [uniqueMediaIds, mediaState, t])

  const selectionCount = selectedKeys.size

  if (transcriptableItems.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Captions className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">{t('transcript.emptySelection')}</p>
      </div>
    )
  }

  return (
    <div
      className="flex h-full flex-col outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={t('transcript.title')}
    >
      {/* Search */}
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setMatchCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSearchSubmit()
              }
            }}
            placeholder={t('transcript.searchPlaceholder')}
            className="h-8 pl-7 text-xs"
          />
        </div>
        {normalizedQuery.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
              {matchIndices.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={matchIndices.length === 0}
              onClick={() => {
                setMatchCursor((prev) => prev + 1)
                handleSearchSubmit()
              }}
              aria-label={t('transcript.nextMatch')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={matchIndices.length === 0}
              onClick={() => {
                setMatchCursor((prev) => (prev + matchIndices.length - 1) % matchIndices.length)
                handleSearchSubmit()
              }}
              aria-label={t('transcript.previousMatch')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Transcript body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {needsTranscription.length > 0 && tokens.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Captions className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">{t('transcript.noTranscript')}</p>
            <Button size="sm" onClick={handleTranscribe} disabled={isBusy}>
              {isBusy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isBusy ? t('transcript.transcribing') : t('transcript.generate')}
            </Button>
          </div>
        ) : tokens.length === 0 && isBusy ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('transcript.loading')}
          </div>
        ) : (
          <p className="select-none text-sm leading-7">
            {tokens.map((token, index) => {
              const isActive = index === activeIndex
              const isSelected = selectedKeys.has(token.key)
              const isMatch = matchKeys.has(token.key)
              return (
                <span
                  key={token.key}
                  data-token-key={token.key}
                  onPointerDown={(event) => handlePointerDown(index, event.shiftKey)}
                  onPointerEnter={() => handlePointerEnter(index)}
                  className={[
                    'cursor-pointer rounded px-0.5 transition-colors duration-100',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'bg-yellow-300 font-semibold text-neutral-900 shadow-sm'
                        : isMatch
                          ? 'text-foreground ring-1 ring-inset ring-amber-500/70'
                          : 'text-foreground hover:bg-secondary/60',
                  ].join(' ')}
                >
                  {token.text}{' '}
                </span>
              )
            })}
          </p>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 border-t border-border p-2">
        <span className="text-xs text-muted-foreground">
          {selectionCount > 0
            ? t('transcript.wordsSelected', { count: selectionCount })
            : t('transcript.selectHint')}
        </span>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
          disabled={selectionCount === 0}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('transcript.deleteSelection')}
        </Button>
      </div>
    </div>
  )
}
