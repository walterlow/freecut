export const PREVIEW_DOM_VIDEO_MAX_BEHIND_DRIFT_SECONDS = 0.25;
export const PREVIEW_DOM_VIDEO_MAX_AHEAD_DRIFT_SECONDS = 0.75;
export const PREVIEW_DOM_VIDEO_IDLE_DRIFT_SECONDS = 0.2;

export function shouldUseDomVideoForPreviewPlayback(args: {
  driftSeconds: number;
  isActivelyPlaying: boolean;
}): boolean {
  const { driftSeconds, isActivelyPlaying } = args;

  if (!isActivelyPlaying) {
    return Math.abs(driftSeconds) <= PREVIEW_DOM_VIDEO_IDLE_DRIFT_SECONDS;
  }

  if (driftSeconds >= 0) {
    return driftSeconds <= PREVIEW_DOM_VIDEO_MAX_AHEAD_DRIFT_SECONDS;
  }

  return Math.abs(driftSeconds) <= PREVIEW_DOM_VIDEO_MAX_BEHIND_DRIFT_SECONDS;
}
