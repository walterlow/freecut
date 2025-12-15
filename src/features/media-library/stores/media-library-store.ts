import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaLibraryState, MediaLibraryActions, MediaLibraryNotification, BrokenMediaInfo } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MediaLibraryStore');

// IMPORTANT: Always use granular selectors to prevent unnecessary re-renders!
//
// ✅ CORRECT: Use granular selectors
// const mediaItems = useMediaLibraryStore(s => s.mediaItems);
// const uploadMedia = useMediaLibraryStore(s => s.uploadMedia);
//
// ❌ WRONG: Don't destructure the entire store
// const { mediaItems, uploadMedia } = useMediaLibraryStore();

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
        } catch (error) {
          logger.error('[MediaLibraryStore] loadMediaItems error:', error);
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load media';
          set({ error: errorMessage, isLoading: false });
          throw error;
        }
      },

      // Import media using file picker (instant, no copy - local-first)
      importMedia: async () => {
        const { currentProjectId } = get();

        if (!currentProjectId) {
          set({ error: 'No project selected' });
          return [];
        }

        // Check if File System Access API is supported
        if (!('showOpenFilePicker' in window)) {
          set({ error: 'File picker not supported in this browser' });
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

          const results: MediaMetadata[] = [];
          const duplicateNames: string[] = [];

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
              mimeType: file.type,
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

            // Optimistic add with importing state
            set((state) => ({
              mediaItems: [tempItem, ...state.mediaItems],
              importingIds: [...state.importingIds, tempId],
              error: null,
            }));

            try {
              const metadata = await mediaLibraryService.importMediaWithHandle(
                handle,
                currentProjectId
              );

              if (metadata.isDuplicate) {
                // File already exists - remove temp item and collect for batch notification
                set((state) => ({
                  mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
                  importingIds: state.importingIds.filter((id) => id !== tempId),
                }));
                duplicateNames.push(file.name);
              } else {
                // Replace temp with actual metadata and clear importing state
                set((state) => ({
                  mediaItems: state.mediaItems.map((item) =>
                    item.id === tempId ? metadata : item
                  ),
                  importingIds: state.importingIds.filter((id) => id !== tempId),
                }));
                results.push(metadata);
              }
            } catch (error) {
              // Rollback this item
              set((state) => ({
                mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
              logger.error(`Failed to import ${file.name}:`, error);
            }
          }

          // Show batched notification for duplicates
          if (duplicateNames.length > 0) {
            const message = duplicateNames.length === 1
              ? `"${duplicateNames[0]}" already exists in library`
              : `${duplicateNames.length} files already exist in library`;
            get().showNotification({ type: 'info', message });
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
      importHandles: async (handles: FileSystemFileHandle[]) => {
        const { currentProjectId } = get();
        logger.debug('[importHandles] Starting import for', handles.length, 'handles');

        if (!currentProjectId) {
          set({ error: 'No project selected' });
          return [];
        }

        const results: MediaMetadata[] = [];
        const duplicateNames: string[] = [];

        for (let i = 0; i < handles.length; i++) {
          const handle = handles[i];
          if (!handle) continue;
          logger.debug(`[importHandles] Processing handle ${i + 1}/${handles.length}:`, handle.name);
          const tempId = crypto.randomUUID();
          const file = await handle.getFile();

          // Create temporary placeholder with 'handle' storage type
          const tempItem: MediaMetadata = {
            id: tempId,
            storageType: 'handle',
            fileHandle: handle,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
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

          // Optimistic add with importing state
          set((state) => ({
            mediaItems: [tempItem, ...state.mediaItems],
            importingIds: [...state.importingIds, tempId],
            error: null,
          }));

          try {
            logger.debug(`[importHandles] Calling importMediaWithHandle for ${file.name} (${file.size} bytes)`);
            const metadata = await mediaLibraryService.importMediaWithHandle(
              handle,
              currentProjectId
            );
            logger.debug(`[importHandles] Result for ${file.name}:`, { isDuplicate: metadata.isDuplicate, id: metadata.id });

            if (metadata.isDuplicate) {
              // File already exists - remove temp item and collect for batch notification
              logger.debug(`[importHandles] ${file.name} is duplicate, removing temp item`);
              set((state) => ({
                mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
              duplicateNames.push(file.name);
            } else {
              // Replace temp with actual metadata and clear importing state
              logger.debug(`[importHandles] ${file.name} imported successfully with id ${metadata.id}`);
              set((state) => ({
                mediaItems: state.mediaItems.map((item) =>
                  item.id === tempId ? metadata : item
                ),
                importingIds: state.importingIds.filter((id) => id !== tempId),
              }));
              results.push(metadata);
            }
          } catch (error) {
            // Rollback this item
            logger.error(`[importHandles] Failed to import ${file.name}:`, error);
            set((state) => ({
              mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
              importingIds: state.importingIds.filter((id) => id !== tempId),
            }));
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
    }),
    {
      name: 'MediaLibraryStore',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// Selector hooks for common use cases (optional, but recommended)
export const useMediaItems = () =>
  useMediaLibraryStore((s) => s.mediaItems);
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
