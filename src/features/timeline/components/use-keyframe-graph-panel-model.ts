/**
 * Keyframe graph panel — selection/keyframes derived model.
 *
 * The panel's derived-values cluster, moved verbatim out of KeyframeGraphPanel:
 * the item / keyframe / transition store selectors, the selected item's
 * keyframe map, the editor's selected keyframes (ids, entries, shared easing),
 * the playhead frame the editor commits, the transition-blocked ranges and the
 * trim banner, the resolved vector transforms and control rows, and the
 * procedural-preview inputs the dopesheet/graph draw before a bake.
 *
 * The hook owns those subscriptions and memos exactly as the component did: the
 * memoized inline selectors keep their `useCallback` identity, the memo
 * dependency arrays and their order are unchanged, and the frozen `[]` / `Set`
 * results stay referentially stable — so the panel's re-render behaviour is
 * unchanged. The panel keeps ownership of every ref and passes it in.
 */

import { useCallback, useMemo, type RefObject } from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import {
  getTransitionBlockedRanges,
  countTrimmedKeyframes,
  resolveAnimatedTransform,
} from '@/features/timeline/deps/keyframes'
import {
  getAnimatablePropertiesForItem,
  type ProceduralPreviewInput,
} from '@/features/timeline/deps/keyframe-editors'
import { hasEnabledProceduralMotion } from '@/shared/timeline/procedural-motion'
import { resolveTransform, getSourceDimensions } from '@/features/timeline/deps/composition-runtime'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../stores/items-store'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import * as timelineActions from '../stores/timeline-actions'
import { getDirectPropertyLinks } from '@/types/keyframe'
import { shouldShowSeparatedPosition } from './edit-keyframe-panel-model'
import {
  buildEditorKeyframesByProperty,
  buildVectorControlRows,
  filterVectorControlRows,
  supportsVectorTransform,
  type KeyframeEditorSurface,
  type VectorEditorRow,
} from './keyframe-graph-panel-model'
import { useKeyframeEditorPlaybackFrame } from './use-keyframe-editor-playback-frame'
import type {
  AnimatableProperty,
  Keyframe,
  KeyframeRef,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'

interface UseKeyframeGraphPanelModelParams {
  surface: KeyframeEditorSurface
  canvas: CanvasSettings
  selectedProperty: AnimatableProperty | null
  t: TFunction
  keyframeEditorScrubbingRef: RefObject<boolean>
}

export function useKeyframeGraphPanelModel({
  surface,
  canvas,
  selectedProperty,
  t,
  keyframeEditorScrubbingRef,
}: UseKeyframeGraphPanelModelParams) {
  // Selected items
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)

  const selectedItemForEditor = useItemsStore(
    useCallback(
      (s) => {
        for (const itemId of selectedItemIds) {
          const item = s.itemById[itemId]
          if (item) {
            return item
          }
        }

        return null
      },
      [selectedItemIds],
    ),
  )
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) =>
        selectedItemForEditor ? (s.keyframesByItemId[selectedItemForEditor.id] ?? null) : null,
      [selectedItemForEditor],
    ),
  )
  const allItemsById = useItemsStore((s) => s.itemById)
  const maxItemEndFrame = useItemsStore((s) => s.maxItemEndFrame)
  const allKeyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)

  const selectedItemTransitions = useTransitionsStore(
    useShallow(
      useCallback(
        (s) => {
          if (!selectedItemForEditor) return []

          return s.transitions.filter(
            (transition) =>
              transition.leftClipId === selectedItemForEditor.id ||
              transition.rightClipId === selectedItemForEditor.id,
          )
        },
        [selectedItemForEditor],
      ),
    ),
  )

  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes)

  const currentFrame = useKeyframeEditorPlaybackFrame(
    selectedItemForEditor?.id ?? null,
    keyframeEditorScrubbingRef,
  )

  const allAvailableProperties = useMemo(() => {
    if (!selectedItemForEditor) return []
    return getAnimatablePropertiesForItem(selectedItemForEditor)
  }, [selectedItemForEditor])

  const availableProperties = useMemo(
    () =>
      surface !== 'edit' && supportsVectorTransform(selectedItemForEditor)
        ? allAvailableProperties.filter((property) => property !== 'y' && property !== 'height')
        : allAvailableProperties,
    [allAvailableProperties, selectedItemForEditor, surface],
  )

  // Inputs for the dopesheet/graph to draw procedural generators (dashed ghost
  // curves) before they're baked — base transform + active modifiers + canvas.
  const proceduralPreview = useMemo<ProceduralPreviewInput | undefined>(() => {
    if (!selectedItemForEditor) return undefined
    const modifiers =
      selectedItemForEditor.motionModifiers?.filter(
        (modifier) => modifier.enabled && modifier.amplitude > 0,
      ) ?? []
    const layers = selectedItemForEditor.motionLayers?.filter((layer) => layer.enabled) ?? []
    if (modifiers.length === 0 && layers.length === 0) return undefined
    return {
      base: resolveTransform(
        selectedItemForEditor,
        canvas,
        getSourceDimensions(selectedItemForEditor),
      ),
      keyframes: allKeyframesByItemId[selectedItemForEditor.id],
      modifiers,
      layers,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    }
  }, [selectedItemForEditor, canvas, allKeyframesByItemId])

  // The edited clip can be baked when it carries any procedural motion.
  const canBakeProceduralMotion =
    !!selectedItemForEditor && hasEnabledProceduralMotion(selectedItemForEditor)

  const effectiveSelectedProperty = useMemo(() => {
    if (surface === 'edit') {
      return selectedProperty && availableProperties.includes(selectedProperty)
        ? selectedProperty
        : null
    }
    const compoundPrimary =
      selectedProperty === 'y'
        ? 'x'
        : selectedProperty === 'height'
          ? 'width'
          : selectedProperty === 'anchorY'
            ? 'anchorX'
            : selectedProperty
    return compoundPrimary && availableProperties.includes(compoundPrimary) ? compoundPrimary : null
  }, [availableProperties, selectedProperty, surface])

  // Build keyframes by property for the graph editor
  const keyframesByProperty = useMemo(
    () =>
      buildEditorKeyframesByProperty({
        properties: allAvailableProperties,
        item: selectedItemForEditor,
        itemKeyframes: selectedItemKeyframes,
        canvas,
        trimToItemBounds: surface === 'edit',
      }),
    [allAvailableProperties, canvas, selectedItemForEditor, selectedItemKeyframes, surface],
  )

  const trimmedKeyframeCount = useMemo(
    () =>
      selectedItemForEditor
        ? countTrimmedKeyframes(selectedItemKeyframes, selectedItemForEditor.durationInFrames)
        : 0,
    [selectedItemForEditor, selectedItemKeyframes],
  )

  const handleTrimAnimation = useCallback(() => {
    if (!selectedItemForEditor) return
    const itemId = selectedItemForEditor.id
    const removedCount = timelineActions.trimAnimationToItemBounds(itemId)
    if (removedCount === 0) return
    toast.success(
      t('timeline.keyframeEditor.trimAnimationToast', {
        count: removedCount,
      }),
      {
        action: {
          label: t('timeline.header.undo'),
          onClick: () => {
            const commandStore = useTimelineCommandStore.getState()
            const latest = commandStore.undoStack.at(-1)
            if (
              latest?.command.type === 'TRIM_ANIMATION_TO_BOUNDS' &&
              latest.command.payload?.itemId === itemId
            ) {
              commandStore.undo()
            }
          },
        },
      },
    )
  }, [selectedItemForEditor, t])

  // Selected keyframe IDs for the current item
  const selectedKeyframeIds = useMemo(() => {
    if (!selectedItemForEditor) return new Set<string>()

    const ids = new Set<string>()
    for (const ref of selectedKeyframes) {
      if (ref.itemId === selectedItemForEditor.id) {
        ids.add(ref.keyframeId)
      }
    }
    return ids
  }, [selectedKeyframes, selectedItemForEditor])

  const selectedEditorKeyframes = useMemo(() => {
    if (!selectedItemForEditor) return []

    const entries: Array<{ ref: KeyframeRef; keyframe: Keyframe }> = []
    for (const ref of selectedKeyframes) {
      if (ref.itemId !== selectedItemForEditor.id) continue

      const keyframe = keyframesByProperty[ref.property]?.find(
        (candidate) => candidate.id === ref.keyframeId,
      )

      if (keyframe) {
        entries.push({ ref, keyframe })
      }
    }

    return entries
  }, [keyframesByProperty, selectedItemForEditor, selectedKeyframes])

  const selectedEditorEasing = useMemo(() => {
    if (selectedEditorKeyframes.length === 0) return undefined

    const firstEasing = selectedEditorKeyframes[0]?.keyframe.easing
    if (!firstEasing) return undefined

    return selectedEditorKeyframes.every(({ keyframe }) => keyframe.easing === firstEasing)
      ? firstEasing
      : undefined
  }, [selectedEditorKeyframes])

  // Calculate relative frame for the current item
  const relativeFrame = useMemo(() => {
    if (!selectedItemForEditor) return 0
    return Math.max(0, currentFrame - selectedItemForEditor.from)
  }, [currentFrame, selectedItemForEditor])

  // Calculate transition-blocked frame ranges for the selected item
  const transitionBlockedRanges = useMemo(() => {
    if (!selectedItemForEditor) return []
    return getTransitionBlockedRanges(
      selectedItemForEditor.id,
      selectedItemForEditor,
      selectedItemTransitions,
    )
  }, [selectedItemForEditor, selectedItemTransitions])

  const vectorBaseTransform = useMemo(() => {
    if (!supportsVectorTransform(selectedItemForEditor)) return null
    return resolveTransform(
      selectedItemForEditor,
      canvas,
      getSourceDimensions(selectedItemForEditor),
    )
  }, [canvas, selectedItemForEditor])

  const vectorResolvedTransform = useMemo(() => {
    if (!selectedItemForEditor || !vectorBaseTransform) return null
    return resolveAnimatedTransform(
      vectorBaseTransform,
      selectedItemKeyframes ?? undefined,
      relativeFrame,
      {
        globalFrame: currentFrame,
        canvas,
        getItem: (itemId) => allItemsById[itemId],
        getKeyframes: (itemId) => allKeyframesByItemId[itemId],
      },
    )
  }, [
    allItemsById,
    allKeyframesByItemId,
    canvas,
    currentFrame,
    relativeFrame,
    selectedItemForEditor,
    selectedItemKeyframes,
    vectorBaseTransform,
  ])
  const vectorPreExpressionTransform = useMemo(() => {
    if (!selectedItemForEditor || !vectorBaseTransform) return null
    const keyframesWithoutExpressions = selectedItemKeyframes
      ? {
          ...selectedItemKeyframes,
          propertyLinks: [...getDirectPropertyLinks(selectedItemKeyframes)],
          expressions: [],
        }
      : undefined
    return resolveAnimatedTransform(
      vectorBaseTransform,
      keyframesWithoutExpressions,
      relativeFrame,
      {
        globalFrame: currentFrame,
        canvas,
        getItem: (itemId) => allItemsById[itemId],
        getKeyframes: (itemId) => allKeyframesByItemId[itemId],
      },
    )
  }, [
    allItemsById,
    allKeyframesByItemId,
    canvas,
    currentFrame,
    relativeFrame,
    selectedItemForEditor,
    selectedItemKeyframes,
    vectorBaseTransform,
  ])
  const positionDimensionsSeparated = shouldShowSeparatedPosition(selectedItemKeyframes)

  const vectorControlRows = useMemo<VectorEditorRow[]>(() => {
    if (!vectorBaseTransform || !vectorResolvedTransform || !vectorPreExpressionTransform) return []
    return filterVectorControlRows(
      buildVectorControlRows({
        itemKeyframes: selectedItemKeyframes,
        base: vectorBaseTransform,
        resolved: vectorResolvedTransform,
        preExpression: vectorPreExpressionTransform,
        relativeFrame,
        t,
      }),
      selectedItemKeyframes,
      surface,
      positionDimensionsSeparated,
    )
  }, [
    positionDimensionsSeparated,
    relativeFrame,
    selectedItemKeyframes,
    surface,
    t,
    vectorBaseTransform,
    vectorPreExpressionTransform,
    vectorResolvedTransform,
  ])
  const scaleAxesConstrained = selectedItemForEditor?.transform?.aspectRatioLocked !== false
  const getNextVectorAxisValue = useCallback(
    (
      property: VectorAnimatableProperty,
      currentValue: { x: number; y: number },
      axis: 'x' | 'y',
      value: number,
    ) => {
      const nextValue = { ...currentValue, [axis]: value }
      if (property !== 'scale' || !scaleAxesConstrained) return nextValue

      const otherAxis = axis === 'x' ? 'y' : 'x'
      const ratio = Math.abs(currentValue[axis]) <= Number.EPSILON ? 1 : value / currentValue[axis]
      nextValue[otherAxis] = currentValue[otherAxis] * ratio
      return nextValue
    },
    [scaleAxesConstrained],
  )

  return {
    selectedItemForEditor,
    selectedItemKeyframes,
    allItemsById,
    maxItemEndFrame,
    allKeyframesByItemId,
    selectedKeyframes,
    currentFrame,
    allAvailableProperties,
    availableProperties,
    effectiveSelectedProperty,
    keyframesByProperty,
    trimmedKeyframeCount,
    handleTrimAnimation,
    selectedKeyframeIds,
    selectedEditorKeyframes,
    selectedEditorEasing,
    relativeFrame,
    transitionBlockedRanges,
    vectorBaseTransform,
    vectorResolvedTransform,
    vectorPreExpressionTransform,
    positionDimensionsSeparated,
    vectorControlRows,
    scaleAxesConstrained,
    getNextVectorAxisValue,
    proceduralPreview,
    canBakeProceduralMotion,
  }
}
