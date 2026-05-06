import { describe, expect, it } from 'vite-plus/test'
import {
  colorBoostFor,
  extractQueryColors,
  nearestColorFamily,
  palettePairDistance,
  paletteSimilarityBoost,
  parseColorQuery,
} from './color-boost'
import type { PaletteEntry } from '../deps/analysis'

describe('extractQueryColors', () => {
  it('finds a single family for an explicit color-intent query', () => {
    const result = extractQueryColors('red color')
    expect(result.map((r) => r.family)).toEqual(['red'])
  })

  it('maps synonyms to their canonical family when the query is palette-oriented', () => {
    const result = extractQueryColors('crimson tones')
    expect(result.map((r) => r.family)).toEqual(['red'])
  })

  it('returns empty for queries with no color terms', () => {
    expect(extractQueryColors('a man fighting')).toEqual([])
  })

  it('extracts color families for bare color-only queries', () => {
    // A query that is *only* color words has no object semantics — the
    // ranker should match against the palette instead of sending CLIP
    // chasing unrelated captions that happen to cluster near the token.
    expect(extractQueryColors('ruby scarlet red').map((c) => c.family)).toEqual(['red'])
    expect(extractQueryColors('pink').map((c) => c.family)).toEqual(['pink'])
  })

  it('returns empty when non-color content words are present without explicit palette intent', () => {
    expect(extractQueryColors('orange sunset navy water')).toEqual([])
  })

  it('supports color prefix syntax and multiple distinct families', () => {
    const result = extractQueryColors('color orange palette navy')
    expect(result.map((r) => r.family).sort()).toEqual(['blue', 'orange'])
  })
})

describe('parseColorQuery', () => {
  it('marks pure color-intent queries as palette-only', () => {
    expect(parseColorQuery('yellow color')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: true,
    })
    expect(parseColorQuery('color:yellow')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: true,
    })
  })

  it('keeps mixed content queries out of palette-only mode', () => {
    expect(parseColorQuery('yellow color jacket')).toMatchObject({
      colors: [{ family: 'yellow' }],
      paletteOnly: false,
    })
  })

  it('treats bare single-color queries as palette intent', () => {
    expect(parseColorQuery('pink')).toMatchObject({
      colors: [{ family: 'pink' }],
      paletteOnly: true,
    })
  })

  it('treats multi-color-only queries as palette intent', () => {
    expect(parseColorQuery('pink purple')).toMatchObject({
      colors: [{ family: 'pink' }, { family: 'purple' }],
      paletteOnly: true,
    })
  })
})

const REDS: PaletteEntry = { l: 53, a: 70, b: 50, weight: 0.5 }
const GREEN: PaletteEntry = { l: 60, a: -55, b: 50, weight: 0.3 }
const BLUES: PaletteEntry = { l: 40, a: 15, b: -60, weight: 0.2 }

describe('colorBoostFor', () => {
  it('returns a non-zero boost when palette contains the query color', () => {
    const queries = extractQueryColors('red color')
    const result = colorBoostFor(queries, [REDS, GREEN, BLUES])
    expect(result).not.toBeNull()
    expect(result?.family).toBe('red')
    expect(result?.boost).toBeGreaterThan(0.1)
  })

  it('returns null when palette has no close match', () => {
    const queries = extractQueryColors('red color')
    const result = colorBoostFor(queries, [{ l: 60, a: -55, b: 50, weight: 1.0 }])
    expect(result).toBeNull()
  })

  it('returns null for empty palette', () => {
    const queries = extractQueryColors('red color')
    expect(colorBoostFor(queries, [])).toBeNull()
    expect(colorBoostFor(queries, undefined)).toBeNull()
  })

  it('returns null for query without color words', () => {
    const queries = extractQueryColors('a scene with people')
    expect(colorBoostFor(queries, [REDS, GREEN, BLUES])).toBeNull()
  })

  it('weighs larger palette entries higher', () => {
    const queries = extractQueryColors('red color')
    const majorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.8 }])
    const minorRed = colorBoostFor(queries, [{ l: 53, a: 70, b: 50, weight: 0.05 }])
    expect(majorRed?.boost).toBeGreaterThan(minorRed?.boost ?? 0)
  })

  it('picks the best match across multiple query colors', () => {
    const queries = extractQueryColors('red and blue palette')
    const result = colorBoostFor(queries, [
      { l: 50, a: 50, b: 40, weight: 0.2 },
      { l: 42, a: 18, b: -58, weight: 0.7 },
    ])
    expect(result?.family).toBe('blue')
  })

  it('does not match pink against warm skin-tone palette entries', () => {
    // Lab ~(65, 20, 20) is a common medium skin tone — warm, moderate
    // chroma. It sat within the old pink boost range and polluted "pink"
    // results with face-dominated dim scenes.
    const queries = extractQueryColors('pink')
    const result = colorBoostFor(queries, [
      { l: 65, a: 20, b: 20, weight: 0.5 },
      { l: 40, a: 10, b: 15, weight: 0.3 },
    ])
    expect(result).toBeNull()
  })

  it('matches pink against genuinely pink palette entries', () => {
    const queries = extractQueryColors('pink')
    const result = colorBoostFor(queries, [
      { l: 65, a: 55, b: -5, weight: 0.4 },
      { l: 20, a: 5, b: 5, weight: 0.4 },
    ])
    expect(result).not.toBeNull()
    expect(result?.family).toBe('pink')
    expect(result?.boost).toBeGreaterThan(0.1)
  })

  it('does not match chromatic families against low-chroma gray palette entries', () => {
    const queries = extractQueryColors('red')
    const result = colorBoostFor(queries, [
      { l: 55, a: 2, b: 1, weight: 0.8 }, // near-gray
    ])
    expect(result).toBeNull()
  })

  it('still matches neutral families against low-chroma entries', () => {
    // The chroma/hue gate applies only to chromatic families — gray,
    // black, white should still match near-neutral palette entries.
    const queries = extractQueryColors('gray tones')
    const result = colorBoostFor(queries, [{ l: 55, a: 2, b: 1, weight: 0.6 }])
    expect(result).not.toBeNull()
    expect(result?.family).toBe('gray')
  })
})

describe('nearestColorFamily', () => {
  it('maps a clearly chromatic swatch to the obvious family', () => {
    expect(nearestColorFamily({ l: 53, a: 70, b: 50 })).toBe('red')
    expect(nearestColorFamily({ l: 40, a: 15, b: -60 })).toBe('blue')
    expect(nearestColorFamily({ l: 90, a: -5, b: 80 })).toBe('yellow')
  })

  it('maps near-neutral swatches to gray/black/white', () => {
    expect(nearestColorFamily({ l: 55, a: 0, b: 0 })).toBe('gray')
    expect(nearestColorFamily({ l: 95, a: 0, b: 0 })).toBe('white')
    expect(nearestColorFamily({ l: 10, a: 0, b: 0 })).toBe('black')
  })
})

describe('palettePairDistance', () => {
  it('returns 0 for identical palettes', () => {
    const a: PaletteEntry[] = [
      { l: 50, a: 60, b: 40, weight: 0.6 },
      { l: 40, a: 20, b: -50, weight: 0.4 },
    ]
    expect(palettePairDistance(a, a)).toBeCloseTo(0, 5)
  })

  it('is symmetric', () => {
    const a: PaletteEntry[] = [{ l: 60, a: 40, b: 30, weight: 0.8 }]
    const b: PaletteEntry[] = [{ l: 65, a: 45, b: 20, weight: 1.0 }]
    expect(palettePairDistance(a, b)).toBeCloseTo(palettePairDistance(b, a), 5)
  })

  it('returns a larger distance for perceptually different palettes', () => {
    const warmReds: PaletteEntry[] = [{ l: 53, a: 70, b: 50, weight: 1 }]
    const coolBlues: PaletteEntry[] = [{ l: 40, a: 15, b: -60, weight: 1 }]
    expect(palettePairDistance(warmReds, coolBlues)).toBeGreaterThan(40)
  })

  it('returns infinity for empty palettes', () => {
    const a: PaletteEntry[] = [{ l: 50, a: 0, b: 0, weight: 1 }]
    expect(palettePairDistance(a, [])).toBe(Number.POSITIVE_INFINITY)
    expect(palettePairDistance([], a)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('paletteSimilarityBoost', () => {
  it('produces a non-zero boost for similar palettes', () => {
    const ref: PaletteEntry[] = [
      { l: 50, a: 60, b: 40, weight: 0.7 },
      { l: 40, a: 20, b: -50, weight: 0.3 },
    ]
    const candidate: PaletteEntry[] = [
      { l: 52, a: 62, b: 38, weight: 0.6 },
      { l: 42, a: 18, b: -52, weight: 0.4 },
    ]
    const result = paletteSimilarityBoost(ref, candidate)
    expect(result).not.toBeNull()
    expect(result?.boost).toBeGreaterThan(0.1)
    expect(result?.distance).toBeLessThan(10)
  })

  it('returns null for clearly dissimilar palettes', () => {
    const warmReds: PaletteEntry[] = [{ l: 53, a: 70, b: 50, weight: 1 }]
    const coolGreens: PaletteEntry[] = [{ l: 60, a: -55, b: 50, weight: 1 }]
    expect(paletteSimilarityBoost(warmReds, coolGreens)).toBeNull()
  })

  it('returns null for missing inputs', () => {
    const a: PaletteEntry[] = [{ l: 50, a: 0, b: 0, weight: 1 }]
    expect(paletteSimilarityBoost(undefined, a)).toBeNull()
    expect(paletteSimilarityBoost(a, undefined)).toBeNull()
  })
})
