/**
 * Keyframe graph panel — scrub, skim and keyframe-authoring commands.
 *
 * The editor's scrub lifecycle (`onScrub`/`onScrubStart`/`onScrubEnd`) and
 * preview scrubbing (`onSkim`, routed through the preview fast-scrub path), plus
 * adding a keyframe at a frame and duplicating a set of keyframes.
 *
 * The panel owns the item, its keyframe maps and the refs shared with the other
 * keyframe hooks; all of them arrive as parameters.
 */

import { useCallback, type RefObject } from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  getAnimatablePropertyBaseValue,
  interpolatePropertyValue,
  resolveAnimatedTransform,
} from '@/features/timeline/deps/keyframes'
import { toVectorScalePercent } from '@/features/timeline/deps/keyframes-contract'
import { usePlaybackStore } from '@/shared/state/playback'
import * as timelineActions from '../stores/timeline-actions'
import { useKeyframesStore } from '../stores/keyframes-store'
import {
  duplicateVectorKeyframeEntry,
  getEditableVectorProxy,
} from './keyframe-graph-panel-model'
import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  KeyframeRef,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'

interface UseKeyframeScrubAddParams {
  selectedItemForEditor: TimelineItem | null
  selectedItemKeyframes: ItemKeyframes | null
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  vectorBaseTransform: ResolvedTransform | null
  canvas: CanvasSettings
  allItemsById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  t: TFunction
  isVectorFrameBlocked: (frame?: number) => boolean
  promoteVectorProperty: (
    property: VectorAnimatableProperty,
    override?: { axis: 'x' | 'y'; value: number },
    frame?: number,
  ) => void
  selectKeyframes: (refs: KeyframeRef[]) => void
  keyframeEditorScrubbingRef: RefObject<boolean>
}

export function useKeyframeScrubAdd({
  selectedItemForEditor,
  selectedItemKeyframes,
  keyframesByProperty,
  vectorBaseTransform,
  canvas,
  allItemsById,
  allKeyframesByItemId,
  t,
  isVectorFrameBlocked,
  promoteVectorProperty,
  selectKeyframes,
  keyframeEditorScrubbingRef,
}: UseKeyframeScrubAddParams) {
  // Handle scrubbing in graph editor - convert clip-relative frame to absolute frame
  const handleScrub = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return

      // Convert clip-relative frame to absolute frame
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame

      // Route editor scrubbing through the preview scrub path so the preview
      // can stay on its fast-scrub presentation instead of doing full seeks.
      usePlaybackStore.getState().setScrubFrame(absoluteFrame, selectedItemForEditor.id)
    },
    [selectedItemForEditor],
  )
  const handleSkim = useCallback(
    (clipRelativeFrame: number | null) => {
      const playback = usePlaybackStore.getState()
      if (clipRelativeFrame === null) {
        if (!keyframeEditorScrubbingRef.current) playback.setPreviewFrame(null)
        return
      }
      if (!selectedItemForEditor || playback.isPlaying || keyframeEditorScrubbingRef.current) return
      playback.setPreviewFrame(
        selectedItemForEditor.from + clipRelativeFrame,
        selectedItemForEditor.id,
      )
    },
    [keyframeEditorScrubbingRef, selectedItemForEditor],
  )
  const handleScrubStart = useCallback(() => {
    keyframeEditorScrubbingRef.current = true
    usePlaybackStore.getState().pause()
  }, [keyframeEditorScrubbingRef])

  const handleScrubEnd = useCallback(() => {
    keyframeEditorScrubbingRef.current = false
    usePlaybackStore.getState().setPreviewFrame(null)
  }, [keyframeEditorScrubbingRef])

  const addVectorKeyframe = useCallback(
    (property: AnimatableProperty, frame: number): boolean => {
      const proxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (!proxy || !selectedItemForEditor || !vectorBaseTransform) return false
      const lane = useKeyframesStore
        .getState()
        .keyframesByItemId[selectedItemForEditor.id]?.vectorProperties?.find(
          (candidate) => candidate.property === proxy.property,
        )
      if (!lane || lane.keyframes.length === 0) {
        promoteVectorProperty(proxy.property, undefined, frame)
        return true
      }
      if (isVectorFrameBlocked(frame)) {
        toast.error(t('timeline.keyframeEditor.transitionBlocked'))
        return true
      }

      const resolved = resolveAnimatedTransform(
        vectorBaseTransform,
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id],
        frame,
        {
          globalFrame: selectedItemForEditor.from + frame,
          canvas,
          getItem: (itemId) => allItemsById[itemId],
          getKeyframes: (itemId) => allKeyframesByItemId[itemId],
        },
      )
      const value =
        proxy.property === 'position'
          ? { x: resolved.x, y: resolved.y }
          : proxy.property === 'scale'
            ? {
                x: toVectorScalePercent(resolved.width, vectorBaseTransform.width),
                y: toVectorScalePercent(resolved.height, vectorBaseTransform.height),
              }
            : { x: resolved.anchorX, y: resolved.anchorY }
      timelineActions.upsertVectorKeyframe(selectedItemForEditor.id, proxy.property, {
        frame,
        value,
        easing: 'linear',
      })
      return true
    },
    [
      allItemsById,
      allKeyframesByItemId,
      canvas,
      isVectorFrameBlocked,
      promoteVectorProperty,
      selectedItemKeyframes,
      selectedItemForEditor,
      t,
      vectorBaseTransform,
    ],
  )

  // Handle adding a keyframe at the current frame
  const handleAddKeyframe = useCallback(
    (property: AnimatableProperty, frame: number) => {
      if (!selectedItemForEditor) return
      if (addVectorKeyframe(property, frame)) return

      const propKeyframes = keyframesByProperty[property] ?? []
      const baseValue = getAnimatablePropertyBaseValue(selectedItemForEditor, property, canvas)
      const value = interpolatePropertyValue(propKeyframes, frame, baseValue)

      timelineActions.addKeyframe(selectedItemForEditor.id, property, frame, value)
    },
    [addVectorKeyframe, canvas, keyframesByProperty, selectedItemForEditor],
  )
  const handleDuplicateKeyframes = useCallback(
    (entries: Array<{ ref: KeyframeRef; frame: number; value: number }>) => {
      if (!selectedItemForEditor || entries.length === 0) return

      const insertedVectorRefs: KeyframeRef[] = []
      const duplicatedVectorKeys = new Set<string>()
      const payloads = entries.flatMap(({ ref, frame, value }) => {
        const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
        if (proxy && vectorBaseTransform) {
          const insertedRef = duplicateVectorKeyframeEntry({
            ref,
            frame,
            value,
            proxy,
            itemId: selectedItemForEditor.id,
            itemKeyframes: selectedItemKeyframes ?? undefined,
            baseTransform: vectorBaseTransform,
            duplicatedKeys: duplicatedVectorKeys,
          })
          if (insertedRef) insertedVectorRefs.push(insertedRef)
          return []
        }

        const sourceKeyframe = keyframesByProperty[ref.property]?.find(
          (keyframe) => keyframe.id === ref.keyframeId,
        )
        if (!sourceKeyframe) {
          return []
        }

        return [
          {
            itemId: selectedItemForEditor.id,
            property: ref.property,
            frame,
            value,
            easing: sourceKeyframe.easing,
            easingConfig: sourceKeyframe.easingConfig,
          },
        ]
      })

      const insertedIds = payloads.length > 0 ? timelineActions.addKeyframes(payloads) : []
      const insertedRefs = insertedIds.map((keyframeId, index) => ({
        itemId: selectedItemForEditor.id,
        property: payloads[index]!.property,
        keyframeId,
      }))

      const nextSelection = [...insertedVectorRefs, ...insertedRefs]
      if (nextSelection.length > 0) {
        selectKeyframes(nextSelection)
      }
    },
    [
      keyframesByProperty,
      selectKeyframes,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorBaseTransform,
    ],
  )

  return {
    handleScrub,
    handleSkim,
    handleScrubStart,
    handleScrubEnd,
    handleAddKeyframe,
    handleDuplicateKeyframes,
  }
}
