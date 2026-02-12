import { describe, expect, it } from 'vitest';
import { getRazorSplitPosition, RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX } from './razor-snap';

describe('getRazorSplitPosition', () => {
  const frameToPixels = (frame: number) => frame * 2;
  const pixelsToFrame = (pixels: number) => pixels / 2;

  it('snaps to playhead when cursor is within threshold and playback is paused', () => {
    const currentFrame = 120;
    const playheadX = frameToPixels(currentFrame);
    const cursorX = playheadX + RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX - 1;

    const result = getRazorSplitPosition({
      cursorX,
      currentFrame,
      isPlaying: false,
      frameToPixels,
      pixelsToFrame,
    });

    expect(result.snappedToPlayhead).toBe(true);
    expect(result.splitFrame).toBe(currentFrame);
    expect(result.snappedX).toBe(playheadX);
  });

  it('rounds snapped playhead split frame to an integer', () => {
    const currentFrame = 120.49;
    const roundedFrame = Math.round(currentFrame);
    const playheadX = frameToPixels(roundedFrame);

    const result = getRazorSplitPosition({
      cursorX: playheadX,
      currentFrame,
      isPlaying: false,
      frameToPixels,
      pixelsToFrame,
    });

    expect(result.snappedToPlayhead).toBe(true);
    expect(result.splitFrame).toBe(roundedFrame);
    expect(result.snappedX).toBe(playheadX);
  });

  it('does not snap to playhead while playback is running', () => {
    const currentFrame = 120;
    const playheadX = frameToPixels(currentFrame);

    const result = getRazorSplitPosition({
      cursorX: playheadX,
      currentFrame,
      isPlaying: true,
      frameToPixels,
      pixelsToFrame,
    });

    expect(result.snappedToPlayhead).toBe(false);
    expect(result.splitFrame).toBe(currentFrame);
    expect(result.snappedX).toBe(playheadX);
  });

  it('snaps to nearest frame when not near the playhead', () => {
    const result = getRazorSplitPosition({
      cursorX: 15.2,
      currentFrame: 0,
      isPlaying: false,
      frameToPixels,
      pixelsToFrame,
    });

    expect(result.snappedToPlayhead).toBe(false);
    expect(result.splitFrame).toBe(8);
    expect(result.snappedX).toBe(16);
  });
});
