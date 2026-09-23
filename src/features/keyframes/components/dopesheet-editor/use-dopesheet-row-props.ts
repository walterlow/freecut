/**
 * Dopesheet row and group-header prop bundles.
 * Both the sheet rows and the property column render the same row content and
 * the same group headers, so both come from one bundle each. The bundles are
 * memoized on their individual values, never on an options object identity:
 * the row content and the group header are memoized components, and a fresh
 * bundle per render would re-render every visible row on every frame change.
 */

import { useMemo } from 'react'
import type {
  DopesheetGroupHeaderProps,
  DopesheetPropertyRowContentProps,
} from './dopesheet-row-renderers'

export interface UseDopesheetRowPropsOptions
  extends Omit<DopesheetPropertyRowContentProps, 'row' | 'options'> {
  expandedGroups: DopesheetGroupHeaderProps['expandedGroups']
  dimensionSeparationByProperty: DopesheetGroupHeaderProps['dimensionSeparationByProperty']
  setAllGroupsExpanded: DopesheetGroupHeaderProps['setAllGroupsExpanded']
  setGroupLocked: DopesheetGroupHeaderProps['setGroupLocked']
  toggleGroup: DopesheetGroupHeaderProps['toggleGroup']
  toggleGroupCurves: DopesheetGroupHeaderProps['toggleGroupCurves']
  handleClearGroup: DopesheetGroupHeaderProps['handleClearGroup']
}

export interface UseDopesheetRowPropsReturn {
  rowContentProps: Omit<DopesheetPropertyRowContentProps, 'row' | 'options'>
  groupHeaderProps: Omit<DopesheetGroupHeaderProps, 'group'>
}

/** Builds the memoized row-content and group-header bundles. */
export function useDopesheetRowProps(
  options: UseDopesheetRowPropsOptions,
): UseDopesheetRowPropsReturn {
  const rowContentProps = useMemo<Omit<DopesheetPropertyRowContentProps, 'row' | 'options'>>(
    () => ({
      activateProperty: options.activateProperty,
      axisConstraintByProperty: options.axisConstraintByProperty,
      autoKeyEnabledByProperty: options.autoKeyEnabledByProperty,
      beginPropertyLink: options.beginPropertyLink,
      canClearRow: options.canClearRow,
      compoundPropertyRows: options.compoundPropertyRows,
      compoundSecondaryProperties: options.compoundSecondaryProperties,
      itemId: options.itemId,
      itemFrom: options.itemFrom,
      currentFrame: options.currentFrame,
      fps: options.fps,
      disabled: options.disabled,
      expressionEditor: options.expressionEditor,
      formatPropertyValue: options.formatPropertyValue,
      globalFrame: options.globalFrame,
      graphVisibleProperties: options.graphVisibleProperties,
      handleClearProperty: options.handleClearProperty,
      handleRowAutoKeyToggle: options.handleRowAutoKeyToggle,
      handleRowNavigate: options.handleRowNavigate,
      handleRowToggleKeyframe: options.handleRowToggleKeyframe,
      handleRowValueChange: options.handleRowValueChange,
      handleRowValueCommit: options.handleRowValueCommit,
      handleValueScrubEnd: options.handleValueScrubEnd,
      handleValueScrubCancel: options.handleValueScrubCancel,
      handleValueScrubMove: options.handleValueScrubMove,
      handleValueScrubStart: options.handleValueScrubStart,
      isPropertyLocked: options.isPropertyLocked,
      isCurrentFrameBlocked: options.isCurrentFrameBlocked,
      onAddKeyframe: options.onAddKeyframe,
      onNavigateToKeyframe: options.onNavigateToKeyframe,
      onCurveVisibilityChange: options.onCurveVisibilityChange,
      onDragCancel: options.onDragCancel,
      onDragEnd: options.onDragEnd,
      onDragStart: options.onDragStart,
      onPropertyValueCommit: options.onPropertyValueCommit,
      onPropertyValuePreview: options.onPropertyValuePreview,
      resolvedPropertyLinks: options.resolvedPropertyLinks,
      resolvedPropertyLinkSourceLabels: options.resolvedPropertyLinkSourceLabels,
      removePropertyLink: options.removePropertyLink,
      propertyExpressions: options.propertyExpressions,
      propertyLabels: options.propertyLabels,
      preExpressionPropertyValues: options.preExpressionPropertyValues,
      resolveExpressionReference: options.resolveExpressionReference,
      onSetPropertyExpression: options.onSetPropertyExpression,
      openPropertyExpressionEditor: options.openPropertyExpressionEditor,
      onResetPropertiesToDefault: options.onResetPropertiesToDefault,
      propertyValues: options.propertyValues,
      presentation: options.presentation,
      selectedProperty: options.selectedProperty,
      selectedCurveVisibleExternally: options.selectedCurveVisibleExternally,
      setAllRowsLocked: options.setAllRowsLocked,
      setEditingValueProperty: options.setEditingValueProperty,
      setValueDrafts: options.setValueDrafts,
      showGraphPane: options.showGraphPane,
      showSinglePropertyCurve: options.showSinglePropertyCurve,
      singleCurveMode: options.singleCurveMode,
      skipNextBlurCommitPropertyRef: options.skipNextBlurCommitPropertyRef,
      spacious: options.spacious,
      t: options.t,
      togglePropertyCurve: options.togglePropertyCurve,
      toggleLockedProperty: options.toggleLockedProperty,
      valueDraftAtFocusRef: options.valueDraftAtFocusRef,
      valueDrafts: options.valueDrafts,
    }),
    [
      options.activateProperty,
      options.axisConstraintByProperty,
      options.autoKeyEnabledByProperty,
      options.beginPropertyLink,
      options.canClearRow,
      options.compoundPropertyRows,
      options.compoundSecondaryProperties,
      options.itemId,
      options.itemFrom,
      options.currentFrame,
      options.fps,
      options.disabled,
      options.expressionEditor,
      options.formatPropertyValue,
      options.globalFrame,
      options.graphVisibleProperties,
      options.handleClearProperty,
      options.handleRowAutoKeyToggle,
      options.handleRowNavigate,
      options.handleRowToggleKeyframe,
      options.handleRowValueChange,
      options.handleRowValueCommit,
      options.handleValueScrubEnd,
      options.handleValueScrubCancel,
      options.handleValueScrubMove,
      options.handleValueScrubStart,
      options.isPropertyLocked,
      options.isCurrentFrameBlocked,
      options.onAddKeyframe,
      options.onNavigateToKeyframe,
      options.onCurveVisibilityChange,
      options.onDragCancel,
      options.onDragEnd,
      options.onDragStart,
      options.onPropertyValueCommit,
      options.onPropertyValuePreview,
      options.resolvedPropertyLinks,
      options.resolvedPropertyLinkSourceLabels,
      options.removePropertyLink,
      options.propertyExpressions,
      options.propertyLabels,
      options.preExpressionPropertyValues,
      options.resolveExpressionReference,
      options.onSetPropertyExpression,
      options.openPropertyExpressionEditor,
      options.onResetPropertiesToDefault,
      options.propertyValues,
      options.presentation,
      options.selectedProperty,
      options.selectedCurveVisibleExternally,
      options.setAllRowsLocked,
      options.setEditingValueProperty,
      options.setValueDrafts,
      options.showGraphPane,
      options.showSinglePropertyCurve,
      options.singleCurveMode,
      options.skipNextBlurCommitPropertyRef,
      options.spacious,
      options.t,
      options.togglePropertyCurve,
      options.toggleLockedProperty,
      options.valueDraftAtFocusRef,
      options.valueDrafts,
    ],
  )
  const groupHeaderProps = useMemo<Omit<DopesheetGroupHeaderProps, 'group'>>(
    () => ({
      t: options.t,
      expandedGroups: options.expandedGroups,
      graphVisibleProperties: options.graphVisibleProperties,
      dimensionSeparationByProperty: options.dimensionSeparationByProperty,
      canClearRow: options.canClearRow,
      disabled: options.disabled,
      isPropertyLocked: options.isPropertyLocked,
      onNavigateToKeyframe: options.onNavigateToKeyframe,
      onResetPropertiesToDefault: options.onResetPropertiesToDefault,
      presentation: options.presentation,
      setAllGroupsExpanded: options.setAllGroupsExpanded,
      setAllRowsLocked: options.setAllRowsLocked,
      setGroupLocked: options.setGroupLocked,
      toggleGroup: options.toggleGroup,
      toggleGroupCurves: options.toggleGroupCurves,
      handleClearGroup: options.handleClearGroup,
      handleRowNavigate: options.handleRowNavigate,
    }),
    [
      options.canClearRow,
      options.dimensionSeparationByProperty,
      options.disabled,
      options.expandedGroups,
      options.graphVisibleProperties,
      options.handleClearGroup,
      options.handleRowNavigate,
      options.isPropertyLocked,
      options.onNavigateToKeyframe,
      options.onResetPropertiesToDefault,
      options.presentation,
      options.setAllGroupsExpanded,
      options.setAllRowsLocked,
      options.setGroupLocked,
      options.t,
      options.toggleGroup,
      options.toggleGroupCurves,
    ],
  )
  return { rowContentProps, groupHeaderProps }
}
