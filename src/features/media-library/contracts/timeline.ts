/**
 * Media-library contract consumed by timeline feature adapters.
 */

export { useMediaLibraryStore } from '../stores/media-library-store';
export { mediaLibraryService } from '../services/media-library-service';
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
} from '../utils/drag-data-cache';
export {
  extractValidMediaFileEntriesFromDataTransfer,
  supportsFileSystemDragDrop,
} from '../utils/file-drop';
export type { OrphanedClipInfo } from '../types';
export { getMediaType } from '../utils/validation';
