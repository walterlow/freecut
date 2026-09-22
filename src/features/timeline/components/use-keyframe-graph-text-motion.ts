/**
 * Text-motion band editing for the keyframe graph panel: the clip-local motion
 * bands shown by the dopesheet and the drag/commit handlers that resize or
 * shift them. The drag snapshot ref is owned here — it is only ever used by
 * these handlers.
 */

import { useCallback, useMemo, useRef } from 'react'
import { getTextMotionTimelineBands } from '@/shared/timeline/text-motion-timeline'
import { useEditorStore } from '@/shared/state/editor'
import {
  beginTextMotionEdit,
  commitTextMotionEdit,
  updateTextMotionLive,
} from '../stores/actions/text-motion-actions'
import type { TimelineSnapshot } from '../stores/commands/types'
import type { KeyframeEditorSurface } from './keyframe-graph-panel-model'
import type { TextMotionSlot } from '@/types/text-motion'
import type { TimelineItem } from '@/types/timeline'

interface KeyframeGraphTextMotionParams {
  selectedItemForEditor: TimelineItem | null
  surface: KeyframeEditorSurface
}

export function useKeyframeGraphTextMotion({
  selectedItemForEditor,
  surface,
}: KeyframeGraphTextMotionParams) {
  const textMotionDragSnapshotRef = useRef<TimelineSnapshot | null>(null)

  const editTextMotionBands = useMemo(
    () =>
      surface === 'edit' && selectedItemForEditor
        ? getTextMotionTimelineBands(selectedItemForEditor).map((band) => ({
            ...band,
            fromFrame: band.fromFrame - selectedItemForEditor.from,
            toFrame: band.toFrame - selectedItemForEditor.from,
            clipFromFrame: band.clipFromFrame - selectedItemForEditor.from,
            clipToFrame: band.clipToFrame - selectedItemForEditor.from,
          }))
        : [],
    [selectedItemForEditor, surface],
  )
  const handleTextMotionDurationDragStart = useCallback(() => {
    textMotionDragSnapshotRef.current = beginTextMotionEdit()
  }, [])
  const handleTextMotionDurationCommit = useCallback(
    (slot: TextMotionSlot, durationFrames: number) => {
      if (!selectedItemForEditor) return
      const before = textMotionDragSnapshotRef.current ?? beginTextMotionEdit()
      updateTextMotionLive([selectedItemForEditor.id], slot, { durationFrames })
      commitTextMotionEdit(before, { slot, itemIds: [selectedItemForEditor.id] })
      textMotionDragSnapshotRef.current = null
    },
    [selectedItemForEditor],
  )
  const handleTextMotionDurationCancel = useCallback(() => {
    textMotionDragSnapshotRef.current = null
  }, [])
  const handleTextMotionOffsetDragStart = useCallback(() => {
    textMotionDragSnapshotRef.current = beginTextMotionEdit()
  }, [])
  const handleTextMotionOffsetCommit = useCallback(
    (slot: TextMotionSlot, offsetFrames: number) => {
      if (!selectedItemForEditor || slot === 'loop') return
      const before = textMotionDragSnapshotRef.current ?? beginTextMotionEdit()
      updateTextMotionLive([selectedItemForEditor.id], slot, {
        offsetFrames: offsetFrames > 0 ? offsetFrames : undefined,
      })
      commitTextMotionEdit(before, { slot, itemIds: [selectedItemForEditor.id] })
      textMotionDragSnapshotRef.current = null
    },
    [selectedItemForEditor],
  )
  const handleTextMotionOffsetCancel = useCallback(() => {
    textMotionDragSnapshotRef.current = null
  }, [])
  const handleTextMotionBandClick = useCallback((_slot: TextMotionSlot) => {
    const editor = useEditorStore.getState()
    editor.setRightSidebarOpen(true)
    editor.setClipInspectorTab('motion')
  }, [])

  return {
    editTextMotionBands,
    handleTextMotionDurationDragStart,
    handleTextMotionDurationCommit,
    handleTextMotionDurationCancel,
    handleTextMotionOffsetDragStart,
    handleTextMotionOffsetCommit,
    handleTextMotionOffsetCancel,
    handleTextMotionBandClick,
  }
}
