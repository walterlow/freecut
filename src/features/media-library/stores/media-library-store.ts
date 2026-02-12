import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaLibraryState, MediaLibraryActions, MediaLibraryNotification, BrokenMediaInfo, OrphanedClipInfo, UnsupportedCodecFile } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { getMimeType } from '../utils/validation';
import { createLogger } from '@/lib/logger';
import { removeItems, updateItem } from '@/features/timeline/stores/timeline-actions';
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store';
import { proxyService } from '../services/proxy-service';

const logger = createLogger('MediaLibraryStore');

export const useMediaLibraryStore = create<
  MediaLibraryState & MediaLibraryActions
>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentProjectId: null, // v3: Project context
      mediaItems: [],
      isLoading: true, // Start loading until project context is set
      importingIds: [],
      error: null,
      notification: null,
      selectedMediaIds: [],
      searchQuery: '',
      filterByType: null,
      sortBy: 'date',
      viewMode: 'grid',

      // Broken media tracking (lazy detection)
      brokenMediaIds: [],
      brokenMediaInfo: new Map<string, BrokenMediaInfo>(),
      showMissingMediaDialog: false,

      // Orphaned clips tracking (clips referencing deleted media)
      orphanedClips: [],
      showOrphanedClipsDialog: false,

      // Unsupported audio codec confirmation
      unsupportedCodecFiles: [],
      showUnsupportedCodecDialog: false,
      unsupportedCodecResolver: null,

      // Proxy video generation
      proxyStatus: new Map(),
      proxyProgress: new Map(),

      // v3: Set current project context
      setCurrentProject: (projectId: string | null) => {
        // Clear items and set loading state immediately to prevent flash
        set({
          currentProjectId: projectId,
          mediaItems: [],
          selectedMediaIds: [],
          isLoading: !!projectId, // Set loading if switching to a project
        });
        // Note: loadMediaItems is triggered by the component's useEffect
        // Don't call it here to avoid double loading
      },

      // Load media items for current project (v3: project-scoped)
      loadMediaItems: async () => {
        const { currentProjectId } = get();

        // Don't load if no project context - keep loading state until project is set
        if (!currentProjectId) {
          return;
        }

        set({ isLoading: true, error: null });

        try {
          // v3: Load project-scoped media only
          const mediaItems = await mediaLibraryService.getMediaForProject(currentProjectId);

          set({
            mediaItems,
            isLoading: false,
          });

          // Load existing proxies from OPFS (previously generated on-demand)
          const videoItems = mediaItems.filter(
            (m) => m.mimeType.startsWith('video/') && proxyService.needsProxy(m.width, m.height, m.mimeType)
          );
          if (videoItems.length > 0) {
            const videoIds = videoItems.map((m) => m.id);
            await proxyService.loadExistingProxies(videoIds);
          }
        } catch (error) {
          logger.error('[MediaLibraryStore] loadMediaItems error:', error);
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load media';
          set({ error: errorMessage, isLoading: false });
          throw error;
        }
      },

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
          set({ error: 'File picker not supported. Please use Google Chrome.' });
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
            const message = duplicateNames.length === 1
              ? `"${duplicateNames[0]}" already exists in library`
              : `${duplicateNames.length} files already exist in library`;
            get().showNotification({ type: 'info', message });
          }

          // Show notification for unsupported codecs (non-blocking, files are already imported)
          if (unsupportedCodecFiles.length > 0) {
            const codecList = [...new Set(unsupportedCodecFiles.map(f => f.audioCodec))].join(', ');
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
            logger.debug(`[importHandles] Processing ${file.name} (${file.size} bytes)`);
            const metadata = await mediaLibraryService.importMediaWithHandle(
              handle,
              currentProjectId
            );
            logger.debug(`[importHandles] Result for ${file.name}:`, { isDuplicate: metadata.isDuplicate, id: metadata.id });
            return { metadata, tempId, file, handle };
          })
        );

        // Process results
        for (const result of importResults) {
          if (result.status === 'fulfilled') {
            const { metadata, tempId, file, handle } = result.value;

            if (metadata.isDuplicate) {
              // File already exists - remove temp item
              logger.debug(`[importHandles] ${file.name} is duplicate, removing temp item`);
              set((state) => ({
                mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
              duplicateNames.push(file.name);
            } else {
              // Replace temp with actual metadata
              logger.debug(`[importHandles] ${file.name} imported successfully with id ${metadata.id}`);
              set((state) => ({
                mediaItems: state.mediaItems.map((item) =>
                  item.id === tempId ? metadata : item
                ),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
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
              logger.error(`[importHandles] Failed to import ${failedTask.file.name}:`, result.reason);
            }
          }
        }

        logger.debug(`[importHandles] Import complete. Results: ${results.length}, Duplicates: ${duplicateNames.length}`);

        // Show batched notification for duplicates
        if (duplicateNames.length > 0) {
          const message = duplicateNames.length === 1
            ? `"${duplicateNames[0]}" already exists in library`
            : `${duplicateNames.length} files already exist in library`;
          get().showNotification({ type: 'info', message });
        }

        // Show notification for unsupported codecs (non-blocking, files are already imported)
        if (unsupportedCodecFiles.length > 0) {
          const codecList = [...new Set(unsupportedCodecFiles.map(f => f.audioCodec))].join(', ');
          get().showNotification({
            type: 'warning',
            message: `${unsupportedCodecFiles.length} file(s) have unsupported audio codec (${codecList}). Waveforms may not be available.`,
          });
        }

        return results;
      },

      // Delete a media item (v3: project-scoped with reference counting)
      deleteMedia: async (id: string) => {
        const { currentProjectId } = get();
        set({ error: null });

        const previousItems = get().mediaItems;

        // Optimistic remove
        set((state) => ({
          mediaItems: state.mediaItems.filter((item) => item.id !== id),
          selectedMediaIds: state.selectedMediaIds.filter(
            (selectedId) => selectedId !== id
          ),
        }));

        try {
          // v3: Use project-scoped delete with reference counting
          if (currentProjectId) {
            await mediaLibraryService.deleteMediaFromProject(currentProjectId, id);
          } else {
            await mediaLibraryService.deleteMedia(id);
          }

        } catch (error) {
          // Rollback on error
          set({
            mediaItems: previousItems,
            error: error instanceof Error ? error.message : 'Delete failed',
          });
          throw error;
        }
      },

      // Delete multiple media items in batch (v3: project-scoped)
      deleteMediaBatch: async (ids: string[]) => {
        const { currentProjectId } = get();
        set({ error: null });

        const previousItems = get().mediaItems;

        // Optimistic remove
        set((state) => ({
          mediaItems: state.mediaItems.filter((item) => !ids.includes(item.id)),
          selectedMediaIds: state.selectedMediaIds.filter(
            (selectedId) => !ids.includes(selectedId)
          ),
        }));

        try {
          // v3: Use project-scoped delete with reference counting
          if (currentProjectId) {
            await mediaLibraryService.deleteMediaBatchFromProject(currentProjectId, ids);
          } else {
            await mediaLibraryService.deleteMediaBatch(ids);
          }

        } catch (error) {
          // Rollback on error
          set({
            mediaItems: previousItems,
            error:
              error instanceof Error ? error.message : 'Batch delete failed',
          });
          throw error;
        }
      },

      // Selection management
      selectMedia: (ids) => set({ selectedMediaIds: ids }),

      toggleMediaSelection: (id) =>
        set((state) => ({
          selectedMediaIds: state.selectedMediaIds.includes(id)
            ? state.selectedMediaIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedMediaIds, id],
        })),

      clearSelection: () => set({ selectedMediaIds: [] }),

      // Filters and search
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterByType: (type) => set({ filterByType: type }),
      setSortBy: (sortBy) => set({ sortBy }),
      setViewMode: (viewMode) => set({ viewMode }),

      // Utility actions
      clearError: () => set({ error: null }),

      showNotification: (notification: MediaLibraryNotification) => {
        set({ notification });
        // Auto-clear after 4 seconds
        setTimeout(() => {
          set((state) =>
            state.notification === notification ? { notification: null } : state
          );
        }, 4000);
      },

      clearNotification: () => set({ notification: null }),

      // Broken media / Relinking actions
      markMediaBroken: (id: string, info: BrokenMediaInfo) => {
        set((state) => {
          // Don't add if already marked
          if (state.brokenMediaIds.includes(id)) {
            return state;
          }
          const newInfo = new Map(state.brokenMediaInfo);
          newInfo.set(id, info);
          return {
            brokenMediaIds: [...state.brokenMediaIds, id],
            brokenMediaInfo: newInfo,
          };
        });
      },

      markMediaHealthy: (id: string) => {
        set((state) => {
          const newInfo = new Map(state.brokenMediaInfo);
          newInfo.delete(id);
          return {
            brokenMediaIds: state.brokenMediaIds.filter((bid) => bid !== id),
            brokenMediaInfo: newInfo,
          };
        });
      },

      relinkMedia: async (mediaId: string, newHandle: FileSystemFileHandle) => {
        try {
          // Update in service/DB
          const updated = await mediaLibraryService.relinkMediaHandle(mediaId, newHandle);

          // Update local state
          set((state) => ({
            mediaItems: state.mediaItems.map((item) =>
              item.id === mediaId ? updated : item
            ),
          }));

          // Clear broken status
          get().markMediaHealthy(mediaId);
          get().showNotification({
            type: 'success',
            message: `"${updated.fileName}" relinked successfully`,
          });

          return true;
        } catch (error) {
          logger.error(`[MediaLibraryStore] relinkMedia error:`, error);
          get().showNotification({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to relink file',
          });
          return false;
        }
      },

      relinkMediaBatch: async (relinks) => {
        const success: string[] = [];
        const failed: string[] = [];

        for (const { mediaId, handle } of relinks) {
          try {
            const updated = await mediaLibraryService.relinkMediaHandle(mediaId, handle);

            // Update local state
            set((state) => ({
              mediaItems: state.mediaItems.map((item) =>
                item.id === mediaId ? updated : item
              ),
            }));

            // Clear broken status
            get().markMediaHealthy(mediaId);
            success.push(mediaId);
          } catch (error) {
            logger.error(`[MediaLibraryStore] relinkMediaBatch error for ${mediaId}:`, error);
            failed.push(mediaId);
          }
        }

        // Show summary notification
        if (success.length > 0) {
          get().showNotification({
            type: failed.length > 0 ? 'warning' : 'success',
            message: `Relinked ${success.length} file${success.length !== 1 ? 's' : ''}${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
          });
        } else if (failed.length > 0) {
          get().showNotification({
            type: 'error',
            message: `Failed to relink ${failed.length} file${failed.length !== 1 ? 's' : ''}`,
          });
        }

        return { success, failed };
      },

      openMissingMediaDialog: () => set({ showMissingMediaDialog: true }),
      closeMissingMediaDialog: () => set({ showMissingMediaDialog: false }),

      // Orphaned clips management
      setOrphanedClips: (clips: OrphanedClipInfo[]) => set({ orphanedClips: clips }),
      clearOrphanedClips: () => set({ orphanedClips: [] }),
      openOrphanedClipsDialog: () => set({ showOrphanedClipsDialog: true }),
      closeOrphanedClipsDialog: () => set({ showOrphanedClipsDialog: false }),

      relinkOrphanedClip: async (itemId: string, newMediaId: string) => {
        try {
          // Get the new media metadata
          const newMedia = await mediaLibraryService.getMedia(newMediaId);
          if (!newMedia) {
            logger.error(`[MediaLibraryStore] relinkOrphanedClip: Media not found: ${newMediaId}`);
            get().showNotification({
              type: 'error',
              message: 'Selected media not found',
            });
            return false;
          }

          // Build updates for the timeline item
          const fps = useTimelineSettingsStore.getState().fps;
          const updates: Record<string, unknown> = {
            mediaId: newMediaId,
            label: newMedia.fileName,
            // Clear cached URLs to force re-resolution
            src: undefined,
            thumbnailUrl: undefined,
            // Clear waveform data for audio clips to force regeneration
            waveformData: undefined,
          };

          // Update source dimensions for video/image items
          if (newMedia.width > 0 && newMedia.height > 0) {
            updates.sourceWidth = newMedia.width;
            updates.sourceHeight = newMedia.height;
          }

          // Update source duration if available
          if (newMedia.duration > 0) {
            updates.sourceDuration = Math.round(newMedia.duration * fps);
          }

          // Update the timeline item
          updateItem(itemId, updates);

          // Clear any cached blob URLs for the old media
          // The new media will be resolved on next render
          logger.debug(`[MediaLibraryStore] Relinked clip ${itemId} to media ${newMediaId}`);

          // Remove from orphaned clips list
          set((state) => ({
            orphanedClips: state.orphanedClips.filter((o) => o.itemId !== itemId),
          }));

          get().showNotification({
            type: 'success',
            message: `Clip relinked to "${newMedia.fileName}"`,
          });

          return true;
        } catch (error) {
          logger.error(`[MediaLibraryStore] relinkOrphanedClip error:`, error);
          get().showNotification({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to relink clip',
          });
          return false;
        }
      },

      removeOrphanedClips: (itemIds: string[]) => {
        try {
          removeItems(itemIds);

          // Remove from orphaned clips list
          set((state) => ({
            orphanedClips: state.orphanedClips.filter((o) => !itemIds.includes(o.itemId)),
          }));

          get().showNotification({
            type: 'info',
            message: `Removed ${itemIds.length} orphaned clip${itemIds.length !== 1 ? 's' : ''}`,
          });
        } catch (error) {
          logger.error(`[MediaLibraryStore] removeOrphanedClips error:`, error);
        }
      },

      // Unsupported audio codec dialog actions
      confirmUnsupportedCodecs: (files: UnsupportedCodecFile[]) => {
        return new Promise<boolean>((resolve) => {
          set({
            unsupportedCodecFiles: files,
            showUnsupportedCodecDialog: true,
            unsupportedCodecResolver: resolve,
          });
        });
      },

      resolveUnsupportedCodecDialog: (confirmed: boolean) => {
        const { unsupportedCodecResolver } = get();
        if (unsupportedCodecResolver) {
          unsupportedCodecResolver(confirmed);
        }
        set({
          unsupportedCodecFiles: [],
          showUnsupportedCodecDialog: false,
          unsupportedCodecResolver: null,
        });
      },

      // Proxy video generation
      setProxyStatus: (mediaId: string, status: 'generating' | 'ready' | 'error') => {
        set((state) => {
          const newStatus = new Map(state.proxyStatus);
          newStatus.set(mediaId, status);
          return { proxyStatus: newStatus };
        });
      },

      setProxyProgress: (mediaId: string, progress: number) => {
        set((state) => {
          const newProgress = new Map(state.proxyProgress);
          newProgress.set(mediaId, progress);
          return { proxyProgress: newProgress };
        });
      },
    }),
    {
      name: 'MediaLibraryStore',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// Wire up proxy service status listener to update store state
proxyService.onStatusChange((mediaId, status, progress) => {
  const store = useMediaLibraryStore.getState();
  store.setProxyStatus(mediaId, status);
  if (progress !== undefined) {
    store.setProxyProgress(mediaId, progress);
  }
});

// Selector hooks for common use cases (optional, but recommended)
export const useFilteredMediaItems = () => {
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const searchQuery = useMediaLibraryStore((s) => s.searchQuery);
  const filterByType = useMediaLibraryStore((s) => s.filterByType);
  const sortBy = useMediaLibraryStore((s) => s.sortBy);

  // Filter by search query
  let filtered = mediaItems;
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((item) =>
      item.fileName.toLowerCase().includes(query)
    );
  }

  // Filter by type
  if (filterByType) {
    filtered = filtered.filter((item) =>
      item.mimeType.startsWith(filterByType)
    );
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.fileName.localeCompare(b.fileName);
      case 'date':
        return b.createdAt - a.createdAt; // Newest first
      case 'size':
        return b.fileSize - a.fileSize; // Largest first
      default:
        return 0;
    }
  });

  return sorted;
};
