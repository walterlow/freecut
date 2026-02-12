/**
 * Shared razor snap logic used by both the split indicator and split execution.
 * Keeping this in one place ensures the visual snap target matches the actual split frame.
 */

export const RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX = 10;

interface RazorSplitPositionParams {
  cursorX: number;
  currentFrame: number;
  isPlaying: boolean;
  frameToPixels: (frame: number) => number;
  pixelsToFrame: (pixels: number) => number;
}

interface RazorSplitPositionResult {
  splitFrame: number;
  snappedX: number;
  snappedToPlayhead: boolean;
}

export function getRazorSplitPosition({
  cursorX,
  currentFrame,
  isPlaying,
  frameToPixels,
  pixelsToFrame,
}: RazorSplitPositionParams): RazorSplitPositionResult {
  const roundedPlayheadFrame = Math.round(currentFrame);
  const playheadX = frameToPixels(roundedPlayheadFrame);
  const shouldSnapToPlayhead =
    !isPlaying && Math.abs(cursorX - playheadX) <= RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX;

  if (shouldSnapToPlayhead) {
    return {
      splitFrame: roundedPlayheadFrame,
      snappedX: playheadX,
      snappedToPlayhead: true,
    };
  }

  const splitFrame = Math.round(pixelsToFrame(cursorX));

  return {
    splitFrame,
    snappedX: frameToPixels(splitFrame),
    snappedToPlayhead: false,
  };
}
