import type { TimelineItem } from '@/types/timeline';

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
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;
export const DEFAULT_SPEED = 1;

/**
 * Extract source properties from a media item with defaults.
 */
export interface SourceProperties {
  sourceStart: number;
  sourceEnd: number | undefined;
  sourceDuration: number | undefined;
  speed: number;
}

export function getSourceProperties(item: TimelineItem): SourceProperties {
  if (item.type !== 'video' && item.type !== 'audio') {
    return {
      sourceStart: 0,
      sourceEnd: undefined,
      sourceDuration: undefined,
      speed: DEFAULT_SPEED,
    };
  }

  return {
    sourceStart: item.sourceStart ?? 0,
    sourceEnd: item.sourceEnd,
    sourceDuration: item.sourceDuration,
    speed: item.speed ?? DEFAULT_SPEED,
  };
}

/**
 * Convert timeline frames to source frames.
 * Use Math.round to minimize floating-point errors.
 */
export function timelineToSourceFrames(timelineFrames: number, speed: number): number {
  return Math.round(timelineFrames * speed);
}

/**
 * Convert source frames to timeline frames.
 * Use Math.floor to ensure we don't exceed source bounds.
 */
export function sourceToTimelineFrames(sourceFrames: number, speed: number): number {
  return Math.floor(sourceFrames / speed);
}

/**
 * Calculate available source frames from current position to end.
 */
export function getAvailableSourceFrames(sourceDuration: number, sourceStart: number): number {
  return Math.max(0, sourceDuration - sourceStart);
}

/**
 * Calculate max timeline duration based on available source frames.
 */
export function getMaxTimelineDuration(
  sourceDuration: number,
  sourceStart: number,
  speed: number
): number {
  const available = getAvailableSourceFrames(sourceDuration, sourceStart);
  return sourceToTimelineFrames(available, speed);
}

/**
 * Calculate max extension towards source start (in timeline frames).
 */
export function getMaxStartExtension(sourceStart: number, speed: number): number {
  return sourceToTimelineFrames(sourceStart, speed);
}

/**
 * Calculate speed from source duration and desired timeline duration.
 */
export function calculateSpeed(sourceDuration: number, timelineDuration: number): number {
  if (timelineDuration <= 0) return DEFAULT_SPEED;
  return sourceDuration / timelineDuration;
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
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed));
}

/**
 * Validate that a seek position is within source bounds.
 */
export function isValidSeekPosition(
  seekFrame: number,
  sourceDuration: number | undefined
): boolean {
  if (sourceDuration === undefined) return true;
  return seekFrame >= 0 && seekFrame < sourceDuration;
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
  tolerance: number = 2
): boolean {
  if (sourceDuration === undefined) return true;
  const sourceFramesNeeded = timelineToSourceFrames(timelineDuration, speed);
  const sourceEnd = sourceStart + sourceFramesNeeded;
  return sourceEnd <= sourceDuration + tolerance;
}

/**
 * Calculate safe trim position that doesn't exceed source bounds.
 */
export function getSafeTrimBefore(
  trimBefore: number,
  timelineDuration: number,
  speed: number,
  sourceDuration: number | undefined
): number {
  if (sourceDuration === undefined || sourceDuration <= 0) return trimBefore;

  const sourceFramesNeeded = timelineToSourceFrames(timelineDuration, speed);
  const maxTrimBefore = Math.max(0, sourceDuration - sourceFramesNeeded);

  return Math.min(trimBefore, maxTrimBefore);
}

/**
 * Check if an item is a media item (has source properties).
 */
export function isMediaItem(item: TimelineItem): item is TimelineItem & {
  type: 'video' | 'audio';
  sourceDuration?: number;
  sourceStart?: number;
  sourceEnd?: number;
  speed?: number;
} {
  return item.type === 'video' || item.type === 'audio';
}

/**
 * Calculate source boundaries for split items.
 * Returns source positions for left and right items after a split.
 */
export interface SplitSourceBoundaries {
  left: { sourceEnd: number };
  right: { sourceStart: number; sourceEnd: number };
}

export function calculateSplitSourceBoundaries(
  sourceStart: number,
  leftDuration: number,
  rightDuration: number,
  speed: number
): SplitSourceBoundaries {
  const leftSourceFrames = timelineToSourceFrames(leftDuration, speed);
  const totalSourceFrames = timelineToSourceFrames(leftDuration + rightDuration, speed);

  return {
    left: {
      sourceEnd: sourceStart + leftSourceFrames,
    },
    right: {
      sourceStart: sourceStart + leftSourceFrames,
      sourceEnd: sourceStart + totalSourceFrames,
    },
  };
}
