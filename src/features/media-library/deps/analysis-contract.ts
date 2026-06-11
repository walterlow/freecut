/**
 * Cross-feature contract — analysis infrastructure used by media-library.
 *
 * Split out of `analysis.ts` so additional analysis imports (embeddings,
 * future providers) stay in one auditable place for the boundary checker.
 */

export { captionVideo, captionImage } from '@/infrastructure/analysis/media-tagger'
export type { MediaCaption } from '@/infrastructure/analysis/media-tagger'
export {
  embeddingsProvider,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_DIM,
  clipProvider,
  CLIP_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  buildEmbeddingText,
  extractDominantColors,
} from '@/infrastructure/analysis/embeddings'
