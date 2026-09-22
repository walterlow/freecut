/**
 * Dopesheet selection frame actions hook.
 * Owns the selection-level frame mutators the sheet calls from the header
 * inputs, the timing strip and the graph: remove selected keyframes, build a
 * preview for a requested delta, commit or duplicate that preview, and the
 * preview+commit+undo-bracketed delta move. The action layer stays in
 * selection-frame-actions; this hook only injects the component's refs,
 * lock check and move callbacks.
 */

import { useCallback, type RefObject } from 'react'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { KeyframeMeta } from './dopesheet-types'
import {
  buildSelectionFramePreview as buildSelectionFramePreviewState,
  commitSelectionFramePreview as commitSelectionFramePreviewState,
  duplicateSelectionFramePreview as duplicateSelectionFramePreviewState,
  type SelectionFramePreview,
} from './selection-frame-actions'

export interface UseSelectionFrameActionsOptions {
  /** Selected refs, already filtered by lock state and existing metadata. */
  selectedRefs: KeyframeRef[]
  selectedRefIds: string[]
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  totalFrames: number
  transitionBlockedRanges: BlockedFrameRange[]
  itemId: string
  disabled: boolean
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  onKeyframesMove?: (
    entries: Array<{ ref: KeyframeRef; newFrame: number; newValue: number }>,
  ) => void
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}

export interface UseSelectionFrameActionsReturn {
  handleRemoveKeyframes: () => void
  buildSelectionFramePreview: (
    selectionIds: Iterable<string>,
    requestedDeltaFrames: number,
  ) => SelectionFramePreview
  commitSelectionFramePreview: (
    selectionIds: Iterable<string>,
    previewFrames: Record<string, number> | null,
  ) => boolean
  duplicateSelectionFramePreview: (
    selectionIds: Iterable<string>,
    previewFrames: Record<string, number> | null,
  ) => boolean
  moveSelectedKeyframesByDelta: (deltaFrames: number) => {
    didMove: boolean
    appliedDeltaFrames: number
  }
}

export function useSelectionFrameActions({
  selectedRefs,
  selectedRefIds,
  keyframeMetaByIdRef,
  isPropertyLocked,
  keyframesByProperty,
  totalFrames,
  transitionBlockedRanges,
  itemId,
  disabled,
  onRemoveKeyframes,
  onKeyframeMove,
  onKeyframesMove,
  onDuplicateKeyframes,
  onDragStart,
  onDragEnd,
}: UseSelectionFrameActionsOptions): UseSelectionFrameActionsReturn {
  const handleRemoveKeyframes = useCallback(() => {
    if (!onRemoveKeyframes || selectedRefs.length === 0) return
    onRemoveKeyframes(selectedRefs)
  }, [onRemoveKeyframes, selectedRefs])

  const buildSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, requestedDeltaFrames: number) => {
      return buildSelectionFramePreviewState({
        selectionIds,
        requestedDeltaFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        keyframesByProperty,
        totalFrames,
        transitionBlockedRanges,
      })
    },
    [
      isPropertyLocked,
      keyframeMetaByIdRef,
      keyframesByProperty,
      totalFrames,
      transitionBlockedRanges,
    ],
  )

  const commitSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return commitSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onKeyframeMove,
        onKeyframesMove,
      })
    },
    [isPropertyLocked, keyframeMetaByIdRef, itemId, onKeyframeMove, onKeyframesMove],
  )
  const duplicateSelectionFramePreview = useCallback(
    (selectionIds: Iterable<string>, previewFrames: Record<string, number> | null) => {
      return duplicateSelectionFramePreviewState({
        selectionIds,
        previewFrames,
        keyframeMetaById: keyframeMetaByIdRef.current,
        isPropertyLocked,
        itemId,
        onDuplicateKeyframes,
      })
    },
    [isPropertyLocked, keyframeMetaByIdRef, itemId, onDuplicateKeyframes],
  )

  const moveSelectedKeyframesByDelta = useCallback(
    (deltaFrames: number) => {
      if (disabled || !onKeyframeMove || selectedRefIds.length === 0 || deltaFrames === 0) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      const preview = buildSelectionFramePreview(selectedRefIds, deltaFrames)
      if (!preview.previewFrames) {
        return { didMove: false, appliedDeltaFrames: 0 }
      }

      onDragStart?.()
      const didMove = commitSelectionFramePreview(
        preview.movableSelectionIds,
        preview.previewFrames,
      )
      onDragEnd?.()

      return {
        didMove,
        appliedDeltaFrames: preview.appliedDeltaFrames,
      }
    },
    [
      buildSelectionFramePreview,
      commitSelectionFramePreview,
      disabled,
      onDragEnd,
      onDragStart,
      onKeyframeMove,
      selectedRefIds,
    ],
  )

  return {
    handleRemoveKeyframes,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    moveSelectedKeyframesByDelta,
  }
}
