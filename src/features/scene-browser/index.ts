/**
 * Scene Browser — cross-library visual search for AI-generated captions.
 *
 * Public API:
 *  - `<SceneBrowserPanel/>` — the full panel; mount inside the media-library
 *    body when `useSceneBrowserStore.open === true`.
 *  - `useSceneBrowserStore` — control open/close, query, scope, sort.
 */

export { SceneBrowserPanel } from './components/scene-browser-panel'
export { useSceneBrowserStore } from './stores/scene-browser-store'
export type { SceneBrowserSortMode } from './stores/scene-browser-store'
export { invalidateMediaCaptionThumbnails } from './utils/invalidate'
