import { createLogger } from '@/shared/logging/logger';
import {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
  renderSingleFrame,
  resolveMediaUrl,
  resolveMediaUrls,
  useCompositionsStore,
  type SubComposition,
} from '../deps/timeline-contract';

const logger = createLogger('CompoundClipThumbnailService');
const THUMBNAIL_MAX_SIZE = 320;

function getThumbnailDimensions(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  if (safeWidth >= safeHeight) {
    return {
      width: maxSize,
      height: Math.max(1, Math.floor((maxSize * safeHeight) / safeWidth)),
    };
  }

  return {
    width: Math.max(1, Math.floor((maxSize * safeWidth) / safeHeight)),
    height: maxSize,
  };
}

class CompoundClipThumbnailService {
  private thumbnailUrlCache = new Map<string, { signature: string; url: string }>();
  private pending = new Map<string, { signature: string; promise: Promise<string | null> }>();

  async getThumbnailBlobUrl(
    compositionId: string,
  ): Promise<string | null> {
    const compositionById = useCompositionsStore.getState().compositionById;
    const composition = compositionById[compositionId];
    if (!composition) {
      return null;
    }

    if (typeof OffscreenCanvas !== 'function') {
      return null;
    }

    const signature = buildSubCompositionPreviewSignature(compositionId, compositionById);
    const cached = this.thumbnailUrlCache.get(compositionId);
    if (cached?.signature === signature) {
      return cached.url;
    }

    const pending = this.pending.get(compositionId);
    if (pending?.signature === signature) {
      return pending.promise;
    }

    const promise = this.generateThumbnailBlobUrl(
      composition,
      compositionById,
      signature,
    ).finally(() => {
      const currentPending = this.pending.get(compositionId);
      if (currentPending?.promise === promise) {
        this.pending.delete(compositionId);
      }
    });

    this.pending.set(compositionId, { signature, promise });
    return promise;
  }

  private async generateThumbnailBlobUrl(
    composition: SubComposition,
    compositionById: Record<string, SubComposition | undefined>,
    signature: string,
  ): Promise<string | null> {
    const compositionId = composition.id;

    try {
      const mediaIds = collectSubCompositionMediaIds(compositionId, compositionById);
      await Promise.all(mediaIds.map((mediaId) => resolveMediaUrl(mediaId)));

      const compositionInput = buildSubCompositionInput(composition);
      const resolvedTracks = await resolveMediaUrls(compositionInput.tracks, { useProxy: false });
      const thumbnailDimensions = getThumbnailDimensions(
        composition.width,
        composition.height,
        THUMBNAIL_MAX_SIZE,
      );

      const thumbnailBlob = await renderSingleFrame({
        composition: {
          ...compositionInput,
          tracks: resolvedTracks,
        },
        frame: getSubCompositionThumbnailFrame(composition.durationInFrames),
        width: thumbnailDimensions.width,
        height: thumbnailDimensions.height,
        quality: 0.8,
        format: 'image/jpeg',
      });

      const nextUrl = URL.createObjectURL(thumbnailBlob);
      const currentPending = this.pending.get(compositionId);
      if (currentPending?.signature !== signature) {
        URL.revokeObjectURL(nextUrl);
        return this.thumbnailUrlCache.get(compositionId)?.url ?? null;
      }

      const previous = this.thumbnailUrlCache.get(compositionId);
      if (previous && previous.url !== nextUrl) {
        URL.revokeObjectURL(previous.url);
      }

      this.thumbnailUrlCache.set(compositionId, { signature, url: nextUrl });
      return nextUrl;
    } catch (error) {
      logger.warn(`Failed to generate thumbnail for compound clip ${compositionId}:`, error);
      return this.thumbnailUrlCache.get(compositionId)?.url ?? null;
    }
  }

  clearThumbnailCache(compositionId: string): void {
    const cached = this.thumbnailUrlCache.get(compositionId);
    if (!cached) {
      return;
    }

    URL.revokeObjectURL(cached.url);
    this.thumbnailUrlCache.delete(compositionId);
  }
}

export const compoundClipThumbnailService = new CompoundClipThumbnailService();
