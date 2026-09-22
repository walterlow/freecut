import { useCallback, useEffect, type RefObject } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { addWindowPointerListeners } from './dopesheet-pointer-listeners'
import {
  getDopesheetDragDelta,
  getMatchingDragState,
  startDopesheetDrag,
} from './dopesheet-drag-math'
import type { DopesheetPropertyGroup, DragState, KeyframeMeta } from './dopesheet-types'
import type { SelectionFramePreview } from './selection-frame-actions'
import { setPointerCaptureSafely } from './dopesheet-utils'
import {
  collectInitialFrames,
  getMovableGroupEntries,
  getPointerSelectionModifier,
  isGroupPointerDownIgnored,
  resolveClickSelection,
  resolveGroupClickSelection,
  resolveGroupModifierSelection,
  resolveKeyframeModifierSelection,
} from './row-action-helpers'

function syncSelectionAnchors(
  anchors: RefObject<Map<AnimatableProperty, string>>,
  entries: Array<{ property: AnimatableProperty; keyframe: { id: string } }>,
): void {
  for (const { property, keyframe } of entries) anchors.current.set(property, keyframe.id)
}

/** Arms the drag. The window pointer listener decides what the gesture actually does. */
function beginKeyframeDrag(
  dragStateRef: RefObject<DragState | null>,
  scheduleDragPreviewFrames: (frames: Record<string, number> | null) => void,
  drag: {
    anchorKeyframeId: string
    selectedKeyframeIds: string[]
    initialFrames: Map<string, number>
    duplicateOnCommit: boolean
  },
  event: React.PointerEvent<HTMLButtonElement>,
): void {
  dragStateRef.current = {
    ...drag,
    startClientX: event.clientX,
    pointerId: event.pointerId,
    started: false,
    appliedDeltaFrames: 0,
  }
  scheduleDragPreviewFrames(null)
  setPointerCaptureSafely(event.currentTarget, event.pointerId)
}

export interface UseKeyframeDragParams {
  disabled: boolean
  totalFrames: number
  snapEnabled: boolean
  snapFrame: (frame: number) => number
  isPropertyLocked: (property: AnimatableProperty) => boolean
  selectedKeyframeIds: ReadonlySet<string>
  rowKeyframesByProperty: Map<AnimatableProperty, Keyframe[]>
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  /** Shared with the marquee applier, which reads the arming drag to echo its preview. */
  dragStateRef: RefObject<DragState | null>
  /** Shared with the marquee selection path, which advances the per-property anchor. */
  selectionAnchorByPropertyRef: RefObject<Map<AnimatableProperty, string>>
  scheduleDragPreviewFrames: (frames: Record<string, number> | null) => void
  buildSelectionFramePreview: (
    selectionIds: Iterable<string>,
    requestedDeltaFrames: number,
  ) => SelectionFramePreview
  commitSelectionFramePreview: (
    selectionIds: Iterable<string>,
    previewFrames: Record<string, number> | null,
  ) => void
  duplicateSelectionFramePreview: (
    selectionIds: Iterable<string>,
    previewFrames: Record<string, number> | null,
  ) => void
  getLiveDragPixelsPerFrame: () => number
  onSelectionChange?: (
    selection: Set<string>,
    options?: { preserveExternalSelection?: boolean },
  ) => void
  onActivePropertyChange?: (property: AnimatableProperty) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragCancel?: () => void
  /** Returns true when the caller handled the frames itself (delegated drag). */
  onSelectionFrameDelta?: (deltaFrames: number, phase: 'preview' | 'commit' | 'cancel') => boolean
  onKeyframeMove?: unknown
  onDuplicateKeyframes?: unknown
}

export interface KeyframeDrag {
  handleKeyframePointerDown: (
    property: AnimatableProperty,
    keyframeId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
  handleGroupKeyframePointerDown: (
    frameGroup: DopesheetPropertyGroup['frameGroups'][number],
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
}

/**
 * Keyframe dragging in the dopesheet.
 *
 * A pointer-down only arms the drag: it records the selection and where the pointer
 * started. The window-level pointer listener decides what happens next — movement
 * previews frames and never commits, release commits exactly once, cancel restores
 * and reports the applied delta. A caller that handles frames itself (delegated
 * composition drags) returns true from `onSelectionFrameDelta`, which suppresses the
 * local commit so the gesture cannot be applied twice.
 */
export function useKeyframeDrag(params: UseKeyframeDragParams): KeyframeDrag {
  const {
    disabled,
    totalFrames,
    snapEnabled,
    snapFrame,
    isPropertyLocked,
    selectedKeyframeIds,
    rowKeyframesByProperty,
    keyframeMetaByIdRef,
    dragStateRef,
    selectionAnchorByPropertyRef,
    scheduleDragPreviewFrames,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    getLiveDragPixelsPerFrame,
    onSelectionChange,
    onActivePropertyChange,
    onDragStart,
    onDragEnd,
    onDragCancel,
    onSelectionFrameDelta,
    onKeyframeMove,
    onDuplicateKeyframes,
  } = params

  const handleKeyframePointerDown = useCallback(
    (
      property: AnimatableProperty,
      keyframeId: string,
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      const modifierSelection = resolveKeyframeModifierSelection(
        getPointerSelectionModifier(event),
        selectedKeyframeIds,
        keyframeId,
        rowKeyframesByProperty.get(property),
        selectionAnchorByPropertyRef.current.get(property),
      )
      if (modifierSelection) {
        onSelectionChange?.(modifierSelection, { preserveExternalSelection: true })
        selectionAnchorByPropertyRef.current.set(property, keyframeId)
        return
      }

      const { baseSelection, selectedIdsForDrag } = resolveClickSelection(
        selectedKeyframeIds,
        keyframeId,
      )
      if (!selectedKeyframeIds.has(keyframeId)) {
        onSelectionChange?.(baseSelection)
      }
      selectionAnchorByPropertyRef.current.set(property, keyframeId)

      beginKeyframeDrag(
        dragStateRef,
        scheduleDragPreviewFrames,
        {
          anchorKeyframeId: keyframeId,
          selectedKeyframeIds: selectedIdsForDrag,
          initialFrames: collectInitialFrames(selectedIdsForDrag, keyframeMetaByIdRef.current),
          duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
        },
        event,
      )
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      rowKeyframesByProperty,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      onSelectionChange,
      keyframeMetaByIdRef,
      dragStateRef,
      selectionAnchorByPropertyRef,
    ],
  )

  const handleGroupKeyframePointerDown = useCallback(
    (
      frameGroup: DopesheetPropertyGroup['frameGroups'][number],
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (isGroupPointerDownIgnored(disabled, event)) return

      const movableEntries = getMovableGroupEntries(frameGroup.keyframes, isPropertyLocked)
      const anchorEntry = movableEntries[0]
      if (!anchorEntry) return

      event.preventDefault()
      event.stopPropagation()

      const keyframeIds = movableEntries.map(({ keyframe }) => keyframe.id)
      const modifierSelection = resolveGroupModifierSelection(
        getPointerSelectionModifier(event),
        selectedKeyframeIds,
        keyframeIds,
      )
      if (modifierSelection) {
        onSelectionChange?.(modifierSelection, { preserveExternalSelection: true })
        return
      }

      const { baseSelection, selectedIdsForDrag, allSelected } = resolveGroupClickSelection(
        selectedKeyframeIds,
        keyframeIds,
      )
      if (!allSelected) {
        onSelectionChange?.(baseSelection)
      }
      onActivePropertyChange?.(anchorEntry.property)
      syncSelectionAnchors(selectionAnchorByPropertyRef, movableEntries)

      beginKeyframeDrag(
        dragStateRef,
        scheduleDragPreviewFrames,
        {
          anchorKeyframeId: anchorEntry.keyframe.id,
          selectedKeyframeIds: selectedIdsForDrag,
          initialFrames: collectInitialFrames(selectedIdsForDrag, keyframeMetaByIdRef.current),
          duplicateOnCommit: !!onDuplicateKeyframes && event.altKey,
        },
        event,
      )
    },
    [
      disabled,
      isPropertyLocked,
      onDuplicateKeyframes,
      onActivePropertyChange,
      onSelectionChange,
      scheduleDragPreviewFrames,
      selectedKeyframeIds,
      keyframeMetaByIdRef,
      dragStateRef,
      selectionAnchorByPropertyRef,
    ],
  )

  useEffect(() => {
    if (!onKeyframeMove && !onDuplicateKeyframes) return

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = getMatchingDragState(dragStateRef.current, event, disabled)
      if (!dragState) return

      const deltaX = event.clientX - dragState.startClientX
      if (!startDopesheetDrag(dragState, deltaX, onDragStart)) return
      const deltaFrames = getDopesheetDragDelta(
        dragState,
        event,
        getLiveDragPixelsPerFrame(),
        totalFrames,
        snapEnabled,
        snapFrame,
      )

      const preview = buildSelectionFramePreview(dragState.selectedKeyframeIds, deltaFrames)
      const externallyHandled =
        !dragState.duplicateOnCommit && (onSelectionFrameDelta?.(deltaFrames, 'preview') ?? false)
      dragState.appliedDeltaFrames = externallyHandled ? deltaFrames : preview.appliedDeltaFrames
      if (!externallyHandled) scheduleDragPreviewFrames(preview.previewFrames)
    }

    const handlePointerUp = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return

      if (dragState.started) {
        const deltaFrames = getDopesheetDragDelta(
          dragState,
          event,
          getLiveDragPixelsPerFrame(),
          totalFrames,
          snapEnabled,
          snapFrame,
        )
        const preview = buildSelectionFramePreview(dragState.selectedKeyframeIds, deltaFrames)
        if (dragState.duplicateOnCommit) {
          duplicateSelectionFramePreview(dragState.selectedKeyframeIds, preview.previewFrames)
        } else {
          const externallyHandled = onSelectionFrameDelta?.(deltaFrames, 'commit') ?? false
          if (!externallyHandled) {
            commitSelectionFramePreview(dragState.selectedKeyframeIds, preview.previewFrames)
          }
          onDragEnd?.()
        }
      }
      dragStateRef.current = null
      scheduleDragPreviewFrames(null)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) return
      if (dragState.started && !dragState.duplicateOnCommit) {
        onSelectionFrameDelta?.(dragState.appliedDeltaFrames, 'cancel')
        onDragCancel?.()
      }
      dragStateRef.current = null
      scheduleDragPreviewFrames(null)
    }

    return addWindowPointerListeners(handlePointerMove, handlePointerUp, handlePointerCancel)
  }, [
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    disabled,
    dragStateRef,
    duplicateSelectionFramePreview,
    getLiveDragPixelsPerFrame,
    onDragCancel,
    onDragEnd,
    onDragStart,
    onDuplicateKeyframes,
    onKeyframeMove,
    onSelectionFrameDelta,
    scheduleDragPreviewFrames,
    selectionAnchorByPropertyRef,
    snapEnabled,
    snapFrame,
    totalFrames,
  ])

  return { handleKeyframePointerDown, handleGroupKeyframePointerDown }
}
