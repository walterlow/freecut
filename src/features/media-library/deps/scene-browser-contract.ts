/**
 * Adapter — media-library mounts the Scene Browser panel and opens it from
 * the info popover through this contract.
 */

export {
  useSceneBrowserStore,
} from '@/features/scene-browser/stores/scene-browser-store'
export {
  invalidateMediaCaptionThumbnails,
} from '@/features/scene-browser/utils/invalidate'

export const importSceneBrowserPanel = () =>
  import('@/features/scene-browser/components/scene-browser-panel')
