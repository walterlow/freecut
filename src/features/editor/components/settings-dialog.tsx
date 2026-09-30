import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/shared/hooks/use-prefers-reduced-motion'
import type { TFunction } from 'i18next'
import type { MediaMetadata } from '@/types/storage'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
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
  Play,
  ArrowLeft,
  X,
} from 'lucide-react'
import {
  LocalInferenceUnloadControl,
  LocalModelCacheControl,
  AiProviderSettings,
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
import { CAPTION_STYLE_PRESETS } from '@/shared/typography/caption-style-presets'
import * as SelectPrimitive from '@radix-ui/react-select'
import { useUiSoundStore } from '@/shared/state/ui-sound-store'
import { emitUiSound, previewUiSound } from '@/shared/ui/ui-sound'
import { VOICE_OPTIONS, type VoiceName } from '@/infrastructure/audio/ui-sound'
import { Select, SelectContent, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'

const log = createLogger('SettingsDialog')

const SETTINGS_SECTIONS = [
  { id: 'general', labelKey: 'settings.sections.general', defaultLabel: 'General', icon: Settings2 },
  { id: 'timeline', labelKey: 'settings.sections.timeline', defaultLabel: 'Línea de tiempo', icon: Rows3 },
  { id: 'ai', labelKey: 'settings.sections.ai', defaultLabel: 'IA (Ollama, ComfyUI, Modelos)', icon: Sparkles },
  { id: 'storage', labelKey: 'settings.sections.storage', defaultLabel: 'Almacenamiento y Caché', icon: HardDrive },
] as const

const ESTIMATE_REFERENCE_DURATION_SEC = 60
const ESTIMATE_REFERENCE_FPS = 30

function formatCaptionEstimate(t: TFunction, unit: CaptioningIntervalUnit, value: number): string {
  const intervalSec = resolveCaptioningIntervalSec(unit, value, ESTIMATE_REFERENCE_FPS)
  if (intervalSec <= 0) {
    return t('settings.ai.enterIntervalAboveZero')
  }
  const sceneCount = Math.max(1, Math.round(ESTIMATE_REFERENCE_DURATION_SEC / intervalSec))
  return t('settings.ai.captionEstimate', {
    sceneCount,
    scenes: t('settings.ai.scene', { count: sceneCount }),
    fps: ESTIMATE_REFERENCE_FPS,
  })
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

type BatchActionId = 'clearCache' | 'regenerateThumbnails' | 'deleteProxies'

const BATCH_ACTION_LABEL_KEYS = {
  clearCache: 'settings.feedback.actionClearCache',
  regenerateThumbnails: 'settings.feedback.actionRegenerateThumbnails',
  deleteProxies: 'settings.feedback.actionDeleteProxies',
} as const satisfies Record<BatchActionId, string>

function formatFailedItems(t: TFunction, items: string[]): string {
  if (items.length === 0) return ''
  if (items.length <= 2) return items.join(', ')
  return t('settings.feedback.moreItems', {
    items: items.slice(0, 2).join(', '),
    count: items.length - 2,
  })
}

function createBatchResult(total: number, failedItems: string[]): BatchActionResult {
  return {
    total,
    succeeded: Math.max(0, total - failedItems.length),
    failed: failedItems.length,
    failedItems,
  }
}

function getBatchOutcomeFeedback(
  t: TFunction,
  action: BatchActionId,
  result: BatchActionResult,
): ActionFeedback {
  const actionLabel = t(BATCH_ACTION_LABEL_KEYS[action])

  if (result.total === 0) {
    return { tone: 'success', message: t('settings.feedback.noMediaNeededUpdating') }
  }

  if (result.failed === 0) {
    return {
      tone: 'success',
      message: t('settings.feedback.completedForItems', {
        count: result.succeeded,
        action: actionLabel,
      }),
    }
  }

  const failedLabel = formatFailedItems(t, result.failedItems)

  if (result.succeeded === 0) {
    return {
      tone: 'error',
      message: t('settings.feedback.couldntProcessItems', {
        count: result.failed,
        action: actionLabel,
        detail: failedLabel ? `: ${failedLabel}` : '.',
      }),
    }
  }

  return {
    tone: 'error',
    message: t('settings.feedback.partialOutcome', {
      action: actionLabel,
      succeeded: result.succeeded,
      total: result.total,
      failed: failedLabel,
    }),
  }
}

function showBatchOutcomeToast(
  t: TFunction,
  titles: { success: string; partial: string; failure: string },
  result: BatchActionResult,
): void {
  if (result.total === 0) {
    toast.success(titles.success, { description: t('settings.feedback.noMediaNeededUpdating') })
    return
  }

  if (result.failed === 0) {
    toast.success(titles.success, {
      description: t('settings.toasts.itemsUpdated', { count: result.succeeded }),
    })
    return
  }

  const description =
    result.succeeded === 0
      ? formatFailedItems(t, result.failedItems)
      : t('settings.toasts.itemsUpdatedFailed', {
          count: result.succeeded,
          failed: formatFailedItems(t, result.failedItems),
        })

  toast.error(result.succeeded === 0 ? titles.failure : titles.partial, { description })
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
  const { t } = useTranslation()
  const snapEnabled = useSettingsStore((s) => s.snapEnabled)
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const enableFilmstripExtraction = useSettingsStore((s) => s.enableFilmstripExtraction)
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval)
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory)
  const captioningIntervalUnit = useSettingsStore((s) => s.captioningIntervalUnit)
  const captioningIntervalValue = useSettingsStore((s) => s.captioningIntervalValue)
  const defaultCaptionStylePresetId = useSettingsStore((s) => s.defaultCaptionStylePresetId)
  const setSetting = useSettingsStore((s) => s.setSetting)
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults)
  const uiSoundsEnabled = useUiSoundStore((s) => s.enabled)
  const uiSoundVolume = useUiSoundStore((s) => s.volume)
  const uiSoundVoice = useUiSoundStore((s) => s.voice)
  const setUiSoundEnabled = useUiSoundStore((s) => s.setEnabled)
  const setUiSoundVolume = useUiSoundStore((s) => s.setVolume)
  const setUiSoundVoice = useUiSoundStore((s) => s.setVoice)

  const intervalBounds = CAPTIONING_INTERVAL_BOUNDS[captioningIntervalUnit]
  const intervalInputStep = captioningIntervalUnit === 'seconds' ? 0.5 : 1
  const intervalUnitLabel =
    captioningIntervalUnit === 'seconds' ? t('settings.ai.unitSec') : t('settings.ai.unitFrames')

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus)

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general')

  const reduceMotion = usePrefersReducedMotion()

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
      const feedback = getBatchOutcomeFeedback(t, 'clearCache', result)
      setClearFeedback(feedback)
      setClearState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.projectCacheCleared'),
          partial: t('settings.toasts.projectCachePartiallyCleared'),
          failure: t('settings.toasts.projectCacheNotCleared'),
        },
        result,
      )
      setTimeout(() => setClearState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear caches', err)
      setClearFeedback({ tone: 'error', message: t('settings.feedback.couldntClearCache') })
      toast.error(t('settings.toasts.failedToClearCache'))
      setClearState('idle')
    }
  }, [mediaItems, t])

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
      const feedback = getBatchOutcomeFeedback(t, 'regenerateThumbnails', result)
      setRegenFeedback(feedback)
      setRegenState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.thumbnailsRegenerated'),
          partial: t('settings.toasts.thumbnailsPartiallyRegenerated'),
          failure: t('settings.toasts.thumbnailsNotRegenerated'),
        },
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
        message: t('settings.feedback.couldntRegenerateThumbnails'),
      })
      toast.error(t('settings.toasts.failedToRegenerateThumbnails'))
      setRegenState('idle')
      setRegenProgress('')
    }
  }, [mediaItems, t])

  const handleClearProxies = useCallback(async () => {
    setProxyState('clearing')
    try {
      const result = await clearProjectProxies(mediaItems)
      const feedback = getBatchOutcomeFeedback(t, 'deleteProxies', result)
      setProxyFeedback(feedback)
      setProxyState(result.failed === 0 ? 'done' : 'partial')
      showBatchOutcomeToast(
        t,
        {
          success: t('settings.toasts.proxiesDeleted'),
          partial: t('settings.toasts.proxiesPartiallyDeleted'),
          failure: t('settings.toasts.proxiesNotDeleted'),
        },
        result,
      )
      setTimeout(() => setProxyState('idle'), 2000)
    } catch (err) {
      log.error('Failed to clear proxies', err)
      setProxyFeedback({ tone: 'error', message: t('settings.feedback.couldntDeleteProxies') })
      toast.error(t('settings.toasts.failedToDeleteProxies'))
      setProxyState('idle')
    }
  }, [mediaItems, t])

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
      <DialogContent
        hideCloseButton
        className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !h-screen !max-w-none !max-h-none !rounded-none sm:!rounded-none !border-none !p-0 !flex !flex-col !gap-0 bg-background z-50 overflow-hidden shadow-none"
      >
        <DialogHeader className="flex flex-row items-center justify-between border-b border-border/80 px-6 py-3 shrink-0 bg-background/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 gap-1.5 px-3 text-xs font-semibold hover:bg-primary/10 hover:text-primary border-primary/30"
              title="Volver al Editor principal"
            >
              <ArrowLeft className="w-4 h-4 text-primary" />
              <span>Volver al Editor</span>
            </Button>
            <Separator orientation="vertical" className="h-5 bg-border/80 mx-1" />
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold leading-tight">{t('settings.title')}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">Configuración global, modelos de IA, workflows de ComfyUI y almacenamiento</DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetToDefaults}
              className="h-8 shrink-0 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {t('common.reset')}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 gap-1.5 px-3.5 text-xs font-semibold shadow-xs"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cerrar</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
          {/* Sidebar (Menu lateral por pestañas) */}
          <nav className="flex w-64 sm:w-72 shrink-0 flex-col gap-1 border-r border-border/60 bg-muted/15 p-4 overflow-y-auto">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Categorías
            </div>
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  />
                  <span className="flex-1 truncate">{t(section.labelKey, section.defaultLabel)}</span>
                </button>
              )
            })}

            {/* Botón Volver al Editor en el menú lateral */}
            <div className="mt-auto pt-4 border-t border-border/60 flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm font-semibold bg-muted/60 hover:bg-primary hover:text-primary-foreground text-foreground transition-all duration-150 shadow-xs cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span className="flex-1">Volver al Editor</span>
              </button>
              <span className="px-3 text-[11px] text-muted-foreground/70">
                O presiona la tecla ESC
              </span>
            </div>
          </nav>

          {/* Contenedor principal con scroll vertical suave para el mouse y sin cortes */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-background/50">
            <div className="max-w-4xl mx-auto px-8 py-8 pb-32">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={activeSection}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: reduceMotion ? 0 : 0.12 }}
                >
                    {activeSection === 'general' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">{t('settings.general.autoSave')}</Label>
                          <Switch
                            checked={autoSaveInterval > 0}
                            onCheckedChange={(v) => setSetting('autoSaveInterval', v ? 5 : 0)}
                          />
                        </div>
                        {autoSaveInterval > 0 && (
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-muted-foreground">
                              {t('settings.general.interval')}
                            </Label>
                            <div className="w-32 flex items-center gap-2">
                              <Slider
                                value={[autoSaveInterval]}
                                onValueChange={([v]) => setSetting('autoSaveInterval', v || 5)}
                                min={5}
                                max={30}
                                step={5}
                              />
                              <span className="text-xs text-muted-foreground w-6">
                                {t('settings.general.intervalMinutes', { count: autoSaveInterval })}
                              </span>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">
                            {t('settings.general.undoHistoryDepth')}
                          </Label>
                          <div className="w-32 flex items-center gap-2">
                            <Slider
                              value={[maxUndoHistory]}
                              onValueChange={([v]) => setSetting('maxUndoHistory', v || 10)}
                              min={10}
                              max={200}
                              step={10}
                            />
                            <span className="text-xs text-muted-foreground w-6">
                              {maxUndoHistory}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">{t('settings.general.uiSounds')}</Label>
                          <Switch
                            checked={uiSoundsEnabled}
                            onCheckedChange={(v) => {
                              setUiSoundEnabled(v)
                              // Give immediate audible confirmation when turning sounds on.
                              if (v) emitUiSound('confirm')
                            }}
                          />
                        </div>
                        {uiSoundsEnabled && (
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-muted-foreground">
                              {t('settings.general.uiSoundVolume')}
                            </Label>
                            <div className="w-32 flex items-center gap-2">
                              <Slider
                                value={[uiSoundVolume]}
                                onValueChange={([v]) => {
                                  setUiSoundVolume(v ?? 0.6)
                                  // Preview the new level as the user drags.
                                  emitUiSound('select')
                                }}
                                min={0}
                                max={1}
                                step={0.05}
                              />
                              <span className="text-xs text-muted-foreground w-8">
                                {Math.round(uiSoundVolume * 100)}%
                              </span>
                            </div>
                          </div>
                        )}
                        {uiSoundsEnabled && (
                          <div className="flex items-center justify-between">
                            <Label className="text-sm text-muted-foreground">
                              {t('settings.general.uiSoundVoice')}
                            </Label>
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={uiSoundVoice}
                                onValueChange={(value) => {
                                  setUiSoundVoice(value as VoiceName)
                                  // Preview the newly selected voice.
                                  emitUiSound('confirm')
                                }}
                              >
                                <SelectTrigger className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {VOICE_OPTIONS.map((option) => (
                                    <SelectPrimitive.Item
                                      key={option.value}
                                      value={option.value}
                                      className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                                    >
                                      <SelectPrimitive.ItemText>
                                        <span
                                          className={
                                            option.value === uiSoundVoice
                                              ? 'font-medium text-primary'
                                              : undefined
                                          }
                                        >
                                          {option.label}
                                        </span>
                                      </SelectPrimitive.ItemText>
                                    </SelectPrimitive.Item>
                                  ))}
                                </SelectContent>
                              </Select>
                              {/* Audition the selected voice — a real, keyboard-reachable
                            button beside the Select rather than a control nested
                            inside each (non-focusable) option row. */}
                              <button
                                type="button"
                                aria-label={t('settings.general.uiSoundPreview')}
                                onClick={() => previewUiSound(uiSoundVoice)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                              >
                                <Play className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeSection === 'ai' && (
                      <div className="space-y-6">
                        <AiProviderSettings />

                        <div className="space-y-4 pt-4 border-t border-border/40">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              Subtitulado y Transcripción Automática con IA
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Configura la densidad de fotogramas analizados y el estilo visual predeterminado para los subtítulos.
                            </p>
                          </div>

                          <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="space-y-0.5">
                                  <Label className="text-sm">
                                    {t('settings.ai.captionSampleInterval')}
                                  </Label>
                                  <p className="text-xs text-muted-foreground">
                                    {t('settings.ai.captionSampleIntervalDescription')}
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
                                      {unit === 'seconds'
                                        ? t('settings.ai.seconds')
                                        : t('settings.ai.frames')}
                                    </button>
                                  ))}
                                </div>
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  className="h-8 w-24 font-mono text-xs"
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
                                <span className="text-xs text-muted-foreground">
                                  {intervalUnitLabel}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => {
                                    setSetting('captioningIntervalUnit', 'seconds')
                                    setSetting(
                                      'captioningIntervalValue',
                                      DEFAULT_CAPTIONING_INTERVAL_SECONDS,
                                    )
                                  }}
                                  disabled={
                                    captioningIntervalUnit === 'seconds' &&
                                    captioningIntervalValue === DEFAULT_CAPTIONING_INTERVAL_SECONDS
                                  }
                                >
                                  {t('common.reset')}
                                </Button>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {t('settings.ai.captionIntervalHint', {
                                  estimate: formatCaptionEstimate(
                                    t,
                                    captioningIntervalUnit,
                                    captioningIntervalValue,
                                  ),
                                })}
                              </p>
                            </div>

                            <Separator />

                            <div className="space-y-3">
                              <div className="space-y-0.5">
                                <Label className="text-sm">
                                  {t('settings.ai.defaultCaptionStyle')}
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  {t('settings.ai.defaultCaptionStyleDescription')}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {CAPTION_STYLE_PRESETS.map((preset) => (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    title={t(preset.hintKey)}
                                    onClick={() => setSetting('defaultCaptionStylePresetId', preset.id)}
                                    className={cn(
                                      'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                                      defaultCaptionStylePresetId === preset.id
                                        ? 'border-primary bg-primary/15 text-primary shadow-sm'
                                        : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50',
                                    )}
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeSection === 'timeline' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">
                              {t('settings.timeline.snapByDefault')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {t('settings.timeline.snapByDefaultDescription')}
                            </p>
                          </div>
                          <Switch
                            checked={snapEnabled}
                            onCheckedChange={(v) => setSetting('snapEnabled', v)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">{t('settings.timeline.showWaveforms')}</Label>
                          <Switch
                            checked={showWaveforms}
                            onCheckedChange={(v) => setSetting('showWaveforms', v)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-sm">{t('settings.timeline.showFilmstrips')}</Label>
                          <Switch
                            checked={showFilmstrips}
                            onCheckedChange={(v) => setSetting('showFilmstrips', v)}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">
                              {t('settings.timeline.enableFilmstripExtraction')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {t('settings.timeline.enableFilmstripExtractionDescription')}
                            </p>
                          </div>
                          <Switch
                            checked={enableFilmstripExtraction}
                            onCheckedChange={(v) => setSetting('enableFilmstripExtraction', v)}
                          />
                        </div>
                      </div>
                    )}

                    {activeSection === 'storage' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">
                              {t('settings.storage.generateMissingProxies')}
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t('settings.storage.generateMissingProxiesDescription')}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-28 gap-1.5"
                            onClick={handleGenerateMissingProxies}
                            disabled={
                              proxyGenerateState !== 'idle' || missingProjectProxyCount === 0
                            }
                          >
                            {proxyGenerateState === 'queueing' && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            )}
                            {proxyGenerateState === 'done' && <Check className="w-3.5 h-3.5" />}
                            {proxyGenerateState === 'idle' && <Film className="w-3.5 h-3.5" />}
                            {proxyGenerateState === 'queueing'
                              ? t('common.queueing')
                              : proxyGenerateState === 'done'
                                ? t('settings.storage.queued')
                                : missingProjectProxyCount > 0
                                  ? t('settings.storage.generateWithCount', {
                                      count: missingProjectProxyCount,
                                    })
                                  : t('settings.storage.upToDate')}
                          </Button>
                        </div>
                        <Separator className="bg-white/8" />
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">
                              {t('settings.storage.clearProjectCache')}
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t('settings.storage.clearProjectCacheDescription')}
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
                              ? t('common.clearing')
                              : clearState === 'done'
                                ? t('settings.storage.cleared')
                                : clearState === 'partial'
                                  ? t('common.partial')
                                  : t('settings.storage.clear')}
                          </Button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">
                              {t('settings.storage.regenerateThumbnails')}
                            </Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t('settings.storage.regenerateThumbnailsDescription')}
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
                            {regenState === 'working' && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            )}
                            {regenState === 'done' && <Check className="w-3.5 h-3.5" />}
                            {regenState === 'partial' && <TriangleAlert className="w-3.5 h-3.5" />}
                            {regenState === 'idle' && <ImagePlus className="w-3.5 h-3.5" />}
                            {regenState === 'working'
                              ? regenProgress
                              : regenState === 'done'
                                ? t('common.done')
                                : regenState === 'partial'
                                  ? t('common.partial')
                                  : t('settings.storage.regenerate')}
                          </Button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Label className="text-sm">{t('settings.storage.deleteProxies')}</Label>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {t('settings.storage.deleteProxiesDescription')}
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
                              ? t('common.deleting')
                              : proxyState === 'done'
                                ? t('settings.storage.deleted')
                                : proxyState === 'partial'
                                  ? t('common.partial')
                                  : t('common.delete')}
                          </Button>
                        </div>
                        <Separator className="bg-white/8" />
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-sm">{t('settings.storage.localAi')}</Label>
                            <p className="text-xs text-muted-foreground">
                              {t('settings.storage.localAiDescription')}
                            </p>
                          </div>
                          <LocalInferenceUnloadControl />
                          <LocalModelCacheControl />
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </DialogContent>

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.storage.clearCacheConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.storage.clearCacheConfirmDescription', { count: mediaItems.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleClearCache()
              }}
            >
              {t('settings.storage.clearCache')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
