import { describe, expect, it } from 'vite-plus/test'
import type { PaletteEntry } from '../deps/analysis'
import { clusterPaletteEntries, flattenLibraryPalettes } from './library-palette'

describe('flattenLibraryPalettes', () => {
  it('normalizes each palette so long clips do not dominate', () => {
    const a: PaletteEntry[] = [{ l: 50, a: 10, b: 10, weight: 0.8 }]
    const b: PaletteEntry[] = [
      { l: 30, a: 0, b: 0, weight: 0.5 },
      { l: 60, a: 0, b: 0, weight: 0.5 },
    ]
    const flat = flattenLibraryPalettes([a, b])
    const totalA = flat.filter((e) => e.l === 50).reduce((s, e) => s + e.weight, 0)
    const totalB = flat.filter((e) => e.l !== 50).reduce((s, e) => s + e.weight, 0)
    expect(totalA).toBeCloseTo(1, 5)
    expect(totalB).toBeCloseTo(1, 5)
  })

  it('skips empty or undefined palettes', () => {
    const a: PaletteEntry[] = [{ l: 50, a: 10, b: 10, weight: 0.8 }]
    expect(flattenLibraryPalettes([a, undefined, []])).toHaveLength(1)
  })
})

describe('clusterPaletteEntries', () => {
  it('returns empty for empty input', () => {
    expect(clusterPaletteEntries([], 5)).toEqual([])
  })

  it('caps cluster count at the entry count', () => {
    const entries: PaletteEntry[] = [
      { l: 50, a: 60, b: 40, weight: 1 },
      { l: 40, a: 15, b: -60, weight: 1 },
    ]
    const clusters = clusterPaletteEntries(entries, 10)
    expect(clusters).toHaveLength(2)
  })

  it('recovers well-separated source colors', () => {
    // Three obvious color blobs with a bit of jitter per entry. The
    // clusters should land near each of the three source centers.
    const makeBlob = (base: { l: number; a: number; b: number }): PaletteEntry[] =>
      Array.from({ length: 5 }, (_, i) => ({
        l: base.l + (i - 2) * 0.3,
        a: base.a + (i - 2) * 0.3,
        b: base.b + (i - 2) * 0.3,
        weight: 1,
      }))

    const entries = [
      ...makeBlob({ l: 53, a: 70, b: 50 }), // red
      ...makeBlob({ l: 40, a: 15, b: -60 }), // blue
      ...makeBlob({ l: 90, a: -5, b: 80 }), // yellow
    ]
    const clusters = clusterPaletteEntries(entries, 3)
    expect(clusters).toHaveLength(3)

    // At least one cluster center should be close to each source blob.
    const nearest = (target: { l: number; a: number; b: number }): number => {
      let best = Infinity
      for (const c of clusters) {
        const d = Math.sqrt((c.l - target.l) ** 2 + (c.a - target.a) ** 2 + (c.b - target.b) ** 2)
        if (d < best) best = d
      }
      return best
    }
    expect(nearest({ l: 53, a: 70, b: 50 })).toBeLessThan(5)
    expect(nearest({ l: 40, a: 15, b: -60 })).toBeLessThan(5)
    expect(nearest({ l: 90, a: -5, b: 80 })).toBeLessThan(5)
  })

  it('weights cluster output by pixel coverage', () => {
    const entries: PaletteEntry[] = [
      { l: 50, a: 60, b: 40, weight: 0.9 }, // big red
      { l: 40, a: 15, b: -60, weight: 0.05 }, // tiny blue
      { l: 40, a: 15, b: -60, weight: 0.05 }, // tiny blue
    ]
    const clusters = clusterPaletteEntries(entries, 2)
    expect(clusters).toHaveLength(2)
    const sorted = [...clusters].sort((a, b) => b.weight - a.weight)
    expect(sorted[0]?.weight).toBeGreaterThan(sorted[1]?.weight ?? 0)
  })
})
