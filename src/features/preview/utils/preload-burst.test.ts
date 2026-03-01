import { describe, expect, it } from 'vitest';
import {
  getPreloadBurstTrigger,
  isShortSeekFrameDelta,
  PRELOAD_SHORT_SEEK_THRESHOLD_SECONDS,
} from './preload-burst';

describe('isShortSeekFrameDelta', () => {
  it('returns false for non-positive deltas', () => {
    expect(isShortSeekFrameDelta(0, 30)).toBe(false);
    expect(isShortSeekFrameDelta(-5, 30)).toBe(false);
  });

  it('uses the short-seek threshold in frames', () => {
    const thresholdFrames = Math.round(30 * PRELOAD_SHORT_SEEK_THRESHOLD_SECONDS);
    expect(isShortSeekFrameDelta(thresholdFrames, 30)).toBe(true);
    expect(isShortSeekFrameDelta(thresholdFrames + 1, 30)).toBe(false);
  });

  it('applies a minimum threshold of 8 frames', () => {
    expect(isShortSeekFrameDelta(8, 1)).toBe(true);
    expect(isShortSeekFrameDelta(9, 1)).toBe(false);
  });
});

describe('getPreloadBurstTrigger', () => {
  it('returns scrub_enter when entering scrubbing mode', () => {
    expect(
      getPreloadBurstTrigger({
        interactionMode: 'scrubbing',
        prevInteractionMode: 'paused',
        currentFrame: 100,
        prevCurrentFrame: 100,
        fps: 30,
      })
    ).toBe('scrub_enter');
  });

  it('does not return scrub_enter when already scrubbing', () => {
    expect(
      getPreloadBurstTrigger({
        interactionMode: 'scrubbing',
        prevInteractionMode: 'scrubbing',
        currentFrame: 100,
        prevCurrentFrame: 100,
        fps: 30,
      })
    ).toBe('none');
  });

  it('returns paused_short_seek for short paused ruler seeks', () => {
    expect(
      getPreloadBurstTrigger({
        interactionMode: 'paused',
        prevInteractionMode: 'paused',
        currentFrame: 120,
        prevCurrentFrame: 90,
        fps: 30,
      })
    ).toBe('paused_short_seek');
  });

  it('returns none for long paused seeks', () => {
    expect(
      getPreloadBurstTrigger({
        interactionMode: 'paused',
        prevInteractionMode: 'paused',
        currentFrame: 200,
        prevCurrentFrame: 90,
        fps: 30,
      })
    ).toBe('none');
  });

  it('returns none for playing mode', () => {
    expect(
      getPreloadBurstTrigger({
        interactionMode: 'playing',
        prevInteractionMode: 'playing',
        currentFrame: 120,
        prevCurrentFrame: 90,
        fps: 30,
      })
    ).toBe('none');
  });
});
