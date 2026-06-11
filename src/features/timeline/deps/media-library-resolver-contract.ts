export { mediaProcessorService } from '@/features/media-library/services/media-processor-service'
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
} from '@/features/media-library/utils/media-resolver'
export {
  getMediaDragData,
  clearMediaDragData,
  type CompositionDragData,
} from '@/features/media-library/utils/drag-data-cache'
export {
  extractValidMediaFileEntriesFromDataTransfer,
  formatMediaDropRejectionMessage,
} from '@/features/media-library/utils/file-drop'
export type { OrphanedClipInfo } from '@/features/media-library/types'
export type { ExtractedMediaFileEntry } from '@/features/media-library/utils/file-drop'
export { getMediaType, getMimeType } from '@/features/media-library/utils/validation'
