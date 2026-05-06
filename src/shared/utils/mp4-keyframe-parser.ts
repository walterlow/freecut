/**
 * Keyframe index utilities for adaptive seek backtracking.
 *
 * Keyframe timestamps are extracted at import time using mediabunny's
 * EncodedPacketSink (see media-processor.worker.ts). This module provides
 * the binary search utility consumed by the extractor and prewarm systems.
 */

/**
 * Binary search for the largest keyframe timestamp <= target.
 * Returns the timestamp in seconds, or null if no keyframe is at or before target.
 *
 * @param keyframeTimestamps - Sorted array of keyframe timestamps (seconds)
 * @param target - Target timestamp (seconds)
 */
export function nearestKeyframeBefore(keyframeTimestamps: number[], target: number): number | null {
  if (keyframeTimestamps.length === 0) return null

  // All keyframes are after target
  if (keyframeTimestamps[0]! > target) return null

  let lo = 0
  let hi = keyframeTimestamps.length - 1

  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1 // ceil to avoid infinite loop
    if (keyframeTimestamps[mid]! <= target) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  return keyframeTimestamps[lo]!
}
