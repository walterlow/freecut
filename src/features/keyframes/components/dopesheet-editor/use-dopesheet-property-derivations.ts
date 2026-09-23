/**
 * Property-derivation memos for the dopesheet.
 * Resolves the property list the sheet shows, its graphable subset, the
 * accordion groups, filters and procedural bands. They depend only on the
 * keyframe map and the editor's property settings, so they recompute on data
 * changes rather than on viewport or playhead movement.
 */

import { useMemo } from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { MotionModifier } from '@/types/motion'
import { isColorAnimatableProperty } from '@/features/keyframes/property-value-ranges'
import {
  getProceduralBands,
  type ProceduralBand,
} from '@/features/keyframes/utils/procedural-preview'
import { getPropertyAccordionGroups, type PropertyAccordionGroup } from './property-groups'

export interface UseDopesheetPropertyDerivationsOptions {
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  /** Property rows the caller hides outright. */
  hiddenPropertyRows: readonly AnimatableProperty[]
  /** Groups rendered inline (no header row) inside their parent list. */
  inlinePropertyGroupIds: readonly string[]
  motionModifiers: readonly MotionModifier[] | undefined
  proceduralDurationInFrames: number
  proceduralFrameOffset: number
}

export interface DopesheetPropertyDerivations {
  availableProperties: AnimatableProperty[]
  hiddenPropertyRowSet: Set<AnimatableProperty>
  graphableProperties: AnimatableProperty[]
  allPropertyGroups: PropertyAccordionGroup[]
  inlinePropertyGroupIdSet: Set<string>
  propertyGroupIdByProperty: Map<AnimatableProperty, string>
  keyframedPropertyIds: Set<string>
  proceduralBandByProperty: Map<AnimatableProperty, ProceduralBand>
}

/** Derives the sheet's property lists, groups and procedural bands. */
export function useDopesheetPropertyDerivations({
  keyframesByProperty,
  hiddenPropertyRows,
  inlinePropertyGroupIds,
  motionModifiers,
  proceduralDurationInFrames,
  proceduralFrameOffset,
}: UseDopesheetPropertyDerivationsOptions): DopesheetPropertyDerivations {
  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty],
  )
  const hiddenPropertyRowSet = useMemo(
    () => new Set<AnimatableProperty>(hiddenPropertyRows),
    [hiddenPropertyRows],
  )
  // Properties with an actual curve to draw (>= 2 keyframes). The graph picks a
  // default from these so it isn't blank when the selected/first property only
  // has a single keyframe.
  const graphableProperties = useMemo(
    () =>
      availableProperties.filter(
        (property) =>
          !isColorAnimatableProperty(property) && (keyframesByProperty[property]?.length ?? 0) >= 2,
      ),
    [availableProperties, keyframesByProperty],
  )
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties],
  )
  const inlinePropertyGroupIdSet = useMemo(
    () => new Set(inlinePropertyGroupIds),
    [inlinePropertyGroupIds],
  )
  const propertyGroupIdByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, string>()
    for (const group of allPropertyGroups) {
      for (const property of group.properties) {
        map.set(property, group.id)
      }
    }
    return map
  }, [allPropertyGroups])
  const keyframedPropertyIds = useMemo(
    () =>
      new Set(
        availableProperties.filter((property) => (keyframesByProperty[property] ?? []).length > 0),
      ),
    [availableProperties, keyframesByProperty],
  )
  const proceduralBandByProperty = useMemo(
    () => getProceduralBands(motionModifiers, proceduralDurationInFrames, proceduralFrameOffset),
    [motionModifiers, proceduralDurationInFrames, proceduralFrameOffset],
  )

  return {
    availableProperties,
    hiddenPropertyRowSet,
    graphableProperties,
    allPropertyGroups,
    inlinePropertyGroupIdSet,
    propertyGroupIdByProperty,
    keyframedPropertyIds,
    proceduralBandByProperty,
  }
}
