/**
 * Infrastructure facade for media analysis utilities.
 * All consumers should import analysis types from here instead of @/lib/analysis.
 */

export { detectScenes, clearSceneCache } from '@/lib/analysis';
export type { SceneCut, SceneDetectionProgress } from '@/lib/analysis';
