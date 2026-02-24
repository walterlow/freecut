import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaLibraryState, MediaLibraryActions, MediaLibraryNotification, BrokenMediaInfo, UnsupportedCodecFile } from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { createLogger } from '@/lib/logger';
import { proxyService } from '../services/proxy-service';
import { getSharedProxyKey } from '../utils/proxy-key';
import { createImportActions } from './media-import-actions';
import { createDeleteActions } from './media-delete-actions';
import { createRelinkingActions } from './media-relinking-actions';

const logger = createLogger('MediaLibraryStore');

/** Tracked timeout for notification auto-clear */
let notificationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function buildMediaById(mediaItems: MediaMetadata[]): Record<string, MediaMetadata> {
  const mediaById: Record<string, MediaMetadata> = {};
  for (const item of mediaItems) {
    mediaById[item.id] = item;
  }
  return mediaById;
}

export const useMediaLibraryStore = create<
  MediaLibraryState & MediaLibraryActions
>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentProjectId: null, // v3: Project context
      mediaItems: [],
      mediaById: {},
      isLoading: false, // Only load once a project context is available
      importingIds: [],
      error: null,
      errorLink: null,
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
        const previousMediaIds = get().mediaItems.map((item) => item.id);
        for (const mediaId of previousMediaIds) {
          proxyService.clearProxyKey(mediaId);
        }

        // Clear items and set loading state immediately to prevent flash
        set({
          currentProjectId: projectId,
          mediaItems: [],
          mediaById: {},
          selectedMediaIds: [],
          isLoading: !!projectId, // Set loading if switching to a project
          proxyStatus: new Map(),
          proxyProgress: new Map(),
        });
        // Note: loadMediaItems is triggered by the component's useEffect
        // Don't call it here to avoid double loading
      },

      // Load media items for current project (v3: project-scoped)
      loadMediaItems: async () => {
        const { currentProjectId } = get();

        // Don't load without project context; ensure loading state is cleared.
        if (!currentProjectId) {
          set({ isLoading: false });
          return;
        }

        set({ isLoading: true, error: null });

        try {
          // v3: Load project-scoped media only
          const mediaItems = await mediaLibraryService.getMediaForProject(currentProjectId);

          set({
            mediaItems,
            mediaById: buildMediaById(mediaItems),
            isLoading: false,
          });

          // Load existing proxies from OPFS and regenerate stale entries in the background.
          try {
            const videoItems = mediaItems.filter(
              (m) => m.mimeType.startsWith('video/')
                && proxyService.needsProxy(m.width, m.height, m.mimeType, m.audioCodec)
            );

            if (videoItems.length > 0) {
              for (const item of videoItems) {
                proxyService.setProxyKey(item.id, getSharedProxyKey(item));
              }

              const videoIds = videoItems.map((m) => m.id);
              const staleProxyIds = await proxyService.loadExistingProxies(videoIds);

              if (staleProxyIds.length > 0) {
                const staleProxyIdSet = new Set(staleProxyIds);
                const staleVideoItems = videoItems.filter((item) => staleProxyIdSet.has(item.id));
                const blobUrlResults = await Promise.allSettled(
                  staleVideoItems.map((item) => mediaLibraryService.getMediaBlobUrl(item.id))
                );

                blobUrlResults.forEach((result, index) => {
                  const item = staleVideoItems[index];
                  if (!item) {
                    return;
                  }

                  if (result.status !== 'fulfilled') {
                    logger.warn(`[MediaLibraryStore] Failed to load source blob URL for stale proxy ${item.id}:`, result.reason);
                    return;
                  }

                  const blobUrl = result.value;
                  if (!blobUrl) {
                    logger.warn(`[MediaLibraryStore] Missing source blob URL for stale proxy ${item.id}`);
                    return;
                  }

                  try {
                    proxyService.generateProxy(
                      item.id,
                      blobUrl,
                      item.width,
                      item.height,
                      getSharedProxyKey(item)
                    );
                  } catch (error) {
                    logger.warn(`[MediaLibraryStore] Failed to enqueue stale proxy regeneration for ${item.id}:`, error);
                  }
                });
              }
            }
          } catch (error) {
            logger.warn('[MediaLibraryStore] Proxy initialization failed:', error);
          }
        } catch (error) {
          logger.error('[MediaLibraryStore] loadMediaItems error:', error);
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to load media';
          set({ error: errorMessage, isLoading: false });
          throw error;
        }
      },

      // Extracted action groups
      ...createImportActions(set, get),
      ...createDeleteActions(set, get),
      ...createRelinkingActions(set, get),

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
      clearError: () => set({ error: null, errorLink: null }),

      showNotification: (notification: MediaLibraryNotification) => {
        set({ notification });
        // Clear any previous auto-clear timer
        if (notificationTimeoutId !== null) {
          clearTimeout(notificationTimeoutId);
        }
        // Auto-clear after 4 seconds
        notificationTimeoutId = setTimeout(() => {
          notificationTimeoutId = null;
          set((state) =>
            state.notification === notification ? { notification: null } : state
          );
        }, 4000);
      },

      clearNotification: () => {
        if (notificationTimeoutId !== null) {
          clearTimeout(notificationTimeoutId);
          notificationTimeoutId = null;
        }
        set({ notification: null });
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

      clearProxyStatus: (mediaId: string) => {
        set((state) => {
          const newStatus = new Map(state.proxyStatus);
          newStatus.delete(mediaId);
          const newProgress = new Map(state.proxyProgress);
          newProgress.delete(mediaId);
          return { proxyStatus: newStatus, proxyProgress: newProgress };
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
      enabled: import.meta.env.DEV,
    }
  )
);

// Keep mediaById synchronized even when action modules update mediaItems directly.
let prevMediaItemsRef = useMediaLibraryStore.getState().mediaItems;
useMediaLibraryStore.subscribe((state) => {
  if (state.mediaItems === prevMediaItemsRef) {
    return;
  }
  prevMediaItemsRef = state.mediaItems;
  useMediaLibraryStore.setState({ mediaById: buildMediaById(state.mediaItems) });
});

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
