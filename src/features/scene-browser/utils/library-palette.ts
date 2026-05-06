/**
 * Weighted k-means clustering of palette entries across the library.
 *
 * Color Mode shows a small grid of "the unique colors this library is
 * made of" — for that to be usable we need to collapse the hundreds of
 * per-scene palette entries into ~12 cluster centers in CIELAB space,
 * weighted by each entry's pixel coverage so a vivid accent color
 * doesn't get drowned out by huge neutral expanses of sky/wall.
 *
 * Init: deterministic k-means++ (heaviest entry, then farthest-weighted).
 * Iteration: weighted mean in Lab.
 * Distance: ∆E 2000 so perceptual differences drive cluster membership.
 */

import { deltaE2000, type LabColor, type PaletteEntry } from '../deps/analysis'

export interface LabCluster extends LabColor {
  /** Sum of pixel-coverage weights of all entries in the cluster. */
  weight: number
  /** Count of raw palette entries that landed here. */
  count: number
}

/**
 * Fold all media palettes into a single flat list, scaled so every
 * scene contributes equally. Without the per-palette normalization a
 * long clip would dominate just by having more caption frames indexed.
 */
export function flattenLibraryPalettes(
  palettesBySource: Iterable<PaletteEntry[] | undefined>,
): PaletteEntry[] {
  const flat: PaletteEntry[] = []
  for (const palette of palettesBySource) {
    if (!palette || palette.length === 0) continue
    const total = palette.reduce((sum, e) => sum + e.weight, 0)
    if (total <= 0) continue
    for (const entry of palette) {
      flat.push({
        l: entry.l,
        a: entry.a,
        b: entry.b,
        weight: entry.weight / total,
      })
    }
  }
  return flat
}

/**
 * Weighted k-means in Lab. Returns at most `k` cluster centers; empty
 * clusters are dropped rather than re-seeded since for this UI "give me
 * the N colors that actually exist" is more useful than "exactly N".
 */
export function clusterPaletteEntries(
  entries: PaletteEntry[],
  k: number,
  maxIter = 20,
): LabCluster[] {
  if (entries.length === 0 || k <= 0) return []
  const effectiveK = Math.min(k, entries.length)

  const centers: LabColor[] = seedCentersKMeansPP(entries, effectiveK)

  for (let iter = 0; iter < maxIter; iter += 1) {
    const assignments = assignEntriesToCenters(entries, centers)
    const {
      centers: nextCenters,
      weights,
      counts,
    } = recomputeCenters(entries, assignments, centers.length)
    if (nextCenters.length === 0) break

    const converged =
      nextCenters.length === centers.length &&
      nextCenters.every((c, i) => {
        const prev = centers[i]
        return prev !== undefined && deltaE2000(c, prev) < 0.5
      })

    centers.length = 0
    centers.push(...nextCenters)

    if (converged) {
      return centers.map((c, i) => ({
        l: c.l,
        a: c.a,
        b: c.b,
        weight: weights[i] ?? 0,
        count: counts[i] ?? 0,
      }))
    }
  }

  // Final assignment for weights/counts when we exhaust iterations.
  const assignments = assignEntriesToCenters(entries, centers)
  const weights = new Array<number>(centers.length).fill(0)
  const counts = new Array<number>(centers.length).fill(0)
  for (let i = 0; i < entries.length; i += 1) {
    const k = assignments[i]!
    weights[k] = (weights[k] ?? 0) + entries[i]!.weight
    counts[k] = (counts[k] ?? 0) + 1
  }
  return centers.map((c, i) => ({
    l: c.l,
    a: c.a,
    b: c.b,
    weight: weights[i] ?? 0,
    count: counts[i] ?? 0,
  }))
}

function seedCentersKMeansPP(entries: PaletteEntry[], k: number): LabColor[] {
  // Deterministic init so the grid doesn't re-order on every render.
  // Pick the heaviest entry first, then greedily take the entry that
  // maximizes min-distance-to-existing × weight (D² weighted sampling
  // argmax instead of random sampling — same asymptotic quality, stable
  // output).
  let heaviest = 0
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i]!.weight > entries[heaviest]!.weight) heaviest = i
  }
  const seed = entries[heaviest]!
  const centers: LabColor[] = [{ l: seed.l, a: seed.a, b: seed.b }]

  while (centers.length < k) {
    let bestIdx = -1
    let bestScore = -1
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!
      let minD = Number.POSITIVE_INFINITY
      for (const c of centers) {
        const d = deltaE2000(c, { l: entry.l, a: entry.a, b: entry.b })
        if (d < minD) minD = d
      }
      if (!Number.isFinite(minD)) continue
      const score = minD * minD * entry.weight
      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }
    if (bestIdx < 0 || bestScore <= 0) break
    const picked = entries[bestIdx]!
    centers.push({ l: picked.l, a: picked.a, b: picked.b })
  }
  return centers
}

function assignEntriesToCenters(entries: PaletteEntry[], centers: LabColor[]): number[] {
  const out = new Array<number>(entries.length)
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    let bestK = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let k = 0; k < centers.length; k += 1) {
      const d = deltaE2000(centers[k]!, { l: entry.l, a: entry.a, b: entry.b })
      if (d < bestD) {
        bestD = d
        bestK = k
      }
    }
    out[i] = bestK
  }
  return out
}

function recomputeCenters(
  entries: PaletteEntry[],
  assignments: number[],
  k: number,
): { centers: LabColor[]; weights: number[]; counts: number[] } {
  const sumL = new Array<number>(k).fill(0)
  const sumA = new Array<number>(k).fill(0)
  const sumB = new Array<number>(k).fill(0)
  const sumW = new Array<number>(k).fill(0)
  const counts = new Array<number>(k).fill(0)

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    const cluster = assignments[i]!
    sumL[cluster] = (sumL[cluster] ?? 0) + entry.l * entry.weight
    sumA[cluster] = (sumA[cluster] ?? 0) + entry.a * entry.weight
    sumB[cluster] = (sumB[cluster] ?? 0) + entry.b * entry.weight
    sumW[cluster] = (sumW[cluster] ?? 0) + entry.weight
    counts[cluster] = (counts[cluster] ?? 0) + 1
  }

  const centers: LabColor[] = []
  const weights: number[] = []
  const outCounts: number[] = []
  for (let i = 0; i < k; i += 1) {
    const w = sumW[i] ?? 0
    if (w <= 0) continue
    centers.push({ l: sumL[i]! / w, a: sumA[i]! / w, b: sumB[i]! / w })
    weights.push(w)
    outCounts.push(counts[i] ?? 0)
  }
  return { centers, weights, counts: outCounts }
}
