import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  MediaLibraryState,
  MediaLibraryActions,
  MediaLibraryNotification,
  BrokenMediaInfo,
  UnsupportedCodecFile,
} from '../types';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { createLogger, createOperationId } from '@/shared/logging/logger';
import { proxyService } from '../services/proxy-service';
import { enqueueBackgroundMediaWork } from '../services/background-media-work';
import { getSharedProxyKey } from '../utils/proxy-key';
import { createImportActions } from './media-import-actions';
import { createDeleteActions } from './media-delete-actions';
import { createRelinkingActions } from './media-relinking-actions';
import { getTranscriptMediaIds } from '@/infrastructure/storage/indexeddb';
import { mergeTranscriptionProgress } from '@/shared/utils/transcription-progress';

const logger = createLogger('MediaLibraryStore');
const BACKGROUND_PROXY_DELAY_MS = 2500;

/** Tracked timeout for notification auto-clear */
let notificationTimeoutId: ReturnType<typeof setTimeout> | null = null;

function buildMediaById(mediaItems: MediaMetadata[]): Record<string, MediaMetadata> {
  const mediaById: Record<string, MediaMetadata> = {};
  for (const item of mediaItems) {
    mediaById[item.id] = item;
  }
  return mediaById;
}

function buildTranscriptStatusMap(
  mediaItems: MediaMetadata[],
  transcriptIds?: Set<string>
): Map<string, 'idle' | 'ready'> {
  const nextTranscriptStatus = new Map<string, 'idle' | 'ready'>();
  for (const item of mediaItems) {
    nextTranscriptStatus.set(item.id, transcriptIds?.has(item.id) ? 'ready' : 'idle');
  }
  return nextTranscriptStatus;
}

async function loadTranscriptStatusMap(
  mediaItems: MediaMetadata[]
): Promise<Map<string, 'idle' | 'ready'>> {
  try {
    const transcriptIds = await getTranscriptMediaIds(mediaItems.map((item) => item.id));
    return buildTranscriptStatusMap(mediaItems, transcriptIds);
  } catch (error) {
    logger.warn('[MediaLibraryStore] Failed to load transcript availability:', error);
    return buildTranscriptStatusMap(mediaItems);
  }
}

function getProxyCapableVideoItems(mediaItems: MediaMetadata[]): MediaMetadata[] {
  return mediaItems.filter(
    (item) => proxyService.canGenerateProxy(item.mimeType)
  );
}

function enqueueBackgroundProxies(
  videoItems: MediaMetadata[],
  reason: 'recovery' | 'automatic',
): void {
  videoItems.forEach((item) => {
    try {
      enqueueBackgroundMediaWork(() => {
        proxyService.generateProxy(
          item.id,
          () => mediaLibraryService.getMediaFile(item.id),
          item.width,
          item.height,
          getSharedProxyKey(item),
          { priority: 'background' }
        );
      }, {
        priority: 'heavy',
        delayMs: BACKGROUND_PROXY_DELAY_MS,
      });
    } catch (error) {
      logger.warn(`[MediaLibraryStore] Failed to enqueue ${reason} proxy generation for ${item.id}:`, error);
    }
  });
}

async function initializeProxyState(mediaItems: MediaMetadata[]): Promise<void> {
  const videoItems = getProxyCapableVideoItems(mediaItems);

  if (videoItems.length === 0) {
    return;
  }

  for (const item of videoItems) {
    proxyService.setProxyKey(item.id, getSharedProxyKey(item));
  }

  const staleProxyIds = await proxyService.loadExistingProxies(videoItems.map((item) => item.id));
  const staleProxyIdSet = new Set(staleProxyIds);
  enqueueBackgroundProxies(
    videoItems.filter((item) => staleProxyIdSet.has(item.id)),
    'recovery'
  );

  const automaticProxyCandidates = videoItems.filter((item) => {
    if (staleProxyIdSet.has(item.id)) {
      return false;
    }

    if (!proxyService.needsProxy(item.width, item.height, item.mimeType, item.audioCodec, item.id)) {
      return false;
    }

    return !proxyService.hasProxy(item.id, getSharedProxyKey(item));
  });

  enqueueBackgroundProxies(automaticProxyCandidates, 'automatic');
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
      selectedCompositionIds: [],
      searchQuery: '',
      filterByType: null,
      sortBy: 'date',
      viewMode: 'grid',
      mediaItemSize: 1,

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

      // Transcript generation
      transcriptStatus: new Map(),
      transcriptProgress: new Map(),

      // AI tagging
      taggingMediaIds: new Set(),

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
          selectedCompositionIds: [],
          isLoading: !!projectId, // Set loading if switching to a project
          proxyStatus: new Map(),
          proxyProgress: new Map(),
          transcriptStatus: new Map(),
          transcriptProgress: new Map(),
          taggingMediaIds: new Set(),
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

        const opId = createOperationId();
        const event = logger.startEvent('loadMediaItems', opId);
        event.set('projectId', currentProjectId);

        try {
          // v3: Load project-scoped media only
          const mediaItems = await mediaLibraryService.getMediaForProject(currentProjectId);

          set({
            mediaItems,
            mediaById: buildMediaById(mediaItems),
            isLoading: false,
          });

          event.set('mediaCount', mediaItems.length);

          const transcriptStatus = await loadTranscriptStatusMap(mediaItems);
          set({
            transcriptStatus,
            transcriptProgress: new Map(),
          });

          event.set('transcriptsReady', [...transcriptStatus.values()].filter((s) => s === 'ready').length);

          // Load existing proxies from OPFS, recover interrupted jobs, and
          // auto-generate missing smart proxies in the background.
          try {
            await initializeProxyState(mediaItems);
          } catch (error) {
            logger.warn('[MediaLibraryStore] Proxy initialization failed:', error);
          }

          event.success({ mediaCount: mediaItems.length });
        } catch (error) {
          event.failure(error instanceof Error ? error : new Error(String(error)));
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
      setSelection: ({ mediaIds, compositionIds }) => set({
        selectedMediaIds: mediaIds,
        selectedCompositionIds: compositionIds,
      }),

      selectMedia: (ids) => set({ selectedMediaIds: ids }),

      selectCompositions: (ids) => set({ selectedCompositionIds: ids }),

      toggleMediaSelection: (id) =>
        set((state) => ({
          selectedMediaIds: state.selectedMediaIds.includes(id)
            ? state.selectedMediaIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedMediaIds, id],
        })),

      toggleCompositionSelection: (id) =>
        set((state) => ({
          selectedCompositionIds: state.selectedCompositionIds.includes(id)
            ? state.selectedCompositionIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedCompositionIds, id],
        })),

      clearSelection: () => set({ selectedMediaIds: [], selectedCompositionIds: [] }),

      // Filters and search
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterByType: (type) => set({ filterByType: type }),
      setSortBy: (sortBy) => set({ sortBy }),
      setViewMode: (viewMode) => set({ viewMode }),
      setMediaItemSize: (size) => set({ mediaItemSize: Math.max(1, Math.min(5, size)) }),

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

      setTranscriptStatus: (mediaId, status) => {
        set((state) => {
          const transcriptStatus = new Map(state.transcriptStatus);
          transcriptStatus.set(mediaId, status);
          return { transcriptStatus };
        });
      },

      setTranscriptProgress: (mediaId, progress) => {
        set((state) => {
          const transcriptProgress = new Map(state.transcriptProgress);
          transcriptProgress.set(
            mediaId,
            mergeTranscriptionProgress(transcriptProgress.get(mediaId), progress)
          );
          return { transcriptProgress };
        });
      },

      clearTranscriptProgress: (mediaId) => {
        set((state) => {
          const transcriptProgress = new Map(state.transcriptProgress);
          transcriptProgress.delete(mediaId);
          return { transcriptProgress };
        });
      },

      // AI tagging
      setTaggingMedia: (mediaId, active) => {
        set((state) => {
          const taggingMediaIds = new Set(state.taggingMediaIds);
          if (active) {
            taggingMediaIds.add(mediaId);
          } else {
            taggingMediaIds.delete(mediaId);
          }
          return { taggingMediaIds };
        });
      },

      updateMediaCaptions: (mediaId, captions) => {
        set((state) => {
          const mediaItems = state.mediaItems.map((item) =>
            item.id === mediaId ? { ...item, aiCaptions: captions, updatedAt: Date.now() } : item
          );
          return { mediaItems };
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
  if (status === 'idle') {
    store.clearProxyStatus(mediaId);
    return;
  }
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

  // Filter by search query (matches filename and AI-generated captions)
  let filtered = mediaItems;
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter((item) =>
      item.fileName.toLowerCase().includes(query) ||
      item.aiCaptions?.some((c) => c.text.toLowerCase().includes(query))
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
