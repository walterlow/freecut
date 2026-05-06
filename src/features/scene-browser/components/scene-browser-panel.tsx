import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  Check,
  ChevronDown,
  Filter,
  LayoutGrid,
  List,
  Loader2,
  Sparkles,
  Wand2,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/shared/ui/cn'
import { useMediaLibraryStore, mediaAnalysisService } from '../deps/media-library'
import {
  useSceneBrowserStore,
  type SceneBrowserSortMode,
  type SceneBrowserViewMode,
} from '../stores/scene-browser-store'
import { useRankedScenes } from '../hooks/use-ranked-scenes'
import { useSemanticIndex } from '../hooks/use-semantic-index'
import { SceneSearchField, SceneSearchModeButtons } from './scene-search-input'
import { SceneRow } from './scene-row'
import { SceneCard } from './scene-card'

interface SceneBrowserPanelProps {
  className?: string
}

const SORT_OPTIONS: Array<{ value: SceneBrowserSortMode; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'time', label: 'Timestamp' },
  { value: 'name', label: 'Media name' },
]

export function SceneBrowserPanel({ className }: SceneBrowserPanelProps) {
  const query = useSceneBrowserStore((s) => s.query)
  const scope = useSceneBrowserStore((s) => s.scope)
  const setScope = useSceneBrowserStore((s) => s.setScope)
  const sortMode = useSceneBrowserStore((s) => s.sortMode)
  const setSortMode = useSceneBrowserStore((s) => s.setSortMode)
  const viewMode = useSceneBrowserStore((s) => s.viewMode)
  const setViewMode = useSceneBrowserStore((s) => s.setViewMode)

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const mediaWithCaptions = useMemo(
    () => mediaItems.filter((m) => (m.aiCaptions?.length ?? 0) > 0),
    [mediaItems],
  )

  const [analyzeBusy, setAnalyzeBusy] = useState(false)
  const analyzableMedia = useMemo(
    () =>
      mediaItems.filter((m) => m.mimeType.startsWith('video/') || m.mimeType.startsWith('image/')),
    [mediaItems],
  )
  const missingCount = useMemo(
    () => analyzableMedia.filter((m) => (m.aiCaptions?.length ?? 0) === 0).length,
    [analyzableMedia],
  )

  const headerRef = useRef<HTMLDivElement | null>(null)
  const [headerWidth, setHeaderWidth] = useState<number>(Number.POSITIVE_INFINITY)
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const update = () => {
      setHeaderWidth(el.clientWidth)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Two thresholds for compacting — buttons (Color/Keyword/Analyze) carry
  // fixed-width labels and only need to collapse when genuinely cramped,
  // but the scope `<Select>` shows arbitrary-length filenames in a 144px
  // pill, so we collapse it earlier and much earlier when a specific
  // media is picked (any real filename truncates in that width).
  const compact = headerWidth < 360
  const compactScope = headerWidth < 440 || (scope !== null && headerWidth < 560)

  const runAnalyze = useCallback(
    async (kind: 'missing' | 'all' | 'scope', mediaId?: string) => {
      if (analyzeBusy) return
      setAnalyzeBusy(true)
      try {
        if (kind === 'scope' && mediaId) {
          await mediaAnalysisService.analyzeMedia(mediaId)
        } else if (kind === 'missing') {
          await mediaAnalysisService.analyzeBatch({ onlyMissing: true })
        } else {
          await mediaAnalysisService.analyzeBatch({ onlyMissing: false })
        }
      } finally {
        setAnalyzeBusy(false)
      }
    },
    [analyzeBusy],
  )

  const { scenes, totalScenes, clipsWithCaptions, reanalyzingMedia, isQuerying } = useRankedScenes()
  const indexProgress = useSemanticIndex()

  const scopedMedia = useMemo(
    () => (scope ? (mediaWithCaptions.find((m) => m.id === scope) ?? null) : null),
    [scope, mediaWithCaptions],
  )

  const handleScopeChange = useCallback(
    (value: string) => {
      setScope(value === 'all' ? null : value)
    },
    [setScope],
  )

  const showMediaName = scope === null
  const hasAnyCaptions = totalScenes > 0
  const hasResults = scenes.length > 0
  const isFiltered = query.trim().length > 0

  const scopeLabel = scopedMedia
    ? `${clipsWithCaptions} clip · ${totalScenes} ${totalScenes === 1 ? 'scene' : 'scenes'}`
    : `${clipsWithCaptions} ${clipsWithCaptions === 1 ? 'clip' : 'clips'} · ${totalScenes} ${totalScenes === 1 ? 'scene' : 'scenes'}`

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div ref={headerRef} className="flex flex-col gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <SceneSearchModeButtons compact={compact} />
          <AnalyzeMenu
            busy={analyzeBusy}
            totalAnalyzable={analyzableMedia.length}
            missingCount={missingCount}
            scopedMedia={scopedMedia}
            onRun={runAnalyze}
            compact={compact}
          />
          <div className="flex-1" />
          {compactScope ? (
            <CompactScopePicker
              scope={scope}
              scopedMedia={scopedMedia}
              mediaWithCaptions={mediaWithCaptions}
              onChange={handleScopeChange}
            />
          ) : (
            <Select value={scope ?? 'all'} onValueChange={handleScopeChange}>
              <SelectTrigger className="h-6 w-36 text-[11px]">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All media</SelectItem>
                {mediaWithCaptions.map((media) => (
                  <SelectItem key={media.id} value={media.id}>
                    {media.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center">
          <SceneSearchField />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-purple-400" />
          {isFiltered
            ? `${scenes.length} ${scenes.length === 1 ? 'match' : 'matches'} · ${scopeLabel}`
            : scopeLabel}
        </span>
        <div className="flex items-center gap-1.5">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <span className="text-muted-foreground/80">Sort</span>
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SceneBrowserSortMode)}>
            <SelectTrigger className="h-6 w-28 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The `[&>...]` override forces Radix's inner viewport wrapper to
          block layout. Radix defaults it to `display: table; min-width: 100%`
          which lets the wrapper grow past the viewport width if any row has
          a long intrinsic min-width — that overflow slides row content
          underneath the vertical scrollbar. Block layout keeps the wrapper
          clamped to viewport width so the scrollbar sits in its own column. */}
      <ScrollArea className="flex-1 min-h-0 mr-2 [&>[data-radix-scroll-area-viewport]>div]:!block">
        <div className={cn('pl-2 pr-3 py-2', viewMode === 'list' && 'space-y-0.5')}>
          {reanalyzingMedia.length > 0 && <ReanalyzingBanner items={reanalyzingMedia} />}
          {(indexProgress.indexTotal > 0 || indexProgress.loadingModel) && (
            <SemanticIndexBanner progress={indexProgress} />
          )}
          {hasResults ? (
            viewMode === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
                {scenes.map((scene, index) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    showMediaName={showMediaName}
                    showSignals={isQuerying}
                    isTop={isQuerying && index === 0}
                  />
                ))}
              </div>
            ) : (
              scenes.map((scene, index) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  showMediaName={showMediaName}
                  showSignals={isQuerying}
                  isTop={isQuerying && index === 0}
                />
              ))
            )
          ) : reanalyzingMedia.length === 0 ? (
            <EmptyState hasAnyCaptions={hasAnyCaptions} isFiltered={isFiltered} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}

function SemanticIndexBanner({
  progress,
}: {
  progress: { indexing: number; indexTotal: number; loadingModel: boolean }
}) {
  const label = progress.loadingModel
    ? 'Downloading semantic model (~22 MB, first run only)…'
    : `Indexing captions for semantic search — ${progress.indexing}/${progress.indexTotal} clips`
  return (
    <div className="flex items-center gap-2 rounded-md border border-purple-400/20 bg-purple-400/5 px-3 py-2 text-[11px] text-purple-300/90">
      <BrainCircuit className="h-3 w-3 shrink-0 animate-pulse" />
      <span className="truncate">{label}</span>
    </div>
  )
}

function ReanalyzingBanner({ items }: { items: Array<{ id: string; fileName: string }> }) {
  const label = items.length === 1 ? items[0]!.fileName : `${items.length} clips`
  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-primary/90">
      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      <span className="truncate">
        Re-analyzing <span className="font-medium">{label}</span> — scenes will refresh when done.
      </span>
    </div>
  )
}

/**
 * Compact replacement for the scope `<Select>` used when the browser header
 * is too narrow to fit the full pill. Renders a small filter-icon button
 * (with a dot when a specific clip is scoped) that opens a dropdown listing
 * "All media" + every captioned clip.
 */
function CompactScopePicker({
  scope,
  scopedMedia,
  mediaWithCaptions,
  onChange,
}: {
  scope: string | null
  scopedMedia: { id: string; fileName: string } | null
  mediaWithCaptions: ReadonlyArray<{ id: string; fileName: string }>
  onChange: (value: string) => void
}) {
  const title = scopedMedia ? `Scope: ${scopedMedia.fileName}` : 'Scope: All media'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
            scope
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'border-border bg-secondary text-muted-foreground hover:text-foreground',
          )}
          title={title}
          aria-label={title}
        >
          <Filter className="h-3 w-3" />
          <ChevronDown className="h-3 w-3 opacity-70" />
          {scope && (
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onClick={() => onChange('all')}>
          All media
          {scope === null && <Check className="ml-auto h-3 w-3" />}
        </DropdownMenuItem>
        {mediaWithCaptions.length > 0 && <DropdownMenuSeparator />}
        {mediaWithCaptions.map((media) => (
          <DropdownMenuItem key={media.id} onClick={() => onChange(media.id)}>
            <span className="truncate">{media.fileName}</span>
            {scope === media.id && <Check className="ml-auto h-3 w-3 shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AnalyzeMenu({
  busy,
  totalAnalyzable,
  missingCount,
  scopedMedia,
  onRun,
  compact,
}: {
  busy: boolean
  totalAnalyzable: number
  missingCount: number
  scopedMedia: { id: string; fileName: string } | null
  onRun: (kind: 'missing' | 'all' | 'scope', mediaId?: string) => void
  compact?: boolean
}) {
  const disabled = totalAnalyzable === 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className={cn(
            'flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors',
            'border-border bg-secondary text-muted-foreground hover:text-foreground',
            (disabled || busy) && 'cursor-not-allowed opacity-60',
          )}
          title="Analyze media with AI"
          aria-label="Analyze media with AI"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          {!compact && 'Analyze'}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {scopedMedia && (
          <>
            <DropdownMenuItem onClick={() => onRun('scope', scopedMedia.id)}>
              <Sparkles className="mr-2 h-3 w-3" />
              <span className="truncate">Analyze "{scopedMedia.fileName}"</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => onRun('missing')} disabled={missingCount === 0}>
          <Sparkles className="mr-2 h-3 w-3" />
          Analyze new media
          <span className="ml-auto text-[10px] text-muted-foreground">
            {missingCount} {missingCount === 1 ? 'clip' : 'clips'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRun('all')} disabled={totalAnalyzable === 0}>
          <Wand2 className="mr-2 h-3 w-3" />
          Re-analyze all
          <span className="ml-auto text-[10px] text-muted-foreground">
            {totalAnalyzable} {totalAnalyzable === 1 ? 'clip' : 'clips'}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: SceneBrowserViewMode
  onChange: (mode: SceneBrowserViewMode) => void
}) {
  return (
    <div className="flex items-center rounded-md border border-border bg-secondary p-0.5">
      <button
        type="button"
        onClick={() => onChange('list')}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-[3px] transition-colors',
          value === 'list'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground',
        )}
        title="List view"
        aria-label="List view"
        aria-pressed={value === 'list'}
      >
        <List className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-[3px] transition-colors',
          value === 'grid'
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:text-foreground',
        )}
        title="Grid view"
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
      >
        <LayoutGrid className="h-3 w-3" />
      </button>
    </div>
  )
}

function EmptyState({
  hasAnyCaptions,
  isFiltered,
}: {
  hasAnyCaptions: boolean
  isFiltered: boolean
}) {
  if (!hasAnyCaptions) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted-foreground">
        <Sparkles className="h-6 w-6 text-purple-400/60" />
        <p className="text-[12px]">No AI captions yet.</p>
        <p className="max-w-xs text-[11px] text-muted-foreground/80">
          Run <span className="font-medium">Analyze with AI</span> on a clip from the media library
          to generate searchable scene captions.
        </p>
      </div>
    )
  }
  if (isFiltered) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-10 text-center text-muted-foreground">
        <p className="text-[12px]">No scenes match your search.</p>
        <p className="text-[11px] text-muted-foreground/80">
          Try a shorter query or switch scope to <span className="font-medium">All media</span>.
        </p>
      </div>
    )
  }
  return null
}
