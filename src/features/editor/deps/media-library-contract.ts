/**
 * Adapter exports for media-library dependencies.
 * Editor modules should import media-library stores/components/utils/services from here.
 */

export { MediaLibrary } from '@/features/media-library/components/media-library';
export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
export { getSharedProxyKey } from '@/features/media-library/utils/proxy-key';
export { cleanupBlobUrls } from '@/features/media-library/utils/media-resolver';

export const importProxyService = () =>
  import('@/features/media-library/services/proxy-service');
export const importMediaLibraryService = () =>
  import('@/features/media-library/services/media-library-service');
export const importThumbnailGenerator = () =>
  import('@/features/media-library/utils/thumbnail-generator');
