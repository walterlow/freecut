/**
 * Dopesheet pointer dispatch.
 * Owns the two marquee entry points the sheet exposes (row surface and timeline
 * background) and the wheel forwarding the docked Edit presentation uses to hand
 * its navigation gestures to the main timeline. Pure wiring: every collaborator,
 * including the marquee controller, is injected by the editor.
 */

import { useCallback, useEffect, type RefObject } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { setPointerCaptureSafely } from './dopesheet-utils'
import type { UseDopesheetMarqueeReturn } from './use-dopesheet-marquee'

export interface UseDopesheetPointerDispatchOptions {
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  selectedKeyframeIds: Set<string>
  onActivePropertyChange?: (property: AnimatableProperty) => void
  beginMarqueeSelection: UseDopesheetMarqueeReturn['beginMarqueeSelection']
  getMarqueeModeFromPointerEvent: UseDopesheetMarqueeReturn['getMarqueeModeFromPointerEvent']
}

export interface UseDopesheetPointerDispatchReturn {
  handleRowPointerDown: (
    property: AnimatableProperty,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void
  handleTimelineBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function useDopesheetPointerDispatch({
  disabled,
  isPropertyLocked,
  selectedKeyframeIds,
  onActivePropertyChange,
  beginMarqueeSelection,
  getMarqueeModeFromPointerEvent,
}: UseDopesheetPointerDispatchOptions): UseDopesheetPointerDispatchReturn {
  const handleRowPointerDown = useCallback(
    (property: AnimatableProperty, event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      beginMarqueeSelection,
      disabled,
      getMarqueeModeFromPointerEvent,
      isPropertyLocked,
      onActivePropertyChange,
      selectedKeyframeIds,
    ],
  )

  const handleTimelineBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, selectedKeyframeIds],
  )

  return { handleRowPointerDown, handleTimelineBackgroundPointerDown }
}

export interface UseLinkedTimelineWheelForwardingOptions {
  rootRef: RefObject<HTMLDivElement | null>
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
  viewportInteractionEnabled: boolean
}

/** Forwards navigation gestures of a linked Edit sheet to the main timeline. */
export function useLinkedTimelineWheelForwarding({
  rootRef,
  timelineScrollContainerRef,
  viewportInteractionEnabled,
}: UseLinkedTimelineWheelForwardingOptions): void {
  // Edit shares the main timeline axis and deliberately disables the local
  // viewport mutators. Forward its navigation gestures to the main timeline's
  // non-passive wheel listener so momentum, bounds, cursor anchoring, live DOM
  // geometry, and store throttling remain one implementation.
  useEffect(() => {
    const root = rootRef.current
    const timeline = timelineScrollContainerRef?.current
    if (!root || !timeline || viewportInteractionEnabled) return

    const forwardLinkedTimelineWheel = (event: WheelEvent) => {
      const isZoomGesture = event.ctrlKey || event.metaKey
      // App.tsx prevents native browser zoom during document capture, so a
      // Ctrl/Cmd-wheel event arrives here with defaultPrevented already set.
      // It still needs to reach the main timeline's anchored zoom handler.
      if ((!isZoomGesture && event.defaultPrevented) || event.shiftKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      timeline.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          button: event.button,
          buttons: event.buttons,
        }),
      )
    }

    root.addEventListener('wheel', forwardLinkedTimelineWheel, {
      passive: false,
    })
    return () => root.removeEventListener('wheel', forwardLinkedTimelineWheel)
  }, [rootRef, timelineScrollContainerRef, viewportInteractionEnabled])
}
