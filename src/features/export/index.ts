// Export feature — public API
// Canvas-based video export with Web Workers

export { convertTimelineToComposition } from './utils/timeline-to-composition'
export { renderSingleFrame } from './utils/client-render-engine'

// Render queue — serial multi-segment export
export { ExportsDialog } from './components/exports-dialog'
export { RenderQueueList } from './components/render-queue-panel'
export { RenderQueueRunner } from './components/render-queue-runner'
export { RenderQueuePersistence } from './components/render-queue-persistence'
export {
  useRenderQueueStore,
  type RenderJob,
  type RenderJobStatus,
} from './stores/render-queue-store'
