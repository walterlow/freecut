import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { clampFrame, clampToAvoidBlockedRanges } from './frame-utils'

type KeyframeMetaLike = {
  property: AnimatableProperty
  keyframe: Keyframe
}

export interface SelectionFramePreview {
  movableSelectionIds: string[]
  previewFrames: Record<string, number> | null
  appliedDeltaFrames: number
}

interface BuildSelectionFramePreviewArgs {
  selectionIds: Iterable<string>
  requestedDeltaFrames: number
  keyframeMetaById: ReadonlyMap<string, KeyframeMetaLike>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  totalFrames: number
  transitionBlockedRanges: BlockedFrameRange[]
}

interface CommitSelectionFramePreviewArgs {
  selectionIds: Iterable<string>
  previewFrames: Record<string, number> | null
  keyframeMetaById: ReadonlyMap<string, KeyframeMetaLike>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
}

interface DuplicateSelectionFramePreviewArgs {
  selectionIds: Iterable<string>
  previewFrames: Record<string, number> | null
  keyframeMetaById: ReadonlyMap<string, KeyframeMetaLike>
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
}

export function buildSelectionFramePreview({
  selectionIds,
  requestedDeltaFrames,
  keyframeMetaById,
  isPropertyLocked,
  keyframesByProperty,
  totalFrames,
  transitionBlockedRanges,
}: BuildSelectionFramePreviewArgs): SelectionFramePreview {
  const movableSelectionIds = Array.from(selectionIds).filter((keyframeId) => {
    const meta = keyframeMetaById.get(keyframeId)
    return !!meta && !isPropertyLocked(meta.property)
  })

  if (movableSelectionIds.length === 0 || requestedDeltaFrames === 0) {
    return {
      movableSelectionIds,
      previewFrames: null,
      appliedDeltaFrames: 0,
    }
  }

  const constrainedDeltaFrames = constrainSelectedKeyframeDelta({
    keyframesByProperty,
    selectedKeyframeIds: new Set(movableSelectionIds),
    totalFrames,
    deltaFrames: requestedDeltaFrames,
  })

  // Compute a single blocked-safe delta for the whole selection so all keyframes
  // move by the same amount and stay in sync.
  const allowedDeltas: number[] = []
  for (const keyframeId of movableSelectionIds) {
    const meta = keyframeMetaById.get(keyframeId)
    if (!meta) continue

    const initialFrame = meta.keyframe.frame
    let candidate = clampFrame(initialFrame + constrainedDeltaFrames, totalFrames)
    candidate = clampToAvoidBlockedRanges(candidate, initialFrame, transitionBlockedRanges)
    candidate = clampFrame(candidate, totalFrames)
    allowedDeltas.push(candidate - initialFrame)
  }

  const commonDelta =
    allowedDeltas.length === 0
      ? 0
      : constrainedDeltaFrames > 0
        ? Math.min(...allowedDeltas)
        : Math.max(...allowedDeltas)

  const nextPreviewFrames: Record<string, number> = {}
  for (const keyframeId of movableSelectionIds) {
    const meta = keyframeMetaById.get(keyframeId)
    if (!meta) continue

    const nextFrame = meta.keyframe.frame + commonDelta
    if (nextFrame === meta.keyframe.frame) continue
    nextPreviewFrames[keyframeId] = nextFrame
  }

  return {
    movableSelectionIds,
    previewFrames: Object.keys(nextPreviewFrames).length > 0 ? nextPreviewFrames : null,
    appliedDeltaFrames: commonDelta,
  }
}

export function commitSelectionFramePreview({
  selectionIds,
  previewFrames,
  keyframeMetaById,
  isPropertyLocked,
  itemId,
  onKeyframeMove,
}: CommitSelectionFramePreviewArgs): boolean {
  if (!onKeyframeMove || !previewFrames) {
    return false
  }

  let hasChanges = false
  for (const keyframeId of selectionIds) {
    const nextFrame = previewFrames[keyframeId]
    if (nextFrame === undefined) {
      continue
    }

    const meta = keyframeMetaById.get(keyframeId)
    if (!meta || isPropertyLocked(meta.property)) {
      continue
    }

    onKeyframeMove({ itemId, property: meta.property, keyframeId }, nextFrame, meta.keyframe.value)
    hasChanges = true
  }

  return hasChanges
}

export function duplicateSelectionFramePreview({
  selectionIds,
  previewFrames,
  keyframeMetaById,
  isPropertyLocked,
  itemId,
  onDuplicateKeyframes,
}: DuplicateSelectionFramePreviewArgs): boolean {
  if (!onDuplicateKeyframes || !previewFrames) {
    return false
  }

  const entries: Array<{ ref: KeyframeRef; frame: number; value: number }> = []
  for (const keyframeId of selectionIds) {
    const nextFrame = previewFrames[keyframeId]
    if (nextFrame === undefined) {
      continue
    }

    const meta = keyframeMetaById.get(keyframeId)
    if (!meta || isPropertyLocked(meta.property)) {
      continue
    }

    entries.push({
      ref: { itemId, property: meta.property, keyframeId },
      frame: nextFrame,
      value: meta.keyframe.value,
    })
  }

  if (entries.length === 0) {
    return false
  }

  onDuplicateKeyframes(entries)
  return true
}
