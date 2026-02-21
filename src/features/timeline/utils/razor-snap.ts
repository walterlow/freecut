/**
 * Shared razor snap logic used by both the split indicator and split execution.
 * Keeping this in one place ensures the visual snap target matches the actual split frame.
 */

export const RAZOR_PLAYHEAD_SNAP_THRESHOLD_PX = 10;
export const RAZOR_SNAP_THRESHOLD_PX = 12;

interface RazorSnapTarget {
  frame: number;
  type: 'grid' | 'item-start' | 'item-end' | 'playhead' | 'marker';
}

interface RazorSplitPositionParams {
  cursorX: number;
  currentFrame: number;
  isPlaying: boolean;
  frameToPixels: (frame: number) => number;
  pixelsToFrame: (pixels: number) => number;
  /** When true, snap to nearby targets (item edges, grid, markers, playhead) */
  shiftHeld?: boolean;
  /** Snap targets to consider when shiftHeld is true */
  snapTargets?: RazorSnapTarget[];
}

interface RazorSplitPositionResult {
  splitFrame: number;
  snappedX: number;
  snappedToPlayhead: boolean;
  /** The snap target that was snapped to (when shift-snapping) */
  snappedTarget?: RazorSnapTarget | null;
}

export type { RazorSnapTarget };

export function getRazorSplitPosition({
  cursorX,
  currentFrame,
  isPlaying,
  frameToPixels,
  pixelsToFrame,
  shiftHeld = false,
  snapTargets,
}: RazorSplitPositionParams): RazorSplitPositionResult {
  // When Shift is held and snap targets are provided, find the nearest one
  if (shiftHeld && snapTargets && snapTargets.length > 0) {
    let nearestTarget: RazorSnapTarget | null = null;
    let nearestDistancePx = RAZOR_SNAP_THRESHOLD_PX;

    for (const target of snapTargets) {
      const targetX = frameToPixels(target.frame);
      const distancePx = Math.abs(cursorX - targetX);
      if (distancePx < nearestDistancePx) {
        nearestDistancePx = distancePx;
        nearestTarget = target;
      }
    }

    if (nearestTarget) {
      return {
        splitFrame: nearestTarget.frame,
        snappedX: frameToPixels(nearestTarget.frame),
        snappedToPlayhead: nearestTarget.type === 'playhead',
        snappedTarget: nearestTarget,
      };
    }
  }

  // Default: only snap to playhead within threshold
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
