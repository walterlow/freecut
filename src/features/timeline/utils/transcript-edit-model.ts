/**
 * Pure model for the transcript editor.
 *
 * Turns the Whisper word-level transcript of one or more selected clips into a
 * flat, document-ordered list of {@link TranscriptToken}s. Each token carries
 * both its source-time span (seconds, for building removal ranges) and its
 * timeline-frame span (for click-to-seek and active-word highlighting).
 *
 * Kept free of store access so it can be unit-tested directly — callers resolve
 * the per-media transcripts and hand them in.
 */

import type { TimelineItem } from '@/types/timeline'
import type { MediaTranscript, MediaTranscriptWord } from '@/types/storage'
import { getItemSourceSpanSeconds, sourceSecondsToTimelineFrame } from './media-item-frames'
import type { RemoveSilenceRange } from '../stores/actions/edit/range-removal-actions'

export interface TranscriptToken {
  /** Stable identity for React keys and selection — `${itemId}:${wordIndex}`. */
  key: string
  itemId: string
  mediaId: string
  text: string
  /** Word start in source-native seconds. */
  sourceStart: number
  /** Word end in source-native seconds. */
  sourceEnd: number
  /** Segment index within MediaTranscript segments. */
  segmentIndex?: number
  /** Word index within segment.words. */
  wordIndex?: number
  /** Inclusive timeline frame where the word begins. */
  startFrame: number
  /** Exclusive timeline frame where the word ends. */
  endFrame: number
}

export type TranscriptableItem = Extract<TimelineItem, { type: 'video' | 'audio' }> & {
  mediaId: string
}

export function isTranscriptableItem(item: TimelineItem | undefined): item is TranscriptableItem {
  return (
    !!item &&
    (item.type === 'video' || item.type === 'audio') &&
    item.isReversed !== true &&
    !!item.mediaId
  )
}

interface IndexedWord extends MediaTranscriptWord {
  segmentIndex: number
  wordIndex: number
}

function collectWords(transcript: MediaTranscript): IndexedWord[] {
  const result: IndexedWord[] = []
  transcript.segments.forEach((segment, segmentIndex) => {
    segment.words?.forEach((word, wordIndex) => {
      if (word.end > word.start && word.text.trim().length > 0) {
        result.push({
          ...word,
          segmentIndex,
          wordIndex,
        })
      }
    })
  })
  return result.toSorted((left, right) => left.start - right.start)
}

/**
 * Build the document-ordered token list for the given clips. Words that fall
 * outside a clip's trimmed source span are dropped, so a trimmed clip only
 * shows the words it actually contains.
 */
export function buildTranscriptTokens(
  items: readonly TimelineItem[],
  transcriptsByMediaId: Readonly<Record<string, MediaTranscript | undefined>>,
  timelineFps: number,
): TranscriptToken[] {
  const tokens: TranscriptToken[] = []
  // Timeline ranges already emitted per media. A linked audio companion shares
  // the exact `from`/duration of its video, so deduping on the timeline range
  // (rather than the source span, which can differ between a video and its
  // separately-based audio frames) reliably drops the companion. Distinct trims
  // of the same media sit at different timeline positions and are both kept.
  const acceptedRangesByMedia = new Map<string, Array<{ from: number; to: number }>>()

  // Prefer the video item when a video/audio pair covers the same range.
  const ordered = [...items].sort((a, b) => Number(a.type !== 'video') - Number(b.type !== 'video'))

  for (const item of ordered) {
    if (!isTranscriptableItem(item)) continue
    const transcript = transcriptsByMediaId[item.mediaId]
    if (!transcript) continue
    const span = getItemSourceSpanSeconds(item, timelineFps)
    if (!span) continue

    const from = item.from
    const to = item.from + item.durationInFrames
    const accepted = acceptedRangesByMedia.get(item.mediaId) ?? []
    if (accepted.some((other) => other.from < to && from < other.to)) continue
    accepted.push({ from, to })
    acceptedRangesByMedia.set(item.mediaId, accepted)

    const words = collectWords(transcript)
    words.forEach((word, index) => {
      // Keep any word that overlaps the trimmed clip, even partially.
      if (word.end <= span.start || word.start >= span.end) return

      const clampedStart = Math.max(word.start, span.start)
      const clampedEnd = Math.min(word.end, span.end)
      tokens.push({
        key: `${item.id}:${index}`,
        itemId: item.id,
        mediaId: item.mediaId,
        text: word.text.trim(),
        sourceStart: clampedStart,
        sourceEnd: clampedEnd,
        segmentIndex: word.segmentIndex,
        wordIndex: word.wordIndex,
        startFrame: sourceSecondsToTimelineFrame(item, clampedStart, timelineFps),
        endFrame: sourceSecondsToTimelineFrame(item, clampedEnd, timelineFps),
      })
    })
  }

  const sorted = tokens.toSorted((left, right) => left.startFrame - right.startFrame)

  // Final safety net: collapse tokens identical in text AND exact timeline timing.
  // Two sources of the same spoken content (a linked companion, or the same
  // footage imported as separate media so it escapes per-media dedup above) emit
  // word-for-word identical, identically-timed tokens. Genuinely distinct clips
  // map to different frames, so real repeated words are preserved.
  const seen = new Set<string>()
  return sorted.filter((token) => {
    const signature = `${token.startFrame}:${token.endFrame}:${token.text}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

/**
 * Index of the token under the playhead, or -1. Picks the word whose
 * [startFrame, endFrame) contains the frame; if the playhead sits in a gap
 * between words it returns -1.
 */
export function findActiveTokenIndex(
  tokens: readonly TranscriptToken[],
  currentFrame: number,
): number {
  return tokens.findIndex(
    (token) => currentFrame >= token.startFrame && currentFrame < token.endFrame,
  )
}

/**
 * Group a contiguous selection of tokens into source-time removal ranges keyed
 * by mediaId. Consecutive tokens from the same clip merge into one span (so the
 * silence between selected words is removed too); a selection that crosses clip
 * boundaries yields one range per clip run.
 */
export function buildRemovalRangesByMediaId(
  selectedTokens: readonly TranscriptToken[],
): Record<string, RemoveSilenceRange[]> {
  const rangesByMediaId: Record<string, RemoveSilenceRange[]> = {}
  let runItemId: string | null = null
  let runStart = 0
  let runEnd = 0
  let runMediaId = ''

  const flush = () => {
    if (runItemId === null) return
    const list = rangesByMediaId[runMediaId] ?? (rangesByMediaId[runMediaId] = [])
    list.push({ start: runStart, end: runEnd })
    runItemId = null
  }

  for (const token of selectedTokens) {
    if (token.itemId === runItemId) {
      runEnd = Math.max(runEnd, token.sourceEnd)
      continue
    }
    flush()
    runItemId = token.itemId
    runMediaId = token.mediaId
    runStart = token.sourceStart
    runEnd = token.sourceEnd
  }
  flush()

  return rangesByMediaId
}

/** Resolve a contiguous index range [anchor, focus] into the tokens it covers. */
export function getSelectedTokenSlice(
  tokens: readonly TranscriptToken[],
  anchorIndex: number,
  focusIndex: number,
): TranscriptToken[] {
  if (anchorIndex < 0 || focusIndex < 0) return []
  const lo = Math.min(anchorIndex, focusIndex)
  const hi = Math.max(anchorIndex, focusIndex)
  return tokens.slice(lo, hi + 1)
}
