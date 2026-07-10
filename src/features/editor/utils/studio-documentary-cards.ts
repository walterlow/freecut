import type { AudioItem, TimelineTranscriptCaptionCue } from '@/types/timeline'
import { sourceSecondsToTimelineFrame } from '../deps/timeline-contract'

export interface StudioDocumentaryCard {
  id: string
  text: string
  from: number
  durationInFrames: number
  kind: 'date' | 'stat' | 'statement'
}

export interface PlanStudioDocumentaryCardsInput {
  narrationItem: AudioItem
  fps: number
  maxCards?: number
}

const YEAR_PATTERN = /\b(?:17|18|19|20)\d{2}\b/g
const STATEMENT_PATTERN =
  /\b(secret|secrecy|mystery|money|connection|power|empire|fortune|private|exclusive|hidden|control|world|business)\b/i
const NUMBER_PATTERN = /(?:[$€£]\s?)?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?%\b/g

function normalizeCardText(value: string): string {
  return value
    .replace(/[,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '')
    .toUpperCase()
}

function statementFromCue(text: string): string | null {
  const normalized = normalizeCardText(text)
  const words = normalized.split(' ').filter(Boolean)
  if (words.length < 3 || !STATEMENT_PATTERN.test(normalized)) return null
  return words.slice(0, Math.min(9, words.length)).join(' ')
}

function cardDurationFrames(kind: StudioDocumentaryCard['kind'], fps: number): number {
  return Math.round(fps * (kind === 'statement' ? 2.25 : 1.75))
}

function candidateTexts(cue: TimelineTranscriptCaptionCue): Array<{
  text: string
  kind: StudioDocumentaryCard['kind']
}> {
  const values: Array<{ text: string; kind: StudioDocumentaryCard['kind'] }> = []
  const years = [...cue.text.matchAll(YEAR_PATTERN)].map((match) => match[0])
  for (const year of years) values.push({ text: year, kind: 'date' })

  const stats = [...cue.text.matchAll(NUMBER_PATTERN)].map((match) => match[0].trim().toUpperCase())
  for (const stat of stats) values.push({ text: stat, kind: 'stat' })

  const statement = statementFromCue(cue.text)
  if (statement) values.push({ text: statement, kind: 'statement' })
  return values
}

/**
 * Pulls sparse, legible editorial cards from a narration transcript. The
 * source uses hard cuts for most of its rhythm, so these cards are intentionally
 * selective: dates, concrete figures, and a few short thesis statements.
 */
export function planStudioDocumentaryCards(
  input: PlanStudioDocumentaryCardsInput,
): StudioDocumentaryCard[] {
  const maxCards = Math.max(0, input.maxCards ?? 8)
  if (maxCards === 0) return []

  const minGapFrames = Math.round(input.fps * 12)
  const seen = new Set<string>()
  const cards: StudioDocumentaryCard[] = []

  for (const cue of input.narrationItem.transcriptCaptions?.cues ?? []) {
    const from = sourceSecondsToTimelineFrame(input.narrationItem, cue.startSeconds, input.fps)
    if (from < input.narrationItem.from) continue
    if (cards.length > 0 && from - cards[cards.length - 1]!.from < minGapFrames) continue

    const candidate = candidateTexts(cue).find((item) => {
      const key = `${item.kind}:${item.text}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!candidate) continue

    cards.push({
      id: `studio-doc-card:${candidate.kind}:${from}:${cards.length + 1}`,
      text: candidate.text,
      from,
      durationInFrames: cardDurationFrames(candidate.kind, input.fps),
      kind: candidate.kind,
    })
    if (cards.length >= maxCards) break
  }

  return cards
}
