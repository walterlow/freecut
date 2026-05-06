import React, { useMemo } from 'react'

import { useSequenceContext } from '@/features/composition-runtime/deps/player'
import { parseSubtitleCueText } from '@/shared/utils/subtitle-cue-format'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

import { useVideoConfig } from '../hooks/use-player-compat'
import { TextContent } from './text-content'

/**
 * Renders the active cue of a {@link SubtitleSegmentItem} per frame.
 *
 * A subtitle segment owns its full cue list — instead of stamping out N
 * TextItems, we resolve the cue active at the current sequence frame and
 * reuse {@link TextContent} so all of TextItem's styling (font loading,
 * text shadow, stroke, alignment) Just Works.
 */
export const SubtitleSegmentContent: React.FC<{
  item: SubtitleSegmentItem & { _sequenceFrameOffset?: number }
}> = ({ item }) => {
  const sequenceContext = useSequenceContext()
  const { fps } = useVideoConfig()
  const relativeFrame = (sequenceContext?.localFrame ?? 0) - (item._sequenceFrameOffset ?? 0)
  const secondsIntoSegment = relativeFrame / fps

  const activeCue = useMemo(
    () => findActiveCue(item.cues, secondsIntoSegment),
    [item.cues, secondsIntoSegment],
  )

  // Parse inline markup (<i>, <b>, <u>, <font color>) into formatted spans
  // and pull off any ASS `{\anN}` positioning override so the cue can land
  // top-of-screen (used for sign translations / on-screen labels).
  const parsed = useMemo(
    () => (activeCue ? parseSubtitleCueText(activeCue.text) : null),
    [activeCue],
  )

  // Synthesize an ephemeral TextItem that carries the active cue's text and
  // the segment's typography. Keyframe/gizmo lookups by id will miss (the
  // segment isn't a TextItem) — that's fine for now; segment-level keyframes
  // are a planned follow-up.
  const syntheticTextItem = useMemo<TextItem & { _sequenceFrameOffset?: number }>(
    () => ({
      id: item.id,
      type: 'text',
      trackId: item.trackId,
      from: item.from,
      durationInFrames: item.durationInFrames,
      label: item.label,
      mediaId: item.mediaId,
      transform: item.transform,
      text: parsed?.plainText ?? '',
      // textSpans drives styled per-run rendering — italic / bold / colored
      // fragments inside one cue. TextContent prefers spans over `text`
      // when both are present.
      textSpans: parsed?.spans,
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      fontStyle: item.fontStyle,
      underline: item.underline,
      color: item.color,
      backgroundColor: item.backgroundColor,
      backgroundRadius: item.backgroundRadius,
      textAlign: parsed?.alignment?.textAlign ?? item.textAlign,
      verticalAlign: parsed?.alignment?.verticalAlign ?? item.verticalAlign,
      lineHeight: item.lineHeight,
      letterSpacing: item.letterSpacing,
      textPadding: item.textPadding,
      textShadow: item.textShadow,
      stroke: item.stroke,
      _sequenceFrameOffset: item._sequenceFrameOffset,
    }),
    [parsed, item],
  )

  if (!activeCue || !parsed || parsed.isEmpty) return null
  return <TextContent item={syntheticTextItem} />
}

/**
 * Binary search for the cue whose `[startSeconds, endSeconds)` window
 * contains `seconds`. Cues are pre-sorted by startSeconds at insertion
 * time, so we can cut the per-frame cost from O(n) to O(log n) — meaningful
 * on a 65-min episode with 600+ cues.
 */
function findActiveCue<T extends { startSeconds: number; endSeconds: number }>(
  cues: readonly T[],
  seconds: number,
): T | null {
  if (cues.length === 0) return null
  let lo = 0
  let hi = cues.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const cue = cues[mid]!
    if (seconds < cue.startSeconds) {
      hi = mid - 1
    } else if (seconds >= cue.endSeconds) {
      lo = mid + 1
    } else {
      return cue
    }
  }
  return null
}
