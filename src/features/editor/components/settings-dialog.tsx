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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RotateCcw, Trash2, Loader2, Check, ImagePlus, Film } from 'lucide-react';
import { useSettingsStore } from '@/features/settings/stores/settings-store';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { getSharedProxyKey } from '@/features/media-library/utils/proxy-key';
import { createLogger } from '@/lib/logger';

const log = createLogger('SettingsDialog');

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
    { gifFrameCache },
    { filmstripCache },
    { waveformCache },
  ] = await Promise.all([
    import('@/lib/storage/indexeddb/waveforms'),
    import('@/lib/storage/indexeddb/gif-frames'),
    import('@/lib/storage/indexeddb/decoded-preview-audio'),
    import('@/features/timeline/services/gif-frame-cache'),
    import('@/features/timeline/services/filmstrip-cache'),
    import('@/features/timeline/services/waveform-cache'),
  ]);

  // Clear in-memory preview audio cache (not keyed per-media, so clear all)
  const { clearPreviewAudioCache } = await import(
    '@/lib/composition-runtime/utils/audio-decode-cache'
  );
  clearPreviewAudioCache();

  await Promise.all(
    mediaIds.flatMap((id) => [
      deleteWaveform(id).catch(() => {}),
      deleteGifFrames(id).catch(() => {}),
      deleteDecodedPreviewAudio(id).catch(() => {}),
      gifFrameCache.clearMedia(id).catch(() => {}),
      filmstripCache.clearMedia(id).catch(() => {}),
      waveformCache.clearMedia(id).catch(() => {}),
    ])
  );

  log.info(`Cleared caches for ${mediaIds.length} media items`);
}

/** Delete all proxy videos for the given media items and clear their store status. */
async function clearProjectProxies(
  mediaItems: MediaMetadata[]
): Promise<void> {
  if (mediaItems.length === 0) return;

  const { proxyService } = await import('@/features/media-library/services/proxy-service');

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
    import('@/features/media-library/services/media-library-service'),
    import('@/features/media-library/utils/thumbnail-generator'),
    import('@/lib/storage/indexeddb/thumbnails'),
    import('@/lib/storage/indexeddb/media'),
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
  const showWaveforms = useSettingsStore((s) => s.showWaveforms);
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips);
  const autoSaveInterval = useSettingsStore((s) => s.autoSaveInterval);
  const maxUndoHistory = useSettingsStore((s) => s.maxUndoHistory);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);

  const [clearState, setClearState] = useState<'idle' | 'clearing' | 'done'>('idle');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [regenState, setRegenState] = useState<'idle' | 'working' | 'done'>('idle');
  const [regenProgress, setRegenProgress] = useState('');
  const [proxyState, setProxyState] = useState<'idle' | 'clearing' | 'done'>('idle');

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Editor Settings</DialogTitle>
          <Button variant="ghost" size="sm" onClick={resetToDefaults} className="h-8 gap-1.5 mr-6">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-4">
          <div className="space-y-6">
            {/* General */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">General</h3>
              <div className="space-y-3">
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
              </div>
            </section>

            {/* Timeline */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Timeline</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Show Waveforms</Label>
                  <Switch checked={showWaveforms} onCheckedChange={(v) => setSetting('showWaveforms', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Show Filmstrips</Label>
                  <Switch checked={showFilmstrips} onCheckedChange={(v) => setSetting('showFilmstrips', v)} />
                </div>
              </div>
            </section>

            {/* Performance */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Performance</h3>
              <div className="space-y-3">
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
            </section>

            {/* Storage */}
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Storage</h3>
              <div className="space-y-3">
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
              </div>
            </section>

          </div>
        </ScrollArea>
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
