/**
 * Adapter exports for shared store dependencies.
 * Composition runtime modules should import store hooks/types from here.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
export { useGizmoStore } from '@/features/preview/stores/gizmo-store';
export type { ItemPropertiesPreview } from '@/features/preview/stores/gizmo-store';
export { usePlaybackStore } from '@/shared/state/playback';
export { useTimelineStore } from '@/features/timeline/stores/timeline-store';
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store';
export { useDebugStore } from '@/features/editor/stores/debug-store';
