import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaLibraryState, MediaLibraryActions, MediaLibraryNotification, BrokenMediaInfo, UnsupportedCodecFile } from '../types';
import { mediaLibraryService } from '../services/media-library-service';
import { createLogger } from '@/lib/logger';
import { proxyService } from '../services/proxy-service';
import { createImportActions } from './media-import-actions';
import { createDeleteActions } from './media-delete-actions';
import { createRelinkingActions } from './media-relinking-actions';

const logger = createLogger('MediaLibraryStore');

/** Tracked timeout for notification auto-clear */
let notificationTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
      clearError: () => set({ error: null }),

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
