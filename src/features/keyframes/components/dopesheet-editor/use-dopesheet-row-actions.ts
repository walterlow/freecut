/**
 * Row actions for the dopesheet sheet.
 * Owns every per-row command the row controls fire: clearing, property
 * activation, the add/toggle keyframe buttons, the auto-key switch and the
 * nudge shared by the graph pane and the shortcuts. The editor keeps the one
 * handler that has to sit next to state declared below this cluster
 * (`handleRowNavigate`, which writes the range-selection anchor).
 */

import { useCallback } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import type { DopesheetPropertyGroup, DopesheetPropertyRow } from './dopesheet-types'
import {
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  removeSelectionIds,
} from './row-action-helpers'

export interface UseDopesheetRowActionsOptions
  extends Pick<
    DopesheetEditorProps,
    | 'onCurveVisibilityChange'
    | 'onPropertyChange'
    | 'onActivePropertyChange'
    | 'onRemoveKeyframes'
    | 'onSelectionChange'
    | 'onAddKeyframe'
  > {
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
  currentFrame: number
  /** Whether the playhead sits inside a transition region (adds are rejected). */
  isCurrentFrameBlocked: boolean
  /** Surfaces a rejected add (playhead inside a transition region). */
  notifyKeyframeBlocked: () => void
  propertyRowByProperty: Map<AnimatableProperty, DopesheetPropertyRow>
  selectedKeyframeIds: Set<string>
  /** Whether the graph pane is visible, so activation also drives its curve. */
  showGraphPane: boolean
  singleCurveMode: boolean
  setGraphVisibleProperties: (properties: Set<AnimatableProperty>) => void
  toggleAutoKeyframeEnabled: (itemId: string, property: AnimatableProperty) => void
  moveSelectedKeyframesByDelta: (deltaFrames: number) => void
}

interface DopesheetRowActions {
  canClearRow: (row: DopesheetPropertyRow) => boolean
  activateProperty: (property: AnimatableProperty) => void
  showSinglePropertyCurve: (property: AnimatableProperty) => void
  handleClearProperty: (property: AnimatableProperty) => void
  handleClearGroup: (group: DopesheetPropertyGroup) => void
  handleRowToggleKeyframe: (property: AnimatableProperty, currentKeyframes: Keyframe[]) => void
  handleRowAddKeyframe: (property: AnimatableProperty, currentKeyframes: Keyframe[]) => void
  handleRowAutoKeyToggle: (property: AnimatableProperty) => void
  nudgeSelectedKeyframes: (deltaFrames: number) => void
}

/** Builds the sheet's per-row commands. */
export function useDopesheetRowActions({
  disabled,
  isPropertyLocked,
  itemId,
  currentFrame,
  isCurrentFrameBlocked,
  notifyKeyframeBlocked,
  propertyRowByProperty,
  selectedKeyframeIds,
  showGraphPane,
  singleCurveMode,
  setGraphVisibleProperties,
  onCurveVisibilityChange,
  onPropertyChange,
  onActivePropertyChange,
  onRemoveKeyframes,
  onSelectionChange,
  onAddKeyframe,
  toggleAutoKeyframeEnabled,
  moveSelectedKeyframesByDelta,
}: UseDopesheetRowActionsOptions): DopesheetRowActions {
  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false
      if (isPropertyLocked(row.property)) return false
      return row.keyframes.length > 0
    },
    [disabled, isPropertyLocked, onRemoveKeyframes],
  )

  const activateProperty = useCallback(
    (property: AnimatableProperty) => {
      if (showGraphPane) {
        if (singleCurveMode) {
          setGraphVisibleProperties(new Set([property]))
          onCurveVisibilityChange?.(property, true)
        }
        onPropertyChange?.(property)
      }
      onActivePropertyChange?.(property)
    },
    [
      onActivePropertyChange,
      onCurveVisibilityChange,
      onPropertyChange,
      setGraphVisibleProperties,
      showGraphPane,
      singleCurveMode,
    ],
  )

  const showSinglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties(new Set([property]))
      onPropertyChange?.(property)
      onActivePropertyChange?.(property)
      onCurveVisibilityChange?.(property, true)
    },
    [onActivePropertyChange, onCurveVisibilityChange, onPropertyChange, setGraphVisibleProperties],
  )

  const removeKeyframesForRows = useCallback(
    (rows: DopesheetPropertyRow[]) => {
      if (!onRemoveKeyframes) return

      const refs = buildRowKeyframeRefs(itemId, rows)

      if (refs.length === 0) return

      onRemoveKeyframes(refs)

      if (onSelectionChange) {
        onSelectionChange(
          removeSelectionIds(
            selectedKeyframeIds,
            refs.map((ref) => ref.keyframeId),
          ),
          { preserveExternalSelection: true },
        )
      }
    },
    [itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds],
  )

  const handleClearProperty = useCallback(
    (property: AnimatableProperty) => {
      const row = propertyRowByProperty.get(property)
      if (!row || !canClearRow(row)) return

      activateProperty(property)
      removeKeyframesForRows([row])
    },
    [activateProperty, canClearRow, propertyRowByProperty, removeKeyframesForRows],
  )

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)))
    },
    [canClearRow, removeKeyframesForRows],
  )

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return
        const refs = buildPropertyKeyframeRefs(itemId, property, currentKeyframes)
        onRemoveKeyframes(refs)
        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              currentKeyframes.map((keyframe) => keyframe.id),
            ),
            { preserveExternalSelection: true },
          )
        }
        return
      }

      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      if (!onAddKeyframe) return
      onAddKeyframe(property, currentFrame)
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      notifyKeyframeBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ],
  )

  const handleRowAddKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) return
      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      onAddKeyframe?.(property, currentFrame)
    },
    [
      activateProperty,
      currentFrame,
      isCurrentFrameBlocked,
      isPropertyLocked,
      notifyKeyframeBlocked,
      onAddKeyframe,
    ],
  )

  const handleRowAutoKeyToggle = useCallback(
    (property: AnimatableProperty) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      toggleAutoKeyframeEnabled(itemId, property)
    },
    [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled],
  )




  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames)
    },
    [moveSelectedKeyframesByDelta],
  )

  return {
    canClearRow,
    activateProperty,
    showSinglePropertyCurve,
    handleClearProperty,
    handleClearGroup,
    handleRowToggleKeyframe,
    handleRowAddKeyframe,
    handleRowAutoKeyToggle,
    nudgeSelectedKeyframes,
  }
}
