/**
 * Media-library contract consumed by timeline feature adapters.
 */

export { useMediaLibraryStore } from '../stores/media-library-store';
export { mediaLibraryService } from '../services/media-library-service';
export { mediaProcessorService } from '../services/media-processor-service';
export { mediaTranscriptionService } from '../services/media-transcription-service';
export { opfsService } from '../services/opfs-service';
export {
  resolveMediaUrl,
  resolveProxyUrl,
  resolveMediaUrls,
  cleanupBlobUrls,
} from '../utils/media-resolver';
export {
  getMediaDragData,
  setMediaDragData,
  clearMediaDragData,
  type CompositionDragData,
  type TimelineTemplateDragData,
} from '../utils/drag-data-cache';
export {
  extractValidMediaFileEntriesFromDataTransfer,
  supportsFileSystemDragDrop,
} from '../utils/file-drop';
export type { OrphanedClipInfo } from '../types';
export type { ExtractedMediaFileEntry } from '../utils/file-drop';
export { getMediaType, getMimeType } from '../utils/validation';
