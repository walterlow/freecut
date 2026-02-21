import { describe, expect, it } from 'vitest';
import { getRazorSplitPosition, RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX, RAZOR_SNAP_THRESHOLD_PX } from './razor-snap';
import type { RazorSnapTarget } from './razor-snap';

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

  describe('shift-snap', () => {
    const snapTargets: RazorSnapTarget[] = [
      { frame: 50, type: 'item-start' },
      { frame: 100, type: 'item-end' },
      { frame: 150, type: 'grid' },
      { frame: 200, type: 'playhead' },
      { frame: 300, type: 'marker' },
    ];

    it('snaps to nearest item edge when shift is held and cursor is within threshold', () => {
      // Item-end at frame 100, which is at pixel 200
      // Cursor at pixel 200 + RAZOR_SNAP_THRESHOLD_PX - 1 (211)
      const result = getRazorSplitPosition({
        cursorX: 200 + RAZOR_SNAP_THRESHOLD_PX - 1,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets,
      });

      expect(result.splitFrame).toBe(100);
      expect(result.snappedTarget?.type).toBe('item-end');
    });

    it('snaps to nearest grid point when shift is held', () => {
      // Grid at frame 150, pixel 300
      const result = getRazorSplitPosition({
        cursorX: 300 + 5,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets,
      });

      expect(result.splitFrame).toBe(150);
      expect(result.snappedTarget?.type).toBe('grid');
    });

    it('snaps to marker when shift is held', () => {
      // Marker at frame 300, pixel 600
      const result = getRazorSplitPosition({
        cursorX: 600 + 3,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets,
      });

      expect(result.splitFrame).toBe(300);
      expect(result.snappedTarget?.type).toBe('marker');
    });

    it('does not snap when shift is not held even if near snap target', () => {
      // Near item-end at frame 100 (pixel 200), but shift not held
      const result = getRazorSplitPosition({
        cursorX: 201,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: false,
        snapTargets,
      });

      // Should fall through to normal frame rounding, not snap to frame 100
      expect(result.splitFrame).toBe(Math.round(pixelsToFrame(201)));
      expect(result.snappedTarget).toBeUndefined();
    });

    it('falls back to normal behavior when no snap target is in range', () => {
      // Cursor far from any snap target
      const result = getRazorSplitPosition({
        cursorX: 500, // frame 250, not near any target
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets,
      });

      // Falls back to normal rounding (frame 250)
      expect(result.splitFrame).toBe(250);
      expect(result.snappedTarget).toBeUndefined();
    });

    it('picks the closest target when multiple are within threshold', () => {
      // Two targets close together
      const closeTargets: RazorSnapTarget[] = [
        { frame: 50, type: 'item-start' },
        { frame: 53, type: 'item-end' },
      ];

      // Cursor at pixel 104 — frame 52, equidistant-ish but closer to frame 53 (px 106) than 50 (px 100)
      // 53 is at px 106, distance = 2; 50 is at px 100, distance = 4
      const result = getRazorSplitPosition({
        cursorX: 104,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets: closeTargets,
      });

      expect(result.splitFrame).toBe(53);
      expect(result.snappedTarget?.type).toBe('item-end');
    });

    it('does not shift-snap when snapTargets is empty', () => {
      const result = getRazorSplitPosition({
        cursorX: 200,
        currentFrame: 0,
        isPlaying: false,
        frameToPixels,
        pixelsToFrame,
        shiftHeld: true,
        snapTargets: [],
      });

      // Falls through to normal playhead snap check, then frame rounding
      expect(result.splitFrame).toBe(100);
      expect(result.snappedTarget).toBeUndefined();
    });
  });
});
