/**
 * Vector keyframe editing for the keyframe graph panel: the coupled
 * position/scale/anchor rows, dimension separation, live promotion of legacy
 * scalar lanes, value and temporal-ease commits and the speed-graph pane.
 *
 * Everything the panel derives (selected item, preview keyframe maps, resolved
 * transforms, control rows) is injected, and the panel keeps ownership of the
 * shared refs and its graph-mode state.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  buildVectorPromotionPlan,
  getEditorVectorKeyframeId,
  getStoredVectorKeyframeId,
  findStoredVectorKeyframe,
  getTransitionBlockedRanges,
  remapLegacyVectorPromotionIdentities,
} from '@/features/timeline/deps/keyframes'
import { getEditableVectorProxy } from './keyframe-graph-panel-model'
import * as timelineActions from '../stores/timeline-actions'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { VectorSpeedGraph } from './vector-speed-graph'
import {
  applyVectorPromotion,
  buildLegacyVectorPromotionAtFrame,
  buildSeparatedPositionProperties,
  hasPositionDimensionAuthoringConflict,
  recordPromotedVectorDragIds,
  selectPromotedVectorKeyframe,
  supportsVectorTransform,
  updateStoredVectorKeyframe,
  VECTOR_COMPOUND_PRIMARY,
  type KeyframeEditorSurface,
  type VectorEditorRow,
} from './keyframe-graph-panel-model'
import type {
  AnimatableProperty,
  ItemKeyframes,
  Keyframe,
  KeyframeRef,
  TemporalEase,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'

interface UseVectorKeyframeEditingParams {
  selectedItemForEditor: TimelineItem | null
  selectedItemKeyframes: ItemKeyframes | null
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  vectorBaseTransform: ResolvedTransform | null
  relativeFrame: number
  transitionBlockedRanges: ReturnType<typeof getTransitionBlockedRanges>
  canvas: CanvasSettings
  t: TFunction
  surface: KeyframeEditorSurface
  vectorControlRows: VectorEditorRow[]
  effectiveSelectedProperty: AnimatableProperty | null
  selectedKeyframeIds: Set<string>
  positionDimensionsSeparated: boolean
  scaleAxesConstrained: boolean
  getNextVectorAxisValue: (
    property: VectorAnimatableProperty,
    currentValue: { x: number; y: number },
    axis: 'x' | 'y',
    value: number,
  ) => { x: number; y: number }
  promotedVectorDragIdsRef: RefObject<Map<string, string>>
  selectKeyframe: (ref: KeyframeRef) => void
  selectKeyframes: (refs: KeyframeRef[]) => void
  clearKeyframeSelection: () => void
  vectorGraphMode: 'value' | 'speed'
  setVectorGraphMode: Dispatch<SetStateAction<'value' | 'speed'>>
}

export function useVectorKeyframeEditing({
  selectedItemForEditor,
  selectedItemKeyframes,
  keyframesByProperty,
  vectorBaseTransform,
  relativeFrame,
  transitionBlockedRanges,
  canvas,
  t,
  surface,
  vectorControlRows,
  effectiveSelectedProperty,
  selectedKeyframeIds,
  positionDimensionsSeparated,
  scaleAxesConstrained,
  getNextVectorAxisValue,
  promotedVectorDragIdsRef,
  selectKeyframe,
  selectKeyframes,
  clearKeyframeSelection,
  vectorGraphMode,
  setVectorGraphMode,
}: UseVectorKeyframeEditingParams) {
  const isVectorFrameBlocked = useCallback(
    (frame = relativeFrame) =>
      transitionBlockedRanges.some((range) => frame >= range.start && frame < range.end),
    [relativeFrame, transitionBlockedRanges],
  )

  const promoteVectorProperty = useCallback(
    (
      property: VectorAnimatableProperty,
      override?: { axis: 'x' | 'y'; value: number },
      frame = relativeFrame,
    ) => {
      if (!selectedItemForEditor || !vectorBaseTransform || isVectorFrameBlocked(frame)) {
        if (isVectorFrameBlocked(frame)) {
          toast.error(t('timeline.keyframeEditor.transitionBlocked'))
        }
        return
      }
      const plan = buildVectorPromotionPlan({
        property,
        itemKeyframes: selectedItemKeyframes ?? undefined,
        baseTransform: vectorBaseTransform,
        includeFrame: frame,
      })
      if (override) {
        plan.vectorProperty = {
          ...plan.vectorProperty,
          keyframes: plan.vectorProperty.keyframes.map((keyframe) =>
            keyframe.frame === frame
              ? {
                  ...keyframe,
                  value: getNextVectorAxisValue(
                    property,
                    keyframe.value,
                    override.axis,
                    override.value,
                  ),
                }
              : keyframe,
          ),
        }
      }
      timelineActions.promoteTransformToVector(
        selectedItemForEditor.id,
        plan.vectorProperty,
        plan.removeScalarProperties,
      )
    },
    [
      isVectorFrameBlocked,
      getNextVectorAxisValue,
      relativeFrame,
      selectedItemForEditor,
      selectedItemKeyframes,
      t,
      vectorBaseTransform,
    ],
  )

  const ensureVectorKeyframeForLiveEdit = useCallback(
    (
      ref: KeyframeRef,
    ): {
      property: VectorAnimatableProperty
      axis: 'x' | 'y'
      keyframe: VectorKeyframe
    } | null => {
      if (!selectedItemForEditor || !vectorBaseTransform) return null
      const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
      if (!proxy) return null

      const dragKey = `${proxy.property}:${ref.keyframeId}`
      const mappedId = promotedVectorDragIdsRef.current.get(dragKey)
      const storedId = mappedId ?? getStoredVectorKeyframeId(ref.keyframeId, proxy.axis)
      const currentKeyframe = findStoredVectorKeyframe(
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id],
        proxy.property,
        storedId,
      )
      if (currentKeyframe) return { ...proxy, keyframe: currentKeyframe }

      const previewKeyframe = keyframesByProperty[ref.property]?.find(
        (keyframe) => keyframe.id === ref.keyframeId,
      )
      if (!previewKeyframe) return null
      const promotion = buildLegacyVectorPromotionAtFrame({
        property: proxy.property,
        itemKeyframes: selectedItemKeyframes ?? undefined,
        baseTransform: vectorBaseTransform,
        frame: previewKeyframe.frame,
      })
      if (!promotion) return null

      const identityRemap = remapLegacyVectorPromotionIdentities({
        itemId: selectedItemForEditor.id,
        property: proxy.property,
        vectorKeyframes: promotion.plan.vectorProperty.keyframes,
        keyframesByProperty,
        selectedKeyframes: useKeyframeSelectionStore.getState().selectedKeyframes,
      })
      recordPromotedVectorDragIds(promotedVectorDragIdsRef.current, proxy.property, identityRemap)

      useKeyframesStore
        .getState()
        ._replaceScalarPropertiesWithVectorProperty(
          selectedItemForEditor.id,
          promotion.plan.vectorProperty,
          promotion.plan.removeScalarProperties,
        )
      promotedVectorDragIdsRef.current.set(dragKey, promotion.keyframe.id)
      selectPromotedVectorKeyframe({
        identityRemap,
        itemId: selectedItemForEditor.id,
        ref,
        proxy,
        promotedKeyframe: promotion.keyframe,
        selectKeyframes,
        selectKeyframe,
      })
      return { ...proxy, keyframe: promotion.keyframe }
    },
    [
      keyframesByProperty,
      promotedVectorDragIdsRef,
      selectKeyframe,
      selectKeyframes,
      selectedItemKeyframes,
      selectedItemForEditor,
      vectorBaseTransform,
    ],
  )

  const applyVectorKeyframeUpdates = useCallback(
    (ref: KeyframeRef, updates: Partial<Omit<VectorKeyframe, 'id'>>, commit: boolean): boolean => {
      if (!selectedItemForEditor || !vectorBaseTransform) return false
      const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
      if (!proxy) return false

      const storedId = getStoredVectorKeyframeId(ref.keyframeId, proxy.axis)
      const storedKeyframe = findStoredVectorKeyframe(
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id],
        proxy.property,
        storedId,
      )
      if (storedKeyframe) {
        updateStoredVectorKeyframe({
          itemId: ref.itemId,
          property: proxy.property,
          keyframeId: storedKeyframe.id,
          updates,
          commit,
        })
        return true
      }

      const previewKeyframe = keyframesByProperty[ref.property]?.find(
        (keyframe) => keyframe.id === ref.keyframeId,
      )
      if (!previewKeyframe) return true
      const promotion = buildLegacyVectorPromotionAtFrame({
        property: proxy.property,
        itemKeyframes: selectedItemKeyframes ?? undefined,
        baseTransform: vectorBaseTransform,
        frame: previewKeyframe.frame,
      })
      if (!promotion) return true
      promotion.plan.vectorProperty = {
        ...promotion.plan.vectorProperty,
        keyframes: promotion.plan.vectorProperty.keyframes.map((keyframe) =>
          keyframe.id === promotion.keyframe.id ? { ...keyframe, ...updates } : keyframe,
        ),
      }
      applyVectorPromotion({ itemId: selectedItemForEditor.id, plan: promotion.plan, commit })
      selectKeyframe({
        itemId: selectedItemForEditor.id,
        property: ref.property,
        keyframeId: getEditorVectorKeyframeId(promotion.keyframe.id, proxy.axis),
      })
      return true
    },
    [
      keyframesByProperty,
      selectKeyframe,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorBaseTransform,
    ],
  )

  const handleVectorValueCommit = useCallback(
    (
      property: VectorAnimatableProperty,
      axis: 'x' | 'y',
      value: number,
      options: { allowCreate: boolean },
    ) => {
      if (!selectedItemForEditor) return
      const row = vectorControlRows.find((candidate) => candidate.property === property)
      if (!row) return
      const lane = selectedItemKeyframes?.vectorProperties?.find(
        (candidate) => candidate.property === property,
      )
      if (!lane || lane.keyframes.length === 0) {
        if (options.allowCreate) promoteVectorProperty(property, { axis, value })
        return
      }

      const nextValue = getNextVectorAxisValue(property, row.value, axis, value)
      const currentKeyframe = lane.keyframes.find((keyframe) => keyframe.frame === relativeFrame)
      if (currentKeyframe) {
        timelineActions.updateVectorKeyframe(
          selectedItemForEditor.id,
          property,
          currentKeyframe.id,
          { value: nextValue },
        )
        return
      }
      if (!options.allowCreate) return
      timelineActions.upsertVectorKeyframe(selectedItemForEditor.id, property, {
        frame: relativeFrame,
        value: nextValue,
        easing: 'linear',
      })
    },
    [
      promoteVectorProperty,
      getNextVectorAxisValue,
      relativeFrame,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorControlRows,
    ],
  )

  const handleVectorTemporalEaseCommit = useCallback(
    (
      property: VectorAnimatableProperty,
      keyframeId: string,
      temporalEase: TemporalEase | undefined,
    ) => {
      if (!selectedItemForEditor) return
      applyVectorKeyframeUpdates(
        {
          itemId: selectedItemForEditor.id,
          property: VECTOR_COMPOUND_PRIMARY[property],
          keyframeId,
        },
        { temporalEase },
        true,
      )
    },
    [applyVectorKeyframeUpdates, selectedItemForEditor],
  )

  const compoundPropertyRows = useMemo(
    () =>
      Object.fromEntries(
        vectorControlRows.map((row) => [
          row.proxyProperty,
          {
            label: row.label,
            value: row.value,
            preExpressionValue: row.preExpressionValue,
            unit: row.unit,
            scrubStep: row.property === 'position' ? 1 : undefined,
            decimals: row.property === 'position' ? 0 : undefined,
            linkProperty: row.property,
            onCommit: (axis: 'x' | 'y', value: number, options: { allowCreate: boolean }) =>
              handleVectorValueCommit(row.property, axis, value, options),
          },
        ]),
      ),
    [handleVectorValueCommit, vectorControlRows],
  )
  const hiddenVectorPropertyRows = useMemo(
    () => vectorControlRows.map((row) => row.secondaryProxyProperty),
    [vectorControlRows],
  )
  const compoundSecondaryProperties = useMemo(
    () =>
      Object.fromEntries(
        vectorControlRows.map((row) => [row.proxyProperty, row.secondaryProxyProperty]),
      ),
    [vectorControlRows],
  )

  const handlePositionDimensionModeChange = useCallback(
    (separated: boolean) => {
      if (!selectedItemForEditor || !vectorBaseTransform) return
      const itemKeyframes = useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id]
      if (hasPositionDimensionAuthoringConflict(itemKeyframes, separated)) {
        toast.error(
          separated
            ? 'Remove the Position link or expression before separating dimensions'
            : 'Remove the X/Y links or expressions before combining dimensions',
        )
        return
      }

      if (separated) {
        const scalarProperties = buildSeparatedPositionProperties(
          itemKeyframes,
          vectorBaseTransform,
        )
        if (!scalarProperties) {
          toast.error('Separate this advanced Position animation in the Motion workspace')
          return
        }
        clearKeyframeSelection()
        timelineActions.setVectorDimensionsSeparated(selectedItemForEditor.id, 'position', true, {
          scalarProperties,
        })
        return
      }

      const plan = buildVectorPromotionPlan({
        property: 'position',
        itemKeyframes,
        baseTransform: vectorBaseTransform,
      })
      clearKeyframeSelection()
      timelineActions.setVectorDimensionsSeparated(selectedItemForEditor.id, 'position', false, {
        vectorProperty: plan.vectorProperty.keyframes.length > 0 ? plan.vectorProperty : undefined,
      })
    },
    [clearKeyframeSelection, selectedItemForEditor, vectorBaseTransform],
  )
  const dimensionSeparationByProperty = useMemo(
    () =>
      surface === 'edit' && supportsVectorTransform(selectedItemForEditor)
        ? {
            x: {
              label: t('editor.layoutSection.position', { defaultValue: 'Position' }),
              separated: positionDimensionsSeparated,
              onChange: handlePositionDimensionModeChange,
            },
          }
        : {},
    [
      handlePositionDimensionModeChange,
      positionDimensionsSeparated,
      selectedItemForEditor,
      surface,
      t,
    ],
  )
  const classicAxisConstraints = useMemo(
    () =>
      selectedItemForEditor
        ? {
            x: {
              label: t('editor.layoutSection.position', { defaultValue: 'Position' }),
              constrained: !positionDimensionsSeparated,
              onChange: (constrained: boolean) => handlePositionDimensionModeChange(!constrained),
            },
            width: {
              label: t('editor.textProperties.scale', { defaultValue: 'Scale' }),
              constrained: scaleAxesConstrained,
              onChange: (constrained: boolean) =>
                timelineActions.updateItemTransform(selectedItemForEditor.id, {
                  aspectRatioLocked: constrained,
                }),
            },
          }
        : {},
    [
      handlePositionDimensionModeChange,
      positionDimensionsSeparated,
      scaleAxesConstrained,
      selectedItemForEditor,
      t,
    ],
  )
  const activeVectorRow =
    vectorControlRows.find((row) => row.proxyProperty === effectiveSelectedProperty) ?? null
  const activeVectorKeyframeId = activeVectorRow
    ? ([...selectedKeyframeIds].find((id) =>
        activeVectorRow.keyframes.some((keyframe) => keyframe.id === id),
      ) ??
      activeVectorRow.currentKeyframeId ??
      activeVectorRow.keyframes[0]?.id)
    : undefined

  useEffect(() => {
    if (!activeVectorRow && vectorGraphMode === 'speed') setVectorGraphMode('value')
  }, [activeVectorRow, setVectorGraphMode, vectorGraphMode])

  const vectorSpeedGraphContent = activeVectorRow ? (
    <VectorSpeedGraph
      property={activeVectorRow.property}
      label={`${activeVectorRow.label} ${t('timeline.keyframeEditor.speedGraph', {
        defaultValue: 'Speed',
      })}`}
      keyframes={activeVectorRow.keyframes}
      currentKeyframeId={activeVectorKeyframeId}
      fps={canvas.fps}
      resetLabel={t('timeline.keyframeEditor.resetSpeed', {
        defaultValue: 'Reset velocity handles',
      })}
      onTemporalEaseCommit={(keyframeId, temporalEase) =>
        handleVectorTemporalEaseCommit(activeVectorRow.property, keyframeId, temporalEase)
      }
      onSelectKeyframe={(keyframe) => {
        if (!selectedItemForEditor) return
        selectKeyframe({
          itemId: selectedItemForEditor.id,
          property: activeVectorRow.proxyProperty,
          keyframeId: keyframe.id,
        })
        usePlaybackStore.getState().setCurrentFrame(selectedItemForEditor.from + keyframe.frame)
      }}
    />
  ) : undefined
  return {
    isVectorFrameBlocked,
    promoteVectorProperty,
    ensureVectorKeyframeForLiveEdit,
    applyVectorKeyframeUpdates,
    handleVectorValueCommit,
    compoundPropertyRows,
    hiddenVectorPropertyRows,
    compoundSecondaryProperties,
    dimensionSeparationByProperty,
    classicAxisConstraints,
    activeVectorRow,
    vectorSpeedGraphContent,
  }
}
