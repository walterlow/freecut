/**
 * Dopesheet row renderers.
 * Presentation-only components for the property column: one property group
 * header, and one property row's controls. Both receive the state the
 * orchestrator already derives, so the editor stops threading multi-entry
 * callback dependency lists through its render trees.
 */

import type { TFunction } from 'i18next'
import { cn } from '@/shared/ui/cn'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
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
