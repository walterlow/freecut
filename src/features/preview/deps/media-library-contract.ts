/**
 * Adapter exports for media-library dependencies.
 * Preview modules should import media-library stores/services/utils from here.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
export { proxyService } from '@/features/media-library/services/proxy-service';
export { getMediaType } from '@/features/media-library/utils/validation';
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
  cleanupBlobUrls,
} from '@/features/media-library/utils/media-resolver';
export { mediaLibraryService, FileAccessError } from '@/features/media-library/services/media-library-service';
