import React, { useMemo } from 'react'

import { useSequenceContext } from '@/features/composition-runtime/deps/player'
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

  // SRT/embedded cues commonly carry inline markup (<i>, <b>, sometimes
  // <font color>). Strip simple tags so they don't render as literal angle
  // brackets. Italic-aware rendering is a follow-up — would need to map
  // `<i>` runs onto TextItem.textSpans with fontStyle:'italic'.
  const cleanedText = useMemo(() => (activeCue ? stripCueMarkup(activeCue.text) : ''), [activeCue])

  // Synthesize an ephemeral TextItem that carries the active cue's text and
  // the segment's typography. Keyframe/gizmo lookups by id will miss (the
  // segment isn't a TextItem) — that's fine for now; PR 2D layers on
  // segment-level keyframable styling.
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
      text: cleanedText,
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      fontStyle: item.fontStyle,
      underline: item.underline,
      color: item.color,
      backgroundColor: item.backgroundColor,
      backgroundRadius: item.backgroundRadius,
      textAlign: item.textAlign,
      verticalAlign: item.verticalAlign,
      lineHeight: item.lineHeight,
      letterSpacing: item.letterSpacing,
      textPadding: item.textPadding,
      textShadow: item.textShadow,
      stroke: item.stroke,
      _sequenceFrameOffset: item._sequenceFrameOffset,
    }),
    [cleanedText, item],
  )

  if (!activeCue || cleanedText.length === 0) return null
  return <TextContent item={syntheticTextItem} />
}

/**
 * Strip simple HTML/SRT/Matroska markup tags from cue text. Handles `<i>`,
 * `<b>`, `<u>`, `<font ...>`, plus their closing variants. Leaves `<` /
 * `>` characters that aren't part of a recognizable tag alone.
 */
function stripCueMarkup(text: string): string {
  return text.replace(/<\/?(?:i|b|u|font|c|v|ruby|rt|lang)\b[^>]*>/gi, '').trim()
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
