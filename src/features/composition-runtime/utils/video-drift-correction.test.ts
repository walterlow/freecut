import { describe, expect, it } from 'vitest';
import {
  getPlaybackRateForDrift,
  shouldHardSeekForPlaybackDrift,
  VIDEO_DRIFT_MAX_AHEAD_SECONDS,
  VIDEO_DRIFT_RATE_CORRECTION_THRESHOLD_SECONDS,
} from './video-drift-correction';

describe('video-drift-correction', () => {
  it('hard-seeks when playback drift is significantly ahead', () => {
    expect(shouldHardSeekForPlaybackDrift({
      driftSeconds: VIDEO_DRIFT_MAX_AHEAD_SECONDS + 0.01,
      timeSinceLastSyncMs: 0,
    })).toBe(true);
  });

  it('does not hard-seek for moderate positive drift', () => {
    expect(shouldHardSeekForPlaybackDrift({
      driftSeconds: 0.35,
      timeSinceLastSyncMs: 0,
    })).toBe(false);
  });

  it('waits for cooldown before hard-seeking when video is behind', () => {
    expect(shouldHardSeekForPlaybackDrift({
      driftSeconds: -0.25,
      timeSinceLastSyncMs: 40,
    })).toBe(false);

    expect(shouldHardSeekForPlaybackDrift({
      driftSeconds: -0.25,
      timeSinceLastSyncMs: 120,
    })).toBe(true);
  });

  it('slows playback down more aggressively when video is ahead', () => {
    expect(getPlaybackRateForDrift({
      driftSeconds: 0.4,
      nominalRate: 1,
    })).toBeCloseTo(0.9, 5);
  });

  it('returns nominal rate when drift is within the sync window', () => {
    expect(getPlaybackRateForDrift({
      driftSeconds: VIDEO_DRIFT_RATE_CORRECTION_THRESHOLD_SECONDS / 2,
      nominalRate: 1,
    })).toBe(1);
  });
});
