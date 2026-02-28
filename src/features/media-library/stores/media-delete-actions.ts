import type { MediaLibraryState, MediaLibraryActions } from '../types';
import { mediaLibraryService } from '../services/media-library-service';
import { proxyService } from '../services/proxy-service';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)
) => void;
type Get = () => MediaLibraryState & MediaLibraryActions;

export function createDeleteActions(
  set: Set,
  get: Get
): Pick<MediaLibraryActions, 'deleteMedia' | 'deleteMediaBatch'> {
  return {
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

        // Release cached blob URL for deleted media
        blobUrlManager.release(id);
        proxyService.clearProxyKey(id);
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
          await mediaLibraryService.deleteMediaBatchFromProject(
            currentProjectId,
            ids
          );
        } else {
          await mediaLibraryService.deleteMediaBatch(ids);
        }

        // Release cached blob URLs for deleted media
        for (const id of ids) {
          blobUrlManager.release(id);
          proxyService.clearProxyKey(id);
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
  };
}

