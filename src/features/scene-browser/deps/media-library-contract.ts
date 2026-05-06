/**
 * Cross-feature adapter contract — scene-browser accesses media-library
 * state and helpers through this file so the import graph is auditable.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export { getMediaType, formatDuration } from '@/features/media-library/utils/validation'
export { mediaLibraryService } from '@/features/media-library/services/media-library-service'
export { mediaAnalysisService } from '@/features/media-library/services/media-analysis-service'
export type { MediaLibraryNotification } from '@/features/media-library/types'
