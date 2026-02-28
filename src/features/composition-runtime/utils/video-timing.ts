/**
 * Calculate source playback time (seconds) for a video clip.
 * Supports shared Sequence rendering by applying a per-item frame offset.
 */
export function getVideoTargetTimeSeconds(
  safeTrimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number,
  sequenceFrameOffset: number = 0
): number {
  const relativeFrame = sequenceLocalFrame - sequenceFrameOffset;
  return (safeTrimBefore / sourceFps) + (relativeFrame * playbackRate / timelineFps);
}

/**
 * Calculate source playback time (seconds) for an audio clip.
 *
 * IMPORTANT: `trimBefore` is in **source FPS** frames (not timeline FPS).
 * Using timeline FPS to convert trimBefore to seconds will produce the wrong
 * seek position for sources whose FPS differs from the project FPS.
 *
 * This function must produce the same result as `getVideoTargetTimeSeconds`
 * (with sequenceFrameOffset=0) so that video and audio stay in sync.
 */
export function getAudioTargetTimeSeconds(
  trimBefore: number,
  sourceFps: number,
  sequenceLocalFrame: number,
  playbackRate: number,
  timelineFps: number
): number {
  return (trimBefore / sourceFps) + (sequenceLocalFrame * playbackRate / timelineFps);
}
