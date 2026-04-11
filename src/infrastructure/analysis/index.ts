/**
 * Infrastructure facade for media analysis utilities.
 * All consumers should import analysis types from here instead of @/lib/analysis.
 */

export { detectScenes, clearSceneCache } from '@/lib/analysis';
export type { SceneCut, SceneDetectionProgress, VerificationModel } from '@/lib/analysis';
export { captionVideo, captionImage } from '@/lib/analysis';
export type { MediaCaption, CaptioningProgress, CaptioningOptions } from '@/lib/analysis';
