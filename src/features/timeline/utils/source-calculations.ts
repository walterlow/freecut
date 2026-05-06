import type { TimelineItem } from '@/types/timeline'

/**
 * Core utilities for source/timeline frame conversions.
 *
 * Terminology:
 * - Timeline frames: Frames as they appear on the timeline (affected by speed)
 * - Source frames: Actual frames in the source media file
 * - Speed: Playback rate (1 = normal, 2 = 2x faster, 0.5 = half speed)
 *
 * Relationships:
 * - sourceFrames = timelineFrames * speed
 * - timelineFrames = sourceFrames / speed
 */

// Speed constraints
export const MIN_SPEED = 0.1
export const MAX_SPEED = 16
export const DEFAULT_SPEED = 1
const DEFAULT_TIMELINE_FPS = 30

function normalizeFps(fps: number | undefined, fallback: number): number {
  if (fps === undefined || !Number.isFinite(fps) || fps <= 0) return fallback
  return fps
}

/**
 * Extract source properties from a media item with defaults.
 */
interface SourceProperties {
  sourceStart: number
  sourceEnd: number | undefined
  sourceDuration: number | undefined
  sourceFps: number | undefined
  speed: number
}

export function getSourceProperties(item: TimelineItem): SourceProperties {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') {
    return {
      sourceStart: 0,
      sourceEnd: undefined,
      sourceDuration: undefined,
      sourceFps: undefined,
      speed: DEFAULT_SPEED,
    }
  }

  return {
    sourceStart: item.sourceStart ?? 0,
    sourceEnd: item.sourceEnd,
    sourceDuration: item.sourceDuration,
    sourceFps: item.sourceFps,
    speed: item.speed ?? DEFAULT_SPEED,
  }
}

/**
 * Convert timeline frames to source frames.
 * Use Math.round to minimize floating-point errors.
 */
export function timelineToSourceFrames(
  timelineFrames: number,
  speed: number,
  timelineFps: number = DEFAULT_TIMELINE_FPS,
  sourceFps: number = timelineFps,
): number {
  const safeTimelineFps = normalizeFps(timelineFps, DEFAULT_TIMELINE_FPS)
  const safeSourceFps = normalizeFps(sourceFps, safeTimelineFps)
  const timelineSeconds = timelineFrames / safeTimelineFps
  return Math.round(timelineSeconds * safeSourceFps * speed)
}

/**
 * Convert source frames to timeline frames.
 * Use Math.floor to ensure we don't exceed source bounds.
 */
export function sourceToTimelineFrames(
  sourceFrames: number,
  speed: number,
  sourceFps: number = DEFAULT_TIMELINE_FPS,
  timelineFps: number = sourceFps,
): number {
  const safeSourceFps = normalizeFps(sourceFps, DEFAULT_TIMELINE_FPS)
  const safeTimelineFps = normalizeFps(timelineFps, safeSourceFps)
  const sourceSeconds = sourceFrames / safeSourceFps
  return Math.floor((sourceSeconds * safeTimelineFps) / speed)
}

/**
 * Calculate available source frames from current position to end.
 */
export function getAvailableSourceFrames(sourceDuration: number, sourceStart: number): number {
  return Math.max(0, sourceDuration - sourceStart)
}

/**
 * Calculate max timeline duration based on available source frames.
 */
export function getMaxTimelineDuration(
  sourceDuration: number,
  sourceStart: number,
  speed: number,
  sourceFps: number = DEFAULT_TIMELINE_FPS,
  timelineFps: number = sourceFps,
): number {
  const available = getAvailableSourceFrames(sourceDuration, sourceStart)
  return sourceToTimelineFrames(available, speed, sourceFps, timelineFps)
}

/**
 * Calculate max extension towards source start (in timeline frames).
 */
export function getMaxStartExtension(
  sourceStart: number,
  speed: number,
  sourceFps: number = DEFAULT_TIMELINE_FPS,
  timelineFps: number = sourceFps,
): number {
  return sourceToTimelineFrames(sourceStart, speed, sourceFps, timelineFps)
}

/**
 * Calculate speed from source duration and desired timeline duration.
 */
export function calculateSpeed(
  sourceDuration: number,
  timelineDuration: number,
  sourceFps: number = DEFAULT_TIMELINE_FPS,
  timelineFps: number = sourceFps,
): number {
  if (timelineDuration <= 0) return DEFAULT_SPEED
  const safeSourceFps = normalizeFps(sourceFps, DEFAULT_TIMELINE_FPS)
  const safeTimelineFps = normalizeFps(timelineFps, safeSourceFps)
  return (sourceDuration * safeTimelineFps) / (timelineDuration * safeSourceFps)
}

/**
 * Clamp speed to valid range and round to 2 decimal places.
 */
/**
 * Clamp speed to valid range without rounding.
 * Speed is stored with full precision for accurate calculations.
 * UI should format to 2 decimal places for display only.
 */
export function clampSpeed(speed: number): number {
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed))
}

/**
 * Validate that a seek position is within source bounds.
 */
export function isValidSeekPosition(
  seekFrame: number,
  sourceDuration: number | undefined,
): boolean {
  if (sourceDuration === undefined) return true
  return seekFrame >= 0 && seekFrame < sourceDuration
}

/**
 * Validate that playback won't exceed source duration.
 * @param tolerance Number of frames tolerance for floating-point errors
 */
export function isWithinSourceBounds(
  sourceStart: number,
  timelineDuration: number,
  speed: number,
  sourceDuration: number | undefined,
  tolerance: number = 2,
  timelineFps: number = DEFAULT_TIMELINE_FPS,
  sourceFps: number = timelineFps,
): boolean {
  if (sourceDuration === undefined) return true
  const sourceFramesNeeded = timelineToSourceFrames(timelineDuration, speed, timelineFps, sourceFps)
  const sourceEnd = sourceStart + sourceFramesNeeded
  return sourceEnd <= sourceDuration + tolerance
}

/**
 * Calculate safe trim position that doesn't exceed source bounds.
 */
export function getSafeTrimBefore(
  trimBefore: number,
  timelineDuration: number,
  speed: number,
  sourceDuration: number | undefined,
  timelineFps: number = DEFAULT_TIMELINE_FPS,
  sourceFps: number = timelineFps,
): number {
  if (sourceDuration === undefined || sourceDuration <= 0) return trimBefore

  const sourceFramesNeeded = timelineToSourceFrames(timelineDuration, speed, timelineFps, sourceFps)
  const maxTrimBefore = Math.max(0, sourceDuration - sourceFramesNeeded)

  return Math.min(trimBefore, maxTrimBefore)
}

/**
 * Check if an item is a media item (has source properties).
 */
export function isMediaItem(item: TimelineItem): item is TimelineItem & {
  type: 'video' | 'audio' | 'composition'
  sourceDuration?: number
  sourceStart?: number
  sourceEnd?: number
  sourceFps?: number
  speed?: number
} {
  return item.type === 'video' || item.type === 'audio' || item.type === 'composition'
}

/**
 * Calculate source boundaries for split items.
 * Returns source positions for left and right items after a split.
 */
interface SplitSourceBoundaries {
  left: { sourceEnd: number }
  right: { sourceStart: number; sourceEnd: number }
}

export function calculateSplitSourceBoundaries(
  sourceStart: number,
  leftDuration: number,
  rightDuration: number,
  speed: number,
  timelineFps: number = DEFAULT_TIMELINE_FPS,
  sourceFps: number = timelineFps,
): SplitSourceBoundaries {
  const leftSourceFrames = timelineToSourceFrames(leftDuration, speed, timelineFps, sourceFps)
  const totalSourceFrames = timelineToSourceFrames(
    leftDuration + rightDuration,
    speed,
    timelineFps,
    sourceFps,
  )

  return {
    left: {
      sourceEnd: sourceStart + leftSourceFrames,
    },
    right: {
      sourceStart: sourceStart + leftSourceFrames,
      sourceEnd: sourceStart + totalSourceFrames,
    },
  }
}
