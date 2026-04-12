import type { MediaLibraryState, MediaLibraryActions, UnsupportedCodecFile } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { proxyService } from '../services/proxy-service';
import { enqueueBackgroundMediaWork } from '../services/background-media-work';
import { getMimeType } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';
import { hasMediaFilePickerSupport, showMediaFilePicker } from '../utils/media-file-picker';
import { createLogger, createOperationId } from '@/shared/logging/logger';

const logger = createLogger('MediaImport');
const IMPORT_PROXY_DELAY_MS = 2500;

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

interface CompletedImportTask extends ImportTask {
  metadata: ImportedMetadata;
}

function buildOptimisticMediaItem(handle: FileSystemFileHandle, file: File, tempId: string): MediaMetadata {
  const now = Date.now();

  return {
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
    createdAt: now,
    updatedAt: now,
  };
}

function removeImportPlaceholder(set: Set, tempId: string): void {
  set((state) => ({
    mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
    importingIds: state.importingIds.filter((id) => id !== tempId),
  }));
}

function replaceImportPlaceholder(set: Set, tempId: string, metadata: MediaMetadata): void {
  set((state) => ({
    mediaItems: state.mediaItems.map((item) => (item.id === tempId ? metadata : item)),
    importingIds: state.importingIds.filter((id) => id !== tempId),
  }));
}

function setupImportedVideoProxy(metadata: MediaMetadata): void {
  if (!proxyService.canGenerateProxy(metadata.mimeType)) {
    return;
  }

  const proxyKey = getSharedProxyKey(metadata);
  proxyService.setProxyKey(metadata.id, proxyKey);

  if (!proxyService.needsProxy(
    metadata.width,
    metadata.height,
    metadata.mimeType,
    metadata.audioCodec,
    metadata.id,
  )) {
    return;
  }

  if (proxyService.hasProxy(metadata.id, proxyKey)) {
    return;
  }

  try {
    enqueueBackgroundMediaWork(() => {
      proxyService.generateProxy(
        metadata.id,
        () => mediaLibraryService.getMediaFile(metadata.id),
        metadata.width,
        metadata.height,
        proxyKey,
        { priority: 'background' },
      );
    }, {
      priority: 'heavy',
      delayMs: IMPORT_PROXY_DELAY_MS,
    });
  } catch (error) {
    logger.warn(`[MediaImport] Failed to enqueue automatic proxy generation for ${metadata.id}:`, error);
  }
}

function processImportResults(
  importResults: PromiseSettledResult<CompletedImportTask>[],
  importTasks: ImportTask[],
  set: Set,
  options?: { includeDuplicatesInResults?: boolean }
): { results: MediaMetadata[]; importedCount: number; duplicateNames: string[]; unsupportedCodecFiles: UnsupportedCodecFile[]; failedCount: number } {
  const results: MediaMetadata[] = [];
  const duplicateNames: string[] = [];
  const unsupportedCodecFiles: UnsupportedCodecFile[] = [];
  let importedCount = 0;
  let failedCount = 0;

  importResults.forEach((result, index) => {
    const importTask = importTasks[index];
    if (!importTask) {
      return;
    }

    if (result.status === 'fulfilled') {
      const { metadata, tempId, file, handle } = result.value;

      if (metadata.isDuplicate) {
        removeImportPlaceholder(set, tempId);
        duplicateNames.push(file.name);
        if (options?.includeDuplicatesInResults) {
          results.push(metadata);
        }
      } else {
        replaceImportPlaceholder(set, tempId, metadata);

        setupImportedVideoProxy(metadata);
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
      removeImportPlaceholder(set, importTask.tempId);
      logger.error(`Failed to import ${importTask.file.name}`, result.reason);
    }
  });

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

      let file: File;
      try {
        file = await handle.getFile();
      } catch (error) {
        // getFile() can fail if permission is denied or file is missing —
        // remove the placeholder that was about to be inserted and skip.
        logger.error(`Failed to read file from handle "${handle.name}":`, error);
        continue;
      }

      const tempItem = buildOptimisticMediaItem(handle, file, tempId);

      set((state) => ({
        mediaItems: [tempItem, ...state.mediaItems],
        importingIds: [...state.importingIds, tempId],
        error: null,
      }));

      importTasks.push({ handle, tempId, file });
    }

    return importTasks;
  };

  const runImportTasks = (
    importTasks: ImportTask[],
    projectId: string
  ): Promise<PromiseSettledResult<CompletedImportTask>[]> =>
    Promise.allSettled(
      importTasks.map(async ({ handle, tempId, file }) => {
        const metadata = await mediaLibraryService.importMediaWithHandle(handle, projectId);
        return { metadata, tempId, file, handle };
      })
    );

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
    const importResults = await runImportTasks(importTasks, currentProjectId);

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
      if (!hasMediaFilePickerSupport()) {
        const isBrave = 'brave' in navigator;
        set({
          error: isBrave
            ? 'File System Access API is disabled in Brave. Copy the URL below, paste it in your address bar, set the flag to Enabled, and relaunch.'
            : 'File picker not supported in this browser. Use Chrome or Edge.',
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
        const handles = await showMediaFilePicker({ multiple: true });

        event.set('fileCount', handles.length);

        // Create optimistic placeholders for all files immediately
        const importTasks = await createOptimisticImportTasks(handles);
        const importResults = await runImportTasks(importTasks, currentProjectId);

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
          event.success({ outcome: 'cancelled', imported: 0, duplicates: 0, failed: 0, unsupportedCodecs: 0 });
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
