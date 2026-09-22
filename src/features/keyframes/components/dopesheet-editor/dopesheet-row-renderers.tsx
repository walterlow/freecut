/**
 * Dopesheet row renderers.
 * Presentation-only components for the property column: one property group
 * header, and one property row's controls. Both receive the state the
 * orchestrator already derives, so the editor stops threading multi-entry
 * callback dependency lists through its render trees.
 */

import {
  memo,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { TFunction } from 'i18next'
import { cn } from '@/shared/ui/cn'
import type {
  AnimatableProperty,
  DirectLinkableProperty,
  DirectPropertyLink,
  Keyframe,
  PropertyExpression,
} from '@/types/keyframe'
import type { ExpressionValue } from '@/features/keyframes/utils/property-expression'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import type { PropertyExpressionDraft } from './expression-reference-utils'
import type { DopesheetPropertyGroup, DopesheetPropertyRow } from './dopesheet-types'
import {
  DopesheetGroupOptionsMenu,
  type DopesheetDimensionSeparationControl,
  type DopesheetDimensionSeparationEntry,
} from './dopesheet-group-options-menu'
import {
  GroupCurvesButton,
  GroupExpandButton,
  GroupKeyframeNavButton,
  GroupLockButton,
  GroupReset,
} from './property-group-controls'
import { resolveGroupHeaderState } from './property-group-view-model'
import {
  PropertyRowAutoKeyButton,
  PropertyRowAxisConstraintButton,
  PropertyRowCompoundInput,
  PropertyRowCurveButton,
  PropertyRowExpressionButton,
  PropertyRowLinkButton,
  PropertyRowLockButton,
  PropertyRowReset,
  PropertyRowValueInput,
} from './property-row-controls'
import { PropertyRowKeyframeNav } from './property-row-keyframe-nav'
import {
  resolvePropertyRowExpressionError,
  resolvePropertyRowLabels,
  resolvePropertyRowLinkable,
  resolvePropertyRowPreExpressionValue,
  resolvePropertyRowResetState,
  resolvePropertyRowShellClassName,
} from './property-row-view-model'
import { getKeyframeGroupLabel } from '@/features/keyframes/utils/property-i18n'

/** First row in the group whose control owns a coupled/separated dimension pair. */
function findGroupDimensionSeparation(
  rows: readonly DopesheetPropertyRow[],
  controls: Partial<Record<AnimatableProperty, DopesheetDimensionSeparationControl>>,
): DopesheetDimensionSeparationEntry | null {
  for (const row of rows) {
    const control = controls[row.property]
    if (control) return { property: row.property, control }
  }
  return null
}

export interface DopesheetGroupHeaderProps {
  group: DopesheetPropertyGroup
  t: TFunction
  expandedGroups: Record<string, boolean>
  graphVisibleProperties: Set<AnimatableProperty>
  dimensionSeparationByProperty: Partial<
    Record<AnimatableProperty, DopesheetDimensionSeparationControl>
  >
  canClearRow: (row: DopesheetPropertyRow) => boolean
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  onNavigateToKeyframe?: (frame: number) => void
  onResetPropertiesToDefault?: (properties: AnimatableProperty[]) => void
  presentation: 'editor' | 'classic' | 'lanes'
  setAllGroupsExpanded: (expanded: boolean) => void
  setAllRowsLocked: (locked: boolean) => void
  setGroupLocked: (properties: AnimatableProperty[], locked: boolean) => void
  toggleGroup: (groupId: string) => void
  toggleGroupCurves: (properties: AnimatableProperty[]) => void
  handleClearGroup: (group: DopesheetPropertyGroup) => void
  handleRowNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void
}

export function DopesheetGroupHeader({
  group,
  t,
  expandedGroups,
  graphVisibleProperties,
  dimensionSeparationByProperty,
  canClearRow,
  disabled,
  isPropertyLocked,
  onNavigateToKeyframe,
  onResetPropertiesToDefault,
  presentation,
  setAllGroupsExpanded,
  setAllRowsLocked,
  setGroupLocked,
  toggleGroup,
  toggleGroupCurves,
  handleClearGroup,
  handleRowNavigate,
}: DopesheetGroupHeaderProps) {
  const groupLabel = getKeyframeGroupLabel(t, group.id, group.label)
  const {
    groupProperties,
    curveVisible,
    allRowsLocked,
    canResetEffectGroup,
    canResetGroup,
    resetGroupLabel,
  } = resolveGroupHeaderState({
    group,
    graphProperties: graphVisibleProperties,
    isPropertyLocked,
    canClearRow,
    hasResetToDefault: !!onResetPropertiesToDefault,
    disabled,
    groupLabel,
    t,
  })
  const isOpen = expandedGroups[group.id] ?? true
  const dimensionSeparation = findGroupDimensionSeparation(
    group.rows,
    dimensionSeparationByProperty,
  )

  return (
    <div
      className={cn(
        'group flex h-full items-center gap-px border-y border-border/60 bg-muted/70 pl-3 pr-0.5',
        presentation === 'lanes' &&
          "relative pl-6 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/40 before:content-['']",
      )}
    >
      <div className="flex items-center gap-px self-stretch">
        <GroupCurvesButton
          groupProperties={groupProperties}
          groupLabel={groupLabel}
          curveVisible={curveVisible}
          onToggleGroupCurves={toggleGroupCurves}
          t={t}
        />
        <GroupLockButton
          groupProperties={groupProperties}
          groupLabel={groupLabel}
          allRowsLocked={allRowsLocked}
          setAllRowsLocked={setAllRowsLocked}
          setGroupLocked={setGroupLocked}
          t={t}
        />
      </div>
      <GroupExpandButton
        groupId={group.id}
        groupLabel={groupLabel}
        isOpen={isOpen}
        setAllGroupsExpanded={setAllGroupsExpanded}
        toggleGroup={toggleGroup}
        t={t}
      />
      <div className="ml-auto flex items-center gap-0 rounded-sm border border-border/70 bg-background/90 px-px shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <DopesheetGroupOptionsMenu
          groupLabel={groupLabel}
          dimensionSeparation={dimensionSeparation}
          disabled={disabled}
          isPropertyLocked={isPropertyLocked}
        />
        <GroupKeyframeNavButton
          direction="prev"
          entry={group.prevKeyframe}
          fallbackProperty={group.rows[0]?.property ?? 'x'}
          groupLabel={groupLabel}
          disabled={disabled}
          canNavigate={!!onNavigateToKeyframe}
          onNavigate={handleRowNavigate}
          t={t}
        />
        <GroupKeyframeNavButton
          direction="next"
          entry={group.nextKeyframe}
          fallbackProperty={group.rows[0]?.property ?? 'x'}
          groupLabel={groupLabel}
          disabled={disabled}
          canNavigate={!!onNavigateToKeyframe}
          onNavigate={handleRowNavigate}
          t={t}
        />
        <GroupReset
          groupId={group.id}
          canResetGroup={canResetGroup}
          resetGroupLabel={resetGroupLabel}
          canResetEffectGroup={canResetEffectGroup}
          groupProperties={groupProperties}
          onResetToDefault={onResetPropertiesToDefault}
          onClearGroup={() => handleClearGroup(group)}
        />
      </div>
    </div>
  )
}

export interface DopesheetPropertyRowContentProps {
  row: DopesheetPropertyRow
  /** Row presentation flags from the sheet or lane layout. */
  options?: { classic?: boolean; indented?: boolean }
  activateProperty: (property: AnimatableProperty) => void
  axisConstraintByProperty: Partial<
    Record<
      AnimatableProperty,
      { label: string; constrained: boolean; onChange: (constrained: boolean) => void }
    >
  >
  autoKeyEnabledByProperty: Partial<Record<AnimatableProperty, boolean>>
  beginPropertyLink?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  canClearRow: (row: DopesheetPropertyRow) => boolean
  compoundPropertyRows: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>
  compoundSecondaryProperties: Partial<Record<AnimatableProperty, AnimatableProperty>>
  itemId: string
  itemFrom: number
  currentFrame: number
  fps: number
  disabled: boolean
  expressionEditor: PropertyExpressionDraft | null
  formatPropertyValue: (property: AnimatableProperty, value: number | undefined) => string
  globalFrame?: number | null | undefined
  graphVisibleProperties: Set<AnimatableProperty>
  handleClearProperty: (property: AnimatableProperty) => void
  handleRowAutoKeyToggle: (property: AnimatableProperty) => void
  handleRowNavigate: (property: AnimatableProperty, keyframe: Keyframe | null) => void
  handleRowToggleKeyframe: (property: AnimatableProperty, currentKeyframes: Keyframe[]) => void
  handleRowValueChange: (property: AnimatableProperty, value: string) => void
  handleRowValueCommit: (property: AnimatableProperty, options?: { allowCreate?: boolean }) => void
  handleValueScrubEnd: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  handleValueScrubCancel: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  handleValueScrubMove: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  handleValueScrubStart: (event: ReactPointerEvent<HTMLInputElement>, property: AnimatableProperty) => void
  isPropertyLocked: (property: AnimatableProperty) => boolean
  isCurrentFrameBlocked: boolean
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  onNavigateToKeyframe?: (frame: number) => void
  onCurveVisibilityChange?: (property: AnimatableProperty, visible: boolean) => void
  onDragCancel?: () => void
  onDragEnd?: () => void
  onDragStart?: () => void
  onPropertyValueCommit?: (property: AnimatableProperty, value: number, options?: { allowCreate?: boolean }) => void
  onPropertyValuePreview?: (property: AnimatableProperty, value: number) => void
  resolvedPropertyLinks: readonly DirectPropertyLink[]
  resolvedPropertyLinkSourceLabels: Partial<Record<DirectLinkableProperty, string>>
  removePropertyLink?: (property: DirectLinkableProperty) => void
  propertyExpressions: readonly PropertyExpression[]
  propertyLabels: Partial<Record<AnimatableProperty, string>>
  preExpressionPropertyValues: Partial<Record<AnimatableProperty, number>>
  resolveExpressionReference?: (itemId: string, property: DirectLinkableProperty) => ExpressionValue | null
  onSetPropertyExpression?: (property: DirectLinkableProperty, source: string, enabled: boolean) => void
  openPropertyExpressionEditor: (property: DirectLinkableProperty, expression?: PropertyExpression) => void
  onResetPropertiesToDefault?: (properties: AnimatableProperty[]) => void
  propertyValues: Partial<Record<AnimatableProperty, number>>
  presentation: 'editor' | 'classic' | 'lanes'
  selectedProperty: AnimatableProperty | null
  selectedCurveVisibleExternally: boolean
  setAllRowsLocked: (locked: boolean) => void
  setEditingValueProperty: Dispatch<SetStateAction<AnimatableProperty | null>>
  setValueDrafts: Dispatch<SetStateAction<Partial<Record<AnimatableProperty, string>>>>
  showGraphPane: boolean
  showSinglePropertyCurve: (property: AnimatableProperty) => void
  singleCurveMode: boolean
  skipNextBlurCommitPropertyRef: RefObject<AnimatableProperty | null>
  spacious: boolean
  t: TFunction
  togglePropertyCurve: (property: AnimatableProperty) => void
  toggleLockedProperty: (property: AnimatableProperty) => void
  valueDraftAtFocusRef: RefObject<Partial<Record<AnimatableProperty, string>>>
  valueDrafts: Partial<Record<AnimatableProperty, string>>
}

/**
 * One property row's controls. Memoized because the sheet caches the row
 * elements it builds per property; a stable element must not re-render the row
 * (and the memoized timeline cells under it) on every viewport change.
 */
export const DopesheetPropertyRowContent = memo(function DopesheetPropertyRowContent({
  row,
  options,
  activateProperty,
  axisConstraintByProperty,
  autoKeyEnabledByProperty,
  beginPropertyLink,
  canClearRow,
  compoundPropertyRows,
  compoundSecondaryProperties,
  itemId,
  itemFrom,
  currentFrame,
  fps,
  disabled,
  expressionEditor,
  formatPropertyValue,
  globalFrame,
  graphVisibleProperties,
  handleClearProperty,
  handleRowAutoKeyToggle,
  handleRowNavigate,
  handleRowToggleKeyframe,
  handleRowValueChange,
  handleRowValueCommit,
  handleValueScrubEnd,
  handleValueScrubCancel,
  handleValueScrubMove,
  handleValueScrubStart,
  isPropertyLocked,
  isCurrentFrameBlocked,
  onAddKeyframe,
  onNavigateToKeyframe,
  onCurveVisibilityChange,
  onDragCancel,
  onDragEnd,
  onDragStart,
  onPropertyValueCommit,
  onPropertyValuePreview,
  resolvedPropertyLinks,
  resolvedPropertyLinkSourceLabels,
  removePropertyLink,
  propertyExpressions,
  propertyLabels,
  preExpressionPropertyValues,
  resolveExpressionReference,
  onSetPropertyExpression,
  openPropertyExpressionEditor,
  onResetPropertiesToDefault,
  propertyValues,
  presentation,
  selectedProperty,
  selectedCurveVisibleExternally,
  setAllRowsLocked,
  setEditingValueProperty,
  setValueDrafts,
  showGraphPane,
  showSinglePropertyCurve,
  singleCurveMode,
  skipNextBlurCommitPropertyRef,
  spacious,
  t,
  togglePropertyCurve,
  toggleLockedProperty,
  valueDraftAtFocusRef,
  valueDrafts,
}: DopesheetPropertyRowContentProps) {
  const classic = options?.classic ?? false
  const rowLocked = isPropertyLocked(row.property)
  const axisConstraint = axisConstraintByProperty[row.property]
  const compoundRow = compoundPropertyRows[row.property]
  const { rowLabel, rowDisplayLabel } = resolvePropertyRowLabels(
    row.property,
    propertyLabels,
    compoundRow,
    t,
  )
  const linkableProperty = resolvePropertyRowLinkable(row.property, compoundRow)
  const propertyLink = linkableProperty
    ? resolvedPropertyLinks.find((link) => link.targetProperty === linkableProperty)
    : undefined
  const propertyExpression = linkableProperty
    ? propertyExpressions.find((expression) => expression.targetProperty === linkableProperty)
    : undefined
  const preExpressionValue = resolvePropertyRowPreExpressionValue(
    row.property,
    compoundRow,
    preExpressionPropertyValues,
    propertyValues,
  )
  const expressionError = resolvePropertyRowExpressionError({
    linkableProperty,
    preExpressionValue,
    expressionEditor,
    propertyExpression,
    globalFrame,
    itemFrom,
    currentFrame,
    fps,
    resolveExpressionReference,
  })
  const { canResetEffectProperty, canResetRow, resetRowLabel } = resolvePropertyRowResetState({
    property: row.property,
    rowLabel,
    hasResetToDefault: !!onResetPropertiesToDefault,
    disabled,
    rowLocked,
    canClear: canClearRow(row),
    t,
  })

  return (
    <div
      className={resolvePropertyRowShellClassName({
        isLanes: presentation === 'lanes',
        rowOptions: options,
        hasKeyframeAtCurrentFrame: row.controls.hasKeyframeAtCurrentFrame,
        showGraphPane,
        selectedProperty,
        property: row.property,
        graphProperties: graphVisibleProperties,
        rowLocked,
      })}
      data-expression-item-id={linkableProperty ? itemId : undefined}
      data-expression-property={linkableProperty ?? undefined}
      data-selected={selectedProperty === row.property ? 'true' : undefined}
      aria-current={selectedProperty === row.property ? 'true' : undefined}
      onClick={!rowLocked ? () => activateProperty(row.property) : undefined}
    >
      <div className="flex items-center gap-px self-stretch">
          <PropertyRowCurveButton
            property={row.property}
            rowLabel={rowLabel}
            singleCurveMode={singleCurveMode ?? false}
            showGraphPane={showGraphPane}
            selectedCurveVisibleExternally={selectedCurveVisibleExternally}
            selectedProperty={selectedProperty}
            graphProperties={graphVisibleProperties}
            visible={!classic}
            onCurveVisibilityChange={onCurveVisibilityChange}
            showSinglePropertyCurve={showSinglePropertyCurve}
            togglePropertyCurve={togglePropertyCurve}
            t={t}
          />
        <PropertyRowLockButton
          rowLocked={rowLocked}
          property={row.property}
          rowLabel={rowLabel}
          visible={!classic}
          setAllRowsLocked={setAllRowsLocked}
          toggleLockedProperty={toggleLockedProperty}
          t={t}
        />
        <PropertyRowAutoKeyButton
          property={row.property}
          rowLabel={rowLabel}
          autoKeyEnabled={autoKeyEnabledByProperty[row.property]}
          disabled={disabled}
          rowLocked={rowLocked}
          canCommit={!!onPropertyValueCommit}
          onToggleAutoKey={handleRowAutoKeyToggle}
          t={t}
        />
          <PropertyRowLinkButton
            linkableProperty={linkableProperty}
            rowLabel={rowLabel}
            visible={!classic}
            hasPropertyLink={!!propertyLink}
            sourceLabels={resolvedPropertyLinkSourceLabels}
            linkSource={propertyLink}
            onBeginLink={beginPropertyLink}
            onRemoveLink={removePropertyLink}
            t={t}
          />
        <PropertyRowExpressionButton
          linkableProperty={linkableProperty}
          rowLabel={rowLabel}
          visible={!classic}
          canEdit={!!onSetPropertyExpression}
            expressionError={expressionError}
            disabled={disabled}
          rowLocked={rowLocked}
          propertyExpression={propertyExpression}
          onOpenExpression={openPropertyExpressionEditor}
        />
      </div>
      <div
        className={cn(
          'flex h-full min-w-0 items-center overflow-hidden pr-1 text-[9px] font-medium leading-none text-foreground/90',
          compoundRow ? 'w-[54px] shrink-0 pl-1' : classic ? 'flex-1 pl-1' : 'flex-1 pl-[10px]',
        )}
        title={rowLabel}
      >
        <span className="min-w-0 truncate">{rowDisplayLabel}</span>
        <PropertyRowAxisConstraintButton
          axisConstraint={axisConstraint}
          visible={classic}
          disabled={disabled}
          rowLocked={rowLocked}
        />
      </div>
      <div className="ml-auto flex items-center gap-0">
        {compoundRow ? (
          <PropertyRowCompoundInput
            property={row.property}
            compoundRow={compoundRow}
            compoundSecondaryProperties={compoundSecondaryProperties}
            spacious={spacious}
            disabled={disabled}
            rowLocked={rowLocked}
            hasPropertyLink={!!propertyLink}
            hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
            isCurrentFrameBlocked={isCurrentFrameBlocked}
            autoKeyEnabled={autoKeyEnabledByProperty[row.property] ?? false}
            activateProperty={activateProperty}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
            onPropertyValuePreview={onPropertyValuePreview}
          />
        ) : (
          <PropertyRowValueInput
            property={row.property}
            rowLabel={rowLabel}
            spacious={spacious}
            hasPropertyLink={!!propertyLink}
            disabled={disabled}
            rowLocked={rowLocked}
            canCommit={!!onPropertyValueCommit}
            hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
            isCurrentFrameBlocked={isCurrentFrameBlocked}
            autoKeyEnabled={autoKeyEnabledByProperty[row.property] ?? false}
            propertyValues={propertyValues}
            valueDrafts={valueDrafts}
            valueDraftAtFocusRef={valueDraftAtFocusRef}
            skipNextBlurCommitPropertyRef={skipNextBlurCommitPropertyRef}
            onValueChange={handleRowValueChange}
            onScrubStart={handleValueScrubStart}
            onScrubMove={handleValueScrubMove}
            onScrubEnd={handleValueScrubEnd}
            onScrubCancel={handleValueScrubCancel}
            onValueCommit={handleRowValueCommit}
            onFocusProperty={activateProperty}
            onEditingChange={setEditingValueProperty}
            onDraftsChange={setValueDrafts}
            formatDisplayValue={formatPropertyValue}
            t={t}
          />
        )}
        <PropertyRowKeyframeNav
          property={row.property}
          rowLabel={rowLabel}
          prevKeyframe={row.controls.prevKeyframe}
          nextKeyframe={row.controls.nextKeyframe}
          currentKeyframes={row.controls.currentKeyframes}
          hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
          disabled={disabled}
          rowLocked={rowLocked}
          isCurrentFrameBlocked={isCurrentFrameBlocked}
          canNavigate={!!onNavigateToKeyframe}
          canAddKeyframe={!!onAddKeyframe}
          onNavigate={handleRowNavigate}
          onToggleKeyframe={handleRowToggleKeyframe}
          t={t}
        />
        <PropertyRowReset
          classic={classic}
          canResetRow={canResetRow}
          resetRowLabel={resetRowLabel}
          canResetEffectProperty={canResetEffectProperty}
          property={row.property}
          onResetToDefault={onResetPropertiesToDefault}
          onClearProperty={handleClearProperty}
        />
      </div>
    </div>
  )
})
