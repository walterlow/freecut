export interface FastScrubOverlayGuardInput {
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  previewFrame: number | null;
  renderedFrame: number;
}

/**
 * Returns true when the fast-scrub overlay should be shown for a completed
 * priority frame render.
 */
export function shouldShowFastScrubOverlay({
  isGizmoInteracting,
  isPlaying,
  previewFrame,
  renderedFrame,
}: FastScrubOverlayGuardInput): boolean {
  if (isGizmoInteracting) return false;
  if (isPlaying) return false;
  if (previewFrame === null) return false;
  return previewFrame === renderedFrame;
}
