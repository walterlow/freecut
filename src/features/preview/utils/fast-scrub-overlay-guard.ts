export interface FastScrubOverlayGuardInput {
  isGizmoInteracting: boolean;
  isPlaying: boolean;
  currentFrame: number;
  previewFrame: number | null;
  renderedFrame: number;
}

export interface FastPlaybackOverlayGuardInput {
  currentFrame: number;
  renderedFrame: number;
  maxLagFrames?: number;
  maxLeadFrames?: number;
}

export const FAST_PLAYBACK_OVERLAY_MAX_LAG_FRAMES = 2;
export const FAST_PLAYBACK_OVERLAY_MAX_LEAD_FRAMES = 1;

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
  const targetFrame = isGizmoInteracting
    ? currentFrame
    : (previewFrame ?? currentFrame);
  if (targetFrame === null) return false;
  return targetFrame === renderedFrame;
}

/**
 * Returns true when a rendered playback overlay frame is still close enough
 * to the live playhead to present without looking like a rewind.
 */
export function shouldShowFastPlaybackOverlay({
  currentFrame,
  renderedFrame,
  maxLagFrames = FAST_PLAYBACK_OVERLAY_MAX_LAG_FRAMES,
  maxLeadFrames = FAST_PLAYBACK_OVERLAY_MAX_LEAD_FRAMES,
}: FastPlaybackOverlayGuardInput): boolean {
  const lagFrames = currentFrame - renderedFrame;
  if (lagFrames > maxLagFrames) return false;
  if (lagFrames < -maxLeadFrames) return false;
  return true;
}
