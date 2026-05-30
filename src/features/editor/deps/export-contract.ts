/**
 * Adapter exports for export feature dependencies.
 * Editor modules should import export dialogs/helpers from here.
 */

export const importExportDialog = () => import('@/features/export/components/export-dialog')
export const importExportsDialog = () => import('@/features/export/components/exports-dialog')

// The runner + persistence are light (the heavy render engine loads lazily
// inside the runner), so they're safe to import eagerly and mount at the
// editor root.
export { RenderQueueRunner } from '@/features/export/components/render-queue-runner'
export { RenderQueuePersistence } from '@/features/export/components/render-queue-persistence'
export { useRenderQueueStore } from '@/features/export/stores/render-queue-store'
