import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { getPropertyDisplayGroups } from './property-groups'
import type { DopesheetPropertyGroup, DopesheetPropertyRow } from './dopesheet-types'
import {
  PROPERTY_VALUE_RANGES,
  isColorAnimatableProperty,
} from '@/features/keyframes/property-value-ranges'
import { keyframeValueToHexColor } from '@/features/keyframes/utils/color-keyframes'

/** Minimal row shape needed to build the frame-independent group structure. */
interface GroupableRow {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

type GroupFrameGroups = Array<{
  frame: number
  keyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
}>

/** Frame-independent portion of a property group (stable across playhead scrubs). */
export interface DopesheetPropertyGroupStructure<R extends GroupableRow = DopesheetPropertyRow> {
  id: string
  label: string
  rows: R[]
  frameGroups: GroupFrameGroups
}

/** Playhead-derived group state — cheap to recompute as the current frame changes. */
interface GroupFrameState {
  currentKeyframes: Array<{ property: AnimatableProperty; keyframe: Keyframe }>
  hasKeyframeAtCurrentFrame: boolean
  prevKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null
  nextKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null
}

export function getNiceTickStep(frameRange: number): number {
  const rough = Math.max(1, frameRange / 10)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  if (normalized <= 1) return magnitude
  if (normalized <= 2) return 2 * magnitude
  if (normalized <= 5) return 5 * magnitude
  return 10 * magnitude
}

export function arePreviewFramesEqual(
  a: Record<string, number> | null,
  b: Record<string, number> | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return a === b

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false
  }

  return true
}

/**
 * Builds the frame-independent group structure (membership + keyframe frame
 * groups). The result only changes when properties/keyframes change, so callers
 * can memoize it across playhead scrubs and keep stable references for the
 * (expensive) timeline grid render.
 */
export function buildGroupedPropertyStructure<R extends GroupableRow>(
  rows: R[],
): DopesheetPropertyGroupStructure<R>[] {
  const rowByProperty = new Map<AnimatableProperty, R>(rows.map((row) => [row.property, row]))

  return getPropertyDisplayGroups(rows.map((row) => row.property))
    .map((group) => {
      const groupedRows = group.properties.flatMap((property) => {
        const row = rowByProperty.get(property)
        return row ? [row] : []
      })
      const keyframeEntries = groupedRows
        .flatMap((row) => row.keyframes.map((keyframe) => ({ property: row.property, keyframe })))
        .toSorted((a, b) => a.keyframe.frame - b.keyframe.frame)
      const frameGroups = keyframeEntries.reduce<GroupFrameGroups>((groups, entry) => {
        const lastGroup = groups.at(-1)
        if (lastGroup && lastGroup.frame === entry.keyframe.frame) {
          lastGroup.keyframes.push(entry)
        } else {
          groups.push({
            frame: entry.keyframe.frame,
            keyframes: [entry],
          })
        }
        return groups
      }, [])

      return {
        id: group.id,
        label: group.label,
        rows: groupedRows,
        frameGroups,
      }
    })
    .filter((group) => group.rows.length > 0)
}

/** Derives the playhead-relative state for a group's frame groups. */
function computeGroupFrameState(
  frameGroups: GroupFrameGroups,
  currentFrame: number,
): GroupFrameState {
  const currentKeyframes =
    frameGroups.find((groupEntries) => groupEntries.frame === currentFrame)?.keyframes ?? []

  let prevKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null = null
  let nextKeyframe: { property: AnimatableProperty; keyframe: Keyframe } | null = null

  for (let index = frameGroups.length - 1; index >= 0; index -= 1) {
    const frameGroup = frameGroups[index]
    if (frameGroup && frameGroup.frame < currentFrame) {
      prevKeyframe = frameGroup.keyframes[0] ?? null
      break
    }
  }

  for (const frameGroup of frameGroups) {
    if (frameGroup.frame > currentFrame) {
      nextKeyframe = frameGroup.keyframes[0] ?? null
      break
    }
  }

  return {
    currentKeyframes,
    hasKeyframeAtCurrentFrame: currentKeyframes.length > 0,
    prevKeyframe,
    nextKeyframe,
  }
}

export function buildGroupedPropertyRows(
  rows: DopesheetPropertyRow[],
  currentFrame: number,
): DopesheetPropertyGroup[] {
  return buildGroupedPropertyStructure(rows).map((group) => ({
    ...group,
    ...computeGroupFrameState(group.frameGroups, currentFrame),
  }))
}

/** Frame span of every keyframe in a property map, or null when it holds none. */
export function computeKeyframeFrameBounds(
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>,
): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const list of Object.values(keyframesByProperty)) {
    for (const keyframe of list ?? []) {
      if (keyframe.frame < min) min = keyframe.frame
      if (keyframe.frame > max) max = keyframe.frame
    }
  }
  return max >= min ? { min, max } : null
}

/** Display text for a property value: hex for colours, fixed decimals otherwise. */
export function formatDopesheetPropertyValue(
  property: AnimatableProperty,
  value: number | undefined,
): string {
  if (value === undefined || Number.isNaN(value)) return ''
  if (isColorAnimatableProperty(property)) return keyframeValueToHexColor(value)
  const decimals = PROPERTY_VALUE_RANGES[property]?.decimals ?? 2
  return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals)
}
