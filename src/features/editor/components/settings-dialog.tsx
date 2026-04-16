import { useState, useCallback } from 'react';
import type { MediaMetadata } from '@/types/storage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RotateCcw, Trash2, Loader2, Check, ImagePlus, Film,
  Settings2, Rows3, AudioLines, HardDrive,
} from 'lucide-react';
import {
  LocalInferenceUnloadControl,
  LocalModelCacheControl,
  useSettingsStore,
} from '@/features/editor/deps/settings';
import {
  useMediaLibraryStore,
  getSharedProxyKey,
  getMediaTranscriptionModelOptions,
  importProxyService,
  importMediaLibraryService,
  importThumbnailGenerator,
} from '@/features/editor/deps/media-library';
import {
  importGifFrameCache,
  importFilmstripCache,
  importWaveformCache,
} from '@/features/editor/deps/timeline-cache';
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime';
import { createLogger } from '@/shared/logging/logger';
import { cn } from '@/shared/ui/cn';
import { EDITOR_DENSITY_OPTIONS } from '@/shared/ui/editor-layout';
import {
  getWhisperQuantizationOption,
  getWhisperLanguageSelectValue,
  getWhisperLanguageSettingValue,
  WHISPER_LANGUAGE_OPTIONS,
  WHISPER_QUANTIZATION_OPTIONS,
} from '@/shared/utils/whisper-settings';
import type { MediaTranscriptModel, MediaTranscriptQuantization } from '@/types/storage';

const log = createLogger('SettingsDialog');
const TRANSCRIPTION_MODEL_OPTIONS = getMediaTranscriptionModelOptions();

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'timeline', label: 'Timeline', icon: Rows3 },
  { id: 'whisper', label: 'Whisper', icon: AudioLines },
  { id: 'storage', label: 'Storage', icon: HardDrive },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Clear regenerable cache data for the current project's media only.
 * Clears filmstrips, waveforms, GIF frames, and decoded audio
 * scoped to the given media IDs.
 *
 * Does NOT clear thumbnails (not auto-regenerated) or proxies (separate action).
 */
async function clearProjectCaches(mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;

  const [
    { deleteWaveform },
    { deleteGifFrames },
    { deleteDecodedPreviewAudio },
    { deletePreviewAudioConform },
    { gifFrameCache },
    { filmstripCache },
    { waveformCache },
  ] = await Promise.all([
    import('@/infrastructure/storage/indexeddb/waveforms'),
    import('@/infrastructure/storage/indexeddb/gif-frames'),
    import('@/infrastructure/storage/indexeddb/decoded-preview-audio'),
    import('@/features/editor/deps/composition-runtime'),
    importGifFrameCache(),
    importFilmstripCache(),
    importWaveformCache(),
  ]);

  // Clear in-memory preview audio cache (not keyed per-media, so clear all)
  clearPreviewAudioCache();

  await Promise.all(
    mediaIds.flatMap((id) => [
      deleteWaveform(id).catch((e) => { log.debug('Failed to delete waveform:', id, e); }),
      deleteGifFrames(id).catch((e) => { log.debug('Failed to delete GIF frames:', id, e); }),
      deleteDecodedPreviewAudio(id).catch((e) => { log.debug('Failed to delete decoded audio:', id, e); }),
      deletePreviewAudioConform(id, { clearMetadata: true }).catch((e) => { log.debug('Failed to delete preview conform audio:', id, e); }),
      gifFrameCache.clearMedia(id).catch((e) => { log.debug('Failed to clear GIF cache:', id, e); }),
      filmstripCache.clearMedia(id).catch((e) => { log.debug('Failed to clear filmstrip cache:', id, e); }),
      waveformCache.clearMedia(id).catch((e) => { log.debug('Failed to clear waveform cache:', id, e); }),
    ])
  );

  log.info(`Cleared caches for ${mediaIds.length} media items`);
}

/** Delete all proxy videos for the given media items and clear their store status. */
async function clearProjectProxies(
  mediaItems: MediaMetadata[]
): Promise<void> {
  if (mediaItems.length === 0) return;

  const { proxyService } = await importProxyService();

  await Promise.all(mediaItems.map(async (media) => {
    try {
      await proxyService.deleteProxy(media.id, getSharedProxyKey(media));
    } catch { /* already absent */ }
    useMediaLibraryStore.getState().clearProxyStatus(media.id);
    proxyService.clearProxyKey(media.id);
  }));

  log.info(`Cleared proxies for ${mediaItems.length} media items`);
}

/**
 * Regenerate thumbnails for all media in the current project.
 * Fetches each media file, generates a new thumbnail, and saves it to IndexedDB.
 */
async function regenerateProjectThumbnails(
  mediaItems: Array<{ id: string; fileName: string; mimeType: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (mediaItems.length === 0) return 0;

  const [
    { mediaLibraryService },
    { generateThumbnail },
    { saveThumbnail },
    { updateMedia },
  ] = await Promise.all([
    importMediaLibraryService(),
    importThumbnailGenerator(),
    import('@/infrastructure/storage/indexeddb/thumbnails'),
    import('@/infrastructure/storage/indexeddb/media'),
  ]);

  let regenerated = 0;

  for (const media of mediaItems) {
    try {
      const blob = await mediaLibraryService.getMediaFile(media.id);
      if (!blob) continue;

      // generateThumbnail expects a File (needs .name for extension-based mime detection)
      const file = new File([blob], media.fileName, { type: media.mimeType });
      const thumbnailBlob = await generateThumbnail(file);

      const thumbnailId = crypto.randomUUID();
      await saveThumbnail({
        id: thumbnailId,
        mediaId: media.id,
        blob: thumbnailBlob,
        timestamp: 1,
        width: 320,
        height: 180,
      });

      // Update the media record so the new thumbnailId propagates to the store
      await updateMedia(media.id, { thumbnailId });

      // Clear the in-memory blob URL cache so UI picks up the new thumbnail
      mediaLibraryService.clearThumbnailCache(media.id);
      regenerated++;
    } catch (err) {
      log.warn(`Failed to regenerate thumbnail for ${media.fileName}:`, err);
    }
    onProgress?.(regenerated, mediaItems.length);
  }

  // Reload store so MediaCards see the updated thumbnailId and re-fetch
  await useMediaLibraryStore.getState().loadMediaItems();

  log.info(`Regenerated ${regenerated}/${mediaItems.length} thumbnails`);
  return regenerated;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const snapEnabled = useSettingsStore((s) => s.snapEnabled);
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory);
  const defaultWhisperModel = useSettingsStore((s) => s.defaultWhisperModel);
  const defaultWhisperQuantization = useSettingsStore((s) => s.defaultWhisperQuantization);
  const defaultWhisperLanguage = useSettingsStore((s) => s.defaultWhisperLanguage);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus);

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [regenState, setRegenState] = useState<'idle' | 'working' | 'done'>('idle');
  const [regenProgress, setRegenProgress] = useState('');
  const [proxyState, setProxyState] = useState<'idle' | 'clearing' | 'done'>('idle');
  const [proxyGenerateState, setProxyGenerateState] = useState<'idle' | 'queueing' | 'done'>('idle');

  const handleClearCache = useCallback(async () => {
    setClearState('clearing');
    try {
      const ids = mediaItems.map((m) => m.id);
      await clearProjectCaches(ids);
      setClearState('done');
      setTimeout(() => setClearState('idle'), 2000);
    } catch (err) {
      log.error('Failed to clear caches', err);
      setClearState('idle');
    }
  }, [mediaItems]);

  const handleRegenThumbnails = useCallback(async () => {
    setRegenState('working');
    setRegenProgress('0/' + mediaItems.length);
    try {
      const items = mediaItems.map((m) => ({ id: m.id, fileName: m.fileName, mimeType: m.mimeType }));
      await regenerateProjectThumbnails(items, (done, total) => {
        setRegenProgress(`${done}/${total}`);
      });
      setRegenState('done');
      setTimeout(() => {
        setRegenState('idle');
        setRegenProgress('');
      }, 2000);
    } catch (err) {
      log.error('Failed to regenerate thumbnails', err);
      setRegenState('idle');
      setRegenProgress('');
    }
  }, [mediaItems]);

  const handleClearProxies = useCallback(async () => {
    setProxyState('clearing');
    try {
      await clearProjectProxies(mediaItems);
      setProxyState('done');
      setTimeout(() => setProxyState('idle'), 2000);
    } catch (err) {
      log.error('Failed to clear proxies', err);
      setProxyState('idle');
    }
  }, [mediaItems]);

  const handleGenerateMissingProxies = useCallback(async () => {
    setProxyGenerateState('queueing');

    try {
      const [{ proxyService }, { mediaLibraryService }] = await Promise.all([
        importProxyService(),
        importMediaLibraryService(),
      ]);

      const queuedItems = mediaItems.filter((media) => {
        if (!proxyService.canGenerateProxy(media.mimeType)) {
          return false;
        }

        const sharedProxyKey = getSharedProxyKey(media);
        if (proxyService.hasProxy(media.id, sharedProxyKey)) {
          return false;
        }

        const status = useMediaLibraryStore.getState().proxyStatus.get(media.id);
        return status !== 'ready' && status !== 'generating';
      });

      queuedItems.forEach((media) => {
        const sharedProxyKey = getSharedProxyKey(media);
        proxyService.setProxyKey(media.id, sharedProxyKey);
        proxyService.generateProxy(
          media.id,
          media.storageType === 'opfs' && media.opfsPath
            ? { kind: 'opfs', path: media.opfsPath, mimeType: media.mimeType }
            : () => mediaLibraryService.getMediaFile(media.id),
          media.width,
          media.height,
          sharedProxyKey,
          { priority: 'background' }
        );
      });

      setProxyGenerateState('done');
      setTimeout(() => setProxyGenerateState('idle'), 2000);
    } catch (err) {
      log.error('Failed to queue missing proxies', err);
      setProxyGenerateState('idle');
    }
  }, [mediaItems]);

  const defaultWhisperLanguageValue = getWhisperLanguageSelectValue(defaultWhisperLanguage);
  const defaultWhisperQuantizationOption = getWhisperQuantizationOption(defaultWhisperQuantization);
  const missingProjectProxyCount = mediaItems.filter((media) => (
    media.mimeType.startsWith('video/')
    && proxyStatus.get(media.id) !== 'ready'
    && proxyStatus.get(media.id) !== 'generating'
  )).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 sm:top-16 sm:max-h-[calc(100vh-4rem)] sm:translate-y-0 sm:origin-top">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-6 py-4 pr-14">
          <DialogTitle>Editor Settings</DialogTitle>
          <Button variant="ghost" size="sm" onClick={resetToDefaults} className="h-8 shrink-0 gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </DialogHeader>
        <div className="flex min-h-0">
          {/* Sidebar */}
          <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-white/6 p-2">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-out motion-reduce:transition-none',
                    activeSection === section.id
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-white/5 hover:text-foreground/80'
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {section.label}
                </button>
              );
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
                      onValueChange={(value) => setSetting('editorDensity', value as typeof editorDensity)}
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
                      Compact fits more of the editor into a 1080p screen. Default restores the roomier layout.
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
                        <span className="text-xs text-muted-foreground w-6">{autoSaveInterval}m</span>
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

              {activeSection === 'timeline' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Snap by Default</Label>
                      <p className="text-xs text-muted-foreground">Sets the initial snap state when a project opens.</p>
                    </div>
                    <Switch checked={snapEnabled} onCheckedChange={(v) => setSetting('snapEnabled', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Show Waveforms</Label>
                    <Switch checked={showWaveforms} onCheckedChange={(v) => setSetting('showWaveforms', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Show Filmstrips</Label>
                    <Switch checked={showFilmstrips} onCheckedChange={(v) => setSetting('showFilmstrips', v)} />
                  </div>
                </div>
              )}

              {activeSection === 'whisper' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Default Model</Label>
                    <Select
                      value={defaultWhisperModel}
                      onValueChange={(value) =>
                        setSetting('defaultWhisperModel', value as MediaTranscriptModel)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Used when transcription starts without an explicit model override.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">Default Quantization</Label>
                    <Select
                      value={defaultWhisperQuantization}
                      onValueChange={(value) =>
                        setSetting('defaultWhisperQuantization', value as MediaTranscriptQuantization)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WHISPER_QUANTIZATION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Pick based on memory first. {defaultWhisperQuantizationOption.description}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-sm">Default Language</Label>
                    <Combobox
                      value={defaultWhisperLanguageValue}
                      onValueChange={(value) =>
                        setSetting('defaultWhisperLanguage', getWhisperLanguageSettingValue(value))
                      }
                      options={WHISPER_LANGUAGE_OPTIONS}
                      placeholder="Auto-detect"
                      searchPlaceholder="Search languages..."
                      emptyMessage="No languages match that search."
                    />
                    <p className="text-xs text-muted-foreground">
                      Choose Auto-detect to infer the language, or lock transcription to a known language for faster startup.
                    </p>
                  </div>

                  <LocalInferenceUnloadControl />
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
                      {proxyGenerateState === 'queueing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={() => setShowClearConfirm(true)}
                      disabled={clearState !== 'idle'}
                    >
                      {clearState === 'clearing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {clearState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {clearState === 'idle' && <Trash2 className="w-3.5 h-3.5" />}
                      {clearState === 'clearing' ? 'Clearing...' : clearState === 'done' ? 'Cleared' : 'Clear'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Regenerate Thumbnails</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Re-create media library thumbnails for this project
                      </p>
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
                      {regenState === 'idle' && <ImagePlus className="w-3.5 h-3.5" />}
                      {regenState === 'working' ? regenProgress : regenState === 'done' ? 'Done' : 'Regenerate'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm">Delete Proxies</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Remove generated proxy videos for this project
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-28 gap-1.5"
                      onClick={handleClearProxies}
                      disabled={proxyState !== 'idle'}
                    >
                      {proxyState === 'clearing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {proxyState === 'done' && <Check className="w-3.5 h-3.5" />}
                      {proxyState === 'idle' && <Film className="w-3.5 h-3.5" />}
                      {proxyState === 'clearing' ? 'Deleting...' : proxyState === 'done' ? 'Deleted' : 'Delete'}
                    </Button>
                  </div>
                  <Separator className="bg-white/8" />
                  <LocalModelCacheControl />
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
              This will delete cached waveforms, filmstrips, GIF frames, and decoded audio
              for the current project ({mediaItems.length} media items).
              These will be regenerated automatically when needed. Your project data,
              media files, thumbnails, and proxies will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleClearCache();
              }}
            >
              Clear Cache
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
