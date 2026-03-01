export type PreviewInteractionMode =
  | 'playing'
  | 'gizmo_dragging'
  | 'scrubbing'
  | 'paused';

export interface PreviewInteractionInput {
  isPlaying: boolean;
  previewFrame: number | null;
  isGizmoInteracting: boolean;
}

export function getPreviewInteractionMode(
  input: PreviewInteractionInput
): PreviewInteractionMode {
  if (input.isPlaying) return 'playing';
  if (input.isGizmoInteracting) return 'gizmo_dragging';
  if (input.previewFrame !== null) return 'scrubbing';
  return 'paused';
}

export function getPreviewAnchorFrame(
  mode: PreviewInteractionMode,
  frames: { currentFrame: number; previewFrame: number | null }
): number {
  if (mode === 'scrubbing' && frames.previewFrame !== null) {
    return frames.previewFrame;
  }
  return frames.currentFrame;
}
