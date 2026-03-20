interface Viewport {
  startFrame: number;
  endFrame: number;
}

const KEYFRAME_BUTTON_SIZE = 12;
export const KEYFRAME_EDGE_INSET = Math.ceil((Math.sqrt(2) * KEYFRAME_BUTTON_SIZE) / 2);

function getFrameRange(viewport: Viewport): number {
  return Math.max(1, viewport.endFrame - viewport.startFrame);
}

function getUsableTimelineWidth(timelineWidth: number): number {
  return Math.max(0, timelineWidth - KEYFRAME_EDGE_INSET * 2);
}

export function getFrameAxisX(
  frame: number,
  viewport: Viewport,
  timelineWidth: number
): number {
  if (timelineWidth <= 0) return 0;

  const usableWidth = getUsableTimelineWidth(timelineWidth);
  if (usableWidth <= 0) {
    return timelineWidth / 2;
  }

  const frameRange = getFrameRange(viewport);
  return KEYFRAME_EDGE_INSET + ((frame - viewport.startFrame) / frameRange) * usableWidth;
}

export function getFrameFromAxisX(
  x: number,
  viewport: Viewport,
  timelineWidth: number
): number {
  const usableWidth = getUsableTimelineWidth(timelineWidth);
  if (timelineWidth <= 0 || usableWidth <= 0) {
    return viewport.startFrame;
  }

  const frameRange = getFrameRange(viewport);
  const relative = (x - KEYFRAME_EDGE_INSET) / usableWidth;
  return Math.round(viewport.startFrame + relative * frameRange);
}

export function getVisibleKeyframeX(
  frame: number,
  viewport: Viewport,
  timelineWidth: number
): number | null {
  if (timelineWidth <= 0) return null;
  if (frame < viewport.startFrame || frame > viewport.endFrame) return null;
  const minX = KEYFRAME_EDGE_INSET;
  const maxX = timelineWidth - KEYFRAME_EDGE_INSET;

  if (maxX <= minX) {
    return timelineWidth / 2;
  }

  return Math.max(minX, Math.min(maxX, getFrameAxisX(frame, viewport, timelineWidth)));
}
