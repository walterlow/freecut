import { describe, expect, it } from 'vitest';
import { shouldSkipCurrentFrameSeek } from './player-seek-guard';

describe('shouldSkipCurrentFrameSeek', () => {
  it('skips seeks during gizmo dragging', () => {
    expect(
      shouldSkipCurrentFrameSeek({
        interactionMode: 'gizmo_dragging',
        previewFrameChanged: false,
      })
    ).toBe(true);
  });

  it('skips seeks during active scrub updates', () => {
    expect(
      shouldSkipCurrentFrameSeek({
        interactionMode: 'scrubbing',
        previewFrameChanged: true,
      })
    ).toBe(true);
  });

  it('does not skip when scrubbing mode is stale but preview frame did not change', () => {
    expect(
      shouldSkipCurrentFrameSeek({
        interactionMode: 'scrubbing',
        previewFrameChanged: false,
      })
    ).toBe(false);
  });

  it('does not skip in paused mode', () => {
    expect(
      shouldSkipCurrentFrameSeek({
        interactionMode: 'paused',
        previewFrameChanged: false,
      })
    ).toBe(false);
  });
});
