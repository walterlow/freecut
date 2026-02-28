/**
 * Adapter exports for media-library dependencies.
 * Export modules should import media resolution helpers from here.
 */

import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';

export {
  resolveMediaUrl,
  resolveMediaUrls,
  resolveProxyUrl,
  cleanupBlobUrls,
} from '@/features/media-library/utils/media-resolver';

export function getMediaAudioCodecById(mediaId: string | undefined): string | undefined {
  if (!mediaId) return undefined;

  const media = useMediaLibraryStore.getState().mediaById[mediaId];
  if (!media) return undefined;

  if (media.mimeType.startsWith('video/')) {
    return media.audioCodec;
  }
  if (media.mimeType.startsWith('audio/')) {
    return media.codec;
  }
  return undefined;
}
