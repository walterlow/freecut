/**
 * Adapter exports for media-library dependencies.
 * Editor modules should import media-library stores/components/utils/services from here.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { useEmbeddedSubtitlePickerStore } from '@/features/media-library/stores/embedded-subtitle-picker-store'
export { useSubtitleScanProgressStore } from '@/features/media-library/stores/subtitle-scan-progress-store'
export { getSharedProxyKey } from '@/features/media-library/utils/proxy-key'
export { resolveMediaUrl } from '@/features/media-library/utils/media-resolver'
export {
  clearMediaDragData,
  setMediaDragData,
} from '@/features/media-library/utils/drag-data-cache'
export { MediaLibrary } from '@/features/media-library/components/media-library'

export const importProxyService = () => import('@/features/media-library/services/proxy-service')
export const importMediaLibraryService = () =>
  import('@/features/media-library/services/media-library-service')
export const importMediaAutomationServices = () =>
  import('@/features/media-library/services/media-automation-services')
export const importThumbnailGenerator = () =>
  import('@/features/media-library/utils/thumbnail-generator')
export const importEmbeddedSubtitleTrackPickerHost = () =>
  import('@/features/media-library/components/embedded-subtitle-track-picker-host')
export const importSubtitleScanProgressDialog = () =>
  import('@/features/media-library/components/subtitle-scan-progress-dialog')
