export interface FastScrubOverlayGuardInput {
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  currentFrame: number;
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
  currentFrame,
  previewFrame,
  renderedFrame,
}: FastScrubOverlayGuardInput): boolean {
  if (isPlaying) return false;
  const targetFrame = isGizmoInteracting ? currentFrame : previewFrame;
  if (targetFrame === null) return false;
  return targetFrame === renderedFrame;
}
