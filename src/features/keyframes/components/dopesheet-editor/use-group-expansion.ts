/**
 * Group expansion hook.
 * Owns expanded/collapsed state for property accordion groups, the
 * normalization effect that prunes/adds entries as groups appear and
 * disappear, and the auto-open-on-active-property behavior. Lives in a
 * separate hook from property filters because it depends on the grouped
 * rows that are derived from the filtered properties.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AnimatableProperty } from '@/types/keyframe'
import type { DopesheetPropertyGroup } from './dopesheet-types'
import type { PropertyAccordionGroup } from './property-groups'

interface UseGroupExpansionOptions {
  allPropertyGroups: PropertyAccordionGroup[]
  groupedSheetRows: DopesheetPropertyGroup[]
  groupedPropertyRows: DopesheetPropertyGroup[]
  activeSelectedProperty: AnimatableProperty | null
  initialExpandedGroups?: Readonly<Record<string, boolean>>
  onExpandedGroupsChange?: (expandedGroups: Record<string, boolean>) => void
}

export interface UseGroupExpansionReturn {
  expandedGroups: Record<string, boolean>
  toggleGroup: (groupId: string) => void
  setAllGroupsExpanded: (expanded: boolean) => void
}

export function useGroupExpansion({
  allPropertyGroups,
  groupedSheetRows,
  groupedPropertyRows,
  activeSelectedProperty,
  initialExpandedGroups,
  onExpandedGroupsChange,
}: UseGroupExpansionOptions): UseGroupExpansionReturn {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => ({
    ...initialExpandedGroups,
  }))

  useEffect(() => {
    onExpandedGroupsChange?.(expandedGroups)
  }, [expandedGroups, onExpandedGroupsChange])

  // Keep expandedGroups in sync with the actual rendered groups
  useEffect(() => {
    const groupIds = new Set([
      ...groupedSheetRows.map((group) => group.id),
      ...groupedPropertyRows.map((group) => group.id),
    ])

    setExpandedGroups((prev) => {
      const next = { ...prev }
      let changed = false

      for (const groupId of groupIds) {
        if (next[groupId] === undefined) {
          next[groupId] = true
          changed = true
        }
      }

      for (const groupId of Object.keys(next)) {
        if (!groupIds.has(groupId)) {
          delete next[groupId]
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [groupedPropertyRows, groupedSheetRows])

  // Auto-expand the group containing the selected property when it changes
  useEffect(() => {
    if (!activeSelectedProperty) return

    const activeGroup = [...groupedPropertyRows, ...groupedSheetRows].find((group) =>
      group.rows.some((row) => row.property === activeSelectedProperty),
    )
    if (!activeGroup) return

    setExpandedGroups((prev) => {
      if (prev[activeGroup.id] !== false) return prev
      return {
        ...prev,
        [activeGroup.id]: true,
      }
    })
  }, [activeSelectedProperty, groupedPropertyRows, groupedSheetRows])

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !(prev[groupId] ?? true),
    }))
  }, [])

  const setAllGroupsExpanded = useCallback(
    (expanded: boolean) => {
      setExpandedGroups(
        Object.fromEntries(allPropertyGroups.map((group) => [group.id, expanded])) as Record<
          string,
          boolean
        >,
      )
    },
    [allPropertyGroups],
  )

  return {
    expandedGroups,
    toggleGroup,
    setAllGroupsExpanded,
  }
}
