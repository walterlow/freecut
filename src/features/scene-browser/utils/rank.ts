/**
 * Pure keyword + fuzzy ranking for scene captions.
 *
 * Kept dependency-free so it can be unit-tested without stores or storage,
 * and moved into a worker later if ranking grows expensive (current 10k-scene
 * runs complete in well under a frame on a modern laptop).
 *
 * Ranking is intentionally simple in v1:
 *   - exact substring match on the normalized caption text → 1.0
 *   - ratio of query tokens that appear in the caption (whole-word or prefix)
 *   - trigram similarity as a tiebreak for typo tolerance
 * Scores combine with max() rather than a linear blend so a clean substring
 * match always beats a partial token overlap, regardless of caption length.
 */

export interface RankableScene {
  /** Stable composite id — typically `${mediaId}:${captionIndex}`. */
  id: string
  mediaId: string
  mediaFileName: string
  timeSec: number
  text: string
  thumbRelPath?: string
  /**
   * Dominant-color palette (CIELAB + weight) for UI swatch display and
   * color-query ranking. Plumbed through from `MediaCaption.palette`.
   */
  palette?: Array<{ l: number; a: number; b: number; weight: number }>
}

/**
 * Per-signal breakdown of why a scene ranked. Surfaced on the row so
 * users can tell, at a glance, whether the match was driven by caption
 * keywords, semantic text meaning, or visual (CLIP) similarity — which
 * is the main UX gap that "I can't tell if semantic search is working"
 * points at.
 */
export interface SceneMatchSignals {
  /** Which ranker produced this row. */
  ranker: 'keyword' | 'semantic'
  /** Cosine against the text (all-MiniLM) embedding, when semantic mode ran. */
  textScore?: number
  /** Cosine against the CLIP image embedding, when visual ranking ran. */
  imageScore?: number
  /** True when the row cleared the keyword match threshold. */
  keywordMatched?: boolean
  /**
   * Color family (e.g. `"red"`) that the query asked for and the
   * caption text mentions. Set by the color-boost pass in the ranker.
   * Present means the final score got a boost and the UI should show a
   * Color chip; absent means no color match (or no color query).
   */
  colorMatch?: string
  /**
   * Weighted-mean ∆E between the scene's palette and the user-selected
   * reference palette, when "find similar palette" is active. Lower is
   * closer; surfaced as a palette-distance chip on the row.
   */
  paletteDistance?: number
}

export interface ScoredScene extends RankableScene {
  score: number
  /** Character ranges within `text` that matched, for <mark/> rendering. */
  matchSpans: Array<[number, number]>
  signals: SceneMatchSignals
}

export interface RankOptions {
  /** Drop scenes below this score. Defaults to 0.25. */
  threshold?: number
}

const DEFAULT_THRESHOLD = 0.25

/** Strip punctuation and lowercase. Preserves letters, digits, CJK, whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text}  `
  const set = new Set<string>()
  for (let i = 0; i < padded.length - 2; i += 1) {
    set.add(padded.slice(i, i + 3))
  }
  return set
}

/**
 * Dice-style trigram similarity between two tokens. Overlap coefficient
 * against the smaller token is more forgiving than Jaccard for short
 * typo-laden queries where the whole caption would otherwise dominate the
 * denominator.
 */
function tokenTrigramSimilarity(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0
  const left = trigrams(a)
  const right = trigrams(b)
  let overlap = 0
  for (const tri of left) {
    if (right.has(tri)) overlap += 1
  }
  const denominator = Math.min(left.size, right.size)
  return denominator === 0 ? 0 : overlap / denominator
}

/**
 * Typo-tolerant match gate. Fuzzy matching alone is too permissive — "orange"
 * and "range" share four of their five interior trigrams, so a naive trigram
 * score would surface "mountain range" results for an "orange" query.
 *
 * Anchoring on a shared prefix (at least half the query token, capped at 3
 * chars) keeps typos at the back of the word matching ("kitchin" → "kitchen")
 * while rejecting coincidental substring overlaps.
 */
function sharesQueryPrefix(queryToken: string, captionToken: string): boolean {
  if (queryToken.length < 3) return false
  const prefixLen = Math.min(3, Math.max(2, Math.floor(queryToken.length / 2)))
  return captionToken.startsWith(queryToken.slice(0, prefixLen))
}

/** Best fuzzy match for a single query token against any caption token. */
function bestFuzzyTokenScore(queryToken: string, captionTokens: string[]): number {
  let best = 0
  for (const captionToken of captionTokens) {
    if (!sharesQueryPrefix(queryToken, captionToken)) continue
    const similarity = tokenTrigramSimilarity(queryToken, captionToken)
    if (similarity > best) best = similarity
    if (best === 1) return 1
  }
  return best
}

/**
 * Find ranges in the original `text` (case-insensitive) that match any of
 * the query tokens. Overlapping ranges are merged so the <mark/> renderer
 * doesn't have to deduplicate.
 */
function findMatchSpans(text: string, tokens: string[]): Array<[number, number]> {
  if (tokens.length === 0) return []
  const lower = text.toLowerCase()
  const raw: Array<[number, number]> = []
  for (const token of tokens) {
    if (token.length === 0) continue
    let from = 0
    while (from <= lower.length - token.length) {
      const idx = lower.indexOf(token, from)
      if (idx < 0) break
      raw.push([idx, idx + token.length])
      from = idx + token.length
    }
  }
  if (raw.length === 0) return []
  raw.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const span of raw) {
    const last = merged[merged.length - 1]
    if (last && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1])
    } else {
      merged.push([span[0], span[1]])
    }
  }
  return merged
}

const FUZZY_TOKEN_THRESHOLD = 0.6

function scoreScene(query: string, queryTokens: string[], scene: RankableScene): number {
  const captionNormalized = normalize(scene.text)
  if (captionNormalized.length === 0) return 0

  if (query.length > 0 && captionNormalized.includes(query)) {
    return 1
  }

  const captionTokens = captionNormalized.split(' ')
  if (queryTokens.length === 0) return 0

  let exactOrPrefix = 0
  let fuzzySum = 0
  for (const queryToken of queryTokens) {
    if (captionTokens.some((token) => token === queryToken || token.startsWith(queryToken))) {
      exactOrPrefix += 1
      fuzzySum += 1
      continue
    }
    const fuzzy = bestFuzzyTokenScore(queryToken, captionTokens)
    if (fuzzy >= FUZZY_TOKEN_THRESHOLD) {
      fuzzySum += fuzzy
    }
  }

  // Prefix-heavy matches get a small bonus so "kitchen pots" in caption wins
  // over "kichen pts" in a different caption at the same fuzzy coverage.
  const tokenScore = (exactOrPrefix / queryTokens.length) * 0.9
  const fuzzyScore = (fuzzySum / queryTokens.length) * 0.8

  return Math.max(tokenScore, fuzzyScore)
}

/**
 * Rank scenes against `query`. Empty query returns scenes unchanged (no
 * filtering, no sorting) so callers can show the default timestamp-sorted
 * view without a second code path.
 */
export function rankScenes(
  query: string,
  scenes: RankableScene[],
  options: RankOptions = {},
): ScoredScene[] {
  const normalizedQuery = normalize(query)
  if (normalizedQuery.length === 0) {
    return scenes.map((scene) => ({
      ...scene,
      score: 0,
      matchSpans: [],
      signals: { ranker: 'keyword' },
    }))
  }

  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const queryTokens = normalizedQuery.split(' ').filter(Boolean)

  const scored: ScoredScene[] = []
  for (const scene of scenes) {
    const score = scoreScene(normalizedQuery, queryTokens, scene)
    if (score < threshold) continue
    scored.push({
      ...scene,
      score,
      matchSpans: findMatchSpans(scene.text, queryTokens),
      signals: { ranker: 'keyword', keywordMatched: true },
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.mediaFileName !== b.mediaFileName) return a.mediaFileName.localeCompare(b.mediaFileName)
    return a.timeSec - b.timeSec
  })
  return scored
}
