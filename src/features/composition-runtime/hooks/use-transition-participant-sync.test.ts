import { describe, expect, it } from 'vitest';
import { getTransitionSyncPlaybackRate } from './use-transition-participant-sync';

describe('getTransitionSyncPlaybackRate', () => {
  it('keeps the leader on the nominal playback rate', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.04, 'leader')).toBe(1);
  });

  it('slows down a follower when it is ahead of the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, 0.08, 'follower')).toBeLessThan(1);
  });

  it('speeds up a follower when it is behind the shared target', () => {
    expect(getTransitionSyncPlaybackRate(1, -0.08, 'follower')).toBeGreaterThan(1);
  });

  it('clamps follower correction to a bounded range', () => {
    expect(getTransitionSyncPlaybackRate(1, 10, 'follower')).toBeGreaterThanOrEqual(0.94);
    expect(getTransitionSyncPlaybackRate(1, -10, 'follower')).toBeLessThanOrEqual(1.06);
  });
});
