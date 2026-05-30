/**
 * Adapter exports for preview dependencies.
 * Editor modules should import preview components/hooks/stores from here.
 */

export { VideoPreview } from '@/features/preview/components/video-preview'
export { PlaybackControls } from '@/features/preview/components/playback-controls'
export { AlignmentToolbar } from '@/features/preview/components/alignment-hud'
export { TimecodeDisplay } from '@/features/preview/components/timecode-display'
export { PreviewZoomControls } from '@/features/preview/components/preview-zoom-controls'

export const importSourceMonitor = () => import('@/features/preview/components/source-monitor')
export const importInlineSourcePreview = () =>
  import('@/features/preview/components/inline-source-preview')
export const importInlineCompositionPreview = () =>
  import('@/features/preview/components/inline-composition-preview')
export const importColorScopesMonitor = () =>
  import('@/features/preview/components/color-scopes-monitor')

export { useGizmoStore } from '@/features/preview/stores/gizmo-store'
export type { ItemPropertiesPreview } from '@/features/preview/stores/gizmo-store'
export { useMaskEditorStore } from '@/features/preview/stores/mask-editor-store'
export { useCornerPinStore } from '@/features/preview/stores/corner-pin-store'
export { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame'
export { useItemsStore } from '@/features/preview/deps/timeline-store'
