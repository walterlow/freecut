import { mediaLibraryService, FileAccessError } from '@/features/media-library/services/media-library-service';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import type { TimelineTrack } from '@/types/timeline';

/**
 * Cache to prevent creating duplicate blob URLs for the same media
 */
const blobUrlCache = new Map<string, string>();

/**
 * Pending requests to prevent concurrent OPFS access to the same file
 * This prevents multiple sync access handle creation for the same OPFS file
 */
const pendingRequests = new Map<string, Promise<string>>();

/**
 * Resolves a mediaId to a blob URL for use in Remotion Player
 *
 * @param mediaId - The ID of the media in the media library
 * @returns Blob URL for the media, or empty string if not found
 */
export async function resolveMediaUrl(mediaId: string): Promise<string> {
  // Check cache first
  if (blobUrlCache.has(mediaId)) {
    return blobUrlCache.get(mediaId)!;
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
        return ''; // Fallback: empty string (Remotion will skip)
      }

      // Get blob from OPFS (returns Blob to prevent access handle leaks)
      const blob = await mediaLibraryService.getMediaFile(mediaId);

      if (!blob) {
        console.warn(`Media blob not found: ${mediaId}`);
        return '';
      }

      // Create blob URL from the Blob object
      const blobUrl = URL.createObjectURL(blob);

      // Cache it to prevent memory leaks and improve performance
      blobUrlCache.set(mediaId, blobUrl);

      return blobUrl;
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
 * Resolves all media URLs in timeline tracks
 * Creates a deep clone of tracks with resolved blob URLs
 *
 * @param tracks - Timeline tracks with media items
 * @returns Tracks with resolved blob URLs in item.src
 */
export async function resolveMediaUrls(tracks: TimelineTrack[]): Promise<TimelineTrack[]> {
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
          item.src = blobUrl;
        });
        resolutionPromises.push(promise);
      }
    }
  }

  // Wait for all resolutions to complete
  await Promise.all(resolutionPromises);

  return resolvedTracks;
}

/**
 * Cleans up all cached blob URLs
 * Call this on component unmount to prevent memory leaks
 */
export function cleanupBlobUrls(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
  pendingRequests.clear(); // Clear any pending requests
}

/**
 * Revokes a specific blob URL from the cache
 *
 * @param mediaId - The media ID whose blob URL should be revoked
 */
export function revokeBlobUrl(mediaId: string): void {
  const url = blobUrlCache.get(mediaId);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrlCache.delete(mediaId);
  }
}
