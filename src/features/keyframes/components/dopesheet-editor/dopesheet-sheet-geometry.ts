/**
 * Pure geometry over the rendered sheet.
 * These sit behind the editor's memos: they read the frame-independent sheet
 * structure and the frame→pixel mappers, never React state, so the memos keep
 * deciding when the viewport-sensitive position passes run.
 */

import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import { GROUP_HEADER_HEIGHT, ROW_HEIGHT } from './dopesheet-constants'
import { getNiceTickStep } from './dopesheet-helpers'
import type { DopesheetPropertyGroup, RenderedSheetEntry } from './dopesheet-types'

/** Minimal row shape the position pass reads. */
interface KeyframeRow {
  property: AnimatableProperty
  keyframes: Keyframe[]
}

/** Rendered sheet entries plus the content height they span. */
export interface RenderedSheetEntries {
  entries: RenderedSheetEntry[]
  contentHeight: number
}

/**
 * Positions every visible keyframe by id. Keyframes the viewport culls out
 * (`null`) are absent, so consumers can tell "offscreen" from "at x=0".
 */
export function buildRenderedKeyframeXById(
  rows: readonly KeyframeRow[],
  getRenderedKeyframeX: (frame: number) => number | null,
): Map<string, number> {
  const positions = new Map<string, number>()
  for (const row of rows) {
    for (const keyframe of row.keyframes) {
      const x = getRenderedKeyframeX(keyframe.frame)
      if (x !== null) {
        positions.set(keyframe.id, x)
      }
    }
  }
  return positions
}

/**
 * Flattens the grouped rows into the sheet's vertical layout. Classic lists its
 * text-motion bands above the first group; inline groups contribute rows only.
 */
export function buildRenderedSheetEntries({
  groupedSheetRows,
  presentation,
  textMotionBandCount,
  inlinePropertyGroupIdSet,
  expandedGroups,
}: {
  groupedSheetRows: readonly DopesheetPropertyGroup[]
  presentation: 'editor' | 'classic' | 'lanes'
  textMotionBandCount: number
  inlinePropertyGroupIdSet: ReadonlySet<string>
  expandedGroups: Record<string, boolean>
}): RenderedSheetEntries {
  const entries: RenderedSheetEntry[] = []
  const textMotionRowCount = presentation === 'classic' ? textMotionBandCount : 0
  let top = textMotionRowCount * ROW_HEIGHT

  for (const group of groupedSheetRows) {
    const inline = presentation === 'classic' || inlinePropertyGroupIdSet.has(group.id)
    if (!inline) {
      entries.push({ type: 'group', group, top })
      top += GROUP_HEADER_HEIGHT
    }

    if (!inline && !(expandedGroups[group.id] ?? true)) {
      continue
    }

    for (const row of group.rows) {
      entries.push({ type: 'row', row, top, indented: !inline })
      top += ROW_HEIGHT
    }
  }

  return {
    entries,
    contentHeight: top,
  }
}

/**
 * Marquee hit points for every unlocked keyframe, in sheet coordinates. Group
 * rows hit-test at the group header's height, property rows at their row.
 */
export function buildMarqueeKeyframePoints(
  entries: readonly RenderedSheetEntry[],
  getRenderedKeyframeX: (frame: number) => number | null,
  renderedKeyframeXById: Map<string, number>,
  isPropertyLocked: (property: AnimatableProperty) => boolean,
): Array<{ keyframeId: string; x: number; y: number }> {
  return entries.flatMap((entry) => {
    if (entry.type === 'group') {
      return entry.group.frameGroups.flatMap((frameGroup) => {
        const x = getRenderedKeyframeX(frameGroup.frame)
        if (x === null) return []

        return frameGroup.keyframes
          .filter(({ property }) => !isPropertyLocked(property))
          .map(({ keyframe }) => ({
            keyframeId: keyframe.id,
            x,
            y: entry.top + GROUP_HEADER_HEIGHT / 2,
          }))
      })
    }

    if (isPropertyLocked(entry.row.property)) {
      return []
    }

    return entry.row.keyframes.flatMap((keyframe) => {
      const x = renderedKeyframeXById.get(keyframe.id)
      if (x === undefined) return []
      return [
        {
          keyframeId: keyframe.id,
          x,
          y: entry.top + ROW_HEIGHT / 2,
        },
      ]
    })
  })
}

/**
 * Ruler ticks for the current viewport: an exact division when the editor is
 * given a grid division count, otherwise a nice step overscanned by the linked
 * Edit timeline's own buffer.
 */
export function buildDopesheetTicks({
  startFrame,
  endFrame,
  frameRange,
  timelineGridDivisions,
  rulerOverscanFrames,
}: {
  startFrame: number
  endFrame: number
  frameRange: number
  timelineGridDivisions: number | undefined
  rulerOverscanFrames: number
}): number[] {
  if (timelineGridDivisions && timelineGridDivisions > 0) {
    return Array.from(
      { length: timelineGridDivisions + 1 },
      (_, index) => startFrame + (index / timelineGridDivisions) * frameRange,
    )
  }
  const step = getNiceTickStep(frameRange)
  const first = Math.floor((startFrame - rulerOverscanFrames) / step) * step
  const last = endFrame + rulerOverscanFrames
  const result: number[] = []
  for (let frame = first; frame <= last; frame += step) {
    result.push(frame)
  }
  return result
}
