import type {
  MediaLibraryState,
  MediaLibraryActions,
  BrokenMediaInfo,
  OrphanedClipInfo,
} from '../types';
import { mediaLibraryService } from '../services/media-library-service';
import { removeItems, updateItem } from '@/features/media-library/deps/timeline-actions';
import { useTimelineSettingsStore } from '@/features/media-library/deps/timeline-stores';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaRelinkingActions');

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>)
) => void;
type Get = () => MediaLibraryState & MediaLibraryActions;

export function createRelinkingActions(
  set: Set,
  get: Get
): Pick<
  MediaLibraryActions,
  | 'markMediaBroken'
  | 'markMediaHealthy'
  | 'relinkMedia'
  | 'relinkMediaBatch'
  | 'openMissingMediaDialog'
  | 'closeMissingMediaDialog'
  | 'setOrphanedClips'
  | 'clearOrphanedClips'
  | 'openOrphanedClipsDialog'
  | 'closeOrphanedClipsDialog'
  | 'relinkOrphanedClip'
  | 'removeOrphanedClips'
> {
  return {
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
        const updated = await mediaLibraryService.relinkMediaHandle(
          mediaId,
          newHandle
        );

        // Invalidate stale blob URL so preview re-fetches from the new handle
        blobUrlManager.invalidate(mediaId);

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
        logger.error(`[relinkMedia] error:`, error);
        get().showNotification({
          type: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to relink file',
        });
        return false;
      }
    },

    relinkMediaBatch: async (relinks) => {
      const success: string[] = [];
      const failed: string[] = [];

      for (const { mediaId, handle } of relinks) {
        try {
          const updated = await mediaLibraryService.relinkMediaHandle(
            mediaId,
            handle
          );

          // Invalidate stale blob URL so preview re-fetches from the new handle
          blobUrlManager.invalidate(mediaId);

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
          logger.error(
            `[relinkMediaBatch] error for ${mediaId}:`,
            error
          );
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
    setOrphanedClips: (clips: OrphanedClipInfo[]) =>
      set({ orphanedClips: clips }),
    clearOrphanedClips: () => set({ orphanedClips: [] }),
    openOrphanedClipsDialog: () => set({ showOrphanedClipsDialog: true }),
    closeOrphanedClipsDialog: () => set({ showOrphanedClipsDialog: false }),

    relinkOrphanedClip: async (itemId: string, newMediaId: string) => {
      try {
        // Get the new media metadata
        const newMedia = await mediaLibraryService.getMedia(newMediaId);
        if (!newMedia) {
          logger.error(
            `[relinkOrphanedClip] Media not found: ${newMediaId}`
          );
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
          const sourceFps = newMedia.fps > 0 ? newMedia.fps : fps;
          updates.sourceFps = sourceFps;
          updates.sourceDuration = Math.round(newMedia.duration * sourceFps);
        }

        // Update the timeline item
        updateItem(itemId, updates);

        // Clear any cached blob URLs for the old media
        // The new media will be resolved on next render
        logger.debug(
          `[relinkOrphanedClip] Relinked clip ${itemId} to media ${newMediaId}`
        );

        // Remove from orphaned clips list
        set((state) => ({
          orphanedClips: state.orphanedClips.filter(
            (o) => o.itemId !== itemId
          ),
        }));

        get().showNotification({
          type: 'success',
          message: `Clip relinked to "${newMedia.fileName}"`,
        });

        return true;
      } catch (error) {
        logger.error(`[relinkOrphanedClip] error:`, error);
        get().showNotification({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to relink clip',
        });
        return false;
      }
    },

    removeOrphanedClips: (itemIds: string[]) => {
      try {
        removeItems(itemIds);

        // Remove from orphaned clips list
        set((state) => ({
          orphanedClips: state.orphanedClips.filter(
            (o) => !itemIds.includes(o.itemId)
          ),
        }));

        get().showNotification({
          type: 'info',
          message: `Removed ${itemIds.length} orphaned clip${itemIds.length !== 1 ? 's' : ''}`,
        });
      } catch (error) {
        logger.error(`[removeOrphanedClips] error:`, error);
      }
    },
  };
}

