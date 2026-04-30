/**
 * Adapter exports for media-library dependencies.
 * Preview modules should import media-library stores/services/utils from here.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { proxyService } from '@/features/media-library/services/proxy-service'
export { mediaProcessorService } from '@/features/media-library/services/media-processor-service'
export { getMediaType, getMimeType } from '@/features/media-library/utils/validation'
export { getProjectBrokenMediaIds } from '@/features/media-library/utils/broken-media'
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
  cleanupBlobUrls,
} from '@/features/media-library/utils/media-resolver'
export {
  mediaLibraryService,
  FileAccessError,
} from '@/features/media-library/services/media-library-service'
export {
  extractValidMediaFileEntriesFromDataTransfer,
  supportsFileSystemDragDrop,
} from '@/features/media-library/utils/file-drop'
export {
  getMediaDragData,
  clearMediaDragData,
} from '@/features/media-library/utils/drag-data-cache'
