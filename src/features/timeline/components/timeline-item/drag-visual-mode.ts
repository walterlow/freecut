export type TimelineItemGestureMode =
  | 'none'
  | 'trim'
  | 'rolling'
  | 'ripple'
  | 'stretch'
  | 'slip'
  | 'slide'

interface TimelineItemGestureModeParams {
  isTrimming: boolean
  isRollingEdit: boolean
  isRippleEdit: boolean
  isStretching: boolean
  isSlipSlideActive: boolean
  slipSlideMode: 'slip' | 'slide' | null
}

interface TimelineItemDragParticipationParams {
  itemId: string
  dragState: {
    isDragging: boolean
    draggedItemIds: string[]
    draggedItemIdSet?: Set<string>
    isAltDrag?: boolean
  } | null
  gestureMode: TimelineItemGestureMode
}

interface TimelineItemDragOpacityParams {
  isBeingDragged: boolean
  isAltDrag: boolean
  gestureMode: TimelineItemGestureMode
}

export function getTimelineItemGestureMode({
  isTrimming,
  isRollingEdit,
  isRippleEdit,
  isStretching,
  isSlipSlideActive,
  slipSlideMode,
}: TimelineItemGestureModeParams): TimelineItemGestureMode {
  if (isTrimming) {
    if (isRollingEdit) return 'rolling'
    if (isRippleEdit) return 'ripple'
    return 'trim'
  }

  if (isStretching) return 'stretch'

  if (isSlipSlideActive) {
    return slipSlideMode === 'slide' ? 'slide' : 'slip'
  }

  return 'none'
}

export function getTimelineItemDragParticipation({
  itemId,
  dragState,
  gestureMode,
}: TimelineItemDragParticipationParams): 0 | 1 | 2 {
  if (
    gestureMode !== 'none' ||
    !dragState?.isDragging ||
    !(dragState.draggedItemIdSet ?? new Set(dragState.draggedItemIds)).has(itemId)
  ) {
    return 0
  }

  return dragState.isAltDrag ? 2 : 1
}

export function shouldDimTimelineItemForDrag({
  isBeingDragged,
  isAltDrag,
  gestureMode,
}: TimelineItemDragOpacityParams): boolean {
  return isBeingDragged && !isAltDrag && gestureMode === 'none'
}
