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

    const duplicatePreviewIds =
      dragStateRef.current?.duplicateOnCommit && nextPreviewFrames
        ? dragStateRef.current.selectedKeyframeIds
        : null

    flushSync(() => {
      setSheetPreviewFrames(nextPreviewFrames)
      setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds)
    })

    const keyframeIds = new Set([
      ...Object.keys(previousPreviewFrames ?? {}),
      ...Object.keys(nextPreviewFrames ?? {}),
    ])

    if (duplicatePreviewIds) {
      appliedDragPreviewFramesRef.current = nextPreviewFrames
      return
    }

    for (const keyframeId of keyframeIds) {
      const button = keyframeButtonRefs.current.get(keyframeId)
      if (!button) continue

      const previewFrame = nextPreviewFrames?.[keyframeId]
      const frame = previewFrame ?? keyframeMetaByIdRef.current.get(keyframeId)?.keyframe.frame
      if (frame === undefined) continue

      const renderedX = getRenderedKeyframeX(frame)
      if (renderedX === null) {
        button.style.visibility = 'hidden'
        continue
      }

      button.style.left = `${renderedX}px`
      button.style.visibility = 'visible'
    }

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
