/**
 * Cross-feature adapter contract — scene-browser accesses media-library
 * state and helpers through this file so the import graph is auditable.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { getMediaType, formatDuration } from '@/features/media-library/utils/validation'
export { importMediaLibraryService } from '@/features/media-library/services/media-library-service-loader'
export { importMediaAnalysisService } from '@/features/media-library/services/media-analysis-service-loader'
export type { MediaLibraryNotification } from '@/features/media-library/types'
