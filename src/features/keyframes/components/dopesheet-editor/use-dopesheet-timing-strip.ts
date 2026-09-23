/**
 * Dopesheet timing-strip wiring.
 * Owns the markers the strip draws, the frame-delta constraint the graph pane
 * clamps its drags to, the strip's own drag controller, and the effect that
 * mirrors the strip preview into the sheet's drag preview. That mirror is the
 * reason the strip and the sheet agree during a slide, so it lives here rather
 * than in the editor.
 */

import { useCallback, useEffect, useMemo } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { useTimingStripDrag, type UseTimingStripDragReturn } from './use-timing-strip-drag'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import type { UseSelectionFrameActionsReturn } from './use-selection-frame-actions'

export interface UseDopesheetTimingStripOptions {
  showGraphPane: boolean
  showSheetPane: boolean
  activeSelectedProperty: AnimatableProperty | null
  keyframesByProperty: DopesheetEditorProps['keyframesByProperty']
  visibleKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  selectedKeyframeIds: Set<string>
  selectedRefIds: string[]
  isPropertyLocked: (property: AnimatableProperty) => boolean
  onKeyframeMove: DopesheetEditorProps['onKeyframeMove']
  disabled: boolean
  totalFrames: number
  onSelectionChange: DopesheetEditorProps['onSelectionChange']
  onDragStart: DopesheetEditorProps['onDragStart']
  onDragEnd: DopesheetEditorProps['onDragEnd']
  buildSelectionFramePreview: UseSelectionFrameActionsReturn['buildSelectionFramePreview']
  commitSelectionFramePreview: UseSelectionFrameActionsReturn['commitSelectionFramePreview']
  scheduleDragPreviewFrames: (frames: Record<string, number> | null) => void
}

export interface UseDopesheetTimingStripReturn
  extends Pick<
    UseTimingStripDragReturn,
    | 'timingStripPreviewFrames'
    | 'handleTimingStripSelectionChange'
    | 'handleTimingStripSlideStart'
    | 'handleTimingStripSlideChange'
    | 'handleTimingStripSlideEnd'
  > {
  timingStripMarkers: Array<{
    id: string
    frame: number
    selected: boolean
    draggable: boolean
  }>
  constrainGraphFrameDelta: (deltaFrames: number, draggedKeyframeIds: string[]) => number
}

/** Derives the timing strip's markers and wires its drag controller. */
export function useDopesheetTimingStrip({
  showGraphPane,
  showSheetPane,
  activeSelectedProperty,
  keyframesByProperty,
  visibleKeyframes,
  selectedKeyframeIds,
  selectedRefIds,
  isPropertyLocked,
  onKeyframeMove,
  disabled,
  totalFrames,
  onSelectionChange,
  onDragStart,
  onDragEnd,
  buildSelectionFramePreview,
  commitSelectionFramePreview,
  scheduleDragPreviewFrames,
}: UseDopesheetTimingStripOptions): UseDopesheetTimingStripReturn {
  const timingStripMarkers = useMemo(() => {
    if (showGraphPane) {
      if (!activeSelectedProperty) {
        return []
      }

      return (keyframesByProperty[activeSelectedProperty] ?? []).map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: selectedKeyframeIds.has(keyframe.id),
        draggable: !!onKeyframeMove && selectedRefIds.includes(keyframe.id),
      }))
    }

    return visibleKeyframes
      .filter(({ keyframe }) => selectedKeyframeIds.has(keyframe.id))
      .map(({ property, keyframe }) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: true,
        draggable: !!onKeyframeMove && !isPropertyLocked(property),
      }))
  }, [
    activeSelectedProperty,
    isPropertyLocked,
    keyframesByProperty,
    onKeyframeMove,
    selectedKeyframeIds,
    selectedRefIds,
    visibleKeyframes,
    showGraphPane,
  ])
  const constrainGraphFrameDelta = useCallback(
    (deltaFrames: number, draggedKeyframeIds: string[]) =>
      constrainSelectedKeyframeDelta({
        keyframesByProperty,
        selectedKeyframeIds: new Set(draggedKeyframeIds),
        totalFrames,
        deltaFrames,
      }),
    [keyframesByProperty, totalFrames],
  )
  const {
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  } = useTimingStripDrag({
    disabled,
    onKeyframeMove,
    onSelectionChange,
    onDragStart,
    onDragEnd,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
  })

  // Mirror timing-strip preview into the sheet drag preview. The sheet shows in
  // both `dopesheet` and `split`, so mirror whenever the sheet pane is visible.
  useEffect(() => {
    if (!showSheetPane) {
      scheduleDragPreviewFrames(null)
      return
    }

    scheduleDragPreviewFrames(timingStripPreviewFrames)
  }, [scheduleDragPreviewFrames, timingStripPreviewFrames, showSheetPane])

  return {
    timingStripMarkers,
    constrainGraphFrameDelta,
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  }
}
