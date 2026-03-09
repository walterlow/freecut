export const VIDEO_DRIFT_RATE_CORRECTION_THRESHOLD_SECONDS = 0.016;
export const VIDEO_DRIFT_MAX_BEHIND_SECONDS = 0.2;
export const VIDEO_DRIFT_MAX_AHEAD_SECONDS = 0.75;
export const VIDEO_DRIFT_NEGATIVE_RESYNC_COOLDOWN_MS = 80;
export const VIDEO_DRIFT_MAX_BEHIND_RATE_CORRECTION = 0.05;
export const VIDEO_DRIFT_MAX_AHEAD_RATE_CORRECTION = 0.12;

export function shouldHardSeekForPlaybackDrift(args: {
  driftSeconds: number;
  timeSinceLastSyncMs: number;
}): boolean {
  const { driftSeconds, timeSinceLastSyncMs } = args;

  if (driftSeconds > VIDEO_DRIFT_MAX_AHEAD_SECONDS) {
    return true;
  }

  if (driftSeconds < -VIDEO_DRIFT_MAX_BEHIND_SECONDS) {
    return timeSinceLastSyncMs > VIDEO_DRIFT_NEGATIVE_RESYNC_COOLDOWN_MS;
  }

  return false;
}

export function getPlaybackRateForDrift(args: {
  driftSeconds: number;
  nominalRate: number;
}): number {
  const { driftSeconds, nominalRate } = args;
  const absDrift = Math.abs(driftSeconds);

  if (absDrift <= VIDEO_DRIFT_RATE_CORRECTION_THRESHOLD_SECONDS) {
    return nominalRate;
  }

  if (driftSeconds > 0) {
    const correction = Math.min(
      VIDEO_DRIFT_MAX_AHEAD_RATE_CORRECTION,
      absDrift * 0.25,
    );
    return nominalRate * (1 - correction);
  }

  const correction = Math.min(
    VIDEO_DRIFT_MAX_BEHIND_RATE_CORRECTION,
    absDrift * 0.3,
  );
  return nominalRate * (1 + correction);
}
