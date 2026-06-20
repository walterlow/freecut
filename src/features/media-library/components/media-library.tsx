import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  memo,
  useCallback,
  lazy,
  Suspense,
} from 'react'
import {
  Search,
  Filter,
  SortAsc,
  Video,
  FileAudio,
  Image as ImageIcon,
  Trash2,
  Grid3x3,
  List,
  AlertTriangle,
  Info,
  X,
  FolderOpen,
  Link,
  Link2Off,
  ChevronDown,
  ChevronRight,
  Film,
  ArrowLeft,
  Zap,
  Loader2,
  Copy,
  Check,
  Upload,
  Sparkles,
  FileText,
  ScanSearch,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { importSceneBrowserPanel, useSceneBrowserStore } from '../deps/scene-browser'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('MediaLibrary')
const LazySceneBrowserPanel = lazy(() =>
  importSceneBrowserPanel().then((module) => ({ default: module.SceneBrowserPanel })),
)
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { MarqueeOverlay } from '@/shared/marquee/marquee-overlay'
import { cn } from '@/shared/ui/cn'
import { GridMediaGrid, ListMediaGrid } from './media-grid'
import { CompositionsSection } from './compositions-section'
import { BackgroundTaskProgress } from './background-task-progress'
import { MissingMediaDialog } from './missing-media-dialog'
import { OrphanedClipsDialog } from './orphaned-clips-dialog'
import { UnsupportedAudioCodecDialog } from './unsupported-audio-codec-dialog'
import { useFilteredMediaItems, useMediaLibraryStore } from '../stores/media-library-store'
import {
  useCompositionsStore,
  useCompositionNavigationStore,
} from '@/features/media-library/deps/timeline-stores'
import { useProjectStore } from '@/features/media-library/deps/projects'
import { proxyService } from '../services/proxy-service'
import { importMediaLibraryService } from '../services/media-library-service-loader'
import { cancelMediaTranscriptionJob } from '../services/media-transcription-runner'
import { importMediaAnalysisService } from '../services/media-analysis-service-loader'
import { getSupportedMediaFormatLabels } from '../utils/media-file-picker'
import { getSharedProxyKey } from '../utils/proxy-key'
import { getMediaType } from '../utils/validation'
import { getProjectBrokenMediaIds } from '@/features/media-library/utils/broken-media'
import type { MediaMetadata } from '@/types/storage'
import { isMarqueeJustFinished } from '@/shared/marquee/use-marquee-selection'
import { useMediaLibraryMarquee } from './use-media-library-marquee'
import { useMediaLibraryDragDrop } from './use-media-library-drag-drop'
import { useMediaTaskProgress } from './use-media-task-progress'
import { useMediaLibraryDeletion } from './use-media-library-deletion'

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors"
      title={t('media.library.copyToClipboard')}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </button>
  )
}

function HeaderActionTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

const GROUP_ICONS = {
  video: Video,
  audio: FileAudio,
  image: ImageIcon,
  gif: Film,
} as const

interface MediaTypeGroupProps {
  groupKey: string
  label: string
  icon: keyof typeof GROUP_ICONS
  items: MediaMetadata[]
  isOpen: boolean
  onToggle: (key: string, open: boolean) => void
  onMediaSelect?: (mediaId: string) => void
  itemSize: number
}

interface MediaTypeGroupBaseProps extends MediaTypeGroupProps {
  Grid: typeof GridMediaGrid | typeof ListMediaGrid
}

const GridMediaTypeGroup = memo(function GridMediaTypeGroup(props: MediaTypeGroupProps) {
  return <MediaTypeGroupBase {...props} Grid={GridMediaGrid} />
})

const ListMediaTypeGroup = memo(function ListMediaTypeGroup(props: MediaTypeGroupProps) {
  return <MediaTypeGroupBase {...props} Grid={ListMediaGrid} />
})

const MediaTypeGroupBase = memo(function MediaTypeGroupBase({
  groupKey,
  label,
  icon,
  items,
  isOpen,
  onToggle,
  onMediaSelect,
  itemSize,
  Grid,
}: MediaTypeGroupBaseProps) {
  const Icon = GROUP_ICONS[icon]
  return (
    <Collapsible open={isOpen} onOpenChange={(open) => onToggle(groupKey, open)}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
        <ChevronRight
          className={cn(
            'w-3 h-3 text-muted-foreground transition-transform',
            isOpen && 'rotate-90',
          )}
        />
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{items.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">
        <Grid items={items} onMediaSelect={onMediaSelect} itemSize={itemSize} />
      </CollapsibleContent>
    </Collapsible>
  )
})

interface MediaLibraryProps {
  onMediaSelect?: (mediaId: string) => void
}

const MEDIA_HEADER_MAX_COMPACT_LEVEL = 4
const MEDIA_HEADER_OVERFLOW_TOLERANCE_PX = 1
const MEDIA_HEADER_RELAX_WIDTH_DELTA_PX = 8

export const MediaLibrary = memo(function MediaLibrary({ onMediaSelect }: MediaLibraryProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const headerToolbarRef = useRef<HTMLDivElement>(null)
  const headerToolbarWidthRef = useRef(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [headerCompactLevel, setHeaderCompactLevel] = useState(0)
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(['video', 'audio', 'image', 'gif']),
  )
  const [showImportUrlDialog, setShowImportUrlDialog] = useState(false)
  const [importUrlValue, setImportUrlValue] = useState('')
  const [isImportUrlSubmitting, setIsImportUrlSubmitting] = useState(false)
  // Store selectors
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId)
  const setCurrentProject = useMediaLibraryStore((s) => s.setCurrentProject)
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems)
  const importMedia = useMediaLibraryStore((s) => s.importMedia)
  const importMediaFromUrl = useMediaLibraryStore((s) => s.importMediaFromUrl)
  const importHandles = useMediaLibraryStore((s) => s.importHandles)
  const deleteMediaBatch = useMediaLibraryStore((s) => s.deleteMediaBatch)
  const showNotification = useMediaLibraryStore((s) => s.showNotification)
  const searchQuery = useMediaLibraryStore((s) => s.searchQuery)
  const setSearchQuery = useMediaLibraryStore((s) => s.setSearchQuery)
  const filterByType = useMediaLibraryStore((s) => s.filterByType)
  const setFilterByType = useMediaLibraryStore((s) => s.setFilterByType)
  const sortBy = useMediaLibraryStore((s) => s.sortBy)
  const setSortBy = useMediaLibraryStore((s) => s.setSortBy)
  const viewMode = useMediaLibraryStore((s) => s.viewMode)
  const setViewMode = useMediaLibraryStore((s) => s.setViewMode)
  const sceneBrowserOpen = useSceneBrowserStore((s) => s.open)
  const openSceneBrowser = useSceneBrowserStore((s) => s.openBrowser)
  const closeSceneBrowser = useSceneBrowserStore((s) => s.closeBrowser)
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize)
  const setMediaItemSize = useMediaLibraryStore((s) => s.setMediaItemSize)
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds)
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds)
  const setSelection = useMediaLibraryStore((s) => s.setSelection)
  const mediaById = useMediaLibraryStore((s) => s.mediaById)
  const clearSelection = useMediaLibraryStore((s) => s.clearSelection)
  const error = useMediaLibraryStore((s) => s.error)
  const errorLink = useMediaLibraryStore((s) => s.errorLink)
  const clearError = useMediaLibraryStore((s) => s.clearError)
  const notification = useMediaLibraryStore((s) => s.notification)
  const clearNotification = useMediaLibraryStore((s) => s.clearNotification)
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds)
  const isScanningMediaHealth = useMediaLibraryStore((s) => s.isScanningMediaHealth)
  const openMissingMediaDialog = useMediaLibraryStore((s) => s.openMissingMediaDialog)
  const projectStoreProjectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus)
  const filteredMediaItems = useFilteredMediaItems()
  const mediaGroups = useMemo(() => {
    const groups: {
      key: string
      label: string
      icon: 'video' | 'audio' | 'image' | 'gif'
      items: MediaMetadata[]
    }[] = []
    const videos: MediaMetadata[] = []
    const audio: MediaMetadata[] = []
    const gifs: MediaMetadata[] = []
    const images: MediaMetadata[] = []
    for (const item of filteredMediaItems) {
      if (item.mimeType === 'image/gif') {
        gifs.push(item)
      } else {
        const t = getMediaType(item.mimeType)
        if (t === 'video') videos.push(item)
        else if (t === 'audio') audio.push(item)
        else images.push(item)
      }
    }
    if (videos.length > 0)
      groups.push({
        key: 'video',
        label: t('media.library.groupVideos'),
        icon: 'video',
        items: videos,
      })
    if (audio.length > 0)
      groups.push({
        key: 'audio',
        label: t('media.library.groupAudio'),
        icon: 'audio',
        items: audio,
      })
    if (images.length > 0)
      groups.push({
        key: 'image',
        label: t('media.library.groupImages'),
        icon: 'image',
        items: images,
      })
    if (gifs.length > 0)
      groups.push({ key: 'gif', label: t('media.library.groupGifs'), icon: 'gif', items: gifs })
    return groups
  }, [filteredMediaItems, t])
  const compositions = useCompositionsStore((s) => s.compositions)
  const MediaTypeGroupView = viewMode === 'grid' ? GridMediaTypeGroup : ListMediaTypeGroup
  const EmptyMediaGrid = viewMode === 'grid' ? GridMediaGrid : ListMediaGrid

  // Composition navigation — show banner when inside a sub-comp
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId)
  const breadcrumbs = useCompositionNavigationStore((s) => s.breadcrumbs)
  const exitComposition = useCompositionNavigationStore((s) => s.exitComposition)
  const activeCompLabel = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1]?.label : null

  // Unsupported codec dialog state
  const unsupportedCodecFiles = useMediaLibraryStore((s) => s.unsupportedCodecFiles)
  const showUnsupportedCodecDialog = useMediaLibraryStore((s) => s.showUnsupportedCodecDialog)
  const resolveUnsupportedCodecDialog = useMediaLibraryStore((s) => s.resolveUnsupportedCodecDialog)

  // HMR recovery: if media store lost project context, rehydrate it from project store.
  useEffect(() => {
    if (!currentProjectId && projectStoreProjectId) {
      setCurrentProject(projectStoreProjectId)
      void loadMediaItems().catch((error) => {
        logger.error('Failed to load media library during store recovery:', error)
      })
    }
  }, [currentProjectId, loadMediaItems, projectStoreProjectId, setCurrentProject])

  const selectedAssetCount = selectedMediaIds.length + selectedCompositionIds.length
  const { marquee } = useMediaLibraryMarquee({
    compositions,
    filteredMediaItems,
    scrollContainerRef,
    setSelection,
  })

  const {
    showDeleteDialog,
    setShowDeleteDialog,
    pendingDeletion,
    setPendingDeletion,
    deleteAssetCount,
    isMediaOnlyDeletion,
    deleteSummary,
    affectedAssetInstanceCount,
    handleDeleteSelected,
    handleConfirmDelete,
  } = useMediaLibraryDeletion({
    containerRef,
    selectedMediaIds,
    selectedCompositionIds,
    selectedAssetCount,
    currentProjectId,
    clearSelection,
    deleteMediaBatch,
  })

  // Import files by copying them into the workspace-backed media store.
  const handleImport = async () => {
    try {
      await importMedia({ storageMode: 'copy' })
    } catch (error) {
      logger.error('Import failed:', error)
    }
  }

  const handleLinkImport = async () => {
    try {
      await importMedia({ storageMode: 'link' })
    } catch (error) {
      logger.error('Link import failed:', error)
    }
  }

  const handleImportUrl = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (isImportUrlSubmitting) {
        return
      }

      setIsImportUrlSubmitting(true)
      try {
        await importMediaFromUrl(importUrlValue)
        if (!useMediaLibraryStore.getState().error) {
          setShowImportUrlDialog(false)
          setImportUrlValue('')
        }
      } catch (error) {
        logger.error('Import from URL failed:', error)
      } finally {
        setIsImportUrlSubmitting(false)
      }
    },
    [importMediaFromUrl, importUrlValue, isImportUrlSubmitting],
  )

  // Import files from drag-drop handles - memoized to prevent MediaGrid re-renders
  const handleImportHandles = useCallback(
    async (handles: FileSystemFileHandle[]) => {
      try {
        await importHandles(handles)
      } catch (error) {
        logger.error('Import failed:', error)
      }
    },
    [importHandles],
  )

  // Panel-level drag/drop handling so the drop zone covers the full panel height.
  const { isDragging, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
    useMediaLibraryDragDrop({ showNotification, importHandles: handleImportHandles })

  // Count of items currently generating proxies
  const currentProjectBrokenMediaIds = useMemo(
    () => getProjectBrokenMediaIds(brokenMediaIds, mediaById),
    [brokenMediaIds, mediaById],
  )

  const {
    analysisProgress,
    analysisPercent,
    generatingCount,
    generatingAvgProgress,
    proxyItemRows,
    transcribingCount,
    transcribingAvgProgress,
    singleTranscriptionStageLabel,
    transcriptionItemRows,
    preparationItemRows,
    preparingCount,
    preparingAvgProgress,
    hasRunningPreparationTasks,
  } = useMediaTaskProgress()

  const handleGenerateSelectedProxies = async () => {
    const selectedItems = selectedMediaIds
      .map((id) => mediaById[id])
      .filter(
        (m): m is MediaMetadata =>
          m !== undefined &&
          proxyService.canGenerateProxy(m.mimeType) &&
          proxyStatus.get(m.id) !== 'ready' &&
          proxyStatus.get(m.id) !== 'generating',
      )

    selectedItems.forEach((item) => {
      const proxyKey = getSharedProxyKey(item)
      proxyService.setProxyKey(item.id, proxyKey)
      proxyService.generateProxy(
        item.id,
        item.storageType === 'opfs' && item.opfsPath
          ? { kind: 'opfs', path: item.opfsPath, mimeType: item.mimeType }
          : async () => {
              const { mediaLibraryService } = await importMediaLibraryService()
              return mediaLibraryService.getMediaFile(item.id)
            },
        item.width,
        item.height,
        proxyKey,
      )
    })
  }

  const handleCancelAllProxies = () => {
    for (const [mediaId, status] of proxyStatus.entries()) {
      if (status !== 'generating') {
        continue
      }

      const media = mediaById[mediaId]
      proxyService.cancelProxy(mediaId, media ? getSharedProxyKey(media) : undefined)
    }
  }

  const handleCancelAllTranscriptions = () => {
    for (const [mediaId, status] of transcriptStatus.entries()) {
      if (status !== 'queued' && status !== 'transcribing') {
        continue
      }

      cancelMediaTranscriptionJob(mediaId)
    }
  }

  // Count selected items that are eligible for proxy generation
  const selectedProxyEligibleCount = useMemo(() => {
    return selectedMediaIds.filter((id) => {
      const m = mediaById[id]
      return (
        m &&
        proxyService.canGenerateProxy(m.mimeType) &&
        proxyStatus.get(id) !== 'ready' &&
        proxyStatus.get(id) !== 'generating'
      )
    }).length
  }, [selectedMediaIds, mediaById, proxyStatus])

  useLayoutEffect(() => {
    const toolbar = headerToolbarRef.current
    if (!toolbar) return

    let frame: number | undefined
    const measure = () => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame)
      }

      frame = window.requestAnimationFrame(() => {
        frame = undefined
        const nextWidth = toolbar.clientWidth
        const previousWidth = headerToolbarWidthRef.current
        headerToolbarWidthRef.current = nextWidth

        if (previousWidth > 0 && nextWidth > previousWidth + MEDIA_HEADER_RELAX_WIDTH_DELTA_PX) {
          setHeaderCompactLevel(0)
          return
        }

        const overflowing =
          toolbar.scrollWidth - toolbar.clientWidth > MEDIA_HEADER_OVERFLOW_TOLERANCE_PX
        if (!overflowing) return

        setHeaderCompactLevel((level) => Math.min(MEDIA_HEADER_MAX_COMPACT_LEVEL, level + 1))
      })
    }

    const ResizeObserverCtor = typeof ResizeObserver === 'undefined' ? null : ResizeObserver
    const observer = ResizeObserverCtor ? new ResizeObserverCtor(measure) : null
    observer?.observe(toolbar)
    window.addEventListener('resize', measure)
    measure()

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [
    currentProjectBrokenMediaIds.length,
    currentProjectId,
    headerCompactLevel,
    selectedAssetCount,
    selectedProxyEligibleCount,
    t,
  ])

  const handleScrollContentClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isMarqueeJustFinished()) return

      const target = event.target as HTMLElement
      if (!target.closest('[data-media-id], [data-composition-id]')) {
        clearSelection()
      }
    },
    [clearSelection],
  )

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Header toolbar */}
      <div className="@container px-3 py-2 border-b border-border flex-shrink-0">
        <TooltipProvider>
          <div
            ref={headerToolbarRef}
            className="flex flex-nowrap items-center gap-2 text-xs min-w-0 overflow-hidden"
          >
            {/* Import action */}
            <div className="flex shrink-0">
              <HeaderActionTooltip label={t('media.library.importMediaFiles')}>
                <button
                  onClick={handleImport}
                  disabled={!currentProjectId}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-l-md
                    bg-primary text-primary-foreground
                    hover:bg-primary/90
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors duration-150"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span className={headerCompactLevel >= 4 ? 'hidden' : 'hidden @[260px]:inline'}>
                    {t('media.library.import')}
                  </span>
                </button>
              </HeaderActionTooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    disabled={!currentProjectId}
                    className="flex h-7 w-7 items-center justify-center rounded-r-md border-l border-primary-foreground/20
                      bg-primary text-primary-foreground
                      hover:bg-primary/90
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition-colors duration-150"
                    aria-label={t('media.library.importMoreOptions')}
                    title={t('media.library.importMoreOptions')}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onSelect={handleImport}>
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {t('media.library.importCopyToWorkspace')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLinkImport}>
                    <Link className="w-4 h-4 mr-2" />
                    {t('media.library.importLinkOriginal')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <HeaderActionTooltip label={t('media.library.importMediaFromUrl')}>
              <button
                onClick={() => setShowImportUrlDialog(true)}
                disabled={!currentProjectId}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0 border
                  bg-secondary border-border text-muted-foreground
                  hover:text-primary hover:bg-primary/10 hover:border-primary/40
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-150"
              >
                <Link className="w-3.5 h-3.5" />
                <span className={headerCompactLevel >= 2 ? 'hidden' : 'hidden @[360px]:inline'}>
                  {t('media.library.url')}
                </span>
              </button>
            </HeaderActionTooltip>

            {/* Workspace health scan indicator */}
            {isScanningMediaHealth && (
              <HeaderActionTooltip label={t('media.library.checkingWorkspaceHealth')}>
                <div
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0 border
                    bg-secondary border-border text-muted-foreground"
                  aria-live="polite"
                >
                  <ScanSearch className="w-3.5 h-3.5 animate-pulse" />
                  <span className={headerCompactLevel >= 3 ? 'hidden' : 'hidden @[380px]:inline'}>
                    {t('media.library.checkingWorkspaceHealthShort')}
                  </span>
                </div>
              </HeaderActionTooltip>
            )}

            {/* Missing media indicator */}
            {currentProjectBrokenMediaIds.length > 0 && (
              <HeaderActionTooltip
                label={t('media.library.viewMissingMedia', {
                  count: currentProjectBrokenMediaIds.length,
                })}
              >
                <button
                  onClick={openMissingMediaDialog}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0
                    bg-destructive/10 border border-destructive/25 text-destructive
                    hover:bg-destructive/20 hover:border-destructive/40
                    transition-colors duration-150"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  <span className={headerCompactLevel >= 3 ? 'hidden' : 'hidden @[340px]:inline'}>
                    {t('media.library.missingCount', {
                      count: currentProjectBrokenMediaIds.length,
                    })}
                  </span>
                </button>
              </HeaderActionTooltip>
            )}

            {/* Selection indicator & actions */}
            {selectedAssetCount > 0 && (
              <>
                <div className="h-4 w-px bg-border hidden @[300px]:block" />

                {/* Selection badge */}
                <div className="flex shrink-0 items-center gap-1 h-7 pl-2 pr-1 rounded-md bg-accent/50 border border-border min-w-0 max-w-full overflow-hidden">
                  <span
                    className={cn(
                      'tabular-nums shrink-0 whitespace-nowrap',
                      headerCompactLevel >= 4 && 'hidden',
                    )}
                  >
                    {t('media.library.selectedCount', { count: selectedAssetCount })}
                  </span>
                  <span
                    className={cn(
                      'hidden tabular-nums shrink-0 whitespace-nowrap',
                      headerCompactLevel >= 4 && 'inline',
                    )}
                    aria-label={t('media.library.selectedCount', { count: selectedAssetCount })}
                  >
                    {selectedAssetCount}
                  </span>
                  <HeaderActionTooltip label={t('media.library.clearSelection')}>
                    <button
                      onClick={clearSelection}
                      className="ml-0.5 p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </HeaderActionTooltip>
                </div>

                {/* Generate proxies for selection */}
                {selectedProxyEligibleCount > 0 && (
                  <HeaderActionTooltip
                    label={t('media.library.generateProxiesForSelected', {
                      count: selectedProxyEligibleCount,
                    })}
                  >
                    <button
                      onClick={handleGenerateSelectedProxies}
                      className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0 border
                        bg-secondary border-border text-muted-foreground
                        hover:text-primary hover:bg-primary/10 hover:border-primary/40
                        transition-colors duration-150"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span
                        className={headerCompactLevel >= 2 ? 'hidden' : 'hidden @[440px]:inline'}
                      >
                        {t('media.library.proxyCount', { count: selectedProxyEligibleCount })}
                      </span>
                    </button>
                  </HeaderActionTooltip>
                )}

                {/* Delete action */}
                <HeaderActionTooltip label={t('media.library.deleteSelectedAssets')}>
                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0
                      bg-destructive/10 border border-destructive/25 text-destructive
                      hover:bg-destructive/20 hover:border-destructive/40
                      transition-colors duration-150"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className={headerCompactLevel >= 1 ? 'hidden' : 'hidden @[400px]:inline'}>
                      {t('common.delete')}
                    </span>
                  </button>
                </HeaderActionTooltip>
              </>
            )}
          </div>
        </TooltipProvider>
      </div>

      <Dialog
        open={showImportUrlDialog}
        onOpenChange={(open) => {
          setShowImportUrlDialog(open)
          if (!open && !isImportUrlSubmitting) {
            setImportUrlValue('')
          }
        }}
      >
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t('media.library.importFromUrlTitle')}</DialogTitle>
            <DialogDescription>{t('media.library.importFromUrlDescription')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleImportUrl} className="space-y-4">
            <div className="space-y-2">
              <Input
                autoFocus
                type="url"
                inputMode="url"
                placeholder="https://example.com/video.mp4"
                value={importUrlValue}
                onChange={(event) => setImportUrlValue(event.target.value)}
                disabled={isImportUrlSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                {t('media.library.importFromUrlHint')}
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!isImportUrlSubmitting) {
                    setShowImportUrlDialog(false)
                    setImportUrlValue('')
                  }
                }}
                disabled={isImportUrlSubmitting}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={
                  !currentProjectId || importUrlValue.trim().length === 0 || isImportUrlSubmitting
                }
              >
                {isImportUrlSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('media.library.import')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/50 rounded text-xs animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-start justify-between gap-2">
            <div className="text-destructive leading-relaxed flex-1">
              <p>{error}</p>
              {errorLink && (
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground select-text">
                    {errorLink}
                  </code>
                  <CopyButton text={errorLink} />
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {t('media.library.dismiss')}
            </Button>
          </div>
        </div>
      )}

      {/* Notification message */}
      {notification && (
        <div
          className={`mx-4 mt-3 p-2.5 rounded text-xs animate-in slide-in-from-top-2 duration-200 ${
            notification.type === 'info'
              ? 'bg-orange-500/10 border border-orange-500/30'
              : notification.type === 'warning'
                ? 'bg-yellow-500/10 border border-yellow-500/30'
                : notification.type === 'success'
                  ? 'bg-green-500/10 border border-green-500/30'
                  : 'bg-destructive/10 border border-destructive/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Info
                className={`w-3.5 h-3.5 flex-shrink-0 ${
                  notification.type === 'info'
                    ? 'text-orange-500'
                    : notification.type === 'warning'
                      ? 'text-yellow-500'
                      : notification.type === 'success'
                        ? 'text-green-500'
                        : 'text-destructive'
                }`}
              />
              <p
                className={`leading-relaxed line-clamp-2 ${
                  notification.type === 'info'
                    ? 'text-orange-600 dark:text-orange-400'
                    : notification.type === 'warning'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : notification.type === 'success'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-destructive'
                }`}
              >
                {notification.message}
              </p>
            </div>
            <button
              onClick={clearNotification}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Search + view toggle always render so the toggle stays reachable
          in Scene mode. The search input and the filter row below only scope
          the media-library grid, so they're hidden when the Scene browser is
          mounted (it has its own search). */}
      <div className="px-4 pt-3 pb-2 space-y-2 flex-shrink-0">
        {/* Search + Media/Scenes toggle group */}
        <div className="@container flex items-center gap-2">
          {!sceneBrowserOpen && (
            <div className="relative group flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input
                placeholder={t('media.searchMedia')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-7 bg-secondary border border-border focus:border-primary text-foreground placeholder:text-muted-foreground text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          {sceneBrowserOpen && <div className="flex-1 min-w-0" aria-hidden />}
          <div
            role="group"
            aria-label={t('media.library.libraryView')}
            className="inline-flex items-center h-7 rounded-md border border-border bg-secondary p-0.5 shrink-0"
          >
            <HeaderActionTooltip label={t('media.library.showMediaLibrary')}>
              <button
                onClick={() => {
                  if (sceneBrowserOpen) closeSceneBrowser()
                }}
                aria-pressed={!sceneBrowserOpen}
                className={cn(
                  'flex items-center gap-1 h-6 px-1.5 @[280px]:px-2 rounded-[3px] text-[11px] transition-colors duration-150',
                  !sceneBrowserOpen
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Film className="w-3 h-3" />
                <span className="hidden @[280px]:inline">{t('media.library.mediaTab')}</span>
              </button>
            </HeaderActionTooltip>
            <HeaderActionTooltip label={t('media.library.searchScenes')}>
              <button
                onClick={() => {
                  if (!sceneBrowserOpen) openSceneBrowser()
                }}
                aria-pressed={sceneBrowserOpen}
                className={cn(
                  'flex items-center gap-1 h-6 px-1.5 @[280px]:px-2 rounded-[3px] text-[11px] transition-colors duration-150',
                  sceneBrowserOpen
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ScanSearch className="w-3 h-3" />
                <span className="hidden @[280px]:inline">{t('media.library.scenesTab')}</span>
              </button>
            </HeaderActionTooltip>
          </div>
        </div>

        {!sceneBrowserOpen && (
          <>
            {/* Filters and sort */}
            <div className="@container flex items-center gap-1.5 min-w-0">
              {/* Filter by type */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-6 bg-secondary border text-[10px] px-2 flex-shrink-0 ${
                      filterByType
                        ? 'border-primary text-primary hover:bg-primary/10'
                        : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                    }`}
                  >
                    <Filter className="w-2.5 h-2.5" />
                    <span className="hidden @[280px]:inline ml-1">
                      {filterByType
                        ? t(`media.library.typeShort.${filterByType}`)
                        : t('media.library.allShort')}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-popover border border-border">
                  <DropdownMenuItem
                    onClick={() => setFilterByType(null)}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('media.library.allTypes')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => setFilterByType('video')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <Video className="w-3 h-3 mr-2" />
                    {t('media.type.video')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setFilterByType('audio')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <FileAudio className="w-3 h-3 mr-2" />
                    {t('media.type.audio')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setFilterByType('image')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <ImageIcon className="w-3 h-3 mr-2" />
                    {t('media.type.image')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Sort by */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 bg-secondary border border-border text-muted-foreground hover:border-primary/50 hover:text-primary text-[10px] px-2 flex-shrink-0"
                  >
                    <SortAsc className="w-2.5 h-2.5" />
                    <span className="hidden @[280px]:inline ml-1">
                      {t(`media.library.sortShort.${sortBy}`)}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-popover border border-border">
                  <DropdownMenuItem
                    onClick={() => setSortBy('date')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('media.library.sortDate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSortBy('name')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('media.library.sortName')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSortBy('size')}
                    className="text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('media.library.sortSize')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* View mode toggle + item size */}
              <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                {viewMode === 'grid' && (
                  <Slider
                    min={1}
                    max={5}
                    step={1}
                    value={[mediaItemSize]}
                    onValueChange={([v]) => setMediaItemSize(v ?? 3)}
                    className="flex-1 min-w-6 max-w-24"
                    aria-label={t('media.library.gridItemSize')}
                  />
                )}
                <div className="flex items-center border border-border rounded bg-secondary flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={`h-6 w-6 p-0 rounded-none rounded-l ${
                      viewMode === 'grid'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Grid3x3 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={`h-6 w-6 p-0 rounded-none rounded-r ${
                      viewMode === 'list'
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <List className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Composition navigation banner — shown when inside a sub-composition */}
      {activeCompositionId !== null && activeCompLabel && (
        <div className="px-3 py-1.5 border-b border-violet-500/30 bg-violet-500/10 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={exitComposition}
            className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('media.library.back')}</span>
          </button>
          <span className="text-xs text-violet-400/60">/</span>
          <span className="text-xs text-violet-300 font-medium truncate">{activeCompLabel}</span>
        </div>
      )}

      {/* Scrollable content: wrapper provides relative context for the drag overlay */}
      <div className="flex-1 relative min-h-0">
        {sceneBrowserOpen && (
          <Suspense fallback={null}>
            <LazySceneBrowserPanel className="absolute inset-0 bg-background" />
          </Suspense>
        )}
        <div
          ref={scrollContainerRef}
          className={cn(
            'relative h-full overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]',
            sceneBrowserOpen && 'hidden',
          )}
          onClick={handleScrollContentClick}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <MarqueeOverlay marquee={marquee} />

          {/* Compositions section — collapsible, auto-hidden when empty */}
          <CompositionsSection />

          {/* Media sections — grouped by type */}
          {mediaGroups.map((group) => (
            <MediaTypeGroupView
              key={group.key}
              groupKey={group.key}
              label={group.label}
              icon={group.icon}
              items={group.items}
              isOpen={openGroups.has(group.key)}
              onToggle={(key, open) =>
                setOpenGroups((prev) => {
                  const next = new Set(prev)
                  if (open) next.add(key)
                  else next.delete(key)
                  return next
                })
              }
              onMediaSelect={onMediaSelect}
              itemSize={mediaItemSize}
            />
          ))}

          {/* Loading / empty state when no groups to show */}
          {mediaGroups.length === 0 && (
            <EmptyMediaGrid onMediaSelect={onMediaSelect} itemSize={mediaItemSize} />
          )}
        </div>

        {/* Drag overlay — absolute sibling, always covers the visible viewport */}
        {isDragging && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 border-2 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
            <div className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-primary" />
            <div className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-primary" />
            <div className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-primary" />
            <div className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-primary" />
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary/20 border-2 border-primary">
                <Upload className="w-7 h-7 text-primary animate-bounce" />
              </div>
              <p className="text-base font-bold tracking-wide text-primary">
                {t('media.library.dropFilesHere')}
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-2">
                {getSupportedMediaFormatLabels().map((label) => (
                  <span
                    key={label}
                    className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
            </div>
          </div>
        )}
      </div>

      {/* Background AI analysis status */}
      {analysisProgress && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin flex-shrink-0" />}
          label={
            analysisProgress.total > 1
              ? t('media.library.analyzingMultiple', {
                  current: Math.min(analysisProgress.completed + 1, analysisProgress.total),
                  total: analysisProgress.total,
                })
              : t('media.library.analyzingSingle')
          }
          progressAriaLabel={t('media.library.aiAnalysisProgress')}
          progressPercent={analysisPercent}
          meta={
            <>
              <span className="tabular-nums">{Math.round(analysisPercent)}%</span>
              {!analysisProgress.cancelRequested ? (
                <button
                  type="button"
                  onClick={() => {
                    void importMediaAnalysisService().then(({ mediaAnalysisService }) =>
                      mediaAnalysisService.requestCancel(),
                    )
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {analysisProgress.total > 1 ? t('media.library.cancelAll') : t('common.cancel')}
                </button>
              ) : (
                <span className="text-muted-foreground/80">{t('media.library.cancelling')}</span>
              )}
            </>
          }
          trailing={<Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
          fillClassName="bg-purple-500"
        />
      )}

      {/* Unified media readiness progress bar */}
      {preparingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Film className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />}
          label={t('media.library.preparingMediaWithCount', { count: preparingCount })}
          progressAriaLabel={t('media.library.mediaPreparationProgress')}
          progressPercent={preparingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={
            preparationItemRows.length > 1
              ? preparationItemRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      <span className="hidden sm:inline">{row.kind}</span>
                      <span className="tabular-nums">
                        {row.status === 'queued'
                          ? t('media.library.preparationQueued')
                          : `${row.percent}%`}
                      </span>
                    </span>
                  </div>
                ))
              : undefined
          }
          meta={
            <span className="tabular-nums">
              {hasRunningPreparationTasks
                ? `${Math.round(preparingAvgProgress * 100)}%`
                : t('media.library.preparationQueued')}
            </span>
          }
          fillClassName="bg-cyan-500"
        />
      )}

      {/* Transcript generation progress bar */}
      {transcribingCount > 0 && (
        <BackgroundTaskProgress
          icon={<FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
          label={t('media.library.generatingTranscripts', { count: transcribingCount })}
          progressAriaLabel={t('media.library.transcriptGenerationProgress')}
          progressPercent={transcribingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={
            transcriptionItemRows.length > 1
              ? transcriptionItemRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      {row.stage && <span className="hidden sm:inline">{row.stage}</span>}
                      <span className="tabular-nums">{row.percent}%</span>
                    </span>
                  </div>
                ))
              : undefined
          }
          meta={
            <>
              {singleTranscriptionStageLabel && (
                <span className="hidden sm:inline truncate">{singleTranscriptionStageLabel}</span>
              )}
              <span className="tabular-nums">{Math.round(transcribingAvgProgress * 100)}%</span>
              <button
                type="button"
                onClick={handleCancelAllTranscriptions}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-blue-500"
        />
      )}

      {/* Proxy generation progress bar */}
      {generatingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-green-500 animate-spin flex-shrink-0" />}
          label={t('media.library.generatingProxies', { count: generatingCount })}
          progressAriaLabel={t('media.library.proxyGenerationProgress')}
          progressPercent={generatingAvgProgress * 100}
          detailsToggleAriaLabel={t('media.library.perItemProgress')}
          details={
            proxyItemRows.length > 1
              ? proxyItemRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="truncate">{row.name}</span>
                    <span className="tabular-nums flex-shrink-0">{row.percent}%</span>
                  </div>
                ))
              : undefined
          }
          meta={
            <>
              <span className="tabular-nums">{Math.round(generatingAvgProgress * 100)}%</span>
              <button
                type="button"
                onClick={handleCancelAllProxies}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('media.library.cancelAll')}
              </button>
            </>
          }
          fillClassName="bg-green-500"
        />
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open)
          if (!open) {
            setPendingDeletion({ mediaIds: [], compositionIds: [] })
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isMediaOnlyDeletion
                ? pendingDeletion.mediaIds.length > 1
                  ? t('media.deleteDialog.titleMultiple', {
                      count: pendingDeletion.mediaIds.length,
                    })
                  : t('media.deleteDialog.titleSingle')
                : t('media.library.deleteAssetsTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {isMediaOnlyDeletion
                    ? pendingDeletion.mediaIds.length > 1
                      ? t('media.deleteDialog.bodyMultiple', {
                          count: pendingDeletion.mediaIds.length,
                        })
                      : t('media.deleteDialog.bodySingle', {
                          name: mediaById[pendingDeletion.mediaIds[0] ?? '']?.fileName ?? '',
                        })
                    : t('media.library.deleteAssetsBody', {
                        summary:
                          deleteSummary ||
                          t('media.library.selectedAssetsCount', { count: deleteAssetCount }),
                      })}
                </p>
                {affectedAssetInstanceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">
                        {isMediaOnlyDeletion
                          ? t('media.deleteDialog.timelineClipsRemoved')
                          : t('media.library.linkedInstancesTitle')}
                      </p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {isMediaOnlyDeletion
                          ? t('media.deleteDialog.timelineClipsDetail', {
                              count: affectedAssetInstanceCount,
                            })
                          : t('media.library.linkedInstancesDetail', {
                              count: affectedAssetInstanceCount,
                            })}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isMediaOnlyDeletion
                ? affectedAssetInstanceCount > 0
                  ? t('media.deleteDialog.confirmWithClips', {
                      count: affectedAssetInstanceCount,
                    })
                  : t('common.delete')
                : affectedAssetInstanceCount > 0
                  ? t('media.library.deleteWithClips', {
                      summary:
                        deleteSummary ||
                        t('media.library.assetsCount', { count: deleteAssetCount }),
                      count: affectedAssetInstanceCount,
                    })
                  : t('media.library.deleteSummary', {
                      summary:
                        deleteSummary ||
                        t('media.library.assetsCount', { count: deleteAssetCount }),
                    })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Missing Media Dialog */}
      <MissingMediaDialog />

      {/* Orphaned Clips Dialog */}
      <OrphanedClipsDialog />

      {/* Unsupported Audio Codec Dialog */}
      <UnsupportedAudioCodecDialog
        open={showUnsupportedCodecDialog}
        files={unsupportedCodecFiles.map((f) => ({
          fileName: f.fileName,
          audioCodec: f.audioCodec,
        }))}
        onConfirm={() => resolveUnsupportedCodecDialog(true)}
        onCancel={() => resolveUnsupportedCodecDialog(false)}
      />
    </div>
  )
})
