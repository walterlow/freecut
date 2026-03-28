export type NavigatorDragTarget = 'left' | 'right';

export interface NavigatorThumbMetricsInput {
  timelineWidth: number;
  viewportWidth: number;
  trackWidth: number;
  scrollLeft: number;
  minThumbWidth?: number;
}

export interface NavigatorThumbMetrics {
  maxScrollLeft: number;
  thumbWidthRatio: number;
  thumbWidth: number;
  thumbTravel: number;
  thumbLeft: number;
}

export interface NavigatorResizeDragInput {
  dragTarget: NavigatorDragTarget;
  deltaX: number;
  dragStartThumbLeft: number;
  dragStartThumbWidth: number;
  trackWidth: number;
  viewportWidth: number;
  contentDuration: number;
  rightPaddingPx?: number;
  minThumbWidth?: number;
}

export interface NavigatorResizeDragResult {
  targetThumbWidth: number;
  nextZoom: number;
  nextTimelineWidth: number;
  nextMaxScrollLeft: number;
  nextThumbLeft: number;
  nextThumbTravel: number;
  nextScrollLeft: number;
}

const DEFAULT_MIN_THUMB_WIDTH = 40;
const DEFAULT_RIGHT_PADDING_PX = 50;

export function getNavigatorThumbMetrics({
  timelineWidth,
  viewportWidth,
  trackWidth,
  scrollLeft,
  minThumbWidth = DEFAULT_MIN_THUMB_WIDTH,
}: NavigatorThumbMetricsInput): NavigatorThumbMetrics {
  const effectiveTimelineWidth = Math.max(timelineWidth, viewportWidth || 0, 1);
  const maxScrollLeft = Math.max(0, effectiveTimelineWidth - viewportWidth);
  const thumbWidthRatio = viewportWidth > 0
    ? Math.min(1, viewportWidth / effectiveTimelineWidth)
    : 1;
  const thumbWidth = trackWidth > 0
    ? (thumbWidthRatio >= 1 ? trackWidth : Math.max(minThumbWidth, thumbWidthRatio * trackWidth))
    : 0;
  const thumbTravel = Math.max(0, trackWidth - thumbWidth);
  const thumbLeft = maxScrollLeft > 0 && thumbTravel > 0
    ? (scrollLeft / maxScrollLeft) * thumbTravel
    : 0;

  return {
    maxScrollLeft,
    thumbWidthRatio,
    thumbWidth,
    thumbTravel,
    thumbLeft,
  };
}

export function getNavigatorResizeDragResult({
  dragTarget,
  deltaX,
  dragStartThumbLeft,
  dragStartThumbWidth,
  trackWidth,
  viewportWidth,
  contentDuration,
  rightPaddingPx = DEFAULT_RIGHT_PADDING_PX,
  minThumbWidth = DEFAULT_MIN_THUMB_WIDTH,
}: NavigatorResizeDragInput): NavigatorResizeDragResult {
  const targetThumbWidth = dragTarget === 'left'
    ? Math.max(minThumbWidth, Math.min(trackWidth, dragStartThumbWidth - deltaX))
    : Math.max(minThumbWidth, Math.min(trackWidth, dragStartThumbWidth + deltaX));

  const desiredTimelineWidth = viewportWidth > 0
    ? Math.max(viewportWidth, (viewportWidth * trackWidth) / targetThumbWidth)
    : Math.max(trackWidth, 1);

  const desiredContentWidth = Math.max(0, desiredTimelineWidth - rightPaddingPx);
  const nextZoom = Math.max(0.01, Math.min(2, desiredContentWidth / (contentDuration * 100)));
  const nextContentWidth = contentDuration * nextZoom * 100;
  const nextTimelineWidth = nextContentWidth > viewportWidth
    ? nextContentWidth + rightPaddingPx
    : Math.max(viewportWidth, nextContentWidth);
  const nextMaxScrollLeft = Math.max(0, nextTimelineWidth - viewportWidth);
  const nextThumbTravel = Math.max(0, trackWidth - targetThumbWidth);
  const fixedRightEdge = dragStartThumbLeft + dragStartThumbWidth;
  const nextThumbLeft = dragTarget === 'left'
    ? Math.max(0, Math.min(nextThumbTravel, fixedRightEdge - targetThumbWidth))
    : Math.max(0, Math.min(nextThumbTravel, dragStartThumbLeft));
  const nextScrollLeft = nextThumbTravel > 0 && nextMaxScrollLeft > 0
    ? (nextThumbLeft / nextThumbTravel) * nextMaxScrollLeft
    : 0;

  return {
    targetThumbWidth,
    nextZoom,
    nextTimelineWidth,
    nextMaxScrollLeft,
    nextThumbLeft,
    nextThumbTravel,
    nextScrollLeft,
  };
}
