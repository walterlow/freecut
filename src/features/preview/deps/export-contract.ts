/**
 * Adapter exports for export dependencies.
 * Preview modules should import export utilities from here.
 */

export {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@/features/export/utils/shared-video-extractor';
export { createCompositionRenderer } from '@/features/export/utils/client-render-engine';
