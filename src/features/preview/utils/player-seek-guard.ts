import type { PreviewInteractionMode } from './preview-interaction-mode';

export interface CurrentFrameSeekGuardInput {
  interactionMode: PreviewInteractionMode;
  previewFrameChanged: boolean;
}

/**
 * Whether currentFrame-driven Player seeks should be skipped for this update.
 */
export function shouldSkipCurrentFrameSeek({
  interactionMode,
  previewFrameChanged,
}: CurrentFrameSeekGuardInput): boolean {
  if (interactionMode === 'gizmo_dragging') return true;
  if (interactionMode === 'scrubbing' && previewFrameChanged) return true;
  return false;
}
