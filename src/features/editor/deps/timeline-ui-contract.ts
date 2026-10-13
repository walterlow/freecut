/**
 * Adapter exports for timeline UI dependencies.
 * Editor modules should import timeline feature UI components from here.
 */

export { useBentoLayoutDialogStore } from '@/features/timeline/components/bento-layout-dialog-store'
export { useFillerRemovalDialogStore } from '@/features/timeline/stores/filler-removal-dialog-store'
export { useReverseConformDialogStore } from '@/features/timeline/stores/reverse-conform-dialog-store'
export { useSilenceRemovalDialogStore } from '@/features/timeline/stores/silence-removal-dialog-store'

export const importTimeline = () => import('@/features/timeline/components/timeline')
export const importBentoLayoutDialog = () =>
  import('@/features/timeline/components/bento-layout-dialog')
export const importFillerRemovalDialog = () =>
  import('@/features/timeline/components/filler-removal-dialog')
export const importReverseConformDialog = () =>
  import('@/features/timeline/components/reverse-conform-dialog')
export const importSilenceRemovalDialog = () =>
  import('@/features/timeline/components/silence-removal-dialog')
