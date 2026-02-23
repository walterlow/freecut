import type { MediaLibraryState, MediaLibraryActions, UnsupportedCodecFile } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { proxyService } from '../services/proxy-service';
import { getMimeType } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MediaImportActions');

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)
) => void;
type Get = () => MediaLibraryState & MediaLibraryActions;

export function createImportActions(
  set: Set,
  get: Get
): Pick<MediaLibraryActions, 'importMedia' | 'importHandles'> {
  return {
    // Import media using file picker (instant, no copy - local-first)
    // Now runs processing in worker to avoid blocking UI
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

        // Create optimistic placeholders for all files immediately
        const importTasks: Array<{
          handle: FileSystemFileHandle;
          tempId: string;
          file: File;
        }> = [];

        for (const handle of handles) {
          const tempId = crypto.randomUUID();
          const file = await handle.getFile();

          // Create temporary placeholder with 'handle' storage type
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

          // Add placeholder immediately
          set((state) => ({
            mediaItems: [tempItem, ...state.mediaItems],
            importingIds: [...state.importingIds, tempId],
            error: null,
          }));

          importTasks.push({ handle, tempId, file });
        }

        // Process all imports in parallel (worker handles heavy lifting off main thread)
        const results: MediaMetadata[] = [];
        const duplicateNames: string[] = [];
        const unsupportedCodecFiles: UnsupportedCodecFile[] = [];

        const importResults = await Promise.allSettled(
          importTasks.map(async ({ handle, tempId, file }) => {
            const metadata = await mediaLibraryService.importMediaWithHandle(
              handle,
              currentProjectId
            );
            return { metadata, tempId, file, handle };
          })
        );

        // Process results
        for (const result of importResults) {
          if (result.status === 'fulfilled') {
            const { metadata, tempId, file, handle } = result.value;

            if (metadata.isDuplicate) {
              // File already exists - remove temp item
              set((state) => ({
                mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
              duplicateNames.push(file.name);
            } else {
              // Replace temp with actual metadata
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

              // Track unsupported codec files (check happens in worker now)
              if (metadata.hasUnsupportedCodec && metadata.audioCodec) {
                unsupportedCodecFiles.push({
                  fileName: file.name,
                  audioCodec: metadata.audioCodec,
                  handle,
                });
              }
            }
          } else {
            // Find the failed task to get tempId
            const failedTask = importTasks.find(
              (_, i) => importResults[i] === result
            );
            if (failedTask) {
              set((state) => ({
                mediaItems: state.mediaItems.filter((item) => item.id !== failedTask.tempId),
                importingIds: state.importingIds.filter((id) => id !== failedTask.tempId),
              }));
              logger.error(`Failed to import ${failedTask.file.name}:`, result.reason);
            }
          }
        }

        // Show batched notification for duplicates
        if (duplicateNames.length > 0) {
          const message =
            duplicateNames.length === 1
              ? `"${duplicateNames[0]}" already exists in library`
              : `${duplicateNames.length} files already exist in library`;
          get().showNotification({ type: 'info', message });
        }

        // Show notification for unsupported codecs (non-blocking, files are already imported)
        if (unsupportedCodecFiles.length > 0) {
          const codecList = [
            ...new Set(unsupportedCodecFiles.map((f) => f.audioCodec)),
          ].join(', ');
          get().showNotification({
            type: 'warning',
            message: `${unsupportedCodecFiles.length} file(s) have unsupported audio codec (${codecList}). Waveforms may not be available.`,
          });
        }

        return results;
      } catch (error) {
        // User cancelled or error
        if (error instanceof Error && error.name !== 'AbortError') {
          set({ error: error.message });
        }
        return [];
      }
    },

    // Import media from file handles (for drag-drop)
    // Now runs processing in worker to avoid blocking UI
    importHandles: async (handles: FileSystemFileHandle[]) => {
      const { currentProjectId } = get();
      logger.debug('[importHandles] Starting import for', handles.length, 'handles');

      if (!currentProjectId) {
        set({ error: 'No project selected' });
        return [];
      }

      // Create optimistic placeholders for all files immediately
      const importTasks: Array<{
        handle: FileSystemFileHandle;
        tempId: string;
        file: File;
      }> = [];

      for (const handle of handles) {
        if (!handle) continue;
        const tempId = crypto.randomUUID();
        const file = await handle.getFile();

        // Create temporary placeholder with 'handle' storage type
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

        // Add placeholder immediately
        set((state) => ({
          mediaItems: [tempItem, ...state.mediaItems],
          importingIds: [...state.importingIds, tempId],
          error: null,
        }));

        importTasks.push({ handle, tempId, file });
      }

      // Process all imports in parallel (worker handles heavy lifting off main thread)
      const results: MediaMetadata[] = [];
      const duplicateNames: string[] = [];
      const unsupportedCodecFiles: UnsupportedCodecFile[] = [];

      const importResults = await Promise.allSettled(
        importTasks.map(async ({ handle, tempId, file }) => {
          logger.debug(
            `[importHandles] Processing ${file.name} (${file.size} bytes)`
          );
          const metadata = await mediaLibraryService.importMediaWithHandle(
            handle,
            currentProjectId
          );
          logger.debug(`[importHandles] Result for ${file.name}:`, {
            isDuplicate: metadata.isDuplicate,
            id: metadata.id,
          });
          return { metadata, tempId, file, handle };
        })
      );

      // Process results
      for (const result of importResults) {
        if (result.status === 'fulfilled') {
          const { metadata, tempId, file, handle } = result.value;

          if (metadata.isDuplicate) {
            // File already exists - remove temp item
            logger.debug(
              `[importHandles] ${file.name} is duplicate, removing temp item`
            );
            set((state) => ({
              mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
              importingIds: state.importingIds.filter((id) => id !== tempId),
            }));
            duplicateNames.push(file.name);
          } else {
            // Replace temp with actual metadata
            logger.debug(
              `[importHandles] ${file.name} imported successfully with id ${metadata.id}`
            );
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

            // Track unsupported codec files (check happens in worker now)
            if (metadata.hasUnsupportedCodec && metadata.audioCodec) {
              unsupportedCodecFiles.push({
                fileName: file.name,
                audioCodec: metadata.audioCodec,
                handle,
              });
            }
          }
        } else {
          // Find the failed task to get tempId
          const failedTask = importTasks.find(
            (_, i) => importResults[i] === result
          );
          if (failedTask) {
            set((state) => ({
              mediaItems: state.mediaItems.filter(
                (item) => item.id !== failedTask.tempId
              ),
              importingIds: state.importingIds.filter(
                (id) => id !== failedTask.tempId
              ),
            }));
            logger.error(
              `[importHandles] Failed to import ${failedTask.file.name}:`,
              result.reason
            );
          }
        }
      }

      logger.debug(
        `[importHandles] Import complete. Results: ${results.length}, Duplicates: ${duplicateNames.length}`
      );

      // Show batched notification for duplicates
      if (duplicateNames.length > 0) {
        const message =
          duplicateNames.length === 1
            ? `"${duplicateNames[0]}" already exists in library`
            : `${duplicateNames.length} files already exist in library`;
        get().showNotification({ type: 'info', message });
      }

      // Show notification for unsupported codecs (non-blocking, files are already imported)
      if (unsupportedCodecFiles.length > 0) {
        const codecList = [
          ...new Set(unsupportedCodecFiles.map((f) => f.audioCodec)),
        ].join(', ');
        get().showNotification({
          type: 'warning',
          message: `${unsupportedCodecFiles.length} file(s) have unsupported audio codec (${codecList}). Waveforms may not be available.`,
        });
      }

      return results;
    },
  };
}
