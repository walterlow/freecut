import { describe, expect, it } from 'vitest';
import {
  PREVIEW_DOM_VIDEO_MAX_AHEAD_DRIFT_SECONDS,
  PREVIEW_DOM_VIDEO_MAX_BEHIND_DRIFT_SECONDS,
  PREVIEW_DOM_VIDEO_IDLE_DRIFT_SECONDS,
  shouldUseDomVideoForPreviewPlayback,
} from './preview-dom-video-guard';

describe('shouldUseDomVideoForPreviewPlayback', () => {
  it('allows actively playing DOM video to run somewhat ahead of target time', () => {
    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: PREVIEW_DOM_VIDEO_MAX_AHEAD_DRIFT_SECONDS - 0.05,
      isActivelyPlaying: true,
    })).toBe(true);
  });

  it('rejects actively playing DOM video when it is far ahead', () => {
    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: PREVIEW_DOM_VIDEO_MAX_AHEAD_DRIFT_SECONDS + 0.05,
      isActivelyPlaying: true,
    })).toBe(false);
  });

  it('keeps a tighter behind threshold during active playback', () => {
    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: -(PREVIEW_DOM_VIDEO_MAX_BEHIND_DRIFT_SECONDS - 0.01),
      isActivelyPlaying: true,
    })).toBe(true);

    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: -(PREVIEW_DOM_VIDEO_MAX_BEHIND_DRIFT_SECONDS + 0.05),
      isActivelyPlaying: true,
    })).toBe(false);
  });

  it('uses a tight symmetric window before the DOM video is actively playing', () => {
    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: PREVIEW_DOM_VIDEO_IDLE_DRIFT_SECONDS - 0.01,
      isActivelyPlaying: false,
    })).toBe(true);

    expect(shouldUseDomVideoForPreviewPlayback({
      driftSeconds: PREVIEW_DOM_VIDEO_IDLE_DRIFT_SECONDS + 0.05,
      isActivelyPlaying: false,
    })).toBe(false);
  });
});
