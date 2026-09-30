import React, { useMemo } from 'react'

import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { parseSubtitleCueText } from '@/shared/utils/subtitle-cue-format'
import type { SubtitleSegmentItem, TextItem, TextSpan } from '@/types/timeline'

import { useVideoConfig } from '../hooks/use-player-compat'
import { TextContent } from './text-content'

/**
 * Renders the active cue of a {@link SubtitleSegmentItem} per frame,
 * with reactive word-by-word animation (Hormozi, MrBeast, Karaoke).
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
  const parsed = useMemo(
    () => (activeCue ? parseSubtitleCueText(activeCue.text) : null),
    [activeCue],
  )

  // Build dynamic animated word spans for Hormozi / TikTok / Karaoke effects
  const dynamicSpans = useMemo<TextSpan[] | undefined>(() => {
    if (!activeCue || !parsed || parsed.isEmpty) return undefined
    const animStyle = item.captionAnimationStyle
    if (!animStyle || animStyle === 'none') {
      return parsed.spans
    }

    const highlightColor = item.captionHighlightColor || '#FFEB3B'
    const defaultColor = item.color || '#ffffff'
    const isHormozi = animStyle === 'hormozi'
    const isMrBeast = animStyle === 'mrbeast'
    const isKaraoke = animStyle === 'karaoke'
    const isBounce = animStyle === 'bounce'
    const baseFontSize = item.fontSize ?? 48

    // Use Whisper word timestamps if available, otherwise interpolate across cue duration
    let wordEntries = activeCue.words
    if (!wordEntries || wordEntries.length === 0) {
      const tokens = parsed.plainText.trim().split(/\s+/).filter(Boolean)
      const cueDur = Math.max(0.1, activeCue.endSeconds - activeCue.startSeconds)
      const tokenDur = cueDur / Math.max(1, tokens.length)
      wordEntries = tokens.map((w, idx) => ({
        word: w,
        start: activeCue.startSeconds + idx * tokenDur,
        end: activeCue.startSeconds + (idx + 1) * tokenDur,
      }))
    }

    return wordEntries.map((w, i) => {
      const isActive = secondsIntoSegment >= w.start && secondsIntoSegment < w.end
      const isPast = secondsIntoSegment >= w.end
      const rawWord = isHormozi || isMrBeast ? w.word.toUpperCase() : w.word
      const text = i < wordEntries.length - 1 ? `${rawWord} ` : rawWord

      let wordColor = defaultColor
      if (isActive) {
        wordColor = highlightColor
      } else if (isKaraoke && !isPast) {
        wordColor = 'rgba(255, 255, 255, 0.4)'
      }

      const activeScale = isBounce ? 1.15 : isMrBeast ? 1.08 : undefined
      const spanFontSize = isActive && activeScale ? Math.round(baseFontSize * activeScale) : undefined

      return {
        text,
        color: wordColor,
        fontSize: spanFontSize,
        fontWeight: isActive || isHormozi || isMrBeast ? 'bold' : (item.fontWeight ?? 'normal'),
        underline: isKaraoke && isActive,
      }
    })
  }, [
    activeCue,
    parsed,
    secondsIntoSegment,
    item.captionAnimationStyle,
    item.captionHighlightColor,
    item.color,
    item.fontSize,
    item.fontWeight,
  ])

  // Synthesize an ephemeral TextItem that carries the active cue's text and typography
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
      textSpans: dynamicSpans ?? parsed?.spans,
      spanLayout: dynamicSpans ? 'inline' : undefined,
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
    [parsed, dynamicSpans, item],
  )

  if (!activeCue || !parsed || parsed.isEmpty) return null
  return <TextContent item={syntheticTextItem} />
}

/**
 * Binary search for the cue whose `[startSeconds, endSeconds)` window
 * contains `seconds`.
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
