/**
 * Keyframe graph panel — drag, selection, clipboard and removal commands.
 *
 * The snapshot-bracketed drag lifecycle (`onDragStart`/`onDragEnd`/
 * `onDragCancel`), the keyframe / keyframes / bezier move handlers, segment
 * easing, graph selection, copy/cut/paste, keyframe removal and keyframe
 * navigation.
 *
 * Everything the panel owns arrives as a parameter: the selected item and its
 * keyframe maps, the resolved editor callbacks (including the ones owned by
 * `useVectorKeyframeEditing`), the store selectors the panel read, and the
 * refs shared with the other keyframe-editing hooks. The two drag snapshot refs
 * are private to this hook — nothing else reads them.
 */

import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import { buildEasingConfig, type getTransitionBlockedRanges } from '@/features/timeline/deps/keyframes'
import { usePlaybackStore } from '@/shared/state/playback'
import * as timelineActions from '../stores/timeline-actions'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { captureSnapshot, restoreSnapshot, snapshotsEqual } from '../stores/commands/snapshot'
import type { TimelineSnapshot } from '../stores/commands/types'
import {
  applyKeyframeMoveEntry,
  buildKeyframePastePlan,
  buildPasteSkipReasons,
  clampFrameToBlockedRanges,
  getBezierEditorEasing,
  getEditableVectorProxy,
  pasteVectorKeyframePayload,
  promoteAndRemoveLegacyVectorRef,
  promoteLegacyVectorEntryForMove,
  removeStoredVectorRef,
  type KeyframeMoveEntry,
  type PendingVectorMove,
} from './keyframe-graph-panel-model'
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingConfig,
  EasingType,
  ItemKeyframes,
  Keyframe,
  KeyframeClipboard,
  KeyframeRef,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'

interface UseKeyframeDragCommandsParams {
  selectedItemForEditor: TimelineItem | null
  selectedItemKeyframes: ItemKeyframes | null
  selectedEditorKeyframes: Array<{ ref: KeyframeRef; keyframe: Keyframe }>
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  allAvailableProperties: AnimatableProperty[]
  availableProperties: AnimatableProperty[]
  transitionBlockedRanges: ReturnType<typeof getTransitionBlockedRanges>
  vectorBaseTransform: ResolvedTransform | null
  relativeFrame: number
  canvas: CanvasSettings
  allItemsById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  keyframeClipboard: KeyframeClipboard | null
  isKeyframeClipboardCut: boolean
  t: TFunction
  _updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, 'id'>>,
  ) => void
  ensureVectorKeyframeForLiveEdit: (ref: KeyframeRef) => {
    property: VectorAnimatableProperty
    axis: 'x' | 'y'
    keyframe: VectorKeyframe
  } | null
  applyVectorKeyframeUpdates: (
    ref: KeyframeRef,
    updates: Partial<Omit<VectorKeyframe, 'id'>>,
    commit: boolean,
  ) => boolean
  selectKeyframe: (ref: KeyframeRef) => void
  selectKeyframes: (refs: KeyframeRef[]) => void
  clearKeyframeSelection: () => void
  copySelectedKeyframes: () => void
  cutSelectedKeyframes: () => void
  clearKeyframeClipboard: () => void
  setSelectedProperty: Dispatch<SetStateAction<AnimatableProperty | null>>
  promotedVectorDragIdsRef: RefObject<Map<string, string>>
  valueScrubCreatedKeyframesRef: RefObject<Map<AnimatableProperty, string>>
}

/**
 * Materialize the vector half of a paste plan. Vector payloads need the clip's
 * resolved base transform; without one they are skipped and the caller falls
 * back to the scalar payloads.
 */
function insertVectorPastePayloads({
  vectorPayloads,
  item,
  baseTransform,
  canvas,
  allItemsById,
  allKeyframesByItemId,
}: {
  vectorPayloads: Parameters<typeof pasteVectorKeyframePayload>[0]['payload'][]
  item: TimelineItem
  baseTransform: ResolvedTransform | null
  canvas: CanvasSettings
  allItemsById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
}): KeyframeRef[] {
  if (!baseTransform) return []

  const insertedRefs: KeyframeRef[] = []
  for (const payload of vectorPayloads) {
    const insertedRef = pasteVectorKeyframePayload({
      payload,
      item,
      baseTransform,
      canvas,
      getItem: (itemId) => allItemsById[itemId],
      getKeyframes: (itemId) => allKeyframesByItemId[itemId],
    })
    if (insertedRef) insertedRefs.push(insertedRef)
  }
  return insertedRefs
}

/** Report a finished paste: moved vs copied, plus any skipped keyframes. */
function reportPasteOutcome({
  t,
  isCut,
  pastedCount,
  skippedCount,
  skipReasons,
}: {
  t: TFunction
  isCut: boolean
  pastedCount: number
  skippedCount: number
  skipReasons: string[]
}): void {
  const summaryText = isCut
    ? t('timeline.keyframeEditor.movedKeyframes', { count: pastedCount })
    : t('timeline.keyframeEditor.pastedKeyframes', { count: pastedCount })

  if (skippedCount > 0) {
    toast.warning(summaryText, {
      description: t('timeline.keyframeEditor.skippedDescription', {
        count: skippedCount,
        reasons: skipReasons.join('. '),
      }),
    })
    return
  }

  toast.success(summaryText)
}

export function useKeyframeDragCommands({
  selectedItemForEditor,
  selectedItemKeyframes,
  selectedEditorKeyframes,
  keyframesByProperty,
  allAvailableProperties,
  availableProperties,
  transitionBlockedRanges,
  vectorBaseTransform,
  relativeFrame,
  canvas,
  allItemsById,
  allKeyframesByItemId,
  keyframeClipboard,
  isKeyframeClipboardCut,
  t,
  _updateKeyframe,
  ensureVectorKeyframeForLiveEdit,
  applyVectorKeyframeUpdates,
  selectKeyframe,
  selectKeyframes,
  clearKeyframeSelection,
  copySelectedKeyframes,
  cutSelectedKeyframes,
  clearKeyframeClipboard,
  setSelectedProperty,
  promotedVectorDragIdsRef,
  valueScrubCreatedKeyframesRef,
}: UseKeyframeDragCommandsParams) {
  // Snapshot captured on drag start for undo batching.
  const dragSnapshotRef = useRef<TimelineSnapshot | null>(null)
  const dragSelectionSnapshotRef = useRef<KeyframeRef[] | null>(null)

  // Handle drag start - capture snapshot for undo batching
  const handleDragStart = useCallback(() => {
    valueScrubCreatedKeyframesRef.current.clear()
    promotedVectorDragIdsRef.current.clear()
    dragSnapshotRef.current = captureSnapshot()
    dragSelectionSnapshotRef.current = [...useKeyframeSelectionStore.getState().selectedKeyframes]
  }, [promotedVectorDragIdsRef, valueScrubCreatedKeyframesRef])

  // Handle drag end - commit undo entry with pre-captured snapshot
  const handleDragEnd = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current
    if (beforeSnapshot) {
      if (!snapshotsEqual(beforeSnapshot, captureSnapshot())) {
        useTimelineCommandStore
          .getState()
          .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, beforeSnapshot)
        useTimelineSettingsStore.getState().markDirty()
      }
      dragSnapshotRef.current = null
      valueScrubCreatedKeyframesRef.current.clear()
      promotedVectorDragIdsRef.current.clear()
    }
    dragSelectionSnapshotRef.current = null
  }, [promotedVectorDragIdsRef, valueScrubCreatedKeyframesRef])

  // Pointer cancellation is not a commit: restore the exact pre-drag data and
  // ephemeral keyframe selection without adding an undo entry.
  const handleDragCancel = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current
    const beforeSelection = dragSelectionSnapshotRef.current
    if (beforeSnapshot) restoreSnapshot(beforeSnapshot)
    if (beforeSelection) selectKeyframes(beforeSelection)
    dragSnapshotRef.current = null
    dragSelectionSnapshotRef.current = null
    valueScrubCreatedKeyframesRef.current.clear()
    promotedVectorDragIdsRef.current.clear()
  }, [promotedVectorDragIdsRef, selectKeyframes, valueScrubCreatedKeyframesRef])

  // Handle keyframe move in graph editor (no undo per call - batched via drag start/end)
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      const vector = ensureVectorKeyframeForLiveEdit(ref)
      if (vector) {
        const clampedFrame = clampFrameToBlockedRanges(
          Math.max(0, Math.round(newFrame)),
          vector.keyframe.frame,
          transitionBlockedRanges,
        )
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(ref.itemId, vector.property, vector.keyframe.id, {
            frame: clampedFrame,
            value: { ...vector.keyframe.value, [vector.axis]: newValue },
          })
        return
      }

      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
      const initialFrame = existingKeyframe?.frame ?? newFrame
      const clampedFrame = clampFrameToBlockedRanges(
        Math.max(0, Math.round(newFrame)),
        initialFrame,
        transitionBlockedRanges,
      )

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: clampedFrame,
        value: newValue,
      })
    },
    [
      _updateKeyframe,
      ensureVectorKeyframeForLiveEdit,
      selectedItemKeyframes,
      transitionBlockedRanges,
    ],
  )

  const handleKeyframesMove = useCallback(
    (entries: KeyframeMoveEntry[]) => {
      if (!selectedItemForEditor || !vectorBaseTransform || entries.length === 0) return

      const storedIdByDragKey = new Map(promotedVectorDragIdsRef.current)
      let remappedSelection = useKeyframeSelectionStore.getState().selectedKeyframes
      let selectionChanged = false

      // Promote every legacy vector lane before applying any frame updates.
      // Otherwise promoting the next selected legacy key replaces the lane and
      // resets the key that was just moved earlier in the same drag commit.
      for (const entry of entries) {
        const identityRemap = promoteLegacyVectorEntryForMove({
          entry,
          itemId: selectedItemForEditor.id,
          itemKeyframes: selectedItemKeyframes,
          baseTransform: vectorBaseTransform,
          keyframesByProperty,
          selectedKeyframes: remappedSelection,
          storedIdByDragKey,
          promotedDragIds: promotedVectorDragIdsRef.current,
        })
        if (!identityRemap) continue
        remappedSelection = identityRemap.selectedKeyframes
        selectionChanged = true
      }

      if (selectionChanged) selectKeyframes(remappedSelection)

      const vectorUpdates = new Map<string, PendingVectorMove>()
      const currentItemKeyframes =
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id]

      for (const entry of entries) {
        applyKeyframeMoveEntry({
          entry,
          itemKeyframes: currentItemKeyframes,
          selectedItemKeyframes,
          blockedRanges: transitionBlockedRanges,
          storedIdByDragKey,
          pendingMoves: vectorUpdates,
          updateKeyframe: _updateKeyframe,
        })
      }

      for (const update of vectorUpdates.values()) {
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(selectedItemForEditor.id, update.property, update.keyframeId, {
            frame: update.frame,
            value: update.value,
          })
      }
    },
    [
      _updateKeyframe,
      keyframesByProperty,
      promotedVectorDragIdsRef,
      selectKeyframes,
      selectedItemKeyframes,
      selectedItemForEditor,
      transitionBlockedRanges,
      vectorBaseTransform,
    ],
  )

  const handleBezierHandleMove = useCallback(
    (ref: KeyframeRef, bezier: BezierControlPoints) => {
      const vector = ensureVectorKeyframeForLiveEdit(ref)
      if (vector) {
        const nextEasing = vector.keyframe.easing
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(ref.itemId, vector.property, vector.keyframe.id, {
            easing: getBezierEditorEasing(nextEasing),
            easingConfig: { type: 'cubic-bezier', bezier },
          })
        return
      }

      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
      const nextEasing = existingKeyframe?.easing

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        easing: getBezierEditorEasing(nextEasing),
        easingConfig: {
          type: 'cubic-bezier',
          bezier,
        },
      })
    },
    [_updateKeyframe, ensureVectorKeyframeForLiveEdit, selectedItemKeyframes],
  )

  // Apply an easing change from the dopesheet's per-segment popover to explicit
  // keyframe refs. Live drag frames (`commit: false`) go through the no-undo
  // path and are bracketed by handleDragStart/handleDragEnd; everything else
  // commits its own undo entry.
  const handleSegmentEasingChange = useCallback(
    (
      refs: KeyframeRef[],
      updates: { easing: EasingType; easingConfig?: EasingConfig },
      options?: { commit?: boolean },
    ) => {
      if (refs.length === 0) return

      if (options?.commit === false) {
        for (const ref of refs) {
          if (applyVectorKeyframeUpdates(ref, updates, false)) continue
          _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, updates)
        }
        return
      }

      const scalarRefs = refs.filter((ref) => !applyVectorKeyframeUpdates(ref, updates, true))
      if (scalarRefs.length === 0) return
      timelineActions.updateKeyframes(
        scalarRefs.map((ref) => ({
          itemId: ref.itemId,
          property: ref.property,
          keyframeId: ref.keyframeId,
          updates,
        })),
      )
    },
    // `timelineActions` is an `import * as` module namespace — a stable, immutable
    // reference, so it's intentionally not a dependency (consistent with the
    // other keyframe handlers in this file).
    [_updateKeyframe, applyVectorKeyframeUpdates],
  )

  // Handle selection change in graph editor
  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>) => {
      if (!selectedItemForEditor) return

      const refs: KeyframeRef[] = []
      for (const id of keyframeIds) {
        for (const property of allAvailableProperties) {
          if (keyframesByProperty[property]?.some((keyframe) => keyframe.id === id)) {
            refs.push({
              itemId: selectedItemForEditor.id,
              property,
              keyframeId: id,
            })
            break
          }
        }
      }

      if (refs.length === 0) {
        clearKeyframeSelection()
      } else if (refs.length === 1 && refs[0]) {
        selectKeyframe(refs[0])
      } else if (refs.length > 1) {
        selectKeyframes(refs)
      }
    },
    [
      selectedItemForEditor,
      allAvailableProperties,
      keyframesByProperty,
      clearKeyframeSelection,
      selectKeyframe,
      selectKeyframes,
    ],
  )

  // Handle property change in graph editor
  const handlePropertyChange = useCallback((property: AnimatableProperty | null) => {
    setSelectedProperty(property)
  }, [setSelectedProperty])

  const handleCopyKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return
    copySelectedKeyframes()
  }, [copySelectedKeyframes, selectedEditorKeyframes.length])

  const handleCutKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return
    cutSelectedKeyframes()
  }, [cutSelectedKeyframes, selectedEditorKeyframes.length])

  const handleSelectedKeyframeEasingChange = useCallback(
    (value: string, easingConfig?: EasingConfig) => {
      if (selectedEditorKeyframes.length === 0) return

      const easing = value as EasingType
      const scalarUpdates = selectedEditorKeyframes.flatMap(({ ref, keyframe }) => {
        const updates = {
          easing,
          easingConfig: easingConfig ?? buildEasingConfig(easing, keyframe.easingConfig),
        }
        if (applyVectorKeyframeUpdates(ref, updates, true)) return []
        return [
          {
            itemId: ref.itemId,
            property: ref.property,
            keyframeId: ref.keyframeId,
            updates,
          },
        ]
      })
      if (scalarUpdates.length > 0) timelineActions.updateKeyframes(scalarUpdates)
    },
    [applyVectorKeyframeUpdates, selectedEditorKeyframes],
  )

  const handlePasteKeyframes = useCallback(() => {
    if (!selectedItemForEditor) return
    if (!keyframeClipboard?.keyframes.length) return

    const anchorFrame = Math.max(
      0,
      Math.min(selectedItemForEditor.durationInFrames - 1, relativeFrame),
    )
    const pastePlan = buildKeyframePastePlan({
      clipboard: keyframeClipboard,
      item: selectedItemForEditor,
      anchorFrame,
      availableProperties,
      blockedRanges: transitionBlockedRanges,
      supportsVectors: Boolean(vectorBaseTransform),
      itemKeyframes: selectedItemKeyframes,
    })
    const skippedCount = pastePlan.skippedUnsupported + pastePlan.skippedBlocked
    const skipReasons = buildPasteSkipReasons(
      t,
      pastePlan.skippedUnsupported,
      pastePlan.skippedBlocked,
    )

    if (isKeyframeClipboardCut && skippedCount > 0) {
      toast.warning(t('timeline.keyframeEditor.unableToPasteCut'), {
        description: t('timeline.keyframeEditor.unableToPasteCutDescription', {
          reasons: skipReasons.join('. '),
        }),
      })
      return
    }

    if (pastePlan.scalarPayloads.length + pastePlan.vectorPayloads.length === 0) {
      toast.warning(t('timeline.keyframeEditor.noKeyframesPasted'), {
        description: skipReasons.join('. '),
      })
      return
    }

    const insertedVectorRefs = insertVectorPastePayloads({
      vectorPayloads: pastePlan.vectorPayloads,
      item: selectedItemForEditor,
      baseTransform: vectorBaseTransform,
      canvas,
      allItemsById,
      allKeyframesByItemId,
    })

    const insertedIds = timelineActions.addKeyframes(pastePlan.scalarPayloads)
    const insertedRefs = insertedIds.map((keyframeId, index) => ({
      itemId: selectedItemForEditor.id,
      property: pastePlan.scalarPayloads[index]!.property,
      keyframeId,
    }))

    const nextSelection = [...insertedVectorRefs, ...insertedRefs]
    if (nextSelection.length > 0) {
      selectKeyframes(nextSelection)
    } else {
      clearKeyframeSelection()
    }

    if (isKeyframeClipboardCut) {
      clearKeyframeClipboard()
    }

    reportPasteOutcome({
      t,
      isCut: isKeyframeClipboardCut,
      pastedCount: nextSelection.length,
      skippedCount,
      skipReasons,
    })
  }, [
    availableProperties,
    allItemsById,
    allKeyframesByItemId,
    canvas,
    clearKeyframeClipboard,
    clearKeyframeSelection,
    isKeyframeClipboardCut,
    keyframeClipboard,
    relativeFrame,
    selectKeyframes,
    selectedItemKeyframes,
    selectedItemForEditor,
    transitionBlockedRanges,
    t,
    vectorBaseTransform,
  ])

  // Handle removing keyframes
  const handleRemoveKeyframes = useCallback(
    (refs: KeyframeRef[]) => {
      if (!selectedItemForEditor) {
        timelineActions.removeKeyframes(refs)
        return
      }
      if (!vectorBaseTransform) {
        timelineActions.removeKeyframes(refs)
        return
      }
      const scalarRefs: KeyframeRef[] = []
      const removedVectorKeys = new Set<string>()
      for (const ref of refs) {
        const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
        if (!proxy) {
          scalarRefs.push(ref)
          continue
        }
        const removalContext = {
          ref,
          proxy,
          itemKeyframes: selectedItemKeyframes ?? undefined,
          removedKeys: removedVectorKeys,
        }
        if (removeStoredVectorRef(removalContext)) continue
        if (
          promoteAndRemoveLegacyVectorRef({
            ...removalContext,
            keyframesByProperty,
            baseTransform: vectorBaseTransform,
          })
        )
          continue
        scalarRefs.push(ref)
      }
      if (scalarRefs.length > 0) timelineActions.removeKeyframes(scalarRefs)
    },
    [keyframesByProperty, selectedItemForEditor, selectedItemKeyframes, vectorBaseTransform],
  )

  // Handle navigation to a keyframe - convert clip-relative frame to absolute
  const handleNavigateToKeyframe = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame
      usePlaybackStore.getState().setCurrentFrame(absoluteFrame)
    },
    [selectedItemForEditor],
  )

  return {
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    handleKeyframeMove,
    handleKeyframesMove,
    handleBezierHandleMove,
    handleSegmentEasingChange,
    handleSelectionChange,
    handlePropertyChange,
    handleCopyKeyframes,
    handleCutKeyframes,
    handleSelectedKeyframeEasingChange,
    handlePasteKeyframes,
    handleRemoveKeyframes,
    handleNavigateToKeyframe,
  }
}
