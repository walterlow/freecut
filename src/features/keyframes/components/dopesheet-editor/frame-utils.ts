import type { BlockedFrameRange } from '../../utils/transition-region'

export function clampFrame(frame: number, totalFrames: number): number {
  if (totalFrames <= 0) return 0
  return Math.max(0, Math.min(totalFrames - 1, frame))
}

export function clampToAvoidBlockedRanges(
  frame: number,
  initialFrame: number,
  blockedRanges: BlockedFrameRange[],
): number {
  if (blockedRanges.length === 0) return frame

  let candidate = frame
  let changed = true

  // Re-scan all ranges until the candidate settles outside every range.
  while (changed) {
    changed = false
    for (const range of blockedRanges) {
      if (candidate >= range.start && candidate < range.end) {
        if (initialFrame < range.start) {
          candidate = range.start - 1
        } else if (initialFrame >= range.end) {
          candidate = range.end
        } else {
          const distToStart = candidate - range.start
          const distToEnd = range.end - candidate
          candidate = distToStart < distToEnd ? range.start - 1 : range.end
        }
        changed = true
      }
    }
  }

  return candidate
}
