/**
 * Main-thread keyframe index registry.
 *
 * Maps video source URLs (blob: or http:) to their parsed keyframe
 * timestamp arrays. Populated by media-resolver when blob URLs are
 * created; consumed by VideoFrameExtractor for adaptive backtracking.
 *
 * The prewarm worker receives keyframe data via postMessage and stores
 * its own per-source copy — it does not use this registry.
 */

import { nearestKeyframeBefore } from './mp4-keyframe-parser'

/** Source URL → sorted keyframe timestamps in seconds */
const registry = new Map<string, number[]>()

/**
 * Register a keyframe index for a source URL.
 * Called when resolveMediaUrl() creates a blob URL for a media item.
 */
export function registerKeyframeIndex(srcUrl: string, timestamps: number[]): void {
  registry.set(srcUrl, timestamps)
}

/**
 * Remove a keyframe index when a source URL is revoked.
 * If no srcUrl given, clears the entire registry.
 */
export function clearKeyframeIndex(srcUrl?: string): void {
  if (srcUrl) {
    registry.delete(srcUrl)
  } else {
    registry.clear()
  }
}

/**
 * Get raw keyframe timestamps for a source URL (for forwarding to workers).
 */
export function getKeyframeTimestamps(srcUrl: string): number[] | undefined {
  return registry.get(srcUrl)
}

/**
 * Compute the optimal stream start position for seeking to `targetTimestamp`.
 *
 * If a keyframe index exists for the source, returns the nearest keyframe
 * timestamp at or before the target (with a small safety margin).
 * If no index exists, returns null — callers should fall back to their
 * default fixed backtrack (e.g. 1.0 second).
 *
 * @param srcUrl - Video source URL
 * @param targetTimestamp - Desired timestamp in seconds
 * @param marginSeconds - Safety margin before the keyframe (default 0.05s)
 * @returns Stream start timestamp in seconds, or null if no index available
 */
export function getAdaptiveStreamStart(
  srcUrl: string,
  targetTimestamp: number,
  marginSeconds = 0.05,
): number | null {
  const timestamps = registry.get(srcUrl)
  if (!timestamps || timestamps.length === 0) return null

  const keyframeTime = nearestKeyframeBefore(timestamps, targetTimestamp)
  if (keyframeTime === null) return null

  // Start slightly before the keyframe to ensure the decoder picks it up
  return Math.max(0, keyframeTime - marginSeconds)
}
