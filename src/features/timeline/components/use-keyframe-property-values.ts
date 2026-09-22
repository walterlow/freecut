/**
 * Keyframe graph panel — property values and value commits.
 *
 * The current/pre-expression value maps handed to the dopesheet, property
 * expression create/remove, the value commit and live-scrub preview paths, and
 * the effect-property reset command.
 *
 * The maps the panel derives (keyframes by property, resolved transforms,
 * vector control rows) and the editor callbacks it owns arrive as parameters;
 * the scrub bookkeeping ref is shared with the drag commands hook and is
 * injected as a RefObject.
 */

import { useCallback, useMemo, type RefObject } from 'react'
import {
  buildVectorPromotionPlan,
  resolveExpressionReferenceValue,
} from '@/features/timeline/deps/keyframes'
import { getEditorVectorKeyframeId } from '@/features/timeline/deps/keyframes-contract'
import { isTransformAnimatableProperty } from '@/types/keyframe'
import { buildEffectPropertyResetPlan } from '@/features/timeline/utils/effect-property-reset'
import * as timelineActions from '../stores/timeline-actions'
import { useItemsStore } from '../stores/items-store'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { captureSnapshot } from '../stores/commands/snapshot'
import {
  buildCurrentPropertyValues,
  commitScalarPropertyValue,
  getEditableVectorProxy,
  type KeyframeEditorSurface,
  type VectorEditorRow,
} from './keyframe-graph-panel-model'
import type {
  AnimatableProperty,
  DirectLinkableProperty,
  ItemKeyframes,
  Keyframe,
  KeyframeRef,
  VectorAnimatableProperty,
  VectorKeyframe,
} from '@/types/keyframe'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'

interface UseKeyframePropertyValuesParams {
  selectedItemForEditor: TimelineItem | null
  selectedItemKeyframes: ItemKeyframes | null
  selectedEditorKeyframes: Array<{ ref: KeyframeRef; keyframe: Keyframe }>
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  availableProperties: AnimatableProperty[]
  vectorControlRows: VectorEditorRow[]
  vectorResolvedTransform: ResolvedTransform | null
  vectorPreExpressionTransform: ResolvedTransform | null
  vectorBaseTransform: ResolvedTransform | null
  relativeFrame: number
  currentFrame: number
  canvas: CanvasSettings
  surface: KeyframeEditorSurface
  allItemsById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  selectedKeyframes: KeyframeRef[]
  isVectorFrameBlocked: (frame?: number) => boolean
  ensureVectorKeyframeForLiveEdit: (ref: KeyframeRef) => {
    property: VectorAnimatableProperty
    axis: 'x' | 'y'
    keyframe: VectorKeyframe
  } | null
  getNextVectorAxisValue: (
    property: VectorAnimatableProperty,
    currentValue: { x: number; y: number },
    axis: 'x' | 'y',
    value: number,
  ) => { x: number; y: number }
  handleVectorValueCommit: (
    property: VectorAnimatableProperty,
    axis: 'x' | 'y',
    value: number,
    options: { allowCreate: boolean },
  ) => void
  selectKeyframe: (ref: KeyframeRef) => void
  selectKeyframes: (refs: KeyframeRef[]) => void
  _updateKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    keyframeId: string,
    updates: Partial<Omit<Keyframe, 'id'>>,
  ) => void
  _addKeyframe: (
    itemId: string,
    property: AnimatableProperty,
    frame: number,
    value: number,
  ) => string
  _removeKeyframesForProperty: (itemId: string, property: AnimatableProperty) => void
  valueScrubCreatedKeyframesRef: RefObject<Map<AnimatableProperty, string>>
}

export function useKeyframePropertyValues({
  selectedItemForEditor,
  selectedItemKeyframes,
  selectedEditorKeyframes,
  keyframesByProperty,
  availableProperties,
  vectorControlRows,
  vectorResolvedTransform,
  vectorPreExpressionTransform,
  vectorBaseTransform,
  relativeFrame,
  currentFrame,
  canvas,
  surface,
  allItemsById,
  allKeyframesByItemId,
  selectedKeyframes,
  isVectorFrameBlocked,
  ensureVectorKeyframeForLiveEdit,
  getNextVectorAxisValue,
  handleVectorValueCommit,
  selectKeyframe,
  selectKeyframes,
  _updateKeyframe,
  _addKeyframe,
  _removeKeyframesForProperty,
  valueScrubCreatedKeyframesRef,
}: UseKeyframePropertyValuesParams) {
  const propertyValues = useMemo(() => {
    if (!selectedItemForEditor) return {}
    const values = buildCurrentPropertyValues({
      item: selectedItemForEditor,
      properties: availableProperties,
      keyframesByProperty,
      selectedKeyframes: selectedEditorKeyframes,
      resolvedTransform: vectorResolvedTransform,
      relativeFrame,
      canvas,
    })
    if (surface === 'edit') {
      for (const row of vectorControlRows) {
        values[row.proxyProperty] = row.value.x
        values[row.secondaryProxyProperty] = row.value.y
      }
    }
    return values
  }, [
    availableProperties,
    canvas,
    keyframesByProperty,
    relativeFrame,
    selectedEditorKeyframes,
    selectedItemForEditor,
    surface,
    vectorControlRows,
    vectorResolvedTransform,
  ])
  const preExpressionPropertyValues = useMemo(() => {
    if (!selectedItemForEditor) return {}
    const values: Partial<Record<AnimatableProperty, number>> = {}
    for (const property of availableProperties) {
      const vectorRow =
        surface === 'edit'
          ? vectorControlRows.find(
              (candidate) =>
                candidate.proxyProperty === property ||
                candidate.secondaryProxyProperty === property,
            )
          : undefined
      if (vectorRow) {
        values[property] =
          vectorRow.proxyProperty === property
            ? vectorRow.preExpressionValue.x
            : vectorRow.preExpressionValue.y
      } else if (vectorPreExpressionTransform && isTransformAnimatableProperty(property)) {
        values[property] = vectorPreExpressionTransform[property]
      } else {
        values[property] = propertyValues[property]
      }
    }
    return values
  }, [
    availableProperties,
    propertyValues,
    selectedItemForEditor,
    surface,
    vectorControlRows,
    vectorPreExpressionTransform,
  ])
  const resolveExpressionReference = useCallback(
    (itemId: string, property: DirectLinkableProperty) =>
      resolveExpressionReferenceValue(itemId, property, {
        globalFrame: currentFrame,
        canvas,
        getItem: (candidateId) => allItemsById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      }),
    [allItemsById, allKeyframesByItemId, canvas, currentFrame],
  )
  const handleSetPropertyExpression = useCallback(
    (property: DirectLinkableProperty, source: string, enabled: boolean) => {
      if (!selectedItemForEditor) return
      timelineActions.setPropertyExpression(selectedItemForEditor.id, {
        type: 'expression',
        targetProperty: property,
        source,
        enabled,
      })
    },
    [selectedItemForEditor],
  )
  const handleRemovePropertyExpression = useCallback(
    (property: DirectLinkableProperty) => {
      if (!selectedItemForEditor) return
      timelineActions.removePropertyExpression(selectedItemForEditor.id, property)
    },
    [selectedItemForEditor],
  )

  const handlePropertyValueCommit = useCallback(
    (property: AnimatableProperty, value: number, options?: { allowCreate?: boolean }) => {
      if (!selectedItemForEditor) return
      const vectorProxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (surface === 'edit' && vectorProxy) {
        handleVectorValueCommit(vectorProxy.property, vectorProxy.axis, value, {
          allowCreate: options?.allowCreate !== false,
        })
        return
      }

      commitScalarPropertyValue({
        itemId: selectedItemForEditor.id,
        property,
        value,
        relativeFrame,
        allowCreate: options?.allowCreate !== false,
        selectedKeyframes: selectedEditorKeyframes,
        propertyKeyframes: keyframesByProperty[property],
        selectKeyframe,
      })
    },
    [
      keyframesByProperty,
      handleVectorValueCommit,
      relativeFrame,
      selectKeyframe,
      selectedEditorKeyframes,
      selectedItemKeyframes,
      selectedItemForEditor,
      surface,
    ],
  )

  const previewVectorPropertyValue = useCallback(
    (property: AnimatableProperty, value: number): boolean => {
      const proxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (!proxy || !selectedItemForEditor || !vectorBaseTransform) return false
      if (isVectorFrameBlocked(relativeFrame)) return true

      const editorKeyframe = keyframesByProperty[property]?.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      if (editorKeyframe) {
        const vector = ensureVectorKeyframeForLiveEdit({
          itemId: selectedItemForEditor.id,
          property,
          keyframeId: editorKeyframe.id,
        })
        if (!vector) return true
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(selectedItemForEditor.id, vector.property, vector.keyframe.id, {
            value: getNextVectorAxisValue(
              vector.property,
              vector.keyframe.value,
              vector.axis,
              value,
            ),
          })
        return true
      }

      const plan = buildVectorPromotionPlan({
        property: proxy.property,
        itemKeyframes: selectedItemKeyframes ?? undefined,
        baseTransform: vectorBaseTransform,
        includeFrame: relativeFrame,
      })
      const insertedKeyframe = plan.vectorProperty.keyframes.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      if (!insertedKeyframe) return true
      plan.vectorProperty = {
        ...plan.vectorProperty,
        keyframes: plan.vectorProperty.keyframes.map((keyframe) =>
          keyframe.id === insertedKeyframe.id
            ? {
                ...keyframe,
                value: getNextVectorAxisValue(proxy.property, keyframe.value, proxy.axis, value),
              }
            : keyframe,
        ),
      }
      useKeyframesStore
        .getState()
        ._replaceScalarPropertiesWithVectorProperty(
          selectedItemForEditor.id,
          plan.vectorProperty,
          plan.removeScalarProperties,
        )
      selectKeyframe({
        itemId: selectedItemForEditor.id,
        property,
        keyframeId: getEditorVectorKeyframeId(insertedKeyframe.id, proxy.axis),
      })
      return true
    },
    [
      ensureVectorKeyframeForLiveEdit,
      getNextVectorAxisValue,
      isVectorFrameBlocked,
      keyframesByProperty,
      relativeFrame,
      selectKeyframe,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorBaseTransform,
    ],
  )

  const handlePropertyValuePreview = useCallback(
    (property: AnimatableProperty, value: number) => {
      if (!selectedItemForEditor) return
      if (surface === 'edit' && previewVectorPropertyValue(property, value)) return

      const selectedRefs = selectedEditorKeyframes
        .filter(({ ref }) => ref.property === property)
        .map(({ ref }) => ref)
      if (selectedRefs.length > 0) {
        for (const ref of selectedRefs) {
          _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, { value })
        }
        return
      }

      const existing = keyframesByProperty[property]?.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      let keyframeId = existing?.id ?? valueScrubCreatedKeyframesRef.current.get(property)
      if (!keyframeId) {
        keyframeId = _addKeyframe(selectedItemForEditor.id, property, relativeFrame, value)
        valueScrubCreatedKeyframesRef.current.set(property, keyframeId)
        selectKeyframe({ itemId: selectedItemForEditor.id, property, keyframeId })
      } else {
        _updateKeyframe(selectedItemForEditor.id, property, keyframeId, { value })
      }
    },
    [
      _addKeyframe,
      _updateKeyframe,
      keyframesByProperty,
      previewVectorPropertyValue,
      relativeFrame,
      selectKeyframe,
      selectedEditorKeyframes,
      selectedItemForEditor,
      surface,
      valueScrubCreatedKeyframesRef,
    ],
  )

  const handleResetPropertiesToDefault = useCallback(
    (properties: AnimatableProperty[]) => {
      if (!selectedItemForEditor || properties.length === 0) return
      const effects = useItemsStore.getState().itemById[selectedItemForEditor.id]?.effects ?? []
      const resetPlan = buildEffectPropertyResetPlan(effects, properties)
      if (resetPlan.resettableProperties.length === 0) return
      const propertySet = new Set(resetPlan.resettableProperties)

      const keyframeState = useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id]
      const hasKeyframes = properties.some(
        (property) =>
          (keyframeState?.properties.find((entry) => entry.property === property)?.keyframes
            .length ?? 0) > 0,
      )
      const hasValueChanges = resetPlan.effectUpdates.length > 0
      if (!hasKeyframes && !hasValueChanges) return

      const beforeSnapshot = captureSnapshot()
      for (const property of resetPlan.resettableProperties) {
        _removeKeyframesForProperty(selectedItemForEditor.id, property)
      }
      for (const update of resetPlan.effectUpdates) {
        useItemsStore.getState()._updateEffect(selectedItemForEditor.id, update.effectId, {
          effect: update.effect,
        })
      }
      selectKeyframes(selectedKeyframes.filter((ref) => !propertySet.has(ref.property)))
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: 'RESET_EFFECT_PROPERTIES',
          payload: { count: resetPlan.resettableProperties.length },
        },
        beforeSnapshot,
      )
      useTimelineSettingsStore.getState().markDirty()
    },
    [_removeKeyframesForProperty, selectKeyframes, selectedItemForEditor, selectedKeyframes],
  )

  return {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    handleSetPropertyExpression,
    handleRemovePropertyExpression,
    handlePropertyValueCommit,
    handlePropertyValuePreview,
    handleResetPropertiesToDefault,
  }
}
