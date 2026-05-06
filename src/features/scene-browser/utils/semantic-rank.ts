/**
 * Semantic ranker — cosine similarity over unit-length caption embeddings.
 *
 * Vectors coming out of `embeddingsProvider` are already L2-normalized
 * (the worker uses `normalize: true`), so cosine similarity reduces to
 * a dot product here. Keeping this module dependency-free makes it
 * cheap to unit-test without spinning up a worker.
 */

import type { PaletteEntry } from '../deps/analysis'
import {
  colorBoostFor,
  paletteSimilarityBoost,
  parseColorQuery,
  type ColorBoostResult,
} from './color-boost'
import type { RankableScene, ScoredScene } from './rank'

/** "Fair" tier floor for text cosines — a weakly confirming signal. */
export const SEMANTIC_MATCH_THRESHOLD = 0.3

/**
 * CLIP cosine scores cluster in a much narrower range than all-MiniLM
 * text-to-text scores — even a strong visual match rarely clears 0.35,
 * whereas a strong text match can hit 0.7+. Using separate thresholds
 * keeps both signals on equal footing when we combine them below.
 *
 * 0.22 is the "Fair" floor — a weakly confirming signal. It used to be
 * the *accept* threshold, but at that level CLIP's short-query
 * distribution put ~50% of a 200-scene corpus past it on almost any
 * prompt (the "seated down → skateboarding, doorknobs" failure). Now
 * it gates combined weak-signal acceptance: Fair-Fair only counts when
 * the text side ALSO clears its Fair floor.
 */
export const SEMANTIC_IMAGE_MATCH_THRESHOLD = 0.22

/** "Good" tier floor for text — strong enough to accept alone. */
export const SEMANTIC_TEXT_STRONG_THRESHOLD = 0.4

/** "Strong" tier floor for CLIP image cosines — strong enough to accept alone. */
export const SEMANTIC_IMAGE_STRONG_THRESHOLD = 0.3

export interface SemanticRankOptions {
  /** Minimum text cosine to retain a scene (default 0.3). */
  threshold?: number
  /** Minimum image cosine to retain a scene (default 0.2). */
  imageThreshold?: number
  /** CLIP-text-encoder embedding of the query, for matching image side. */
  queryImageEmbedding?: Float32Array | null
  /** sceneId → CLIP image embedding, parallel to the text embeddings map. */
  imageEmbeddings?: Map<string, Float32Array>
  /**
   * Raw user query. When it contains color terms, the ranker computes
   * per-scene ∆E 2000 distance against each palette entry and folds
   * the best match into the final score. Sidesteps CLIP's weakness on
   * bare color queries.
   */
  query?: string
  /** sceneId → dominant-color palette (CIELAB + weights). */
  palettes?: Map<string, PaletteEntry[]>
  /**
   * Reference palette for "find similar colors" mode. When set, the
   * ranker switches to palette-similarity scoring and ignores text/CLIP
   * signals — object semantics aren't part of "scenes with this palette".
   */
  referencePalette?: PaletteEntry[] | null
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let sum = 0
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i]! * b[i]!
  }
  return sum
}

/**
 * Rank scenes by cosine similarity to the query embedding. When a CLIP
 * text-encoder query embedding and parallel image-embedding map are
 * supplied, each scene's final score is `max(text_cosine, image_cosine)`
 * (each gated by its own threshold). This makes missing signals harmless:
 * a scene without image embeddings still ranks on text alone, and a scene
 * with a weak caption can still surface on visual match.
 *
 * Scenes whose id is absent from *both* embedding maps are dropped —
 * they have no semantic signal to rank on. Callers should handle that
 * via keyword fallback or the retroactive indexer.
 */
export function semanticRank(
  queryEmbedding: Float32Array,
  scenes: RankableScene[],
  embeddings: Map<string, Float32Array>,
  options: SemanticRankOptions = {},
): ScoredScene[] {
  const threshold = options.threshold ?? SEMANTIC_MATCH_THRESHOLD
  const imageThreshold = options.imageThreshold ?? SEMANTIC_IMAGE_MATCH_THRESHOLD
  const queryImage = options.queryImageEmbedding ?? null
  const imageMap = options.imageEmbeddings
  const paletteMap = options.palettes
  const referencePalette = options.referencePalette ?? null

  // Parse color intent once so the per-scene loop stays tight. Explicit
  // palette queries bypass text/CLIP scoring; mixed queries still get a
  // palette boost on top of semantic meaning. A reference palette forces
  // palette-only scoring regardless of the query shape.
  const colorQuery = options.query
    ? parseColorQuery(options.query)
    : { colors: [], paletteOnly: false }
  const queryColors = colorQuery.colors
  const hasColorQuery = queryColors.length > 0
  const paletteOnly = !!referencePalette || colorQuery.paletteOnly

  const scored: ScoredScene[] = []
  for (const scene of scenes) {
    if (referencePalette) {
      const scenePalette = paletteMap?.get(scene.id) ?? scene.palette
      const similarity = paletteSimilarityBoost(referencePalette, scenePalette)
      if (!similarity) continue
      scored.push({
        ...scene,
        score: similarity.boost,
        matchSpans: [],
        signals: {
          ranker: 'semantic',
          paletteDistance: similarity.distance,
        },
      })
      continue
    }
    const textVector = embeddings.get(scene.id)
    const imageVector = queryImage && imageMap ? imageMap.get(scene.id) : undefined

    const textScore = textVector ? cosineSimilarity(queryEmbedding, textVector) : 0
    const imageScore = imageVector && queryImage ? cosineSimilarity(queryImage, imageVector) : 0

    let colorBoost: ColorBoostResult | null = null
    if (hasColorQuery && paletteMap) {
      colorBoost = colorBoostFor(queryColors, paletteMap.get(scene.id))
    }

    // Accept logic is side-aware:
    //   - When both text and image sides exist for this scene, weak
    //     "Fair" signals are only accepted when mutually confirmed —
    //     without this gate ~50% of a 200-scene corpus clears the Fair
    //     CLIP floor on almost any short query (cosines cluster tight),
    //     so unrelated thumbnails (doorknobs, skateboarding) surface.
    //   - When only one side is available (CLIP still loading, or scene
    //     not image-indexed yet), fall back to the per-side floor so
    //     honest single-signal matches still show up.
    //   - Image-alone is held to the strong bar — a CLIP-only Fair match
    //     is the exact noise pattern we're trying to kill.
    const hasTextSide = !paletteOnly && !!textVector
    const hasImageSide = !paletteOnly && !!imageVector
    const fairText = hasTextSide && textScore >= threshold
    const fairImage = hasImageSide && imageScore >= imageThreshold
    const strongText = hasTextSide && textScore >= SEMANTIC_TEXT_STRONG_THRESHOLD
    const strongImage = hasImageSide && imageScore >= SEMANTIC_IMAGE_STRONG_THRESHOLD

    let accept: boolean
    if (hasTextSide && hasImageSide) {
      accept = strongText || strongImage || (fairText && fairImage)
    } else if (hasTextSide) {
      accept = fairText
    } else if (hasImageSide) {
      accept = strongImage
    } else {
      accept = false
    }

    const textOk = accept && fairText
    const imageOk = accept && fairImage
    const colorOk = !!colorBoost
    if (!accept && !colorOk) continue

    // Max of text / image / color signals — weakest side doesn't drag
    // down a strong one. The color boost is already in cosine-compatible
    // units (see `MAX_BOOST` in color-boost.ts).
    const baseScore = Math.max(textOk ? textScore : 0, imageOk ? imageScore : 0)
    const score = colorBoost ? Math.max(baseScore, colorBoost.boost) : baseScore

    // Semantic matches don't map to character spans in the caption text,
    // so highlighting is empty — the rest of the UI handles that case.
    scored.push({
      ...scene,
      score,
      matchSpans: [],
      signals: {
        ranker: 'semantic',
        textScore: !paletteOnly && textVector ? textScore : undefined,
        imageScore: !paletteOnly && imageVector ? imageScore : undefined,
        colorMatch: colorBoost?.family,
      },
    })
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.mediaFileName !== b.mediaFileName) return a.mediaFileName.localeCompare(b.mediaFileName)
    return a.timeSec - b.timeSec
  })
  return scored
}
