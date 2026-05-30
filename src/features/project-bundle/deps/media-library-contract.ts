/**
 * Adapter exports for media-library dependencies.
 * Project-bundle modules should import media services/utilities from here.
 */

export { importMediaLibraryService } from '@/features/media-library/services/media-library-service-loader'
export { generateThumbnail } from '@/features/media-library/utils/thumbnail-generator'
export { computeContentHashFromBuffer } from '@/features/media-library/utils/content-hash'
