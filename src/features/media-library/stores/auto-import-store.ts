import { create } from 'zustand';
import { useMediaLibraryStore } from './media-library-store';
import { useItemsStore } from '@/features/media-library/deps/timeline-stores';
import { useTimelineSettingsStore } from '@/features/media-library/deps/timeline-stores';
import { useProjectStore } from '@/features/media-library/deps/projects';
import {
  buildDroppedMediaTimelineItem,
  type DroppableMediaType,
  getDroppedMediaDurationInFrames,
} from '@/features/media-library/deps/timeline-utils';
import { addItem } from '@/features/media-library/deps/timeline-actions';
import { resolveMediaUrl } from '@/features/media-library/utils/media-resolver';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { getMediaType } from '@/features/media-library/utils/validation';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('AutoImport');

const POLL_INTERVAL_MS = 3000;

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']);

function isSupportedMediaFile(name: string): boolean {
  const ext = name.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return false;
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
}

/**
 * Tracks files that were detected but may still be written to (e.g. OBS recordings).
 * Maps filename -> last observed file size. A file is considered stable when its
 * size is >0 and unchanged between two consecutive polls.
 */
const pendingFiles = new Map<string, number>();

interface AutoImportState {
  active: boolean;
  directoryHandle: FileSystemDirectoryHandle | null;
  folderName: string | null;
  knownFiles: Set<string>;
  timerId: ReturnType<typeof setInterval> | null;
}

interface AutoImportActions {
  enable: () => Promise<void>;
  disable: () => void;
}

export const useAutoImportStore = create<AutoImportState & AutoImportActions>()(
  (set, get) => ({
    active: false,
    directoryHandle: null,
    folderName: null,
    knownFiles: new Set(),
    timerId: null,

    enable: async () => {
      if (get().active) return;

      if (!('showDirectoryPicker' in window)) {
        useMediaLibraryStore.getState().showNotification({
          type: 'error',
          message: 'Directory picker not supported. Please use Google Chrome.',
        });
        return;
      }

      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });

        // Snapshot existing files so we only import new ones
        const knownFiles = new Set<string>();
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file' && isSupportedMediaFile(entry.name)) {
            knownFiles.add(entry.name);
          }
        }

        const timerId = setInterval(() => pollForNewFiles(), POLL_INTERVAL_MS);

        set({
          active: true,
          directoryHandle: dirHandle,
          folderName: dirHandle.name,
          knownFiles,
          timerId,
        });

        useMediaLibraryStore.getState().showNotification({
          type: 'success',
          message: `Auto-import watching "${dirHandle.name}" for new files`,
        });

        logger.info(`Auto-import enabled for "${dirHandle.name}", ${knownFiles.size} existing files`);
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          logger.error('Failed to enable auto-import:', error);
          useMediaLibraryStore.getState().showNotification({
            type: 'error',
            message: `Auto-import failed: ${error.message}`,
          });
        }
      }
    },

    disable: () => {
      const { timerId } = get();
      if (timerId) {
        clearInterval(timerId);
      }
      pendingFiles.clear();
      set({
        active: false,
        directoryHandle: null,
        folderName: null,
        knownFiles: new Set(),
        timerId: null,
      });
      logger.info('Auto-import disabled');
    },
  })
);

async function pollForNewFiles(): Promise<void> {
  const state = useAutoImportStore.getState();
  if (!state.active || !state.directoryHandle) return;

  const { currentProjectId } = useMediaLibraryStore.getState();
  if (!currentProjectId) return;

  try {
    // Verify permission is still granted
    const permissionStatus = await state.directoryHandle.queryPermission({ mode: 'read' });
    if (permissionStatus !== 'granted') {
      logger.warn('Auto-import: directory permission lost, disabling');
      useAutoImportStore.getState().disable();
      useMediaLibraryStore.getState().showNotification({
        type: 'warning',
        message: 'Auto-import disabled: directory permission lost',
      });
      return;
    }

    // Scan directory for new files
    for await (const entry of state.directoryHandle.values()) {
      if (entry.kind === 'file' && isSupportedMediaFile(entry.name)) {
        if (!state.knownFiles.has(entry.name) && !pendingFiles.has(entry.name)) {
          // New file detected — add to pending with current size
          const fileHandle = entry as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          pendingFiles.set(entry.name, file.size);
          logger.info(`Auto-import: detected new file "${entry.name}" (${file.size} bytes), waiting for write to finish...`);
        }
      }
    }

    if (pendingFiles.size === 0) return;

    // Check which pending files are now stable (size > 0 and unchanged since last poll)
    const stableHandles: FileSystemFileHandle[] = [];
    const currentKnown = new Set(state.knownFiles);

    for (const [fileName, lastSize] of pendingFiles) {
      try {
        const handle = await state.directoryHandle.getFileHandle(fileName);
        const file = await handle.getFile();
        const currentSize = file.size;

        if (currentSize === 0) {
          // Still empty, keep waiting
          continue;
        }

        if (currentSize === lastSize) {
          // Size unchanged and > 0 — file is done being written
          stableHandles.push(handle);
          currentKnown.add(fileName);
          pendingFiles.delete(fileName);
          logger.info(`Auto-import: "${fileName}" stable at ${currentSize} bytes, importing`);
        } else {
          // Still growing, update the tracked size for next poll
          pendingFiles.set(fileName, currentSize);
          logger.info(`Auto-import: "${fileName}" still writing (${lastSize} -> ${currentSize} bytes)`);
        }
      } catch {
        // File may have been deleted before we could read it
        pendingFiles.delete(fileName);
      }
    }

    if (stableHandles.length === 0) return;

    // Update known files immediately to avoid re-processing
    useAutoImportStore.setState({ knownFiles: currentKnown });

    logger.info(`Auto-import: importing ${stableHandles.length} stable file(s)`);

    // Import into media library
    const importedMedia = await useMediaLibraryStore.getState().importHandles(stableHandles);

    if (importedMedia.length === 0) return;

    // Append each imported item to end of timeline on track 1
    const fps = useTimelineSettingsStore.getState().fps;
    const tracks = useItemsStore.getState().tracks;
    const project = useProjectStore.getState().currentProject;
    const canvasWidth = project?.metadata.width ?? 1920;
    const canvasHeight = project?.metadata.height ?? 1080;

    // Find first visible, unlocked, non-group track
    const targetTrack = tracks.find(
      (t: { visible?: boolean; locked?: boolean; isGroup?: boolean }) =>
        t.visible !== false && !t.locked && !t.isGroup
    );
    if (!targetTrack) {
      logger.warn('Auto-import: no available track for timeline placement');
      return;
    }

    for (const media of importedMedia) {
      const rawMediaType = getMediaType(media.mimeType);
      if (rawMediaType === 'unknown') continue;
      const mediaType: DroppableMediaType = rawMediaType;

      const durationInFrames = getDroppedMediaDurationInFrames(media, mediaType, fps);

      // Find end of all items on the target track
      const trackItems = useItemsStore.getState().items.filter(
        (i: { trackId: string }) => i.trackId === targetTrack.id
      );
      const endFrame = trackItems.reduce(
        (max: number, item: { from: number; durationInFrames: number }) =>
          Math.max(max, item.from + item.durationInFrames),
        0
      );

      const blobUrl = await resolveMediaUrl(media.id);
      if (!blobUrl) continue;

      const thumbnailUrl = await mediaLibraryService.getThumbnailBlobUrl(media.id);

      const timelineItem = buildDroppedMediaTimelineItem({
        media,
        mediaId: media.id,
        mediaType,
        label: media.fileName,
        timelineFps: fps,
        blobUrl,
        thumbnailUrl,
        canvasWidth,
        canvasHeight,
        placement: {
          trackId: targetTrack.id,
          from: endFrame,
          durationInFrames,
        },
      });

      addItem(timelineItem);
      logger.info(`Auto-import: added "${media.fileName}" to timeline at frame ${endFrame}`);
    }

    useMediaLibraryStore.getState().showNotification({
      type: 'success',
      message: `Auto-imported ${importedMedia.length} file(s) to timeline`,
    });
  } catch (error) {
    logger.error('Auto-import poll error:', error);
  }
}
