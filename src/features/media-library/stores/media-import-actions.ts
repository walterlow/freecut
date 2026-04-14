import type { MediaLibraryState, MediaLibraryActions, UnsupportedCodecFile } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { proxyService } from '../services/proxy-service';
import { getMimeType } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';
import { createLogger, createOperationId } from '@/shared/logging/logger';

const logger = createLogger('MediaImport');

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)
) => void;
type Get = () => MediaLibraryState & MediaLibraryActions;

type ImportedMetadata = MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean };

interface ImportTask {
  handle: FileSystemFileHandle;
  tempId: string;
  file: File;
}

function processImportResults(
  importResults: PromiseSettledResult<{ metadata: ImportedMetadata; tempId: string; file: File; handle: FileSystemFileHandle }>[],
  importTasks: ImportTask[],
  set: Set,
  options?: { includeDuplicatesInResults?: boolean }
): { results: MediaMetadata[]; importedCount: number; duplicateNames: string[]; unsupportedCodecFiles: UnsupportedCodecFile[]; failedCount: number } {
  const results: MediaMetadata[] = [];
  const duplicateNames: string[] = [];
  const unsupportedCodecFiles: UnsupportedCodecFile[] = [];
  let importedCount = 0;
  let failedCount = 0;

  for (const result of importResults) {
    if (result.status === 'fulfilled') {
      const { metadata, tempId, file, handle } = result.value;

      if (metadata.isDuplicate) {
        set((state) => ({
          mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
          importingIds: state.importingIds.filter((id) => id !== tempId),
        }));
        duplicateNames.push(file.name);
        if (options?.includeDuplicatesInResults) {
          results.push(metadata);
        }
      } else {
        set((state) => ({
          mediaItems: state.mediaItems.map((item) =>
            item.id === tempId ? metadata : item
          ),
          importingIds: state.importingIds.filter((id) => id !== tempId),
        }));

        if (metadata.mimeType.startsWith('video/')) {
          proxyService.setProxyKey(metadata.id, getSharedProxyKey(metadata));
        }
        results.push(metadata);
        importedCount += 1;

        if (metadata.hasUnsupportedCodec && metadata.audioCodec) {
          unsupportedCodecFiles.push({
            fileName: file.name,
            audioCodec: metadata.audioCodec,
            handle,
          });
        }
      }
    } else {
      failedCount++;
      const failedTask = importTasks.find(
        (_, i) => importResults[i] === result
      );
      if (failedTask) {
        set((state) => ({
          mediaItems: state.mediaItems.filter((item) => item.id !== failedTask.tempId),
          importingIds: state.importingIds.filter((id) => id !== failedTask.tempId),
        }));
        logger.error(`Failed to import ${failedTask.file.name}`, result.reason);
      }
    }
  }

  return { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount };
}

function showImportNotifications(
  duplicateNames: string[],
  unsupportedCodecFiles: UnsupportedCodecFile[],
  get: Get,
): void {
  if (duplicateNames.length > 0) {
    const message =
      duplicateNames.length === 1
        ? `"${duplicateNames[0]}" already exists in library`
        : `${duplicateNames.length} files already exist in library`;
    get().showNotification({ type: 'info', message });
  }

  if (unsupportedCodecFiles.length > 0) {
    const codecList = [
      ...new Set(unsupportedCodecFiles.map((f) => f.audioCodec)),
    ].join(', ');
    get().showNotification({
      type: 'warning',
      message: `${unsupportedCodecFiles.length} file(s) have unsupported audio codec (${codecList}). Waveforms may not be available.`,
    });
  }
}

export function createImportActions(
  set: Set,
  get: Get
): Pick<MediaLibraryActions, 'importMedia' | 'importHandles' | 'importHandlesForPlacement'> {
  const createOptimisticImportTasks = async (handles: FileSystemFileHandle[]): Promise<ImportTask[]> => {
    const importTasks: ImportTask[] = [];

    for (const handle of handles) {
      if (!handle) continue;
      const tempId = crypto.randomUUID();
      const file = await handle.getFile();

      const tempItem: MediaMetadata = {
        id: tempId,
        storageType: 'handle',
        fileHandle: handle,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        mimeType: getMimeType(file),
        duration: 0,
        width: 0,
        height: 0,
        fps: 30,
        codec: 'importing...',
        bitrate: 0,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      set((state) => ({
        mediaItems: [tempItem, ...state.mediaItems],
        importingIds: [...state.importingIds, tempId],
        error: null,
      }));

      importTasks.push({ handle, tempId, file });
    }

    return importTasks;
  };

  const importHandlesInternal = async (
    handles: FileSystemFileHandle[],
    options?: { includeDuplicatesInResults?: boolean }
  ): Promise<MediaMetadata[]> => {
    const { currentProjectId } = get();

    if (!currentProjectId) {
      set({ error: 'No project selected' });
      return [];
    }

    const opId = createOperationId();
    const event = logger.startEvent('import', opId);
    event.merge({
      source: 'drag-drop',
      projectId: currentProjectId,
      fileCount: handles.length,
    });

    const importTasks = await createOptimisticImportTasks(handles);

    const importResults = await Promise.allSettled(
      importTasks.map(async ({ handle, tempId, file }) => {
        const metadata = await mediaLibraryService.importMediaWithHandle(
          handle,
          currentProjectId
        );
        return { metadata, tempId, file, handle };
      })
    );

    const { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount } =
      processImportResults(importResults, importTasks, set, options);

    showImportNotifications(duplicateNames, unsupportedCodecFiles, get);

    event.success({
      imported: importedCount,
      duplicates: duplicateNames.length,
      failed: failedCount,
      unsupportedCodecs: unsupportedCodecFiles.length,
    });

    return results;
  };

  return {
    importMedia: async () => {
      const { currentProjectId } = get();

      if (!currentProjectId) {
        set({ error: 'No project selected' });
        return [];
      }

      // Check if File System Access API is supported
      if (!('showOpenFilePicker' in window)) {
        const isBrave = 'brave' in navigator;
        set({
          error: isBrave
            ? 'File System Access API is disabled in Brave. Copy the URL below, paste it in your address bar, set the flag to Enabled, and relaunch.'
            : 'File picker not supported. Please use Google Chrome.',
          errorLink: isBrave ? 'brave://flags/#file-system-access-api' : null,
        });
        return [];
      }

      const opId = createOperationId();
      const event = logger.startEvent('import', opId);
      event.set('source', 'picker');
      event.set('projectId', currentProjectId);

      try {
        // Open file picker
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'Media files',
              accept: {
                'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
                'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
                'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
              },
            },
          ],
        });

        event.set('fileCount', handles.length);

        // Create optimistic placeholders for all files immediately
        const importTasks = await createOptimisticImportTasks(handles);

        // Process all imports in parallel
        const importResults = await Promise.allSettled(
          importTasks.map(async ({ handle, tempId, file }) => {
            const metadata = await mediaLibraryService.importMediaWithHandle(
              handle,
              currentProjectId
            );
            return { metadata, tempId, file, handle };
          })
        );

        const { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount } =
          processImportResults(importResults, importTasks, set);

        showImportNotifications(duplicateNames, unsupportedCodecFiles, get);

        event.success({
          imported: importedCount,
          duplicates: duplicateNames.length,
          failed: failedCount,
          unsupportedCodecs: unsupportedCodecFiles.length,
        });

        return results;
      } catch (error) {
        // User cancelled or error
        if (error instanceof Error && error.name !== 'AbortError') {
          set({ error: error.message });
          event.failure(error);
        } else {
          event.set('outcome', 'cancelled');
          logger.event('import', { opId, outcome: 'cancelled' });
        }
        return [];
      }
    },

    importHandles: async (handles: FileSystemFileHandle[]) => {
      return importHandlesInternal(handles);
    },

    importHandlesForPlacement: async (handles: FileSystemFileHandle[]) =>
      importHandlesInternal(handles, { includeDuplicatesInResults: true }),
  };
}
