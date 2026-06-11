/**
 * Cross-feature contract — scene-browser uses the embeddings provider for
 * semantic search (query embedding + background indexer).
 */

export {
  embeddingsProvider,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_DIM,
  clipProvider,
  CLIP_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  buildEmbeddingText,
  extractDominantColors,
  deltaE2000,
} from '@/infrastructure/analysis/embeddings'
export type { PaletteEntry, LabColor } from '@/infrastructure/analysis/embeddings'
