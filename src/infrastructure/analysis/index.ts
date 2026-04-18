/**
 * Infrastructure facade for media analysis utilities.
 * All consumers should import analysis types from here instead of @/lib/analysis.
 */

export { detectScenes, clearSceneCache } from '@/lib/analysis';
export type {
  SceneCut,
  SceneDetectionProgress,
  VerificationModel,
} from '@/lib/analysis';
export {
  getSceneVerificationModelLabel,
  getSceneVerificationModelOptions,
} from '@/lib/analysis';
export { captionVideo, captionImage } from '@/lib/analysis';
export type { MediaCaption, CaptioningProgress, CaptioningOptions } from '@/lib/analysis';
export {
  embeddingsProvider,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_DIM,
  clipProvider,
  CLIP_MODEL_ID,
  CLIP_EMBEDDING_DIM,
  buildEmbeddingText,
  sliceTranscript,
  extractDominantColors,
  extractDominantColorPhrase,
  rgbToLab,
  deltaE76,
  deltaE2000,
} from '@/lib/analysis';
export type {
  EmbeddingsOptions,
  EmbeddingsProgress,
  EmbeddingsProvider,
  BuildEmbeddingTextInput,
  TranscriptSegment,
  PaletteEntry,
  LabColor,
} from '@/lib/analysis';
