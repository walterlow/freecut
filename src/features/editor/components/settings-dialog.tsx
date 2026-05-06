import { useState, useCallback } from 'react'
import type { MediaMetadata } from '@/types/storage'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import {
  RotateCcw,
  Trash2,
  Loader2,
  Check,
  ImagePlus,
  Film,
  TriangleAlert,
  Settings2,
  Rows3,
  HardDrive,
  Sparkles,
} from 'lucide-react'
import {
  LocalInferenceUnloadControl,
  LocalModelCacheControl,
  useSettingsStore,
  CAPTIONING_INTERVAL_BOUNDS,
  DEFAULT_CAPTIONING_INTERVAL_SECONDS,
  resolveCaptioningIntervalSec,
  type CaptioningIntervalUnit,
} from '@/features/editor/deps/settings'
import {
  useMediaLibraryStore,
  getSharedProxyKey,
  importProxyService,
  importMediaLibraryService,
  importThumbnailGenerator,
} from '@/features/editor/deps/media-library'
import {
  importGifFrameCache,
  importFilmstripCache,
  importWaveformCache,
} from '@/features/editor/deps/timeline-cache'
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'
import { EDITOR_DENSITY_OPTIONS } from '@/app/editor-layout'

const log = createLogger('SettingsDialog')

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'timeline', label: 'Timeline', icon: Rows3 },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'storage', label: 'Storage', icon: HardDrive },
] as const

const ESTIMATE_REFERENCE_DURATION_SEC = 60
const ESTIMATE_REFERENCE_FPS = 30

function formatCaptionEstimate(unit: CaptioningIntervalUnit, value: number): string {
  const intervalSec = resolveCaptioningIntervalSec(unit, value, ESTIMATE_REFERENCE_FPS)
  if (intervalSec <= 0) {
    return 'Enter an interval above zero.'
  }
  const sceneCount = Math.max(1, Math.round(ESTIMATE_REFERENCE_DURATION_SEC / intervalSec))
  return `~${sceneCount} ${sceneCount === 1 ? 'scene' : 'scenes'} per 1-min clip at ${ESTIMATE_REFERENCE_FPS}fps`
}

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface BatchActionResult {
  total: number
  succeeded: number
  failed: number
  failedItems: string[]
}

interface ActionFeedback {
  tone: 'success' | 'error'
  message: string
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function formatFailedItems(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length <= 2) return items.join(', ')
  return `${items.slice(0, 2).join(', ')}, +${items.length - 2} more`
}

function createBatchResult(total: number, failedItems: string[]): BatchActionResult {
  return {
    total,
    succeeded: Math.max(0, total - failedItems.length),
    failed: failedItems.length,
    failedItems,
  }
}

function getBatchOutcomeFeedback(actionLabel: string, result: BatchActionResult): ActionFeedback {
  if (result.total === 0) {
    return {
      tone: 'success',
      message: `No project media to ${actionLabel.toLowerCase()}.`,
    }
  }

  if (result.failed === 0) {
    return {
      tone: 'success',
      message: `${actionLabel} completed for ${formatCount(result.succeeded, 'item')}.`,
    }
  }

  const failedLabel = formatFailedItems(result.failedItems)

  if (result.succeeded === 0) {
    return {
      tone: 'error',
      message: `Couldn't ${actionLabel.toLowerCase()} ${formatCount(result.failed, 'item')}${failedLabel ? `: ${failedLabel}` : '.'}`,
    }
  }

  return {
    tone: 'error',
    message: `${actionLabel} completed for ${result.succeeded}/${result.total} items. Needs attention: ${failedLabel}.`,
  }
}

function showBatchOutcomeToast(
  successTitle: string,
  partialTitle: string,
  failureTitle: string,
  result: BatchActionResult,
): void {
  if (result.total === 0) {
    toast.success(successTitle, {
      description: 'No project media needed updating.',
    })
    return
  }

  if (result.failed === 0) {
    toast.success(successTitle, {
      description: `${formatCount(result.succeeded, 'item')} updated.`,
    })
    return
  }

  const description =
    result.succeeded === 0
      ? formatFailedItems(result.failedItems)
      : `${formatCount(result.succeeded, 'item')} updated. Failed: ${formatFailedItems(result.failedItems)}`

  toast.error(result.succeeded === 0 ? failureTitle : partialTitle, {
    description,
  })
}

/**
 * Clear regenerable cache data for the current project's media only.
 * Clears filmstrips, waveforms, GIF frames, and decoded audio
 * scoped to the given media IDs.
 *
 * Does NOT clear thumbnails (not auto-regenerated) or proxies (separate action).
 */
async function clearProjectCaches(
  mediaItems: Array<Pick<MediaMetadata, 'id' | 'fileName'>>,
): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const [
    { deleteWaveform, deleteGifFrames, deleteDecodedPreviewAudio },
    { deletePreviewAudioConform },
    { gifFrameCache },
    { filmstripCache },
    { waveformCache },
  ] = await Promise.all([
    import('@/infrastructure/storage'),
    import('@/features/editor/deps/composition-runtime'),
    importGifFrameCache(),
    importFilmstripCache(),
    importWaveformCache(),
  ])

  // Clear in-memory preview audio cache (not keyed per-media, so clear all)
  clearPreviewAudioCache()

  const failedItems: string[] = []

  await Promise.all(
    mediaItems.map(async ({ id, fileName }) => {
      const results = await Promise.allSettled([
        deleteWaveform(id),
        deleteGifFrames(id),
        deleteDecodedPreviewAudio(id),
        deletePreviewAudioConform(id, { clearMetadata: true }),
        gifFrameCache.clearMedia(id),
        filmstripCache.clearMedia(id),
        waveformCache.clearMedia(id),
      ])

      const failures = results.filter((result) => result.status === 'rejected')
      if (failures.length > 0) {
        log.warn('Failed to fully clear project cache for media item', {
          mediaId: id,
          fileName,
          failures: failures.map((result) => String(result.reason)),
        })
        failedItems.push(fileName)
      }
    }),
  )

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Cleared caches for ${result.succeeded}/${result.total} media items`)
  return result
}

/** Delete all proxy videos for the given media items and clear their store status. */
async function clearProjectProxies(mediaItems: MediaMetadata[]): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const { proxyService } = await importProxyService()
  const failedItems: string[] = []

  await Promise.all(
    mediaItems.map(async (media) => {
      try {
        await proxyService.deleteProxy(media.id, getSharedProxyKey(media))
        useMediaLibraryStore.getState().clearProxyStatus(media.id)
        proxyService.clearProxyKey(media.id)
      } catch (error) {
        log.warn('Failed to clear proxy for media item', {
          mediaId: media.id,
          fileName: media.fileName,
          error,
        })
        failedItems.push(media.fileName)
      }
    }),
  )

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Cleared proxies for ${result.succeeded}/${result.total} media items`)
  return result
}

/**
 * Regenerate thumbnails for all media in the current project.
 * Fetches each media file, generates a new thumbnail, and saves it to workspace storage.
 */
async function regenerateProjectThumbnails(
  mediaItems: Array<{ id: string; fileName: string; mimeType: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<BatchActionResult> {
  if (mediaItems.length === 0) return createBatchResult(0, [])

  const [{ mediaLibraryService }, { generateThumbnail }, { saveThumbnail, updateMedia }] =
    await Promise.all([
      importMediaLibraryService(),
      importThumbnailGenerator(),
      import('@/infrastructure/storage'),
    ])

  let succeeded = 0
  const failedItems: string[] = []

  for (const media of mediaItems) {
    try {
      const blob = await mediaLibraryService.getMediaFile(media.id)
      if (!blob) continue

      // generateThumbnail expects a File (needs .name for extension-based mime detection)
      const file = new File([blob], media.fileName, { type: media.mimeType })
      const thumbnailBlob = await generateThumbnail(file)

      const thumbnailId = crypto.randomUUID()
      await saveThumbnail({
        id: thumbnailId,
        mediaId: media.id,
        blob: thumbnailBlob,
        timestamp: 1,
        width: 320,
        height: 180,
      })

      // Update the media record so the new thumbnailId propagates to the store
      await updateMedia(media.id, { thumbnailId })

      // Clear the in-memory blob URL cache so UI picks up the new thumbnail
      mediaLibraryService.clearThumbnailCache(media.id)
      succeeded++
    } catch (err) {
      log.warn(`Failed to regenerate thumbnail for ${media.fileName}:`, err)
      failedItems.push(media.fileName)
    }
    onProgress?.(succeeded + failedItems.length, mediaItems.length)
  }

  // Reload store so MediaCards see the updated thumbnailId and re-fetch
  await useMediaLibraryStore.getState().loadMediaItems()

  const result = createBatchResult(mediaItems.length, failedItems)
  log.info(`Regenerated ${result.succeeded}/${result.total} thumbnails`)
  return result
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const snapEnabled = useSettingsStore((s) => s.snapEnabled)
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval)
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory)
  const captioningIntervalUnit = useSettingsStore((s) => s.captioningIntervalUnit)
  const captioningIntervalValue = useSettingsStore((s) => s.captioningIntervalValue)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults)

  const intervalBounds = CAPTIONING_INTERVAL_BOUNDS[captioningIntervalUnit]
  const intervalInputStep = captioningIntervalUnit === 'seconds' ? 0.5 : 1
  const intervalUnitLabel = captioningIntervalUnit === 'seconds' ? 'sec' : 'frames'

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general')
  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done' | 'partial'>('idle')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [regenState, setRegenState] = useState<'idle' | 'working' | 'done' | 'partial'>('idle')
  const [regenProgress, setRegenProgress] = useState('')
  const [proxyState, setProxyState] = useState<'idle' | 'clearing' | 'done' | 'partial'>('idle')
  const [proxyGenerateState, setProxyGenerateState] = useState<'idle' | 'queueing' | 'done'>('idle')
  const [clearFeedback, setClearFeedback] = useState<ActionFeedback | null>(null)
  const [regenFeedback, setRegenFeedback] = useState<ActionFeedback | null>(null)
  const [proxyFeedback, setProxyFeedback] = useState<ActionFeedback | null>(null)

  const handleClearCache = useCallback(async () => {
    setClearState('clearing')
    try {
      const items = mediaItems.map((m) => ({ id: m.id, fileName: m.fileName }))
      const result = await clearProjectCaches(items)
      const feedback = getBatchOutcomeFeedback('Clear Cache', result)
      setClearFeedback(feedback)
      setClearState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        'Project cache cleared',
        'Project cache partially cleared',
        'Project cache not cleared',
        result,
      )
      setTimeout(() => setClearState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear caches', err)
      setClearFeedback({
        tone: 'error',
        message: "Couldn't clear project cache.",
      })
      toast.error('Failed to clear project cache')
      setClearState('idle')
    }
  }, [mediaItems])

  const handleRegenThumbnails = useCallback(async () => {
    setRegenState('working')
    setRegenProgress('0/' + mediaItems.length)
    try {
      const items = mediaItems.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        mimeType: m.mimeType,
      }))
      const result = await regenerateProjectThumbnails(items, (done, total) => {
        setRegenProgress(`${done}/${total}`)
      })
      const feedback = getBatchOutcomeFeedback('Regenerate Thumbnails', result)
      setRegenFeedback(feedback)
      setRegenState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        'Thumbnails regenerated',
        'Thumbnails partially regenerated',
        'Thumbnails not regenerated',
        result,
      )
      setTimeout(() => {
        setRegenState('idle')
        setRegenProgress('')
      }, 2000)
    } catch (err) {
      log.error('Failed to regenerate thumbnails', err)
      setRegenFeedback({
        tone: 'error',
        message: "Couldn't regenerate thumbnails.",
      })
      toast.error('Failed to regenerate thumbnails')
      setRegenState('idle')
      setRegenProgress('')
    }
  }, [mediaItems])

  const handleClearProxies = useCallback(async () => {
    setProxyState('clearing')
    try {
      const result = await clearProjectProxies(mediaItems)
      const feedback = getBatchOutcomeFeedback('Delete Proxies', result)
      setProxyFeedback(feedback)
      setProxyState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        'Proxies deleted',
        'Proxies partially deleted',
        'Proxies not deleted',
        result,
      )
      setTimeout(() => setProxyState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear proxies', err)
      setProxyFeedback({
        tone: 'error',
        message: "Couldn't delete proxies.",
      })
      toast.error('Failed to delete proxies')
      setProxyState('idle')
    }
  }, [mediaItems])

  const handleGenerateMissingProxies = useCallback(async () => {
    setProxyGenerateState('queueing')

    try {
      const [{ proxyService }, { mediaLibraryService }] = await Promise.all([
        importProxyService(),
        importMediaLibraryService(),
      ])

      const queuedItems = mediaItems.filter((media) => {
        if (!proxyService.canGenerateProxy(media.mimeType)) {
          return false
        }

        const sharedProxyKey = getSharedProxyKey(media)
        if (proxyService.hasProxy(media.id, sharedProxyKey)) {
          return false
        }

        const status = useMediaLibraryStore.getState().proxyStatus.get(media.id)
        return status !== 'ready' && status !== 'generating'
      })

      queuedItems.forEach((media) => {
        const sharedProxyKey = getSharedProxyKey(media)
        proxyService.setProxyKey(media.id, sharedProxyKey)
        proxyService.generateProxy(
          media.id,
          media.storageType === 'opfs' && media.opfsPath
            ? { kind: 'opfs', path: media.opfsPath, mimeType: media.mimeType }
            : () => mediaLibraryService.getMediaFile(media.id),
          media.width,
          media.height,
          sharedProxyKey,
          { priority: 'background' },
        )
      })

      setProxyGenerateState('done')
      setTimeout(() => setProxyGenerateState('idle'), 2000)
    } catch (err) {
      log.error('Failed to queue missing proxies', err)
      setProxyGenerateState('idle')
    }
  }, [mediaItems])

  const missingProjectProxyCount = mediaItems.filter(
    (media) =>
      media.mimeType.startsWith('video/') &&
      proxyStatus.get(media.id) !== 'ready' &&
      proxyStatus.get(media.id) !== 'generating',
  ).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:top-16 sm:max-h-[calc(100vh-4rem)] sm:translate-y-0 sm:origin-top">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-6 py-4 pr-14">
          <DialogTitle>Editor Settings</DialogTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetToDefaults}
            className="h-8 shrink-0 gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </DialogHeader>
        <div className="flex min-h-0">
          {/* Sidebar */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-white/6 p-2">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-out motion-reduce:transition-none',
                    activeSection === section.id
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {section.label}
                </button>
              )
            })}
          </nav>

          {/* Content */}
          <ScrollArea className="max-h-[70vh] min-h-[360px] flex-1">
            <div className="space-y-3 px-6 py-5 pr-7">
              {activeSection === 'general' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Editor Density</Label>
                    <Select
                      value={editorDensity}
                      onValueChange={(value) =>
                        setSetting('editorDensity', value as typeof editorDensity)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EDITOR_DENSITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Compact fits more of the editor into a 1080p screen. Default restores the
                      roomier layout.
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Auto-save</Label>
                    <Switch
                      checked={autoSaveInterval > 0}
                      onCheckedChange={(v) => setSetting('autoSaveInterval', v ? 5 : 0)}
                    />
                  </div>
                  {autoSaveInterval > 0 && (
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">Interval</Label>
                      <div className="w-32 flex items-center gap-2">
                        <Slider
                          value={[autoSaveInterval]}
                          onValueChange={([v]) => setSetting('autoSaveInterval', v || 5)}
                          min={5}
                          max={30}
                          step={5}
                        />
                        <span className="text-xs text-muted-foreground w-6">
                          {autoSaveInterval}m
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Undo History Depth</Label>
                    <div className="w-32 flex items-center gap-2">
                      <Slider
                        value={[maxUndoHistory]}
                        onValueChange={([v]) => setSetting('maxUndoHistory', v || 10)}
                        min={10}
                        max={200}
                        step={10}
                      />
                      <span className="text-xs text-muted-foreground w-6">{maxUndoHistory}</span>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'ai' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Caption sample interval</Label>
                        <p className="text-xs text-muted-foreground">
                          How often Analyze with AI samples a frame for captioning.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-md border border-border bg-secondary p-0.5">
                        {(['seconds', 'frames'] as const).map((unit) => (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setSetting('captioningIntervalUnit', unit)}
                            className={cn(
                              'rounded px-2.5 py-1 text-xs transition-colors',
                              captioningIntervalUnit === unit
                                ? 'bg-primary/15 text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {unit === 'seconds' ? 'Seconds' : 'Frames'}
                          </button>
                        ))}
                      </div>
                      <Input
                        type="number"
                        inputMode="decimal"
                        className="h-8 w-24"
                        min={intervalBounds.min}
                        max={intervalBounds.max}
                        step={intervalInputStep}
                        value={captioningIntervalValue}
                        onChange={(event) => {
                          const parsed = Number(event.target.value)
                          if (Number.isFinite(parsed)) {
                            setSetting('captioningIntervalValue', parsed)
                          }
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{intervalUnitLabel}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => {
                          setSetting('captioningIntervalUnit', 'seconds')
                          setSetting('captioningIntervalValue', DEFAULT_CAPTIONING_INTERVAL_SECONDS)
                        }}
                        disabled={
                          captioningIntervalUnit === 'seconds' &&
                          captioningIntervalValue === DEFAULT_CAPTIONING_INTERVAL_SECONDS
                        }
                      >
                        Reset
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatCaptionEstimate(captioningIntervalUnit, captioningIntervalValue)}.
                      Smaller intervals produce denser scenes but take longer to generate.
                    </p>
                  </div>
                </div>
              )}

              {activeSection === 'timeline' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Snap by Default</Label>
                      <p className="text-xs text-muted-foreground">
                        Sets the initial snap state when a project opens.
                      </p>
                    </div>
                    <Switch
                      checked={snapEnabled}
                      onCheckedChange={(v) => setSetting('snapEnabled', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Show Waveforms</Label>
                    <Switch
                      checked={showWaveforms}
                      onCheckedChange={(v) => setSetting('showWaveforms', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Show Filmstrips</Label>
                    <Switch
                      checked={showFilmstrips}
                      onCheckedChange={(v) => setSetting('showFilmstrips', v)}
                    />
                  </div>
                </div>
              )}

              {activeSection === 'storage' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Generate Missing Proxies</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Queue proxy generation for video in this project that does not have one yet
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={handleGenerateMissingProxies}
                      disabled={proxyGenerateState !== 'idle' || missingProjectProxyCount === 0}
                    >
                      {proxyGenerateState === 'queueing' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      {proxyGenerateState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {proxyGenerateState === 'idle' && <Film className="w-3.5 h-3.5" />}
                      {proxyGenerateState === 'queueing'
                        ? 'Queueing...'
                        : proxyGenerateState === 'done'
                          ? 'Queued'
                          : missingProjectProxyCount > 0
                            ? `Generate (${missingProjectProxyCount})`
                            : 'Up to date'}
                    </Button>
                  </div>
                  <Separator className="bg-white/8" />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Clear Project Cache</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Waveforms, filmstrips, GIF frames, decoded audio
                      </p>
                      {clearFeedback && (
                        <p
                          className={cn(
                            'mt-1 text-xs',
                            clearFeedback.tone === 'error'
                              ? 'text-amber-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {clearFeedback.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={() => setShowClearConfirm(true)}
                      disabled={clearState !== 'idle'}
                    >
                      {clearState === 'clearing' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      {clearState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {clearState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                      {clearState === 'idle' && <Trash2 className="w-3.5 h-3.5" />}
                      {clearState === 'clearing'
                        ? 'Clearing...'
                        : clearState === 'done'
                          ? 'Cleared'
                          : clearState === 'partial'
                            ? 'Partial'
                            : 'Clear'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Regenerate Thumbnails</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Re-create media library thumbnails for this project
                      </p>
                      {regenFeedback && (
                        <p
                          className={cn(
                            'mt-1 text-xs',
                            regenFeedback.tone === 'error'
                              ? 'text-amber-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {regenFeedback.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={handleRegenThumbnails}
                      disabled={regenState !== 'idle'}
                    >
                      {regenState === 'working' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {regenState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {regenState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                      {regenState === 'idle' && <ImagePlus className="w-3.5 h-3.5" />}
                      {regenState === 'working'
                        ? regenProgress
                        : regenState === 'done'
                          ? 'Done'
                          : regenState === 'partial'
                            ? 'Partial'
                            : 'Regenerate'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Delete Proxies</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Remove generated proxy videos for this project
                      </p>
                      {proxyFeedback && (
                        <p
                          className={cn(
                            'mt-1 text-xs',
                            proxyFeedback.tone === 'error'
                              ? 'text-amber-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {proxyFeedback.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={handleClearProxies}
                      disabled={proxyState !== 'idle'}
                    >
                      {proxyState === 'clearing' && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      )}
                      {proxyState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {proxyState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                      {proxyState === 'idle' && <Film className="w-3.5 h-3.5" />}
                      {proxyState === 'clearing'
                        ? 'Deleting...'
                        : proxyState === 'done'
                          ? 'Deleted'
                          : proxyState === 'partial'
                            ? 'Partial'
                            : 'Delete'}
                    </Button>
                  </div>
                  <Separator className="bg-white/8" />
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-sm">Local AI</Label>
                      <p className="text-xs text-muted-foreground">
                        Unload resident runtimes or clear cached model downloads.
                      </p>
                    </div>
                    <LocalInferenceUnloadControl />
                    <LocalModelCacheControl />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear project cache?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete cached waveforms, filmstrips, GIF frames, and decoded audio for the
              current project ({mediaItems.length} media items). These will be regenerated
              automatically when needed. Your project data, media files, thumbnails, and proxies
              will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleClearCache()
              }}
            >
              Clear Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
