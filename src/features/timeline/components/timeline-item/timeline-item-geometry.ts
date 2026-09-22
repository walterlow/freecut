// Track-push trigger zone: scale with zoom so it stays hittable when zoomed out
const TRACK_PUSH_MIN_PX = 6
const TRACK_PUSH_MAX_PX = 14
const TRACK_PUSH_ZOOM_THRESHOLD = 120

/** Frame offset → CSS left/width against the timeline's percent-per-frame scale. */
export function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

/** Zoom-adaptive track-push hit zone, clamped to the gap it sits in. */
export function getTrackPushZoneStyle(gapFrames: number): string {
  const safeGapFrames = Math.max(0, gapFrames)
  const gapWidth = `calc(${safeGapFrames} * var(--timeline-percent-per-frame, 0%))`
  const zoomSlopeDivisor = TRACK_PUSH_ZOOM_THRESHOLD / (TRACK_PUSH_MAX_PX - TRACK_PUSH_MIN_PX)
  const adaptiveWidth = `clamp(${TRACK_PUSH_MIN_PX}px, calc(${TRACK_PUSH_MAX_PX}px - (var(--timeline-percent-per-second, 0%) / ${zoomSlopeDivisor})), ${TRACK_PUSH_MAX_PX}px)`
  return `min(${gapWidth}, ${adaptiveWidth})`
}
