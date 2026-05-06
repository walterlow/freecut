import { describe, expect, it } from 'vite-plus/test'
import {
  getTimelineItemDragParticipation,
  getTimelineItemGestureMode,
  shouldDimTimelineItemForDrag,
} from './drag-visual-mode'

describe('drag visual mode', () => {
  it('classifies gesture modes for trim-family and smart-edit tools', () => {
    expect(
      getTimelineItemGestureMode({
        isTrimming: true,
        isRollingEdit: false,
        isRippleEdit: false,
        isStretching: false,
        isSlipSlideActive: false,
        slipSlideMode: null,
      }),
    ).toBe('trim')

    expect(
      getTimelineItemGestureMode({
        isTrimming: true,
        isRollingEdit: true,
        isRippleEdit: false,
        isStretching: false,
        isSlipSlideActive: false,
        slipSlideMode: null,
      }),
    ).toBe('rolling')

    expect(
      getTimelineItemGestureMode({
        isTrimming: true,
        isRollingEdit: false,
        isRippleEdit: true,
        isStretching: false,
        isSlipSlideActive: false,
        slipSlideMode: null,
      }),
    ).toBe('ripple')

    expect(
      getTimelineItemGestureMode({
        isTrimming: false,
        isRollingEdit: false,
        isRippleEdit: false,
        isStretching: true,
        isSlipSlideActive: false,
        slipSlideMode: null,
      }),
    ).toBe('stretch')

    expect(
      getTimelineItemGestureMode({
        isTrimming: false,
        isRollingEdit: false,
        isRippleEdit: false,
        isStretching: false,
        isSlipSlideActive: true,
        slipSlideMode: 'slip',
      }),
    ).toBe('slip')

    expect(
      getTimelineItemGestureMode({
        isTrimming: false,
        isRollingEdit: false,
        isRippleEdit: false,
        isStretching: false,
        isSlipSlideActive: true,
        slipSlideMode: 'slide',
      }),
    ).toBe('slide')
  })

  it('never enters move-drag participation for edit gestures', () => {
    const dragState = {
      isDragging: true,
      draggedItemIds: ['item-1'],
      isAltDrag: false,
    }

    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'trim' }),
    ).toBe(0)
    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'rolling' }),
    ).toBe(0)
    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'ripple' }),
    ).toBe(0)
    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'stretch' }),
    ).toBe(0)
    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'slip' }),
    ).toBe(0)
    expect(
      getTimelineItemDragParticipation({ itemId: 'item-1', dragState, gestureMode: 'slide' }),
    ).toBe(0)
  })

  it('keeps move-drag participation and dimming for actual move drags only', () => {
    expect(
      getTimelineItemDragParticipation({
        itemId: 'item-1',
        dragState: {
          isDragging: true,
          draggedItemIds: ['item-1'],
          isAltDrag: false,
        },
        gestureMode: 'none',
      }),
    ).toBe(1)

    expect(
      getTimelineItemDragParticipation({
        itemId: 'item-1',
        dragState: {
          isDragging: true,
          draggedItemIds: ['item-1'],
          isAltDrag: true,
        },
        gestureMode: 'none',
      }),
    ).toBe(2)

    expect(
      shouldDimTimelineItemForDrag({
        isBeingDragged: true,
        isAltDrag: false,
        gestureMode: 'none',
      }),
    ).toBe(true)

    expect(
      shouldDimTimelineItemForDrag({
        isBeingDragged: true,
        isAltDrag: false,
        gestureMode: 'rolling',
      }),
    ).toBe(false)
  })
})
