/**
 * Adapter exports for export dependencies.
 * Timeline modules should import export rendering utilities from here.
 */

export { convertTimelineToComposition } from '@/features/export/utils/timeline-to-composition'
export type { ClientExportSettings, RenderProgress } from '@/features/export/utils/client-renderer'

export const importCanvasRenderOrchestrator = () =>
  import('@/features/export/utils/canvas-render-orchestrator')
