interface Viewport {
  startFrame: number;
  endFrame: number;
}

const KEYFRAME_BUTTON_SIZE = 12;
export const KEYFRAME_EDGE_INSET = Math.ceil((Math.sqrt(2) * KEYFRAME_BUTTON_SIZE) / 2);

export function getVisibleKeyframeX(
  frame: number,
  viewport: Viewport,
  timelineWidth: number
): number | null {
  if (timelineWidth <= 0) return null;
  if (frame < viewport.startFrame || frame > viewport.endFrame) return null;

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame);
  const rawX = ((frame - viewport.startFrame) / frameRange) * timelineWidth;
  const minX = KEYFRAME_EDGE_INSET;
  const maxX = timelineWidth - KEYFRAME_EDGE_INSET;

  if (maxX <= minX) {
    return timelineWidth / 2;
  }

  return Math.max(minX, Math.min(maxX, rawX));
}
