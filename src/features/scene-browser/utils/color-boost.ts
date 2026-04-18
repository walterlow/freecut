/**
 * Color-query boost for semantic search.
 *
 * CLIP is weak on pure color queries — it was trained on object-centric
 * captions, so "red color" drifts to whatever CLIP happens to associate
 * with the token. Industry CBIR systems (Imgix, TinEye) sidestep this
 * entirely by pre-extracting dominant colors per image and matching
 * query colors via ∆E in CIELAB, the approximately-perceptually-uniform
 * color space. We do the same here, using the pre-computed palette on
 * each `MediaCaption.palette`.
 *
 * Output: a ColorBoost per scene with the closest palette match, its
 * perceptual distance, and a score contribution calibrated to cosine
 * magnitudes so it composes cleanly with the text/image scores.
 */

import { deltaE2000, type LabColor, type PaletteEntry } from '../deps/analysis';

export interface ColorBoostResult {
  /** Additive score contribution, in cosine-compatible units. */
  boost: number;
  /** Query color family that matched (e.g. "red"). */
  family: string;
  /** Minimum ∆E across the scene's palette. */
  deltaE: number;
  /** The palette entry that produced the minimum distance. */
  matched: PaletteEntry;
}

/**
 * Tuned so that a visually-identical match (∆E ~0) contributes ~0.15
 * — roughly one confidence tier. ∆E ≥ 30 ("obviously different") gives
 * 0. Linear falloff in between keeps the math simple and explains
 * itself in chip tooltips.
 */
const MAX_BOOST = 0.18;
const ZERO_BOOST_DELTA_E = 30;

function boostFromDeltaE(deltaE: number, weight: number): number {
  if (deltaE >= ZERO_BOOST_DELTA_E) return 0;
  const linear = (ZERO_BOOST_DELTA_E - deltaE) / ZERO_BOOST_DELTA_E;
  // Weight shrinks the contribution when the matched color is a tiny
  // fraction of the thumbnail (a 3% pixel slice of red doesn't really
  // make the scene "red").
  const weightFactor = Math.min(1, weight / 0.2);
  return MAX_BOOST * linear * weightFactor;
}

/**
 * Canonical Lab coordinates for each color family, plus the synonyms
 * that map into it. Values are mid-saturation reference points — for
 * `red` we pick a slightly-desaturated Lab(53, 70, 50) rather than
 * pure-sRGB red (Lab 53, 80, 67) because VLM-described "reds" in
 * natural footage tend to sit a bit off the primary.
 *
 * The list stays conservative to avoid false-positive query parses
 * ("rose" as a flower vs. "rose" as a color — we accept the color
 * reading; users can always add descriptive words to disambiguate).
 */
export interface ColorFamilyDefinition {
  family: string;
  lab: LabColor;
  synonyms: string[];
}

export interface ParsedColorQuery {
  colors: ColorFamilyDefinition[];
  /**
   * True when the query is asking for palette alone (e.g. `color:yellow`,
   * `yellow color`, `crimson tones`) rather than "yellow jacket" /
   * "blue car" object semantics.
   */
  paletteOnly: boolean;
}

const COLOR_FAMILIES: ColorFamilyDefinition[] = [
  { family: 'red',    lab: { l: 53, a: 70, b: 50 },  synonyms: ['red', 'crimson', 'scarlet', 'maroon', 'ruby', 'burgundy'] },
  { family: 'orange', lab: { l: 65, a: 40, b: 65 },  synonyms: ['orange', 'amber', 'tangerine', 'peach', 'apricot'] },
  { family: 'yellow', lab: { l: 90, a: -5, b: 80 },  synonyms: ['yellow', 'golden', 'gold', 'mustard', 'lemon'] },
  { family: 'green',  lab: { l: 60, a: -55, b: 50 }, synonyms: ['green', 'emerald', 'lime', 'olive', 'forest', 'mint', 'sage'] },
  { family: 'teal',   lab: { l: 60, a: -40, b: -15 },synonyms: ['teal', 'turquoise', 'cyan', 'aqua'] },
  { family: 'blue',   lab: { l: 40, a: 15, b: -60 }, synonyms: ['blue', 'navy', 'azure', 'cobalt', 'indigo', 'sapphire'] },
  { family: 'purple', lab: { l: 40, a: 50, b: -45 }, synonyms: ['purple', 'violet', 'magenta', 'lavender', 'plum', 'lilac'] },
  { family: 'pink',   lab: { l: 75, a: 40, b: 5 },   synonyms: ['pink', 'rose', 'salmon', 'fuchsia', 'coral'] },
  { family: 'brown',  lab: { l: 40, a: 15, b: 35 },  synonyms: ['brown', 'tan', 'beige', 'chocolate', 'khaki', 'sepia'] },
  { family: 'white',  lab: { l: 95, a: 0, b: 0 },    synonyms: ['white', 'ivory', 'cream', 'snow', 'pearl'] },
  { family: 'black',  lab: { l: 10, a: 0, b: 0 },    synonyms: ['black', 'ebony', 'charcoal', 'midnight', 'onyx'] },
  { family: 'gray',   lab: { l: 55, a: 0, b: 0 },    synonyms: ['gray', 'grey', 'silver', 'slate', 'ash'] },
];

const SYNONYM_TO_FAMILY = new Map<string, ColorFamilyDefinition>();
for (const def of COLOR_FAMILIES) {
  for (const synonym of def.synonyms) SYNONYM_TO_FAMILY.set(synonym, def);
}

const COLOR_INTENT_TOKENS = new Set([
  'color',
  'colors',
  'palette',
  'palettes',
  'tint',
  'tints',
  'tone',
  'tones',
  'hue',
  'hues',
  'grade',
  'graded',
  'grading',
  'dominant',
  'swatch',
  'swatches',
]);

const COLOR_QUERY_FILLER_TOKENS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'with',
  'in',
  'on',
  'at',
  'to',
  'for',
  'from',
  'by',
  'show',
  'find',
  'me',
  'shot',
  'shots',
  'scene',
  'scenes',
  'clip',
  'clips',
  'frame',
  'frames',
  'image',
  'images',
  'video',
  'videos',
  'please',
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Parse whether the query is explicitly asking for palette matching.
 * Bare color words stay in the normal semantic lane so queries like
 * "yellow jacket" or "orange sunset" don't get treated as palette-only.
 */
export function parseColorQuery(query: string): ParsedColorQuery {
  const tokens = tokenize(query);
  const explicitIntent = tokens.some((token) => COLOR_INTENT_TOKENS.has(token));
  const seen = new Set<string>();
  const colors: ColorFamilyDefinition[] = [];
  for (const token of tokens) {
    const def = SYNONYM_TO_FAMILY.get(token);
    if (def && !seen.has(def.family)) {
      seen.add(def.family);
      colors.push(def);
    }
  }

  if (!explicitIntent || colors.length === 0) {
    return { colors: [], paletteOnly: false };
  }

  const paletteOnly = !tokens.some((token) => (
    !COLOR_INTENT_TOKENS.has(token)
    && !COLOR_QUERY_FILLER_TOKENS.has(token)
    && !SYNONYM_TO_FAMILY.has(token)
  ));

  return { colors, paletteOnly };
}

/**
 * Return the color families (with Lab coordinates) that the query
 * explicitly asks to match by palette. Empty array means no color-aware
 * ranking for this query.
 */
export function extractQueryColors(query: string): ColorFamilyDefinition[] {
  return parseColorQuery(query).colors;
}

/**
 * Find the best palette match for each query color, pick the overall
 * closest one, and return the boost + metadata. `null` means no
 * meaningful match (palette empty, or all ∆E ≥ 30).
 */
export function colorBoostFor(
  queryColors: ColorFamilyDefinition[],
  palette: PaletteEntry[] | undefined,
): ColorBoostResult | null {
  if (queryColors.length === 0 || !palette || palette.length === 0) return null;

  let best: ColorBoostResult | null = null;
  for (const query of queryColors) {
    for (const entry of palette) {
      const distance = deltaE2000(query.lab, { l: entry.l, a: entry.a, b: entry.b });
      const boost = boostFromDeltaE(distance, entry.weight);
      if (boost <= 0) continue;
      if (!best || boost > best.boost) {
        best = { boost, family: query.family, deltaE: distance, matched: entry };
      }
    }
  }
  return best;
}
