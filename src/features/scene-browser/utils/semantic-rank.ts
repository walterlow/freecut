/**
 * Semantic ranker — cosine similarity over unit-length caption embeddings.
 *
 * Vectors coming out of `embeddingsProvider` are already L2-normalized
 * (the worker uses `normalize: true`), so cosine similarity reduces to
 * a dot product here. Keeping this module dependency-free makes it
 * cheap to unit-test without spinning up a worker.
 */

import type { PaletteEntry } from '../deps/analysis';
import { colorBoostFor, extractQueryColors, type ColorBoostResult } from './color-boost';
import type { RankableScene, ScoredScene } from './rank';

/** Minimum cosine score to treat a scene as a match. */
export const SEMANTIC_MATCH_THRESHOLD = 0.3;

/**
 * CLIP cosine scores cluster in a much narrower range than all-MiniLM
 * text-to-text scores — even a strong visual match rarely clears 0.35,
 * whereas a strong text match can hit 0.7+. Using separate thresholds
 * keeps both signals on equal footing when we take max() below.
 *
 * The threshold has been raised from 0.20 to 0.22 after empirical tuning
 * — at 0.20 one-word queries ("fighting", "cooking") surfaced unrelated
 * thumbnails like vertical towers and skyline shots because CLIP's
 * output distribution for short queries bottoms out right around 0.20.
 * The prompt-ensembling path in {@link clipProvider.embedQueryForImages}
 * boosts real matches well above 0.22, so the raised floor cuts noise
 * without losing true positives.
 */
export const SEMANTIC_IMAGE_MATCH_THRESHOLD = 0.22;

export interface SemanticRankOptions {
  /** Minimum text cosine to retain a scene (default 0.3). */
  threshold?: number;
  /** Minimum image cosine to retain a scene (default 0.2). */
  imageThreshold?: number;
  /** CLIP-text-encoder embedding of the query, for matching image side. */
  queryImageEmbedding?: Float32Array | null;
  /** sceneId → CLIP image embedding, parallel to the text embeddings map. */
  imageEmbeddings?: Map<string, Float32Array>;
  /**
   * Raw user query. When it contains color terms, the ranker computes
   * per-scene ∆E 2000 distance against each palette entry and folds
   * the best match into the final score. Sidesteps CLIP's weakness on
   * bare color queries.
   */
  query?: string;
  /** sceneId → dominant-color palette (CIELAB + weights). */
  palettes?: Map<string, PaletteEntry[]>;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i]! * b[i]!;
  }
  return sum;
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
  const threshold = options.threshold ?? SEMANTIC_MATCH_THRESHOLD;
  const imageThreshold = options.imageThreshold ?? SEMANTIC_IMAGE_MATCH_THRESHOLD;
  const queryImage = options.queryImageEmbedding ?? null;
  const imageMap = options.imageEmbeddings;
  const paletteMap = options.palettes;

  // Parse color terms from the query once so the per-scene loop stays tight.
  const queryColors = options.query ? extractQueryColors(options.query) : [];
  const hasColorQuery = queryColors.length > 0;

  const scored: ScoredScene[] = [];
  for (const scene of scenes) {
    const textVector = embeddings.get(scene.id);
    const imageVector = queryImage && imageMap ? imageMap.get(scene.id) : undefined;

    const textScore = textVector ? cosineSimilarity(queryEmbedding, textVector) : 0;
    const imageScore = imageVector && queryImage
      ? cosineSimilarity(queryImage, imageVector)
      : 0;

    let colorBoost: ColorBoostResult | null = null;
    if (hasColorQuery && paletteMap) {
      colorBoost = colorBoostFor(queryColors, paletteMap.get(scene.id));
    }

    const textOk = textVector && textScore >= threshold;
    const imageOk = imageVector && imageScore >= imageThreshold;
    const colorOk = !!colorBoost;
    if (!textOk && !imageOk && !colorOk) continue;

    // Max of text / image / color signals — weakest side doesn't drag
    // down a strong one. The color boost is already in cosine-compatible
    // units (see `MAX_BOOST` in color-boost.ts).
    const baseScore = Math.max(
      textOk ? textScore : 0,
      imageOk ? imageScore : 0,
    );
    const score = colorBoost ? Math.max(baseScore, colorBoost.boost) : baseScore;

    // Semantic matches don't map to character spans in the caption text,
    // so highlighting is empty — the rest of the UI handles that case.
    scored.push({
      ...scene,
      score,
      matchSpans: [],
      signals: {
        ranker: 'semantic',
        textScore: textVector ? textScore : undefined,
        imageScore: imageVector ? imageScore : undefined,
        colorMatch: colorBoost?.family,
      },
    });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.mediaFileName !== b.mediaFileName) return a.mediaFileName.localeCompare(b.mediaFileName);
    return a.timeSec - b.timeSec;
  });
  return scored;
}
