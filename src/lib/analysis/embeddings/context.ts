import type { SceneCaptionData } from '../captioning/types'

/**
 * Embedding context builder.
 *
 * The caption text alone carries a lot of semantic signal, but the Scene
 * Browser gets dramatically better results when adjacent context is
 * folded into the string before embedding. We concatenate same-space
 * signals into one structured input so that:
 *
 *  - a query like "sunset in hokkaido" matches on caption + source
 *    filename even when neither alone is sufficient,
 *  - "orange sky" matches scenes whose caption doesn't name colors but
 *    whose thumbnail is dominated by warm tones,
 *  - "she explains the recipe" matches scenes where the caption is
 *    terse ("woman in kitchen") but the nearby transcript is rich.
 *
 * Missing signals are simply omitted — a no-transcript b-roll scene
 * produces a shorter string, not a weaker vector. This is the whole
 * reason we chose concat-and-embed-once over parallel vectors for
 * same-modality signals.
 */

export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface BuildEmbeddingTextInput {
  caption: { text: string; timeSec: number }
  sceneData?: SceneCaptionData
  /**
   * Retained for call-site compatibility but unused — filename tokens
   * turned out to be noise for editor workflows (proxied filenames,
   * generic "final_export" stems drifted meaning more than they helped).
   */
  fileName?: string
  /** Full transcript for the source media, used to slice per-caption. */
  transcriptSegments?: TranscriptSegment[] | null
  /**
   * Human-readable dominant-color phrase for the caption's thumbnail,
   * e.g. `"warm orange, deep teal, near black"`. Computed off the JPEG
   * the captioning provider already captured at analyze time. This is
   * a fuzzy hint for the transformer; the structural Lab palette in
   * `paletteForLab` is what powers exact color-query ranking.
   */
  colorPhrase?: string
}

/** ± radius in seconds around the caption timestamp to pull transcript from. */
const DEFAULT_TRANSCRIPT_RADIUS_SEC = 2

/** Longer values drown the caption signal in transcript chatter. */
const TRANSCRIPT_MAX_CHARS = 220

/**
 * Pull transcript text that overlaps with a caption's time window. Joins
 * the chosen segments and caps length so long speeches don't dominate
 * the embedding input (all-MiniLM truncates around 256 tokens anyway).
 */
export function sliceTranscript(
  segments: TranscriptSegment[] | null | undefined,
  timeSec: number,
  radiusSec: number = DEFAULT_TRANSCRIPT_RADIUS_SEC,
): string {
  if (!segments || segments.length === 0) return ''
  const from = timeSec - radiusSec
  const to = timeSec + radiusSec
  const chunks: string[] = []
  for (const segment of segments) {
    if (segment.end < from || segment.start > to) continue
    const text = segment.text.trim()
    if (text) chunks.push(text)
  }
  const joined = chunks.join(' ').replace(/\s+/g, ' ').trim()
  if (joined.length <= TRANSCRIPT_MAX_CHARS) return joined
  // Clip to a word boundary so the truncation doesn't leave half-words
  // in the embedding input.
  const clipped = joined.slice(0, TRANSCRIPT_MAX_CHARS)
  const lastSpace = clipped.lastIndexOf(' ')
  return lastSpace > TRANSCRIPT_MAX_CHARS * 0.6 ? clipped.slice(0, lastSpace) : clipped
}

/**
 * Compose the string that actually gets embedded. Ordering matters a
 * little — caption first because it's the primary signal, optional
 * context lines after. Line prefixes like `SCENE:` aren't magic; they
 * just give the transformer a small semantic anchor.
 *
 * Note: we deliberately don't include filename/filepath tokens here.
 * They tested poorly in practice (proxied renders, generic "export"
 * stems, project-template names) and shifted embeddings toward the
 * *filename* rather than the scene content.
 */
export function buildEmbeddingText(input: BuildEmbeddingTextInput): string {
  const lines: string[] = []
  const caption = input.caption.text.trim()
  lines.push(`SCENE: ${caption}`)

  const shotType = input.sceneData?.shotType?.trim()
  if (shotType) lines.push(`SHOT: ${shotType}`)

  const timeOfDay = input.sceneData?.timeOfDay?.trim()
  if (timeOfDay) lines.push(`TIME: ${timeOfDay}`)

  const weather = input.sceneData?.weather?.trim()
  if (weather) lines.push(`WEATHER: ${weather}`)

  const speech = sliceTranscript(input.transcriptSegments, input.caption.timeSec)
  if (speech) lines.push(`SPEECH: ${speech}`)

  const colors = input.colorPhrase?.trim()
  if (colors) lines.push(`COLORS: ${colors}`)

  return lines.join('\n')
}
