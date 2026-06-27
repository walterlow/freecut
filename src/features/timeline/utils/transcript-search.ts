/**
 * Content search over the timeline's spoken words.
 *
 * Grounding gives the agent clip labels and times, but not what is *said*. This
 * resolves "find where I talk about X" by loading the relevant transcripts,
 * reusing `buildTranscriptTokens` for the source→timeline mapping, and returning
 * the matching clips + timecodes. Lives in the timeline feature (which owns the
 * transcript model) and is surfaced to the editor agent via the deps contract.
 */

import type { MediaTranscript } from '@/types/storage'
import { useItemsStore } from '../stores/items-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { mediaTranscriptionService } from '../deps/media-transcription-service'
import { buildTranscriptTokens, isTranscriptableItem } from './transcript-edit-model'

export interface TranscriptSearchMatch {
  itemId: string
  /** Timeline time (seconds) where the matched phrase begins. */
  timelineSeconds: number
  /** A few words around the match, for display. */
  snippet: string
}

/** Tokens to scan forward when matching a phrase across word boundaries. */
const WINDOW_TOKENS = 16
const SNIPPET_BEFORE = 2
const SNIPPET_AFTER = 8

export async function searchTimelineTranscript(
  query: string,
  limit = 8,
): Promise<TranscriptSearchMatch[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const items = useItemsStore.getState().items.filter(isTranscriptableItem)
  if (items.length === 0) return []
  const fps = useTimelineSettingsStore.getState().fps
  const safeFps = Math.max(1, fps)

  const mediaIds = Array.from(new Set(items.map((item) => item.mediaId)))
  const transcriptsByMediaId: Record<string, MediaTranscript | undefined> = {}
  await Promise.all(
    mediaIds.map(async (mediaId) => {
      try {
        transcriptsByMediaId[mediaId] = await mediaTranscriptionService.getTranscript(mediaId)
      } catch {
        transcriptsByMediaId[mediaId] = undefined
      }
    }),
  )

  const tokens = buildTranscriptTokens(items, transcriptsByMediaId, fps)
  if (tokens.length === 0) return []
  const words = tokens.map((token) => token.text.toLowerCase())

  const matches: TranscriptSearchMatch[] = []
  for (let i = 0; i < tokens.length && matches.length < limit; i++) {
    // Join a small forward window so multi-word phrases match across tokens.
    let windowText = ''
    let end = i
    while (
      end < tokens.length &&
      end < i + WINDOW_TOKENS &&
      windowText.length < needle.length + 48
    ) {
      const word = words[end]
      if (word) windowText += (end > i ? ' ' : '') + word
      end++
    }
    if (!windowText.includes(needle)) continue

    const anchor = tokens[i]
    if (!anchor) continue
    const snippet = tokens
      .slice(Math.max(0, i - SNIPPET_BEFORE), Math.min(tokens.length, i + SNIPPET_AFTER))
      .map((token) => token.text)
      .join(' ')
    matches.push({
      itemId: anchor.itemId,
      timelineSeconds: anchor.startFrame / safeFps,
      snippet,
    })
    i = end // skip past this match to avoid overlapping duplicates
  }

  return matches
}
