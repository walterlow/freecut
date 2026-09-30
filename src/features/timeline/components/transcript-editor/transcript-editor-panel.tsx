import {
  Fragment,
  memo,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Captions,
  CircleCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  Loader2,
  Palette,
  RefreshCw,
  Replace,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CaptionStyleControls } from '@/features/editor/components/properties-sidebar/clip-panel/caption-style-controls'
import { useProjectStore } from '@/features/media-library/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { SubtitleSegmentItem, TextItem, TimelineItem } from '@/types/timeline'
import {
  TranscribeDialog,
  type TranscribeDialogValues,
} from '@/features/timeline/deps/transcribe-dialog'
import { cn } from '@/shared/ui/cn'
import { createLogger } from '@/shared/logging/logger'
import { joinTranscriptWords, needsTranscriptWordSeparator } from '@/shared/utils/transcript-text'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useClipboardStore } from '@/shared/state/clipboard'
import { useEditorStore } from '@/shared/state/editor'
import type { MediaTranscript } from '@/types/storage'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useTimelineStore } from '../../stores/timeline-store'
import {
  countIgnoredSpans,
  totalIgnoredSeconds,
  useTranscriptIgnoreStore,
} from '../../stores/transcript-ignore-store'
import { buildTranscriptClipboardItems } from '../../utils/transcript-clipboard'
import { registerTranscriptCopyHandler } from '../../utils/transcript-copy-bridge'
import {
  cancelMediaTranscriptionJob,
  mediaTranscriptionService,
  runMediaTranscriptionJob,
} from '../../deps/media-transcription-service'
import {
  buildRemovalRangesByMediaId,
  buildTranscriptTokens,
  findActiveTokenIndex,
  getSelectedTokenSlice,
  isTranscriptableItem,
  type TranscriptToken,
} from '../../utils/transcript-edit-model'
import { isSpanIgnored } from '../../utils/source-range-intervals'
import { findTranscriptWordMatches } from '../../utils/transcript-fuzzy'

const logger = createLogger('TranscriptEditorPanel')

type MediaStatus = 'loading' | 'ready' | 'needs' | 'error' | 'transcribing'
type TranscriptScope = 'selection' | 'project'

/** Pause (seconds) that starts a new transcript paragraph. */
const PARAGRAPH_GAP_SECONDS = 0.6
/** Soft/hard word caps so pause-less speech still breaks into readable blocks. */
const SEGMENT_SOFT_MAX_WORDS = 28
const SEGMENT_HARD_MAX_WORDS = 40

/** Timeline seconds → compact `m:ss` (or `h:mm:ss`) timecode. */
function formatTimecode(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = whole % 60
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

interface MediaEntry {
  status: MediaStatus
  transcript?: MediaTranscript
  errorMessage?: string
}

function hasWordTimings(
  transcript: MediaTranscript | null | undefined,
): transcript is MediaTranscript {
  return !!transcript && transcript.segments.some((segment) => (segment.words?.length ?? 0) > 0)
}

/** A run of words rendered as one timestamped paragraph. */
interface TranscriptSegment {
  key: string
  startFrame: number
  startSeconds: number
  firstIndex: number
  lastIndex: number
  indices: number[]
  /** True when this paragraph opens a new source clip (draws a divider). */
  isClipStart: boolean
}

const SENTENCE_END = /[.?!]["')\]]?$/

/**
 * Group the flat token stream into timestamped paragraphs. Breaks fall at clip
 * changes and real pauses; soft/hard word caps keep pause-less speech from
 * collapsing back into a wall.
 */
function buildSegments(
  tokens: readonly TranscriptToken[],
  timelineFps: number,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []
  let current: TranscriptSegment | null = null
  let wordCount = 0

  tokens.forEach((token, index) => {
    const prev = index > 0 ? tokens[index - 1] : undefined
    const clipChange = !!prev && prev.itemId !== token.itemId
    const pause = !!prev && token.sourceStart - prev.sourceEnd >= PARAGRAPH_GAP_SECONDS
    const sentenceWrap =
      !!prev && wordCount >= SEGMENT_SOFT_MAX_WORDS && SENTENCE_END.test(prev.text)
    const overflow = wordCount >= SEGMENT_HARD_MAX_WORDS

    if (!current || clipChange || pause || sentenceWrap || overflow) {
      current = {
        key: token.key,
        startFrame: token.startFrame,
        startSeconds: token.startFrame / timelineFps,
        firstIndex: index,
        lastIndex: index,
        indices: [index],
        isClipStart: clipChange,
      }
      segments.push(current)
      wordCount = 1
    } else {
      current.indices.push(index)
      current.lastIndex = index
      wordCount += 1
    }
  })

  return segments
}

interface InlineWordEditorProps {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}

const InlineWordEditor = memo(function InlineWordEditor({
  initialText,
  onSave,
  onCancel,
}: InlineWordEditorProps) {
  const [value, setValue] = useState(initialText)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleCommit = () => {
    const trimmed = value.trim()
    if (trimmed !== initialText) {
      onSave(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          handleCommit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
      onBlur={handleCommit}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="inline-block h-6 min-w-[2.5rem] rounded border border-primary bg-background px-1 py-0 text-xs font-semibold text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-primary"
      style={{ width: `${Math.max(4, value.length + 2)}ch` }}
    />
  )
})

interface TranscriptSegmentRowProps {
  segment: TranscriptSegment
  tokens: readonly TranscriptToken[]
  /** Global index of the active word, or -1 when it falls outside this segment. */
  activeIndex: number
  selectedKeys: ReadonlySet<string>
  matchKeys: ReadonlySet<string>
  ignoredKeys: ReadonlySet<string>
  matchesApproximate: boolean
  onSeek: (frame: number) => void
  onPointerDown: (index: number, event: ReactPointerEvent) => void
  editingTokenKey?: string | null
  onStartEdit?: (tokenKey: string) => void
  onSaveEdit?: (token: TranscriptToken, newText: string) => void
  onCancelEdit?: () => void
}

/**
 * One timestamped paragraph. Memoized so the per-frame playhead highlight only
 * re-renders the segment that gains/loses the active word — the parent passes
 * activeIndex={-1} to every other segment, so React.memo bails on them and the
 * full transcript no longer reconciles each frame during playback/skim.
 */
const TranscriptSegmentRow = memo(function TranscriptSegmentRow({
  segment,
  tokens,
  activeIndex,
  selectedKeys,
  matchKeys,
  ignoredKeys,
  matchesApproximate,
  onSeek,
  onPointerDown,
  editingTokenKey,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
}: TranscriptSegmentRowProps) {
  const { t } = useTranslation()
  return (
    <Fragment>
      {segment.isClipStart && (
        <div className="flex items-center gap-2 pt-4 pb-1 first:pt-0" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('transcript.boundaryClip', { defaultValue: 'New clip' })}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className="group grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 py-1.5">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onSeek(segment.startFrame)}
          aria-label={t('transcript.jumpTo', {
            defaultValue: 'Jump to {{time}}',
            time: formatTimecode(segment.startSeconds),
          })}
          className="mt-px h-fit select-none rounded text-right font-mono text-[11px] tabular-nums leading-7 text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {formatTimecode(segment.startSeconds)}
        </button>
        <p className="min-w-0 break-words text-[13px] leading-7">
          {segment.indices.map((index) => {
            const token = tokens[index]
            if (!token) return null
            const nextToken = index < segment.lastIndex ? tokens[index + 1] : undefined
            const isActive = index === activeIndex
            const isSelected = selectedKeys.has(token.key)
            const isMatch = matchKeys.has(token.key)
            const isIgnored = ignoredKeys.has(token.key)
            const isEditing = editingTokenKey === token.key

            if (isEditing) {
              return (
                <span key={token.key} className="inline-block mr-1">
                  <InlineWordEditor
                    initialText={token.text}
                    onSave={(newText) => onSaveEdit?.(token, newText)}
                    onCancel={() => onCancelEdit?.()}
                  />
                  {nextToken && needsTranscriptWordSeparator(token.text, nextToken.text) ? ' ' : ''}
                </span>
              )
            }

            return (
              <span
                key={token.key}
                data-token-key={token.key}
                data-token-index={index}
                onPointerDown={(event) => onPointerDown(index, event)}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  onStartEdit?.(token.key)
                }}
                title={t('transcript.doubleClickToEdit', { defaultValue: 'Doble clic para editar palabra' })}
                className={cn(
                  'cursor-text rounded px-0.5 transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'bg-yellow-300 text-neutral-900 shadow-sm'
                      : isMatch
                        ? matchesApproximate
                          ? 'text-foreground ring-1 ring-inset ring-amber-500/40'
                          : 'text-foreground ring-1 ring-inset ring-amber-500/70'
                        : 'text-foreground/85 hover:bg-secondary/60 hover:text-foreground',
                  isIgnored && 'line-through decoration-from-font opacity-45',
                )}
              >
                {token.text}
                {nextToken && needsTranscriptWordSeparator(token.text, nextToken.text) ? ' ' : ''}
              </span>
            )
          })}
        </p>
      </div>
    </Fragment>
  )
})

export interface TranscriptEditorPanelProps {
  /** Only fetch/transcribe while the tab is actually visible. */
  active: boolean
}

export function TranscriptEditorPanel({ active }: TranscriptEditorPanelProps) {
  const { t } = useTranslation()
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const itemById = useItemsStore((s) => s.itemById)
  const allItems = useItemsStore((s) => s.items)
  const timelineFps = useTimelineSettingsStore((s) => s.fps)
  // Only track the playhead while the tab is visible. The panel is always mounted
  // (media-sidebar toggles a CSS `hidden` class, never unmounts), so subscribing to
  // currentFrame unconditionally would re-render + reconcile the whole token list on
  // every playback/skim frame even when hidden. When inactive the selector returns a
  // constant, so zustand skips the re-render entirely.
  const currentFrame = usePlaybackStore((s) => (active ? s.currentFrame : 0))
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const ignoreRanges = useTranscriptIgnoreStore((s) => s.ranges)
  const setTranscriptShortcutScope = useEditorStore((s) => s.setTranscriptEditorShortcutScopeActive)

  const [scope, setScope] = useState<TranscriptScope>('selection')
  const [mediaState, setMediaState] = useState<Record<string, MediaEntry>>({})
  const [anchorIndex, setAnchorIndex] = useState(-1)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [query, setQuery] = useState('')
  const [editingTokenKey, setEditingTokenKey] = useState<string | null>(null)
  const [isReplaceOpen, setIsReplaceOpen] = useState(false)
  const [replaceValue, setReplaceValue] = useState('')
  const [transcribeDialogOpen, setTranscribeDialogOpen] = useState(false)
  const [stylesDialogOpen, setStylesDialogOpen] = useState(false)
  const updateItem = useTimelineStore((s) => s.updateItem)
  const currentProject = useProjectStore((s) => s.currentProject)
  const canvasWidth = currentProject?.metadata?.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = currentProject?.metadata?.height ?? DEFAULT_PROJECT_HEIGHT
  // -1 means "no match shown yet", so the first Next/Enter lands on match 0.
  const [matchCursor, setMatchCursor] = useState(-1)
  // Bumped when a stored transcript changes externally (e.g. deleted from the media
  // library) to force the load effect to re-fetch instead of serving the stale cache.
  const [refreshNonce, setRefreshNonce] = useState(0)

  const [pointerWithin, setPointerWithin] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)

  const isSelectingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // mediaIds we've already kicked off a load for — keeps the load effect from
  // depending on `mediaState` (which would re-run it and cancel its own fetch).
  const requestedRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  // Mirror anchorIndex so handlePointerDown can read it without listing it as a
  // dependency — otherwise every selection click swaps the callback reference and
  // re-renders all TranscriptSegmentRows, defeating their React.memo.
  const anchorIndexRef = useRef(anchorIndex)
  anchorIndexRef.current = anchorIndex

  // Own Delete/Backspace whenever the pointer or focus is inside the panel, so
  // the timeline's clip-delete shortcut yields to us (see use-editing-shortcuts).
  useEffect(() => {
    setTranscriptShortcutScope(active && (pointerWithin || focusWithin))
  }, [active, pointerWithin, focusWithin, setTranscriptShortcutScope])

  useEffect(() => () => setTranscriptShortcutScope(false), [setTranscriptShortcutScope])

  const transcriptableItems = useMemo(() => {
    if (scope === 'project') {
      return allItems.filter(isTranscriptableItem).toSorted((a, b) => a.from - b.from)
    }
    return selectedItemIds.map((id) => itemById[id]).filter(isTranscriptableItem)
  }, [scope, allItems, selectedItemIds, itemById])

  const uniqueMediaIds = useMemo(
    () => Array.from(new Set(transcriptableItems.map((item) => item.mediaId))).sort(),
    [transcriptableItems],
  )

  const matchingSubtitleSegments = useMemo(() => {
    return allItems.filter((item): item is SubtitleSegmentItem => {
      if (item.type !== 'subtitle') return false
      if (!item.source) return true
      if (item.source.type === 'transcript') {
        return uniqueMediaIds.length === 0 || uniqueMediaIds.includes(item.source.mediaId)
      }
      return true
    })
  }, [allItems, uniqueMediaIds])

  const virtualTranscriptClips = useMemo(() => {
    return transcriptableItems.filter(
      (item) => item.transcriptCaptions?.type === 'transcript',
    )
  }, [transcriptableItems])

  const syntheticItem = useMemo<SubtitleSegmentItem>(() => {
    const firstClip = virtualTranscriptClips[0] ?? transcriptableItems[0]
    const sampleStyle = firstClip?.transcriptCaptions?.style ?? {}
    return {
      id: firstClip?.id ?? 'preview-sample',
      type: 'subtitle',
      trackId: firstClip?.trackId ?? 'track-subs',
      from: firstClip?.from ?? 0,
      durationInFrames: firstClip?.durationInFrames ?? 150,
      label: 'Transcript',
      mediaId: firstClip?.mediaId ?? '',
      source: {
        type: 'transcript',
        mediaId: firstClip?.mediaId ?? '',
        clipId: firstClip?.id ?? '',
      },
      cues: [],
      color: sampleStyle.color ?? '#ffffff',
      ...sampleStyle,
    }
  }, [virtualTranscriptClips, transcriptableItems])

  const handleApplyCaptionStyle = useCallback(
    (patch: Partial<SubtitleSegmentItem | TextItem>) => {
      for (const seg of matchingSubtitleSegments) {
        updateItem(seg.id, patch)
      }
      for (const clip of transcriptableItems) {
        const prevCaptions = clip.transcriptCaptions
        updateItem(clip.id, {
          transcriptCaptions: {
            type: 'transcript',
            mediaId: clip.mediaId,
            enabled: prevCaptions?.enabled ?? true,
            updatedAt: Date.now(),
            sourceTranscriptUpdatedAt: prevCaptions?.sourceTranscriptUpdatedAt ?? Date.now(),
            timingVersion: prevCaptions?.timingVersion ?? 4,
            cues: prevCaptions?.cues ?? [],
            style: {
              ...(prevCaptions?.style ?? {}),
              ...patch,
            },
          },
        } as Partial<TimelineItem>)
      }
    },
    [matchingSubtitleSegments, transcriptableItems, updateItem],
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

  const segments = useMemo(() => buildSegments(tokens, timelineFps), [tokens, timelineFps])

  const sourceCoverage = useMemo(() => {
    if (scope !== 'selection' || uniqueMediaIds.length !== 1 || tokens.length === 0) return null
    return tokens.reduce(
      (coverage, token) => ({
        start: Math.min(coverage.start, token.sourceStart),
        end: Math.max(coverage.end, token.sourceEnd),
      }),
      { start: Number.POSITIVE_INFINITY, end: 0 },
    )
  }, [scope, uniqueMediaIds, tokens])

  const selectedSlice = useMemo(
    () => getSelectedTokenSlice(tokens, anchorIndex, focusIndex),
    [tokens, anchorIndex, focusIndex],
  )
  const selectedKeys = useMemo(
    () => new Set(selectedSlice.map((token) => token.key)),
    [selectedSlice],
  )

  const ignoredKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const token of tokens) {
      if (isSpanIgnored(token.sourceStart, token.sourceEnd, ignoreRanges[token.mediaId])) {
        keys.add(token.key)
      }
    }
    return keys
  }, [tokens, ignoreRanges])

  const ignoredSpanCount = useMemo(() => countIgnoredSpans(ignoreRanges), [ignoreRanges])
  const ignoredSeconds = useMemo(() => totalIgnoredSeconds(ignoreRanges), [ignoreRanges])

  const hasQuery = query.trim().length > 0
  const searchResult = useMemo(
    () =>
      findTranscriptWordMatches(
        tokens.map((token) => token.text),
        query,
      ),
    [tokens, query],
  )
  const matchSpans = searchResult.spans
  const matchesApproximate = searchResult.approximate

  // One phrase = one navigable result (count + next/prev use matchSpans); every
  // token inside a span is highlighted.
  const matchKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const span of matchSpans) {
      for (let index = span.start; index <= span.end; index++) {
        const key = tokens[index]?.key
        if (key) keys.add(key)
      }
    }
    return keys
  }, [matchSpans, tokens])

  // Reset transient UI when the document changes (clips or scope).
  useEffect(() => {
    setAnchorIndex(-1)
    setFocusIndex(-1)
    setMatchCursor(0)
  }, [uniqueMediaIds, scope])

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

  // Load transcripts for any media we haven't requested yet. Dedupe is tracked in
  // a ref so this effect never depends on `mediaState` — depending on it would
  // re-run the effect after the `loading` write and strand the fetch.
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
          if (transcript) {
            mediaTranscriptionService.syncExistingTranscriptCaptions(mediaId, transcript)
          }
          setMediaState((prev) => ({
            ...prev,
            [mediaId]: hasWordTimings(transcript)
              ? { status: 'ready', transcript }
              : { status: 'needs' },
          }))
        } catch (error) {
          if (!mountedRef.current) return
          logger.warn('Failed to load transcript', { mediaId, error })
          const errorMessage =
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : t('transcript.toastTranscribeFailed')
          setMediaState((prev) => ({
            ...prev,
            [mediaId]: { status: 'error', errorMessage },
          }))
        }
      }),
    )
  }, [active, uniqueMediaIds, refreshNonce, t])

  // Keep the active word in view during playback. Skip entirely when hidden — a
  // querySelector + scrollIntoView every frame on an off-screen panel is pure waste.
  useEffect(() => {
    if (!active || !isPlaying || activeIndex < 0) return
    const key = tokens[activeIndex]?.key
    if (!key) return
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-token-key="${CSS.escape(key)}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, isPlaying, activeIndex, tokens])

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
    (index: number, event: ReactPointerEvent) => {
      const token = tokens[index]
      if (!token) return
      if (event.shiftKey && anchorIndexRef.current >= 0) {
        setFocusIndex(index)
      } else {
        isSelectingRef.current = true
        setAnchorIndex(index)
        setFocusIndex(index)
      }
      // Focus the panel so Delete/Backspace land on our handler (which marks the
      // selection) instead of leaking to the timeline.
      rootRef.current?.focus({ preventScroll: true })
      // Capture the pointer so the drag keeps extending even when the cursor
      // outruns the words or strays into padding/gaps — pointermove then routes
      // here regardless of what's under the cursor.
      scrollRef.current?.setPointerCapture(event.pointerId)
      seekToToken(token.startFrame)
    },
    [tokens, seekToToken],
  )

  // Drag-extend by hit-testing the word under the cursor on every move. This is
  // far smoother than per-span onPointerEnter (which skips words on fast drags
  // and stalls over any non-word pixel). setFocusIndex bails out when the index
  // is unchanged, so this only re-renders on an actual word boundary crossing.
  const handlePointerMove = useCallback((event: ReactPointerEvent) => {
    if (!isSelectingRef.current) return
    const el = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-token-index]')
    if (!el) return
    const index = Number(el.dataset.tokenIndex)
    if (Number.isInteger(index)) setFocusIndex(index)
  }, [])

  // Non-destructive: striking words stages them as "ignored" (restorable) rather
  // than cutting the timeline. Re-striking an already-ignored selection restores it.
  const handleIgnoreToggle = useCallback(() => {
    if (selectedSlice.length === 0) return
    const ranges = buildRemovalRangesByMediaId(selectedSlice)
    const allIgnored = selectedSlice.every((token) => ignoredKeys.has(token.key))
    if (allIgnored) {
      useTranscriptIgnoreStore.getState().restore(ranges)
    } else {
      useTranscriptIgnoreStore.getState().ignore(ranges)
    }
  }, [selectedSlice, ignoredKeys])

  // Word-level copy/cut that carries the media: each run of selected words
  // becomes a trimmed clone of its clip, placed on the shared clipboard so the
  // existing global paste (Ctrl+V) drops the spans onto the timeline. Cut also
  // removes the words from the timeline immediately.
  const handleCopyWords = useCallback(
    (cut: boolean) => {
      if (selectedSlice.length === 0) return
      const clones = buildTranscriptClipboardItems(selectedSlice, itemById, timelineFps)
      if (clones.length === 0) return

      const currentFrame = usePlaybackStore.getState().currentFrame
      useClipboardStore.getState().copyItems(clones, currentFrame, cut ? 'cut' : 'copy')
      void navigator.clipboard
        ?.writeText(selectedSlice.map((token) => token.text).join(' '))
        .catch(() => {})

      const count = selectedSlice.length
      if (!cut) {
        toast.success(
          t('transcript.toastCopied', { defaultValue: 'Copied {{count}} words', count }),
        )
        return
      }

      const rangesByMediaId = buildRemovalRangesByMediaId(selectedSlice)
      const itemIds = Array.from(new Set(selectedSlice.map((token) => token.itemId)))
      try {
        useTimelineStore.getState().removeTranscriptRangesFromItems(itemIds, rangesByMediaId)
      } catch (error) {
        logger.warn('Transcript cut failed', error)
        toast.error(t('transcript.toastRemoveFailed'))
        return
      }
      setAnchorIndex(-1)
      setFocusIndex(-1)
      toast.success(t('transcript.toastCut', { defaultValue: 'Cut {{count}} words', count }))
    },
    [selectedSlice, itemById, timelineFps, t],
  )

  // Bridge Ctrl+C / Ctrl+X to word-level copy/cut. The global clipboard hotkeys
  // fire on the capture phase before this panel sees the key, so we register a
  // handler they consult first — claiming the keys only while the transcript tab
  // is visible and words are selected (otherwise they copy the clip as usual).
  const handleCopyWordsRef = useRef(handleCopyWords)
  handleCopyWordsRef.current = handleCopyWords
  const copyActiveRef = useRef(false)
  copyActiveRef.current = active && selectedSlice.length > 0
  useEffect(() => {
    return registerTranscriptCopyHandler({
      isActive: () => copyActiveRef.current,
      copy: (cut) => handleCopyWordsRef.current(cut),
    })
  }, [])

  const selectionAllIgnored =
    selectedSlice.length > 0 && selectedSlice.every((token) => ignoredKeys.has(token.key))

  // Commit: turn every staged ignore into a real, single undoable timeline edit.
  const handleApply = useCallback(() => {
    const ignoredMediaIds = Object.keys(useTranscriptIgnoreStore.getState().ranges)
    if (ignoredMediaIds.length === 0) return

    const ignoredSet = new Set(ignoredMediaIds)
    const affectedOrigins = new Set(
      useItemsStore
        .getState()
        .items.filter((item) => isTranscriptableItem(item) && ignoredSet.has(item.mediaId))
        .map((item) => item.originId ?? item.id),
    )

    let result: { removedItemCount: number } | null = null
    try {
      result = useTranscriptIgnoreStore.getState().commit()
    } catch (error) {
      logger.warn('Transcript apply failed', error)
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
    if (scope === 'selection') {
      const survivors = useItemsStore
        .getState()
        .items.filter((item) => affectedOrigins.has(item.originId ?? item.id))
        .map((item) => item.id)
      if (survivors.length > 0) useSelectionStore.getState().selectItems(survivors)
    }

    toast.success(t('transcript.toastRemoved', { count: result.removedItemCount }))
  }, [scope, t])

  const handleRestoreAll = useCallback(() => {
    useTranscriptIgnoreStore.getState().clear()
  }, [])

  // Jump to a specific match. Callers own the cursor math (next/prev/Enter) and
  // pass the target index; this normalizes, selects, and records the cursor in a
  // single update so navigation never double-increments.
  const goToMatch = useCallback(
    (target: number) => {
      if (matchSpans.length === 0) return
      const cursor = ((target % matchSpans.length) + matchSpans.length) % matchSpans.length
      const span = matchSpans[cursor]
      if (!span) return
      const token = tokens[span.start]
      if (!token) return
      // Select the whole matched run so a phrase jump highlights the phrase.
      setAnchorIndex(span.start)
      setFocusIndex(span.end)
      seekToToken(token.startFrame)
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-token-key="${CSS.escape(token.key)}"]`,
      )
      el?.scrollIntoView({ block: 'center' })
      setMatchCursor(cursor)
    },
    [matchSpans, tokens, seekToToken],
  )

  const handleSaveWord = useCallback(
    async (token: TranscriptToken, newText: string) => {
      setEditingTokenKey(null)
      const trimmed = newText.trim()
      if (trimmed === token.text) return

      const transcript = mediaState[token.mediaId]?.transcript
      if (!transcript) return

      const isDelete = trimmed.length === 0

      const nextSegments = transcript.segments
        .map((seg, sIdx) => {
          if (token.segmentIndex !== undefined) {
            if (sIdx !== token.segmentIndex) return seg
          } else {
            if (token.sourceStart < seg.start - 0.05 || token.sourceEnd > seg.end + 0.05) return seg
          }

          if (isDelete) {
            const nextWords = (seg.words ?? []).filter((w, wIdx) => {
              return token.wordIndex !== undefined
                ? wIdx !== token.wordIndex
                : Math.abs(w.start - token.sourceStart) >= 0.05
            })
            const nextText = joinTranscriptWords(nextWords.map((w) => w.text))
            return {
              ...seg,
              words: nextWords,
              text: nextText,
            }
          }

          let wordMatched = false
          const nextWords = (seg.words ?? []).map((w, wIdx) => {
            const matches =
              token.wordIndex !== undefined
                ? wIdx === token.wordIndex
                : Math.abs(w.start - token.sourceStart) < 0.1
            if (!matches) return w
            wordMatched = true
            return { ...w, text: trimmed }
          })

          const hasWords = nextWords.length > 0
          return {
            ...seg,
            words: hasWords ? nextWords : seg.words,
            text: hasWords && wordMatched
              ? joinTranscriptWords(nextWords.map((w) => w.text))
              : (!hasWords && (sIdx === token.segmentIndex || (token.sourceStart >= seg.start && token.sourceEnd <= seg.end)))
                ? trimmed
                : seg.text,
          }
        })
        .filter((seg) => seg.text.trim().length > 0)

      const updatedTranscript: MediaTranscript = {
        ...transcript,
        segments: nextSegments,
        text: nextSegments.map((s) => s.text).join('\n'),
        updatedAt: Date.now(),
      }

      setMediaState((prev) => ({
        ...prev,
        [token.mediaId]: {
          status: 'ready',
          transcript: updatedTranscript,
        },
      }))

      try {
        await mediaTranscriptionService.updateTranscript(updatedTranscript)
        const currentProjectId = useProjectStore.getState().currentProject?.id
        if (currentProjectId) {
          void useTimelineStore.getState().saveTimeline?.(currentProjectId).catch(() => {})
        }
        toast.success(
          isDelete
            ? t('transcript.wordDeleted', { defaultValue: 'Palabra eliminada' })
            : t('transcript.wordUpdated', { defaultValue: 'Palabra actualizada' }),
        )
      } catch (err) {
        logger.warn('Failed to update transcript word', err)
        toast.error(t('transcript.wordUpdateFailed', { defaultValue: 'Error al actualizar palabra' }))
      }
    },
    [mediaState, t],
  )

  const handleReplaceOne = useCallback(async () => {
    if (matchSpans.length === 0 || matchCursor < 0) return
    const span = matchSpans[matchCursor]
    if (!span) return
    const token = tokens[span.start]
    if (!token) return

    await handleSaveWord(token, replaceValue)
    goToMatch(matchCursor)
  }, [matchSpans, matchCursor, tokens, handleSaveWord, replaceValue, goToMatch])

  const handleReplaceAll = useCallback(async () => {
    const findStr = query.trim()
    const repStr = replaceValue.trim()
    if (!findStr) return

    const findLower = findStr.toLowerCase()
    let totalReplaced = 0

    for (const mediaId of uniqueMediaIds) {
      const transcript = mediaState[mediaId]?.transcript
      if (!transcript) continue

      let modified = false
      const nextSegments = transcript.segments.map((seg) => {
        let segModified = false
        const nextWords = (seg.words ?? []).map((w) => {
          if (w.text.trim().toLowerCase() === findLower) {
            segModified = true
            totalReplaced += 1
            return { ...w, text: repStr }
          }
          return w
        })

        if (!segModified) return seg
        modified = true
        return {
          ...seg,
          words: nextWords,
          text: joinTranscriptWords(nextWords.map((w) => w.text)),
        }
      })

      if (modified) {
        const updatedTranscript: MediaTranscript = {
          ...transcript,
          segments: nextSegments,
          text: nextSegments.map((s) => s.text).join('\n'),
          updatedAt: Date.now(),
        }
        setMediaState((prev) => ({
          ...prev,
          [mediaId]: {
            status: 'ready',
            transcript: updatedTranscript,
          },
        }))
        await mediaTranscriptionService.updateTranscript(updatedTranscript)
      }
    }

    if (totalReplaced > 0) {
      toast.success(
        t('transcript.toastReplacedAll', {
          defaultValue: 'Se reemplazaron {{count}} palabras',
          count: totalReplaced,
        }),
      )
    } else {
      toast.info(t('transcript.toastNoMatches', { defaultValue: 'No se encontraron coincidencias' }))
    }
  }, [query, replaceValue, uniqueMediaIds, mediaState, t])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Never hijack typing in the search box (or any input that bubbles here).
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Always own these so they never fall through to the timeline's clip
        // delete — even with no selection (then it's simply a no-op).
        event.preventDefault()
        event.stopPropagation()
        if (selectedKeys.size > 0) handleIgnoreToggle()
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        if (ignoredSpanCount === 0) return
        event.preventDefault()
        event.stopPropagation()
        handleApply()
      } else if (event.key === 'F2' || (event.key === 'e' && !event.ctrlKey && !event.metaKey)) {
        if (selectedSlice.length === 1 && selectedSlice[0]) {
          event.preventDefault()
          event.stopPropagation()
          setEditingTokenKey(selectedSlice[0].key)
        }
      } else if (event.key === 'Escape') {
        setAnchorIndex(-1)
        setFocusIndex(-1)
        setEditingTokenKey(null)
      }
    },
    [selectedKeys.size, handleIgnoreToggle, ignoredSpanCount, handleApply, selectedSlice],
  )

  const needsTranscription = uniqueMediaIds.filter(
    (id) => mediaState[id]?.status === 'needs' || mediaState[id]?.status === 'error',
  )
  const isBusy = uniqueMediaIds.some((id) => {
    const status = mediaState[id]?.status
    return status === 'loading' || status === 'transcribing'
  })

  const handleTranscribe = useCallback((values: TranscribeDialogValues) => {
    const pendingTargets = uniqueMediaIds.filter((id) => {
      const status = mediaState[id]?.status
      return status === 'needs' || status === 'error'
    })
    const targets = pendingTargets.length > 0 ? pendingTargets : uniqueMediaIds
    if (targets.length === 0) return

    setTranscribeDialogOpen(false)

    for (const id of targets) requestedRef.current.add(id)
    setMediaState((prev) => {
      const next = { ...prev }
      for (const id of targets) next[id] = { status: 'transcribing' }
      return next
    })

    void Promise.all(
      targets.map(async (mediaId) => {
        try {
          const result = await runMediaTranscriptionJob(mediaId, {
            ...values,
            onModelFallback: () => {
              toast.info(t('transcript.largeTurboFallback'))
            },
          })
          if (!mountedRef.current) return
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
          const errorMessage = isTranscriptionOutOfMemoryError(error)
            ? TRANSCRIPTION_OOM_HINT
            : error instanceof Error && error.message.trim().length > 0
              ? error.message
              : t('transcript.toastTranscribeFailed')
          if (mountedRef.current) {
            setMediaState((prev) => ({
              ...prev,
              [mediaId]: { status: 'error', errorMessage },
            }))
          }
          toast.error(errorMessage)
        }
      }),
    )
  }, [uniqueMediaIds, mediaState, t])

  const transcriptionError = useMemo(
    () =>
      needsTranscription
        .map((mediaId) => mediaState[mediaId])
        .find((entry) => entry?.status === 'error')?.errorMessage,
    [mediaState, needsTranscription],
  )

  const transcriptionFileName = useMemo(() => {
    if (needsTranscription.length !== 1) {
      return t('transcript.selectedClips', {
        defaultValue: '{{count}} selected clips',
        count: needsTranscription.length,
      })
    }
    const mediaId = needsTranscription[0]
    return (
      transcriptableItems.find((item) => item.mediaId === mediaId)?.label ??
      t('transcript.selectedClip', { defaultValue: 'Selected clip' })
    )
  }, [needsTranscription, transcriptableItems, t])

  const handleClearTranscripts = useCallback(async () => {
    const readyTargets = uniqueMediaIds.filter(
      (id) =>
        mediaState[id]?.status === 'ready' ||
        Boolean(mediaState[id]?.transcript) ||
        transcriptableItems.some(
          (item) =>
            item.mediaId === id &&
            item.transcriptCaptions?.cues &&
            item.transcriptCaptions.cues.length > 0,
        ),
    )
    const targets = readyTargets.length > 0 ? readyTargets : uniqueMediaIds
    if (targets.length === 0) return

    let deletedCount = 0
    for (const mediaId of targets) {
      try {
        await mediaTranscriptionService.deleteTranscript(mediaId)
        requestedRef.current.delete(mediaId)
        deletedCount += 1
      } catch (err) {
        logger.warn('Failed to delete transcript', { mediaId, err })
      }
    }
    setAnchorIndex(-1)
    setFocusIndex(-1)
    setMediaState((prev) => {
      const next = { ...prev }
      for (const id of targets) {
        next[id] = { status: 'needs' }
      }
      return next
    })
    toast.success(
      deletedCount === 1
        ? t('media.card.transcriptDeletedFor', { name: transcriptionFileName })
        : t('media.card.transcriptsDeleted', { count: deletedCount }),
    )
  }, [uniqueMediaIds, mediaState, transcriptableItems, t, transcriptionFileName])

  const selectionCount = selectedKeys.size

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col outline-none"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onPointerEnter={() => setPointerWithin(true)}
      onPointerLeave={() => setPointerWithin(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false)
        }
      }}
      role="region"
      aria-label={t('transcript.title')}
    >
      {/* Scope toggle & actions */}
      <div className="flex items-center justify-between gap-2 border-b border-border p-2">
        <ScopeToggle scope={scope} onChange={setScope} t={t} />
        {tokens.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {selectedSlice.length === 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 px-2 text-primary"
                onClick={() => setEditingTokenKey(selectedSlice[0]!.key)}
                title="Editar palabra seleccionada (o doble clic)"
              >
                <Edit3 className="h-3 w-3" />
                <span className="hidden sm:inline">Editar</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 px-2 text-primary hover:text-primary"
              onClick={() => setStylesDialogOpen(true)}
              title={t('transcript.styleButtonTooltip', {
                defaultValue: 'Personalizar tipografía, sombra, contorno, fondo y animaciones',
              })}
            >
              <Palette className="h-3 w-3" />
              <span className="hidden sm:inline">
                {t('transcript.styleButton', { defaultValue: 'Estilos' })}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 px-2"
              onClick={() => setTranscribeDialogOpen(true)}
              title="Volver a transcribir o cambiar configuración"
            >
              <RefreshCw className="h-3 w-3" />
              <span className="hidden sm:inline">Regenerar</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleClearTranscripts}
              title="Eliminar transcripción y limpiar panel"
            >
              <Trash2 className="h-3 w-3" />
              <span className="hidden sm:inline">Limpiar</span>
            </Button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setMatchCursor(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                goToMatch(matchCursor + 1)
              }
            }}
            placeholder={t('transcript.searchPlaceholder')}
            className={cn('h-8 pl-7 text-xs', query.length > 0 && 'pr-7')}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setMatchCursor(-1)
              }}
              aria-label={t('transcript.clearSearch', { defaultValue: 'Clear search' })}
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {hasQuery && (
          <div className="flex items-center gap-1">
            <span
              className="w-12 text-right text-xs tabular-nums text-muted-foreground"
              data-tooltip={
                matchesApproximate
                  ? t('transcript.approxMatches', { defaultValue: 'Approximate matches' })
                  : undefined
              }
            >
              {matchesApproximate && matchSpans.length > 0 ? '~' : ''}
              {matchSpans.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={matchSpans.length === 0}
              onClick={() => goToMatch(matchCursor + 1)}
              aria-label={t('transcript.nextMatch')}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={matchSpans.length === 0}
              onClick={() => goToMatch(matchCursor - 1)}
              aria-label={t('transcript.previousMatch')}
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant={isReplaceOpen ? 'secondary' : 'ghost'}
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setIsReplaceOpen((prev) => !prev)}
          title={isReplaceOpen ? 'Ocultar reemplazar' : 'Buscar y reemplazar'}
          aria-label="Buscar y reemplazar"
        >
          <Replace className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isReplaceOpen && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/20 px-2 py-1.5">
          <div className="relative flex-1">
            <Input
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleReplaceAll()
                }
              }}
              placeholder={t('transcript.replacePlaceholder', { defaultValue: 'Reemplazar por...' })}
              className="h-7 text-xs"
            />
            {replaceValue.length > 0 && (
              <button
                type="button"
                onClick={() => setReplaceValue('')}
                className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => void handleReplaceOne()}
            disabled={matchSpans.length === 0}
            title="Reemplazar coincidencia actual"
          >
            {t('transcript.replace', { defaultValue: 'Reemplazar' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 text-xs px-2"
            onClick={() => void handleReplaceAll()}
            disabled={!query.trim()}
            title="Reemplazar todas las coincidencias"
          >
            {t('transcript.replaceAll', { defaultValue: 'Reemplazar todo' })}
          </Button>
        </div>
      )}

      {/* Transcript body */}
      <div
        ref={scrollRef}
        onPointerMove={handlePointerMove}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2"
      >
        {transcriptableItems.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Captions className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              {scope === 'project'
                ? t('transcript.emptyProject', {
                    defaultValue: 'No video or audio clips in this project yet.',
                  })
                : t('transcript.emptySelection')}
            </p>
          </div>
        ) : needsTranscription.length > 0 && tokens.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Captions className="h-8 w-8 text-muted-foreground/60" />
            <div className="max-w-[34ch] space-y-1">
              <p className="text-sm text-muted-foreground">
                {transcriptionError
                  ? t('transcript.transcriptionFailed')
                  : t('transcript.noTranscript')}
              </p>
              {transcriptionError && (
                <p className="break-words text-xs leading-5 text-destructive">
                  {transcriptionError}
                </p>
              )}
            </div>
            <Button size="sm" onClick={() => setTranscribeDialogOpen(true)} disabled={isBusy}>
              {isBusy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isBusy
                ? t('transcript.transcribing')
                : transcriptionError
                  ? t('transcript.tryAgain')
                  : t('transcript.generate')}
            </Button>
          </div>
        ) : tokens.length === 0 && isBusy ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('transcript.loading')}
          </div>
        ) : (
          <div className="mx-auto max-w-[62ch] select-none">
            {sourceCoverage && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-border/70 bg-secondary/30 px-2.5 py-2">
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {t('transcript.sourceAnalyzed', {
                      defaultValue: 'Full source analyzed',
                    })}
                  </p>
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    {t('transcript.detectedRange', {
                      defaultValue:
                        'Voice detected from {{start}} to {{end}}. Silent and music-only sections are omitted.',
                      start: formatTimecode(sourceCoverage.start),
                      end: formatTimecode(sourceCoverage.end),
                    })}
                  </p>
                </div>
              </div>
            )}
            {segments.map((segment) => (
              <TranscriptSegmentRow
                key={segment.key}
                segment={segment}
                tokens={tokens}
                activeIndex={
                  activeIndex >= segment.firstIndex && activeIndex <= segment.lastIndex
                    ? activeIndex
                    : -1
                }
                selectedKeys={selectedKeys}
                matchKeys={matchKeys}
                ignoredKeys={ignoredKeys}
                matchesApproximate={matchesApproximate}
                onSeek={seekToToken}
                onPointerDown={handlePointerDown}
                editingTokenKey={editingTokenKey}
                onStartEdit={setEditingTokenKey}
                onSaveEdit={handleSaveWord}
                onCancelEdit={() => setEditingTokenKey(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pending edits bar */}
      {ignoredSpanCount > 0 && (
        <div className="@container flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-border bg-secondary/30 px-2 py-1.5">
          <span className="min-w-0 text-xs font-medium text-foreground">
            {t('transcript.pendingHidden', {
              defaultValue: '{{count}} marked for deletion · {{seconds}}s',
              count: ignoredSpanCount,
              seconds: ignoredSeconds.toFixed(1),
            })}
          </span>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-muted-foreground"
              onClick={handleRestoreAll}
              aria-label={t('transcript.restoreAll', { defaultValue: 'Restore all' })}
              data-tooltip={t('transcript.restoreAll', { defaultValue: 'Restore all' })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden @[340px]:inline">
                {t('transcript.restoreAll', { defaultValue: 'Restore all' })}
              </span>
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5"
              onClick={handleApply}
              aria-label={t('transcript.applyEdits', { defaultValue: 'Delete marked' })}
              data-tooltip={t('transcript.applyEdits', { defaultValue: 'Delete marked' })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden @[340px]:inline">
                {t('transcript.applyEdits', { defaultValue: 'Delete marked' })}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="@container flex flex-wrap items-center justify-between gap-x-2 gap-y-2 border-t border-border p-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          {selectionCount > 0
            ? t('transcript.wordsSelected', { count: selectionCount })
            : t('transcript.ignoreHint', {
                defaultValue: 'Select words, then Backspace to mark them for deletion',
              })}
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-muted-foreground"
            onClick={() => handleCopyWords(false)}
            disabled={selectionCount === 0}
            aria-label={t('transcript.copy', { defaultValue: 'Copy' })}
            data-tooltip={t('transcript.copyHint', {
              defaultValue: 'Copy words (paste onto the timeline with Ctrl+V)',
            })}
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden @[340px]:inline">
              {t('transcript.copy', { defaultValue: 'Copy' })}
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-muted-foreground"
            onClick={() => handleCopyWords(true)}
            disabled={selectionCount === 0}
            aria-label={t('transcript.cut', { defaultValue: 'Cut' })}
            data-tooltip={t('transcript.cut', { defaultValue: 'Cut' })}
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="hidden @[340px]:inline">
              {t('transcript.cut', { defaultValue: 'Cut' })}
            </span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={handleIgnoreToggle}
            disabled={selectionCount === 0}
            aria-label={
              selectionAllIgnored
                ? t('transcript.restoreSelection', { defaultValue: 'Restore' })
                : t('transcript.ignoreSelection', { defaultValue: 'Mark for delete' })
            }
            data-tooltip={
              selectionAllIgnored
                ? t('transcript.restoreSelection', { defaultValue: 'Restore' })
                : t('transcript.ignoreSelection', { defaultValue: 'Mark for delete' })
            }
          >
            {selectionAllIgnored ? (
              <Undo2 className="h-3.5 w-3.5" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden @[340px]:inline">
              {selectionAllIgnored
                ? t('transcript.restoreSelection', { defaultValue: 'Restore' })
                : t('transcript.ignoreSelection', { defaultValue: 'Mark for delete' })}
            </span>
          </Button>
        </div>
      </div>

      <TranscribeDialog
        open={transcribeDialogOpen}
        onOpenChange={setTranscribeDialogOpen}
        fileName={transcriptionFileName}
        hasTranscript={tokens.length > 0 || uniqueMediaIds.some((id) => mediaState[id]?.status === 'ready')}
        isRunning={isBusy}
        progressPercent={null}
        progressLabel={t('transcript.transcribing')}
        onStart={handleTranscribe}
        onCancel={() => {
          for (const mediaId of uniqueMediaIds) cancelMediaTranscriptionJob(mediaId)
        }}
        onDelete={handleClearTranscripts}
      />

      <Dialog open={stylesDialogOpen} onOpenChange={setStylesDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pb-2 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-primary" />
              {t('transcript.styleDialogTitle', { defaultValue: 'Estilo de Subtítulos' })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t('transcript.styleDialogDesc', {
                defaultValue:
                  'Personaliza la tipografía, grosor, color, borde, sombra, recuadro de fondo y animaciones de los subtítulos.',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <CaptionStyleControls
              items={matchingSubtitleSegments.length > 0 ? matchingSubtitleSegments : [syntheticItem]}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              onApplyPatch={handleApplyCaptionStyle}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ScopeToggle({
  scope,
  onChange,
  t,
}: {
  scope: TranscriptScope
  onChange: (scope: TranscriptScope) => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const options: { value: TranscriptScope; label: string }[] = [
    { value: 'selection', label: t('transcript.scopeSelection', { defaultValue: 'Selection' }) },
    { value: 'project', label: t('transcript.scopeProject', { defaultValue: 'Whole project' }) },
  ]
  return (
    <div className="flex w-full gap-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
            scope === option.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
