// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  isSpanIgnored,
  normalizeRanges,
  overlapFraction,
  subtractRanges,
  totalRangeSeconds,
  unionRanges,
} from './source-range-intervals'

describe('normalizeRanges', () => {
  it('sorts, drops empties, and merges overlapping/adjacent ranges', () => {
    expect(
      normalizeRanges([
        { start: 5, end: 6 },
        { start: 1, end: 2 },
        { start: 2, end: 3 }, // adjacent to [1,2]
        { start: 2.5, end: 2.5 }, // empty
      ]),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ])
  })

  it('merges overlapping ranges into one', () => {
    expect(
      normalizeRanges([
        { start: 1, end: 4 },
        { start: 2, end: 3 },
        { start: 3.5, end: 6 },
      ]),
    ).toEqual([{ start: 1, end: 6 }])
  })
})

describe('unionRanges', () => {
  it('combines two lists', () => {
    expect(unionRanges([{ start: 0, end: 1 }], [{ start: 2, end: 3 }])).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ])
  })
})

describe('subtractRanges', () => {
  it('cuts a hole out of the middle, leaving both sides', () => {
    expect(subtractRanges([{ start: 0, end: 10 }], [{ start: 4, end: 6 }])).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ])
  })

  it('removes a fully-covered range', () => {
    expect(subtractRanges([{ start: 2, end: 5 }], [{ start: 0, end: 10 }])).toEqual([])
  })

  it('trims overlapping edges', () => {
    expect(subtractRanges([{ start: 0, end: 5 }], [{ start: 3, end: 9 }])).toEqual([
      { start: 0, end: 3 },
    ])
  })

  it('leaves disjoint ranges untouched', () => {
    expect(subtractRanges([{ start: 0, end: 2 }], [{ start: 5, end: 8 }])).toEqual([
      { start: 0, end: 2 },
    ])
  })
})

describe('overlapFraction', () => {
  it('reports the covered fraction of a span', () => {
    expect(overlapFraction(0, 10, [{ start: 0, end: 5 }])).toBeCloseTo(0.5)
    expect(overlapFraction(0, 10, [])).toBe(0)
    expect(overlapFraction(0, 10, [{ start: -5, end: 15 }])).toBe(1)
  })
})

describe('isSpanIgnored', () => {
  it('is true past the default 50% threshold', () => {
    expect(isSpanIgnored(0, 10, [{ start: 0, end: 6 }])).toBe(true)
    expect(isSpanIgnored(0, 10, [{ start: 0, end: 4 }])).toBe(false)
  })

  it('handles missing range lists', () => {
    expect(isSpanIgnored(0, 1, undefined)).toBe(false)
    expect(isSpanIgnored(0, 1, [])).toBe(false)
  })
})

describe('totalRangeSeconds', () => {
  it('sums normalized coverage without double-counting overlaps', () => {
    expect(
      totalRangeSeconds([
        { start: 0, end: 3 },
        { start: 2, end: 5 },
      ]),
    ).toBe(5)
  })
})
