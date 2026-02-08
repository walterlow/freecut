import type { SnapTarget } from '../types/drag';

/**
 * Snap utility functions for timeline drag-and-drop
 * Pure functions for snap calculations - no side effects
 */

/**
 * Generate grid snap points based on timeline scale and zoom level
 * Returns frame numbers for major time intervals
 *
 * @param durationInSeconds - Total timeline duration in seconds
 * @param fps - Frames per second
 * @param zoomLevel - Current zoom level (affects grid density)
 * @returns Array of frame numbers where grid lines appear
 */
export function generateGridSnapPoints(
  durationInSeconds: number,
  fps: number,
  zoomLevel: number
): number[] {
  const snapPoints: number[] = [];

  // Determine interval based on zoom level
  // At high zoom (>2x), show every second
  // At normal zoom (1x-2x), show every 5 seconds
  // At low zoom (<1x), show every 10 seconds
  let intervalSeconds: number;
  if (zoomLevel > 2) {
    intervalSeconds = 1; // Every second
  } else if (zoomLevel > 0.5) {
    intervalSeconds = 5; // Every 5 seconds
  } else {
    intervalSeconds = 10; // Every 10 seconds
  }

  // Generate snap points at regular intervals
  for (let time = 0; time <= durationInSeconds; time += intervalSeconds) {
    snapPoints.push(Math.round(time * fps));
  }

  return snapPoints;
}

/**
 * Find the nearest snap target within threshold
 *
 * @param targetFrame - Frame position to snap from
 * @param snapTargets - Array of available snap targets
 * @param thresholdFrames - Maximum distance in frames to snap
 * @returns Nearest snap target or null if none within threshold
 */
export function findNearestSnapTarget(
  targetFrame: number,
  snapTargets: SnapTarget[],
  thresholdFrames: number
): SnapTarget | null {
  if (snapTargets.length === 0) {
    return null;
  }

  let nearestTarget: SnapTarget | null = null;
  let minDistance = thresholdFrames;

  for (const target of snapTargets) {
    const distance = Math.abs(targetFrame - target.frame);
    if (distance < minDistance) {
      nearestTarget = target;
      minDistance = distance;
    }
  }

  return nearestTarget;
}

/**
 * Calculate adaptive snap threshold based on zoom level
 * Higher zoom = tighter snap threshold (more precise)
 * Lower zoom = looser snap threshold (easier to snap)
 *
 * @param zoomLevel - Current zoom level
 * @param baseThresholdPixels - Base threshold in pixels at 1x zoom
 * @param pixelsPerSecond - Pixels per second at current zoom
 * @param fps - Frames per second
 * @returns Threshold in frames
 */
export function calculateAdaptiveSnapThreshold(
  zoomLevel: number,
  baseThresholdPixels: number,
  pixelsPerSecond: number,
  fps: number
): number {
  // Calculate threshold in pixels (inversely proportional to zoom)
  const thresholdPixels = baseThresholdPixels / Math.sqrt(zoomLevel);

  // Convert pixels to frames
  const secondsPerPixel = 1 / pixelsPerSecond;
  const thresholdSeconds = thresholdPixels * secondsPerPixel;
  const thresholdFrames = Math.ceil(thresholdSeconds * fps);

  // Minimum threshold of 1 frame
  return Math.max(1, thresholdFrames);
}
