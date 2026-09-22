/**
 * Timeline introspection for the export range: how long the timeline runs,
 * which clip supplies the source encoding metadata, and the frame window a
 * render — or one queued segment — covers.
 */

import type { TimelineItem } from '@/types/timeline'
import type { ExportableSequence } from '../deps/timeline-compositions'

export interface FrameWindow {
  start: number
  end: number
}

export interface ExportRange extends FrameWindow {
  duration: number
}

export interface SequenceRange {
  inPoint: number | null
  outPoint: number | null
}

/** The in/out points the export actually renders, plus the project size. */
export interface TimelineRangeInput {
  renderWholeProject: boolean
  inPoint: number | null
  outPoint: number | null
  timelineDurationFrames: number
}

/** End frame of the last item on the timeline (0 when empty). */
export function getTimelineDurationFrames(
  items: ReadonlyArray<{ from: number; durationInFrames: number }>,
): number {
  if (items.length === 0) return 0
  return Math.max(...items.map((item) => item.from + item.durationInFrames))
}

/**
 * Media id of the longest video clip: the clip whose encoding best represents
 * the export, used as the source for Auto bitrate. Ties keep the first clip.
 */
export function findDominantVideoMediaId(items: TimelineItem[]): string | undefined {
  let mediaId: string | undefined
  let longestDuration = -1

  for (const item of items) {
    if (item.type !== 'video' || !item.mediaId) continue
    if (item.durationInFrames > longestDuration) {
      mediaId = item.mediaId
      longestDuration = item.durationInFrames
    }
  }

  return mediaId
}

/** Whether an in/out range is set: both points present, out strictly after in. */
export function hasInOutRange(inPoint: number | null, outPoint: number | null): boolean {
  return inPoint !== null && outPoint !== null && outPoint > inPoint
}

/**
 * Frame window the export covers: the in/out range when one is set and the user
 * hasn't asked for the whole project, otherwise the whole timeline.
 */
export function getExportRange(input: TimelineRangeInput): ExportRange {
  const { renderWholeProject, inPoint, outPoint, timelineDurationFrames } = input
  const usesInOutRange =
    !renderWholeProject && inPoint !== null && outPoint !== null && outPoint > inPoint

  if (!usesInOutRange) {
    return { start: 0, end: timelineDurationFrames, duration: timelineDurationFrames }
  }

  return { start: inPoint, end: outPoint, duration: outPoint - inPoint }
}

/** The active render range for a sequence (whole timeline unless in/out set). */
export function getQueueRange(
  seq: ExportableSequence,
  renderWholeProject: boolean,
): SequenceRange {
  const { inPoint, outPoint } = seq
  const usesInOutRange =
    !renderWholeProject && inPoint !== null && outPoint !== null && outPoint > inPoint

  return usesInOutRange ? { inPoint, outPoint } : { inPoint: null, outPoint: null }
}

/** The frame window segment generators split over: the active range, or the whole timeline. */
export function getSegmentWindow(
  seq: ExportableSequence,
  renderWholeProject: boolean,
): FrameWindow {
  const range = getQueueRange(seq, renderWholeProject)

  return { start: range.inPoint ?? 0, end: range.outPoint ?? seq.durationFrames }
}
