export { OpticalFlowAnalyzer } from './optical-flow-analyzer';
export type { MotionResult } from './optical-flow-analyzer';
export { detectScenes, clearSceneCache } from './scene-detection';
export type {
  SceneCut,
  SceneDetectionProgress,
  DetectScenesOptions,
  VerificationModel,
} from './scene-detection';
export {
  getDefaultSceneVerificationProvider,
  getSceneVerificationModelLabel,
  getSceneVerificationModelOptions,
  getSceneVerificationProvider,
} from './verification/registry';
export type { SceneVerificationProvider } from './verification/types';
export { detectScenesHistogram, computeHistogram, chiSquaredDistance } from './histogram-scene-detection';
export type { HistogramDetectOptions } from './histogram-scene-detection';
export { seekVideo, deduplicateCuts } from './scene-detection-utils';
export { captionVideo, captionImage } from './media-tagger';
export type { MediaCaption, CaptioningProgress, CaptioningOptions } from './media-tagger';
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
} from './embeddings';
export type {
  EmbeddingsOptions,
  EmbeddingsProgress,
  EmbeddingsProvider,
  BuildEmbeddingTextInput,
  TranscriptSegment,
  PaletteEntry,
  LabColor,
} from './embeddings';
export { ANALYSIS_WIDTH, ANALYSIS_HEIGHT, PYRAMID_LEVELS } from './optical-flow-shaders';
