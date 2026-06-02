import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Download,
  Film,
  Clock,
  HardDrive,
  Music,
  Video,
  Scissors,
  ListPlus,
  ChevronDown,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import type {
  ExportSettings,
  ExportMode,
  ExtendedExportSettings,
  CompositionInputProps,
} from '@/types/export'
import { useClientRender } from '../hooks/use-client-render'
import {
  buildRenderJob,
  buildSegmentJobs,
  rangesFromFixedDuration,
  rangesFromMarkers,
} from '../utils/build-render-job'
import { useRenderQueueStore, type RenderJob } from '../stores/render-queue-store'
import { useProjectStore } from '@/features/export/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import { useTimelineStore } from '@/features/export/deps/timeline'
import { formatTimecode, framesToSeconds } from '@/shared/utils/time-utils'
import type { ExportPreflightResult } from '../utils/export-preflight'
import { assessExportPreflight, summarizePreflightSeverity } from '../utils/export-preflight'
import {
  getCompatibleVideoCodecs,
  getDefaultVideoCodec,
  mapExportCodecToClientCodec,
  type ClientCodec,
  type ClientVideoContainer,
  type ClientAudioContainer,
} from '../utils/client-renderer'
import { ExportPreviewPlayer } from './export-preview-player'
import { useBrokenMediaIds } from '../deps/media-library'

export interface ExportDialogProps {
  open: boolean
  onClose: () => void
  /** Open the render queue panel (called after jobs are added to the queue). */
  onOpenRenderQueue?: () => void
}

type DialogView = 'settings' | 'progress' | 'complete' | 'error' | 'cancelled'

type VideoContainerOption = {
  value: ClientVideoContainer
  label: string
  description: string
  supported: boolean
}

type VideoCodecOption = {
  value: ExportSettings['codec']
  label: string
  supported: boolean
}

const VIDEO_CODEC_LABELS: Record<string, string> = {
  h264: 'H.264',
  h265: 'H.265/HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
}

const VIDEO_CONTAINER_DESCRIPTION_KEYS: Record<ClientVideoContainer, string> = {
  mp4: 'export.videoContainer.mp4',
  mov: 'export.videoContainer.mov',
  webm: 'export.videoContainer.webm',
  mkv: 'export.videoContainer.mkv',
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds}s`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Scale a dimension and round to the nearest even number (encoders require
 * even dimensions). Shared by the resolution dropdown and the quick presets so
 * preset detection compares against identical values.
 */
function scaleDimension(value: number, scale: number): number {
  const scaled = Math.round(value * scale)
  return scaled % 2 === 0 ? scaled : scaled + 1
}

function scaledResolution(projectWidth: number, projectHeight: number, scale: number) {
  return {
    width: scaleDimension(projectWidth, scale),
    height: scaleDimension(projectHeight, scale),
  }
}

type ExportPreset = {
  id: 'max' | 'recommended' | 'balanced' | 'small'
  labelKey: string
  container: ClientVideoContainer
  codec: ExportSettings['codec']
  quality: ExportSettings['quality']
  scale: number
}

// One-click targets that bundle container/codec/quality/resolution. All keep the
// project's aspect ratio (scale only) so output is never distorted; they vary the
// quality/size tradeoff, which is the part users shouldn't need codec knowledge for.
const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'max',
    labelKey: 'export.settings.presetMax',
    container: 'mp4',
    codec: 'h264',
    quality: 'ultra',
    scale: 1,
  },
  {
    id: 'recommended',
    labelKey: 'export.settings.presetRecommended',
    container: 'mp4',
    codec: 'h264',
    quality: 'high',
    scale: 1,
  },
  {
    id: 'balanced',
    labelKey: 'export.settings.presetBalanced',
    container: 'mp4',
    codec: 'h264',
    quality: 'medium',
    scale: 0.666,
  },
  {
    id: 'small',
    labelKey: 'export.settings.presetSmall',
    container: 'mp4',
    codec: 'h264',
    quality: 'low',
    scale: 0.5,
  },
]

/**
 * Generate resolution options based on project dimensions.
 */
function getResolutionOptions(
  projectWidth: number,
  projectHeight: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const scales = [1, 0.666, 0.5]

  return scales.map((scale) => {
    const { width, height } = scaledResolution(projectWidth, projectHeight, scale)

    const label =
      scale === 1
        ? t('export.settings.resolutionSameAsProject', { width, height })
        : t('export.settings.resolutionScaled', { p: Math.min(width, height), width, height })

    return { value: `${width}x${height}`, label }
  })
}

function getDefaultCodecForFormat(format: 'mp4' | 'webm'): ExportSettings['codec'] {
  return getDefaultVideoCodec(format)
}

function preflightIconClass(severity: ReturnType<typeof summarizePreflightSeverity>): string {
  switch (severity) {
    case 'error':
      return 'text-destructive'
    case 'warning':
      return 'text-amber-500'
    case 'info':
      return 'text-blue-500'
    case 'ok':
      return 'text-green-500'
  }
}

function ExportPreflightPanel({ preflight }: { preflight: ExportPreflightResult | null }) {
  const { t } = useTranslation()

  if (!preflight) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {t('export.preflight.checking')}
      </div>
    )
  }

  const summarySeverity = summarizePreflightSeverity(preflight.checks)
  const visibleChecks = preflight.checks.filter((check) => check.severity !== 'ok').slice(0, 4)
  const checksToRender = visibleChecks.length > 0 ? visibleChecks : preflight.checks.slice(0, 2)

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {summarySeverity === 'ok' ? (
            <CheckCircle2 className={`h-4 w-4 ${preflightIconClass(summarySeverity)}`} />
          ) : (
            <AlertCircle className={`h-4 w-4 ${preflightIconClass(summarySeverity)}`} />
          )}
          <span className="text-sm font-medium">{t('export.preflight.title')}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {preflight.predictedRenderPath === 'worker'
            ? t('export.preflight.workerPath')
            : t('export.preflight.fallback')}
        </span>
      </div>
      <div className="space-y-1.5">
        {checksToRender.map((check) => (
          <div key={check.id} className="text-xs leading-relaxed">
            <span
              className={
                check.severity === 'error'
                  ? 'text-destructive'
                  : check.severity === 'warning'
                    ? 'text-amber-500'
                    : check.severity === 'info'
                      ? 'text-blue-500'
                      : 'text-green-500'
              }
            >
              {t(check.titleKey, check.titleParams)}
            </span>
            <span className="text-muted-foreground">
              {' '}
              — {t(check.detailKey, check.detailParams)}
            </span>
            {check.fixKey && (
              <span className="text-muted-foreground"> {t(check.fixKey, check.fixParams)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ExportDialog({ open, onClose, onOpenRenderQueue }: ExportDialogProps) {
  const { t } = useTranslation()
  const projectWidth = useProjectStore(
    (s) => s.currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
  )
  const projectHeight = useProjectStore(
    (s) => s.currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
  )
  // Timeline state for in/out points and duration calculation
  const fps = useTimelineStore((s) => s.fps)
  const tracks = useTimelineStore((s) => s.tracks ?? [])
  const items = useTimelineStore((s) => s.items)
  const transitions = useTimelineStore((s) => s.transitions ?? [])
  const keyframes = useTimelineStore((s) => s.keyframes ?? [])
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const markers = useTimelineStore((s) => s.markers ?? [])
  const brokenMediaIds = useBrokenMediaIds()
  const enqueueJobs = useRenderQueueStore((s) => s.enqueueJobs)

  const [settings, setSettings] = useState<ExportSettings>({
    codec: getDefaultCodecForFormat('mp4'),
    quality: 'high',
    resolution: { width: projectWidth, height: projectHeight },
  })

  const [exportMode, setExportMode] = useState<ExportMode>('video')
  const [videoContainer, setVideoContainer] = useState<ClientVideoContainer>('mp4')
  const [audioContainer, setAudioContainer] = useState<ClientAudioContainer>('mp3')
  const [view, setView] = useState<DialogView>('settings')
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [embedSubtitles, setEmbedSubtitles] = useState(true)
  const [renderWholeProject, setRenderWholeProject] = useState(false)
  const wasOpenRef = useRef(false)

  // Calculate timeline duration from items
  const timelineDurationFrames = useMemo(() => {
    if (items.length === 0) return 0
    return Math.max(...items.map((item) => item.from + item.durationInFrames))
  }, [items])

  // Check if in/out points are set
  const hasInOutPoints = inPoint !== null && outPoint !== null && outPoint > inPoint
  const hasTranscriptSubtitles = useMemo(
    () => items.some((item) => item.type === 'subtitle' && item.source.type === 'transcript'),
    [items],
  )
  const containerSupportsEmbeddedSubtitles =
    videoContainer === 'mp4' || videoContainer === 'webm' || videoContainer === 'mkv'

  // Calculate export range
  const exportRange = useMemo(() => {
    if (renderWholeProject || !hasInOutPoints) {
      return { start: 0, end: timelineDurationFrames, duration: timelineDurationFrames }
    }
    return { start: inPoint, end: outPoint, duration: outPoint - inPoint }
  }, [hasInOutPoints, inPoint, outPoint, renderWholeProject, timelineDurationFrames])

  const preflightComposition = useMemo<CompositionInputProps>(
    () => ({
      fps,
      durationInFrames: exportRange.duration,
      width: projectWidth,
      height: projectHeight,
      tracks,
      transitions,
      keyframes,
    }),
    [exportRange.duration, fps, keyframes, projectHeight, projectWidth, tracks, transitions],
  )

  const resolutionOptions = useMemo(
    () => getResolutionOptions(projectWidth, projectHeight, t),
    [projectWidth, projectHeight, t],
  )

  // Which preset (if any) the current settings exactly match. null = "Custom".
  const activePresetId = useMemo(() => {
    const match = EXPORT_PRESETS.find((preset) => {
      const res = scaledResolution(projectWidth, projectHeight, preset.scale)
      return (
        videoContainer === preset.container &&
        settings.codec === preset.codec &&
        settings.quality === preset.quality &&
        settings.resolution.width === res.width &&
        settings.resolution.height === res.height
      )
    })
    return match?.id ?? null
  }, [
    videoContainer,
    settings.codec,
    settings.quality,
    settings.resolution.width,
    settings.resolution.height,
    projectWidth,
    projectHeight,
  ])

  const applyPreset = (preset: ExportPreset) => {
    setVideoContainer(preset.container)
    setSettings((prev) => ({
      ...prev,
      codec: preset.codec,
      quality: preset.quality,
      resolution: scaledResolution(projectWidth, projectHeight, preset.scale),
    }))
  }

  // Sync resolution when project dimensions change
  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      resolution: { width: projectWidth, height: projectHeight },
    }))
  }, [projectWidth, projectHeight])

  // Render hook
  const clientRender = useClientRender()

  const {
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    startExport,
    cancelExport,
    downloadVideo,
    resetState,
    getSupportedCodecs,
  } = clientRender

  const [supportedVideoCodecs, setSupportedVideoCodecs] = useState<ClientCodec[] | null>(null)
  const [isCheckingVideoSupport, setIsCheckingVideoSupport] = useState(false)
  const [videoSupportError, setVideoSupportError] = useState<string | null>(null)
  const [preflight, setPreflight] = useState<ExportPreflightResult | null>(null)

  // Track elapsed time
  useEffect(() => {
    if (view === 'progress' && !startTime) {
      setStartTime(Date.now())
    }
    if (view === 'settings') {
      setStartTime(null)
      setElapsedSeconds(0)
    }
  }, [view, startTime])

  useEffect(() => {
    if (!startTime || view !== 'progress') return

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [startTime, view])

  // Watch status changes to update view
  useEffect(() => {
    if (status === 'completed') {
      setView('complete')
    } else if (status === 'failed') {
      setView('error')
    } else if (status === 'cancelled') {
      setView('cancelled')
    }
  }, [status])

  // Handle close
  const handleClose = () => {
    if (view === 'progress') return // Prevent closing during export
    setView('settings')
    resetState()
    onClose()
  }

  // Assemble the extended settings the render pipeline expects from the dialog
  // state. Shared by "Export now" and the "Add to queue" actions.
  const buildExtendedSettings = (): ExtendedExportSettings => ({
    ...settings,
    mode: exportMode,
    videoContainer: exportMode === 'video' ? videoContainer : undefined,
    audioContainer: exportMode === 'audio' ? audioContainer : undefined,
    embedSubtitles:
      exportMode === 'video' && hasTranscriptSubtitles && containerSupportsEmbeddedSubtitles
        ? embedSubtitles
        : false,
    renderWholeProject,
  })

  // Start export
  const handleStartExport = async () => {
    setView('progress')
    await startExport(buildExtendedSettings())
  }

  // The active render range (whole project unless in/out points are set).
  const queueRange = (): { inPoint: number | null; outPoint: number | null } =>
    renderWholeProject || !hasInOutPoints
      ? { inPoint: null, outPoint: null }
      : { inPoint, outPoint }

  // The frame window segment generators split over: the active range, or the
  // whole timeline when no in/out points are set.
  const segmentWindow = (): { start: number; end: number } => {
    const range = queueRange()
    return { start: range.inPoint ?? 0, end: range.outPoint ?? timelineDurationFrames }
  }

  // Close the export dialog and open the queue panel. Called BEFORE building
  // jobs so picking an option gives instant feedback while the (single) codec
  // probe + job assembly run.
  const revealQueue = () => {
    onClose()
    onOpenRenderQueue?.()
  }

  // Capture settings synchronously (the dialog unmounts on reveal), reveal the
  // queue, then build + enqueue. One codec probe covers the whole batch.
  const enqueueAndReveal = async (
    build: (settings: ExtendedExportSettings) => Promise<RenderJob[]>,
  ) => {
    const settings = buildExtendedSettings()
    revealQueue()
    try {
      const jobs = await build(settings)
      if (jobs.length === 0) return
      enqueueJobs(jobs)
      toast.success(t('export.renderQueue.addedToast', { count: jobs.length }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('export.renderQueue.buildFailed'))
    }
  }

  const handleAddCurrentRange = () => {
    void enqueueAndReveal(async (settings) => [await buildRenderJob({ settings, ...queueRange() })])
  }

  const handleAddMarkerSegments = () => {
    const { start, end } = segmentWindow()
    const ranges = rangesFromMarkers(markers, start, end)
    if (ranges.length <= 1) {
      toast.info(t('export.renderQueue.noMarkers'))
      return
    }
    void enqueueAndReveal((settings) =>
      buildSegmentJobs(settings, ranges, (i) => t('export.renderQueue.partLabel', { n: i + 1 })),
    )
  }

  const handleSplitChunks = (seconds: number) => {
    const { start, end } = segmentWindow()
    const ranges = rangesFromFixedDuration(start, end, Math.max(1, Math.round(seconds * fps)))
    if (ranges.length === 0) {
      toast.info(t('export.renderQueue.nothingToRender'))
      return
    }
    void enqueueAndReveal((settings) =>
      buildSegmentJobs(settings, ranges, (i) => t('export.renderQueue.partLabel', { n: i + 1 })),
    )
  }

  // Reset when dialog closes
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setView('settings')
      setExportMode('video')
      setVideoContainer('mp4')
      setAudioContainer('mp3')
      setEmbedSubtitles(true)
      setRenderWholeProject(false)
      setSettings({
        codec: getDefaultCodecForFormat('mp4'),
        quality: 'high',
        resolution: { width: projectWidth, height: projectHeight },
      })
      resetState()
      setPreflight(null)
      setStartTime(null)
      setElapsedSeconds(0)
    }

    if (!open && wasOpenRef.current) {
      setView('settings')
      resetState()
      setPreflight(null)
      setStartTime(null)
      setElapsedSeconds(0)
    }

    wasOpenRef.current = open
  }, [open, projectHeight, projectWidth, resetState])

  const getAudioContainerOptions = () => [
    { value: 'mp3', label: 'MP3', description: t('export.audioContainer.mp3') },
    { value: 'aac', label: 'AAC', description: t('export.audioContainer.aac') },
    { value: 'wav', label: 'WAV', description: t('export.audioContainer.wav') },
  ]

  useEffect(() => {
    if (!open || view !== 'settings' || exportMode !== 'video') return

    let cancelled = false
    setIsCheckingVideoSupport(true)
    setVideoSupportError(null)
    setSupportedVideoCodecs(null)

    void getSupportedCodecs({
      resolution: settings.resolution,
      quality: settings.quality,
    })
      .then((codecs) => {
        if (cancelled) return
        setSupportedVideoCodecs(codecs)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : t('export.errors.verifyCodec')
        setVideoSupportError(message)
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingVideoSupport(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [exportMode, getSupportedCodecs, open, settings.resolution, settings.quality, view, t])

  const videoContainerOptions = useMemo<VideoContainerOption[]>(() => {
    const allContainers: ClientVideoContainer[] = ['mp4', 'mov', 'webm', 'mkv']

    return allContainers.map((container) => {
      const supported =
        supportedVideoCodecs === null
          ? true
          : getCompatibleVideoCodecs(container)
              .map((codec) => mapExportCodecToClientCodec(codec))
              .some((codec) => supportedVideoCodecs.includes(codec))

      return {
        value: container,
        label: container === 'mov' ? t('export.settings.quicktimeMov') : container.toUpperCase(),
        description: t(VIDEO_CONTAINER_DESCRIPTION_KEYS[container]),
        supported,
      }
    })
  }, [supportedVideoCodecs, t])

  const codecOptions = useMemo<VideoCodecOption[]>(() => {
    return getCompatibleVideoCodecs(videoContainer).map((codec) => ({
      value: codec,
      label: VIDEO_CODEC_LABELS[codec] ?? codec.toUpperCase(),
      supported:
        supportedVideoCodecs === null
          ? true
          : supportedVideoCodecs.includes(mapExportCodecToClientCodec(codec)),
    }))
  }, [supportedVideoCodecs, videoContainer])

  const hasCapabilityData = supportedVideoCodecs !== null && !videoSupportError
  const hasSupportedVideoPath = videoContainerOptions.some((option) => option.supported)
  useEffect(() => {
    if (exportMode !== 'video' || !hasCapabilityData) return

    const firstSupportedContainer = videoContainerOptions.find((option) => option.supported)?.value
    if (!firstSupportedContainer) return
    if (
      !videoContainerOptions.some((option) => option.value === videoContainer && option.supported)
    ) {
      setVideoContainer(firstSupportedContainer)
    }
  }, [exportMode, hasCapabilityData, videoContainer, videoContainerOptions])

  useEffect(() => {
    const validCodecs = codecOptions
      .filter((option) => option.supported)
      .map((option) => option.value)

    if (!validCodecs.includes(settings.codec)) {
      const fallbackCodec = validCodecs[0] ?? codecOptions[0]?.value
      if (!fallbackCodec) return
      setSettings((prev) => ({ ...prev, codec: fallbackCodec as ExportSettings['codec'] }))
    }
  }, [codecOptions, settings.codec])

  useEffect(() => {
    if (!open || view !== 'settings') {
      setPreflight(null)
      return
    }

    if (exportMode === 'video' && supportedVideoCodecs === null && !videoSupportError) {
      setPreflight(null)
      return
    }

    let cancelled = false
    const settingsForPreflight: ExtendedExportSettings = {
      ...settings,
      mode: exportMode,
      videoContainer: exportMode === 'video' ? videoContainer : undefined,
      audioContainer: exportMode === 'audio' ? audioContainer : undefined,
      embedSubtitles:
        exportMode === 'video' && hasTranscriptSubtitles && containerSupportsEmbeddedSubtitles
          ? embedSubtitles
          : false,
      renderWholeProject,
    }

    void assessExportPreflight({
      settings: settingsForPreflight,
      fps,
      composition: preflightComposition,
      durationFrames: exportRange.duration,
      supportedVideoCodecs: supportedVideoCodecs ?? [],
      brokenMediaIds,
    }).then((result) => {
      if (!cancelled) setPreflight(result)
    })

    return () => {
      cancelled = true
    }
  }, [
    audioContainer,
    brokenMediaIds,
    embedSubtitles,
    exportMode,
    exportRange.duration,
    fps,
    hasTranscriptSubtitles,
    containerSupportsEmbeddedSubtitles,
    open,
    preflightComposition,
    renderWholeProject,
    settings,
    supportedVideoCodecs,
    videoContainer,
    videoSupportError,
    view,
  ])

  const preflightBlocksExport =
    preflight?.checks.some((check) => check.severity === 'error') ?? false
  const exportActionsDisabled =
    (exportMode === 'video' && (!hasSupportedVideoPath || isCheckingVideoSupport)) ||
    preflightBlocksExport

  const preventClose = view === 'progress' || view === 'complete'
  const fileSize = clientRender.result?.fileSize

  // Preview blob URL for completed exports
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = clientRender.result?.blob
    if (!blob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [clientRender.result?.blob])

  const isVideoResult = clientRender.result?.mimeType?.startsWith('video/') ?? false

  // Dynamic title and description
  const getTitle = () => {
    switch (view) {
      case 'settings':
        return t('export.dialog.titleSettings')
      case 'progress':
        return (
          <span className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            {t('export.dialog.titleProgress')}
          </span>
        )
      case 'complete':
        return (
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            {t('export.dialog.titleComplete')}
          </span>
        )
      case 'error':
        return (
          <span className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            {t('export.dialog.titleError')}
          </span>
        )
      case 'cancelled':
        return (
          <span className="flex items-center gap-2">
            <X className="h-5 w-5 text-muted-foreground" />
            {t('export.dialog.titleCancelled')}
          </span>
        )
    }
  }

  const getDescription = () => {
    switch (view) {
      case 'settings':
        return t('export.dialog.descSettings')
      case 'progress':
        return t('export.dialog.descProgress')
      case 'complete':
        return t('export.dialog.descComplete')
      case 'error':
        return t('export.dialog.descError')
      case 'cancelled':
        return t('export.dialog.descCancelled')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose} modal>
      <DialogContent
        className={`overflow-hidden ${
          view === 'settings'
            ? 'sm:max-w-[900px]'
            : view === 'complete' && isVideoResult
              ? 'sm:max-w-[640px]'
              : 'sm:max-w-[500px]'
        }`}
        hideCloseButton={preventClose}
        onPointerDownOutside={(e) => preventClose && e.preventDefault()}
        onEscapeKeyDown={(e) => preventClose && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        {/* Settings View */}
        {view === 'settings' && (
          <div className="py-4">
            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-4">
                {/* Export Mode: Video or Audio Toggle Group */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">{t('export.settings.exportType')}</Label>
                  <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
                    <button
                      type="button"
                      onClick={() => setExportMode('video')}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        exportMode === 'video'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Video className="h-3.5 w-3.5" />
                      {t('export.settings.video')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode('audio')}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
                        exportMode === 'audio'
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Music className="h-3.5 w-3.5" />
                      {t('export.settings.audio')}
                    </button>
                  </div>
                </div>

                {/* Export Range Section */}
                <div className="space-y-3 p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Scissors className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {t('export.settings.exportRange')}
                      </span>
                    </div>
                    {hasInOutPoints && (
                      <div className="flex items-center gap-2">
                        <Label htmlFor="render-whole" className="text-xs text-muted-foreground">
                          {t('export.settings.renderWholeProject')}
                        </Label>
                        <Switch
                          id="render-whole"
                          checked={renderWholeProject}
                          onCheckedChange={setRenderWholeProject}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground mb-0.5">
                        {t('export.settings.in')}
                      </div>
                      <div className="font-mono text-foreground">
                        {formatTimecode(exportRange.start, fps)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-0.5">
                        {t('export.settings.out')}
                      </div>
                      <div className="font-mono text-foreground">
                        {formatTimecode(exportRange.end, fps)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-0.5">
                        {t('export.settings.duration')}
                      </div>
                      <div className="font-mono text-foreground">
                        {formatTime(framesToSeconds(exportRange.duration, fps))}
                      </div>
                    </div>
                  </div>
                  {hasInOutPoints && !renderWholeProject && (
                    <p className="text-xs text-muted-foreground">
                      {t('export.settings.inOutRangeHint')}
                    </p>
                  )}
                </div>

                <ExportPreflightPanel preflight={preflight} />
              </div>

              <div className="space-y-5 min-w-0">
                {/* Video Export Settings */}
                {exportMode === 'video' && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{t('export.settings.presetLabel')}</Label>
                        {activePresetId === null && (
                          <span className="text-xs text-muted-foreground">
                            {t('export.settings.presetCustom')}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {EXPORT_PRESETS.map((preset) => {
                          const isActive = activePresetId === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => applyPreset(preset)}
                              aria-pressed={isActive}
                              className={`rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                                isActive
                                  ? 'border-primary bg-primary/10 text-foreground'
                                  : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                              }`}
                            >
                              {t(preset.labelKey)}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {!isCheckingVideoSupport && videoSupportError && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            {t('export.settings.codecSupportUnverified')}
                          </AlertDescription>
                        </Alert>
                      )}

                      {!isCheckingVideoSupport && !videoSupportError && !hasSupportedVideoPath && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            {t('export.settings.cannotEncode', {
                              width: settings.resolution.width,
                              height: settings.resolution.height,
                            })}
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="container">{t('export.settings.format')}</Label>
                          <Select
                            value={videoContainer}
                            onValueChange={(v) => setVideoContainer(v as ClientVideoContainer)}
                          >
                            <SelectTrigger id="container">
                              <SelectValue placeholder={t('export.settings.selectFormat')} />
                            </SelectTrigger>
                            <SelectContent>
                              {videoContainerOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  disabled={!option.supported}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="codec">{t('export.settings.codec')}</Label>
                          <Select
                            value={settings.codec}
                            onValueChange={(value) =>
                              setSettings({ ...settings, codec: value as ExportSettings['codec'] })
                            }
                          >
                            <SelectTrigger id="codec">
                              <SelectValue placeholder={t('export.settings.selectCodec')} />
                            </SelectTrigger>
                            <SelectContent>
                              {codecOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                  disabled={!option.supported}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="quality">{t('export.settings.quality')}</Label>
                          <Select
                            value={settings.quality}
                            onValueChange={(value) =>
                              setSettings({
                                ...settings,
                                quality: value as ExportSettings['quality'],
                              })
                            }
                          >
                            <SelectTrigger id="quality">
                              <SelectValue placeholder={t('export.settings.selectQuality')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">{t('export.settings.qualityLow')}</SelectItem>
                              <SelectItem value="medium">
                                {t('export.settings.qualityMedium')}
                              </SelectItem>
                              <SelectItem value="high">
                                {t('export.settings.qualityHigh')}
                              </SelectItem>
                              <SelectItem value="ultra">
                                {t('export.settings.qualityUltra')}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="resolution">{t('export.settings.resolution')}</Label>
                          <Select
                            value={`${settings.resolution.width}x${settings.resolution.height}`}
                            onValueChange={(value) => {
                              const parts = value.split('x').map(Number)
                              const width = parts[0] ?? projectWidth
                              const height = parts[1] ?? projectHeight
                              setSettings({ ...settings, resolution: { width, height } })
                            }}
                          >
                            <SelectTrigger id="resolution">
                              <SelectValue placeholder={t('export.settings.selectResolution')} />
                            </SelectTrigger>
                            <SelectContent>
                              {resolutionOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
                        <div className="space-y-1">
                          <Label htmlFor="embed-subtitles" className="text-sm font-medium">
                            {t('export.settings.embedSubtitles')}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {t('export.settings.embedSubtitlesDescription')}
                          </p>
                          {hasTranscriptSubtitles && !containerSupportsEmbeddedSubtitles && (
                            <p className="text-xs text-muted-foreground">
                              {t('export.settings.embedSubtitlesUnsupported', {
                                container: videoContainer.toUpperCase(),
                              })}
                            </p>
                          )}
                          {embedSubtitles &&
                            hasTranscriptSubtitles &&
                            containerSupportsEmbeddedSubtitles &&
                            videoContainer === 'mp4' && (
                              <p className="text-xs text-muted-foreground">
                                {t('export.settings.embedSubtitlesMp4Note')}
                              </p>
                            )}
                          {!hasTranscriptSubtitles && (
                            <p className="text-xs text-muted-foreground">
                              {t('export.settings.noTranscriptSegments')}
                            </p>
                          )}
                        </div>
                        <Switch
                          id="embed-subtitles"
                          checked={embedSubtitles && containerSupportsEmbeddedSubtitles}
                          disabled={!hasTranscriptSubtitles || !containerSupportsEmbeddedSubtitles}
                          onCheckedChange={setEmbedSubtitles}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Audio Export Settings */}
                {exportMode === 'audio' && (
                  <div className="space-y-4">
                    <Alert>
                      <Music className="h-4 w-4" />
                      <AlertDescription>{t('export.settings.audioOnlyNote')}</AlertDescription>
                    </Alert>

                    <div className="space-y-2">
                      <Label htmlFor="audio-format">{t('export.settings.format')}</Label>
                      <Select
                        value={audioContainer}
                        onValueChange={(v) => setAudioContainer(v as ClientAudioContainer)}
                      >
                        <SelectTrigger id="audio-format">
                          <SelectValue placeholder={t('export.settings.selectFormat')} />
                        </SelectTrigger>
                        <SelectContent>
                          {getAudioContainerOptions().map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span>{option.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {option.description}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="audio-quality">{t('export.settings.quality')}</Label>
                      <Select
                        value={settings.quality}
                        onValueChange={(value) =>
                          setSettings({ ...settings, quality: value as ExportSettings['quality'] })
                        }
                      >
                        <SelectTrigger id="audio-quality">
                          <SelectValue placeholder={t('export.settings.selectQuality')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">
                            {t('export.settings.audioQualityLow')}
                          </SelectItem>
                          <SelectItem value="medium">
                            {t('export.settings.audioQualityMedium')}
                          </SelectItem>
                          <SelectItem value="high">
                            {t('export.settings.audioQualityHigh')}
                          </SelectItem>
                          <SelectItem value="ultra">
                            {t('export.settings.audioQualityUltra')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5" disabled={exportActionsDisabled}>
                    <ListPlus className="h-4 w-4" />
                    {t('export.renderQueue.addToQueue')}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleAddCurrentRange}>
                    {t('export.renderQueue.addCurrentRange')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {t('export.renderQueue.segmentsHeading')}
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleAddMarkerSegments}>
                    {t('export.renderQueue.perMarker')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSplitChunks(10)}>
                    {t('export.renderQueue.splitChunks', { seconds: 10 })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSplitChunks(30)}>
                    {t('export.renderQueue.splitChunks', { seconds: 30 })}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleSplitChunks(60)}>
                    {t('export.renderQueue.splitChunks', { seconds: 60 })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={handleStartExport} disabled={exportActionsDisabled}>
                {exportMode === 'audio'
                  ? t('export.settings.exportAudio')
                  : t('export.settings.exportVideo')}
              </Button>
            </div>
          </div>
        )}

        {/* Progress View */}
        {view === 'progress' && (
          <div className="space-y-4 py-4 overflow-hidden">
            <div className="space-y-4 min-w-0">
              <div className="space-y-2 min-w-0">
                <div className="w-full overflow-hidden">
                  <Progress value={progress} className="h-2 w-full" />
                </div>
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="text-muted-foreground truncate">
                    {status === 'preparing' && t('export.progress.preparing')}
                    {status === 'rendering' && t('export.progress.rendering')}
                    {status === 'encoding' && t('export.progress.encoding')}
                    {status === 'finalizing' && t('export.progress.finalizing')}
                  </span>
                  <span className="font-medium tabular-nums flex-shrink-0">
                    {Math.round(progress)}%
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {renderedFrames !== undefined && totalFrames !== undefined && (
                  <div className="flex items-center gap-2 text-sm">
                    <Film className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">
                      {t('export.progress.framesLabel')}
                    </span>
                    <span className="font-medium tabular-nums">
                      {renderedFrames}/{totalFrames}
                    </span>
                  </div>
                )}
                {elapsedSeconds > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">
                      {t('export.progress.elapsedLabel')}
                    </span>
                    <span className="font-medium tabular-nums">{formatTime(elapsedSeconds)}</span>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">{t('export.progress.keepTabOpen')}</p>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={cancelExport}>
                {t('export.progress.cancelExport')}
              </Button>
            </div>
          </div>
        )}

        {/* Complete View */}
        {view === 'complete' && (
          <div className="space-y-4 py-4">
            {previewUrl && <ExportPreviewPlayer src={previewUrl} isVideo={isVideoResult} />}

            <Alert className="border-green-900 bg-green-950">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription className="text-green-400">
                {exportMode === 'audio'
                  ? t('export.complete.audioSuccess')
                  : t('export.complete.videoSuccess')}
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {fileSize && (
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {t('export.complete.fileSizeLabel')}
                  </span>
                  <span className="font-medium">{formatFileSize(fileSize)}</span>
                </div>
              )}
              {elapsedSeconds > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {t('export.complete.timeTakenLabel')}
                  </span>
                  <span className="font-medium">{formatTime(elapsedSeconds)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t('common.close')}
              </Button>
              <Button onClick={downloadVideo}>
                <Download className="mr-2 h-4 w-4" />
                {t('export.complete.download')}
              </Button>
            </div>
          </div>
        )}

        {/* Error View */}
        {view === 'error' && (
          <div className="space-y-4 py-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button variant="outline" onClick={handleClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}

        {/* Cancelled View */}
        {view === 'cancelled' && (
          <div className="space-y-4 py-4">
            <Alert>
              <X className="h-4 w-4" />
              <AlertDescription>{t('export.cancelled.message')}</AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button variant="outline" onClick={handleClose}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
