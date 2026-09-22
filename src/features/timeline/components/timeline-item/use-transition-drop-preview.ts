import { useCallback, useMemo } from 'react'
import type { TimelineItem as TimelineItemType } from '@/types/timeline'
import { TRANSITION_CONFIGS } from '@/types/transition'
import {
  useTransitionDragStore,
  type DraggedTransitionDescriptor,
} from '@/shared/state/transition-drag'
import { useItemsStore } from '../../stores/items-store'
import { getTransitionBridgeBounds } from '../../utils/transition-preview-geometry'
import { frameToPixelsNow } from '../../utils/zoom-conversions'

// Cut-drop hit zones: wide enough to stay hittable when zoomed out, bounded so
// neighbouring clips keep their own drop area.
const TRANSITION_DROP_HIT_MIN_WIDTH_PX = 72
const TRANSITION_DROP_HIT_MAX_WIDTH_PX = 240
const TRANSITION_DROP_GHOST_MIN_WIDTH_PX = 32

export interface TransitionDropPreviewState {
  draggedTransition: DraggedTransitionDescriptor | null
  transitionDropGhost: { left: number; width: number; cutOffset: number } | null
  transitionDropHitWidth: number
}

interface UseTransitionDropPreviewParams {
  itemId: string
  previewBaseItem: TimelineItemType
}

/**
 * Transition-drag state for one clip: whether a transition is being dragged,
 * the bridge ghost this clip anchors, and the cut-drop hit width.
 */
export function useTransitionDropPreview({
  itemId,
  previewBaseItem,
}: UseTransitionDropPreviewParams): TransitionDropPreviewState {
  const draggedTransition = useTransitionDragStore((s) => s.draggedTransition)
  const transitionDragPreview = useTransitionDragStore(
    useCallback(
      (s) => {
        if (!s.preview || s.preview.existingTransitionId) return null
        return s.preview.leftClipId === itemId ? s.preview : null
      },
      [itemId],
    ),
  )
  const transitionDragPreviewRightClip = useItemsStore(
    useCallback(
      (s) => {
        if (!transitionDragPreview) return null
        return s.itemById[transitionDragPreview.rightClipId] ?? null
      },
      [transitionDragPreview],
    ),
  )

  const transitionDropGhost = useMemo(() => {
    if (!transitionDragPreview || !transitionDragPreviewRightClip) return null

    const bridge = getTransitionBridgeBounds(
      previewBaseItem.from,
      previewBaseItem.durationInFrames,
      transitionDragPreviewRightClip.from,
      transitionDragPreview.durationInFrames,
      transitionDragPreview.alignment,
    )
    const leftPx = Math.round(frameToPixelsNow(bridge.leftFrame))
    const rightPx = Math.round(frameToPixelsNow(bridge.rightFrame))
    const cutPx = Math.round(frameToPixelsNow(transitionDragPreviewRightClip.from))
    const naturalWidth = rightPx - leftPx
    const minWidth = TRANSITION_DROP_GHOST_MIN_WIDTH_PX
    const left = naturalWidth >= minWidth ? leftPx : leftPx - (minWidth - naturalWidth) / 2

    return {
      left,
      width: Math.max(naturalWidth, minWidth),
      cutOffset: cutPx - left,
    }
  }, [
    previewBaseItem.durationInFrames,
    previewBaseItem.from,
    transitionDragPreview,
    transitionDragPreviewRightClip,
  ])

  const transitionDropHitWidth = Math.min(
    TRANSITION_DROP_HIT_MAX_WIDTH_PX,
    Math.max(
      TRANSITION_DROP_HIT_MIN_WIDTH_PX,
      Math.round(frameToPixelsNow(TRANSITION_CONFIGS.crossfade.defaultDuration) * 2),
    ),
  )

  return { draggedTransition, transitionDropGhost, transitionDropHitWidth }
}
