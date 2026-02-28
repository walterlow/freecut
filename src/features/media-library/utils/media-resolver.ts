import { mediaLibraryService, FileAccessError } from '@/features/media-library/services/media-library-service';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { proxyService } from '@/features/media-library/services/proxy-service';
import { getSharedProxyKey } from '@/features/media-library/utils/proxy-key';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import type { TimelineTrack } from '@/types/timeline';

/**
 * Pending requests to prevent concurrent OPFS access to the same file
 * This prevents multiple sync access handle creation for the same OPFS file
 */
const pendingRequests = new Map<string, Promise<string>>();

/**
 * Resolves a mediaId to a blob URL for use in Composition Player
 *
 * @param mediaId - The ID of the media in the media library
 * @returns Blob URL for the media, or empty string if not found
 */
export async function resolveMediaUrl(mediaId: string): Promise<string> {
  // Check centralized manager first - URLs persist until explicit release
  const cached = blobUrlManager.get(mediaId);
  if (cached) {
    return cached;
  }

  // Check if there's already a pending request for this media
  if (pendingRequests.has(mediaId)) {
    return pendingRequests.get(mediaId)!;
  }

  // Create the request promise
  const requestPromise = (async () => {
    try {
      // Get media metadata from library
      const media = await mediaLibraryService.getMedia(mediaId);

      if (!media) {
        console.warn(`Media not found: ${mediaId}`);
        return ''; // Fallback: empty string (Composition will skip)
      }

      // Get blob from OPFS (returns Blob to prevent access handle leaks)
      const blob = await mediaLibraryService.getMediaFile(mediaId);

      if (!blob) {
        console.warn(`Media blob not found: ${mediaId}`);
        return '';
      }

      // Acquire blob URL through centralized manager (handles caching + ref counting)
      return blobUrlManager.acquire(mediaId, blob);
    } catch (error) {
      console.error(`Failed to resolve media ${mediaId}:`, error);

      // Mark media as broken if it's a file access error
      if (error instanceof FileAccessError) {
        const media = await mediaLibraryService.getMedia(mediaId);
        useMediaLibraryStore.getState().markMediaBroken(mediaId, {
          mediaId,
          fileName: media?.fileName ?? 'Unknown file',
          errorType: error.type === 'permission_denied' ? 'permission_denied' : 'file_missing',
        });
      }

      return ''; // Fallback: empty string
    } finally {
      // Clean up pending request
      pendingRequests.delete(mediaId);
    }
  })();

  // Store the pending request
  pendingRequests.set(mediaId, requestPromise);

  return requestPromise;
}

/**
 * Resolves a proxy URL for a media item if available.
 * Returns null if no proxy exists (caller should fall back to full-res).
 */
export function resolveProxyUrl(mediaId: string): string | null {
  const media = useMediaLibraryStore.getState().mediaById[mediaId];
  if (media) {
    const proxyKey = getSharedProxyKey(media);
    // Safety net for legacy state restores where the mapping may be missing.
    if (proxyService.getProxyKey(mediaId) !== proxyKey) {
      proxyService.setProxyKey(mediaId, proxyKey);
    }
    return proxyService.getProxyBlobUrl(mediaId, proxyKey);
  }

  return proxyService.getProxyBlobUrl(mediaId);
}

/**
 * Resolves all media URLs in timeline tracks
 * Creates a deep clone of tracks with resolved blob URLs
 *
 * @param tracks - Timeline tracks with media items
 * @param options.useProxy - If true, prefer proxy URLs for video items (default: true)
 * @returns Tracks with resolved blob URLs in item.src
 */
export async function resolveMediaUrls(
  tracks: TimelineTrack[],
  options?: { useProxy?: boolean; signal?: AbortSignal }
): Promise<TimelineTrack[]> {
  const useProxy = options?.useProxy ?? true;
  const signal = options?.signal;

  // Deep clone tracks to avoid mutating original
  const resolvedTracks: TimelineTrack[] = JSON.parse(JSON.stringify(tracks));

  // Resolve all media URLs in parallel
  const resolutionPromises: Promise<void>[] = [];

  for (const track of resolvedTracks) {
    for (const item of track.items) {
      // Only resolve media items with mediaId
      if (
        item.mediaId &&
        (item.type === 'video' || item.type === 'audio' || item.type === 'image')
      ) {
        const promise = resolveMediaUrl(item.mediaId).then((blobUrl) => {
          // For video items in preview mode, prefer proxy URL if available
          if (useProxy && item.type === 'video') {
            const proxyUrl = resolveProxyUrl(item.mediaId!);
            item.src = proxyUrl || blobUrl;
          } else {
            item.src = blobUrl;
          }
        });
        resolutionPromises.push(promise);
      }
    }
  }

  // Wait for all resolutions to complete
  await Promise.all(resolutionPromises);

  // Check if aborted after resolution
  if (signal?.aborted) {
    throw new DOMException('Media resolution aborted', 'AbortError');
  }

  return resolvedTracks;
}

/**
 * Cleans up all cached blob URLs
 * Call this on component unmount to prevent memory leaks
 */
export function cleanupBlobUrls(): void {
  blobUrlManager.releaseAll();
  pendingRequests.clear();
}

