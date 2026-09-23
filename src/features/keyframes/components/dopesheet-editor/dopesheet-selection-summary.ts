/**
 * Selection summaries for the dopesheet header frame inputs.
 * Pure so the readout can be reasoned about without the sheet around it: which
 * frames a selection covers, and whether they collapse to the single local and
 * global frame the inputs are allowed to commit.
 */

import type { KeyframeMeta } from './dopesheet-types'

/** What the local/global frame inputs can show for the current selection. */
export interface DopesheetSelectedFrameSummary {
  hasSelection: boolean
  hasMixedFrames: boolean
  localFrame: number | null
  globalFrame: number | null
}

/**
 * Frames of the selected keyframes, in selection order. Ids the sheet no longer
 * renders are skipped, so a stale selection cannot invent a frame.
 */
export function collectSelectedFrames(
  selectedKeyframeIds: Set<string>,
  keyframeMetaById: Map<string, KeyframeMeta>,
): number[] {
  const frames: number[] = []
  for (const keyframeId of selectedKeyframeIds) {
    const meta = keyframeMetaById.get(keyframeId)
    if (meta) {
      frames.push(meta.keyframe.frame)
    }
  }
  return frames
}

/**
 * Collapses the collected frames to one local frame (and its global
 * counterpart) when the whole selection sits on a single frame. A mixed or
 * empty selection, or one whose global offset is unknown, reports no frame.
 */
export function buildSelectedFrameSummary(
  selectedFrames: number[],
  globalFrame: number | null,
  currentFrame: number,
): DopesheetSelectedFrameSummary {
  const firstFrame = selectedFrames[0] ?? null
  const hasMixedFrames = selectedFrames.some((frame) => frame !== firstFrame)
  const isSingleFrame = !hasMixedFrames && firstFrame !== null
  const frameOffset = globalFrame === null ? null : globalFrame - currentFrame

  return {
    hasSelection: selectedFrames.length > 0,
    hasMixedFrames,
    localFrame: isSingleFrame ? firstFrame : null,
    globalFrame: isSingleFrame && frameOffset !== null ? firstFrame + frameOffset : null,
  }
}
