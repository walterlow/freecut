/**
 * Adapter exports for preview dependencies.
 * Editor modules should import preview components/hooks/stores from here.
 */

export { VideoPreview } from '@/features/preview/components/video-preview';
export { PlaybackControls } from '@/features/preview/components/playback-controls';
export { TimecodeDisplay } from '@/features/preview/components/timecode-display';
export { PreviewZoomControls } from '@/features/preview/components/preview-zoom-controls';
export { SourceMonitor } from '@/features/preview/components/source-monitor';

export { useGizmoStore } from '@/features/preview/stores/gizmo-store';
export { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame';
