import {
  Fragment,
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '@/i18n'
import {
  Video,
  FileAudio,
  FileJson,
  Image as ImageIcon,
  Trash2,
  Loader2,
  Link2Off,
  RefreshCw,
  Zap,
  FileText,
  Sparkles,
  Wind,
  Maximize2,
  X,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { MediaMetadata } from '@/types/storage'
import { FileAccessError } from '../services/file-access'
import { importMediaLibraryService } from '../services/media-library-service-loader'
import { importMediaAnalysisService } from '../services/media-analysis-service-loader'
import { getMediaType, formatDuration } from '../utils/validation'
import { MediaInfoPopover } from './media-info-popover'
import { getSharedProxyKey } from '../utils/proxy-key'
import { useMediaLibraryStore } from '../stores/media-library-store'
import { useMediaPreparationStore } from '../stores/media-preparation-store'
import { CARD_GRID_BASE, CARD_LIST_BASE, CARD_PERF_STYLE } from './card-styles'
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache'
import { proxyService } from '../services/proxy-service'
import { frameInterpolationService } from '../services/frame-interpolation-service'
import {
  SUPPORTED_INTERPOLATION_FACTORS,
  type InterpolationFactor,
} from '@/infrastructure/interpolation'
import { upscaleService } from '../services/upscale-service'
import { UPSCALE_VARIANTS, type UpscaleVariant } from '@/infrastructure/upscale'
import { mediaTranscriptionService } from '../services/media-transcription-service'
import {
  cancelMediaTranscriptionJob,
  runMediaTranscriptionJob,
} from '../services/media-transcription-runner'
import { subtitleSidecarService } from '../services/subtitle-sidecar-service'
import { useEditorStore } from '@/shared/state/editor'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSourcePlayerStore } from '@/shared/state/source-player'
import {
  getTranscriptionOverallPercent,
  getTranscriptionProgressDetail,
  getTranscriptionProgressLabel,
  isIndeterminateTranscriptionProgress,
} from '@/shared/utils/transcription-progress'
import {
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation'
import { TranscribeDialog, type TranscribeDialogValues } from './transcribe-dialog'
import { useSubtitleScanProgressStore } from '../stores/subtitle-scan-progress-store'
import { audioScrubPreview, getAudioScrubTime } from '../utils/audio-scrub-preview'

interface MediaCardProps {
  media: MediaMetadata
  selected?: boolean
  isBroken?: boolean
  onSelect?: (event: React.MouseEvent) => void
  onDoubleClick?: () => void
  onDelete?: (mediaIds: string[]) => void
  onRelink?: () => void
}

interface MediaCardInternalProps extends MediaCardProps {
  layout: 'grid' | 'list'
}

interface MediaCardActionMenuProps {
  isBroken: boolean
  onRelink?: () => void
  canGenerateProxy: boolean
  hasProxy: boolean
  proxyStatus?: 'generating' | 'ready' | 'error'
  canInterpolate: boolean
  isInterpolating: boolean
  onInterpolate: (factor: InterpolationFactor) => void
  onCancelInterpolation: () => void
  canUpscale: boolean
  isUpscaling: boolean
  onUpscale: (variant: UpscaleVariant) => void
  onCancelUpscale: () => void
  isTranscribable: boolean
  isTranscribing: boolean
  hasTranscript: boolean
  canExtractEmbeddedSubtitles: boolean
  isExtractingEmbeddedSubtitles: boolean
  isTaggable: boolean
  isTagging: boolean
  onGenerateProxy: (event: React.MouseEvent) => void | Promise<void>
  onDeleteProxy: (event: React.MouseEvent) => Promise<void>
  onGenerateTranscript: (event: React.MouseEvent) => void | Promise<void>
  onDeleteTranscript: (event: React.MouseEvent) => Promise<void>
  onExtractEmbeddedSubtitles: (event: React.MouseEvent) => void | Promise<void>
  onAnalyzeWithAI: (event: React.MouseEvent) => void
  onDelete: (event: React.MouseEvent) => void
}

type MediaCardMenuGroupProps = {
  t: ReturnType<typeof useTranslation>['t']
}

type BrokenMediaActionsProps = MediaCardMenuGroupProps & {
  onRelink: () => void
}

type ProxyActionsProps = MediaCardMenuGroupProps & {
  canShowGenerateProxy: boolean
  hasProxy: boolean
  onGenerateProxy: (event: React.MouseEvent) => void | Promise<void>
  onDeleteProxy: (event: React.MouseEvent) => Promise<void>
}

type InterpolationActionsProps = MediaCardMenuGroupProps & {
  isInterpolating: boolean
  onInterpolate: (factor: InterpolationFactor) => void
  onCancelInterpolation: () => void
}

type UpscaleActionsProps = MediaCardMenuGroupProps & {
  isUpscaling: boolean
  onUpscale: (variant: UpscaleVariant) => void
  onCancelUpscale: () => void
}

type TranscriptActionsProps = MediaCardMenuGroupProps & {
  canShowGenerateTranscript: boolean
  canShowDeleteTranscript: boolean
  hasTranscript: boolean
  onGenerateTranscript: (event: React.MouseEvent) => void | Promise<void>
  onDeleteTranscript: (event: React.MouseEvent) => Promise<void>
}

type EmbeddedSubtitleActionsProps = MediaCardMenuGroupProps & {
  isExtractingEmbeddedSubtitles: boolean
  onExtractEmbeddedSubtitles: (event: React.MouseEvent) => void | Promise<void>
}

type AiActionsProps = MediaCardMenuGroupProps & {
  onAnalyzeWithAI: (event: React.MouseEvent) => void
}

type DeleteMediaActionProps = MediaCardMenuGroupProps & {
  onDelete: (event: React.MouseEvent) => void
}

const DEFAULT_CAPTION_SELECTION_DURATION_SEC = 3

function getSkimIndicatorStyle(progress: number): CSSProperties {
  if (progress >= 0.999) {
    return { right: 0 }
  }

  return {
    left: `${progress * 100}%`,
  }
}

function canExtractEmbeddedSubtitlesFromMedia(media: MediaMetadata): boolean {
  const fileName = media.fileName.toLowerCase()
  const isSupportedContainer =
    media.mimeType === 'video/x-matroska' ||
    media.mimeType === 'video/matroska' ||
    media.mimeType === 'video/webm' ||
    fileName.endsWith('.mkv') ||
    fileName.endsWith('.webm')

  return (
    isSupportedContainer &&
    (getMediaType(media.mimeType) === 'video' ||
      fileName.endsWith('.mkv') ||
      fileName.endsWith('.webm'))
  )
}

async function requestSubtitleSourcePermission(media: MediaMetadata): Promise<boolean> {
  if (media.storageType !== 'handle' || !media.fileHandle) {
    return true
  }

  try {
    return (await media.fileHandle.requestPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

async function getSubtitleSourceBlob(media: MediaMetadata): Promise<Blob> {
  if (media.storageType === 'handle' && media.fileHandle) {
    return media.fileHandle.getFile()
  }

  const { mediaLibraryService } = await importMediaLibraryService()
  const blob = await mediaLibraryService.getMediaFile(media.id)
  if (!blob) {
    throw new FileAccessError(`Media file "${media.fileName}" is unavailable.`, 'file_missing')
  }
  return blob
}

// Internal Error messages stay technical; user-facing strings use i18n below.

function markSubtitleSourceUnreadable(
  media: MediaMetadata,
  errorType: 'permission_denied' | 'file_missing',
) {
  const store = useMediaLibraryStore.getState()
  store.markMediaBroken(media.id, {
    mediaId: media.id,
    fileName: media.fileName,
    errorType,
  })
  store.openMissingMediaDialog()
}

function getErrorName(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name?: unknown }).name)
    : null
}

function getSubtitleExtractionErrorMessage(error: unknown, media: MediaMetadata): string {
  if (error instanceof FileAccessError) {
    if (error.type === 'permission_denied') {
      markSubtitleSourceUnreadable(media, 'permission_denied')
      return i18n.t('media.card.subtitlesNeedPermission', { name: media.fileName })
    }
    if (error.type === 'file_missing') {
      markSubtitleSourceUnreadable(media, 'file_missing')
      return i18n.t('media.card.subtitlesFileMissing', { name: media.fileName })
    }
    return i18n.t('media.card.subtitlesCannotRead', { name: media.fileName })
  }

  const errorName = getErrorName(error)
  if (errorName) {
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      markSubtitleSourceUnreadable(media, 'permission_denied')
      return i18n.t('media.card.subtitlesNeedPermission', { name: media.fileName })
    }
    if (errorName === 'NotFoundError') {
      markSubtitleSourceUnreadable(media, 'file_missing')
      return i18n.t('media.card.subtitlesFileMissing', { name: media.fileName })
    }
    if (errorName === 'NotReadableError') {
      return i18n.t('media.card.subtitlesCannotRead', { name: media.fileName })
    }
  }

  return error instanceof Error ? error.message : i18n.t('media.card.subtitlesExtractFailed')
}

function resolveProxyGroupVisibility(props: MediaCardActionMenuProps) {
  const canShowGenerateProxy =
    props.canGenerateProxy && !props.hasProxy && props.proxyStatus !== 'generating'
  return {
    canShowGenerateProxy,
    showProxyGroup: !props.isBroken && (canShowGenerateProxy || props.hasProxy),
  }
}

function resolveTranscriptGroupVisibility(props: MediaCardActionMenuProps) {
  const canShowGenerateTranscript =
    props.isTranscribable && !props.isBroken && !props.isTranscribing
  const canShowDeleteTranscript =
    props.isTranscribable && !props.isBroken && props.hasTranscript && !props.isTranscribing
  return {
    canShowGenerateTranscript,
    canShowDeleteTranscript,
    showTranscriptGroup: canShowGenerateTranscript || canShowDeleteTranscript,
  }
}

/**
 * Which context-menu groups this media item gets. Kept out of the component so the render
 * body stays a flat list of `if (show) push(...)` rather than a thicket of boolean chains.
 */
function resolveMenuVisibility(props: MediaCardActionMenuProps) {
  return {
    ...resolveProxyGroupVisibility(props),
    ...resolveTranscriptGroupVisibility(props),
    showBrokenGroup: props.isBroken && Boolean(props.onRelink),
    showInterpolationGroup: props.canInterpolate && !props.isBroken,
    showUpscaleGroup: props.canUpscale && !props.isBroken,
    showEmbeddedSubtitleGroup: props.canExtractEmbeddedSubtitles && !props.isBroken,
    showAiGroup: props.isTaggable && !props.isBroken && !props.isTagging,
  }
}

function MediaCardActionMenuItems(props: MediaCardActionMenuProps) {
  const {
    onRelink,
    hasProxy,
    isInterpolating,
    onInterpolate,
    onCancelInterpolation,
    isUpscaling,
    onUpscale,
    onCancelUpscale,
    hasTranscript,
    isExtractingEmbeddedSubtitles,
    onGenerateProxy,
    onDeleteProxy,
    onGenerateTranscript,
    onDeleteTranscript,
    onExtractEmbeddedSubtitles,
    onAnalyzeWithAI,
    onDelete,
  } = props
  const { t } = useTranslation()
  const {
    canShowGenerateProxy,
    showProxyGroup,
    canShowGenerateTranscript,
    canShowDeleteTranscript,
    showTranscriptGroup,
    showBrokenGroup,
    showInterpolationGroup,
    showUpscaleGroup,
    showEmbeddedSubtitleGroup,
    showAiGroup,
  } = resolveMenuVisibility(props)

  const groups: ReactNode[] = []

  if (showBrokenGroup && onRelink) {
    groups.push(<BrokenMediaActions key="broken" t={t} onRelink={onRelink} />)
  }

  if (showProxyGroup) {
    groups.push(
      <ProxyActions
        key="proxy"
        t={t}
        canShowGenerateProxy={canShowGenerateProxy}
        hasProxy={hasProxy}
        onGenerateProxy={onGenerateProxy}
        onDeleteProxy={onDeleteProxy}
      />,
    )
  }

  if (showInterpolationGroup) {
    groups.push(
      <InterpolationActions
        key="interpolation"
        t={t}
        isInterpolating={isInterpolating}
        onInterpolate={onInterpolate}
        onCancelInterpolation={onCancelInterpolation}
      />,
    )
  }

  if (showUpscaleGroup) {
    groups.push(
      <UpscaleActions
        key="upscale"
        t={t}
        isUpscaling={isUpscaling}
        onUpscale={onUpscale}
        onCancelUpscale={onCancelUpscale}
      />,
    )
  }

  if (showTranscriptGroup) {
    groups.push(
      <TranscriptActions
        key="transcript"
        t={t}
        canShowGenerateTranscript={canShowGenerateTranscript}
        canShowDeleteTranscript={canShowDeleteTranscript}
        hasTranscript={hasTranscript}
        onGenerateTranscript={onGenerateTranscript}
        onDeleteTranscript={onDeleteTranscript}
      />,
    )
  }

  if (showEmbeddedSubtitleGroup) {
    groups.push(
      <EmbeddedSubtitleActions
        key="embedded-subtitles"
        t={t}
        isExtractingEmbeddedSubtitles={isExtractingEmbeddedSubtitles}
        onExtractEmbeddedSubtitles={onExtractEmbeddedSubtitles}
      />,
    )
  }

  if (showAiGroup) {
    groups.push(<AiActions key="ai" t={t} onAnalyzeWithAI={onAnalyzeWithAI} />)
  }

  groups.push(<DeleteMediaAction key="destructive" t={t} onDelete={onDelete} />)

  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <ContextMenuSeparator />}
          {group}
        </Fragment>
      ))}
    </>
  )
}

function BrokenMediaActions({ t, onRelink }: BrokenMediaActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuFile')}</ContextMenuLabel>
      <ContextMenuItem
        onClick={(event) => {
          event.stopPropagation()
          onRelink()
        }}
        className="text-primary focus:text-primary"
      >
        <RefreshCw className="w-3 h-3 mr-2" />
        {t('media.card.relinkFile')}
      </ContextMenuItem>
    </>
  )
}

/**
 * Frame interpolation renders a NEW library item at `factor`x the frame rate — it is not a
 * proxy and it does not modify this clip. Slowing the result gives true slow motion; playing
 * it at 1x gives high-frame-rate motion.
 */
function InterpolationActions({
  t,
  isInterpolating,
  onInterpolate,
  onCancelInterpolation,
}: InterpolationActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuInterpolation')}</ContextMenuLabel>
      {isInterpolating ? (
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation()
            onCancelInterpolation()
          }}
          className="text-destructive focus:text-destructive"
        >
          <X className="w-3 h-3 mr-2" />
          {t('media.card.cancelInterpolation')}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Wind className="w-3 h-3 mr-2" />
            {t('media.card.interpolateFrames')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {SUPPORTED_INTERPOLATION_FACTORS.map((factor) => (
              <ContextMenuItem
                key={factor}
                onClick={(event) => {
                  event.stopPropagation()
                  onInterpolate(factor)
                }}
              >
                {t('media.card.interpolateFactor', { factor })}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
    </>
  )
}

/**
 * Upscaling renders a NEW library item at twice the width and height — it is not a proxy and it
 * does not modify this clip. The variants share an architecture and a cost; they differ only in
 * the footage they were trained on.
 */
function UpscaleActions({ t, isUpscaling, onUpscale, onCancelUpscale }: UpscaleActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuUpscale')}</ContextMenuLabel>
      {isUpscaling ? (
        <ContextMenuItem
          onClick={(event) => {
            event.stopPropagation()
            onCancelUpscale()
          }}
          className="text-destructive focus:text-destructive"
        >
          <X className="w-3 h-3 mr-2" />
          {t('media.card.cancelUpscale')}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Maximize2 className="w-3 h-3 mr-2" />
            {t('media.card.upscaleVideo')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {UPSCALE_VARIANTS.map((variant) => (
              <ContextMenuItem
                key={variant}
                onClick={(event) => {
                  event.stopPropagation()
                  onUpscale(variant)
                }}
              >
                {t(`media.card.upscaleVariant.${variant}`)}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
    </>
  )
}

function ProxyActions({
  t,
  canShowGenerateProxy,
  hasProxy,
  onGenerateProxy,
  onDeleteProxy,
}: ProxyActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuProxy')}</ContextMenuLabel>
      {canShowGenerateProxy && (
        <ContextMenuItem onClick={onGenerateProxy}>
          <Zap className="w-3 h-3 mr-2" />
          {t('media.card.generateProxy')}
        </ContextMenuItem>
      )}
      {hasProxy && (
        <ContextMenuItem
          onClick={onDeleteProxy}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-3 h-3 mr-2" />
          {t('media.card.deleteProxy')}
        </ContextMenuItem>
      )}
    </>
  )
}

function TranscriptActions({
  t,
  canShowGenerateTranscript,
  canShowDeleteTranscript,
  hasTranscript,
  onGenerateTranscript,
  onDeleteTranscript,
}: TranscriptActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuTranscript')}</ContextMenuLabel>
      {canShowGenerateTranscript && (
        <ContextMenuItem onClick={onGenerateTranscript}>
          <FileText className="w-3 h-3 mr-2" />
          {hasTranscript ? t('media.card.refreshTranscript') : t('media.card.generateTranscript')}
        </ContextMenuItem>
      )}
      {canShowDeleteTranscript && (
        <ContextMenuItem
          onClick={onDeleteTranscript}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="w-3 h-3 mr-2" />
          {t('media.card.deleteTranscript')}
        </ContextMenuItem>
      )}
    </>
  )
}

function EmbeddedSubtitleActions({
  t,
  isExtractingEmbeddedSubtitles,
  onExtractEmbeddedSubtitles,
}: EmbeddedSubtitleActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuCaptions')}</ContextMenuLabel>
      <ContextMenuItem
        onClick={onExtractEmbeddedSubtitles}
        disabled={isExtractingEmbeddedSubtitles}
      >
        {isExtractingEmbeddedSubtitles ? (
          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
        ) : (
          <FileText className="w-3 h-3 mr-2" />
        )}
        {t('media.card.extractEmbeddedSubtitles')}
      </ContextMenuItem>
    </>
  )
}

function AiActions({ t, onAnalyzeWithAI }: AiActionsProps) {
  return (
    <>
      <ContextMenuLabel>{t('media.card.menuAi')}</ContextMenuLabel>
      <ContextMenuItem onClick={onAnalyzeWithAI}>
        <Sparkles className="w-3 h-3 mr-2" />
        {t('media.card.analyzeWithAI')}
      </ContextMenuItem>
    </>
  )
}

function DeleteMediaAction({ t, onDelete }: DeleteMediaActionProps) {
  return (
    <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
      <Trash2 className="w-3 h-3 mr-2" />
      {t('common.delete')}
    </ContextMenuItem>
  )
}

export const GridMediaCard = memo(function GridMediaCard(props: MediaCardProps) {
  return <MediaCardInternal {...props} layout="grid" />
})

export const ListMediaCard = memo(function ListMediaCard(props: MediaCardProps) {
  return <MediaCardInternal {...props} layout="list" />
})

const MediaCardInternal = memo(function MediaCardInternal({
  media,
  selected = false,
  isBroken = false,
  onSelect,
  onDoubleClick,
  onDelete,
  onRelink,
  layout,
}: MediaCardInternalProps) {
  const { t } = useTranslation()
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [skimProgress, setSkimProgress] = useState<number | null>(null)
  const isImporting = useMediaLibraryStore(
    useCallback((s) => s.importingIds.includes(media.id), [media.id]),
  )
  const hasActivePreparationTasks = useMediaPreparationStore(
    useCallback(
      (s) => {
        for (const task of s.tasks.values()) {
          if (task.mediaId === media.id && task.type !== 'import' && task.status !== 'error') {
            return true
          }
        }
        return false
      },
      [media.id],
    ),
  )
  const isPreparingMedia = isImporting || hasActivePreparationTasks
  const preparingLabel = t('media.card.preparing')

  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(media.id))
  const isInterpolating = useMediaLibraryStore(
    (s) => s.interpolationStatus.get(media.id) === 'generating',
  )
  const isUpscaling = useMediaLibraryStore((s) => s.upscaleStatus.get(media.id) === 'generating')
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus.get(media.id) ?? 'idle')
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress.get(media.id))

  const mediaType = getMediaType(media.mimeType)
  const isTranscribable = mediaType === 'video' || mediaType === 'audio'
  const canGenerateProxy =
    mediaType === 'video' &&
    !isBroken &&
    !isPreparingMedia &&
    proxyService.canGenerateProxy(media.mimeType)
  const hasProxy = proxyStatus === 'ready'
  const canInterpolate =
    mediaType === 'video' &&
    !isBroken &&
    !isPreparingMedia &&
    frameInterpolationService.canInterpolate(media.mimeType)
  // Hidden rather than disabled when the 2x output would be too large for any encoder to take:
  // there is nothing the user could do about it from this menu.
  const canUpscaleMedia =
    mediaType === 'video' &&
    !isBroken &&
    !isPreparingMedia &&
    upscaleService.canUpscaleMedia(media.mimeType, media.width, media.height)
  const hasTranscript = transcriptStatus === 'ready'
  const isTranscribing = transcriptStatus === 'transcribing' || transcriptStatus === 'queued'
  const isTagging = useMediaLibraryStore((s) => s.taggingMediaIds.has(media.id))
  const isTaggable = mediaType === 'video' || mediaType === 'image'
  const hasCaptions = (media.aiCaptions?.length ?? 0) > 0
  const thumbnailRef = useRef<HTMLImageElement>(null)
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  const setMediaSkimPreview = useEditorStore((s) => s.setMediaSkimPreview)
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview)
  const isTranscriptionDialogOpen = useEditorStore((s) => s.transcriptionDialogDepth > 0)
  const pauseTimelinePlayback = usePlaybackStore((s) => s.pause)

  const isAudio = mediaType === 'audio' && !isBroken && !isPreparingMedia
  const [transcribeDialogOpen, setTranscribeDialogOpen] = useState(false)
  const [transcribeErrorMessage, setTranscribeErrorMessage] = useState<string | null>(null)
  const [isExtractingEmbeddedSubtitles, setIsExtractingEmbeddedSubtitles] = useState(false)

  // Load thumbnail on mount and when thumbnailId changes (e.g. after regeneration)
  useEffect(() => {
    let mounted = true

    const loadThumbnail = async () => {
      const { mediaLibraryService } = await importMediaLibraryService()
      const url = await mediaLibraryService.getThumbnailBlobUrl(media.id, media.thumbnailId)
      if (mounted) {
        setThumbnailUrl(url)
      }
    }

    loadThumbnail()

    return () => {
      mounted = false
    }
  }, [media.id, media.thumbnailId])

  const getTargetMediaItems = useCallback((): MediaMetadata[] => {
    const store = useMediaLibraryStore.getState()
    const selectedIds = store.selectedMediaIds
    if (selectedIds.length > 1 && selectedIds.includes(media.id)) {
      return selectedIds
        .map((id) => store.mediaById[id])
        .filter((m): m is MediaMetadata => m !== undefined)
    }
    return [media]
  }, [media])

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return
      const store = useMediaLibraryStore.getState()
      if (!store.selectedMediaIds.includes(media.id)) {
        store.setSelection({ mediaIds: [media.id], compositionIds: [] })
      }
    },
    [media.id],
  )

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    const targets = getTargetMediaItems()
    onDelete?.(targets.map((m) => m.id))
  }

  const handleGenerateProxy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useMediaLibraryStore.getState()
    const targets = getTargetMediaItems().filter(
      (m) =>
        proxyService.canGenerateProxy(m.mimeType) &&
        store.proxyStatus.get(m.id) !== 'ready' &&
        store.proxyStatus.get(m.id) !== 'generating',
    )
    for (const item of targets) {
      try {
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
      } catch {
        useMediaLibraryStore.getState().setProxyStatus(item.id, 'error')
      }
    }
  }

  const handleInterpolate = useCallback(
    (factor: InterpolationFactor) => {
      const store = useMediaLibraryStore.getState()
      const projectId = store.currentProjectId
      if (!projectId) return

      const targets = getTargetMediaItems().filter(
        (m) =>
          frameInterpolationService.canInterpolate(m.mimeType) &&
          !frameInterpolationService.isGenerating(m.id),
      )
      for (const item of targets) {
        frameInterpolationService.generate({
          mediaId: item.id,
          projectId,
          fileName: item.fileName,
          factor,
          source:
            item.storageType === 'opfs' && item.opfsPath
              ? { kind: 'opfs', path: item.opfsPath, mimeType: item.mimeType }
              : async () => {
                  const { mediaLibraryService } = await importMediaLibraryService()
                  return mediaLibraryService.getMediaFile(item.id)
                },
          // Only a hint for the progress bar; the worker measures the true rate itself, and takes
          // the frame size from the decoder rather than from this item's metadata.
          sourceFps: item.fps || 30,
        })
      }
    },
    [getTargetMediaItems],
  )

  const handleCancelInterpolation = useCallback(() => {
    for (const item of getTargetMediaItems()) {
      frameInterpolationService.cancel(item.id)
    }
  }, [getTargetMediaItems])

  const handleUpscale = useCallback(
    (variant: UpscaleVariant) => {
      const store = useMediaLibraryStore.getState()
      const projectId = store.currentProjectId
      if (!projectId) return

      const targets = getTargetMediaItems().filter(
        (m) =>
          upscaleService.canUpscaleMedia(m.mimeType, m.width, m.height) &&
          !upscaleService.isGenerating(m.id),
      )
      for (const item of targets) {
        upscaleService.generate({
          mediaId: item.id,
          projectId,
          fileName: item.fileName,
          variant,
          source:
            item.storageType === 'opfs' && item.opfsPath
              ? { kind: 'opfs', path: item.opfsPath, mimeType: item.mimeType }
              : async () => {
                  const { mediaLibraryService } = await importMediaLibraryService()
                  return mediaLibraryService.getMediaFile(item.id)
                },
          // Only a hint for the progress bar; the worker measures the true rate itself, and takes
          // the frame size from the decoder rather than from this item's metadata.
          sourceFps: item.fps,
        })
      }
    },
    [getTargetMediaItems],
  )

  const handleCancelUpscale = useCallback(() => {
    for (const item of getTargetMediaItems()) {
      upscaleService.cancel(item.id)
    }
  }, [getTargetMediaItems])

  const handleDeleteProxy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const targets = getTargetMediaItems().filter(
      (m) => useMediaLibraryStore.getState().proxyStatus.get(m.id) === 'ready',
    )
    const uniqueKeys = new Map<string, MediaMetadata>()
    for (const item of targets) {
      const key = getSharedProxyKey(item)
      if (!uniqueKeys.has(key)) uniqueKeys.set(key, item)
    }
    for (const [sharedProxyKey, representative] of uniqueKeys) {
      try {
        await proxyService.deleteProxy(representative.id, sharedProxyKey)

        const store = useMediaLibraryStore.getState()
        for (const other of store.mediaItems) {
          if (other.mimeType.startsWith('video/') && getSharedProxyKey(other) === sharedProxyKey) {
            store.clearProxyStatus(other.id)
            proxyService.clearProxyKey(other.id)
          }
        }
      } catch {
        const store = useMediaLibraryStore.getState()
        for (const other of store.mediaItems) {
          if (other.mimeType.startsWith('video/') && getSharedProxyKey(other) === sharedProxyKey) {
            store.setProxyStatus(other.id, 'error')
          }
        }
      }
    }
  }

  const handleOpenTranscribeDialog = (e: React.MouseEvent) => {
    e.stopPropagation()
    setTranscribeErrorMessage(null)
    setTranscribeDialogOpen(true)
  }

  const handleStartTranscription = useCallback(
    (values: TranscribeDialogValues) => {
      const store = useMediaLibraryStore.getState()
      const targets = getTargetMediaItems()

      setTranscribeErrorMessage(null)

      // Close the dialog and transcribe in the background — exactly like the transcript
      // panel, which just calls transcribeMedia and tracks status. Keeping the modal open
      // during the job (animated spinner + backdrop forcing continuous compositing) while
      // the WebGPU encoder runs in the media-library view deadlocked the renderer.
      setTranscribeDialogOpen(false)

      void (async () => {
        {
          let succeeded = 0
          let failed = 0
          let lastErrorMessage: string | null = null

          for (const target of targets) {
            try {
              const result = await runMediaTranscriptionJob(target.id, {
                model: values.model,
                quantization: values.quantization,
                language: values.language || undefined,
                onModelFallback: () => {
                  store.showNotification({
                    type: 'info',
                    message: i18n.t('transcript.largeTurboFallback'),
                  })
                },
              })
              if (result.status === 'cancelled') {
                continue
              }
              succeeded += 1
            } catch (error) {
              const baseMessage =
                error instanceof Error ? error.message : i18n.t('media.card.transcribeFailed')
              lastErrorMessage = isTranscriptionOutOfMemoryError(error)
                ? TRANSCRIPTION_OOM_HINT
                : baseMessage
              failed += 1
            }
          }

          if (failed === 0 && succeeded > 0) {
            if (targets.length === 1) {
              store.showNotification({
                type: 'success',
                message: i18n.t('media.card.transcriptReadyFor', { name: targets[0]!.fileName }),
              })
            } else {
              store.showNotification({
                type: 'success',
                message: i18n.t('media.card.transcriptsReady', { count: succeeded }),
              })
            }
            setTranscribeDialogOpen(false)
          } else if (failed > 0) {
            const msg = lastErrorMessage ?? i18n.t('media.card.transcribeFailed')
            setTranscribeErrorMessage(msg)
            store.showNotification({
              type: 'error',
              message:
                targets.length === 1
                  ? msg
                  : i18n.t('media.card.transcriptionFailedFor', {
                      failed,
                      total: targets.length,
                    }),
            })
          } else {
            setTranscribeDialogOpen(false)
          }
        }
      })()
    },
    [getTargetMediaItems],
  )

  const handleCancelTranscript = (e?: React.MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()
    const store = useMediaLibraryStore.getState()
    const targets = getTargetMediaItems().filter((m) => {
      const status = store.transcriptStatus.get(m.id)
      return status === 'queued' || status === 'transcribing'
    })
    for (const item of targets) {
      cancelMediaTranscriptionJob(item.id)
    }
  }

  const handleDeleteTranscript = async (e?: React.MouseEvent) => {
    e?.stopPropagation()

    const store = useMediaLibraryStore.getState()
    const rawTargets = getTargetMediaItems()
    const readyTargets = rawTargets.filter(
      (m) => store.transcriptStatus.get(m.id) === 'ready',
    )
    const targets = readyTargets.length > 0 ? readyTargets : [media]

    let failures = 0
    for (const item of targets) {
      try {
        await mediaTranscriptionService.deleteTranscript(item.id)
        store.setTranscriptStatus(item.id, 'idle')
        store.clearTranscriptProgress(item.id)
      } catch {
        failures += 1
      }
    }

    if (targets.length === 1 && failures === 0) {
      const [only] = targets
      store.showNotification({
        type: 'success',
        message: i18n.t('media.card.transcriptDeletedFor', { name: only!.fileName }),
      })
    } else if (targets.length > 1 && failures === 0) {
      store.showNotification({
        type: 'success',
        message: i18n.t('media.card.transcriptsDeleted', { count: targets.length }),
      })
    } else if (failures > 0) {
      store.showNotification({
        type: 'error',
        message:
          failures === targets.length
            ? i18n.t('media.card.transcriptDeleteFailed')
            : i18n.t('media.card.transcriptDeleteFailedFor', {
                failed: failures,
                total: targets.length,
              }),
      })
    }
  }

  const handleExtractEmbeddedSubtitles = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const targets = getTargetMediaItems().filter(canExtractEmbeddedSubtitlesFromMedia)
    const store = useMediaLibraryStore.getState()
    if (targets.length === 0) {
      store.showNotification({
        type: 'error',
        message: i18n.t('media.card.chooseMkvOrWebm'),
      })
      return
    }

    // Media-library extraction is purely a cache operation — never inserts
    // onto the timeline. The user reaches the insert flow from the clip
    // context menu after the cache is warm. Show the scan progress dialog so
    // long parses (multi-GB MKVs) have visible feedback.
    setIsExtractingEmbeddedSubtitles(true)
    const progress = useSubtitleScanProgressStore.getState()
    const abortController = new AbortController()
    progress.start({
      files: targets.map((t) => ({
        fileName: t.fileName,
        // Optimistic placeholder; replaced once the blob is opened and we
        // know the actual byte size.
        totalBytes: t.fileSize ?? 0,
      })),
      abort: () => abortController.abort(),
    })

    let succeeded = 0
    let totalTracksCached = 0
    let lastErrorMessage: string | null = null

    try {
      for (let i = 0; i < targets.length; i++) {
        if (abortController.signal.aborted) break
        const target = targets[i]!
        useSubtitleScanProgressStore.getState().setCurrentIndex(i)
        try {
          const hasPermission = await requestSubtitleSourcePermission(target)
          if (!hasPermission) {
            markSubtitleSourceUnreadable(target, 'permission_denied')
            lastErrorMessage = i18n.t('media.card.subtitlesNeedPermission', {
              name: target.fileName,
            })
            useSubtitleScanProgressStore.getState().markEntryStatus(i, 'error')
            continue
          }

          const sourceBlob = await getSubtitleSourceBlob(target)
          const result = await subtitleSidecarService.scanEmbeddedSubtitleTracks(
            target,
            sourceBlob,
            {
              onProgress: ({ bytesRead }) => {
                useSubtitleScanProgressStore.getState().updateProgress(bytesRead)
              },
              signal: abortController.signal,
            },
          )
          // Surface 100% even when no clusters fired the periodic tick.
          useSubtitleScanProgressStore.getState().updateProgress(sourceBlob.size)
          useSubtitleScanProgressStore.getState().markEntryStatus(i, 'done')
          totalTracksCached += result.tracks.length
          succeeded += 1
        } catch (error) {
          if (abortController.signal.aborted) break
          lastErrorMessage = getSubtitleExtractionErrorMessage(error, target)
          useSubtitleScanProgressStore.getState().markEntryStatus(i, 'error')
        }
      }
    } finally {
      setIsExtractingEmbeddedSubtitles(false)
    }

    if (abortController.signal.aborted) {
      // User-cancelled mid-batch — dialog already cleared by close().
      return
    }

    if (succeeded > 0) {
      const summary =
        succeeded === targets.length
          ? i18n.t('media.card.subtitlesCachedAll', {
              tracks: totalTracksCached,
              files: succeeded,
            })
          : i18n.t('media.card.subtitlesCachedPartial', {
              succeeded,
              total: targets.length,
              tracks: totalTracksCached,
            })
      useSubtitleScanProgressStore.getState().finish(summary)
      return
    }

    // All failures — close progress dialog and surface a notification.
    useSubtitleScanProgressStore.getState().close()
    store.showNotification({
      type: 'error',
      message: lastErrorMessage ?? i18n.t('media.card.subtitlesScanFailed'),
    })
  }

  const handleAnalyzeWithAI = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const store = useMediaLibraryStore.getState()
      const analyzable = getTargetMediaItems().filter((m) => {
        const type = getMediaType(m.mimeType)
        if (type !== 'video' && type !== 'image') return false
        if (store.brokenMediaIds?.includes(m.id)) return false
        if (store.importingIds?.includes(m.id)) return false
        return true
      })
      if (analyzable.length > 1) {
        const { mediaAnalysisService } = await importMediaAnalysisService()
        await mediaAnalysisService.analyzeBatch({ mediaIds: analyzable.map((m) => m.id) })
      } else if (analyzable.length === 1) {
        const { mediaAnalysisService } = await importMediaAnalysisService()
        await mediaAnalysisService.analyzeMedia(analyzable[0]!)
      } else {
        const type = getMediaType(media.mimeType)
        if (type === 'video' || type === 'image') {
          const { mediaAnalysisService } = await importMediaAnalysisService()
          await mediaAnalysisService.analyzeMedia(media)
        }
      }
    },
    [media, getTargetMediaItems],
  )

  const removeNativeDragCleanupListenersRef = useRef<(() => void) | null>(null)

  const cleanupDragArtifacts = useCallback(() => {
    removeNativeDragCleanupListenersRef.current?.()
    removeNativeDragCleanupListenersRef.current = null
    clearMediaDragData()
    if (dragImageRef.current) {
      dragImageRef.current.remove()
      dragImageRef.current = null
    }
  }, [])

  const installNativeDragCleanupListeners = useCallback(() => {
    cleanupDragArtifacts()

    const handleNativeDragEnd = () => cleanupDragArtifacts()
    const handleNativeDrop = () => {
      window.setTimeout(cleanupDragArtifacts, 0)
    }
    const handleWindowBlur = () => cleanupDragArtifacts()

    window.addEventListener('dragend', handleNativeDragEnd, true)
    document.addEventListener('drop', handleNativeDrop, true)
    window.addEventListener('blur', handleWindowBlur)

    removeNativeDragCleanupListenersRef.current = () => {
      window.removeEventListener('dragend', handleNativeDragEnd, true)
      document.removeEventListener('drop', handleNativeDrop, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [cleanupDragArtifacts])

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      installNativeDragCleanupListeners()
      // Set drag data for timeline drop
      e.dataTransfer.effectAllowed = 'copy'
      const mediaStore = useMediaLibraryStore.getState()
      const selectedMediaIds = mediaStore.selectedMediaIds
      const mediaById = mediaStore.mediaById

      // If this item is selected and there are multiple selected items, drag all of them
      const isPartOfSelection = selectedMediaIds.includes(media.id)
      const hasMultipleSelected = selectedMediaIds.length > 1

      if (isPartOfSelection && hasMultipleSelected) {
        // Build array of all selected media items in their current order
        const selectedItems = selectedMediaIds
          .map((id) => mediaById[id])
          .filter((m): m is MediaMetadata => m !== undefined)
          .map((m) => ({
            mediaId: m.id,
            mediaType: getMediaType(m.mimeType),
            fileName: m.fileName,
            duration: m.duration,
          }))

        const dragData = {
          type: 'media-items' as const,
          items: selectedItems,
        }

        e.dataTransfer.setData('application/json', JSON.stringify(dragData))
        // Cache for dragover access
        setMediaDragData(dragData)
      } else {
        // Single item drag
        const dragData = {
          type: 'media-item' as const,
          mediaId: media.id,
          mediaType: mediaType,
          fileName: media.fileName,
          duration: media.duration,
        }

        e.dataTransfer.setData('application/json', JSON.stringify(dragData))
        // Cache for dragover access
        setMediaDragData(dragData)
      }

      // Custom drag image: show just the thumbnail at natural aspect ratio.
      // thumbnailRef is on the grid-view <img>; for list view, query the card element.
      const thumbEl =
        thumbnailRef.current ??
        (e.currentTarget as HTMLElement).querySelector<HTMLImageElement>('img[alt]')
      if (thumbEl && thumbEl.naturalWidth > 0) {
        const maxDim = 120
        const ratio = thumbEl.naturalWidth / thumbEl.naturalHeight
        const w = ratio >= 1 ? maxDim : Math.round(maxDim * ratio)
        const h = ratio >= 1 ? Math.round(maxDim / ratio) : maxDim

        const ghost = document.createElement('div')
        ghost.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${w}px;height:${h}px;border-radius:4px;overflow:hidden;opacity:0.85;`
        const img = document.createElement('img')
        img.src = thumbEl.src
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
        ghost.appendChild(img)
        document.body.appendChild(ghost)
        dragImageRef.current = ghost

        e.dataTransfer.setDragImage(ghost, w / 2, h / 2)
      }
    },
    [installNativeDragCleanupListeners, media.id, media.fileName, media.duration, mediaType],
  )

  const handleDragEnd = cleanupDragArtifacts

  useEffect(() => cleanupDragArtifacts, [cleanupDragArtifacts])

  const handleClick = (e: React.MouseEvent) => {
    onSelect?.(e)
  }

  const audioScrubUrlRef = useRef<string | null>(null)
  const audioScrubRequestIdRef = useRef(0)

  const scrubAudioAtProgress = useCallback(
    async (progress: number) => {
      if (!isAudio || media.duration <= 0) return
      const requestId = ++audioScrubRequestIdRef.current
      let mediaUrl = audioScrubUrlRef.current

      try {
        if (!mediaUrl) {
          const { mediaLibraryService } = await importMediaLibraryService()
          mediaUrl = await mediaLibraryService.getMediaBlobUrl(media.id)
          if (!mediaUrl || requestId !== audioScrubRequestIdRef.current) return
          audioScrubUrlRef.current = mediaUrl
        }

        await audioScrubPreview.scrub({
          mediaId: media.id,
          mediaUrl,
          timeSeconds: getAudioScrubTime(media.duration, progress),
        })
      } catch {
        // Audio scrub preview is opportunistic; failed decode/autoplay should not
        // block normal media-library hover or selection behavior.
      }
    },
    [isAudio, media.duration, media.id],
  )

  const stopAudioScrubPreview = useCallback(() => {
    audioScrubRequestIdRef.current += 1
    audioScrubPreview.stop()
  }, [])

  const canHoverPreview =
    (mediaType === 'video' || mediaType === 'audio' || mediaType === 'image') &&
    !isBroken &&
    !isPreparingMedia &&
    !isTranscriptionDialogOpen
  const canScrubPreview =
    (mediaType === 'video' || mediaType === 'audio') &&
    media.duration > 0 &&
    !isBroken &&
    !isPreparingMedia &&
    !isTranscriptionDialogOpen
  const skimRafRef = useRef<number | null>(null)
  const pendingSkimClientXRef = useRef<number | null>(null)

  const updateSkimPreview = useCallback(
    (clientX: number) => {
      const thumbnailContainer = thumbnailContainerRef.current
      if (!thumbnailContainer || !canHoverPreview) return

      if (!canScrubPreview) {
        setSkimProgress(null)
        setMediaSkimPreview(media.id, 0)
        return
      }

      const rect = thumbnailContainer.getBoundingClientRect()
      if (rect.width <= 0) return

      const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      setSkimProgress(progress)

      if (mediaType === 'audio') {
        setMediaSkimPreview(media.id, 0)
        void scrubAudioAtProgress(progress)
        return
      }

      const durationInFrames = Math.max(1, Math.round(media.duration * (media.fps || 30)))
      const frame = Math.min(
        durationInFrames - 1,
        Math.max(0, Math.round(progress * (durationInFrames - 1))),
      )

      setMediaSkimPreview(media.id, frame)
    },
    [
      canHoverPreview,
      canScrubPreview,
      media.duration,
      media.fps,
      media.id,
      mediaType,
      scrubAudioAtProgress,
      setMediaSkimPreview,
    ],
  )

  const flushScheduledSkimPreview = useCallback(() => {
    skimRafRef.current = null
    const clientX = pendingSkimClientXRef.current
    pendingSkimClientXRef.current = null
    if (clientX === null) return
    updateSkimPreview(clientX)
  }, [updateSkimPreview])

  const scheduleSkimPreview = useCallback(
    (clientX: number) => {
      pendingSkimClientXRef.current = clientX
      if (skimRafRef.current !== null) {
        return
      }

      skimRafRef.current = requestAnimationFrame(flushScheduledSkimPreview)
    },
    [flushScheduledSkimPreview],
  )

  const cancelScheduledSkimPreview = useCallback(() => {
    pendingSkimClientXRef.current = null
    if (skimRafRef.current !== null) {
      cancelAnimationFrame(skimRafRef.current)
      skimRafRef.current = null
    }
  }, [])

  const handleThumbnailPointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canHoverPreview || event.pointerType === 'touch') return
      pauseTimelinePlayback()
      updateSkimPreview(event.clientX)
    },
    [canHoverPreview, pauseTimelinePlayback, updateSkimPreview],
  )

  const handleThumbnailPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canScrubPreview || event.pointerType === 'touch') return
      scheduleSkimPreview(event.clientX)
    },
    [canScrubPreview, scheduleSkimPreview],
  )

  const handleThumbnailPointerLeave = useCallback(() => {
    if (!canHoverPreview) return
    cancelScheduledSkimPreview()
    stopAudioScrubPreview()
    setSkimProgress(null)
    clearMediaSkimPreview()
  }, [canHoverPreview, cancelScheduledSkimPreview, clearMediaSkimPreview, stopAudioScrubPreview])

  useEffect(() => {
    if (!canHoverPreview) return
    return () => {
      cancelScheduledSkimPreview()
      stopAudioScrubPreview()
      if (useEditorStore.getState().mediaSkimPreviewMediaId === media.id) {
        clearMediaSkimPreview()
      }
    }
  }, [
    canHoverPreview,
    cancelScheduledSkimPreview,
    clearMediaSkimPreview,
    media.id,
    stopAudioScrubPreview,
  ])

  const handleSeekToCaption = useCallback(
    (timeSec: number) => {
      const fps = media.fps || 30
      const sourceDurationFrames = Math.max(1, Math.round(media.duration * fps))
      const frame = Math.max(0, Math.min(sourceDurationFrames - 1, Math.round(timeSec * fps)))
      const outFrame = Math.min(
        sourceDurationFrames,
        frame + Math.max(1, Math.round(DEFAULT_CAPTION_SELECTION_DURATION_SEC * fps)),
      )
      const sourceStore = useSourcePlayerStore.getState()

      sourceStore.setCurrentMediaId(media.id)
      sourceStore.clearInOutPoints()
      sourceStore.setInPoint(frame)
      sourceStore.setOutPoint(outFrame)
      sourceStore.setPendingSeekFrame(frame)
      useEditorStore.getState().setSourcePreviewMediaId(media.id)
    },
    [media.duration, media.fps, media.id],
  )

  // The card's inline bars have room for exactly one number, so they show job-wide progress.
  const transcriptProgressPercent = transcriptProgress
    ? Math.round(getTranscriptionOverallPercent(transcriptProgress))
    : null
  // The dialog has room to name the stage, so its bar tracks the stage instead — a job-wide
  // percent would inch across the first tenth of the track for a multi-minute model download.
  const transcriptStagePercent = transcriptProgress
    ? Math.round(transcriptProgress.progress * 100)
    : null
  const transcriptProgressIndeterminate = transcriptProgress
    ? isIndeterminateTranscriptionProgress(transcriptProgress)
    : false
  const transcriptProgressLabel = transcriptProgress
    ? getTranscriptionProgressLabel(transcriptProgress)
    : t('media.card.transcribing')
  const transcriptProgressDetail = transcriptProgress
    ? getTranscriptionProgressDetail(transcriptProgress)
    : null

  const transcribeDialog = (
    <TranscribeDialog
      open={transcribeDialogOpen}
      onOpenChange={(next) => {
        if (!next) setTranscribeErrorMessage(null)
        setTranscribeDialogOpen(next)
      }}
      fileName={media.fileName}
      hasTranscript={hasTranscript}
      isRunning={isTranscribing}
      progressPercent={transcriptStagePercent}
      progressIndeterminate={transcriptProgressIndeterminate}
      progressLabel={transcriptProgressLabel}
      progressDetail={transcriptProgressDetail}
      errorMessage={transcribeErrorMessage}
      onStart={handleStartTranscription}
      onCancel={handleCancelTranscript}
      onDelete={handleDeleteTranscript}
    />
  )

  const actionMenuItems = (
    <MediaCardActionMenuItems
      isBroken={isBroken}
      onRelink={onRelink}
      canGenerateProxy={canGenerateProxy}
      hasProxy={hasProxy}
      proxyStatus={proxyStatus}
      canInterpolate={canInterpolate}
      isInterpolating={isInterpolating}
      onInterpolate={handleInterpolate}
      onCancelInterpolation={handleCancelInterpolation}
      canUpscale={canUpscaleMedia}
      isUpscaling={isUpscaling}
      onUpscale={handleUpscale}
      onCancelUpscale={handleCancelUpscale}
      isTranscribable={isTranscribable}
      isTranscribing={isTranscribing}
      hasTranscript={hasTranscript}
      canExtractEmbeddedSubtitles={getTargetMediaItems().some(canExtractEmbeddedSubtitlesFromMedia)}
      isExtractingEmbeddedSubtitles={isExtractingEmbeddedSubtitles}
      isTaggable={isTaggable}
      isTagging={isTagging}
      onGenerateProxy={handleGenerateProxy}
      onDeleteProxy={handleDeleteProxy}
      onGenerateTranscript={handleOpenTranscribeDialog}
      onDeleteTranscript={handleDeleteTranscript}
      onExtractEmbeddedSubtitles={handleExtractEmbeddedSubtitles}
      onAnalyzeWithAI={handleAnalyzeWithAI}
      onDelete={handleDelete}
    />
  )

  const getIcon = () => {
    switch (mediaType) {
      case 'video':
        return <Video className="w-5 h-5 text-primary" />
      case 'audio':
        return <FileAudio className="w-5 h-5 text-green-500" />
      case 'image':
        return <ImageIcon className="w-5 h-5 text-blue-500" />
      case 'lottie':
        return <FileJson className="w-5 h-5 text-purple-500" />
      default:
        return <Video className="w-5 h-5 text-muted-foreground" />
    }
  }

  // List view
  if (layout === 'list') {
    return (
      <>
        {transcribeDialog}
        <ContextMenu onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger asChild disabled={isPreparingMedia}>
            <div
              style={CARD_PERF_STYLE}
              className={`
          ${CARD_LIST_BASE} cursor-pointer
          ${
            selected
              ? 'border-primary ring-1 ring-primary/20'
              : 'border-border hover:border-primary/50'
          }
          ${isPreparingMedia ? 'opacity-80 cursor-default' : ''}
        `}
              draggable={!isPreparingMedia}
              onDragStart={isPreparingMedia ? undefined : handleDragStart}
              onDragEnd={isPreparingMedia ? undefined : handleDragEnd}
              onClick={isPreparingMedia ? undefined : handleClick}
              onDoubleClick={
                isPreparingMedia
                  ? undefined
                  : (e) => {
                      e.stopPropagation()
                      onDoubleClick?.()
                    }
              }
            >
              {/* Thumbnail */}
              <div
                ref={thumbnailContainerRef}
                className="w-12 h-9 bg-secondary rounded overflow-hidden flex-shrink-0 relative"
                onPointerEnter={handleThumbnailPointerEnter}
                onPointerMove={handleThumbnailPointerMove}
                onPointerLeave={handleThumbnailPointerLeave}
              >
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={media.fileName}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">{getIcon()}</div>
                )}
                {/* Preparing overlay for list view thumbnail */}
                {isPreparingMedia && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  </div>
                )}
                {/* Broken indicator for list view */}
                {isBroken && !isPreparingMedia && (
                  <div className="absolute top-0.5 right-0.5 p-0.5 rounded bg-destructive/90 text-destructive-foreground">
                    <Link2Off className="w-2.5 h-2.5" />
                  </div>
                )}
                {/* Proxy badge for list view */}
                {!isBroken && !isPreparingMedia && proxyStatus === 'generating' && (
                  <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-green-500/90 text-black">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  </div>
                )}
                {!isBroken && !isPreparingMedia && isTagging && (
                  <div
                    className="absolute bottom-0.5 left-0.5 p-0.5 rounded bg-purple-500/90 text-white"
                    title={t('media.card.analyzingWithAI')}
                  >
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  </div>
                )}
                {!isBroken && !isPreparingMedia && hasProxy && (
                  <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-green-500/90 text-black">
                    <Zap className="w-2.5 h-2.5" />
                  </div>
                )}
                {canScrubPreview && skimProgress !== null && (
                  <div
                    className="absolute inset-y-0 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none"
                    style={getSkimIndicatorStyle(skimProgress)}
                  />
                )}
                {!isBroken &&
                  !isPreparingMedia &&
                  isTranscribing &&
                  transcriptProgressPercent !== null && (
                    <div
                      role="progressbar"
                      aria-label={t('media.card.transcriptProgressAria')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={transcriptProgressPercent}
                      className="absolute inset-x-0 bottom-0 z-10 h-1 overflow-hidden bg-black/25 pointer-events-none"
                    >
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{ width: `${transcriptProgressPercent}%` }}
                      />
                    </div>
                  )}
              </div>

              {/* Info — single row: icon + name + duration */}
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                {isImporting ? (
                  <span className="text-[10px] text-muted-foreground">{preparingLabel}</span>
                ) : (
                  <>
                    <div className="p-0.5 rounded bg-primary/90 text-primary-foreground flex-shrink-0">
                      {mediaType === 'video' && <Video className="w-2.5 h-2.5" />}
                      {mediaType === 'audio' && <FileAudio className="w-2.5 h-2.5" />}
                      {mediaType === 'image' && <ImageIcon className="w-2.5 h-2.5" />}
                      {mediaType === 'lottie' && <FileJson className="w-2.5 h-2.5" />}
                    </div>
                    <h3 className="text-xs font-medium text-foreground truncate">
                      {media.fileName}
                    </h3>
                    {(mediaType === 'video' || mediaType === 'audio') && media.duration > 0 && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">
                        {formatDuration(media.duration)}
                      </span>
                    )}
                  </>
                )}
              </div>

              {/* Actions - hidden during upload */}
              {!isPreparingMedia && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {hasTranscript && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenTranscribeDialog(e)
                      }}
                      className="px-1.5 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 dark:text-blue-400 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                      title="Tiene transcripción. Clic para regenerar o limpiar"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Transcrito</span>
                    </button>
                  )}
                  <MediaInfoPopover
                    media={media}
                    triggerClassName="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
                    onSeekToCaption={handleSeekToCaption}
                    onTranscribe={() => setTranscribeDialogOpen(true)}
                    onDeleteTranscript={handleDeleteTranscript}
                  />
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent onClick={(e) => e.stopPropagation()}>
            {actionMenuItems}
          </ContextMenuContent>
        </ContextMenu>
      </>
    )
  }

  // Grid view
  return (
    <>
      {transcribeDialog}
      <ContextMenu onOpenChange={handleContextMenuOpenChange}>
        <ContextMenuTrigger asChild disabled={isPreparingMedia}>
          <div
            style={CARD_PERF_STYLE}
            className={`
        ${CARD_GRID_BASE} cursor-pointer
        ${
          selected
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-border hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10'
        }
        ${isPreparingMedia ? 'cursor-default' : ''}
      `}
            draggable={!isPreparingMedia}
            onDragStart={isPreparingMedia ? undefined : handleDragStart}
            onDragEnd={isPreparingMedia ? undefined : handleDragEnd}
            onClick={isPreparingMedia ? undefined : handleClick}
            onDoubleClick={
              isPreparingMedia
                ? undefined
                : (e) => {
                    e.stopPropagation()
                    onDoubleClick?.()
                  }
            }
          >
            {/* Film strip perforations effect */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary via-muted to-secondary" />
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary via-muted to-secondary" />

            {/* Thumbnail - takes most of square space */}
            <div
              ref={thumbnailContainerRef}
              className="flex-1 bg-secondary relative overflow-hidden min-h-0"
              onPointerEnter={handleThumbnailPointerEnter}
              onPointerMove={handleThumbnailPointerMove}
              onPointerLeave={handleThumbnailPointerLeave}
            >
              {thumbnailUrl ? (
                <img
                  ref={thumbnailRef}
                  src={thumbnailUrl}
                  alt={media.fileName}
                  className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary to-panel-bg">
                  {getIcon()}
                </div>
              )}

              {/* Selection glow - subtle overlay only */}
              {selected && !isPreparingMedia && (
                <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
              )}

              {/* Preparing overlay */}
              {isPreparingMedia && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                  <div className="text-[9px] text-white/60 uppercase tracking-wider">
                    {preparingLabel}
                  </div>
                </div>
              )}

              {/* Top-right badges & info */}
              {!isPreparingMedia && (
                <div className="absolute top-1 right-1 z-10 flex flex-col items-end gap-0.5">
                  {isBroken && (
                    <div className="p-1 rounded bg-destructive/90 text-destructive-foreground">
                      <Link2Off className="w-3 h-3" />
                    </div>
                  )}
                  {!isBroken && proxyStatus === 'generating' && (
                    <div className="p-0.5 rounded bg-green-500/90 text-black pointer-events-none">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    </div>
                  )}
                  {!isBroken && isTagging && (
                    <div
                      className="p-0.5 rounded bg-purple-500/90 text-white pointer-events-none"
                      title={t('media.card.analyzingWithAI')}
                    >
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    </div>
                  )}
                  {!isBroken && hasProxy && (
                    <div className="p-0.5 rounded bg-green-500/90 text-black pointer-events-none">
                      <Zap className="w-2.5 h-2.5" />
                    </div>
                  )}
                  {!isBroken && hasCaptions && (
                    <div
                      className="p-0.5 rounded bg-purple-500/90 text-white pointer-events-none"
                      title={t('media.card.aiCaptionsCount', { count: media.aiCaptions!.length })}
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                    </div>
                  )}
                  {!isBroken && hasTranscript && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenTranscribeDialog(e)
                      }}
                      className="px-1.5 py-0.5 rounded bg-blue-600/90 hover:bg-blue-600 text-white text-[9px] font-medium flex items-center gap-1 transition-colors shadow-xs cursor-pointer pointer-events-auto"
                      title="Tiene transcripción. Clic para regenerar o limpiar"
                    >
                      <FileText className="w-2.5 h-2.5" />
                      <span>Transcrito</span>
                    </button>
                  )}
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <MediaInfoPopover
                      media={media}
                      onSeekToCaption={handleSeekToCaption}
                      onTranscribe={() => setTranscribeDialogOpen(true)}
                      onDeleteTranscript={handleDeleteTranscript}
                    />
                  </div>
                </div>
              )}

              {/* Overlaid badges - hidden during preparation */}
              {!isPreparingMedia && (
                <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
                  {/* Type icon badge - icon only */}
                  <div className="p-0.5 rounded bg-primary/90 text-primary-foreground">
                    {mediaType === 'video' && <Video className="w-2.5 h-2.5" />}
                    {mediaType === 'audio' && <FileAudio className="w-2.5 h-2.5" />}
                    {mediaType === 'image' && <ImageIcon className="w-2.5 h-2.5" />}
                    {mediaType === 'lottie' && <FileJson className="w-2.5 h-2.5" />}
                  </div>

                  {/* Duration badge */}
                  {(mediaType === 'video' || mediaType === 'audio') && media.duration > 0 && (
                    <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                      {formatDuration(media.duration)}
                    </div>
                  )}
                </div>
              )}
              {canScrubPreview && skimProgress !== null && (
                <div
                  className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
                  style={getSkimIndicatorStyle(skimProgress)}
                />
              )}
              {!isBroken &&
                !isPreparingMedia &&
                isTranscribing &&
                transcriptProgressPercent !== null && (
                  <div
                    role="progressbar"
                    aria-label={t('media.card.transcriptProgressAria')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={transcriptProgressPercent}
                    className="absolute inset-x-0 bottom-0 z-10 h-1 overflow-hidden bg-black/25 pointer-events-none"
                  >
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${transcriptProgressPercent}%` }}
                    />
                  </div>
                )}
            </div>

            {/* Content footer - minimal */}
            <div className="px-1.5 py-1 bg-panel-bg/50 flex-shrink-0">
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <h3 className="text-[10px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                    {media.fileName}
                  </h3>
                </div>
              </div>
            </div>

            {/* Film strip edge detail */}
            <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
            <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onClick={(e) => e.stopPropagation()}>
          {actionMenuItems}
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
})
