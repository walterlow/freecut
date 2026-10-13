interface Viewport {
  startFrame: number
  endFrame: number
}

const KEYFRAME_BUTTON_SIZE = 12
export const KEYFRAME_DIAMOND_SIDE_PX = 8
export const KEYFRAME_DIAMOND_RENDERED_WIDTH_PX = Math.SQRT2 * KEYFRAME_DIAMOND_SIDE_PX
export const KEYFRAME_EDGE_INSET = Math.ceil((Math.sqrt(2) * KEYFRAME_BUTTON_SIZE) / 2)

function getFrameRange(viewport: Viewport): number {
  return Math.max(1, viewport.endFrame - viewport.startFrame)
}

function getUsableTimelineWidth(timelineWidth: number, edgeInset: number): number {
  return Math.max(0, timelineWidth - edgeInset * 2)
}

export function getFrameAxisX(
  frame: number,
  viewport: Viewport,
  timelineWidth: number,
  edgeInset = KEYFRAME_EDGE_INSET,
): number {
  if (timelineWidth <= 0) return 0

  const usableWidth = getUsableTimelineWidth(timelineWidth, edgeInset)
  if (usableWidth <= 0) {
    return timelineWidth / 2
  }

  const frameRange = getFrameRange(viewport)
  return edgeInset + ((frame - viewport.startFrame) / frameRange) * usableWidth
}

export function getFrameFromAxisX(
  x: number,
  viewport: Viewport,
  timelineWidth: number,
  edgeInset = KEYFRAME_EDGE_INSET,
): number {
  const usableWidth = getUsableTimelineWidth(timelineWidth, edgeInset)
  if (timelineWidth <= 0 || usableWidth <= 0) {
    return viewport.startFrame
  }

  const frameRange = getFrameRange(viewport)
  const clampedX = Math.max(edgeInset, Math.min(timelineWidth - edgeInset, x))
  const relative = (clampedX - edgeInset) / usableWidth
  return Math.round(viewport.startFrame + relative * frameRange)
}

export function getVisibleKeyframeX(
  frame: number,
  viewport: Viewport,
  timelineWidth: number,
  edgeInset = KEYFRAME_EDGE_INSET,
): number | null {
  if (timelineWidth <= 0) return null
  if (frame < viewport.startFrame || frame > viewport.endFrame) return null
  const minX = edgeInset
  const maxX = timelineWidth - edgeInset

  if (maxX <= minX) {
    return timelineWidth / 2
  }

  return Math.max(minX, Math.min(maxX, getFrameAxisX(frame, viewport, timelineWidth, edgeInset)))
}
