/**
 * Dopesheet sheet structure.
 * Owns the rows the sheet is built from: the visible property list and its
 * filters, the frame-independent keyframe map, the grouped rows the group cells
 * read, and the flattened keyframe list the header counts read. Everything
 * here derives from the keyframe map and the property settings, so it
 * recomputes on data changes rather than on viewport or playhead movement —
 * except the per-row `controls`, which are deliberately playhead-dependent so
 * the memoized timeline cells can skip re-rendering during a scrub.
 */

import { useMemo } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import {
  buildGroupedPropertyRows,
  buildGroupedPropertyStructure,
  type DopesheetPropertyGroupStructure,
} from './dopesheet-helpers'
import { useGroupExpansion } from './use-group-expansion'
import type { DopesheetPropertyDerivations } from './use-dopesheet-property-derivations'
import type { DopesheetPropertyGroup, DopesheetPropertyRow } from './dopesheet-types'
import type { PropertyAccordionGroup } from './property-groups'
import type { DopesheetEditorProps } from './dopesheet-editor-props'
import { getDopesheetRowControlState } from './row-controls'

/** A sheet row before the playhead-dependent control state is attached. */
export interface DopesheetSheetRowStructure {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

export interface UseDopesheetSheetStructureOptions {
  availableProperties: AnimatableProperty[]
  hiddenPropertyRowSet: DopesheetPropertyDerivations['hiddenPropertyRowSet']
  propertyGroupIdByProperty: DopesheetPropertyDerivations['propertyGroupIdByProperty']
  keyframedPropertyIds: DopesheetPropertyDerivations['keyframedPropertyIds']
  proceduralBandByProperty: DopesheetPropertyDerivations['proceduralBandByProperty']
  visibleGroups: Record<string, boolean>
  propertyFilter: DopesheetEditorProps['propertyFilter']
  showKeyframedOnly: boolean
  resolvedPropertyLinks: NonNullable<DopesheetEditorProps['propertyLinks']>
  keyframesByProperty: DopesheetEditorProps['keyframesByProperty']
  currentFrame: number
  selectedProperty: AnimatableProperty | null
  allPropertyGroups: PropertyAccordionGroup[]
  initialExpandedGroups: DopesheetEditorProps['initialExpandedGroups']
  onExpandedGroupsChange: DopesheetEditorProps['onExpandedGroupsChange']
}

export interface UseDopesheetSheetStructureReturn {
  filterKeyframedOnly: boolean
  visibleProperties: AnimatableProperty[]
  propertyColumnProperties: AnimatableProperty[]
  activeSelectedProperty: AnimatableProperty | null
  hasPropertyFilters: boolean
  sheetKeyframesByProperty: Map<AnimatableProperty, Keyframe[]>
  sheetRowsStructure: DopesheetSheetRowStructure[]
  groupTimelineById: Map<string, DopesheetPropertyGroupStructure<DopesheetSheetRowStructure>>
  sheetRows: DopesheetPropertyRow[]
  groupedSheetRows: DopesheetPropertyGroup[]
  propertyRowByProperty: Map<AnimatableProperty, DopesheetPropertyRow>
  visibleKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  expandedGroups: Record<string, boolean>
  toggleGroup: (groupId: string) => void
  setAllGroupsExpanded: (expanded: boolean) => void
}

/** Derives the sheet's rows, group structure and flattened keyframe list. */
export function useDopesheetSheetStructure({
  availableProperties,
  hiddenPropertyRowSet,
  propertyGroupIdByProperty,
  keyframedPropertyIds,
  proceduralBandByProperty,
  visibleGroups,
  propertyFilter,
  showKeyframedOnly,
  resolvedPropertyLinks,
  keyframesByProperty,
  currentFrame,
  selectedProperty,
  allPropertyGroups,
  initialExpandedGroups,
  onExpandedGroupsChange,
}: UseDopesheetSheetStructureOptions): UseDopesheetSheetStructureReturn {
  const filterKeyframedOnly =
    propertyFilter === undefined ? showKeyframedOnly : propertyFilter === 'keyframed'
  const linkedTransformPropertyIds = useMemo(
    () =>
      new Set<string>(
        resolvedPropertyLinks.map((link) => {
          if (link.targetProperty === 'position') return 'x'
          if (link.targetProperty === 'scale') return 'width'
          if (link.targetProperty === 'anchor') return 'anchorX'
          return link.targetProperty
        }),
      ),
    [resolvedPropertyLinks],
  )

  const filteredProperties = useMemo(
    () =>
      availableProperties
        .filter((property) => !hiddenPropertyRowSet.has(property))
        .filter((property) => {
          const groupId = propertyGroupIdByProperty.get(property)
          const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true
          if (!groupVisible) return false
          if (
            filterKeyframedOnly &&
            !keyframedPropertyIds.has(property) &&
            !linkedTransformPropertyIds.has(property) &&
            !proceduralBandByProperty.has(property)
          )
            return false
          return true
        }),
    [
      availableProperties,
      hiddenPropertyRowSet,
      keyframedPropertyIds,
      linkedTransformPropertyIds,
      proceduralBandByProperty,
      propertyGroupIdByProperty,
      filterKeyframedOnly,
      visibleGroups,
    ],
  )
  const activeSelectedProperty =
    selectedProperty && filteredProperties.includes(selectedProperty) ? selectedProperty : null
  const visibleProperties = filteredProperties
  const propertyColumnProperties = filteredProperties
  const hasPropertyFilters =
    filterKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false)

  // Frame-independent keyframe data. These references only change when the
  // properties or keyframes change — NOT when the playhead moves — so the
  // memoized timeline grid cells can skip re-rendering during scrubs.
  const sheetKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>()
    for (const property of visibleProperties) {
      map.set(
        property,
        (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
      )
    }
    return map
  }, [visibleProperties, keyframesByProperty])

  const sheetRowsStructure = useMemo(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: sheetKeyframesByProperty.get(property) ?? [],
      })),
    [visibleProperties, sheetKeyframesByProperty],
  )

  // Stable, frame-independent group structure keyed by group id — used to feed
  // the memoized group timeline cells.
  const groupTimelineById = useMemo(() => {
    const map = new Map<string, DopesheetPropertyGroupStructure<DopesheetSheetRowStructure>>()
    for (const group of buildGroupedPropertyStructure(sheetRowsStructure)) {
      map.set(group.id, group)
    }
    return map
  }, [sheetRowsStructure])

  // Playhead-dependent rows (carry the per-frame `controls`). `propertyColumnProperties`
  // is the same list as `visibleProperties`, so the column/sheet rows are identical.
  const sheetRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      sheetRowsStructure.map((row) => ({
        ...row,
        controls: getDopesheetRowControlState(row.keyframes, currentFrame),
      })),
    [sheetRowsStructure, currentFrame],
  )

  const groupedSheetRows = useMemo(
    () => buildGroupedPropertyRows(sheetRows, currentFrame),
    [currentFrame, sheetRows],
  )
  const propertyRowByProperty = useMemo(
    () => new Map(sheetRows.map((row) => [row.property, row])),
    [sheetRows],
  )
  const { expandedGroups, toggleGroup, setAllGroupsExpanded } = useGroupExpansion({
    allPropertyGroups,
    groupedSheetRows,
    groupedPropertyRows: groupedSheetRows,
    activeSelectedProperty,
    initialExpandedGroups,
    onExpandedGroupsChange,
  })

  const visibleKeyframes = useMemo(
    () =>
      sheetRows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        })),
      ),
    [sheetRows],
  )

  return {
    filterKeyframedOnly,
    visibleProperties,
    propertyColumnProperties,
    activeSelectedProperty,
    hasPropertyFilters,
    sheetKeyframesByProperty,
    sheetRowsStructure,
    groupTimelineById,
    sheetRows,
    groupedSheetRows,
    propertyRowByProperty,
    visibleKeyframes,
    expandedGroups,
    toggleGroup,
    setAllGroupsExpanded,
  }
}
