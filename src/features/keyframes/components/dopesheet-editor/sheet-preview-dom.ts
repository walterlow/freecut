/**
 * Dopesheet sheet preview DOM hook.
 * Owns the per-keyframe button refs and the imperative preview writes the sheet
 * needs: the marquee preview selection data attributes, and the drag preview
 * frames (flushSync + direct left/visibility writes so the preview lands before
 * paint). The editor injects its live selection, keyframe metadata, drag state
 * and geometry so the imperative paths keep the same ref identities they had
 * inline.
 */

import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { arePreviewFramesEqual } from './dopesheet-helpers'
import type { DragState, KeyframeMeta } from './dopesheet-types'

export interface UseSheetPreviewDomOptions {
  /** Selection currently owned by the editor, used to diff marquee previews. */
  committedKeyframeSelectionRef: RefObject<Set<string>>
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  dragStateRef: RefObject<DragState | null>
  getRenderedKeyframeX: (frame: number) => number | null
  setSheetPreviewFrames: Dispatch<SetStateAction<Record<string, number> | null>>
  setSheetPreviewDuplicateKeyframeIds: Dispatch<SetStateAction<string[] | null>>
}

export interface UseSheetPreviewDomReturn {
  setKeyframeButtonRef: (keyframeId: string, node: HTMLButtonElement | null) => void
  handleMarqueeSelectionPreviewChange: (nextSelection: Set<string> | null) => void
  scheduleDragPreviewFrames: (nextPreviewFrames: Record<string, number> | null) => void
}

/** Duplicate-preview selection for the live drag, or null when it only moves keys. */
function resolveDuplicatePreviewIds(
  dragState: DragState | null,
  nextPreviewFrames: Record<string, number> | null,
): string[] | null {
  if (!dragState?.duplicateOnCommit || !nextPreviewFrames) return null
  return dragState.selectedKeyframeIds
}

/** Frame a keyframe button should show: its preview frame, else its committed frame. */
function resolvePreviewFrame(
  keyframeId: string,
  previewFrames: Record<string, number> | null,
  keyframeMetaById: Map<string, KeyframeMeta>,
): number | undefined {
  const previewFrame = previewFrames?.[keyframeId]
  return previewFrame ?? keyframeMetaById.get(keyframeId)?.keyframe.frame
}

/** Move or hide every keyframe button touched by a drag preview change. */
function writeDragPreviewPositions(
  keyframeButtonRefs: Map<string, HTMLButtonElement>,
  keyframeMetaById: Map<string, KeyframeMeta>,
  previousPreviewFrames: Record<string, number> | null,
  nextPreviewFrames: Record<string, number> | null,
  getRenderedKeyframeX: (frame: number) => number | null,
): void {
  const keyframeIds = new Set([
    ...Object.keys(previousPreviewFrames ?? {}),
    ...Object.keys(nextPreviewFrames ?? {}),
  ])

  for (const keyframeId of keyframeIds) {
    const button = keyframeButtonRefs.get(keyframeId)
    if (!button) continue

    const frame = resolvePreviewFrame(keyframeId, nextPreviewFrames, keyframeMetaById)
    if (frame === undefined) continue

    const renderedX = getRenderedKeyframeX(frame)
    if (renderedX === null) {
      button.style.visibility = 'hidden'
      continue
    }

    button.style.left = `${renderedX}px`
    button.style.visibility = 'visible'
  }
}

export function useSheetPreviewDom({
  committedKeyframeSelectionRef,
  keyframeMetaByIdRef,
  dragStateRef,
  getRenderedKeyframeX,
  setSheetPreviewFrames,
  setSheetPreviewDuplicateKeyframeIds,
}: UseSheetPreviewDomOptions): UseSheetPreviewDomReturn {
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const marqueePreviewSelectionRef = useRef<Set<string> | null>(null)
  const marqueePreviewTouchedIdsRef = useRef(new Set<string>())
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null)

const setKeyframeButtonRef = useCallback((keyframeId: string, node: HTMLButtonElement | null) => {
  if (node) {
    keyframeButtonRefs.current.set(keyframeId, node)
    const previewSelection = marqueePreviewSelectionRef.current
    if (previewSelection) {
      const previewSelected = previewSelection.has(keyframeId)
      if (previewSelected !== committedKeyframeSelectionRef.current.has(keyframeId)) {
        node.dataset.marqueeSelected = String(previewSelected)
        marqueePreviewTouchedIdsRef.current.add(keyframeId)
      }
    }
  } else {
    keyframeButtonRefs.current.delete(keyframeId)
  }
}, [committedKeyframeSelectionRef])
const handleMarqueeSelectionPreviewChange = useCallback((nextSelection: Set<string> | null) => {
  const touchedIds = new Set(marqueePreviewTouchedIdsRef.current)
  for (const keyframeId of committedKeyframeSelectionRef.current) touchedIds.add(keyframeId)
  if (nextSelection) {
    for (const keyframeId of nextSelection) touchedIds.add(keyframeId)
  }

  const nextTouchedIds = new Set<string>()
  for (const keyframeId of touchedIds) {
    const button = keyframeButtonRefs.current.get(keyframeId)
    if (!button) continue
    if (!nextSelection) {
      delete button.dataset.marqueeSelected
      continue
    }

    const previewSelected = nextSelection.has(keyframeId)
    const committedSelected = committedKeyframeSelectionRef.current.has(keyframeId)
    if (previewSelected === committedSelected) {
      delete button.dataset.marqueeSelected
    } else {
      button.dataset.marqueeSelected = String(previewSelected)
      nextTouchedIds.add(keyframeId)
    }
  }

  marqueePreviewSelectionRef.current = nextSelection
  marqueePreviewTouchedIdsRef.current = nextTouchedIds
}, [committedKeyframeSelectionRef])
const applyDragPreviewFrames = useCallback(
  (nextPreviewFrames: Record<string, number> | null) => {
    const previousPreviewFrames = appliedDragPreviewFramesRef.current
    if (arePreviewFramesEqual(previousPreviewFrames, nextPreviewFrames)) {
      return
    }

    const duplicatePreviewIds = resolveDuplicatePreviewIds(
      dragStateRef.current,
      nextPreviewFrames,
    )

    flushSync(() => {
      setSheetPreviewFrames(nextPreviewFrames)
      setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds)
    })

    if (duplicatePreviewIds) {
      appliedDragPreviewFramesRef.current = nextPreviewFrames
      return
    }

    writeDragPreviewPositions(
      keyframeButtonRefs.current,
      keyframeMetaByIdRef.current,
      previousPreviewFrames,
      nextPreviewFrames,
      getRenderedKeyframeX,
    )

    appliedDragPreviewFramesRef.current = nextPreviewFrames
  },
  [
    dragStateRef,
    getRenderedKeyframeX,
    keyframeMetaByIdRef,
    setSheetPreviewDuplicateKeyframeIds,
    setSheetPreviewFrames,
  ],
)
const scheduleDragPreviewFrames = useCallback(
  (nextPreviewFrames: Record<string, number> | null) => {
    applyDragPreviewFrames(nextPreviewFrames)
  },
  [applyDragPreviewFrames],
)
  return { setKeyframeButtonRef, handleMarqueeSelectionPreviewChange, scheduleDragPreviewFrames }
}
